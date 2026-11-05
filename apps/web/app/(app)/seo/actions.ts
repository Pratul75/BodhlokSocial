"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { connections, db, geoQuestions } from "@bodh/db";
import { z } from "zod";
import { canAccess } from "@bodh/shared";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { runSeoJob } from "@/lib/agents";
import { syncIntegration } from "@/lib/integrations/google-connection";

export interface JobState {
  message?: string;
  error?: string;
}

const JOBS = ["keywords", "audit-start", "audit-poll", "geo", "site-publish", "site-sync"] as const;

export async function seoJobAction(_prev: JobState, formData: FormData): Promise<JobState> {
  const user = await getCurrentUser();
  if (!canAccess(user.role, "seo")) return { error: "Your role can't run SEO jobs." };
  const job = String(formData.get("job"));
  if (!(JOBS as readonly string[]).includes(job)) return { error: "Unknown job." };
  const res = await runSeoJob(job as (typeof JOBS)[number]);
  // A keyword refresh also pulls positions and clicks from Search Console when it's connected.
  if (job === "keywords") {
    const [gsc] = await db.select().from(connections).where(eq(connections.key, "search_console"));
    if (gsc?.status === "connected") {
      try {
        res.message = [res.message, (await syncIntegration("search_console")).message].filter(Boolean).join(" ");
      } catch (e) {
        res.error = `Search Console: ${e instanceof Error ? e.message : e}`;
      }
    }
  }
  await audit({ actor: user.email, actorType: "user", action: `seo_${job}`, target: "SEO", result: res.error ? "failed" : "ok", reason: res.error ?? res.message ?? null });
  revalidatePath("/seo");
  return res;
}

const Question = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(10, "Write the question in full (10 characters at least).").max(200, "Keep it under 200 characters."));

export async function addQuestion(_prev: JobState, formData: FormData): Promise<JobState> {
  const user = await getCurrentUser();
  if (!canAccess(user.role, "seo")) return { error: "Your role can't change the AI-visibility questions." };
  const p = Question.safeParse(String(formData.get("question") ?? ""));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "That question isn't valid." };
  await db.insert(geoQuestions).values({ question: p.data }).onConflictDoUpdate({ target: geoQuestions.question, set: { active: true } });
  await audit({ actor: user.email, actorType: "user", action: "add_geo_question", target: p.data, result: "active" });
  revalidatePath("/seo");
  return { message: "Added. It's asked in the next weekly check." };
}

export async function toggleQuestion(_prev: JobState, formData: FormData): Promise<JobState> {
  const user = await getCurrentUser();
  if (!canAccess(user.role, "seo")) return { error: "Your role can't change the AI-visibility questions." };
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Unknown question." };
  const [q] = await db.select().from(geoQuestions).where(eq(geoQuestions.id, id.data));
  if (!q) return { error: "That question no longer exists." };
  await db.update(geoQuestions).set({ active: !q.active }).where(eq(geoQuestions.id, id.data));
  await audit({ actor: user.email, actorType: "user", action: q.active ? "pause_geo_question" : "resume_geo_question", target: q.question, result: q.active ? "paused" : "active" });
  revalidatePath("/seo");
  return { message: q.active ? "Stopped asking." : "Asking again." };
}

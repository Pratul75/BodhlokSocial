"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { connections, db, geoQuestions } from "@bodh/db";
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

export async function addQuestion(formData: FormData) {
  const user = await getCurrentUser();
  if (!canAccess(user.role, "seo")) return;
  const q = String(formData.get("question") ?? "").trim().replace(/\s+/g, " ");
  if (q.length < 10 || q.length > 200) return;
  await db.insert(geoQuestions).values({ question: q }).onConflictDoUpdate({ target: geoQuestions.question, set: { active: true } });
  revalidatePath("/seo");
}

export async function toggleQuestion(formData: FormData) {
  const user = await getCurrentUser();
  if (!canAccess(user.role, "seo")) return;
  const id = String(formData.get("id"));
  const [q] = await db.select().from(geoQuestions).where(eq(geoQuestions.id, id));
  if (q) await db.update(geoQuestions).set({ active: !q.active }).where(eq(geoQuestions.id, id));
  revalidatePath("/seo");
}

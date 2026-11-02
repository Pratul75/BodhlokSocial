"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { brandKit, db, strategyPlans } from "@bodh/db";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { startAgentRun, startReplan } from "@/lib/agents";

/** Next month in India time, as YYYY-MM and as a label. */
export async function nextMonthIst(now = new Date()): Promise<{ key: string; label: string }> {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 1));
  return { key: d.toISOString().slice(0, 7), label: d.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }) };
}

export async function approvePlan(formData: FormData) {
  const user = await getCurrentUser();
  if (user.role !== "admin") return;
  const id = String(formData.get("id"));
  const [plan] = await db.update(strategyPlans).set({ status: "approved" }).where(eq(strategyPlans.id, id)).returning();
  if (plan) {
    await audit({ actor: user.email, actorType: "user", action: "approve_strategy", target: `Plan for ${plan.month}`, result: "approved" });
  }
  revalidatePath("/strategy");
}

export type PositioningResult = { ok: true; message: string } | { ok: false; error: string } | null;

/**
 * Saves the team's positioning brief (every agent reads it from the brand kit), and on
 * "Save and re-plan" starts the Strategy agent on the month and the Content agent after it.
 */
export async function savePositioning(_prev: PositioningResult, formData: FormData): Promise<PositioningResult> {
  const user = await getCurrentUser();
  if (user.role !== "admin" && user.role !== "social_manager") return { ok: false, error: "Only admins and social media managers can change the brief." };
  const positioning = String(formData.get("positioning") ?? "").trim().slice(0, 12000);
  const sources: string[] = [];
  for (const line of String(formData.get("sources") ?? "").split("\n").map((l) => l.trim()).filter(Boolean)) {
    try {
      const u = new URL(line);
      if (u.protocol !== "https:") return { ok: false, error: `"${line}" must start with https://.` };
      sources.push(u.href);
    } catch {
      return { ok: false, error: `"${line}" isn't a web address.` };
    }
    if (sources.length >= 10) break;
  }
  const intent = String(formData.get("intent"));
  const replan = intent === "replan";
  if (replan && positioning.length < 40) return { ok: false, error: "Write the brief first (at least a few sentences), then re-plan." };

  await db.insert(brandKit).values({ id: 1 }).onConflictDoNothing();
  await db.update(brandKit).set({ positioning, positioningSources: sources, positioningUpdatedAt: new Date(), updatedBy: user.email, updatedAt: new Date() }).where(eq(brandKit.id, 1));
  await audit({ actor: user.email, actorType: "user", action: "save_positioning", target: "Positioning brief", result: `${positioning.length} characters, ${sources.length} source page(s)` });
  revalidatePath("/strategy");
  revalidatePath("/creative");
  if (intent === "plan_next") {
    const next = await nextMonthIst();
    const r = await startAgentRun("strategy", user.email, `Write the strategy plan for ${next.key} from the positioning brief and your research, and outline that month's calendar.`);
    if (r.error) return { ok: false, error: `Brief saved, but the planning run couldn't start: ${r.error}` };
    await audit({ actor: user.email, actorType: "user", action: "plan_next_month", target: "Strategy agent", result: `run ${r.runId}` });
    revalidatePath("/runs");
    return { ok: true, message: `Brief saved and the Strategy agent is planning ${next.label}. It comes back as a draft to approve; follow it under Agent runs (5 to 10 minutes).` };
  }
  if (!replan) return { ok: true, message: "Brief saved. Every agent run from now on follows it." };

  const r = await startReplan(user.email);
  if (r.error) return { ok: false, error: `Brief saved, but the re-plan couldn't start: ${r.error}` };
  await audit({ actor: user.email, actorType: "user", action: "replan_month", target: "Strategy agent", result: `run ${r.runId}` });
  revalidatePath("/runs");
  return { ok: true, message: "Brief saved and the re-plan started: the Strategy agent rewrites this month's plan and calendar, then the Content agent drafts the first week. Follow it under Agent runs; it takes 5 to 10 minutes." };
}

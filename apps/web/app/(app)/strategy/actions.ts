"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { brandKit, db, strategyPlans } from "@bodh/db";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { startReplan } from "@/lib/agents";

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
  const replan = String(formData.get("intent")) === "replan";
  if (replan && positioning.length < 40) return { ok: false, error: "Write the brief first (at least a few sentences), then re-plan." };

  await db.insert(brandKit).values({ id: 1 }).onConflictDoNothing();
  await db.update(brandKit).set({ positioning, positioningSources: sources, positioningUpdatedAt: new Date(), updatedBy: user.email, updatedAt: new Date() }).where(eq(brandKit.id, 1));
  await audit({ actor: user.email, actorType: "user", action: "save_positioning", target: "Positioning brief", result: `${positioning.length} characters, ${sources.length} source page(s)` });
  revalidatePath("/strategy");
  revalidatePath("/creative");
  if (!replan) return { ok: true, message: "Brief saved. Every agent run from now on follows it." };

  const r = await startReplan(user.email);
  if (r.error) return { ok: false, error: `Brief saved, but the re-plan couldn't start: ${r.error}` };
  await audit({ actor: user.email, actorType: "user", action: "replan_month", target: "Strategy agent", result: `run ${r.runId}` });
  revalidatePath("/runs");
  return { ok: true, message: "Brief saved and the re-plan started: the Strategy agent rewrites this month's plan and calendar, then the Content agent drafts the first week. Follow it under Agent runs; it takes 5 to 10 minutes." };
}

"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, strategyPlans } from "@bodh/db";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

export type PlanState = { ok: true; message: string } | { ok: false; error: string } | null;

export async function approvePlan(_prev: PlanState, formData: FormData): Promise<PlanState> {
  const user = await getCurrentUser();
  if (user.role !== "admin") return { ok: false, error: "Only an admin can approve the plan." };
  const p = z.object({ id: z.uuid() }).safeParse({ id: formData.get("id") });
  if (!p.success) return { ok: false, error: "Unknown plan." };
  const [plan] = await db
    .update(strategyPlans)
    .set({ status: "approved" })
    .where(and(eq(strategyPlans.id, p.data.id), eq(strategyPlans.status, "draft")))
    .returning();
  if (!plan) return { ok: false, error: "This plan was already approved or replaced. Reload the page." };
  await audit({ actor: user.email, actorType: "user", action: "approve_strategy", target: `Plan for ${plan.month}`, result: "approved" });
  revalidatePath("/strategy");
  return { ok: true, message: "Approved. The Content agent follows it from its next run." };
}

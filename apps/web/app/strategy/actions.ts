"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, strategyPlans } from "@bodh/db";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

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

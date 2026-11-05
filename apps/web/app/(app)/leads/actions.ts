"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, LEAD_STATUSES, leads, users } from "@bodh/db";
import { canAccess } from "@bodh/shared";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

export type LeadState = { ok: true; message: string } | { ok: false; error: string } | null;

const Update = z.object({
  id: z.uuid(),
  status: z.enum(LEAD_STATUSES),
  assignedTo: z.union([z.literal(""), z.uuid()]),
});

export async function updateLead(_prev: LeadState, formData: FormData): Promise<LeadState> {
  const user = await getCurrentUser();
  if (!canAccess(user.role, "leads")) return { ok: false, error: "Your role can't manage leads." };
  const p = Update.safeParse({ id: formData.get("id"), status: formData.get("status"), assignedTo: formData.get("assignedTo") ?? "" });
  if (!p.success) return { ok: false, error: "That change isn't valid." };
  if (p.data.assignedTo) {
    const [owner] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, p.data.assignedTo), eq(users.active, true))).limit(1);
    if (!owner) return { ok: false, error: "That person no longer has access." };
  }
  const [lead] = await db
    .update(leads)
    .set({ status: p.data.status, assignedTo: p.data.assignedTo || null, updatedAt: new Date() })
    .where(eq(leads.id, p.data.id))
    .returning({ name: leads.name });
  if (!lead) return { ok: false, error: "This lead no longer exists." };
  await audit({ actor: user.email, actorType: "user", action: "update_lead", target: lead.name, result: p.data.status });
  revalidatePath("/leads");
  return { ok: true, message: "Saved." };
}

"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, leads } from "@bodh/db";
import { canAccess } from "@bodh/shared";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

const STATUSES = ["new", "contacted", "qualified", "won", "lost"];

export async function updateLead(formData: FormData) {
  const user = await getCurrentUser();
  if (!canAccess(user.role, "leads")) return;
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  const assignedTo = String(formData.get("assignedTo") ?? "");
  if (!STATUSES.includes(status)) return;
  const [lead] = await db
    .update(leads)
    .set({ status, assignedTo: assignedTo || null })
    .where(eq(leads.id, id))
    .returning({ name: leads.name });
  if (lead) {
    await audit({ actor: user.email, actorType: "user", action: "update_lead", target: lead.name, result: status });
  }
  revalidatePath("/leads");
}

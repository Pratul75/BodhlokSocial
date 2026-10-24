"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { calendarItems, db } from "@bodh/db";
import { canAccess } from "@bodh/shared";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function retryPublish(formData: FormData) {
  const user = await getCurrentUser();
  if (!canAccess(user.role, "publishing")) return;
  const id = String(formData.get("id"));
  const [item] = await db
    .update(calendarItems)
    .set({ status: "scheduled", error: null, scheduledAt: new Date(Date.now() + 10 * 60 * 1000) })
    .where(and(eq(calendarItems.id, id), eq(calendarItems.status, "failed")))
    .returning();
  if (item) {
    await audit({ actor: user.email, actorType: "user", action: "retry_publish", target: item.idea, result: "rescheduled in 10 min" });
  }
  revalidatePath("/publishing");
}

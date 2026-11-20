"use server";

import { revalidatePath } from "next/cache";
import { calendarItems, db } from "@bodh/db";
import { CHANNELS, FORMATS } from "@bodh/shared";
import { allowed, enterTenantScope, getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

export type AddResult = { ok: true; id: string } | { ok: false; error: string } | null;

export async function addIdea(_prev: AddResult, formData: FormData): Promise<AddResult> {
  const user = enterTenantScope(await getCurrentUser());
  if (!allowed(user, "calendar")) return { ok: false, error: "You can't edit the calendar." };

  const channel = String(formData.get("channel"));
  const format = String(formData.get("format"));
  const idea = String(formData.get("idea") ?? "").trim();
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "18:30");

  if (!(CHANNELS as readonly string[]).includes(channel)) return { ok: false, error: "Pick a channel." };
  if (!(FORMATS as readonly string[]).includes(format)) return { ok: false, error: "Pick a format." };
  if (idea.length < 5) return { ok: false, error: "Describe the idea in a few words." };
  const scheduledAt = new Date(`${date}T${time}`);
  if (Number.isNaN(scheduledAt.getTime())) return { ok: false, error: "Pick a date and time." };

  const [row] = await db.insert(calendarItems).values({ channel, format, idea, scheduledAt, status: "idea" }).returning({ id: calendarItems.id });
  await audit({ actor: user.email, actorType: "user", action: "add_calendar_item", target: idea, result: "created" });
  revalidatePath("/calendar");
  return { ok: true, id: row!.id };
}

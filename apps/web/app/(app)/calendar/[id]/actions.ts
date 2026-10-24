"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { approvals, assets, calendarItems, db } from "@bodh/db";
import { CHANNELS, FORMATS, canAccess } from "@bodh/shared";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { checkItem, itemAssets } from "@/lib/posts";

export type ItemResult = { ok: true; message: string } | { ok: false; error: string; details?: string[] } | null;

const LOCKED = ["published"];

async function load(id: string) {
  const [item] = await db.select().from(calendarItems).where(eq(calendarItems.id, id)).limit(1);
  return item ?? null;
}

async function withdrawApprovals(itemId: string, by: string) {
  await db
    .update(approvals)
    .set({ status: "withdrawn", decidedAt: new Date(), decisionNote: `Withdrawn: edited by ${by}` })
    .where(and(eq(approvals.calendarItemId, itemId), eq(approvals.status, "pending")));
}

const sorted = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

function readForm(formData: FormData) {
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "18:30");
  const settings: Record<string, unknown> = {};
  for (const key of ["post_type", "visibility", "made_for_kids"]) {
    const v = formData.get(`setting_${key}`);
    if (typeof v === "string" && v) settings[key] = v;
  }
  const brief = String(formData.get("setting_creative_brief") ?? "").trim();
  if (brief) settings.creative_brief = brief.slice(0, 2000);
  if (formData.get("setting_needs_jyotish_review") === "on") settings.needs_jyotish_review = true;
  return {
    idea: String(formData.get("idea") ?? "").trim(),
    title: String(formData.get("title") ?? "").trim() || null,
    script: String(formData.get("script") ?? "").trim() || null,
    caption: String(formData.get("caption") ?? "").trim() || null,
    channel: String(formData.get("channel") ?? ""),
    format: String(formData.get("format") ?? ""),
    scheduledAt: new Date(`${date}T${time}`),
    assetIds: formData.getAll("assetIds").map(String).filter(Boolean),
    settings,
  };
}

export async function saveItem(_prev: ItemResult, formData: FormData): Promise<ItemResult> {
  const user = await getCurrentUser();
  if (!canAccess(user.role, "calendar")) return { ok: false, error: "Your role can't edit the calendar." };
  const id = String(formData.get("id"));
  const item = await load(id);
  if (!item) return { ok: false, error: "This item no longer exists." };
  if (LOCKED.includes(item.status)) return { ok: false, error: "Published posts can't be edited." };

  const f = readForm(formData);
  // Keep who drafted it; the form doesn't carry these.
  for (const key of ["drafted_by", "run_id"]) if (key in item.settings) f.settings[key] = item.settings[key];
  if (f.idea.length < 5) return { ok: false, error: "Describe the idea in a few words." };
  if (!(CHANNELS as readonly string[]).includes(f.channel)) return { ok: false, error: "Pick a channel." };
  if (!(FORMATS as readonly string[]).includes(f.format)) return { ok: false, error: "Pick a format." };
  if (Number.isNaN(f.scheduledAt.getTime())) return { ok: false, error: "Pick a date and time." };
  if (f.assetIds.length) {
    const found = await db.select({ id: assets.id }).from(assets).where(inArray(assets.id, f.assetIds));
    if (found.length !== new Set(f.assetIds).size) return { ok: false, error: "One of the chosen assets no longer exists." };
  }

  const contentChanged =
    f.idea !== item.idea ||
    f.title !== item.title ||
    f.script !== item.script ||
    f.caption !== item.caption ||
    f.channel !== item.channel ||
    f.format !== item.format ||
    f.scheduledAt.getTime() !== item.scheduledAt.getTime() ||
    JSON.stringify(f.assetIds) !== JSON.stringify(item.assetIds) ||
    JSON.stringify(sorted(f.settings)) !== JSON.stringify(sorted(item.settings));
  if (!contentChanged) return { ok: true, message: "No changes to save." };

  // Anything approved or scheduled goes back to draft: approval covers the exact post.
  let status = item.status;
  let message = "Saved.";
  if (["in_review", "approved", "scheduled", "failed"].includes(item.status)) {
    status = "drafted";
    await withdrawApprovals(id, user.email);
    message = item.status === "in_review" ? "Saved. The approval request was withdrawn; send it again when ready." : "Saved and moved back to draft. It needs approval again before it goes out.";
  } else if (item.status === "idea" && f.caption) {
    status = "drafted";
  }

  await db
    .update(calendarItems)
    .set({ ...f, status, error: null, updatedAt: new Date() })
    .where(eq(calendarItems.id, id));
  await audit({ actor: user.email, actorType: "user", action: "edit_calendar_item", target: f.idea, result: status });
  revalidatePath(`/calendar/${id}`);
  revalidatePath("/calendar");
  return { ok: true, message };
}

export async function sendForApproval(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!canAccess(user.role, "calendar")) return;
  const id = String(formData.get("id"));
  const item = await load(id);
  if (!item || !["idea", "drafted", "failed"].includes(item.status)) return;
  const list = await itemAssets(item);
  const check = await checkItem(item, list);
  if (check.errors.length) redirect(`/calendar/${id}?blocked=1`);

  await withdrawApprovals(id, user.email);
  await db.insert(approvals).values({
    kind: "post",
    channel: item.channel,
    agent: "content",
    calendarItemId: item.id,
    title: item.title ? `${item.title}` : item.idea,
    body: item.caption ?? "",
    reason: `Sent for approval by ${user.name}. Scheduled for ${item.scheduledAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.`,
    payload: {
      format: item.format,
      script: item.script,
      assetIds: item.assetIds,
      scheduledAt: item.scheduledAt.toISOString(),
      warnings: check.warnings,
      needsJyotishReview: item.settings.needs_jyotish_review === true,
      draftedBy: typeof item.settings.drafted_by === "string" ? item.settings.drafted_by : null,
    },
  });
  await db.update(calendarItems).set({ status: "in_review", updatedAt: new Date() }).where(eq(calendarItems.id, id));
  await audit({ actor: user.email, actorType: "user", action: "send_for_approval", target: item.idea, result: "in_review" });
  revalidatePath("/approvals");
  revalidatePath("/", "layout");
  redirect(`/calendar/${id}?sent=1`);
}

export async function unschedule(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!canAccess(user.role, "calendar")) return;
  const id = String(formData.get("id"));
  const item = await load(id);
  if (!item || !["approved", "scheduled"].includes(item.status)) return;
  // The publisher removes the post from Postiz on its next run (postizId is kept until then).
  await db.update(calendarItems).set({ status: "drafted", updatedAt: new Date() }).where(eq(calendarItems.id, id));
  await audit({ actor: user.email, actorType: "user", action: "unschedule", target: item.idea, result: "drafted" });
  revalidatePath(`/calendar/${id}`);
  revalidatePath("/publishing");
}

export async function deleteItem(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!canAccess(user.role, "calendar")) return;
  const id = String(formData.get("id"));
  const item = await load(id);
  if (!item || !["idea", "drafted"].includes(item.status) || item.postizId) return;
  await withdrawApprovals(id, user.email);
  await db.delete(calendarItems).where(eq(calendarItems.id, id));
  await audit({ actor: user.email, actorType: "user", action: "delete_calendar_item", target: item.idea, result: "deleted" });
  revalidatePath("/calendar");
  redirect("/calendar");
}

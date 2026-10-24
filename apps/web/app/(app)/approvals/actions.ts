"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { approvals, calendarItems, db, seoPages } from "@bodh/db";
import { applyChange, rejectChange } from "@bodh/integrations/ads";
import { APPROVAL_KINDS, canApprove, type ApprovalKind } from "@bodh/shared";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { checkItem } from "@/lib/posts";

export type DecideResult = { ok: true } | { ok: false; error: string };

export async function decide(_prev: DecideResult | null, formData: FormData): Promise<DecideResult> {
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  const editedBody = formData.get("body");

  if (!["approve", "reject"].includes(decision)) return { ok: false, error: "Unknown decision." };

  const user = await getCurrentUser();
  const [item] = await db.select().from(approvals).where(eq(approvals.id, id)).limit(1);
  if (!item) return { ok: false, error: "This item no longer exists." };
  if (item.status !== "pending") return { ok: false, error: `Someone already ${item.status} this item.` };

  const kind = item.kind as ApprovalKind;
  if (!(APPROVAL_KINDS as readonly string[]).includes(kind) || !canApprove(user.role, kind)) {
    return { ok: false, error: "Your role can't decide on this kind of item." };
  }
  if (decision === "reject" && !note) {
    return { ok: false, error: "Add a note so the agent knows what to change." };
  }

  const body = typeof editedBody === "string" && editedBody.trim() ? editedBody : item.body;
  const edited = body !== item.body;

  // Posts from the calendar: the approval covers the item exactly as it was sent.
  const [post] = item.calendarItemId
    ? await db.select().from(calendarItems).where(eq(calendarItems.id, item.calendarItemId)).limit(1)
    : [];
  if (item.calendarItemId) {
    if (!post) return { ok: false, error: "The calendar item was deleted." };
    if (post.status !== "in_review") return { ok: false, error: "The calendar item changed after it was sent. It needs a fresh approval request." };
    if (decision === "approve") {
      const check = await checkItem({ ...post, caption: body });
      if (check.errors.length) return { ok: false, error: `Can't approve yet: ${check.errors.join(" ")}` };
    }
  }

  // SEO pages: the approval covers the draft it was sent with.
  const pageId = item.kind === "page" ? String((item.payload as { seoPageId?: string }).seoPageId ?? "") : "";
  const [page] = pageId ? await db.select().from(seoPages).where(eq(seoPages.id, pageId)).limit(1) : [];
  if (item.kind === "page") {
    if (!page) return { ok: false, error: "The page was deleted." };
    if (page.status !== "in_review") return { ok: false, error: "The page changed after it was sent. It needs a fresh approval request." };
  }

  // Only update while still pending, so two people can't decide the same item.
  const updated = await db
    .update(approvals)
    .set({
      status: decision === "approve" ? "approved" : "rejected",
      body,
      decidedBy: user.id,
      decidedAt: new Date(),
      decisionNote: note,
    })
    .where(and(eq(approvals.id, id), eq(approvals.status, "pending")))
    .returning({ id: approvals.id });
  if (updated.length === 0) return { ok: false, error: "Someone decided this item a moment ago." };

  if (post) {
    await db
      .update(calendarItems)
      .set(
        decision === "approve"
          ? { status: "approved", caption: body, error: null, updatedAt: new Date() }
          : { status: "drafted", updatedAt: new Date() },
      )
      .where(eq(calendarItems.id, post.id));
    revalidatePath("/calendar");
    revalidatePath(`/calendar/${post.id}`);
    revalidatePath("/publishing");
  }

  // Ad changes: approving applies the change on the platform now; the change log records how it went.
  const adChangeId = item.kind === "ad_change" ? (item.payload as { adChangeId?: string }).adChangeId : undefined;
  if (adChangeId) {
    if (decision === "approve") {
      const r = await applyChange(adChangeId);
      revalidatePath("/ads");
      if (!r.ok) {
        await audit({ actor: user.email, actorType: "user", action: "approve", target: `${item.kind}: ${item.title}`, reason: note, result: `approved, but applying failed: ${r.error}` });
        revalidatePath("/approvals");
        return { ok: false, error: `Approved, but the platform refused it: ${r.error}. It's in the change log as failed.` };
      }
    } else {
      await rejectChange(adChangeId, note);
      revalidatePath("/ads");
    }
  }

  if (page) {
    await db
      .update(seoPages)
      .set(
        decision === "approve"
          ? { status: "live", body, reviewNote: null, publishedAt: page.publishedAt ?? new Date(), updatedAt: new Date() }
          : { status: "drafted", reviewNote: note, updatedAt: new Date() },
      )
      .where(eq(seoPages.id, page.id));
    revalidatePath("/seo");
  }

  await audit({
    actor: user.email,
    actorType: "user",
    action: decision === "approve" ? (edited ? "edit_and_approve" : "approve") : "reject",
    target: `${item.kind}: ${item.title}`,
    reason: note,
    result: decision === "approve" ? "approved" : "rejected",
  });

  revalidatePath("/approvals");
  revalidatePath("/", "layout");
  return { ok: true };
}

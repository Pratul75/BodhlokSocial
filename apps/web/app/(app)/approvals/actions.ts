"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { approvals, db } from "@bodh/db";
import { APPROVAL_KINDS, canApprove, type ApprovalKind } from "@bodh/shared";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

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

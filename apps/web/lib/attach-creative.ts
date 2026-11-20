import "server-only";
import { and, eq } from "drizzle-orm";
import { approvals, calendarItems, db } from "@bodh/db";

export interface AttachOutcome {
  /** What to tell the person who generated it, or null when there was nothing to attach to. */
  message: string | null;
  attached: number;
  sentBackToDraft: boolean;
}

/**
 * Puts a freshly made creative onto the post it was made for.
 *
 * The studio was opened from a calendar post, so leaving the result in the library and asking
 * somebody to go and find it is the step this path exists to remove.
 *
 * Two things it is careful about. Media already on the post is kept and the new files are added
 * after it, in the order they were made — attaching must never be a way to lose what was there.
 * And anything already sent for approval goes back to draft with its pending approvals
 * withdrawn: an approval covers the exact post, and the post now has different media in it.
 */
export async function attachCreativeToPost(itemId: string, assetIds: string[], by: string): Promise<AttachOutcome> {
  const none = { message: null, attached: 0, sentBackToDraft: false };
  if (!itemId || !/^[0-9a-f-]{36}$/.test(itemId) || assetIds.length === 0) return none;
  const [item] = await db.select().from(calendarItems).where(eq(calendarItems.id, itemId)).limit(1);
  if (!item) return none;
  if (item.status === "published") {
    return { message: "That post is already published, so nothing was attached; the images are in the library.", attached: 0, sentBackToDraft: false };
  }

  const fresh = assetIds.filter((id, i) => !item.assetIds.includes(id) && assetIds.indexOf(id) === i);
  if (fresh.length === 0) return { message: `Those are already on "${item.idea}".`, attached: 0, sentBackToDraft: false };

  const sentBack = ["in_review", "approved", "scheduled", "failed"].includes(item.status);
  await db
    .update(calendarItems)
    .set({ assetIds: [...item.assetIds, ...fresh], status: sentBack ? "drafted" : item.status, error: null, updatedAt: new Date() })
    .where(eq(calendarItems.id, itemId));
  if (sentBack) {
    await db
      .update(approvals)
      .set({ status: "withdrawn", decidedAt: new Date(), decisionNote: `Withdrawn: new creative attached by ${by}` })
      .where(and(eq(approvals.calendarItemId, itemId), eq(approvals.status, "pending")));
  }
  return {
    message: sentBack
      ? `Attached to "${item.idea}", which went back to draft; send it for approval again.`
      : `Attached to "${item.idea}".`,
    attached: fresh.length,
    sentBackToDraft: sentBack,
  };
}

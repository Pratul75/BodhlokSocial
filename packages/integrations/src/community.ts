/**
 * Posting an approved community answer. Reddit and YouTube answers go out from the connected team
 * account at once; Quora has no API, so the item waits for a person to post it and record the link.
 */
import { eq } from "drizzle-orm";
import { auditLog, communityItems, db } from "@bodh/db";
import { postRedditComment, redditAccess } from "./reddit";
import { replyToComment, youtubeToken } from "./youtube";

export type PostResult = { ok: true; url: string | null; manual: boolean } | { ok: false; error: string };

export async function postCommunityReply(itemId: string, text: string, approvedBy: string): Promise<PostResult> {
  const [item] = await db.select().from(communityItems).where(eq(communityItems.id, itemId)).limit(1);
  if (!item) return { ok: false, error: "The community item no longer exists." };
  if (item.status === "posted") return { ok: false, error: "This answer was already posted." };

  if (item.platform === "quora") {
    await db.update(communityItems).set({ status: "approved", draft: text, error: null, updatedAt: new Date() }).where(eq(communityItems.id, itemId));
    return { ok: true, url: null, manual: true };
  }

  try {
    let url: string;
    let account: string;
    if (item.platform === "reddit") {
      const access = await redditAccess();
      if (!access) throw new Error("Reddit isn't connected. Connect it, then post this answer from Community.");
      if (!item.externalId) throw new Error("This item has no Reddit post id to answer.");
      url = await postRedditComment(access, item.externalId, text);
      account = `u/${access.username}`;
    } else if (item.platform === "youtube") {
      const token = await youtubeToken();
      if (!token) throw new Error("YouTube comments aren't connected.");
      if (!item.externalId) throw new Error("This item has no YouTube comment id to reply to.");
      url = await replyToComment(token, item.externalId, text);
      account = "the YouTube channel";
    } else {
      throw new Error(`Can't post to ${item.platform}.`);
    }
    await db
      .update(communityItems)
      .set({ status: "posted", draft: text, postedUrl: url, postedBy: `${account} (approved by ${approvedBy})`, postedAt: new Date(), error: null, updatedAt: new Date() })
      .where(eq(communityItems.id, itemId));
    await db.insert(auditLog).values({ actor: approvedBy, actorType: "user", action: "post_community_reply", target: item.question.slice(0, 120), reason: item.platform, result: `posted: ${url}` });
    return { ok: true, url, manual: false };
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await db.update(communityItems).set({ status: "failed", draft: text, error, updatedAt: new Date() }).where(eq(communityItems.id, itemId));
    return { ok: false, error };
  }
}

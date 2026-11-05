"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { communityItems, db } from "@bodh/db";
import { postCommunityReply } from "@bodh/integrations/community";
import { canAccess } from "@bodh/shared";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { JobState } from "@/app/(app)/seo/actions";

async function socialUser() {
  const user = await getCurrentUser();
  return canAccess(user.role, "community") ? user : null;
}

const Id = z.object({ id: z.uuid() });

/** A question the team decides not to answer. */
export async function skipItem(_prev: JobState, formData: FormData): Promise<JobState> {
  const user = await socialUser();
  if (!user) return { error: "Your role can't manage community answers." };
  const p = Id.extend({ reason: z.string().trim().max(300).optional() }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "Unknown item." };
  const r = await db
    .update(communityItems)
    .set({ status: "skipped", error: p.data.reason || `Skipped by ${user.name}`, updatedAt: new Date() })
    .where(and(eq(communityItems.id, p.data.id), inArray(communityItems.status, ["found", "drafted", "failed"])))
    .returning({ q: communityItems.question });
  if (!r.length) return { error: "Only a found, drafted or failed question can be skipped." };
  await audit({ actor: user.email, actorType: "user", action: "skip_community_item", target: r[0]!.q.slice(0, 120), result: "skipped", reason: p.data.reason ?? null });
  revalidatePath("/community");
  return { message: "Skipped." };
}

/** Posts an approved answer again after Reddit or YouTube refused it. */
export async function retryPost(_prev: JobState, formData: FormData): Promise<JobState> {
  const user = await socialUser();
  if (!user) return { error: "Your role can't post community answers." };
  const p = Id.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "Unknown item." };
  const [item] = await db.select().from(communityItems).where(eq(communityItems.id, p.data.id)).limit(1);
  if (!item || item.status !== "failed" || !item.draft || !item.approvalId) return { error: "Only an approved answer that failed to post can be tried again." };
  const r = await postCommunityReply(item.id, item.draft, user.email);
  revalidatePath("/community");
  return r.ok ? { message: r.url ? `Posted: ${r.url}` : "Ready to post by hand." } : { error: r.error };
}

/** For Quora (no API): a person posted the approved answer and records where. */
export async function markPosted(_prev: JobState, formData: FormData): Promise<JobState> {
  const user = await socialUser();
  if (!user) return { error: "Your role can't post community answers." };
  const p = Id.extend({ url: z.url().refine((u) => /^https:\/\//.test(u), "Use the https link to the answer.") }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Paste the link to the posted answer." };
  const r = await db
    .update(communityItems)
    .set({ status: "posted", postedUrl: p.data.url, postedBy: user.email, postedAt: new Date(), error: null, updatedAt: new Date() })
    .where(and(eq(communityItems.id, p.data.id), eq(communityItems.status, "approved")))
    .returning({ q: communityItems.question });
  if (!r.length) return { error: "Only an approved answer waiting to be posted can be marked posted." };
  await audit({ actor: user.email, actorType: "user", action: "post_community_reply", target: r[0]!.q.slice(0, 120), result: `posted by hand: ${p.data.url}` });
  revalidatePath("/community");
  return { message: "Marked as posted." };
}

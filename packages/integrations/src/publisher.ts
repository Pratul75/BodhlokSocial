import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { approvals, assets, brandKit, calendarItems, db, postizCalls, publishingChannels } from "@bodh/db";
import { checkPost } from "@bodh/guardrails/posts";
import type { JobResult } from "./pipeline";
import { buildPostPayload, createPost, deleteGroup, listPosts, PostizError, uploadFile, type MediaForPostiz, type PostizCredentials } from "./postiz";
import { readJsonSecret } from "./secrets";
import { readFileBytes } from "./storage";

/** Stay under Postiz's per-instance create limit (API_LIMIT, 30 an hour by default). */
export const HOURLY_CREATE_BUDGET = Number(process.env.POSTIZ_HOURLY_BUDGET ?? 25);
/** How far ahead posts are handed to Postiz. Later ones wait, so edits stay cheap. */
const LOOKAHEAD_HOURS = 48;
/** A post more than this late is not sent; someone should reschedule it. */
const LATE_GRACE_HOURS = 6;
const MAX_ATTEMPTS = 3;

type Item = typeof calendarItems.$inferSelect;

export const postizCredentials = () => readJsonSecret<PostizCredentials>("postiz");

async function createsLastHour(): Promise<number> {
  const [r] = (await db.execute(sql`SELECT count(*)::int AS n FROM postiz_calls WHERE endpoint = 'create' AND at > now() - interval '1 hour'`)) as unknown as { n: number }[];
  return r?.n ?? 0;
}

async function setItem(id: string, values: Partial<typeof calendarItems.$inferInsert>) {
  // updatedAt is left alone so publisher updates never look like edits.
  await db.update(calendarItems).set(values).where(eq(calendarItems.id, id));
}

/** Approved by a person, and not edited since: only decide() sets "approved". */
async function hasApproval(itemId: string): Promise<boolean> {
  const rows = await db
    .select({ id: approvals.id })
    .from(approvals)
    .where(and(eq(approvals.calendarItemId, itemId), eq(approvals.status, "approved")))
    .limit(1);
  return rows.length > 0;
}

async function mediaFor(creds: PostizCredentials, item: Item): Promise<MediaForPostiz[]> {
  if (item.assetIds.length === 0) return [];
  const rows = await db.select().from(assets).where(inArray(assets.id, item.assetIds));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: MediaForPostiz[] = [];
  for (const id of item.assetIds) {
    const a = byId.get(id);
    if (!a) throw new Error("A chosen image or video no longer exists.");
    const bytes = await readFileBytes(a.storagePath);
    if (!bytes) throw new Error(`"${a.name}" has no stored file. Upload it again.`);
    const m = await uploadFile(creds, bytes, a.name, a.contentType ?? (a.type === "video" ? "video/mp4" : "image/png"));
    out.push({ ...m, type: a.type as "image" | "video" });
  }
  return out;
}

export async function runPublisher(now = new Date()): Promise<JobResult> {
  const creds = await postizCredentials();
  if (!creds?.api_url || !creds.api_key) return { status: "skipped", detail: "Postiz is not connected. Approved posts wait." };

  const notes: string[] = [];
  let removed = 0;
  let scheduled = 0;
  let failed = 0;
  let published = 0;

  // 1. Posts already in Postiz whose item was edited, unscheduled or re-approved: take them out.
  const stale = await db
    .select()
    .from(calendarItems)
    .where(and(isNotNull(calendarItems.postizId), inArray(calendarItems.status, ["idea", "drafted", "in_review", "approved"])));
  for (const item of stale) {
    try {
      await deleteGroup(creds, item.id);
    } catch (e) {
      if (!(e instanceof PostizError && e.status === 404)) {
        notes.push(`Couldn't remove "${item.idea}" from Postiz: ${e instanceof Error ? e.message : e}`);
        continue;
      }
    }
    await setItem(item.id, { postizId: null });
    removed++;
  }

  // 2. Approved posts due within the lookahead: hand them to Postiz.
  const channels = new Map((await db.select().from(publishingChannels)).map((c) => [c.channel, c]));
  const [kit] = await db.select({ bannedPhrases: brandKit.bannedPhrases }).from(brandKit).limit(1);
  const due = await db
    .select()
    .from(calendarItems)
    .where(and(eq(calendarItems.status, "approved"), lte(calendarItems.scheduledAt, new Date(now.getTime() + LOOKAHEAD_HOURS * 3_600_000))));
  let budget = HOURLY_CREATE_BUDGET - (await createsLastHour());

  for (const item of due.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())) {
    if (item.postizId) continue; // removed above if stale; otherwise already handed over
    const fail = async (error: string, final = true) => {
      const attempts = item.publishAttempts + 1;
      const giveUp = final || attempts >= MAX_ATTEMPTS;
      await setItem(item.id, { error, publishAttempts: attempts, ...(giveUp ? { status: "failed" } : {}) });
      if (giveUp) failed++;
    };

    if (item.scheduledAt.getTime() < now.getTime() - LATE_GRACE_HOURS * 3_600_000) {
      await fail(`Missed its time by more than ${LATE_GRACE_HOURS} hours, so it wasn't posted. Pick a new time and retry.`);
      continue;
    }
    if (!(await hasApproval(item.id))) {
      await fail("No approval on record for this post. Send it for approval again.");
      continue;
    }
    const target = channels.get(item.channel);
    if (!target) {
      await fail(`No Postiz channel is set for ${item.channel}. Choose one on the Publishing page, then retry.`);
      continue;
    }
    const itemAssets = item.assetIds.length ? await db.select({ id: assets.id, type: assets.type }).from(assets).where(inArray(assets.id, item.assetIds)) : [];
    const check = checkPost({
      channel: item.channel,
      format: item.format,
      caption: item.caption,
      title: item.title,
      assets: itemAssets.map((a) => ({ type: a.type as "image" | "video" })),
      settings: item.settings,
      bannedPhrases: kit?.bannedPhrases ?? [],
    });
    if (check.errors.length) {
      await fail(`Blocked by post checks: ${check.errors.join(" ")}`);
      continue;
    }
    if (budget <= 0) {
      notes.push("Postiz's hourly limit is used up; the rest go out on the next run.");
      break;
    }

    try {
      const media = await mediaFor(creds, item);
      const payload = buildPostPayload(item, { id: target.postizIntegrationId, identifier: target.postizIdentifier }, media, now);
      budget--;
      let result;
      try {
        result = await createPost(creds, payload);
        await db.insert(postizCalls).values({ endpoint: "create", calendarItemId: item.id, ok: true });
      } catch (e) {
        await db.insert(postizCalls).values({ endpoint: "create", calendarItemId: item.id, ok: false });
        throw e;
      }
      const postId = result[0]?.postId;
      if (!postId) throw new Error("Postiz didn't return a post ID.");
      await setItem(item.id, { status: "scheduled", postizId: postId, error: null, publishAttempts: item.publishAttempts + 1 });
      scheduled++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = e instanceof PostizError ? e.retryable : false;
      await fail(msg, !retryable);
    }
  }

  // 3. Read back what Postiz did with posts whose time has come.
  const live = await db
    .select()
    .from(calendarItems)
    .where(and(eq(calendarItems.status, "scheduled"), isNotNull(calendarItems.postizId), lte(calendarItems.scheduledAt, now)));
  if (live.length) {
    const from = new Date(Math.min(...live.map((i) => i.scheduledAt.getTime())) - 86_400_000);
    const posts = await listPosts(creds, from, new Date(now.getTime() + 86_400_000));
    const byId = new Map(posts.map((p) => [p.id, p]));
    for (const item of live) {
      const p = byId.get(item.postizId!);
      if (!p) continue;
      if (p.state === "PUBLISHED") {
        await setItem(item.id, { status: "published", publishedUrl: p.releaseURL ?? null, publishedAt: new Date(p.publishDate), error: null });
        published++;
      } else if (p.state === "ERROR") {
        await setItem(item.id, { status: "failed", error: p.error ?? "The platform rejected the post. See Postiz for details." });
        failed++;
      }
    }
  }

  const detail = [
    scheduled && `scheduled ${scheduled}`,
    published && `published ${published}`,
    failed && `failed ${failed}`,
    removed && `removed ${removed} from Postiz`,
  ]
    .filter(Boolean)
    .join(", ");
  return { status: "succeeded", detail: `${detail ? detail.charAt(0).toUpperCase() + detail.slice(1) : "Nothing to do"}.${notes.length ? ` ${notes.join(" ")}` : ""}`, rows: scheduled + published };
}


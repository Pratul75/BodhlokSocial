/**
 * Tools for the Community, Mentions and Analyst agents. As with every agent, nothing public happens
 * from here: answers and listings go to Approvals (kinds "reply" and "listing"), and reports are
 * internal.
 */
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { adChanges, approvals, auditLog, calendarItems, communityItems, db, directoryListings, leads, reports } from "@bodh/db";
import { checkCommunityReply, checkListing } from "@bodh/guardrails/community";
import { redditAccess, searchSubreddit } from "@bodh/integrations/reddit";
import { myChannel, recentComments, youtubeToken } from "@bodh/integrations/youtube";
import type { ToolContext } from "./tools";

export const MAX_REPLIES_PER_RUN = 8;
export const MAX_LISTINGS_PER_RUN = 6;

const json = (v: unknown) => JSON.stringify(v, null, 1);
const IST = 330 * 60_000;
const istDate = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);

async function audit(ctx: ToolContext, action: string, target: string, result: string, reason?: string) {
  await db.insert(auditLog).values({ actor: `${ctx.agent} agent`, actorType: "agent", action, target: target.slice(0, 200), reason: reason ?? null, result });
}

/** Withdraws pending approvals of one kind that point at the same item, so only the newest draft waits. */
async function withdrawPending(kind: "reply" | "listing", key: "communityItemId" | "listingId", id: string) {
  await db
    .update(approvals)
    .set({ status: "withdrawn", decidedAt: new Date(), decisionNote: "Replaced by a new draft" })
    .where(and(eq(approvals.kind, kind), eq(approvals.status, "pending"), sql`${approvals.payload}->>${key} = ${id}`));
}

/* ---------- Community agent ---------- */

export function communityTools(ctx: ToolContext) {
  const known = async (platform: string, ids: string[]) => {
    if (!ids.length) return new Set<string>();
    const rows = await db.select({ id: communityItems.externalId }).from(communityItems).where(and(eq(communityItems.platform, platform), inArray(communityItems.externalId, ids)));
    return new Set(rows.map((r) => r.id));
  };

  const findReddit = betaZodTool({
    name: "find_reddit_questions",
    description:
      "Search one subreddit for recent posts matching a query (last month, newest first). Returns posts not already saved, with id (t3_...), title, text and comment count. Good places: vedicastrology, Jyotish, astrology, AstrologyChartShare, KPastrology, plus learners' subs. Skip locked posts and anything that is a request for a personal reading.",
    inputSchema: z.object({ subreddit: z.string().regex(/^[A-Za-z0-9_]{2,21}$/), query: z.string().min(2).max(120) }),
    run: async ({ subreddit, query }) => {
      const access = await redditAccess();
      if (!access) return json({ note: "Reddit isn't connected. Find questions with web search instead and save them with their URL, or skip Reddit this run." });
      const posts = (await searchSubreddit(access, subreddit, query)).filter((p) => !p.locked && Date.now() - p.createdAt.getTime() < 30 * 86_400_000);
      const seen = await known("reddit", posts.map((p) => p.id));
      const fresh = posts.filter((p) => !seen.has(p.id));
      return json(fresh.length ? fresh.map((p) => ({ id: p.id, subreddit: p.subreddit, title: p.title, text: p.text.slice(0, 800), url: p.url, comments: p.comments, posted: istDate(p.createdAt) })) : { note: "Nothing new for that search." });
    },
  });

  const findYouTube = betaZodTool({
    name: "find_youtube_questions",
    description: "Recent comments on BODH's YouTube videos that the channel hasn't replied to yet. Returns comment id, video id, author and text. Only questions and real points deserve an answer; skip praise and spam.",
    inputSchema: z.object({}),
    run: async () => {
      const token = await youtubeToken();
      if (!token) return json({ note: "YouTube comments aren't connected." });
      const channel = await myChannel(token);
      if (!channel) return json({ note: "The connected Google account has no YouTube channel." });
      const comments = (await recentComments(token, channel.id, 80)).filter((c) => !c.answeredByChannel);
      const seen = await known("youtube", comments.map((c) => c.threadId));
      const fresh = comments.filter((c) => !seen.has(c.threadId));
      return json(fresh.length ? fresh.map((c) => ({ id: c.threadId, video: c.videoId, author: c.author, text: c.text.slice(0, 800), url: c.url, posted: istDate(c.publishedAt) })) : { note: "No unanswered comments." });
    },
  });

  const save = betaZodTool({
    name: "save_question",
    description:
      "Save a question worth answering. For Reddit and YouTube pass the id the find tools returned as external_id; for Quora (found with web search) pass the question's URL. Say in `why` what the asker needs and why the team can genuinely help.",
    inputSchema: z.object({
      platform: z.enum(["reddit", "youtube", "quora"]),
      url: z.url(),
      external_id: z.string().max(200).optional(),
      place: z.string().max(120).describe("Subreddit, video title or Quora topic"),
      question: z.string().min(10).max(600),
      why: z.string().min(20).max(400),
    }),
    run: async (p) => {
      if (p.platform !== "quora" && !p.external_id) return "Error: Reddit and YouTube questions need the external_id from the find tool.";
      const externalId = p.external_id ?? p.url;
      const [row] = await db
        .insert(communityItems)
        .values({ platform: p.platform, url: p.url, externalId, place: p.place, question: p.question, why: p.why, status: "found", runId: ctx.runId })
        .onConflictDoNothing({ target: [communityItems.platform, communityItems.externalId] })
        .returning({ id: communityItems.id });
      if (!row) return "Already saved earlier; nothing to do.";
      await audit(ctx, "save_question", p.question, "found", p.platform);
      return `Saved as ${row.id}. Draft an answer with draft_answer, or skip_question if it turns out not to fit.`;
    },
  });

  const draft = betaZodTool({
    name: "draft_answer",
    description:
      "Draft the answer to a saved question and send it to Approvals. Answer the question itself first, in plain words, the way a knowledgeable astrologer would. Mention Bodhlok only when it genuinely helps, and then always with a disclosure such as \"Disclosure: I work on Bodhlok.\" Never pose as a user, never give a personal prediction. The answer is checked; if it returns an error, fix it and call again.",
    inputSchema: z.object({ item_id: z.uuid(), answer: z.string().min(40).max(9000) }),
    run: async ({ item_id, answer }) => {
      if (ctx.drafts >= MAX_REPLIES_PER_RUN) return `Error: this run has drafted ${MAX_REPLIES_PER_RUN} answers, the limit. Stop and summarise.`;
      const [item] = await db.select().from(communityItems).where(eq(communityItems.id, item_id)).limit(1);
      if (!item) return "Error: no saved question with that id.";
      if (["posted", "approved", "in_review"].includes(item.status)) return `Error: that question is already ${item.status.replace("_", " ")}.`;
      const check = checkCommunityReply(answer, item.platform as "reddit" | "youtube" | "quora");
      if (check.errors.length) return `Error: fix these and call again: ${check.errors.join(" ")}`;
      await withdrawPending("reply", "communityItemId", item.id);
      const [appr] = await db
        .insert(approvals)
        .values({
          kind: "reply",
          channel: item.platform,
          agent: ctx.agent,
          title: item.question.slice(0, 200),
          body: answer,
          reason: item.why ?? "Community question",
          payload: { communityItemId: item.id, platform: item.platform, url: item.url, place: item.place, warnings: check.warnings },
          sourceRunId: ctx.runId,
        })
        .returning({ id: approvals.id });
      await db.update(communityItems).set({ draft: answer, status: "in_review", approvalId: appr!.id, reviewNote: null, updatedAt: new Date() }).where(eq(communityItems.id, item.id));
      ctx.drafts++;
      await audit(ctx, "draft_answer", item.question, "sent_to_approval", item.platform);
      return `Sent to Approvals.${check.warnings.length ? ` Reviewer will see these notes: ${check.warnings.join(" ")}` : ""}`;
    },
  });

  const skip = betaZodTool({
    name: "skip_question",
    description: "Mark a saved question as not worth answering (a request for a personal reading, off-topic, already answered well, or the thread forbids promotion).",
    inputSchema: z.object({ item_id: z.uuid(), reason: z.string().min(5).max(300) }),
    run: async ({ item_id, reason }) => {
      const r = await db.update(communityItems).set({ status: "skipped", error: reason, updatedAt: new Date() }).where(and(eq(communityItems.id, item_id), inArray(communityItems.status, ["found", "drafted"]))).returning({ id: communityItems.id });
      return r.length ? "Skipped." : "Error: only a found or drafted question can be skipped.";
    },
  });

  const list = betaZodTool({
    name: "list_community",
    description: "Saved questions by status. Check 'drafted' first: those were sent back by a reviewer and carry a review_note to act on.",
    inputSchema: z.object({ status: z.enum(["found", "drafted", "in_review", "posted", "skipped", "failed"]).default("drafted"), limit: z.number().int().min(1).max(30).default(15) }),
    run: async ({ status, limit }) => {
      const rows = await db.select().from(communityItems).where(eq(communityItems.status, status)).orderBy(desc(communityItems.foundAt)).limit(limit);
      return json(rows.map((r) => ({ id: r.id, platform: r.platform, place: r.place, question: r.question, why: r.why, draft: r.draft, review_note: r.reviewNote, url: r.url })));
    },
  });

  return [findReddit, findYouTube, save, draft, skip, list];
}

/* ---------- Mentions agent ---------- */

const CATEGORIES = ["software_directory", "review_site", "best_of_list", "association", "other"] as const;

export function mentionsTools(ctx: ToolContext) {
  const list = betaZodTool({
    name: "list_directories",
    description: "Directories and lists already tracked, by status. 'drafted' ones were sent back by a reviewer with a review_note.",
    inputSchema: z.object({ status: z.enum(["found", "drafted", "in_review", "approved", "submitted", "skipped"]).optional() }),
    run: async ({ status }) => {
      const rows = await db
        .select()
        .from(directoryListings)
        .where(status ? eq(directoryListings.status, status) : undefined)
        .orderBy(desc(directoryListings.foundAt))
        .limit(60);
      return json(rows.map((r) => ({ id: r.id, name: r.name, url: r.url, category: r.category, status: r.status, review_note: r.reviewNote })));
    },
  });

  const save = betaZodTool({
    name: "save_directory",
    description:
      "Track a place Bodhlok should be listed: astrology software directories, SaaS review sites, \"best astrology software\" articles that accept submissions, Jyotish associations' resource pages. Only real places that take listings; never review-exchange schemes or link farms.",
    inputSchema: z.object({ name: z.string().min(2).max(120), url: z.url(), category: z.enum(CATEGORIES), why: z.string().min(20).max(400) }),
    run: async (p) => {
      const [row] = await db
        .insert(directoryListings)
        .values({ name: p.name, url: p.url, category: p.category, why: p.why, runId: ctx.runId })
        .onConflictDoNothing({ target: directoryListings.url })
        .returning({ id: directoryListings.id });
      if (!row) return "Already tracked.";
      await audit(ctx, "save_directory", p.name, "found", p.url);
      return `Saved as ${row.id}.`;
    },
  });

  const draft = betaZodTool({
    name: "draft_listing",
    description: "Write the listing for a tracked directory and send it to Approvals. A person submits it by hand after approval. Describe what the software does, plainly; no superlatives, no promises.",
    inputSchema: z.object({
      listing_id: z.uuid(),
      title: z.string().min(2).max(80),
      tagline: z.string().min(10).max(120),
      description: z.string().min(80).max(2500),
      categories: z.array(z.string().min(2).max(60)).max(6).default([]),
      notes: z.string().max(600).optional().describe("Anything the person submitting needs: account to use, screenshots to attach, fields the form asks for"),
    }),
    run: async (p) => {
      if (ctx.drafts >= MAX_LISTINGS_PER_RUN) return `Error: this run has drafted ${MAX_LISTINGS_PER_RUN} listings, the limit. Stop and summarise.`;
      const [l] = await db.select().from(directoryListings).where(eq(directoryListings.id, p.listing_id)).limit(1);
      if (!l) return "Error: no tracked directory with that id.";
      if (["in_review", "approved", "submitted"].includes(l.status)) return `Error: that listing is already ${l.status.replace("_", " ")}.`;
      const check = checkListing(p);
      if (check.errors.length) return `Error: fix these and call again: ${check.errors.join(" ")}`;
      const draftData = { title: p.title, tagline: p.tagline, description: p.description, categories: p.categories, notes: p.notes ?? null };
      await withdrawPending("listing", "listingId", l.id);
      const [appr] = await db
        .insert(approvals)
        .values({
          kind: "listing",
          channel: "directory",
          agent: ctx.agent,
          title: `${l.name}: ${p.title}`,
          body: `${p.tagline}\n\n${p.description}${p.categories.length ? `\n\nCategories: ${p.categories.join(", ")}` : ""}${p.notes ? `\n\nFor the person submitting: ${p.notes}` : ""}`,
          reason: l.why,
          payload: { listingId: l.id, url: l.url, warnings: check.warnings },
          sourceRunId: ctx.runId,
        })
        .returning({ id: approvals.id });
      await db.update(directoryListings).set({ draft: draftData, status: "in_review", approvalId: appr!.id, reviewNote: null, updatedAt: new Date() }).where(eq(directoryListings.id, l.id));
      ctx.drafts++;
      await audit(ctx, "draft_listing", l.name, "sent_to_approval", l.url);
      return "Sent to Approvals.";
    },
  });

  const skip = betaZodTool({
    name: "skip_directory",
    description: "Stop tracking a directory (paid placement only, irrelevant audience, or it no longer takes listings).",
    inputSchema: z.object({ listing_id: z.uuid(), reason: z.string().min(5).max(300) }),
    run: async ({ listing_id, reason }) => {
      const r = await db.update(directoryListings).set({ status: "skipped", reviewNote: reason, updatedAt: new Date() }).where(and(eq(directoryListings.id, listing_id), inArray(directoryListings.status, ["found", "drafted"]))).returning({ id: directoryListings.id });
      return r.length ? "Skipped." : "Error: only a found or drafted listing can be skipped.";
    },
  });

  return [list, save, draft, skip];
}

/* ---------- Analyst agent ---------- */

export function analystTools(ctx: ToolContext) {
  const activity = betaZodTool({
    name: "get_activity",
    description: "What the team and the agents did in the last N days: posts published and failed, approvals decided and waiting, ad changes by outcome, agent runs and AI spend, leads received by status, community answers and listings.",
    inputSchema: z.object({ days: z.number().int().min(1).max(62) }),
    run: async ({ days }) => {
      const since = new Date(Date.now() - days * 86_400_000);
      // Raw SQL gets the time as text: the postgres driver doesn't serialise a Date there.
      const sinceTs = sql`${since.toISOString()}::timestamptz`;
      const grouped = async (table: typeof calendarItems | typeof approvals | typeof adChanges | typeof leads | typeof communityItems, statusCol: unknown, timeCol: unknown) =>
        (await db.execute(sql`SELECT ${statusCol} AS status, count(*)::int AS n FROM ${table} WHERE ${timeCol} >= ${sinceTs} GROUP BY 1 ORDER BY 2 DESC`)) as unknown as { status: string; n: number }[];
      const [posts, appr, changes, leadRows, community, runs] = await Promise.all([
        grouped(calendarItems, calendarItems.status, calendarItems.scheduledAt),
        grouped(approvals, approvals.status, approvals.createdAt),
        grouped(adChanges, adChanges.outcome, adChanges.createdAt),
        grouped(leads, leads.status, leads.createdAt),
        grouped(communityItems, communityItems.status, communityItems.foundAt),
        db.execute(sql`SELECT agent, count(*)::int AS runs, count(*) FILTER (WHERE status = 'failed')::int AS failed, round(sum(cost_usd)::numeric, 2)::float AS usd FROM agent_runs WHERE started_at >= ${sinceTs} GROUP BY 1 ORDER BY 4 DESC`),
      ]);
      const [listings] = await db.select({ n: count() }).from(directoryListings).where(and(eq(directoryListings.status, "submitted"), gte(directoryListings.submittedAt, since)));
      return json({ days, posts_by_status: posts, approvals_by_status: appr, ad_changes_by_outcome: changes, leads_by_status: leadRows, community_by_status: community, listings_submitted: listings?.n ?? 0, agent_runs: runs });
    },
  });

  const previous = betaZodTool({
    name: "get_previous_reports",
    description: "The last few reports of a kind, to compare against and to follow up on what they said to watch.",
    inputSchema: z.object({ kind: z.enum(["weekly", "monthly"]), limit: z.number().int().min(1).max(6).default(2) }),
    run: async ({ kind, limit }) => {
      const rows = await db.select().from(reports).where(eq(reports.kind, kind)).orderBy(desc(reports.periodStart)).limit(limit);
      return json(rows.length ? rows.map((r) => ({ period: `${r.periodStart} to ${r.periodEnd}`, title: r.title, body: r.body.slice(0, 3000), metrics: r.metrics })) : { note: "No earlier reports." });
    },
  });

  const save = betaZodTool({
    name: "save_report",
    description:
      "Save the report. Body is Markdown for the team: the headline (activated users and cost per activated user against the previous period), what moved and why, by channel, what the agents and the team did, what to change next week or month, and anything broken (failed posts, jobs, connections). Saving again for the same period replaces it. metrics holds the headline numbers.",
    inputSchema: z.object({
      kind: z.enum(["weekly", "monthly"]),
      period_start: z.iso.date(),
      period_end: z.iso.date(),
      title: z.string().min(10).max(140),
      body: z.string().min(200).max(20000),
      metrics: z.object({
        activations: z.number().int().min(0),
        activations_prev: z.number().int().min(0).optional(),
        spend_inr: z.number().min(0),
        cost_per_activated_inr: z.number().min(0).nullable(),
        registrations: z.number().int().min(0).optional(),
        paid: z.number().int().min(0).optional(),
      }),
    }),
    run: async (p) => {
      if (p.period_end < p.period_start) return "Error: the period ends before it starts.";
      await db
        .insert(reports)
        .values({ kind: p.kind, periodStart: p.period_start, periodEnd: p.period_end, title: p.title, body: p.body, metrics: p.metrics, runId: ctx.runId })
        .onConflictDoUpdate({ target: [reports.kind, reports.periodStart], set: { periodEnd: p.period_end, title: p.title, body: p.body, metrics: p.metrics, runId: ctx.runId, createdAt: new Date() } });
      ctx.drafts++;
      await audit(ctx, "save_report", `${p.kind} report ${p.period_start}`, "saved");
      return "Saved. It shows on Today and Analytics.";
    },
  });

  return [activity, previous, save];
}

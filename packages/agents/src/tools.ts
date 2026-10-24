import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { auditLog, brandKit, calendarItems, creativePerformance, db, keywords, strategyPlans } from "@bodh/db";
import { checkPost, isPublishChannel } from "@bodh/guardrails/posts";
import { channelLabel } from "@bodh/shared";

/** What a tool knows about the run it belongs to. */
export interface ToolContext {
  agent: string; // strategy | content | chat
  runId: string;
  drafts: number; // posts created this run
}

export const MAX_DRAFTS_PER_RUN = 21;

const IST_OFFSET_MS = 330 * 60_000;
const istDate = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
const daysAgoIso = (n: number) => istDate(new Date(Date.now() - n * 86_400_000));
const json = (v: unknown) => JSON.stringify(v, null, 1);

async function audit(ctx: ToolContext, action: string, target: string, result: string, reason?: string) {
  await db.insert(auditLog).values({ actor: `${ctx.agent} agent`, actorType: "agent", action, target, reason: reason ?? null, result });
}

/* ---------- read tools, shared by every agent ---------- */

async function funnelFor(from: string, to: string) {
  return (await db.execute(sql`
    SELECT channel, sum(spend)::int AS spend, sum(clicks)::int AS clicks, sum(registrations)::int AS registrations,
      sum(activations)::int AS activations, sum(paid)::int AS paid
    FROM funnel_daily WHERE day BETWEEN ${from}::date AND ${to}::date GROUP BY channel ORDER BY 5 DESC`)) as unknown as {
    channel: string;
    spend: number;
    clicks: number;
    registrations: number;
    activations: number;
    paid: number;
  }[];
}

export function readTools(_ctx: ToolContext) {
  const getFunnel = betaZodTool({
    name: "get_funnel",
    description:
      "Registrations, activations (first chart generated), paid conversions, spend and clicks per channel for the last N days ending yesterday (India time), with the previous N days for comparison and cost per activated user. Spend is INR. Use it before judging any channel.",
    inputSchema: z.object({ days: z.number().int().min(1).max(90).describe("Length of the period in days, e.g. 7 or 28") }),
    run: async ({ days }) => {
      const cur = await funnelFor(daysAgoIso(days), daysAgoIso(1));
      const prev = await funnelFor(daysAgoIso(days * 2), daysAgoIso(days + 1));
      const sum = (rows: typeof cur) =>
        rows.reduce((t, r) => ({ spend: t.spend + r.spend, registrations: t.registrations + r.registrations, activations: t.activations + r.activations, paid: t.paid + r.paid }), {
          spend: 0,
          registrations: 0,
          activations: 0,
          paid: 0,
        });
      const total = sum(cur);
      if (total.registrations === 0 && total.spend === 0) {
        return json({ days, note: "No funnel data yet. Tracking may not be connected; say so rather than inventing numbers." });
      }
      return json({
        days,
        period: { from: daysAgoIso(days), to: daysAgoIso(1) },
        total: { ...total, cost_per_activated_inr: total.activations ? Math.round(total.spend / total.activations) : null },
        previous_period_total: sum(prev),
        by_channel: cur.map((r) => ({
          ...r,
          channel: channelLabel(r.channel),
          cost_per_activated_inr: r.spend && r.activations ? Math.round(r.spend / r.activations) : null,
        })),
      });
    },
  });

  const getTopAds = betaZodTool({
    name: "get_top_ads",
    description: "Paid ads with spend, clicks, registrations and activations for the last N days, most spend first. Registrations are matched to ads by utm_content.",
    inputSchema: z.object({ days: z.number().int().min(1).max(90), limit: z.number().int().min(1).max(30).default(15) }),
    run: async ({ days, limit }) => {
      const rows = await creativePerformance(daysAgoIso(days), daysAgoIso(1), limit);
      if (rows.length === 0) return json({ note: "No ad spend loaded yet." });
      return json(rows.map((r) => ({ ...r, cost_per_activated_inr: r.activations ? Math.round(r.spend / r.activations) : null })));
    },
  });

  const getCalendar = betaZodTool({
    name: "get_calendar",
    description: "Calendar posts between two dates (YYYY-MM-DD, inclusive), with channel, format, idea, status and the start of the caption. Check this before drafting so you don't double-book a slot or repeat an idea.",
    inputSchema: z.object({ from: z.iso.date(), to: z.iso.date() }),
    run: async ({ from, to }) => {
      const rows = await db
        .select()
        .from(calendarItems)
        .where(and(gte(calendarItems.scheduledAt, new Date(`${from}T00:00:00+05:30`)), lte(calendarItems.scheduledAt, new Date(`${to}T23:59:59+05:30`))))
        .orderBy(asc(calendarItems.scheduledAt))
        .limit(200);
      return json(
        rows.map((r) => ({
          id: r.id,
          when_ist: new Date(r.scheduledAt.getTime() + IST_OFFSET_MS).toISOString().slice(0, 16).replace("T", " "),
          channel: r.channel,
          format: r.format,
          idea: r.idea,
          status: r.status,
          caption_start: r.caption?.slice(0, 160) ?? null,
        })),
      );
    },
  });

  const getRecentPosts = betaZodTool({
    name: "get_recent_posts",
    description: "Posts published in the last N days, with captions and links. Per-post reach and engagement aren't tracked yet.",
    inputSchema: z.object({ days: z.number().int().min(1).max(90) }),
    run: async ({ days }) => {
      const rows = await db
        .select()
        .from(calendarItems)
        .where(and(eq(calendarItems.status, "published"), gte(calendarItems.scheduledAt, new Date(Date.now() - days * 86_400_000))))
        .orderBy(desc(calendarItems.scheduledAt))
        .limit(60);
      if (rows.length === 0) return json({ note: "Nothing published in this period." });
      return json(rows.map((r) => ({ when: istDate(r.scheduledAt), channel: r.channel, format: r.format, idea: r.idea, caption: r.caption, url: r.publishedUrl })));
    },
  });

  const getBrandKit = betaZodTool({
    name: "get_brand_kit",
    description: "The brand kit: caption voice, banned phrases, default hashtags, palette and image style. Banned phrases block approval, so never use them.",
    inputSchema: z.object({}),
    run: async () => {
      const [k] = await db.select().from(brandKit).limit(1);
      return json(k ? { voice: k.voice, banned_phrases: k.bannedPhrases, default_hashtags: k.defaultHashtags, palette: k.palette, image_style: k.imageStyle } : { note: "No brand kit set yet." });
    },
  });

  const getStrategyPlan = betaZodTool({
    name: "get_strategy_plan",
    description: "The monthly strategy plan (summary, content pillars with shares, bets with targets) for a month, or the latest one if no month is given.",
    inputSchema: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("YYYY-MM") }),
    run: async ({ month }) => {
      const [p] = month
        ? await db.select().from(strategyPlans).where(eq(strategyPlans.month, `${month}-01`)).orderBy(desc(strategyPlans.createdAt)).limit(1)
        : await db.select().from(strategyPlans).orderBy(desc(strategyPlans.month), desc(strategyPlans.createdAt)).limit(1);
      return json(p ? { month: p.month.slice(0, 7), status: p.status, summary: p.summary, pillars: p.pillars, bets: p.bets } : { note: "No strategy plan yet." });
    },
  });

  const getKeywords = betaZodTool({
    name: "get_keywords",
    description: "Tracked search keywords with monthly volume, difficulty, intent and BODH's current Google position (null means not ranking).",
    inputSchema: z.object({}),
    run: async () => {
      const rows = await db.select().from(keywords).orderBy(desc(keywords.volume)).limit(100);
      return json(rows.length ? rows.map(({ id: _id, ...k }) => k) : { note: "No keywords tracked yet." });
    },
  });

  return [getFunnel, getTopAds, getCalendar, getRecentPosts, getBrandKit, getStrategyPlan, getKeywords];
}

/* ---------- strategy agent ---------- */

export function strategyTools(ctx: ToolContext) {
  const savePlan = betaZodTool({
    name: "save_strategy_plan",
    description:
      "Save the monthly plan as a draft for the team to edit and approve. Shares across pillars must add up to 100. Each bet names one metric and a target. Saving again replaces your earlier draft for that month; an approved plan can't be replaced.",
    inputSchema: z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/).describe("YYYY-MM, this month or next"),
      summary: z.string().min(40).max(1200).describe("Two to four sentences: the month's main moves and why, citing the numbers that drove them"),
      pillars: z
        .array(z.object({ name: z.string().min(3).max(80), share: z.number().int().min(5).max(70), why: z.string().min(10).max(240) }))
        .min(2)
        .max(6),
      bets: z.array(z.object({ title: z.string().min(5).max(140), metric: z.string().min(3).max(100), target: z.string().min(1).max(60) })).min(1).max(5),
    }),
    run: async (p) => {
      const total = p.pillars.reduce((s, x) => s + x.share, 0);
      if (total !== 100) return `Error: pillar shares add up to ${total}, not 100. Adjust and save again.`;
      const now = new Date(Date.now() + IST_OFFSET_MS);
      const thisMonth = now.toISOString().slice(0, 7);
      const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
      if (p.month !== thisMonth && p.month !== next) return `Error: plan for ${thisMonth} or ${next} only.`;
      const monthDate = `${p.month}-01`;
      const existing = await db.select().from(strategyPlans).where(eq(strategyPlans.month, monthDate));
      if (existing.some((e) => e.status === "approved")) return `Error: the ${p.month} plan is already approved. Don't replace it; mention your suggestions in your reply instead.`;
      if (existing.length) await db.delete(strategyPlans).where(and(eq(strategyPlans.month, monthDate), eq(strategyPlans.status, "draft")));
      await db.insert(strategyPlans).values({ month: monthDate, status: "draft", summary: p.summary, pillars: p.pillars, bets: p.bets });
      await audit(ctx, "save_strategy_plan", `Plan for ${p.month}`, "draft saved");
      return `Saved the ${p.month} plan as a draft. The team will review it on the Strategy page.`;
    },
  });
  return [savePlan];
}

/* ---------- content agent ---------- */

/** Media rules: a person attaches the media later, so these don't block a draft. */
const MEDIA_RULES = /\bneeds? (an image|exactly one video)|\b(reel|carousel|story) needs\b|allows (one video|up to 9 images)/i;

export function contentTools(ctx: ToolContext) {
  const createDraft = betaZodTool({
    name: "create_draft_post",
    description:
      "Add a drafted post to the calendar. A person attaches the image or video and sends it for approval, so describe the creative in creative_brief. Captions are checked against ad-claim rules and the brand kit's banned phrases; if the tool returns an error, fix the caption and try again.",
    inputSchema: z.object({
      channel: z.enum(["instagram", "facebook", "linkedin", "youtube"]),
      format: z.enum(["reel", "short", "long_video", "image", "carousel", "post"]),
      scheduled_at: z.iso.datetime({ offset: true }).describe("When it should go out, ISO 8601 with +05:30, e.g. 2026-10-28T18:30:00+05:30"),
      idea: z.string().min(5).max(140).describe("One line the team will recognise on the calendar"),
      title: z.string().max(100).optional().describe("Required for YouTube: 2 to 100 characters"),
      script: z.string().max(4000).describe("Shot-by-shot script or slide-by-slide outline, with the hook first"),
      caption: z.string().max(2200).describe("The caption or YouTube description, ready to post"),
      creative_brief: z.string().max(1000).describe("What the image, carousel or video should show, for the creative team or the image generator"),
      needs_jyotish_review: z.boolean().describe("True when the post makes a specific astrological claim that a Jyotish expert should check"),
    }),
    run: async (p) => {
      if (ctx.drafts >= MAX_DRAFTS_PER_RUN) return `Error: this run has already drafted ${MAX_DRAFTS_PER_RUN} posts, the limit. Stop and summarise.`;
      if (!isPublishChannel(p.channel)) return "Error: unknown channel.";
      const at = new Date(p.scheduled_at);
      const soonest = Date.now() + 12 * 3_600_000;
      const latest = Date.now() + 21 * 86_400_000;
      if (at.getTime() < soonest || at.getTime() > latest) return "Error: schedule between 12 hours and 21 days from now, so there is time to make the creative and approve it.";
      if (p.channel === "youtube" && (!p.title || p.title.trim().length < 2)) return "Error: YouTube posts need a title of 2 to 100 characters.";

      const window = 2 * 3_600_000;
      const clash = await db
        .select({ idea: calendarItems.idea })
        .from(calendarItems)
        .where(and(eq(calendarItems.channel, p.channel), gte(calendarItems.scheduledAt, new Date(at.getTime() - window)), lte(calendarItems.scheduledAt, new Date(at.getTime() + window))))
        .limit(1);
      if (clash.length) return `Error: "${clash[0]!.idea}" is already on ${p.channel} within two hours of that time. Pick another slot.`;

      const [kit] = await db.select({ bannedPhrases: brandKit.bannedPhrases }).from(brandKit).limit(1);
      const check = checkPost({ channel: p.channel, format: p.format, caption: p.caption, title: p.title ?? null, assets: [], bannedPhrases: kit?.bannedPhrases ?? [] });
      const blocking = check.errors.filter((e) => !MEDIA_RULES.test(e));
      if (blocking.length) return `Error: the caption would be blocked at approval: ${blocking.join(" ")} Rewrite and try again.`;

      const [row] = await db
        .insert(calendarItems)
        .values({
          channel: p.channel,
          format: p.format,
          idea: p.idea,
          title: p.title ?? null,
          script: p.script,
          caption: p.caption,
          scheduledAt: at,
          status: "drafted",
          settings: { creative_brief: p.creative_brief, needs_jyotish_review: p.needs_jyotish_review, drafted_by: `${ctx.agent} agent`, run_id: ctx.runId },
        })
        .returning({ id: calendarItems.id });
      ctx.drafts++;
      await audit(ctx, "create_draft_post", p.idea, "drafted", `${channelLabel(p.channel)}, ${istDate(at)}`);
      const notes = check.warnings.length ? ` Warnings: ${check.warnings.join(" ")}` : "";
      return `Drafted "${p.idea}" (id ${row!.id}) for ${istDate(at)}.${notes}`;
    },
  });
  return [createDraft];
}

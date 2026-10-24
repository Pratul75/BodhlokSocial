import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { approvals, auditLog, brandKit, calendarItems, creativePerformance, db, keywords, seoPages, strategyPlans } from "@bodh/db";
import { lintAdCopy } from "@bodh/guardrails";
import { keywordIdeas, searchTrends } from "@bodh/integrations/dataforseo";
import { dataForSeoCredentials, latestAudit, nextPlannedPages } from "@bodh/integrations/seo";
import { readSkill } from "./skills";
import { checkPost, isPublishChannel } from "@bodh/guardrails/posts";
import { channelLabel } from "@bodh/shared";

/** What a tool knows about the run it belongs to. */
export interface ToolContext {
  agent: string; // strategy | content | seo | chat
  runId: string;
  drafts: number; // posts, ideas or pages created this run
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

  const readSkillTool = betaZodTool({
    name: "read_skill",
    description: "Read one of the available skills in full (listed in the system prompt), or one of its other markdown files. Read a skill before a task it covers.",
    inputSchema: z.object({ name: z.string().min(1).max(80), file: z.string().max(200).optional().describe("A file inside the skill, e.g. references/checklist.md") }),
    run: async ({ name, file }) => readSkill(name, file),
  });

  const trends = betaZodTool({
    name: "get_search_trends",
    description: "Google Trends interest in India for up to 5 search terms over a period, from DataForSEO. Values are relative: 100 is the peak across the terms asked. Use it to time content around rising topics.",
    inputSchema: z.object({
      terms: z.array(z.string().min(2).max(80)).min(1).max(5),
      period: z.enum(["past_30_days", "past_90_days", "past_12_months", "past_5_years"]).default("past_90_days"),
    }),
    run: async ({ terms, period }) => {
      const creds = await dataForSeoCredentials();
      if (!creds) return json({ note: "DataForSEO isn't connected, so there's no trend data. Use web search instead." });
      const series = await searchTrends(creds, terms, period);
      return json(
        series.map((t) => {
          const pts = t.points;
          const recent = pts.slice(-4).reduce((a, p) => a + p.value, 0) / Math.max(1, Math.min(4, pts.length));
          const earlier = pts.slice(0, 4).reduce((a, p) => a + p.value, 0) / Math.max(1, Math.min(4, pts.length));
          return { term: t.keyword, average: t.average, recent_average: Math.round(recent), start_average: Math.round(earlier), peak: pts.reduce((m, p) => (p.value > m.value ? p : m), { from: "", value: 0 }) };
        }),
      );
    },
  });

  const ideas = betaZodTool({
    name: "get_keyword_ideas",
    description: "Related Google searches in India for a few seed terms, with monthly volume, difficulty (0 to 100) and intent, from DataForSEO.",
    inputSchema: z.object({ seeds: z.array(z.string().min(2).max(80)).min(1).max(10), limit: z.number().int().min(5).max(100).default(30) }),
    run: async ({ seeds, limit }) => {
      const creds = await dataForSeoCredentials();
      if (!creds) return json({ note: "DataForSEO isn't connected." });
      return json(await keywordIdeas(creds, seeds, limit));
    },
  });

  const audit = betaZodTool({
    name: "get_site_audit",
    description: "The latest crawl of BODH's website: pages crawled, on-page score and the failing checks with example URLs.",
    inputSchema: z.object({}),
    run: async () => {
      const a = await latestAudit();
      return json(a ? { site: a.target, finished: a.finishedAt, pages_crawled: a.pagesCrawled, onpage_score: a.onpageScore, issues: a.issues } : { note: "No finished site audit yet." });
    },
  });

  const visibility = betaZodTool({
    name: "get_ai_visibility",
    description: "The latest weekly check of whether ChatGPT, Gemini, Perplexity and Claude mention Asttrolok when asked BODH's target questions, with the competitors they named instead.",
    inputSchema: z.object({}),
    run: async () => {
      const rows = await db.execute(sql`
        SELECT question, engine, mentioned, competitors, checked_at FROM ai_visibility_checks
        WHERE checked_at = (SELECT max(checked_at) FROM ai_visibility_checks) AND error IS NULL`);
      return json((rows as unknown[]).length ? rows : { note: "No visibility checks yet." });
    },
  });

  return [getFunnel, getTopAds, getCalendar, getRecentPosts, getBrandKit, getStrategyPlan, getKeywords, readSkillTool, trends, ideas, audit, visibility];
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

  const outline = betaZodTool({
    name: "outline_calendar",
    description:
      "After saving the plan, put the month's post ideas on the calendar as 'idea' items: one line each with date, channel, format and pillar. The Content agent turns them into drafts closer to the date. Call once with the whole month (up to 45 ideas); slots already taken are skipped.",
    inputSchema: z.object({
      ideas: z
        .array(
          z.object({
            date: z.iso.date(),
            time: z.string().regex(/^\d{2}:\d{2}$/).describe("IST, e.g. 19:00"),
            channel: z.enum(["instagram", "facebook", "linkedin", "youtube"]),
            format: z.enum(["reel", "short", "long_video", "image", "carousel", "post"]),
            idea: z.string().min(5).max(140),
            pillar: z.string().min(2).max(80),
          }),
        )
        .min(1)
        .max(45),
    }),
    run: async ({ ideas }) => {
      let added = 0;
      const skipped: string[] = [];
      for (const i of ideas) {
        const at = new Date(`${i.date}T${i.time}:00+05:30`);
        if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() + 3_600_000 || at.getTime() > Date.now() + 70 * 86_400_000) {
          skipped.push(`${i.date} ${i.idea} (outside the next 70 days)`);
          continue;
        }
        const window = 2 * 3_600_000;
        const [clash] = await db
          .select({ id: calendarItems.id })
          .from(calendarItems)
          .where(and(eq(calendarItems.channel, i.channel), gte(calendarItems.scheduledAt, new Date(at.getTime() - window)), lte(calendarItems.scheduledAt, new Date(at.getTime() + window))))
          .limit(1);
        if (clash) {
          skipped.push(`${i.date} ${i.channel} (slot taken)`);
          continue;
        }
        await db.insert(calendarItems).values({
          channel: i.channel,
          format: i.format,
          idea: i.idea,
          scheduledAt: at,
          status: "idea",
          settings: { pillar: i.pillar, planned_by: `${ctx.agent} agent`, run_id: ctx.runId },
        });
        added++;
      }
      ctx.drafts += added;
      await audit(ctx, "outline_calendar", `${added} ideas`, "added");
      return `Added ${added} ideas to the calendar.${skipped.length ? ` Skipped: ${skipped.slice(0, 10).join("; ")}.` : ""}`;
    },
  });
  return [savePlan, outline];
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
      idea_id: z.uuid().optional().describe("The id of an 'idea' item on the calendar this draft fills; it keeps its slot unless you change scheduled_at"),
    }),
    run: async (p) => {
      if (ctx.drafts >= MAX_DRAFTS_PER_RUN) return `Error: this run has already drafted ${MAX_DRAFTS_PER_RUN} posts, the limit. Stop and summarise.`;
      if (!isPublishChannel(p.channel)) return "Error: unknown channel.";
      const at = new Date(p.scheduled_at);
      const soonest = Date.now() + 12 * 3_600_000;
      const latest = Date.now() + 21 * 86_400_000;
      if (at.getTime() < soonest || at.getTime() > latest) return "Error: schedule between 12 hours and 21 days from now, so there is time to make the creative and approve it.";
      if (p.channel === "youtube" && (!p.title || p.title.trim().length < 2)) return "Error: YouTube posts need a title of 2 to 100 characters.";

      let idea: typeof calendarItems.$inferSelect | undefined;
      if (p.idea_id) {
        [idea] = await db.select().from(calendarItems).where(eq(calendarItems.id, p.idea_id)).limit(1);
        if (!idea || idea.status !== "idea") return "Error: that calendar item isn't an open idea any more. Check the calendar again.";
      }
      const window = 2 * 3_600_000;
      const clash = await db
        .select({ id: calendarItems.id, idea: calendarItems.idea })
        .from(calendarItems)
        .where(and(eq(calendarItems.channel, p.channel), gte(calendarItems.scheduledAt, new Date(at.getTime() - window)), lte(calendarItems.scheduledAt, new Date(at.getTime() + window))))
        .limit(2);
      const other = clash.find((c) => c.id !== p.idea_id);
      if (other) return `Error: "${other.idea}" is already on ${p.channel} within two hours of that time. Pick another slot.`;

      const [kit] = await db.select({ bannedPhrases: brandKit.bannedPhrases }).from(brandKit).limit(1);
      const check = checkPost({ channel: p.channel, format: p.format, caption: p.caption, title: p.title ?? null, assets: [], bannedPhrases: kit?.bannedPhrases ?? [] });
      const blocking = check.errors.filter((e) => !MEDIA_RULES.test(e));
      if (blocking.length) return `Error: the caption would be blocked at approval: ${blocking.join(" ")} Rewrite and try again.`;

      const values = {
        channel: p.channel,
        format: p.format,
        idea: p.idea,
        title: p.title ?? null,
        script: p.script,
        caption: p.caption,
        scheduledAt: at,
        status: "drafted",
        settings: { ...(idea?.settings ?? {}), creative_brief: p.creative_brief, needs_jyotish_review: p.needs_jyotish_review, drafted_by: `${ctx.agent} agent`, run_id: ctx.runId },
        updatedAt: new Date(),
      };
      const [row] = idea
        ? await db.update(calendarItems).set(values).where(and(eq(calendarItems.id, idea.id), eq(calendarItems.status, "idea"))).returning({ id: calendarItems.id })
        : await db.insert(calendarItems).values(values).returning({ id: calendarItems.id });
      if (!row) return "Error: that idea was changed by someone a moment ago. Check the calendar again.";
      ctx.drafts++;
      await audit(ctx, "create_draft_post", p.idea, "drafted", `${channelLabel(p.channel)}, ${istDate(at)}`);
      const notes = check.warnings.length ? ` Warnings: ${check.warnings.join(" ")}` : "";
      return `Drafted "${p.idea}" (id ${row!.id}) for ${istDate(at)}.${notes}`;
    },
  });
  return [createDraft];
}

/* ---------- SEO agent ---------- */

export const MAX_PAGES_PER_RUN = 25;

const PageContent = {
  title: z.string().min(10).max(70).describe("The page title, under 60 characters if you can, main keyword first"),
  description: z.string().min(70).max(160).describe("Meta description, 120 to 155 characters"),
  answer: z.string().min(150).max(520).describe("The direct answer block at the top: 40 to 70 words that answer the main question on their own, so search engines and AI assistants can quote it"),
  body: z.string().min(1500).max(14000).describe("The page in Markdown, 600 to 1,500 words, with ## headings, no H1 (the title is the H1). End with a short call to action to try BODH."),
  faq: z.array(z.object({ q: z.string().min(10).max(160), a: z.string().min(30).max(600) })).min(3).max(6).describe("Questions people actually search, answered in 1 to 3 sentences each"),
  brief: z.string().min(40).max(1500).describe("Your brief for this page: search intent, the angle, what it must cover, internal links to suggest"),
  needs_jyotish_review: z.boolean().describe("True unless the page makes no astrological claims"),
};

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

function contentProblems(p: { answer: string; body: string; title: string; description: string; faq: { q: string; a: string }[] }, banned: string[]): string[] {
  const out: string[] = [];
  const n = words(p.answer);
  if (n < 35 || n > 80) out.push(`The answer block is ${n} words; make it 40 to 70.`);
  if (/^#\s/m.test(p.body)) out.push("Don't use a single-# H1 in the body; start at ##.");
  const all = [p.title, p.description, p.answer, p.body, ...p.faq.flatMap((f) => [f.q, f.a])].join("\n");
  for (const issue of lintAdCopy(all)) out.push(`"${issue.match}": ${issue.why.toLowerCase()} aren't allowed.`);
  for (const b of banned) if (b && all.toLowerCase().includes(b.toLowerCase())) out.push(`"${b}" is on the brand kit's banned list.`);
  return out;
}

async function sendPageForApproval(ctx: ToolContext, page: typeof seoPages.$inferSelect, reason: string) {
  await db
    .update(approvals)
    .set({ status: "withdrawn", decidedAt: new Date(), decisionNote: "Replaced by a new draft" })
    .where(and(eq(approvals.kind, "page"), eq(approvals.status, "pending"), sql`${approvals.payload}->>'seoPageId' = ${page.id}`));
  await db.insert(approvals).values({
    kind: "page",
    channel: "website",
    agent: ctx.agent,
    title: page.title,
    body: page.body ?? "",
    reason,
    sourceRunId: ctx.runId,
    payload: { seoPageId: page.id, template: page.template, slug: page.slug, answer: page.answer, description: page.description, faq: page.faq, needsJyotishReview: page.needsReview },
  });
}

export function seoTools(ctx: ToolContext) {
  const listPages = betaZodTool({
    name: "list_pages_to_write",
    description: "Planned programmatic pages that have no draft yet, highest search volume first: id, template, title, target keyword and the template's inputs (planet and house, nakshatra, yoga rule, lagna, city).",
    inputSchema: z.object({
      template: z.enum(["planet_house", "nakshatra", "yoga", "lagna", "panchang_city"]).optional(),
      limit: z.number().int().min(1).max(30).default(10),
    }),
    run: async ({ template, limit }) => {
      const rows = await nextPlannedPages(limit, template);
      if (!rows.length) return json({ note: "No planned pages left for that template." });
      return json(rows.map(({ page, volume }) => ({ id: page.id, template: page.template, title: page.title, keyword: page.keyword, monthly_searches: volume, inputs: page.params, review_note: page.reviewNote })));
    },
  });

  const writePage = betaZodTool({
    name: "write_page",
    description:
      "Save the draft of a planned programmatic page and send it to the approval queue. Panchang city pages get today's figures filled in by the site; write the parts that don't change (what Panchang is, how to use it in that city, local festivals). The content is checked for banned claims; if it returns an error, fix it and call again.",
    inputSchema: z.object({ page_id: z.uuid(), ...PageContent }),
    run: async (p) => {
      if (ctx.drafts >= MAX_PAGES_PER_RUN) return `Error: this run has written ${MAX_PAGES_PER_RUN} pages, the limit. Stop and summarise.`;
      const [page] = await db.select().from(seoPages).where(eq(seoPages.id, p.page_id)).limit(1);
      if (!page) return "Error: no page with that id.";
      if (page.status === "live" || page.status === "in_review") return `Error: that page is already ${page.status === "live" ? "live" : "waiting for approval"}.`;
      const [kit] = await db.select({ bannedPhrases: brandKit.bannedPhrases }).from(brandKit).limit(1);
      const problems = contentProblems(p, kit?.bannedPhrases ?? []);
      if (problems.length) return `Error: ${problems.join(" ")}`;
      const [saved] = await db
        .update(seoPages)
        .set({ title: p.title, description: p.description, answer: p.answer, body: p.body, faq: p.faq, brief: p.brief, needsReview: p.needs_jyotish_review, status: "in_review", runId: ctx.runId, reviewNote: null, updatedAt: new Date() })
        .where(eq(seoPages.id, page.id))
        .returning();
      await sendPageForApproval(ctx, saved!, `Drafted by the SEO agent for "${page.keyword ?? page.title}".${p.needs_jyotish_review ? " Needs a Jyotish check." : ""}`);
      ctx.drafts++;
      await audit(ctx, "write_page", page.slug, "in_review");
      return `Saved "${p.title}" and sent it for approval (${words(p.body)} words).`;
    },
  });

  const writeBlog = betaZodTool({
    name: "write_blog",
    description: "Write a blog post for a keyword BODH should rank for and send it for approval. Check get_keywords and the existing pages first so it doesn't compete with a programmatic page.",
    inputSchema: z.object({ keyword: z.string().min(3).max(120), slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(90), ...PageContent }),
    run: async (p) => {
      if (ctx.drafts >= MAX_PAGES_PER_RUN) return `Error: this run has written ${MAX_PAGES_PER_RUN} pages, the limit.`;
      const [kit] = await db.select({ bannedPhrases: brandKit.bannedPhrases }).from(brandKit).limit(1);
      const problems = contentProblems(p, kit?.bannedPhrases ?? []);
      if (problems.length) return `Error: ${problems.join(" ")}`;
      const [existing] = await db.select().from(seoPages).where(and(eq(seoPages.template, "blog"), eq(seoPages.slug, p.slug))).limit(1);
      if (existing && existing.status !== "drafted" && existing.status !== "planned") return `Error: a blog with the slug ${p.slug} already exists. Pick another.`;
      const values = { template: "blog", slug: p.slug, keyword: p.keyword.toLowerCase(), title: p.title, description: p.description, answer: p.answer, body: p.body, faq: p.faq, brief: p.brief, needsReview: p.needs_jyotish_review, status: "in_review", runId: ctx.runId, updatedAt: new Date() };
      const [saved] = existing
        ? await db.update(seoPages).set(values).where(eq(seoPages.id, existing.id)).returning()
        : await db.insert(seoPages).values(values).returning();
      await sendPageForApproval(ctx, saved!, `Blog for "${p.keyword}", drafted by the SEO agent.`);
      ctx.drafts++;
      await audit(ctx, "write_blog", p.slug, "in_review");
      return `Saved the blog "${p.title}" and sent it for approval.`;
    },
  });

  const track = betaZodTool({
    name: "track_keywords",
    description: "Start tracking keywords (from get_keyword_ideas) so their rankings show on the SEO page. Already-tracked ones are updated.",
    inputSchema: z.object({
      keywords: z
        .array(z.object({ keyword: z.string().min(2).max(120), volume: z.number().int().min(0), difficulty: z.number().int().min(0).max(100), intent: z.enum(["tool", "learn", "software"]) }))
        .min(1)
        .max(50),
    }),
    run: async ({ keywords: list }) => {
      for (const k of list) {
        await db
          .insert(keywords)
          .values({ keyword: k.keyword.toLowerCase(), volume: k.volume, difficulty: k.difficulty, intent: k.intent, source: "dataforseo" })
          .onConflictDoUpdate({ target: keywords.keyword, set: { volume: k.volume, difficulty: k.difficulty, updatedAt: new Date() } });
      }
      return `Tracking ${list.length} keywords.`;
    },
  });

  return [listPages, writePage, writeBlog, track];
}

/* ---------- chat: start a run ---------- */

export type RunStarter = (agent: "strategy" | "content" | "seo", task: string | undefined) => Promise<{ runId?: string; error?: string }>;

export function chatTools(start: RunStarter) {
  return [
    betaZodTool({
      name: "start_agent_run",
      description:
        "Start a Strategy, Content or SEO agent run when the person asks for one (a plan, posts drafted onto the calendar, SEO pages or blogs written). Pass their instructions as the task. It runs in the background for a few minutes; results appear on the Strategy, Calendar, SEO and Approvals pages.",
      inputSchema: z.object({ agent: z.enum(["strategy", "content", "seo"]), task: z.string().max(2000).optional() }),
      run: async ({ agent, task }) => {
        const r = await start(agent, task);
        return r.error ? `Couldn't start it: ${r.error}` : `Started the ${agent} agent (run ${r.runId}). It takes a few minutes.`;
      },
    }),
  ];
}

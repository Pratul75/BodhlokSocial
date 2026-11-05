import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** A text column limited to a fixed set of values, enforced by a CHECK constraint. */
const oneOf = (name: string, column: unknown, values: readonly string[]) =>
  check(name, sql`${column} in (${sql.raw(values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", "))})`);

export const USER_ROLES = ["admin", "ads_manager", "seo_manager", "social_manager", "sales"] as const;
export const APPROVAL_KIND_VALUES = ["post", "ad_change", "reply", "listing", "blog", "page"] as const;
export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "withdrawn"] as const;
export const CALENDAR_STATUSES = ["idea", "drafted", "in_review", "approved", "scheduled", "published", "failed"] as const;
export const CONNECTION_STATUSES = ["not_connected", "connected", "error", "pending_review"] as const;
export const LEAD_STATUSES = ["new", "contacted", "qualified", "won", "lost"] as const;
export const COMMUNITY_STATUSES = ["found", "drafted", "in_review", "approved", "posted", "skipped", "failed"] as const;
export const LISTING_STATUSES = ["found", "drafted", "in_review", "approved", "submitted", "skipped"] as const;

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    role: text("role").notNull().default("social_manager"),
    active: boolean("active").notNull().default(true),
    /** Goes up on sign-out and when access is removed; session cookies carrying an older number stop working. */
    sessionVersion: integer("session_version").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [oneOf("users_role_check", t.role, USER_ROLES), index("users_role_idx").on(t.role)],
);

/** One row per integration. `secretRef` names the secret; the value never lives here. */
export const connections = pgTable(
  "connections",
  {
    key: text("key").primaryKey(),
    status: text("status").notNull().default("not_connected"), // not_connected | connected | error | pending_review
    secretRef: text("secret_ref"),
    accountLabel: text("account_label"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    error: text("error"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [oneOf("connections_status_check", t.status, CONNECTION_STATUSES)],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: id(),
    agent: text("agent").notNull(), // strategy | content | seo | ads | community | mentions | analyst | geo | chat
    trigger: text("trigger").notNull(), // schedule | manual | chat
    status: text("status").notNull(), // queued | running | succeeded | failed
    summary: text("summary"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    /** While a run is going this holds its budget reservation; the real cost replaces it at the end. */
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }).notNull().default("0"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    // One queued or running run per agent; concurrent starts collapse into one. Chat turns are exempt.
    uniqueIndex("agent_runs_one_active_idx").on(t.agent).where(sql`${t.status} in ('queued', 'running') and ${t.agent} <> 'chat'`),
    index("agent_runs_agent_started_idx").on(t.agent, t.startedAt),
    index("agent_runs_started_idx").on(t.startedAt),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    kind: text("kind").notNull(), // post | ad_change | reply | listing | blog | page
    channel: text("channel").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    reason: text("reason").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("pending"), // pending | approved | rejected | withdrawn
    agent: text("agent").notNull(),
    /** For posts: the calendar item this approval decides. */
    calendarItemId: uuid("calendar_item_id").references((): AnyPgColumn => calendarItems.id, { onDelete: "set null" }),
    sourceRunId: uuid("source_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("approvals_status_idx").on(t.status),
    index("approvals_calendar_item_idx").on(t.calendarItemId),
    index("approvals_kind_status_idx").on(t.kind, t.status),
    oneOf("approvals_kind_check", t.kind, APPROVAL_KIND_VALUES),
    oneOf("approvals_status_check", t.status, APPROVAL_STATUSES),
  ],
);

export const assets = pgTable("assets", {
  id: id(),
  name: text("name").notNull(),
  type: text("type").notNull(), // image | video
  source: text("source").notNull(), // upload | imagen | veo
  storagePath: text("storage_path").notNull(),
  contentType: text("content_type"),
  sizeBytes: integer("size_bytes"),
  width: integer("width"),
  height: integer("height"),
  /** For generated assets: the prompt and the job that made it. */
  prompt: text("prompt"),
  jobId: uuid("job_id").references((): AnyPgColumn => creativeJobs.id, { onDelete: "set null" }),
  createdBy: text("created_by"),
  createdAt: createdAt(),
});

export const calendarItems = pgTable(
  "calendar_items",
  {
    id: id(),
    channel: text("channel").notNull(),
    format: text("format").notNull(),
    idea: text("idea").notNull(),
    script: text("script"),
    caption: text("caption"),
    assetIds: jsonb("asset_ids").$type<string[]>().notNull().default([]),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("idea"), // idea | drafted | in_review | approved | scheduled | published | failed
    /** Title for YouTube and blogs; also the overlay on generated thumbnails. */
    title: text("title"),
    /** Per-channel options, e.g. { "post_type": "story" } or { "visibility": "unlisted" }. */
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    /** Postiz post ID once scheduled there. The post's Postiz group is always this item's ID. */
    postizId: text("postiz_id"),
    publishedUrl: text("published_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishAttempts: integer("publish_attempts").notNull().default(0),
    error: text("error"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index("calendar_scheduled_idx").on(t.scheduledAt),
    index("calendar_status_scheduled_idx").on(t.status, t.scheduledAt),
    index("calendar_postiz_idx").on(t.postizId),
    oneOf("calendar_items_status_check", t.status, CALENDAR_STATUSES),
  ],
);

/** One plan per month: the Strategy agent replaces its draft, never an approved plan. */
export const strategyPlans = pgTable(
  "strategy_plans",
  {
    id: id(),
    month: date("month").notNull(),
    status: text("status").notNull().default("draft"), // draft | approved
    summary: text("summary").notNull(),
    pillars: jsonb("pillars").$type<{ name: string; share: number; why: string }[]>().notNull().default([]),
    bets: jsonb("bets").$type<{ title: string; metric: string; target: string }[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("strategy_plans_month_uq").on(t.month), oneOf("strategy_plans_status_check", t.status, ["draft", "approved"])],
);

export const campaigns = pgTable("campaigns", {
  id: id(),
  platform: text("platform").notNull(), // google_ads | meta_ads
  /** The campaign's ID on the ad platform; joins to ad_spend_daily and utm_campaign. */
  platformCampaignId: text("platform_campaign_id").unique(),
  name: text("name").notNull(),
  objective: text("objective").notNull(),
  status: text("status").notNull(), // active | paused | learning
  dailyBudget: integer("daily_budget").notNull(),
  // Superseded by ad_spend_daily and conversion_events; kept until the platform sync owns campaigns.
  spend7d: integer("spend_7d").notNull().default(0),
  clicks7d: integer("clicks_7d").notNull().default(0),
  registrations7d: integer("registrations_7d").notNull().default(0),
  activations7d: integer("activations_7d").notNull().default(0),
});

/**
 * Campaigns, ad sets (Meta) / ad groups (Google) and ads as they are on the platforms,
 * synced hourly. Budgets and bids are in INR (the platforms store minor units / micros).
 */
export const adEntities = pgTable(
  "ad_entities",
  {
    id: id(),
    platform: text("platform").notNull(), // google_ads | meta_ads
    level: text("level").notNull(), // campaign | ad_set | ad
    platformId: text("platform_id").notNull(),
    parentId: text("parent_id"), // the ad set for an ad, the campaign for an ad set
    campaignId: text("campaign_id"),
    name: text("name").notNull(),
    status: text("status").notNull(), // active | paused | removed | other
    objective: text("objective"),
    /** Daily budget, where this level owns one (Google: campaign; Meta: campaign with CBO, or ad set). */
    dailyBudget: numeric("daily_budget", { precision: 12, scale: 2 }),
    /** Manual bid or target CPA, where set. */
    bid: numeric("bid", { precision: 12, scale: 2 }),
    bidKind: text("bid_kind"), // cpc | target_cpa | bid_cap | cost_cap
    /** Ad copy, for ads: { headline, text, link, creativeId }. */
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ad_entities_platform_id_uq").on(t.platform, t.platformId), index("ad_entities_parent_idx").on(t.parentId)],
);

/**
 * Every change to ads, by an agent or a person, with what the guardrails decided.
 * `campaign_id` belonged to the retired campaigns table and is no longer written.
 */
export const adChanges = pgTable(
  "ad_changes",
  {
    id: id(),
    campaignId: uuid("campaign_id"),
    change: text("change").notNull(),
    outcome: text("outcome").notNull(), // applying | applied | approved | sent_to_approval | blocked | failed | rejected
    reason: text("reason").notNull(),
    actor: text("actor").notNull(),
    createdAt: createdAt(),
    platform: text("platform"),
    /** pause_ad | resume_ad | bid_change | budget_change | new_campaign | ab_test */
    type: text("type"),
    level: text("level"),
    entityId: text("entity_id"),
    entityName: text("entity_name"),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    /** The guardrail's reason, separate from the agent's. */
    guardrail: text("guardrail"),
    approvalId: uuid("approval_id").references(() => approvals.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    error: text("error"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
  },
  (t) => [index("ad_changes_created_idx").on(t.createdAt)],
);

export const experiments = pgTable(
  "experiments",
  {
    id: id(),
    platform: text("platform").notNull(),
    hypothesis: text("hypothesis").notNull(),
    variants: jsonb("variants").$type<{ name: string; cpa: number | null; adId?: string }[]>().notNull().default([]),
    status: text("status").notNull(), // proposed | running | won | lost | stopped
    startedAt: date("started_at").notNull(),
    /** The ad set or ad group the variants run in. */
    entityId: text("entity_id"),
    entityName: text("entity_name"),
    winnerAdId: text("winner_ad_id"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    runId: uuid("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
  },
  (t) => [index("experiments_entity_status_idx").on(t.entityId, t.status)],
);

export const budgets = pgTable("budgets", {
  platform: text("platform").primaryKey(),
  dailyCap: integer("daily_cap").notNull(),
  monthlyCap: integer("monthly_cap").notNull(),
  spentToday: integer("spent_today").notNull().default(0),
  spentThisMonth: integer("spent_this_month").notNull().default(0),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Daily funnel per channel, rebuilt from spend, sessions and conversion events (packages/db/src/funnel.ts). */
export const funnelDaily = pgTable(
  "funnel_daily",
  {
    id: id(),
    day: date("day").notNull(),
    channel: text("channel").notNull(),
    spend: integer("spend").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    registrations: integer("registrations").notNull().default(0),
    activations: integer("activations").notNull().default(0),
    paid: integer("paid").notNull().default(0),
  },
  (t) => [index("funnel_day_idx").on(t.day), uniqueIndex("funnel_day_channel_uq").on(t.day, t.channel)],
);

export const keywords = pgTable(
  "keywords",
  {
    id: id(),
    keyword: text("keyword").notNull(),
    volume: integer("volume").notNull(),
    difficulty: integer("difficulty").notNull(),
    position: integer("position"),
    intent: text("intent").notNull(), // tool | learn | software
    pageUrl: text("page_url"),
    /** Where the row came from: manual | dataforseo | search_console. */
    source: text("source").notNull().default("manual"),
    clicks28d: integer("clicks_28d"),
    impressions28d: integer("impressions_28d"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("keywords_keyword_idx").on(t.keyword)],
);

export interface FaqItem {
  q: string;
  a: string;
}

/**
 * Programmatic pages (planet in house, nakshatra, yoga, lagna, city Panchang) and blogs.
 * Content is drafted by the SEO agent, approved in the queue, then served to BODH's
 * website through the page feed. "live" means approved and in the feed.
 */
export const seoPages = pgTable(
  "seo_pages",
  {
    id: id(),
    template: text("template").notNull(), // planet_house | nakshatra | yoga | lagna | panchang_city | blog
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull(), // planned | drafted | in_review | live
    clicks28d: integer("clicks_28d").notNull().default(0),
    /** Template inputs, e.g. { planet: "Saturn", house: 7 }. */
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    keyword: text("keyword"),
    /** What the page must cover, written before the draft. */
    brief: text("brief"),
    description: text("description"),
    /** The 40 to 60 word direct answer shown at the top of the page. */
    answer: text("answer"),
    body: text("body"),
    faq: jsonb("faq").$type<FaqItem[]>().notNull().default([]),
    needsReview: boolean("needs_review").notNull().default(true),
    reviewNote: text("review_note"),
    runId: uuid("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Publishing to bodhlok.com: null | queued | pr_open | merged | live | remove_queued | removing | removed | failed */
    siteStatus: text("site_status"),
    siteCategory: text("site_category"),
    sitePrNumber: integer("site_pr_number"),
    sitePrUrl: text("site_pr_url"),
    siteUrl: text("site_url"),
    siteError: text("site_error"),
    sitePublishedAt: timestamp("site_published_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("seo_pages_template_slug_idx").on(t.template, t.slug),
    index("seo_pages_status_idx").on(t.status),
    index("seo_pages_site_status_idx").on(t.siteStatus),
  ],
);

/** DataForSEO On-Page crawls of BODH's site. */
export const seoAudits = pgTable(
  "seo_audits",
  {
    id: id(),
    target: text("target").notNull(),
    taskId: text("task_id").notNull(),
    status: text("status").notNull(), // running | finished | failed
    pagesCrawled: integer("pages_crawled").notNull().default(0),
    onpageScore: numeric("onpage_score", { precision: 5, scale: 2 }),
    /** page_metrics from the summary, minus checks. */
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
    /** Failing checks, most pages first: { check, pages, examples }. */
    issues: jsonb("issues").$type<{ check: string; pages: number; examples: string[] }[]>().notNull().default([]),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("seo_audits_status_idx").on(t.status, t.startedAt)],
);

/** Questions asked of AI assistants each week to see whether they mention Asttrolok. */
export const geoQuestions = pgTable("geo_questions", {
  id: id(),
  question: text("question").notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const aiVisibilityChecks = pgTable(
  "ai_visibility_checks",
  {
    id: id(),
    question: text("question").notNull(),
    engine: text("engine").notNull(), // chatgpt | gemini | perplexity | claude
    mentioned: boolean("mentioned").notNull(),
    checkedAt: date("checked_at").notNull(),
    answer: text("answer"),
    /** Other astrology brands the answer named. */
    competitors: jsonb("competitors").$type<string[]>().notNull().default([]),
    citations: jsonb("citations").$type<string[]>().notNull().default([]),
    error: text("error"),
  },
  (t) => [index("ai_visibility_checked_idx").on(t.checkedAt)],
);

/**
 * Questions on Reddit, YouTube and Quora where a helpful answer from the team fits, found by the
 * Community agent. Every answer is approved by a person (approval kind "reply") and posted from a
 * named team account; Quora answers are posted by hand.
 */
export const communityItems = pgTable(
  "community_items",
  {
    id: id(),
    platform: text("platform").notNull(), // reddit | quora | youtube
    url: text("url").notNull(),
    /** The platform's own id (Reddit fullname t3_..., YouTube comment id), to find each question once. */
    externalId: text("external_id"),
    /** Subreddit, YouTube video title, or Quora topic. */
    place: text("place"),
    question: text("question").notNull(),
    /** Why the agent thinks an answer fits, shown to the reviewer. */
    why: text("why"),
    draft: text("draft"),
    /** The reviewer's note when an answer was sent back. */
    reviewNote: text("review_note"),
    status: text("status").notNull(), // found | drafted | in_review | approved | posted | skipped | failed
    approvalId: uuid("approval_id").references(() => approvals.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    postedUrl: text("posted_url"),
    postedBy: text("posted_by"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    error: text("error"),
    foundAt: timestamp("found_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("community_platform_external_uq").on(t.platform, t.externalId),
    index("community_status_found_idx").on(t.status, t.foundAt),
    oneOf("community_items_status_check", t.status, COMMUNITY_STATUSES),
  ],
);

/**
 * Directories, review sites and "best software" lists where Bodhlok should be listed, found by the
 * Mentions agent. The agent drafts the listing; a person approves it (kind "listing") and submits it.
 */
export const directoryListings = pgTable(
  "directory_listings",
  {
    id: id(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    category: text("category").notNull(), // software_directory | review_site | best_of_list | association | other
    why: text("why").notNull(),
    /** What to submit: { title, tagline, description, categories, notes }. */
    draft: jsonb("draft").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("found"), // found | drafted | in_review | approved | submitted | skipped
    reviewNote: text("review_note"),
    approvalId: uuid("approval_id").references(() => approvals.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    submittedUrl: text("submitted_url"),
    submittedBy: text("submitted_by"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    foundAt: timestamp("found_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("directory_listings_url_uq").on(t.url), index("directory_listings_status_idx").on(t.status), oneOf("directory_listings_status_check", t.status, LISTING_STATUSES)],
);

/** Weekly and monthly reports written by the Analyst agent. */
export const reports = pgTable(
  "reports",
  {
    id: id(),
    kind: text("kind").notNull(), // weekly | monthly
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    title: text("title").notNull(),
    /** Markdown. */
    body: text("body").notNull(),
    /** The headline numbers the report is built on, for the Today page. */
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
    runId: uuid("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("reports_kind_period_uq").on(t.kind, t.periodStart), oneOf("reports_kind_check", t.kind, ["weekly", "monthly"])],
);

export const leads = pgTable(
  "leads",
  {
    id: id(),
    source: text("source").notNull(), // meta_lead_form | google_lead_form | manual
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    interest: text("interest").notNull(),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    status: text("status").notNull().default("new"), // new | contacted | qualified | won | lost
    /** The lead's id on the platform (Meta leadgen_id, Google lead_id), so a re-delivered webhook is stored once. */
    platformLeadId: text("platform_lead_id"),
    formId: text("form_id"),
    campaign: text("campaign"),
    /** Every answer from the form, as the platform sent it. */
    fields: jsonb("fields").$type<Record<string, string>>().notNull().default({}),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("leads_source_platform_id_uq").on(t.source, t.platformLeadId),
    index("leads_status_created_idx").on(t.status, t.createdAt),
    oneOf("leads_status_check", t.status, LEAD_STATUSES),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actor: text("actor").notNull(), // user email or agent name
    actorType: text("actor_type").notNull(), // user | agent
    action: text("action").notNull(),
    target: text("target").notNull(),
    reason: text("reason"),
    result: text("result").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt)],
);

/**
 * Registration, activation (first chart) and paid events sent by the BODH backend.
 * Contact details arrive raw or hashed and are stored only as SHA-256 hashes.
 * Activation and paid events take the channel of the same user's registration.
 */
export const conversionEvents = pgTable(
  "conversion_events",
  {
    id: id(),
    eventId: text("event_id").notNull().unique(),
    type: text("type").notNull(), // registration | activation | paid
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    userRef: text("user_ref").notNull(),
    platform: text("platform").notNull(), // web | android | ios
    plan: text("plan"),
    value: numeric("value", { precision: 12, scale: 2 }),
    currency: text("currency").notNull().default("INR"),
    emailSha256: text("email_sha256"),
    phoneSha256: text("phone_sha256"),
    channel: text("channel").notNull(), // attributed channel, see packages/integrations/src/attribution.ts
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmContent: text("utm_content"), // platform ad ID by convention
    utmTerm: text("utm_term"),
    gclid: text("gclid"),
    gbraid: text("gbraid"),
    wbraid: text("wbraid"),
    fbclid: text("fbclid"),
    fbp: text("fbp"),
    fbc: text("fbc"),
    referralCode: text("referral_code"),
    referrer: text("referrer"),
    landingPage: text("landing_page"),
    clientIp: text("client_ip"),
    userAgent: text("user_agent"),
    /** The India-time day of occurred_at, kept by Postgres, so the funnel's day filter can use an index. */
    occurredIst: date("occurred_ist").generatedAlwaysAs(sql`((occurred_at AT TIME ZONE 'Asia/Kolkata')::date)`),
  },
  (t) => [
    index("conv_occurred_idx").on(t.occurredAt),
    index("conv_occurred_ist_idx").on(t.occurredIst),
    index("conv_user_idx").on(t.userRef, t.type),
    index("conv_content_idx").on(t.utmContent),
  ],
);

/** One row per event and destination: the queue for server-side conversion uploads. */
export const conversionForwards = pgTable(
  "conversion_forwards",
  {
    id: id(),
    eventId: text("event_id")
      .notNull()
      .references(() => conversionEvents.eventId, { onDelete: "cascade" }),
    destination: text("destination").notNull(), // meta_capi | google_ads
    status: text("status").notNull().default("pending"), // pending | sent | failed | skipped
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("forward_event_dest_uq").on(t.eventId, t.destination), index("forward_due_idx").on(t.status, t.nextAttemptAt)],
);

/** Daily spend, impressions and clicks per ad, loaded from the ad platforms. */
export const adSpendDaily = pgTable(
  "ad_spend_daily",
  {
    id: id(),
    day: date("day").notNull(),
    platform: text("platform").notNull(), // google_ads | meta_ads
    campaignId: text("campaign_id").notNull(),
    campaignName: text("campaign_name").notNull(),
    adId: text("ad_id").notNull(),
    adName: text("ad_name").notNull(),
    spend: numeric("spend", { precision: 12, scale: 2 }).notNull(),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    loadedAt: timestamp("loaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("spend_day_ad_uq").on(t.day, t.platform, t.adId)],
);

/** Daily web sessions per channel, from the GA4 BigQuery export. */
export const webSessionsDaily = pgTable(
  "web_sessions_daily",
  {
    day: date("day").notNull(),
    channel: text("channel").notNull(),
    sessions: integer("sessions").notNull(),
    loadedAt: timestamp("loaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "web_sessions_daily_pk", columns: [t.day, t.channel] })],
);

/** Each run of a tracking job, shown on the Tracking page. */
export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    id: id(),
    job: text("job").notNull(), // load_meta_spend | load_google_spend | load_ga4_sessions | forward_conversions | rebuild_funnel
    status: text("status").notNull(), // succeeded | failed | skipped
    detail: text("detail"),
    rows: integer("rows").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("pipeline_job_idx").on(t.job, t.startedAt)],
);

/** One row: the brand rules applied to generated creative and checked on captions. */
export const brandKit = pgTable(
  "brand_kit",
  {
  id: integer("id").primaryKey().default(1),
  palette: jsonb("palette").$type<{ name: string; hex: string }[]>().notNull().default([]),
  logoAssetId: uuid("logo_asset_id").references(() => assets.id, { onDelete: "set null" }),
  /** Visual style added to every image prompt. */
  imageStyle: text("image_style").notNull().default(""),
  /** How captions should sound, for the Content agent. */
  voice: text("voice").notNull().default(""),
  bannedPhrases: jsonb("banned_phrases").$type<string[]>().notNull().default([]),
  defaultHashtags: jsonb("default_hashtags").$type<string[]>().notNull().default([]),
  /** Stamp the logo on generated images and thumbnails. */
  stampLogo: boolean("stamp_logo").notNull().default(true),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("brand_kit_singleton_check", sql`${t.id} = 1`)],
);

/** Image and video generation requests sent to Vertex AI. */
export const creativeJobs = pgTable(
  "creative_jobs",
  {
    id: id(),
    kind: text("kind").notNull(), // image | carousel | thumbnail | video
    prompt: text("prompt").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("queued"), // queued | running | succeeded | failed
    operationName: text("operation_name"), // Veo long-running operation
    assetIds: jsonb("asset_ids").$type<string[]>().notNull().default([]),
    error: text("error"),
    requestedBy: text("requested_by").notNull(),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("creative_jobs_status_idx").on(t.status, t.createdAt)],
);

/** Which Postiz channel each of our channels publishes to. */
export const publishingChannels = pgTable("publishing_channels", {
  channel: text("channel").primaryKey(), // instagram | facebook | linkedin | youtube
  postizIntegrationId: text("postiz_integration_id").notNull(),
  postizIdentifier: text("postiz_identifier").notNull(), // instagram | instagram-standalone | facebook | linkedin | linkedin-page | youtube
  name: text("name").notNull(),
  picture: text("picture"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Calls to Postiz's rate-limited create-post endpoint, to stay under its hourly limit. */
export const postizCalls = pgTable(
  "postiz_calls",
  {
    id: id(),
    endpoint: text("endpoint").notNull(),
    calendarItemId: uuid("calendar_item_id").references(() => calendarItems.id, { onDelete: "set null" }),
    ok: boolean("ok").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("postiz_calls_at_idx").on(t.at)],
);

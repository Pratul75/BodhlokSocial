import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull().default("social_manager"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** One row per integration. `secretRef` names the secret; the value never lives here. */
export const connections = pgTable("connections", {
  key: text("key").primaryKey(),
  status: text("status").notNull().default("not_connected"), // not_connected | connected | error | pending_review
  secretRef: text("secret_ref"),
  accountLabel: text("account_label"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  error: text("error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentRuns = pgTable("agent_runs", {
  id: id(),
  agent: text("agent").notNull(),
  trigger: text("trigger").notNull(), // schedule | manual | chat
  status: text("status").notNull(), // queued | running | succeeded | failed
  summary: text("summary"),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 10, scale: 4 }).notNull().default("0"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    kind: text("kind").notNull(), // post | ad_change | reply | listing | blog
    channel: text("channel").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    reason: text("reason").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    agent: text("agent").notNull(),
    /** For posts: the calendar item this approval decides. */
    calendarItemId: uuid("calendar_item_id"),
    sourceRunId: uuid("source_run_id").references(() => agentRuns.id),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: createdAt(),
  },
  (t) => [index("approvals_status_idx").on(t.status)],
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
  jobId: uuid("job_id"),
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
  (t) => [index("calendar_scheduled_idx").on(t.scheduledAt)],
);

export const strategyPlans = pgTable("strategy_plans", {
  id: id(),
  month: date("month").notNull(),
  status: text("status").notNull().default("draft"), // draft | approved
  summary: text("summary").notNull(),
  pillars: jsonb("pillars").$type<{ name: string; share: number; why: string }[]>().notNull().default([]),
  bets: jsonb("bets").$type<{ title: string; metric: string; target: string }[]>().notNull().default([]),
  createdAt: createdAt(),
});

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

export const adChanges = pgTable("ad_changes", {
  id: id(),
  campaignId: uuid("campaign_id").references(() => campaigns.id),
  change: text("change").notNull(),
  outcome: text("outcome").notNull(), // applied | sent_to_approval | blocked
  reason: text("reason").notNull(),
  actor: text("actor").notNull(),
  createdAt: createdAt(),
});

export const experiments = pgTable("experiments", {
  id: id(),
  platform: text("platform").notNull(),
  hypothesis: text("hypothesis").notNull(),
  variants: jsonb("variants").$type<{ name: string; cpa: number | null }[]>().notNull().default([]),
  status: text("status").notNull(), // running | won | lost | stopped
  startedAt: date("started_at").notNull(),
});

export const budgets = pgTable("budgets", {
  platform: text("platform").primaryKey(),
  dailyCap: integer("daily_cap").notNull(),
  monthlyCap: integer("monthly_cap").notNull(),
  spentToday: integer("spent_today").notNull().default(0),
  spentThisMonth: integer("spent_this_month").notNull().default(0),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Daily funnel rows, loaded from BigQuery in production. */
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

export const keywords = pgTable("keywords", {
  id: id(),
  keyword: text("keyword").notNull(),
  volume: integer("volume").notNull(),
  difficulty: integer("difficulty").notNull(),
  position: integer("position"),
  intent: text("intent").notNull(), // tool | learn | software
  pageUrl: text("page_url"),
});

export const seoPages = pgTable("seo_pages", {
  id: id(),
  template: text("template").notNull(), // planet_house | nakshatra | yoga | lagna | panchang_city | blog
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(), // planned | drafted | in_review | live
  clicks28d: integer("clicks_28d").notNull().default(0),
});

export const aiVisibilityChecks = pgTable("ai_visibility_checks", {
  id: id(),
  question: text("question").notNull(),
  engine: text("engine").notNull(), // chatgpt | gemini | perplexity
  mentioned: boolean("mentioned").notNull(),
  checkedAt: date("checked_at").notNull(),
});

export const communityItems = pgTable("community_items", {
  id: id(),
  platform: text("platform").notNull(), // reddit | quora | youtube
  url: text("url").notNull(),
  question: text("question").notNull(),
  draft: text("draft"),
  status: text("status").notNull(), // found | drafted | in_review | posted | skipped
  foundAt: timestamp("found_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leads = pgTable("leads", {
  id: id(),
  source: text("source").notNull(), // meta_lead_form | google_lead_form
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  interest: text("interest").notNull(),
  assignedTo: uuid("assigned_to").references(() => users.id),
  status: text("status").notNull().default("new"), // new | contacted | qualified | won | lost
  createdAt: createdAt(),
});

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
  },
  (t) => [
    index("conv_occurred_idx").on(t.occurredAt),
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
  (t) => [uniqueIndex("sessions_day_channel_uq").on(t.day, t.channel)],
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
export const brandKit = pgTable("brand_kit", {
  id: integer("id").primaryKey().default(1),
  palette: jsonb("palette").$type<{ name: string; hex: string }[]>().notNull().default([]),
  logoAssetId: uuid("logo_asset_id"),
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
});

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
    calendarItemId: uuid("calendar_item_id"),
    ok: boolean("ok").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("postiz_calls_at_idx").on(t.at)],
);

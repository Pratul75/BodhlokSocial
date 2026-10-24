import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
  width: integer("width"),
  height: integer("height"),
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
    postizId: text("postiz_id"),
    error: text("error"),
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
  name: text("name").notNull(),
  objective: text("objective").notNull(),
  status: text("status").notNull(), // active | paused | learning
  dailyBudget: integer("daily_budget").notNull(),
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
  (t) => [index("funnel_day_idx").on(t.day)],
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

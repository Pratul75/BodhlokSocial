import type { Role } from "./roles";

export type ModuleKey =
  | "today"
  | "strategy"
  | "calendar"
  | "creative"
  | "approvals"
  | "publishing"
  | "ads"
  | "seo"
  | "community"
  | "leads"
  | "analytics"
  | "tracking"
  | "chat"
  | "runs"
  | "connections"
  | "admin";

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  href: string;
  group: "Overview" | "Plan" | "Review" | "Grow" | "Measure" | "Settings";
  roles: readonly Role[];
}

const ALL: readonly Role[] = ["admin", "ads_manager", "seo_manager", "social_manager", "sales"];
const MARKETING: readonly Role[] = ["admin", "ads_manager", "seo_manager", "social_manager"];

/** Role access follows the Roles table in PLAN.md. */
export const MODULES: readonly ModuleDef[] = [
  { key: "today", label: "Today", href: "/", group: "Overview", roles: MARKETING },
  { key: "strategy", label: "Strategy", href: "/strategy", group: "Plan", roles: MARKETING },
  { key: "calendar", label: "Content calendar", href: "/calendar", group: "Plan", roles: ["admin", "social_manager", "seo_manager"] },
  { key: "creative", label: "Creative studio", href: "/creative", group: "Plan", roles: ["admin", "social_manager"] },
  { key: "approvals", label: "Approvals", href: "/approvals", group: "Review", roles: MARKETING },
  { key: "publishing", label: "Publishing", href: "/publishing", group: "Grow", roles: ["admin", "social_manager"] },
  { key: "ads", label: "Ads manager", href: "/ads", group: "Grow", roles: ["admin", "ads_manager"] },
  { key: "seo", label: "SEO & GEO", href: "/seo", group: "Grow", roles: ["admin", "seo_manager"] },
  { key: "community", label: "Community", href: "/community", group: "Grow", roles: ["admin", "social_manager"] },
  { key: "leads", label: "Leads", href: "/leads", group: "Grow", roles: ALL },
  { key: "analytics", label: "Analytics", href: "/analytics", group: "Measure", roles: MARKETING },
  { key: "tracking", label: "Tracking", href: "/tracking", group: "Measure", roles: ["admin", "ads_manager"] },
  { key: "chat", label: "Ask the agents", href: "/chat", group: "Measure", roles: MARKETING },
  { key: "runs", label: "Agent runs", href: "/runs", group: "Measure", roles: MARKETING },
  { key: "connections", label: "Connections", href: "/connections", group: "Settings", roles: ["admin"] },
  { key: "admin", label: "Admin", href: "/admin", group: "Settings", roles: ["admin"] },
];

export function modulesForRole(role: Role): ModuleDef[] {
  return MODULES.filter((m) => m.roles.includes(role));
}

export function canAccess(role: Role, key: ModuleKey): boolean {
  return MODULES.some((m) => m.key === key && m.roles.includes(role));
}

/** Which approval kinds each role may decide on. */
export const APPROVAL_KINDS = ["post", "ad_change", "reply", "listing", "blog", "page"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVERS: Record<ApprovalKind, readonly Role[]> = {
  post: ["admin", "social_manager"],
  reply: ["admin", "social_manager"],
  ad_change: ["admin", "ads_manager"],
  listing: ["admin", "seo_manager"],
  blog: ["admin", "seo_manager"],
  page: ["admin", "seo_manager"],
};

/**
 * The module each kind of approval acts on.
 *
 * Deciding is not a read: approving an ad change makes a live change on an ad platform,
 * approving a reply posts it publicly, approving a page publishes it to the website. So the
 * Approvals module is not the only one that has to be on — the module the decision reaches
 * into has to be on as well, or switching a module off would leave its queue still firing.
 */
export const APPROVAL_MODULE: Record<ApprovalKind, ModuleKey> = {
  post: "publishing",
  ad_change: "ads",
  reply: "community",
  listing: "seo",
  blog: "seo",
  page: "seo",
};

export function canApprove(role: Role, kind: ApprovalKind): boolean {
  return APPROVERS[kind].includes(role);
}

/** The module whose access a person needs to start each agent (from its Run button or from chat). */
/**
 * The outside accounts each module works with.
 *
 * A module listed here is shown only when the workspace has **at least one** of its accounts:
 * an Ads manager with neither Google nor Meta is a page that can only ever be empty, while one
 * with Meta alone is worth opening. Modules absent from this map need no outside account and
 * are never hidden for this reason — Today, Approvals, Connections and Admin among them.
 *
 * Keys here are integration keys from `./integrations`.
 */
export const MODULE_INTEGRATIONS: Partial<Record<ModuleKey, readonly string[]>> = {
  strategy: ["anthropic"],
  calendar: ["anthropic"],
  creative: ["vertex", "anthropic"],
  publishing: ["postiz", "postiz_app", "meta_pages", "linkedin", "youtube"],
  ads: ["google_ads", "meta_marketing"],
  // The last two are the AI-visibility engines: `geo.ts` asks them whether the brand is
  // mentioned, behind the SEO module's own `seo.geo_checks`.
  seo: ["search_console", "dataforseo", "semrush", "bodhlok_cms", "openai", "perplexity"],
  community: ["reddit", "reddit_app", "quora", "youtube", "meta_pages", "linkedin"],
  // The CRM feeds both halves — leads and billing — and `crm.ts` reads whatsapp and email as
  // the channels a lead arrived through.
  leads: ["crm_leads", "crm_billing", "meta_marketing", "bodh", "whatsapp", "email"],
  analytics: ["ga4", "bodh"],
  tracking: ["meta_capi", "google_ads", "bodh"],
  chat: ["anthropic"],
  runs: ["anthropic"],
};

/**
 * Accounts that belong to no module, said out loud.
 *
 * Everything else must be claimed by a module, and a test holds that. Without this an account
 * added later would quietly become unclaimed — which means no module hides when it is withheld,
 * and every preset grants it whatever else it switches off. Saying "this one is infrastructure"
 * is a decision; forgetting is not.
 */
export const UNCLAIMED_INTEGRATIONS: Readonly<Record<string, string>> = {
  // Growth OS's own Google OAuth client. It is how other Google accounts are connected, not an
  // account with data of its own.
  google_app: "the OAuth client other Google connections go through",
};

export const AGENT_MODULE = {
  strategy: "strategy",
  content: "calendar",
  seo: "seo",
  ads: "ads",
  community: "community",
  mentions: "seo",
  analyst: "analytics",
} as const satisfies Record<string, ModuleKey>;
export type StartableAgent = keyof typeof AGENT_MODULE;
export const STARTABLE_AGENTS = Object.keys(AGENT_MODULE) as StartableAgent[];

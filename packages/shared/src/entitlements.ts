/**
 * What a tenant may use. Three kinds, because "turn a feature off" means three different
 * things: a whole module, a capability inside one, or a number.
 *
 * Module access stays role-based exactly as it is today. An entitlement only ever narrows it:
 *
 *     access = the role allows this module  AND  the tenant has this module enabled
 *
 * So a tenant with everything enabled behaves exactly as the single-tenant application does.
 */
import { AGENT_MODULE, canAccess, MODULE_INTEGRATIONS, type ModuleKey } from "./modules";
import type { Role } from "./roles";

/** A capability inside a module. Kept deliberately generic: no tenant's industry appears here. */
export const FEATURE_KEYS = [
  "publishing.postiz",
  "publishing.site_cms",
  "ads.write",
  "ads.auto_apply",
  "creative.image",
  "creative.video",
  "seo.keywords",
  "seo.geo_checks",
  "community.auto_post",
  "tracking.forwarding",
  "crm.sync",
  "feed.pages",
  "chat",
  "agents.strategy",
  "agents.content",
  "agents.seo",
  "agents.ads",
  "agents.community",
  "agents.mentions",
  "agents.analyst",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  "publishing.postiz": "Publish approved posts through Postiz",
  "publishing.site_cms": "Publish approved SEO pages to the website CMS",
  "ads.write": "Make any change on an ad platform",
  "ads.auto_apply": "Agents may apply allowed ad changes without a person",
  "creative.image": "Generate images, carousels and thumbnails",
  "creative.video": "Generate video",
  "seo.keywords": "Keyword and site-audit syncing",
  "seo.geo_checks": "Weekly AI-visibility checks",
  "community.auto_post": "Post approved replies automatically",
  "tracking.forwarding": "Send conversions to the ad platforms",
  "crm.sync": "Mirror billing and leads from the CRM",
  "feed.pages": "Serve the public page feed",
  chat: "Ask the agents",
  "agents.strategy": "Strategy agent",
  "agents.content": "Content agent",
  "agents.seo": "SEO agent",
  "agents.ads": "Ads agent",
  "agents.community": "Community agent",
  "agents.mentions": "Mentions agent",
  "agents.analyst": "Analyst agent",
};

/**
 * The module each feature belongs to.
 *
 * Every feature is a capability *inside* a section of the product, so a module that is off and
 * a feature of it that is on is not a configuration — it is a contradiction, and the kind that
 * hides a hole: the page is gone from the menu while an agent or a webhook keeps using it. This
 * map is what lets the two kinds be kept in step instead of drifting apart.
 */
export const FEATURE_MODULE: Record<FeatureKey, ModuleKey> = {
  "publishing.postiz": "publishing",
  // Publishes approved SEO pages, and it is the SEO module that owns them.
  "publishing.site_cms": "seo",
  "ads.write": "ads",
  "ads.auto_apply": "ads",
  "creative.image": "creative",
  "creative.video": "creative",
  "seo.keywords": "seo",
  "seo.geo_checks": "seo",
  "community.auto_post": "community",
  "tracking.forwarding": "tracking",
  // Mirrors billing and leads from the CRM, which is what the Leads module shows.
  "crm.sync": "leads",
  "feed.pages": "seo",
  chat: "chat",
  // The agents' own features take their module from AGENT_MODULE rather than repeating it.
  // Written out twice they drifted apart once already: the mentions agent belongs to SEO, and
  // this map said Community, so switching Community off quietly stopped an SEO agent.
  ...(Object.fromEntries(
    Object.entries(AGENT_MODULE).map(([agent, module]) => [`agents.${agent}`, module]),
  ) as Record<`agents.${keyof typeof AGENT_MODULE}`, ModuleKey>),
};

/** The features that belong to a module, for switching them off with it. */
export function featuresOfModule(module: ModuleKey): FeatureKey[] {
  return FEATURE_KEYS.filter((f) => FEATURE_MODULE[f] === module);
}

/**
 * A feature is only usable when its own module is on as well. Asking for one without the other
 * is how a switched-off module keeps working in the background.
 */
export function featureUsable(ent: Entitlements, key: FeatureKey): boolean {
  return hasFeature(ent, key) && (isUnrestricted(ent) || ent.modules.has(FEATURE_MODULE[key]));
}

/** A number, so one tenant cannot consume another's allowance of a shared service. */
export const CAPACITY_KEYS = [
  "ai.monthly_budget_usd",
  "ai.run_cap_usd",
  "creative.monthly_images",
  "creative.monthly_videos",
  "publishing.postiz_hourly",
  "seo.audit_max_pages",
] as const;
export type CapacityKey = (typeof CAPACITY_KEYS)[number];

/** The environment variable each capacity falls back to, so tenant #1 keeps today's limits. */
export const CAPACITY_ENV: Record<CapacityKey, string> = {
  "ai.monthly_budget_usd": "AI_MONTHLY_BUDGET_USD",
  "ai.run_cap_usd": "AI_RUN_CAP_USD",
  "creative.monthly_images": "CREATIVE_MONTHLY_IMAGES",
  "creative.monthly_videos": "CREATIVE_MONTHLY_VIDEOS",
  "publishing.postiz_hourly": "POSTIZ_HOURLY_BUDGET",
  "seo.audit_max_pages": "SEO_AUDIT_MAX_PAGES",
};

export const CAPACITY_DEFAULTS: Record<CapacityKey, number> = {
  "ai.monthly_budget_usd": 150,
  "ai.run_cap_usd": 6,
  "creative.monthly_images": 300,
  "creative.monthly_videos": 30,
  "publishing.postiz_hourly": 25,
  "seo.audit_max_pages": 500,
};

/** Which agent each feature flag governs, so a disabled agent cannot be started. */
export const AGENT_FEATURE: Record<string, FeatureKey> = {
  strategy: "agents.strategy",
  content: "agents.content",
  seo: "agents.seo",
  ads: "agents.ads",
  community: "agents.community",
  mentions: "agents.mentions",
  analyst: "agents.analyst",
};

/** What a tenant has. An absent entry means the entitlement row is missing, which is a bug. */
export interface Entitlements {
  modules: ReadonlySet<string>;
  features: ReadonlySet<string>;
  /**
   * The outside accounts this workspace may connect at all.
   *
   * Separate from modules and features because it answers a different question: not "may they
   * use this part of the product" but "may they reach this company's API from here". A
   * workspace that is not given Google Ads never sees it on its Connections page, and the
   * OAuth route refuses it — so no credential for it can exist in that workspace.
   */
  integrations: ReadonlySet<string>;
  capacities: ReadonlyMap<string, number | null>;
  /**
   * "This tenant is not restricted at all." It must be set deliberately, by whoever decided it.
   *
   * Emptiness must never mean this. A tenant whose provisioning failed after its row was
   * written, or whose entitlements could not be read, has empty sets — and handing that tenant
   * the whole product is exactly the failure a paid plan cannot have. Empty means nothing.
   */
  unrestricted?: boolean;
}

/** Everything on, said explicitly. */
export const ALL_ENABLED: Entitlements = {
  modules: new Set<string>(),
  features: new Set<string>(),
  integrations: new Set<string>(),
  capacities: new Map(),
  unrestricted: true,
};

/** Nothing on. What an unprovisioned or unreadable tenant gets. */
export const NOTHING_ENABLED: Entitlements = {
  modules: new Set<string>(),
  features: new Set<string>(),
  integrations: new Set<string>(),
  capacities: new Map(),
};

/** True only when someone set it. Never inferred from empty sets. */
export function isUnrestricted(ent: Entitlements): boolean {
  return ent.unrestricted === true;
}

/** Whether this workspace may connect an outside account at all. */
export function integrationAllowed(ent: Entitlements, key: string): boolean {
  return isUnrestricted(ent) || ent.integrations.has(key);
}

/**
 * The one rule the whole application uses.
 *
 * Three things, in order of how deliberate they are: the role allows the module, the workspace
 * has the module, and — for a module that exists to work with outside accounts — the workspace
 * has at least one of them. A module with none of its accounts is a page that can only ever be
 * empty, so it is not shown. **At least one**, not all: a workspace given Meta but not Google
 * still has an Ads manager worth opening.
 */
export function effectiveAccess(role: Role, module: ModuleKey, ent: Entitlements): boolean {
  if (!canAccess(role, module)) return false;
  if (isUnrestricted(ent)) return true;
  if (!ent.modules.has(module)) return false;
  const needs = MODULE_INTEGRATIONS[module];
  return !needs || needs.length === 0 || needs.some((k) => ent.integrations.has(k));
}

export function hasFeature(ent: Entitlements, key: FeatureKey): boolean {
  return isUnrestricted(ent) || ent.features.has(key);
}

/** A capacity, falling back to the server's own setting and then to the built-in default. */
export function capacity(ent: Entitlements, key: CapacityKey, env = process.env): number {
  const set = ent.capacities.get(key);
  if (set !== undefined && set !== null) return set;
  const fromEnv = env[CAPACITY_ENV[key]];
  const parsed = fromEnv === undefined ? NaN : Number(fromEnv);
  return Number.isFinite(parsed) ? parsed : CAPACITY_DEFAULTS[key];
}

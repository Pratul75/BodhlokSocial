/**
 * The configuration that belongs to a workspace rather than to the server.
 *
 * These were environment variables: one GA4 property, one Google Ads customer, one website, one
 * list of email domains allowed to sign in — for the whole installation. That is correct for a
 * single-tenant application and wrong the moment there are two, because every workspace would
 * then read the first one's analytics and let the first one's staff in.
 *
 * Each is now a row against the workspace in the control plane, with the environment variable
 * kept as tenant #1's fallback so the live installation needs no change on the day it becomes
 * multi-tenant. Values are small and change rarely, so they are cached for a few seconds per
 * workspace, keyed by the workspace — never in a bare module variable.
 */
import { currentTenant, ownerSql } from "./client";

export const TENANT_SETTING_KEYS = [
  "ga4.property_id",
  "ga4.bq_project",
  "ga4.bq_dataset",
  "search_console.site",
  "google_ads.customer_id",
  "google_ads.login_customer_id",
  "google_ads.conversion_actions",
  "site.url",
  "auth.allowed_email_domains",
  "seo.page_catalog",
] as const;
export type TenantSettingKey = (typeof TENANT_SETTING_KEYS)[number];

/** What each used to be read from, and still is for tenant #1 when it has no row of its own. */
export const TENANT_SETTING_ENV: Record<TenantSettingKey, string> = {
  "ga4.property_id": "GA4_PROPERTY_ID",
  "ga4.bq_project": "GA4_BQ_PROJECT",
  "ga4.bq_dataset": "GA4_BQ_DATASET",
  "search_console.site": "SEARCH_CONSOLE_SITE",
  "google_ads.customer_id": "GOOGLE_ADS_CUSTOMER_ID",
  "google_ads.login_customer_id": "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
  "google_ads.conversion_actions": "GOOGLE_ADS_CONVERSION_ACTIONS",
  "site.url": "SEO_SITE_URL",
  "auth.allowed_email_domains": "ALLOWED_EMAIL_DOMAINS",
  "seo.page_catalog": "SEO_PAGE_CATALOG",
};

export const TENANT_SETTING_LABELS: Record<TenantSettingKey, string> = {
  "ga4.property_id": "GA4 property id",
  "ga4.bq_project": "GA4 BigQuery project",
  "ga4.bq_dataset": "GA4 BigQuery dataset",
  "search_console.site": "Search Console site",
  "google_ads.customer_id": "Google Ads customer id",
  "google_ads.login_customer_id": "Google Ads manager (login) customer id",
  "google_ads.conversion_actions": "Google Ads conversion actions (JSON)",
  "site.url": "Website address",
  "auth.allowed_email_domains": "Email domains allowed to sign in",
  "seo.page_catalog": "Use the built-in SEO page catalogue (on)",
};

export function isTenantSettingKey(key: string): key is TenantSettingKey {
  return (TENANT_SETTING_KEYS as readonly string[]).includes(key);
}

const TTL_MS = Number(process.env.TENANT_SETTING_CACHE_MS ?? 15_000);
const cache = new Map<string, { at: number; value: Map<string, string | null> }>();

export function forgetTenantSettings(tenantId?: string) {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

async function rowsFor(tenantId: string): Promise<Map<string, string | null>> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const rows = (await ownerSql()<{ key: string; value: string | null }[]>`
    select key, value from platform.tenant_settings where tenant_id = ${tenantId}`) as unknown as {
    key: string;
    value: string | null;
  }[];
  const value = new Map(rows.map((r) => [r.key, r.value]));
  cache.set(tenantId, { at: Date.now(), value });
  return value;
}

/** Every setting for one workspace, as stored — without the environment fallback. */
export async function storedSettings(tenantId: string): Promise<Map<string, string | null>> {
  return rowsFor(tenantId);
}

/**
 * One setting for the workspace this code is running for.
 *
 * Falls back to the environment variable only for tenant #1: the installation that has always
 * been configured that way. Any other workspace that has not been given a value has none, which
 * is what stops it quietly using tenant #1's analytics property or ad account.
 */
export async function tenantSetting(key: TenantSettingKey, env = process.env): Promise<string | null> {
  const tenant = currentTenant();
  const stored = (await rowsFor(tenant.id)).get(key);
  if (stored !== undefined && stored !== null && stored.trim() !== "") return stored.trim();
  if (tenant.dataSchema !== "public") return null;
  return env[TENANT_SETTING_ENV[key]]?.trim() || null;
}

/** Writes one setting. An empty value removes it, so tenant #1 falls back again. */
export async function setTenantSetting(
  tenantId: string,
  key: TenantSettingKey,
  value: string | null,
  by: string,
): Promise<void> {
  const sql = ownerSql();
  const trimmed = value?.trim() || null;
  if (trimmed === null) {
    await sql`delete from platform.tenant_settings where tenant_id = ${tenantId} and key = ${key}`;
  } else {
    await sql`
      insert into platform.tenant_settings (tenant_id, key, value, updated_by)
      values (${tenantId}, ${key}, ${trimmed}, ${by})
      on conflict (tenant_id, key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`;
  }
  forgetTenantSettings(tenantId);
}

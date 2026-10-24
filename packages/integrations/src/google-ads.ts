import type { AdSpendRow } from "./meta";

/**
 * Google Ads API over REST: daily spend per ad, and click-conversion uploads.
 * Switched on once the developer token is approved. Settings come from the environment:
 *   GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_LOGIN_CUSTOMER_ID (manager, optional),
 *   GOOGLE_ADS_CONVERSION_ACTIONS  JSON like {"registration":"123","activation":"456","paid":"789"}
 * and the OAuth grant from the google_ads connection.
 */
export const ADS_API_VERSION = process.env.GOOGLE_ADS_API_VERSION ?? "v21";
const BASE = "https://googleads.googleapis.com";

export interface GoogleAdsConfig {
  developerToken: string;
  customerId: string;
  loginCustomerId?: string;
  conversionActions: Partial<Record<"registration" | "activation" | "paid", string>>;
}

export function googleAdsConfigFromEnv(): GoogleAdsConfig | null {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/-/g, "");
  if (!developerToken || !customerId) return null;
  let conversionActions: GoogleAdsConfig["conversionActions"] = {};
  try {
    conversionActions = JSON.parse(process.env.GOOGLE_ADS_CONVERSION_ACTIONS ?? "{}");
  } catch {}
  return { developerToken, customerId, loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, ""), conversionActions };
}

export function headers(cfg: GoogleAdsConfig, accessToken: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": cfg.developerToken,
    "Content-Type": "application/json",
  };
  if (cfg.loginCustomerId) h["login-customer-id"] = cfg.loginCustomerId;
  return h;
}

export class GoogleAdsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export async function adsError(res: Response) {
  let detail = "";
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    detail = body.error?.message ?? "";
  } catch {}
  return new GoogleAdsError(`Google Ads API ${res.status}${detail ? `: ${detail}` : ""}`, res.status, res.status === 429 || res.status >= 500);
}

export const spendQuery = (since: string, until: string) =>
  `SELECT segments.date, campaign.id, campaign.name, ad_group_ad.ad.id, ad_group_ad.ad.name, ` +
  `metrics.cost_micros, metrics.impressions, metrics.clicks FROM ad_group_ad ` +
  `WHERE segments.date BETWEEN '${since}' AND '${until}' AND metrics.impressions > 0`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function fetchGoogleAdsSpend(cfg: GoogleAdsConfig, accessToken: string, since: string, until: string): Promise<AdSpendRow[]> {
  if (!DATE_RE.test(since) || !DATE_RE.test(until)) throw new Error("Dates must be YYYY-MM-DD.");
  const rows: AdSpendRow[] = [];
  let pageToken: string | undefined;
  do {
    const res = await fetch(`${BASE}/${ADS_API_VERSION}/customers/${cfg.customerId}/googleAds:search`, {
      method: "POST",
      headers: headers(cfg, accessToken),
      body: JSON.stringify({ query: spendQuery(since, until), pageToken }),
    });
    if (!res.ok) throw await adsError(res);
    const body = (await res.json()) as {
      results?: {
        segments: { date: string };
        campaign: { id: string; name: string };
        adGroupAd: { ad: { id: string; name?: string } };
        metrics: { costMicros?: string; impressions?: string; clicks?: string };
      }[];
      nextPageToken?: string;
    };
    for (const r of body.results ?? []) {
      rows.push({
        day: r.segments.date,
        platform: "google_ads",
        campaignId: r.campaign.id,
        campaignName: r.campaign.name,
        adId: r.adGroupAd.ad.id,
        adName: r.adGroupAd.ad.name || `Ad ${r.adGroupAd.ad.id}`,
        spend: Number(r.metrics.costMicros ?? 0) / 1_000_000,
        impressions: Number(r.metrics.impressions ?? 0),
        clicks: Number(r.metrics.clicks ?? 0),
      });
    }
    pageToken = body.nextPageToken || undefined;
  } while (pageToken);
  return rows;
}

export interface ConversionForGoogle {
  eventId: string;
  type: "registration" | "activation" | "paid";
  occurredAt: Date;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  emailSha256: string | null;
  phoneSha256: string | null;
  value: number | null;
  currency: string;
}

/** "yyyy-mm-dd hh:mm:ss+05:30", the format the API requires, in India time. */
export function conversionDateTime(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60_000);
  return `${ist.toISOString().slice(0, 19).replace("T", " ")}+05:30`;
}

export function buildClickConversion(cfg: GoogleAdsConfig, e: ConversionForGoogle) {
  const actionId = cfg.conversionActions[e.type];
  if (!actionId) return null;
  if (!e.gclid && !e.gbraid && !e.wbraid) return null;
  const c: Record<string, unknown> = {
    conversionAction: `customers/${cfg.customerId}/conversionActions/${actionId}`,
    conversionDateTime: conversionDateTime(e.occurredAt),
    orderId: e.eventId, // lets Google drop duplicates
  };
  if (e.gclid) c.gclid = e.gclid;
  else if (e.gbraid) c.gbraid = e.gbraid;
  else if (e.wbraid) c.wbraid = e.wbraid;
  if (e.value != null) {
    c.conversionValue = e.value;
    c.currencyCode = e.currency;
  }
  const ids: Record<string, string>[] = [];
  if (e.emailSha256) ids.push({ hashedEmail: e.emailSha256 });
  if (e.phoneSha256) ids.push({ hashedPhoneNumber: e.phoneSha256 });
  if (ids.length) c.userIdentifiers = ids; // enhanced conversions
  return c;
}

export async function uploadClickConversions(cfg: GoogleAdsConfig, accessToken: string, conversions: Record<string, unknown>[]) {
  if (conversions.length === 0) return { uploaded: 0, partialFailure: null as string | null };
  const res = await fetch(`${BASE}/${ADS_API_VERSION}/customers/${cfg.customerId}:uploadClickConversions`, {
    method: "POST",
    headers: headers(cfg, accessToken),
    body: JSON.stringify({ conversions, partialFailure: true }),
  });
  if (!res.ok) throw await adsError(res);
  const body = (await res.json()) as { partialFailureError?: { message?: string }; results?: unknown[] };
  return { uploaded: body.results?.length ?? 0, partialFailure: body.partialFailureError?.message ?? null };
}

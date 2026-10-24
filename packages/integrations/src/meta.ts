import { sha256 } from "./bodh-events";

/**
 * Meta Graph API: Conversions API for server-side events, and ad insights for daily spend.
 * Credentials (stored as JSON in the secrets store):
 *   meta_capi       { pixel_id, access_token, test_event_code? }
 *   meta_marketing  { ad_account_id, access_token }   (system user token)
 */
export const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v23.0";
const GRAPH = "https://graph.facebook.com";

export interface CapiCredentials {
  pixel_id: string;
  access_token: string;
  test_event_code?: string;
}

export interface MarketingCredentials {
  ad_account_id: string;
  access_token: string;
}

/** The parts of a stored conversion event the Conversions API needs. */
export interface ConversionForCapi {
  eventId: string;
  type: "registration" | "activation" | "paid";
  occurredAt: Date;
  userRef: string;
  emailSha256: string | null;
  phoneSha256: string | null;
  platform: string;
  value: number | null;
  currency: string;
  plan: string | null;
  fbp: string | null;
  fbc: string | null;
  fbclid: string | null;
  landingPage: string | null;
  clientIp: string | null;
  userAgent: string | null;
}

const EVENT_NAMES = { registration: "CompleteRegistration", activation: "FirstChartGenerated", paid: "Purchase" } as const;

/** fbc from a click ID when the browser cookie wasn't captured: fb.1.<ms>.<fbclid> */
function fbcFrom(e: ConversionForCapi): string | undefined {
  if (e.fbc) return e.fbc;
  if (e.fbclid) return `fb.1.${e.occurredAt.getTime()}.${e.fbclid}`;
  return undefined;
}

export function buildCapiEvent(e: ConversionForCapi) {
  const userData: Record<string, unknown> = { external_id: [sha256(e.userRef)] };
  if (e.emailSha256) userData.em = [e.emailSha256];
  if (e.phoneSha256) userData.ph = [e.phoneSha256];
  if (e.fbp) userData.fbp = e.fbp;
  const fbc = fbcFrom(e);
  if (fbc) userData.fbc = fbc;
  if (e.clientIp) userData.client_ip_address = e.clientIp;
  if (e.userAgent) userData.client_user_agent = e.userAgent;

  const event: Record<string, unknown> = {
    event_name: EVENT_NAMES[e.type],
    event_time: Math.floor(e.occurredAt.getTime() / 1000),
    event_id: e.eventId, // same ID as the browser pixel event, so Meta deduplicates
    action_source: e.platform === "web" ? "website" : "app",
    user_data: userData,
  };
  if (e.landingPage && e.platform === "web") event.event_source_url = e.landingPage;
  if (e.type === "paid" && e.value != null) {
    event.custom_data = { value: e.value, currency: e.currency, content_name: e.plan ?? undefined };
  }
  return event;
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export async function graphError(res: Response): Promise<MetaApiError> {
  let detail = "";
  try {
    const body = (await res.json()) as { error?: { message?: string; code?: number } };
    detail = body.error?.message ?? "";
  } catch {}
  // 429, 5xx and Meta's throttling codes are worth retrying; 400s are not.
  const retryable = res.status === 429 || res.status >= 500;
  return new MetaApiError(`Meta API ${res.status}${detail ? `: ${detail}` : ""}`, res.status, retryable);
}

export async function sendCapiEvents(creds: CapiCredentials, events: ConversionForCapi[]): Promise<{ received: number }> {
  if (events.length === 0) return { received: 0 };
  const body: Record<string, unknown> = { data: events.map(buildCapiEvent) };
  if (creds.test_event_code) body.test_event_code = creds.test_event_code;
  const res = await fetch(`${GRAPH}/${GRAPH_VERSION}/${encodeURIComponent(creds.pixel_id)}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${creds.access_token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await graphError(res);
  const json = (await res.json()) as { events_received?: number };
  return { received: json.events_received ?? 0 };
}

export interface AdSpendRow {
  day: string; // YYYY-MM-DD in the ad account's time zone
  platform: "meta_ads" | "google_ads";
  campaignId: string;
  campaignName: string;
  adId: string;
  adName: string;
  spend: number; // account currency, assumed INR
  impressions: number;
  clicks: number;
}

/** Daily spend, impressions and link clicks per ad for a date range. */
export async function fetchMetaSpend(creds: MarketingCredentials, since: string, until: string): Promise<AdSpendRow[]> {
  const account = creds.ad_account_id.startsWith("act_") ? creds.ad_account_id : `act_${creds.ad_account_id}`;
  const params = new URLSearchParams({
    level: "ad",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields: "date_start,campaign_id,campaign_name,ad_id,ad_name,spend,impressions,inline_link_clicks",
    limit: "500",
  });
  let url: string | null = `${GRAPH}/${GRAPH_VERSION}/${account}/insights?${params}`;
  const rows: AdSpendRow[] = [];
  while (url) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${creds.access_token}` } });
    if (!res.ok) throw await graphError(res);
    const body = (await res.json()) as {
      data: { date_start: string; campaign_id: string; campaign_name: string; ad_id: string; ad_name: string; spend?: string; impressions?: string; inline_link_clicks?: string }[];
      paging?: { next?: string };
    };
    for (const r of body.data) {
      rows.push({
        day: r.date_start,
        platform: "meta_ads",
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        adId: r.ad_id,
        adName: r.ad_name,
        spend: Number(r.spend ?? 0),
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.inline_link_clicks ?? 0),
      });
    }
    url = body.paging?.next ?? null;
  }
  return rows;
}

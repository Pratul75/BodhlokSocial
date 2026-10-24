/**
 * Reading and changing ads on Meta (Graph API) and Google Ads (REST). Amounts in and out are
 * INR: Meta stores minor units (paise), Google micros. Statuses are normalised to
 * active | paused | removed | other.
 */
import { ADS_API_VERSION, adsError, headers, type GoogleAdsConfig } from "./google-ads";
import { GRAPH_VERSION, graphError, type MarketingCredentials } from "./meta";

const GRAPH = "https://graph.facebook.com";
const GADS = "https://googleads.googleapis.com";

export type Platform = "meta_ads" | "google_ads";
export type Level = "campaign" | "ad_set" | "ad";

export interface Entity {
  platform: Platform;
  level: Level;
  platformId: string;
  parentId: string | null;
  campaignId: string | null;
  name: string;
  status: "active" | "paused" | "removed" | "other";
  objective?: string | null;
  dailyBudget: number | null;
  bid: number | null;
  bidKind: "cpc" | "target_cpa" | "bid_cap" | "cost_cap" | null;
  details: Record<string, unknown>;
}

/** Copy for a new test variant. Meta uses headline + text; Google needs 3+ headlines and 2+ descriptions. */
export interface VariantCopy {
  name: string;
  headline?: string;
  text?: string;
  headlines?: string[];
  descriptions?: string[];
}

/* ---------------- Meta ---------------- */

const actId = (c: MarketingCredentials) => (c.ad_account_id.startsWith("act_") ? c.ad_account_id : `act_${c.ad_account_id}`);
const metaStatus = (s?: string): Entity["status"] => (s === "ACTIVE" ? "active" : s === "PAUSED" ? "paused" : s === "DELETED" || s === "ARCHIVED" ? "removed" : "other");
const paise = (v?: string | number | null) => (v === undefined || v === null || v === "" ? null : Number(v) / 100);

async function metaGetAll<T>(creds: MarketingCredentials, path: string, fields: string): Promise<T[]> {
  let url: string | null = `${GRAPH}/${GRAPH_VERSION}/${path}?${new URLSearchParams({ fields, limit: "200" })}`;
  const out: T[] = [];
  while (url) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${creds.access_token}` } });
    if (!res.ok) throw await graphError(res);
    const body = (await res.json()) as { data: T[]; paging?: { next?: string } };
    out.push(...body.data);
    url = body.paging?.next ?? null;
  }
  return out;
}

export async function fetchMetaStructure(creds: MarketingCredentials): Promise<Entity[]> {
  const act = actId(creds);
  const [camps, sets, ads] = await Promise.all([
    metaGetAll<{ id: string; name: string; status?: string; objective?: string; daily_budget?: string }>(creds, `${act}/campaigns`, "id,name,status,objective,daily_budget"),
    metaGetAll<{ id: string; name: string; campaign_id: string; status?: string; daily_budget?: string; bid_amount?: number; bid_strategy?: string }>(
      creds,
      `${act}/adsets`,
      "id,name,campaign_id,status,daily_budget,bid_amount,bid_strategy",
    ),
    metaGetAll<{ id: string; name: string; adset_id: string; campaign_id: string; status?: string; creative?: { id: string; title?: string; body?: string } }>(
      creds,
      `${act}/ads`,
      "id,name,adset_id,campaign_id,status,creative{id,title,body}",
    ),
  ]);
  return [
    ...camps.map((c): Entity => ({ platform: "meta_ads", level: "campaign", platformId: c.id, parentId: null, campaignId: c.id, name: c.name, status: metaStatus(c.status), objective: c.objective ?? null, dailyBudget: paise(c.daily_budget), bid: null, bidKind: null, details: {} })),
    ...sets.map((s): Entity => ({
      platform: "meta_ads",
      level: "ad_set",
      platformId: s.id,
      parentId: s.campaign_id,
      campaignId: s.campaign_id,
      name: s.name,
      status: metaStatus(s.status),
      dailyBudget: paise(s.daily_budget),
      bid: paise(s.bid_amount),
      bidKind: s.bid_amount ? (s.bid_strategy === "COST_CAP" ? "cost_cap" : "bid_cap") : null,
      details: { bidStrategy: s.bid_strategy ?? null },
    })),
    ...ads.map((a): Entity => ({
      platform: "meta_ads",
      level: "ad",
      platformId: a.id,
      parentId: a.adset_id,
      campaignId: a.campaign_id,
      name: a.name,
      status: metaStatus(a.status),
      dailyBudget: null,
      bid: null,
      bidKind: null,
      details: { creativeId: a.creative?.id ?? null, headline: a.creative?.title ?? null, text: a.creative?.body ?? null },
    })),
  ];
}

async function metaPost(creds: MarketingCredentials, path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`${GRAPH}/${GRAPH_VERSION}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.access_token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  if (!res.ok) throw await graphError(res);
  return (await res.json()) as Record<string, unknown>;
}

export const metaSetStatus = (creds: MarketingCredentials, id: string, status: "active" | "paused") => metaPost(creds, id, { status: status === "active" ? "ACTIVE" : "PAUSED" });
export const metaSetBudget = (creds: MarketingCredentials, id: string, inr: number) => metaPost(creds, id, { daily_budget: String(Math.round(inr * 100)) });
export const metaSetBid = (creds: MarketingCredentials, id: string, inr: number) => metaPost(creds, id, { bid_amount: String(Math.round(inr * 100)) });

/**
 * A new ad in the same ad set as the base ad, with the base creative's image, link and call to
 * action and new primary text and headline. Works for link ads (object_story_spec.link_data).
 */
export async function metaCreateVariant(creds: MarketingCredentials, base: { platformId: string; parentId: string; details: Record<string, unknown> }, copy: VariantCopy): Promise<string> {
  const creativeId = String(base.details.creativeId ?? "");
  if (!creativeId) throw new Error("The base ad has no creative to copy.");
  const res = await fetch(`${GRAPH}/${GRAPH_VERSION}/${creativeId}?fields=object_story_spec`, { headers: { Authorization: `Bearer ${creds.access_token}` } });
  if (!res.ok) throw await graphError(res);
  const spec = ((await res.json()) as { object_story_spec?: { page_id?: string; instagram_user_id?: string; link_data?: Record<string, unknown> } }).object_story_spec;
  if (!spec?.link_data) throw new Error("Only link ads can be varied automatically; this one uses another format. Make the variant in Ads Manager.");
  const story = { ...spec, link_data: { ...spec.link_data, message: copy.text ?? spec.link_data.message, name: copy.headline ?? spec.link_data.name } };
  const creative = await metaPost(creds, `${actId(creds)}/adcreatives`, { name: `${copy.name} creative`, object_story_spec: JSON.stringify(story) });
  const ad = await metaPost(creds, `${actId(creds)}/ads`, { name: copy.name, adset_id: base.parentId, creative: JSON.stringify({ creative_id: creative.id }), status: "ACTIVE" });
  return String(ad.id);
}

/* ---------------- Google Ads ---------------- */

const gStatus = (s?: string): Entity["status"] => (s === "ENABLED" ? "active" : s === "PAUSED" ? "paused" : s === "REMOVED" ? "removed" : "other");
const micros = (v?: string | number | null) => (v === undefined || v === null || v === "" || Number(v) === 0 ? null : Number(v) / 1_000_000);
const toMicros = (inr: number) => String(Math.round(inr * 1_000_000));

async function gSearch<T>(cfg: GoogleAdsConfig, token: string, query: string): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  do {
    const res = await fetch(`${GADS}/${ADS_API_VERSION}/customers/${cfg.customerId}/googleAds:search`, {
      method: "POST",
      headers: headers(cfg, token),
      body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
    });
    if (!res.ok) throw await adsError(res);
    const body = (await res.json()) as { results?: T[]; nextPageToken?: string };
    out.push(...(body.results ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return out;
}

export async function fetchGoogleStructure(cfg: GoogleAdsConfig, token: string): Promise<Entity[]> {
  type C = { campaign: { id: string; name: string; status: string; advertisingChannelType?: string; biddingStrategyType?: string; targetCpa?: { targetCpaMicros?: string } }; campaignBudget?: { amountMicros?: string; resourceName?: string } };
  type G = { adGroup: { id: string; name: string; status: string; cpcBidMicros?: string; targetCpaMicros?: string }; campaign: { id: string } };
  type A = {
    adGroupAd: { status: string; ad: { id: string; name?: string; finalUrls?: string[]; responsiveSearchAd?: { headlines?: { text: string }[]; descriptions?: { text: string }[] } } };
    adGroup: { id: string };
    campaign: { id: string };
  };
  const [camps, groups, ads] = await Promise.all([
    gSearch<C>(cfg, token, "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign.target_cpa.target_cpa_micros, campaign_budget.amount_micros, campaign_budget.resource_name FROM campaign WHERE campaign.status != 'REMOVED'"),
    gSearch<G>(cfg, token, "SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros, ad_group.target_cpa_micros, campaign.id FROM ad_group WHERE ad_group.status != 'REMOVED'"),
    gSearch<A>(
      cfg,
      token,
      "SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group.id, campaign.id FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'",
    ),
  ]);
  return [
    ...camps.map((c): Entity => ({
      platform: "google_ads",
      level: "campaign",
      platformId: c.campaign.id,
      parentId: null,
      campaignId: c.campaign.id,
      name: c.campaign.name,
      status: gStatus(c.campaign.status),
      objective: c.campaign.advertisingChannelType ?? null,
      dailyBudget: micros(c.campaignBudget?.amountMicros),
      bid: micros(c.campaign.targetCpa?.targetCpaMicros),
      bidKind: c.campaign.targetCpa?.targetCpaMicros ? "target_cpa" : null,
      details: { budgetResource: c.campaignBudget?.resourceName ?? null, biddingStrategy: c.campaign.biddingStrategyType ?? null },
    })),
    ...groups.map((g): Entity => {
      const cpa = micros(g.adGroup.targetCpaMicros);
      return {
        platform: "google_ads",
        level: "ad_set",
        platformId: g.adGroup.id,
        parentId: g.campaign.id,
        campaignId: g.campaign.id,
        name: g.adGroup.name,
        status: gStatus(g.adGroup.status),
        dailyBudget: null,
        bid: cpa ?? micros(g.adGroup.cpcBidMicros),
        bidKind: cpa ? "target_cpa" : g.adGroup.cpcBidMicros ? "cpc" : null,
        details: {},
      };
    }),
    ...ads.map((a): Entity => ({
      platform: "google_ads",
      level: "ad",
      platformId: a.adGroupAd.ad.id,
      parentId: a.adGroup.id,
      campaignId: a.campaign.id,
      name: a.adGroupAd.ad.name || `Ad ${a.adGroupAd.ad.id}`,
      status: gStatus(a.adGroupAd.status),
      dailyBudget: null,
      bid: null,
      bidKind: null,
      details: {
        finalUrls: a.adGroupAd.ad.finalUrls ?? [],
        headlines: (a.adGroupAd.ad.responsiveSearchAd?.headlines ?? []).map((h) => h.text),
        descriptions: (a.adGroupAd.ad.responsiveSearchAd?.descriptions ?? []).map((d) => d.text),
      },
    })),
  ];
}

async function gMutate(cfg: GoogleAdsConfig, token: string, resource: string, operations: unknown[]): Promise<{ results?: { resourceName: string }[] }> {
  const res = await fetch(`${GADS}/${ADS_API_VERSION}/customers/${cfg.customerId}/${resource}:mutate`, { method: "POST", headers: headers(cfg, token), body: JSON.stringify({ operations }) });
  if (!res.ok) throw await adsError(res);
  return (await res.json()) as { results?: { resourceName: string }[] };
}

const cust = (cfg: GoogleAdsConfig) => `customers/${cfg.customerId}`;

export const googleSetAdStatus = (cfg: GoogleAdsConfig, token: string, adGroupId: string, adId: string, status: "active" | "paused") =>
  gMutate(cfg, token, "adGroupAds", [{ update: { resourceName: `${cust(cfg)}/adGroupAds/${adGroupId}~${adId}`, status: status === "active" ? "ENABLED" : "PAUSED" }, updateMask: "status" }]);

export const googleSetBudget = (cfg: GoogleAdsConfig, token: string, budgetResource: string, inr: number) =>
  gMutate(cfg, token, "campaignBudgets", [{ update: { resourceName: budgetResource, amountMicros: toMicros(inr) }, updateMask: "amount_micros" }]);

export function googleSetBid(cfg: GoogleAdsConfig, token: string, entity: { level: Level; platformId: string; bidKind: string | null }, inr: number) {
  if (entity.level === "campaign") {
    return gMutate(cfg, token, "campaigns", [{ update: { resourceName: `${cust(cfg)}/campaigns/${entity.platformId}`, targetCpa: { targetCpaMicros: toMicros(inr) } }, updateMask: "target_cpa.target_cpa_micros" }]);
  }
  const field = entity.bidKind === "target_cpa" ? { targetCpaMicros: toMicros(inr), mask: "target_cpa_micros" } : { cpcBidMicros: toMicros(inr), mask: "cpc_bid_micros" };
  const { mask, ...value } = field;
  return gMutate(cfg, token, "adGroups", [{ update: { resourceName: `${cust(cfg)}/adGroups/${entity.platformId}`, ...value }, updateMask: mask }]);
}

/** A new responsive search ad in the base ad's ad group, with the same final URL. */
export async function googleCreateVariant(cfg: GoogleAdsConfig, token: string, base: { parentId: string; details: Record<string, unknown> }, copy: VariantCopy): Promise<string> {
  const finalUrls = (base.details.finalUrls as string[] | undefined) ?? [];
  if (!finalUrls.length) throw new Error("The base ad has no final URL to reuse.");
  if ((copy.headlines?.length ?? 0) < 3 || (copy.descriptions?.length ?? 0) < 2) throw new Error("A responsive search ad needs at least 3 headlines and 2 descriptions.");
  const r = await gMutate(cfg, token, "adGroupAds", [
    {
      create: {
        adGroup: `${cust(cfg)}/adGroups/${base.parentId}`,
        status: "ENABLED",
        ad: { name: copy.name, finalUrls, responsiveSearchAd: { headlines: copy.headlines!.map((text) => ({ text })), descriptions: copy.descriptions!.map((text) => ({ text })) } },
      },
    },
  ]);
  const name = r.results?.[0]?.resourceName ?? "";
  return name.split("~").pop() ?? name;
}

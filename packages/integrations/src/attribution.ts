import type { AttributionChannel } from "@bodh/shared";

/**
 * First-touch attribution for a registration, from what the landing page captured.
 *
 * UTM rules for every link we control (see docs/tracking.md):
 *   utm_source   = google | meta | youtube | instagram | facebook | linkedin | newsletter | whatsapp
 *   utm_medium   = cpc (paid search/video) | paid_social | social | email | whatsapp | referral
 *   utm_campaign = platform campaign ID   ({{campaign.id}} on Meta, {campaignid} on Google)
 *   utm_content  = platform ad ID         ({{ad.id}} on Meta, {creative} on Google)
 */
export interface TouchPoint {
  utmSource?: string | null;
  utmMedium?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  fbclid?: string | null;
  referralCode?: string | null;
  /** document.referrer at landing, full URL or hostname. */
  referrer?: string | null;
}

const PAID_MEDIUMS = new Set(["cpc", "ppc", "paid", "paidsearch", "paid_search", "paid_social", "paidsocial", "cpm", "display", "video", "ads"]);
const META_SOURCES = new Set(["meta", "facebook", "fb", "instagram", "ig", "audience_network", "messenger"]);
const SEARCH_ENGINES = ["google.", "bing.com", "duckduckgo.com", "search.yahoo.", "yandex.", "ecosia.org", "baidu.com"];

const norm = (v?: string | null) => (v ?? "").trim().toLowerCase();

function referrerHost(ref?: string | null): string {
  const r = norm(ref);
  if (!r) return "";
  try {
    return new URL(r.includes("://") ? r : `https://${r}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const hostIs = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export function attribute(t: TouchPoint): AttributionChannel {
  const source = norm(t.utmSource);
  const medium = norm(t.utmMedium);
  const host = referrerHost(t.referrer);
  const paid = PAID_MEDIUMS.has(medium);

  if (norm(t.referralCode)) return "referral";

  // Google Ads, including YouTube ads, which run through Google Ads.
  if (t.gclid || t.gbraid || t.wbraid) return "google_ads";
  if (paid && (source === "google" || source === "youtube" || source === "adwords")) return "google_ads";

  // Meta Ads. A bare fbclid also appears on organic shares, so it needs a paid medium.
  if (paid && (META_SOURCES.has(source) || (!source && t.fbclid))) return "meta_ads";

  if (medium === "email" || source === "newsletter" || source === "email") return "email";
  if (medium === "whatsapp" || source === "whatsapp" || hostIs(host, "whatsapp.com") || hostIs(host, "wa.me")) return "whatsapp";
  if (medium === "referral" && source && !META_SOURCES.has(source)) return "referral";

  if (source === "youtube" || hostIs(host, "youtube.com") || hostIs(host, "youtu.be")) return "youtube";
  if (source === "instagram" || source === "ig" || hostIs(host, "instagram.com")) return "instagram";
  if (META_SOURCES.has(source) || hostIs(host, "facebook.com") || hostIs(host, "fb.com") || hostIs(host, "m.facebook.com") || t.fbclid) {
    return "facebook";
  }
  if (source === "linkedin" || hostIs(host, "linkedin.com") || hostIs(host, "lnkd.in")) return "linkedin";

  if (medium === "organic" || SEARCH_ENGINES.some((e) => host.startsWith(e) || host.includes(`.${e}`))) return "seo";

  if (!source && !medium && !host) return "direct";
  return "other";
}

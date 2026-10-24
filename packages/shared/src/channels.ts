export const CHANNELS = [
  "youtube",
  "instagram",
  "facebook",
  "linkedin",
  "google_ads",
  "meta_ads",
  "seo",
  "gbp",
  "reddit",
  "quora",
  "whatsapp",
  "email",
] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<Channel, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  seo: "SEO + blog",
  gbp: "Google Business Profile",
  reddit: "Reddit",
  quora: "Quora",
  whatsapp: "WhatsApp",
  email: "Email",
};

export const FORMATS = ["reel", "short", "long_video", "image", "carousel", "blog", "post"] as const;
export type Format = (typeof FORMATS)[number];

export const FORMAT_LABELS: Record<Format, string> = {
  reel: "Reel",
  short: "Short",
  long_video: "Long video",
  image: "Image",
  carousel: "Carousel",
  blog: "Blog",
  post: "Post",
};

/** Funnel stages, in order. The North Star is weekly `activated`. */
export const FUNNEL_STAGES = ["spend", "clicks", "registrations", "activations", "paid"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

/**
 * Channels a registration can be attributed to. Paid channels carry spend from the
 * ad platforms; the rest are organic.
 */
export const ATTRIBUTION_CHANNELS = [
  "google_ads",
  "meta_ads",
  "youtube",
  "instagram",
  "facebook",
  "linkedin",
  "seo",
  "referral",
  "email",
  "whatsapp",
  "direct",
  "other",
] as const;
export type AttributionChannel = (typeof ATTRIBUTION_CHANNELS)[number];

export const ATTRIBUTION_LABELS: Record<AttributionChannel, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  youtube: "YouTube (organic)",
  instagram: "Instagram (organic)",
  facebook: "Facebook (organic)",
  linkedin: "LinkedIn",
  seo: "Search (organic)",
  referral: "Referral codes",
  email: "Email",
  whatsapp: "WhatsApp",
  direct: "Direct",
  other: "Other",
};

export const PAID_CHANNELS: readonly AttributionChannel[] = ["google_ads", "meta_ads"];

export function channelLabel(channel: string): string {
  return (ATTRIBUTION_LABELS as Record<string, string>)[channel] ?? channel;
}

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

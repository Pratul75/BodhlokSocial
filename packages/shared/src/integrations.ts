export type ConnectMethod = "oauth" | "api_key" | "service_account" | "internal" | "none";

export interface IntegrationDef {
  key: string;
  name: string;
  usedFor: string;
  method: ConnectMethod;
  /** Extra step outside the app before this can connect, written to follow "Needs". */
  prerequisite?: string;
  group: "AI" | "Ads" | "Social" | "Search" | "Analytics" | "Messaging" | "Internal";
  /** For credentials with several parts: the form fields, stored together as JSON. */
  fields?: { name: string; label: string; secret?: boolean; optional?: boolean; placeholder?: string }[];
  /** For Google OAuth integrations: scopes requested, and whether the connect flow is switched on. */
  googleOAuth?: { scopes: string[]; enabled: boolean };
}

/** From section 6 of the build plan. */
export const INTEGRATIONS: readonly IntegrationDef[] = [
  { key: "anthropic", name: "Anthropic API", usedFor: "All agents", method: "api_key", group: "AI" },
  { key: "vertex", name: "Vertex AI (Imagen, Veo, Gemini)", usedFor: "Image and video generation, Gemini visibility checks", method: "service_account", group: "AI" },
  { key: "openai", name: "OpenAI API", usedFor: "Weekly check: does ChatGPT mention Asttrolok", method: "api_key", group: "AI" },
  { key: "perplexity", name: "Perplexity API", usedFor: "Weekly check: does Perplexity mention Asttrolok", method: "api_key", group: "AI" },
  { key: "google_ads", name: "Google Ads API", usedFor: "Ads management", method: "oauth", prerequisite: "developer token approval", group: "Ads", googleOAuth: { scopes: ["https://www.googleapis.com/auth/adwords"], enabled: false } },
  {
    key: "meta_marketing",
    name: "Meta Marketing API",
    usedFor: "Daily ad spend, ads, lead forms",
    method: "api_key",
    prerequisite: "Meta app review",
    group: "Ads",
    fields: [
      { name: "ad_account_id", label: "Ad account ID", placeholder: "act_1234567890" },
      { name: "access_token", label: "System user access token", secret: true },
    ],
  },
  {
    key: "meta_capi",
    name: "Meta Conversions API",
    usedFor: "Sends registrations, first charts and purchases to Meta",
    method: "api_key",
    group: "Ads",
    fields: [
      { name: "pixel_id", label: "Dataset (Pixel) ID", placeholder: "1234567890" },
      { name: "access_token", label: "Conversions API access token", secret: true },
      { name: "test_event_code", label: "Test event code", optional: true, placeholder: "TEST12345, while testing only" },
    ],
  },
  {
    key: "postiz",
    name: "Postiz",
    usedFor: "Publishes approved posts to Instagram, Facebook, LinkedIn and YouTube",
    method: "api_key",
    group: "Social",
    fields: [
      { name: "api_url", label: "Public API URL", placeholder: "https://postiz.example.com/api/public/v1" },
      { name: "api_key", label: "API key (Postiz Settings > Developers)", secret: true },
    ],
  },
  { key: "meta_pages", name: "Instagram + Facebook Pages", usedFor: "Organic posting, connected inside Postiz", method: "none", group: "Social" },
  { key: "youtube", name: "YouTube Data API", usedFor: "Uploads, comments, analytics", method: "oauth", prerequisite: "upload quota audit", group: "Social", googleOAuth: { scopes: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.force-ssl", "https://www.googleapis.com/auth/yt-analytics.readonly"], enabled: false } },
  { key: "linkedin", name: "LinkedIn", usedFor: "Company page posting, connected inside Postiz", method: "none", group: "Social" },
  { key: "reddit", name: "Reddit API", usedFor: "Find questions, post approved answers", method: "oauth", group: "Social" },
  { key: "quora", name: "Quora", usedFor: "Find questions (drafts only, a person posts)", method: "none", group: "Social" },
  { key: "gbp", name: "Google Business Profile API", usedFor: "Posts, reviews", method: "oauth", prerequisite: "access request", group: "Search", googleOAuth: { scopes: ["https://www.googleapis.com/auth/business.manage"], enabled: false } },
  { key: "search_console", name: "Google Search Console", usedFor: "Search data, keyword positions", method: "oauth", group: "Search", googleOAuth: { scopes: ["https://www.googleapis.com/auth/webmasters.readonly"], enabled: true } },
  {
    key: "dataforseo",
    name: "DataForSEO",
    usedFor: "Keywords and rankings, Google Trends, weekly site audit",
    method: "api_key",
    group: "Search",
    fields: [
      { name: "login", label: "API login (email)", placeholder: "you@rechargestudio.com" },
      { name: "password", label: "API password (DataForSEO dashboard > API Access)", secret: true },
      { name: "target", label: "BODH's website domain", placeholder: "asttrolok.com" },
    ],
  },
  { key: "semrush", name: "Semrush or Ahrefs", usedFor: "Competitor data (optional)", method: "api_key", group: "Search" },
  { key: "ga4", name: "GA4 / Firebase", usedFor: "Web sessions per channel, from the BigQuery export", method: "service_account", group: "Analytics" },
  { key: "whatsapp", name: "WhatsApp Business API", usedFor: "Onboarding messages", method: "api_key", group: "Messaging" },
  { key: "email", name: "Email (Brevo or SendGrid)", usedFor: "Onboarding emails", method: "api_key", group: "Messaging" },
  { key: "bodh", name: "BODH backend", usedFor: "Registration, first-chart and paid events", method: "internal", group: "Internal" },
];

export function getIntegration(key: string): IntegrationDef | undefined {
  return INTEGRATIONS.find((i) => i.key === key);
}

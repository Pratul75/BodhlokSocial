export type ConnectMethod = "oauth" | "api_key" | "service_account" | "internal" | "none";

export interface IntegrationDef {
  key: string;
  name: string;
  usedFor: string;
  method: ConnectMethod;
  /** Extra step outside the app before this can connect, written to follow "Needs". */
  prerequisite?: string;
  group: "AI" | "Ads" | "Social" | "Search" | "Analytics" | "Messaging" | "Internal";
}

/** From section 6 of the build plan. */
export const INTEGRATIONS: readonly IntegrationDef[] = [
  { key: "anthropic", name: "Anthropic API", usedFor: "All agents", method: "api_key", group: "AI" },
  { key: "vertex", name: "Vertex AI (Imagen, Veo, Gemini)", usedFor: "Image and video generation", method: "service_account", group: "AI" },
  { key: "google_ads", name: "Google Ads API", usedFor: "Ads management", method: "oauth", prerequisite: "developer token approval", group: "Ads" },
  { key: "meta_marketing", name: "Meta Marketing API", usedFor: "Ads, lead forms", method: "oauth", prerequisite: "Meta app review", group: "Ads" },
  { key: "meta_capi", name: "Meta Conversions API", usedFor: "Server-side conversions", method: "api_key", group: "Ads" },
  { key: "postiz", name: "Postiz", usedFor: "Social scheduling for all channels", method: "api_key", group: "Social" },
  { key: "meta_pages", name: "Instagram + Facebook Pages", usedFor: "Organic posting", method: "oauth", group: "Social" },
  { key: "youtube", name: "YouTube Data API", usedFor: "Uploads, comments, analytics", method: "oauth", prerequisite: "upload quota audit", group: "Social" },
  { key: "linkedin", name: "LinkedIn", usedFor: "Company page posting", method: "oauth", group: "Social" },
  { key: "reddit", name: "Reddit API", usedFor: "Find questions, post approved answers", method: "oauth", group: "Social" },
  { key: "quora", name: "Quora", usedFor: "Find questions (drafts only, a person posts)", method: "none", group: "Social" },
  { key: "gbp", name: "Google Business Profile API", usedFor: "Posts, reviews", method: "oauth", prerequisite: "access request", group: "Search" },
  { key: "search_console", name: "Google Search Console", usedFor: "Search data", method: "oauth", group: "Search" },
  { key: "dataforseo", name: "DataForSEO", usedFor: "Keywords, SERP, backlinks, audits", method: "api_key", group: "Search" },
  { key: "semrush", name: "Semrush or Ahrefs", usedFor: "Competitor data (optional)", method: "api_key", group: "Search" },
  { key: "ga4", name: "GA4 / Firebase", usedFor: "Funnel, registrations, activation", method: "service_account", group: "Analytics" },
  { key: "whatsapp", name: "WhatsApp Business API", usedFor: "Onboarding messages", method: "api_key", group: "Messaging" },
  { key: "email", name: "Email (Brevo or SendGrid)", usedFor: "Onboarding emails", method: "api_key", group: "Messaging" },
  { key: "bodh", name: "BODH backend", usedFor: "Registration and activation events", method: "internal", group: "Internal" },
];

export function getIntegration(key: string): IntegrationDef | undefined {
  return INTEGRATIONS.find((i) => i.key === key);
}

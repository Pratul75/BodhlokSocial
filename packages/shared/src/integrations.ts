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
  /** Not built yet: the card explains this and refuses credentials instead of storing a key nothing reads. */
  planned?: string;
  /** For Google OAuth integrations: scopes requested, and whether the connect flow is switched on. */
  googleOAuth?: { scopes: string[]; enabled: boolean };
  /** A sign-in flow of its own (not Google): the card links to /api/connect/<key>/start once its app credentials are saved. */
  customOAuth?: "reddit";
}

/** From section 6 of the build plan. */
export const INTEGRATIONS: readonly IntegrationDef[] = [
  { key: "anthropic", name: "Anthropic API", usedFor: "All agents", method: "api_key", group: "AI" },
  { key: "vertex", name: "Vertex AI (Imagen, Veo, Gemini)", usedFor: "Image and video generation, Gemini visibility checks", method: "service_account", group: "AI" },
  { key: "openai", name: "OpenAI API", usedFor: "Weekly check: does ChatGPT mention Bodhlok", method: "api_key", group: "AI" },
  { key: "perplexity", name: "Perplexity API", usedFor: "Weekly check: does Perplexity mention Bodhlok", method: "api_key", group: "AI" },
  { key: "google_ads", name: "Google Ads API", usedFor: "Ads management: spend, pausing ads, bids, budgets, tests", method: "oauth", prerequisite: "developer token approval (set GOOGLE_ADS_DEVELOPER_TOKEN and GOOGLE_ADS_CUSTOMER_ID on the server)", group: "Ads", googleOAuth: { scopes: ["https://www.googleapis.com/auth/adwords"], enabled: true } },
  {
    key: "meta_marketing",
    name: "Meta Marketing API",
    usedFor: "Daily ad spend; pausing ads, bids, budgets and tests; lead forms",
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
  {
    key: "postiz_app",
    name: "Postiz sign-in (OAuth app)",
    usedFor: "Only to connect Postiz by signing in instead of pasting an API key. In Postiz: Settings > Developers > Apps, with the redirect URL shown here.",
    method: "api_key",
    group: "Social",
    fields: [
      { name: "client_id", label: "Client ID (starts pca_)", placeholder: "pca_..." },
      { name: "client_secret", label: "Client secret (starts pcs_)", secret: true },
      { name: "app_url", label: "Your own Postiz server's address (leave empty for postiz.com)", optional: true, placeholder: "Leave empty for Postiz Cloud" },
    ],
  },
  { key: "meta_pages", name: "Instagram + Facebook Pages", usedFor: "Organic posting, connected inside Postiz", method: "none", group: "Social" },
  {
    key: "youtube",
    name: "YouTube comments",
    usedFor: "Reads questions in comments on BODH's channel and posts approved replies as the channel. Videos are uploaded through Postiz, not here.",
    method: "oauth",
    group: "Social",
    googleOAuth: { scopes: ["https://www.googleapis.com/auth/youtube.force-ssl"], enabled: true },
  },
  { key: "linkedin", name: "LinkedIn", usedFor: "Company page posting, connected inside Postiz", method: "none", group: "Social" },
  {
    key: "reddit_app",
    name: "Reddit app",
    usedFor: "Only to sign in with Reddit below. At reddit.com/prefs/apps create a \"web app\" with the redirect URL shown here.",
    method: "api_key",
    group: "Social",
    fields: [
      { name: "client_id", label: "Client ID (under the app name)" },
      { name: "client_secret", label: "Secret", secret: true },
    ],
  },
  { key: "reddit", name: "Reddit", usedFor: "Finds questions in astrology subreddits and posts approved answers from the team's named account", method: "oauth", group: "Social", customOAuth: "reddit" },
  { key: "quora", name: "Quora", usedFor: "Find questions (drafts only, a person posts)", method: "none", group: "Social" },
  {
    key: "bodhlok_cms",
    name: "bodhlok.com CMS",
    usedFor: "Publishes approved SEO pages straight to the website's blog through its CMS",
    method: "api_key",
    group: "Search",
    fields: [
      { name: "refresh_token", label: "Sign-in key from bodhlok.com (see the steps on this card)", secret: true },
      { name: "site_url", label: "Site address", optional: true, placeholder: "https://bodhlok.com" },
    ],
  },
  {
    key: "crm_billing",
    name: "Agentic CRM: billing",
    usedFor:
      "Paid invoices and subscriptions from the CRM's Monetization API (project bodhlok), for revenue per channel and the paid conversion. Webhook URL: https://growth.rechargestudio.com/api/events/crm-billing",
    method: "api_key",
    group: "Internal",
    fields: [
      { name: "webhook_secret", label: "Webhook signing secret (whsec_…, shown once when the endpoint is created)", secret: true },
      { name: "api_key", label: "Project API key with entitlements:read, to read invoice amounts", secret: true },
      { name: "base_url", label: "CRM address", optional: true, placeholder: "https://agentic.rechargestudio.com" },
    ],
  },
  {
    key: "crm_leads",
    name: "Agentic CRM: leads",
    usedFor:
      "Leads from lead forms, web forms and WhatsApp, counted per channel and ad. Webhook URL: https://growth.rechargestudio.com/api/events/crm-leads",
    method: "api_key",
    group: "Internal",
    fields: [
      { name: "webhook_secret", label: "Webhook signing secret (shown once when the webhook is created)", secret: true },
      { name: "api_key", label: "API key with read:leads, for the nightly catch-up", secret: true, optional: true },
      { name: "base_url", label: "CRM address", optional: true, placeholder: "https://agentic.rechargestudio.com" },
    ],
  },
  {
    key: "google_app",
    name: "Google sign-in app for connections",
    usedFor:
      "Growth OS's own Google app for connecting YouTube, Google Ads and Search Console. Once Google verifies it, any account can connect, Gmail included; until then up to 100, past a warning. Without it, connections use the staff sign-in app.",
    method: "api_key",
    group: "Search",
    fields: [
      { name: "client_id", label: "Client ID (ends .apps.googleusercontent.com)", placeholder: "1234-abc.apps.googleusercontent.com" },
      { name: "client_secret", label: "Client secret (starts GOCSPX-)", secret: true },
    ],
  },
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
      { name: "target", label: "Website to track (keywords and site audit)", placeholder: "www.bodhlok.com" },
    ],
  },
  { key: "semrush", name: "Semrush or Ahrefs", usedFor: "Competitor data (optional)", method: "api_key", group: "Search", planned: "Not built: DataForSEO covers keywords and rankings today." },
  { key: "ga4", name: "GA4 / Firebase", usedFor: "Website and app traffic for Analytics (sessions, users, pages, sources) through the GA4 Data API, with GA4_PROPERTY_ID set on the server; otherwise web sessions from the BigQuery export", method: "service_account", group: "Analytics" },
  { key: "whatsapp", name: "WhatsApp Business API", usedFor: "Onboarding messages", method: "api_key", group: "Messaging", planned: "Planned with the lifecycle messages (build plan phase 9)." },
  { key: "email", name: "Email (Brevo or SendGrid)", usedFor: "Onboarding emails", method: "api_key", group: "Messaging", planned: "Planned with the lifecycle messages (build plan phase 9)." },
  { key: "bodh", name: "BODH backend", usedFor: "Registration, first-chart and paid events", method: "internal", group: "Internal" },
];

export function getIntegration(key: string): IntegrationDef | undefined {
  return INTEGRATIONS.find((i) => i.key === key);
}

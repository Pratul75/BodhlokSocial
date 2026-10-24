/**
 * DataForSEO v3: https://docs.dataforseo.com/v3/
 * Credentials (dataforseo connection): { login, password, target } where target is BODH's
 * domain without https:// or www. Basic auth; every request body is an array of one task.
 * Results sit in tasks[0].result; a task-level status_code other than 20000/20100 is an error.
 */
export interface DataForSeoCredentials {
  login: string;
  password: string;
  target: string;
}

export const INDIA = { location_code: 2356, language_code: "en" } as const;
const BASE = "https://api.dataforseo.com/v3";

export class DataForSeoError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface Envelope<T> {
  status_code: number;
  status_message: string;
  tasks?: { id: string; status_code: number; status_message: string; result: T[] | null }[];
}

export function normalizeTarget(t: string): string {
  return t.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

async function call<T>(creds: DataForSeoCredentials, path: string, body?: unknown): Promise<{ id: string; result: T[] }> {
  const auth = Buffer.from(`${creds.login}:${creds.password}`).toString("base64");
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Basic ${auth}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    throw new DataForSeoError(`DataForSEO unreachable: ${e instanceof Error ? e.message : e}`, 0);
  }
  const json = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !json) throw new DataForSeoError(`DataForSEO ${res.status}${json?.status_message ? `: ${json.status_message}` : ""}`, res.status);
  if (json.status_code !== 20000) throw new DataForSeoError(`DataForSEO: ${json.status_message}`, json.status_code);
  const task = json.tasks?.[0];
  if (!task) throw new DataForSeoError("DataForSEO returned no task.", 500);
  if (task.status_code !== 20000 && task.status_code !== 20100) throw new DataForSeoError(`DataForSEO: ${task.status_message}`, task.status_code);
  return { id: task.id, result: task.result ?? [] };
}

export type KeywordIntent = "tool" | "learn" | "software";

/** BODH's three buckets: free tools (kundli makers etc.), learning, and the app itself. */
export function intentFor(keyword: string, mainIntent?: string | null): KeywordIntent {
  if (/\b(calculator|generator|maker|free|online|check|finder|chart|kundli|kundali|panchang|matching|milan)\b/i.test(keyword)) return "tool";
  if (mainIntent === "informational" || !mainIntent) return "learn";
  return "software";
}

export interface KeywordRow {
  keyword: string;
  volume: number;
  difficulty: number;
  intent: KeywordIntent;
  position: number | null;
  url: string | null;
}

interface LabsKeywordData {
  keyword: string;
  keyword_info?: { search_volume?: number | null } | null;
  keyword_properties?: { keyword_difficulty?: number | null } | null;
  search_intent_info?: { main_intent?: string | null } | null;
}

/** Keywords the target ranks for in Google India, most searched first. */
export async function rankedKeywords(creds: DataForSeoCredentials, limit = 200): Promise<KeywordRow[]> {
  const { result } = await call<{ items?: { keyword_data: LabsKeywordData; ranked_serp_element?: { serp_item?: { rank_group?: number; url?: string } } }[] }>(
    creds,
    "/dataforseo_labs/google/ranked_keywords/live",
    [{ target: normalizeTarget(creds.target), ...INDIA, limit, order_by: ["keyword_data.keyword_info.search_volume,desc"] }],
  );
  return (result[0]?.items ?? []).map((i) => ({
    keyword: i.keyword_data.keyword,
    volume: i.keyword_data.keyword_info?.search_volume ?? 0,
    difficulty: i.keyword_data.keyword_properties?.keyword_difficulty ?? 0,
    intent: intentFor(i.keyword_data.keyword, i.keyword_data.search_intent_info?.main_intent),
    position: i.ranked_serp_element?.serp_item?.rank_group ?? null,
    url: i.ranked_serp_element?.serp_item?.url ?? null,
  }));
}

/** Related keywords for some seeds, in Google India, most searched first. */
export async function keywordIdeas(creds: DataForSeoCredentials, seeds: string[], limit = 50): Promise<Omit<KeywordRow, "position" | "url">[]> {
  const { result } = await call<{ items?: LabsKeywordData[] }>(creds, "/dataforseo_labs/google/keyword_ideas/live", [
    { keywords: seeds.slice(0, 20), ...INDIA, limit, order_by: ["keyword_info.search_volume,desc"] },
  ]);
  return (result[0]?.items ?? []).map((i) => ({
    keyword: i.keyword,
    volume: i.keyword_info?.search_volume ?? 0,
    difficulty: i.keyword_properties?.keyword_difficulty ?? 0,
    intent: intentFor(i.keyword, i.search_intent_info?.main_intent),
  }));
}

export type TrendsRange = "past_30_days" | "past_90_days" | "past_12_months" | "past_5_years";

export interface TrendSeries {
  keyword: string;
  /** Relative interest per period, 100 = peak across all the keywords asked. */
  points: { from: string; value: number }[];
  average: number;
}

/** Google Trends interest in India for up to 5 keywords. */
export async function searchTrends(creds: DataForSeoCredentials, words: string[], timeRange: TrendsRange = "past_90_days"): Promise<TrendSeries[]> {
  const kws = words.slice(0, 5).map((w) => w.replace(/[<>|"+\-]/g, " ").trim()).filter(Boolean);
  const { result } = await call<{ items?: { type: string; keywords?: string[]; data?: { date_from: string; values: (number | null)[]; missing_data?: boolean }[]; averages?: (number | null)[] }[] }>(
    creds,
    "/keywords_data/google_trends/explore/live",
    [{ keywords: kws, location_code: INDIA.location_code, time_range: timeRange, type: "web" }],
  );
  const graph = result[0]?.items?.find((i) => i.type === "google_trends_graph");
  if (!graph) return [];
  const names = graph.keywords ?? kws;
  return names.map((keyword, k) => ({
    keyword,
    points: (graph.data ?? []).filter((d) => !d.missing_data).map((d) => ({ from: d.date_from, value: d.values[k] ?? 0 })),
    average: graph.averages?.[k] ?? 0,
  }));
}

/* ---------- On-Page site audit ---------- */

export async function startOnPage(creds: DataForSeoCredentials, maxPages = 500): Promise<string> {
  const { id } = await call(creds, "/on_page/task_post", [{ target: normalizeTarget(creds.target), max_crawl_pages: maxPages, tag: "bodh-weekly" }]);
  return id;
}

export interface OnPageSummary {
  finished: boolean;
  pagesCrawled: number;
  onpageScore: number | null;
  /** Failing checks with the number of pages affected, largest first. */
  checks: { check: string; pages: number }[];
  metrics: Record<string, unknown>;
}

export async function onPageSummary(creds: DataForSeoCredentials, taskId: string): Promise<OnPageSummary> {
  const { result } = await call<{
    crawl_progress: string;
    crawl_status?: { pages_crawled?: number };
    page_metrics?: Record<string, unknown> & { onpage_score?: number; checks?: Record<string, number | null> };
  }>(creds, `/on_page/summary/${encodeURIComponent(taskId)}`);
  const r = result[0];
  const { checks = {}, ...metrics } = r?.page_metrics ?? {};
  // Positive checks (is_https, seo_friendly_url...) count pages that pass; leave them out.
  const positive = /^(is_https|is_www|seo_friendly_url.*|has_html_doctype|meta_charset_consistency)$/;
  return {
    finished: r?.crawl_progress === "finished",
    pagesCrawled: r?.crawl_status?.pages_crawled ?? 0,
    onpageScore: typeof metrics.onpage_score === "number" ? (metrics.onpage_score as number) : null,
    checks: Object.entries(checks)
      .filter(([k, v]) => !positive.test(k) && typeof v === "number" && v > 0)
      .map(([check, pages]) => ({ check, pages: pages as number }))
      .sort((a, b) => b.pages - a.pages),
    metrics,
  };
}

/** A few page URLs failing one check, for the audit's examples. */
export async function onPagePagesFailing(creds: DataForSeoCredentials, taskId: string, check: string, limit = 5): Promise<string[]> {
  const { result } = await call<{ items?: { url: string }[] }>(creds, "/on_page/pages", [{ id: taskId, limit, filters: [`checks.${check}`, "=", true] }]);
  return (result[0]?.items ?? []).map((i) => i.url);
}

/** Plain-language names for the checks people will see. */
export const CHECK_LABELS: Record<string, string> = {
  no_description: "No meta description",
  no_title: "No title",
  title_too_long: "Title too long",
  title_too_short: "Title too short",
  no_h1_tag: "No H1 heading",
  duplicate_title_tag: "Duplicate title",
  duplicate_meta_tags: "Duplicate meta tags",
  no_image_alt: "Images without alt text",
  is_broken: "Broken pages",
  is_4xx_code: "4xx errors",
  is_5xx_code: "5xx errors",
  is_redirect: "Redirects",
  redirect_chain: "Redirect chains",
  high_loading_time: "Slow to load",
  high_waiting_time: "Slow server response",
  low_content_rate: "Thin content",
  low_character_count: "Very little text",
  is_orphan_page: "Orphan pages (no internal links)",
  canonical_to_broken: "Canonical points to a broken page",
  canonical_to_redirect: "Canonical points to a redirect",
  has_links_to_redirects: "Links to redirects",
  has_render_blocking_resources: "Render-blocking resources",
  large_page_size: "Large pages",
  no_favicon: "No favicon",
  low_readability_rate: "Hard to read",
  irrelevant_title: "Title doesn't match content",
  irrelevant_description: "Description doesn't match content",
  https_to_http_links: "Links from HTTPS to HTTP",
  no_doctype: "No doctype",
  no_encoding_meta_tag: "No encoding meta tag",
  no_content_encoding: "No compression",
};

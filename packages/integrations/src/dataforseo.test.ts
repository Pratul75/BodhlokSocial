import { afterEach, describe, expect, it, vi } from "vitest";
import { intentFor, keywordIdeas, normalizeTarget, onPageSummary, rankedKeywords, searchTrends } from "./dataforseo";

const creds = { login: "me@x.com", password: "pw", target: "https://www.Asttrolok.com/" };
const ok = (result: unknown[]) => Response.json({ status_code: 20000, status_message: "Ok.", tasks: [{ id: "t1", status_code: 20000, status_message: "Ok.", result }] });

describe("dataforseo", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normalises the target and sorts keywords into BODH's buckets", () => {
    expect(normalizeTarget(creds.target)).toBe("asttrolok.com");
    expect(intentFor("free kundli online", "informational")).toBe("tool");
    expect(intentFor("what is rahu", "informational")).toBe("learn");
    expect(intentFor("best astrology app", "commercial")).toBe("software");
  });

  it("reads ranked keywords with basic auth for Google India", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return ok([{ items: [{ keyword_data: { keyword: "Saturn in 7th house", keyword_info: { search_volume: 9900 }, keyword_properties: { keyword_difficulty: 31 }, search_intent_info: { main_intent: "informational" } }, ranked_serp_element: { serp_item: { rank_group: 14, url: "https://asttrolok.com/saturn-7th" } } }] }]);
    });
    const rows = await rankedKeywords(creds, 10);
    expect(rows).toEqual([{ keyword: "Saturn in 7th house", volume: 9900, difficulty: 31, intent: "learn", position: 14, url: "https://asttrolok.com/saturn-7th" }]);
    expect(calls[0]!.url).toBe("https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live");
    expect(new Headers(calls[0]!.init.headers).get("authorization")).toBe(`Basic ${Buffer.from("me@x.com:pw").toString("base64")}`);
    expect(JSON.parse(String(calls[0]!.init.body))[0]).toMatchObject({ target: "asttrolok.com", location_code: 2356, language_code: "en", limit: 10 });
  });

  it("raises task errors with DataForSEO's message", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ status_code: 20000, status_message: "Ok.", tasks: [{ id: "t", status_code: 40501, status_message: "Invalid Field: 'keywords'.", result: null }] }));
    await expect(keywordIdeas(creds, ["kundli"])).rejects.toThrow("Invalid Field: 'keywords'.");
  });

  it("reads Google Trends series per keyword", async () => {
    vi.stubGlobal("fetch", async () =>
      ok([{ items: [{ type: "google_trends_graph", keywords: ["shani", "rahu"], data: [{ date_from: "2026-09-01", values: [40, 10] }, { date_from: "2026-09-08", values: [100, 12], missing_data: false }], averages: [70, 11] }] }]),
    );
    const s = await searchTrends(creds, ["shani", "rahu"]);
    expect(s[0]).toEqual({ keyword: "shani", points: [{ from: "2026-09-01", value: 40 }, { from: "2026-09-08", value: 100 }], average: 70 });
  });

  it("summarises an audit, leaving out checks that count passing pages", async () => {
    vi.stubGlobal("fetch", async () =>
      ok([{ crawl_progress: "finished", crawl_status: { pages_crawled: 120 }, page_metrics: { onpage_score: 88.5, broken_links: 3, checks: { is_https: 120, no_description: 14, no_h1_tag: 2, seo_friendly_url: 100, has_misspelling: null } } }]),
    );
    const s = await onPageSummary(creds, "task-1");
    expect(s).toMatchObject({ finished: true, pagesCrawled: 120, onpageScore: 88.5, checks: [{ check: "no_description", pages: 14 }, { check: "no_h1_tag", pages: 2 }] });
    expect(s.metrics).toMatchObject({ broken_links: 3 });
  });
});

describe("keyword overview", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("looks up named keywords once each", async () => {
    let body: unknown;
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return ok([{ items: [{ keyword: "kp astrology software", keyword_info: { search_volume: 880 }, keyword_properties: { keyword_difficulty: 12 }, search_intent_info: { main_intent: "commercial" } }] }]);
    });
    const { keywordOverview } = await import("./dataforseo");
    expect(await keywordOverview(creds, ["KP astrology software", "kp astrology software "])).toEqual([{ keyword: "kp astrology software", volume: 880, difficulty: 12, intent: "software" }]);
    expect((body as { keywords: string[] }[])[0]!.keywords).toEqual(["kp astrology software"]);
  });
});

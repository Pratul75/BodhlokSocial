import { describe, expect, it, vi } from "vitest";
import { chunkRange, classifyGa4Error, fetchDaily, fetchPages, fetchSources, fetchTotals, ga4Client, ga4PropertyId, OTHER_PAGES, sessionsByAttributionChannel } from "./ga4-data";

const SA = { client_email: "ga4-reader@bodhlok.iam.gserviceaccount.com", private_key: "unused", project_id: "bodhlok" };
const row = (dims: string[], mets: number[]) => ({ dimensionValues: dims.map((value) => ({ value })), metricValues: mets.map((m) => ({ value: String(m) })) });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeFetch(...responses: (Response | ((url: string, body: Record<string, unknown>) => Response))[]) {
  const calls: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ url: String(url), body, auth: new Headers(init?.headers).get("authorization") });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return typeof next === "function" ? next(String(url), body) : next;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const deps = (f: ReturnType<typeof fakeFetch>, extra = {}) => ({ fetchImpl: f.fetchImpl, token: async () => "tok", sleep: async () => {}, ...extra });

describe("GA4 property setting", () => {
  it("is off when unset, accepts a numeric id, and refuses anything else", () => {
    expect(ga4PropertyId({})).toBeNull();
    expect(ga4PropertyId({ GA4_PROPERTY_ID: " 412345678 " })).toBe("412345678");
    expect(() => ga4PropertyId({ GA4_PROPERTY_ID: "properties/412345678" })).toThrow(/numeric GA4 property id/);
    expect(() => ga4PropertyId({ GA4_PROPERTY_ID: "G-ABC123" })).toThrow();
  });
});

describe("GA4 Data API client", () => {
  it("calls the configured property with a bearer token and follows pages", async () => {
    const f = fakeFetch(
      json(200, { rows: [row(["20261101", "web"], [10, 6, 8, 4, 9, 30, 900])], rowCount: 2, metadata: { subjectToThresholding: true }, propertyQuota: { tokensPerDay: { remaining: 199_000 } } }),
      json(200, { rows: [row(["20261102", "android"], [5, 3, 4, 2, 4, 9, 300])], rowCount: 2 }),
    );
    const c = ga4Client("412345678", SA, deps(f, { pageSize: 1 }));
    const r = await fetchDaily(c, "2026-11-01", "2026-11-02");
    expect(f.calls[0]!.url).toBe("https://analyticsdata.googleapis.com/v1beta/properties/412345678:runReport");
    expect(f.calls[0]!.auth).toBe("Bearer tok");
    expect(f.calls.map((x) => x.body.offset)).toEqual(["0", "1"]);
    expect(f.calls[0]!.body.returnPropertyQuota).toBe(true);
    expect(r.rows).toEqual([
      { day: "2026-11-01", platform: "web", sessions: 10, engagedSessions: 6, activeUsers: 8, newUsers: 4, totalUsers: 9, screenPageViews: 30, userEngagementSeconds: 900 },
      { day: "2026-11-02", platform: "android", sessions: 5, engagedSessions: 3, activeUsers: 4, newUsers: 2, totalUsers: 4, screenPageViews: 9, userEngagementSeconds: 300 },
    ]);
    expect(r.meta?.subjectToThresholding).toBe(true);
    expect(r.quota?.tokensPerDay?.remaining).toBe(199_000);
  });

  it("retries a temporary failure, but not a permissions problem", async () => {
    const sleep = vi.fn(async () => {});
    const ok = fakeFetch(json(503, { error: { code: 503, status: "UNAVAILABLE", message: "try later" } }), json(429, { error: { status: "RESOURCE_EXHAUSTED" } }), json(200, { rows: [], rowCount: 0 }));
    await fetchTotals(ga4Client("412345678", SA, deps(ok, { sleep })), "2026-10-01", "2026-10-28");
    expect(ok.calls).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);

    const denied = fakeFetch(json(403, { error: { code: 403, status: "PERMISSION_DENIED", message: "User does not have sufficient permissions" } }));
    await expect(fetchTotals(ga4Client("412345678", SA, deps(denied)), "2026-10-01", "2026-10-28")).rejects.toThrow(/can't read GA4 property 412345678\. Add it as Viewer/);
    expect(denied.calls).toHaveLength(1);
  });

  it("gives up after three temporary failures", async () => {
    const f = fakeFetch(json(500, {}), json(500, {}), json(500, {}));
    await expect(ga4Client("412345678", SA, deps(f)).checkAccess()).rejects.toThrow(/GA4 answered 500/);
    expect(f.calls).toHaveLength(3);
    expect(f.calls[0]!.url).toBe("https://analyticsdata.googleapis.com/v1beta/properties/412345678/metadata");
  });
});

describe("GA4 errors in plain words", () => {
  it("names the switched-off API, the missing Viewer access, a wrong property and quota", () => {
    expect(classifyGa4Error(403, { error: { status: "PERMISSION_DENIED", message: "Google Analytics Data API has not been used in project 766732733726 before or it is disabled.", details: [{ reason: "SERVICE_DISABLED" }] } }, "1", SA).message).toMatch(/Data API is turned off in Google Cloud project bodhlok/);
    expect(classifyGa4Error(403, { error: { status: "PERMISSION_DENIED" } }, "412345678", SA).message).toContain("ga4-reader@bodhlok.iam.gserviceaccount.com can't read GA4 property 412345678");
    expect(classifyGa4Error(404, { error: { status: "NOT_FOUND" } }, "1", SA).message).toMatch(/Check GA4_PROPERTY_ID/);
    const q = classifyGa4Error(429, { error: { status: "RESOURCE_EXHAUSTED" } }, "1", SA);
    expect(q.retryable).toBe(true);
    expect(classifyGa4Error(401, null, "1", SA).retryable).toBe(false);
  });
});

describe("GA4 reports", () => {
  it("keeps the top pages of each day, sums the rest as (other), and drops query strings", async () => {
    const f = fakeFetch(
      json(200, {
        rows: [
          row(["20261101", "/blog/a?utm_source=x&email=someone@example.com"], [5, 4, 50]),
          row(["20261101", "/blog/a"], [5, 3, 40]),
          row(["20261101", "/pricing"], [7, 6, 70]),
          row(["20261101", "/signup#form"], [2, 2, 20]),
          row(["20261102", "/"], [3, 3, 30]),
        ],
        rowCount: 5,
      }),
    );
    const r = await fetchPages(ga4Client("412345678", SA, deps(f)), "2026-11-01", "2026-11-02", 2);
    expect(r.rows.filter((p) => p.day === "2026-11-01")).toEqual([
      { day: "2026-11-01", pagePath: "/blog/a", screenPageViews: 10, activeUsers: 7, userEngagementSeconds: 90 },
      { day: "2026-11-01", pagePath: "/pricing", screenPageViews: 7, activeUsers: 6, userEngagementSeconds: 70 },
      { day: "2026-11-01", pagePath: OTHER_PAGES, screenPageViews: 2, activeUsers: 2, userEngagementSeconds: 20 },
    ]);
    expect(JSON.stringify(r.rows)).not.toContain("example.com");
    expect(r.rows.find((p) => p.day === "2026-11-02")?.pagePath).toBe("/");
  });

  it("maps GA4 sources to the funnel's channels with the same rules as registrations", async () => {
    const f = fakeFetch(
      json(200, {
        rows: [
          row(["20261101", "Organic Search", "google", "organic"], [10, 7, 5]),
          row(["20261101", "Direct", "(direct)", "(none)"], [6, 2, 3]),
          row(["20261101", "Organic Social", "l.instagram.com", "referral"], [4, 3, 2]),
          row(["20261101", "Paid Search", "google", "cpc"], [3, 2, 1]),
          row(["20261101", "Organic Video", "youtube.com", "referral"], [2, 1, 1]),
          row(["20261101", "Organic Search", "bing", "organic"], [1, 1, 1]),
        ],
        rowCount: 6,
      }),
    );
    const r = await fetchSources(ga4Client("412345678", SA, deps(f)), "2026-11-01", "2026-11-01");
    const byChannel = Object.fromEntries(sessionsByAttributionChannel(r.rows).map((x) => [x.channel, x.sessions]));
    expect(byChannel).toEqual({ seo: 11, direct: 6, instagram: 4, google_ads: 3, youtube: 2 });
  });

  it("splits long windows into 30-day requests", () => {
    expect(chunkRange("2026-08-08", "2026-11-05", 30)).toEqual([
      ["2026-08-08", "2026-09-06"],
      ["2026-09-07", "2026-10-06"],
      ["2026-10-07", "2026-11-05"],
    ]);
    expect(chunkRange("2026-11-03", "2026-11-05")).toEqual([["2026-11-03", "2026-11-05"]]);
  });
});

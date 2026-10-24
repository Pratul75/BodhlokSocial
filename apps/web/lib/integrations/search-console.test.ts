import { afterEach, describe, expect, it, vi } from "vitest";
import { listSites, pickSite, topQueries } from "./search-console";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SEARCH_CONSOLE_SITE;
});

const sites = [
  { siteUrl: "https://example.com/", permissionLevel: "siteOwner" },
  { siteUrl: "sc-domain:asttrolok.com", permissionLevel: "siteFullUser" },
];

describe("pickSite", () => {
  it("prefers the Asttrolok property", () => {
    expect(pickSite(sites)?.siteUrl).toBe("sc-domain:asttrolok.com");
  });
  it("uses SEARCH_CONSOLE_SITE when set", () => {
    process.env.SEARCH_CONSOLE_SITE = "https://example.com/";
    expect(pickSite(sites)?.siteUrl).toBe("https://example.com/");
  });
});

describe("Search Console API", () => {
  it("drops unverified properties", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ siteEntry: [...sites, { siteUrl: "https://x.com/", permissionLevel: "siteUnverifiedUser" }] })));
    expect(await listSites("t")).toHaveLength(2);
  });

  it("queries the last 28 days by query and parses rows", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ rows: [{ keys: ["kundli software"], clicks: 40, impressions: 900, position: 10.6 }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const rows = await topQueries("token", "sc-domain:asttrolok.com");
    expect(rows).toEqual([{ query: "kundli software", clicks: 40, impressions: 900, position: 10.6 }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aasttrolok.com/searchAnalytics/query");
    const body = JSON.parse(String(init?.body));
    expect(body.dimensions).toEqual(["query"]);
    const span = (Date.parse(body.endDate) - Date.parse(body.startDate)) / 86400000;
    expect(span).toBe(27);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer token");
  });

  it("throws on API errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 403 })));
    await expect(listSites("t")).rejects.toThrow("403");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCapiEvent, fetchMetaSpend, sendCapiEvents, type ConversionForCapi } from "./meta";
import { buildClickConversion, conversionDateTime, fetchGoogleAdsSpend } from "./google-ads";
import { sessionsByChannel, sessionsQuery } from "./ga4";
import { sha256 } from "./bodh-events";

afterEach(() => vi.unstubAllGlobals());

const base: ConversionForCapi = {
  eventId: "evt_1",
  type: "registration",
  occurredAt: new Date("2026-10-24T04:30:00Z"),
  userRef: "u_1",
  emailSha256: sha256("a@b.com"),
  phoneSha256: null,
  platform: "web",
  value: null,
  currency: "INR",
  plan: null,
  fbp: "fb.1.1.123",
  fbc: null,
  fbclid: "IwAR0",
  landingPage: "https://asttrolok.com/free-kundli",
  clientIp: "1.2.3.4",
  userAgent: "Mozilla",
};

describe("Meta Conversions API", () => {
  it("maps a registration with hashed identifiers and dedupe ID", () => {
    const e = buildCapiEvent(base) as Record<string, any>;
    expect(e.event_name).toBe("CompleteRegistration");
    expect(e.event_id).toBe("evt_1");
    expect(e.event_time).toBe(1792816200);
    expect(e.action_source).toBe("website");
    expect(e.user_data.em).toEqual([sha256("a@b.com")]);
    expect(e.user_data.external_id).toEqual([sha256("u_1")]);
    expect(e.user_data.fbc).toBe("fb.1.1792816200000.IwAR0");
    expect(e.user_data.ph).toBeUndefined();
    expect(e.custom_data).toBeUndefined();
  });

  it("adds value on purchases and uses app source for app events", () => {
    const e = buildCapiEvent({ ...base, type: "paid", platform: "android", value: 1999, plan: "jyotish" }) as Record<string, any>;
    expect(e.event_name).toBe("Purchase");
    expect(e.action_source).toBe("app");
    expect(e.event_source_url).toBeUndefined();
    expect(e.custom_data).toEqual({ value: 1999, currency: "INR", content_name: "jyotish" });
  });

  it("posts to the pixel's events endpoint with the token in a header", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => Response.json({ events_received: 1 }));
    vi.stubGlobal("fetch", f);
    expect(await sendCapiEvents({ pixel_id: "999", access_token: "tok", test_event_code: "TEST1" }, [base])).toEqual({ received: 1 });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toMatch(/\/v\d+\.\d+\/999\/events$/);
    expect(url).not.toContain("tok");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(init!.body)).test_event_code).toBe("TEST1");
  });

  it("marks rate limits retryable and bad requests not", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "slow down" } }, { status: 429 })));
    await expect(sendCapiEvents({ pixel_id: "1", access_token: "t" }, [base])).rejects.toMatchObject({ retryable: true });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "bad" } }, { status: 400 })));
    await expect(sendCapiEvents({ pixel_id: "1", access_token: "t" }, [base])).rejects.toMatchObject({ retryable: false });
  });

  it("follows insights paging and parses numbers", async () => {
    const pages = [
      { data: [{ date_start: "2026-10-23", campaign_id: "c1", campaign_name: "C", ad_id: "a1", ad_name: "A", spend: "120.50", impressions: "1000", inline_link_clicks: "30" }], paging: { next: "https://graph.facebook.com/next" } },
      { data: [{ date_start: "2026-10-23", campaign_id: "c1", campaign_name: "C", ad_id: "a2", ad_name: "B", spend: "80", impressions: "500" }] },
    ];
    const f = vi.fn(async () => Response.json(pages.shift()));
    vi.stubGlobal("fetch", f);
    const rows = await fetchMetaSpend({ ad_account_id: "123", access_token: "t" }, "2026-10-23", "2026-10-23");
    expect(rows.map((r) => [r.adId, r.spend, r.clicks])).toEqual([["a1", 120.5, 30], ["a2", 80, 0]]);
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain("/act_123/insights");
  });
});

describe("Google Ads", () => {
  const cfg = { developerToken: "dev", customerId: "1234567890", conversionActions: { registration: "111", paid: "333" } };

  it("formats conversion time in India time", () => {
    expect(conversionDateTime(new Date("2026-10-24T04:30:00Z"))).toBe("2026-10-24 10:00:00+05:30");
  });

  it("builds a click conversion with enhanced-conversion identifiers", () => {
    const c = buildClickConversion(cfg, { eventId: "e1", type: "registration", occurredAt: new Date("2026-10-24T04:30:00Z"), gclid: "G", gbraid: null, wbraid: null, emailSha256: "h", phoneSha256: null, value: null, currency: "INR" });
    expect(c).toEqual({
      conversionAction: "customers/1234567890/conversionActions/111",
      conversionDateTime: "2026-10-24 10:00:00+05:30",
      orderId: "e1",
      gclid: "G",
      userIdentifiers: [{ hashedEmail: "h" }],
    });
  });

  it("skips events without a click ID or a configured action", () => {
    const e = { eventId: "e", occurredAt: new Date(), gbraid: null, wbraid: null, emailSha256: null, phoneSha256: null, value: null, currency: "INR" };
    expect(buildClickConversion(cfg, { ...e, type: "registration", gclid: null })).toBeNull();
    expect(buildClickConversion(cfg, { ...e, type: "activation", gclid: "G" })).toBeNull();
  });

  it("converts cost micros and pages through results", async () => {
    const pages = [
      { results: [{ segments: { date: "2026-10-23" }, campaign: { id: "9", name: "App" }, adGroupAd: { ad: { id: "77" } }, metrics: { costMicros: "2500000000", impressions: "10", clicks: "4" } }], nextPageToken: "p2" },
      { results: [] },
    ];
    const f = vi.fn(async (_u: string, _i?: RequestInit) => Response.json(pages.shift()));
    vi.stubGlobal("fetch", f);
    const rows = await fetchGoogleAdsSpend(cfg, "tok", "2026-10-23", "2026-10-23");
    expect(rows).toEqual([{ day: "2026-10-23", platform: "google_ads", campaignId: "9", campaignName: "App", adId: "77", adName: "Ad 77", spend: 2500, impressions: 10, clicks: 4 }]);
    expect((f.mock.calls[0]![1]!.headers as Record<string, string>)["developer-token"]).toBe("dev");
    expect(JSON.parse(String(f.mock.calls[1]![1]!.body)).pageToken).toBe("p2");
  });

  it("refuses date strings that could change the query", async () => {
    await expect(fetchGoogleAdsSpend(cfg, "t", "2026-10-23' OR '1'='1", "2026-10-23")).rejects.toThrow("YYYY-MM-DD");
  });
});

describe("GA4 sessions", () => {
  it("groups sessions into our channels", () => {
    expect(
      sessionsByChannel([
        { source: "google", medium: "organic", has_gclid: false, referrer_host: "www.google.com", sessions: 300 },
        { source: "google", medium: "cpc", has_gclid: true, referrer_host: null, sessions: 120 },
        { source: null, medium: null, has_gclid: false, referrer_host: "www.youtube.com", sessions: 80 },
        { source: "(direct)", medium: "(none)", has_gclid: false, referrer_host: null, sessions: 50 },
        { source: null, medium: null, has_gclid: false, referrer_host: null, sessions: 25 },
        { source: "(not set)", medium: "(not set)", has_gclid: false, referrer_host: "some-blog.example", sessions: 5 },
      ]),
    ).toEqual({ seo: 300, google_ads: 120, youtube: 80, direct: 75, other: 5 });
  });

  it("reads one day's session_start events", () => {
    const q = sessionsQuery("bodh-prod", "analytics_123");
    expect(q).toContain("`bodh-prod.analytics_123.events_*`");
    expect(q).toContain("_TABLE_SUFFIX = @suffix");
  });
});

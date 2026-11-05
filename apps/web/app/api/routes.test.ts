import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { signBody, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@bodh/integrations/bodh-events";

// Route handlers are called directly with a Request. The database and pipeline are mocked so
// these run without Postgres; the DB-backed suites cover what happens after a request is accepted.
const execute = vi.fn();
vi.mock("@bodh/db", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));
const ingestEvents = vi.fn(async (events: unknown[]) => ({ accepted: events.length, duplicates: 0 }));
vi.mock("@bodh/integrations/pipeline", () => ({ ingestEvents: (e: unknown[]) => ingestEvents(e) }));
const storeLead = vi.fn(async (_lead: unknown) => ({ created: true, id: "lead-1" }));
const fetchMetaLead = vi.fn(async (id: string) => ({ source: "meta_lead_form", platformLeadId: id, name: "Priya", email: null, phone: null, interest: "x", formId: null, campaign: null, fields: {} }));
vi.mock("@bodh/integrations/leads", async (orig) => {
  const real = await orig<typeof import("@bodh/integrations/leads")>();
  return { ...real, storeLead: (l: unknown) => storeLead(l as never), fetchMetaLead: (id: string) => fetchMetaLead(id) };
});
vi.mock("@/lib/seo-feed", async (orig) => {
  const real = await orig<typeof import("@/lib/seo-feed")>();
  return { ...real, siteUrl: async () => "https://www.bodhlok.com", livePages: async () => [], llmsTxt: async () => "# Bodhlok\n" };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("GET /api/health", () => {
  it("is 200 when the database answers and 503 when it does not", async () => {
    const { GET } = await import("./health/route");
    execute.mockResolvedValueOnce([]);
    expect((await GET()).status).toBe(200);
    execute.mockRejectedValueOnce(new Error("down"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
  });
});

describe("POST /api/events/bodh", () => {
  const SECRET = "s".repeat(64);
  const event = { event_id: "evt_000001", type: "registration", occurred_at: "2026-11-05T10:00:00+05:30", user_id: "u1" };
  const signed = (body: string, ts = Math.floor(Date.now() / 1000)) =>
    new Request("http://x/api/events/bodh", { method: "POST", body, headers: { [TIMESTAMP_HEADER]: String(ts), [SIGNATURE_HEADER]: signBody(SECRET, ts, body) } });

  beforeEach(() => vi.stubEnv("BODH_EVENTS_SECRET", SECRET));

  it("is off (503) without a secret", async () => {
    vi.stubEnv("BODH_EVENTS_SECRET", "");
    const { POST } = await import("./events/bodh/route");
    expect((await POST(signed(JSON.stringify(event)))).status).toBe(503);
  });

  it("rejects missing, stale and wrong signatures with 401", async () => {
    const { POST } = await import("./events/bodh/route");
    const body = JSON.stringify(event);
    expect((await POST(new Request("http://x", { method: "POST", body }))).status).toBe(401);
    expect((await POST(signed(body, Math.floor(Date.now() / 1000) - 3600))).status).toBe(401);
    const forged = new Request("http://x", { method: "POST", body, headers: { [TIMESTAMP_HEADER]: String(Math.floor(Date.now() / 1000)), [SIGNATURE_HEADER]: "v1=" + "0".repeat(64) } });
    expect((await POST(forged)).status).toBe(401);
    expect(ingestEvents).not.toHaveBeenCalled();
  });

  it("rejects bodies over 1 MB, invalid JSON and invalid events", async () => {
    const { POST } = await import("./events/bodh/route");
    expect((await POST(signed("x".repeat(1_000_001)))).status).toBe(413);
    expect((await POST(signed("{not json"))).status).toBe(400);
    const bad = await POST(signed(JSON.stringify({ ...event, type: "signup" })));
    expect(bad.status).toBe(400);
    expect((await bad.json()) as { issues: unknown[] }).toHaveProperty("issues");
  });

  it("accepts a signed batch and hands it to the pipeline", async () => {
    const { POST } = await import("./events/bodh/route");
    const res = await POST(signed(JSON.stringify({ events: [event, { ...event, event_id: "evt_000002", type: "activation" }] })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: 2, duplicates: 0 });
  });
});

describe("GET /api/feed/*", () => {
  it("is off (503) without SEO_FEED_TOKEN", async () => {
    const { GET } = await import("./feed/pages/route");
    expect((await GET(new Request("http://x/api/feed/pages"))).status).toBe(503);
  });

  it("needs the token as a Bearer header; the query string is not accepted", async () => {
    vi.stubEnv("SEO_FEED_TOKEN", "feed-token-feed-token-1234");
    const { GET } = await import("./feed/pages/route");
    expect((await GET(new Request("http://x/api/feed/pages?token=feed-token-feed-token-1234"))).status).toBe(401);
    expect((await GET(new Request("http://x/api/feed/pages", { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
    const ok = await GET(new Request("http://x/api/feed/pages", { headers: { authorization: "Bearer feed-token-feed-token-1234" } }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await ok.json()).toEqual({ site: "https://www.bodhlok.com", count: 0, pages: [] });
  });
});

describe("lead form webhooks", () => {
  it("Meta: answers the subscription challenge only with the right verify token", async () => {
    vi.stubEnv("META_LEADS_VERIFY_TOKEN", "verify-me");
    const { GET } = await import("./webhooks/meta-leads/route");
    const ok = await GET(new Request("http://x/api/webhooks/meta-leads?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("42");
    expect((await GET(new Request("http://x/api/webhooks/meta-leads?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42"))).status).toBe(403);
  });

  it("Meta: rejects an unsigned delivery and stores each lead in a signed one", async () => {
    vi.stubEnv("META_APP_SECRET", "s3cret");
    const { POST } = await import("./webhooks/meta-leads/route");
    const body = JSON.stringify({ object: "page", entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "L1", form_id: "F1" } }] }] });
    expect((await POST(new Request("http://x", { method: "POST", body }))).status).toBe(401);
    expect(storeLead).not.toHaveBeenCalled();
    const sig = `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`;
    const res = await POST(new Request("http://x", { method: "POST", body, headers: { "x-hub-signature-256": sig } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: 1, created: 1 });
    expect(fetchMetaLead).toHaveBeenCalledWith("L1");
  });

  it("Meta: answers 500 so Meta redelivers when a lead can't be read", async () => {
    vi.stubEnv("META_APP_SECRET", "s3cret");
    fetchMetaLead.mockRejectedValueOnce(new Error("Meta Marketing isn't connected"));
    const { POST } = await import("./webhooks/meta-leads/route");
    const body = JSON.stringify({ entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "L2" } }] }] });
    const sig = `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`;
    expect((await POST(new Request("http://x", { method: "POST", body, headers: { "x-hub-signature-256": sig } }))).status).toBe(500);
  });

  it("Google: needs the key and stores the lead", async () => {
    vi.stubEnv("GOOGLE_LEADS_WEBHOOK_KEY", "gkey");
    const { POST } = await import("./webhooks/google-leads/route");
    const lead = { lead_id: "G1", google_key: "gkey", user_column_data: [{ column_id: "FULL_NAME", string_value: "Rahul" }] };
    expect((await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ ...lead, google_key: "wrong" }) }))).status).toBe(401);
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify(lead) }));
    expect(res.status).toBe(200);
    expect(storeLead).toHaveBeenCalledWith(expect.objectContaining({ source: "google_lead_form", platformLeadId: "G1", name: "Rahul" }));
  });

  it("both are off (503) until their secrets are set", async () => {
    const meta = await import("./webhooks/meta-leads/route");
    const google = await import("./webhooks/google-leads/route");
    expect((await meta.POST(new Request("http://x", { method: "POST", body: "{}" }))).status).toBe(503);
    expect((await google.POST(new Request("http://x", { method: "POST", body: "{}" }))).status).toBe(503);
  });
});

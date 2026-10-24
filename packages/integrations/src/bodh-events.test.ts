import { describe, expect, it } from "vitest";
import { bodhBatchSchema, normalizeEmail, normalizeEvent, normalizePhone, sha256, signBody, verifySignature } from "./bodh-events";

const secret = "test-signing-secret";
const body = JSON.stringify({ hello: "world" });
const now = 1_800_000_000;

describe("signatures", () => {
  it("accepts a fresh, correct signature", () => {
    expect(verifySignature(secret, body, String(now), signBody(secret, now, body), now)).toEqual({ ok: true });
  });
  it("rejects a changed body", () => {
    expect(verifySignature(secret, body + " ", String(now), signBody(secret, now, body), now)).toEqual({ ok: false, reason: "mismatch" });
  });
  it("rejects old timestamps, even with a valid signature", () => {
    const old = now - 301;
    expect(verifySignature(secret, body, String(old), signBody(secret, old, body), now)).toEqual({ ok: false, reason: "stale" });
  });
  it("rejects a signature made with another secret", () => {
    expect(verifySignature(secret, body, String(now), signBody("other", now, body), now).ok).toBe(false);
  });
  it("accepts either signature during secret rotation", () => {
    const header = `${signBody("old-secret", now, body)},${signBody(secret, now, body)}`;
    expect(verifySignature(secret, body, String(now), header, now).ok).toBe(true);
  });
  it("rejects missing headers", () => {
    expect(verifySignature(secret, body, null, "v1=x", now)).toEqual({ ok: false, reason: "missing" });
  });
});

describe("normalisation", () => {
  it("normalises emails and Indian phone numbers", () => {
    expect(normalizeEmail("  Priya.Sharma@Gmail.com ")).toBe("priya.sharma@gmail.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizePhone("98765 43210")).toBe("919876543210");
    expect(normalizePhone("+91-98765-43210")).toBe("919876543210");
    expect(normalizePhone("09876543210")).toBe("919876543210");
    expect(normalizePhone("123")).toBeNull();
  });

  it("hashes contact details and drops the raw values", () => {
    const [e] = bodhBatchSchema.parse({
      event_id: "evt_000000001",
      type: "registration",
      occurred_at: "2026-10-24T10:00:00+05:30",
      user_id: "u_1",
      email: "Priya@Example.com",
      phone: "9876543210",
      attribution: { utm_source: "meta", utm_medium: "paid_social", utm_content: "120210" },
    });
    const n = normalizeEvent(e!);
    expect(n.emailSha256).toBe(sha256("priya@example.com"));
    expect(n.phoneSha256).toBe(sha256("919876543210"));
    expect(JSON.stringify(n)).not.toContain("Priya");
    expect(n.attribution?.utm_content).toBe("120210");
  });

  it("ignores attribution on non-registration events", () => {
    const [e] = bodhBatchSchema.parse({
      event_id: "evt_000000002",
      type: "activation",
      occurred_at: "2026-10-24T10:05:00Z",
      user_id: "u_1",
      attribution: { gclid: "x" },
    });
    expect(normalizeEvent(e!).attribution).toBeNull();
  });
});

describe("schema", () => {
  it("accepts a batch", () => {
    const events = bodhBatchSchema.parse({
      events: [
        { event_id: "evt_000000003", type: "registration", occurred_at: "2026-10-24T10:00:00Z", user_id: "u_2" },
        { event_id: "evt_000000004", type: "paid", occurred_at: "2026-10-24T11:00:00Z", user_id: "u_2", plan: "jyotish", value: 1999 },
      ],
    });
    expect(events).toHaveLength(2);
    expect(events[1]!.currency).toBe("INR");
  });
  it("requires value and plan on paid events, and says so", () => {
    const r = bodhBatchSchema.safeParse({ event_id: "evt_000000005", type: "paid", occurred_at: "2026-10-24T11:00:00Z", user_id: "u" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]).toMatchObject({ path: ["value"], message: "paid events need value and plan" });
  });

  it("names the field and index inside a batch", () => {
    const r = bodhBatchSchema.safeParse({ events: [{ event_id: "evt_000000007", type: "signup", occurred_at: "2026-10-24T11:00:00Z", user_id: "u" }] });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.path).toEqual(["events", 0, "type"]);
  });
  it("rejects malformed hashes", () => {
    expect(() =>
      bodhBatchSchema.parse({ event_id: "evt_000000006", type: "registration", occurred_at: "2026-10-24T11:00:00Z", user_id: "u", email_sha256: "PLAIN@x.com" }),
    ).toThrow();
  });
});

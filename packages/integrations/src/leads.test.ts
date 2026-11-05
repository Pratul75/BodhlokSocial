import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@bodh/db", () => ({ db: {}, leads: {}, users: {}, auditLog: {} }));
const { metaLeadRefs, parseGoogleLead, parseMetaLead, verifyGoogleKey, verifyMetaSignature } = await import("./leads");

describe("Meta lead webhooks", () => {
  const secret = "app-secret";
  const body = JSON.stringify({ object: "page", entry: [{ id: "p1", changes: [{ field: "leadgen", value: { leadgen_id: 444, form_id: "f9", ad_id: "a1" } }, { field: "feed", value: {} }] }] });
  const sig = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  it("accepts Meta's signature and rejects anything else", () => {
    expect(verifyMetaSignature(secret, body, sig)).toBe(true);
    expect(verifyMetaSignature(secret, body + " ", sig)).toBe(false);
    expect(verifyMetaSignature("other", body, sig)).toBe(false);
    expect(verifyMetaSignature(secret, body, null)).toBe(false);
    expect(verifyMetaSignature(secret, body, "sha1=abc")).toBe(false);
  });

  it("finds the leads in a delivery and ignores other fields", () => {
    expect(metaLeadRefs(JSON.parse(body))).toEqual([{ leadgenId: "444", formId: "f9", adId: "a1" }]);
    expect(metaLeadRefs({})).toEqual([]);
  });

  it("turns Graph field_data into a lead", () => {
    const l = parseMetaLead({
      id: "444",
      created_time: "2026-11-05T10:00:00+0000",
      form_id: "f9",
      campaign_name: "Institutes Q4",
      field_data: [
        { name: "full_name", values: ["Priya Sharma"] },
        { name: "email", values: ["priya@example.com"] },
        { name: "phone_number", values: ["+919800000000"] },
        { name: "which_plan_interests_you", values: ["Guru plan"] },
      ],
    });
    expect(l).toMatchObject({
      source: "meta_lead_form",
      platformLeadId: "444",
      name: "Priya Sharma",
      email: "priya@example.com",
      phone: "+919800000000",
      interest: "which plan interests you: Guru plan",
      campaign: "Institutes Q4",
      formId: "f9",
    });
    expect(l.createdAt?.toISOString()).toBe("2026-11-05T10:00:00.000Z");
  });

  it("joins first and last name when there is no full name", () => {
    const l = parseMetaLead({ id: "1", field_data: [{ name: "first_name", values: ["Rahul"] }, { name: "last_name", values: ["Verma"] }] });
    expect(l.name).toBe("Rahul Verma");
    expect(l.interest).toBe("Meta lead form");
  });
});

describe("Google lead webhooks", () => {
  it("checks the key in the body", () => {
    expect(verifyGoogleKey("k3y", { google_key: "k3y" })).toBe(true);
    expect(verifyGoogleKey("k3y", { google_key: "nope" })).toBe(false);
    expect(verifyGoogleKey("k3y", {})).toBe(false);
  });

  it("turns user_column_data into a lead and marks test leads", () => {
    const l = parseGoogleLead({
      lead_id: "g-1",
      form_id: 12,
      campaign_id: 34,
      is_test: true,
      user_column_data: [
        { column_id: "FULL_NAME", string_value: "Anjali Gupta" },
        { column_id: "EMAIL", string_value: "anjali@example.com" },
        { column_id: "PHONE_NUMBER", string_value: "+919811111111" },
        { column_name: "What do you teach?", column_id: "SERVICE", string_value: "KP astrology" },
      ],
    });
    expect(l).toMatchObject({ source: "google_lead_form", platformLeadId: "g-1", name: "Anjali Gupta", email: "anjali@example.com", phone: "+919811111111", formId: "12", campaign: "34", interest: "service: KP astrology" });
    expect(l.fields.is_test).toBe("true");
  });

  it("refuses a payload without a lead id", () => {
    expect(() => parseGoogleLead({})).toThrow(/lead_id/);
  });
});

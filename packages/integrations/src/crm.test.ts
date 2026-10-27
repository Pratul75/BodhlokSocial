import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { invoicesToPayments, leadChannel, leadFromRecord, redact, verifyCrmSignature } from "./crm";

const sign = (secret: string, body: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("verifyCrmSignature", () => {
  const body = JSON.stringify({ id: "invoice.paid:1", event: "invoice.paid", data: { accountId: "a1" } });

  it("accepts the CRM's sha256= HMAC of the raw body", () => {
    expect(verifyCrmSignature("whsec_x", body, sign("whsec_x", body))).toBe(true);
  });

  it("rejects a wrong secret, a changed body and a missing header", () => {
    expect(verifyCrmSignature("whsec_y", body, sign("whsec_x", body))).toBe(false);
    expect(verifyCrmSignature("whsec_x", `${body} `, sign("whsec_x", body))).toBe(false);
    expect(verifyCrmSignature("whsec_x", body, null)).toBe(false);
    expect(verifyCrmSignature("whsec_x", body, "sha256=00")).toBe(false);
  });
});

describe("redact", () => {
  it("removes personal fields at any depth and keeps the rest", () => {
    const out = redact({ event: "lead.created", record: { id: "l1", firstName: "Priya", email: "p@x.in", phone: "98", source: "Website", custom: { billingEmail: "b@x.in", mpAccountId: "a1" } } });
    expect(out).toEqual({ event: "lead.created", record: { id: "l1", firstName: "[removed]", email: "[removed]", phone: "[removed]", source: "Website", custom: { billingEmail: "[removed]", mpAccountId: "a1" } } });
  });
});

describe("invoicesToPayments", () => {
  const acct = { mpAccountId: "acc_1", userRef: "u_1", plan: "jyotish" };
  const inv = (id: string, paidAt: string | null, status: string, payments: { status: string; amountPaise: number }[] = []) => ({
    id, number: `INV-${id}`, status, totalPaise: 118000, gstPaise: 18000, currency: "inr", paidAt, createdAt: paidAt ?? "2026-10-01T00:00:00Z", payments,
  });

  it("keeps paid invoices oldest first, the first as first and the rest as repeat", () => {
    const rows = invoicesToPayments(
      [inv("b", "2026-11-01T10:00:00Z", "paid", [{ status: "succeeded", amountPaise: 118000 }]), inv("a", "2026-10-01T10:00:00Z", "paid", [{ status: "succeeded", amountPaise: 118000 }]), inv("c", null, "issued")],
      acct,
    );
    expect(rows.map((r) => [r.invoiceId, r.kind, r.status])).toEqual([["a", "first", "paid"], ["b", "repeat", "paid"]]);
    expect(rows[0]).toMatchObject({ mpAccountId: "acc_1", userRef: "u_1", plan: "jyotish", totalPaise: 118000, gstPaise: 18000, currency: "INR" });
  });

  it("marks refunds and chargebacks from the invoice's payments", () => {
    const rows = invoicesToPayments(
      [
        inv("r", "2026-10-02T00:00:00Z", "paid", [{ status: "refunded", amountPaise: 118000 }]),
        inv("p", "2026-10-03T00:00:00Z", "paid", [{ status: "succeeded", amountPaise: 118000 }, { status: "refunded", amountPaise: 1000 }]),
        inv("c", "2026-10-04T00:00:00Z", "paid", [{ status: "chargeback", amountPaise: 118000 }]),
      ],
      acct,
    );
    expect(rows.map((r) => r.status)).toEqual(["refunded", "paid", "chargeback"]);
  });
});

describe("leadChannel", () => {
  it("counts Facebook Lead Ads leads as paid Meta", () => {
    expect(leadChannel({ source: "Facebook Lead Ads", fbAdId: "238" })).toBe("meta_ads");
    expect(leadChannel({ source: "anything", fbFormId: "f1" })).toBe("meta_ads");
  });

  it("uses UTMs when the lead carries them, else the CRM's source label", () => {
    expect(leadChannel({ source: "Website", utmSource: "google", utmMedium: "cpc" })).toBe("google_ads");
    expect(leadChannel({ source: "Google Ads lead form" })).toBe("google_ads");
    expect(leadChannel({ source: "Instagram" })).toBe("instagram");
    expect(leadChannel({ source: "WhatsApp" })).toBe("whatsapp");
    expect(leadChannel({ source: "Referral" })).toBe("referral");
    expect(leadChannel({ source: "Website" })).toBe("other");
    expect(leadChannel({ source: null })).toBe("other");
  });
});

describe("leadFromRecord", () => {
  const record = {
    id: "lead_1",
    firstName: "Priya",
    email: " Priya@Example.in ",
    phone: "98765 43210",
    source: "Facebook Lead Ads",
    status: "OPEN",
    value: "2500.5",
    stageId: "st_1",
    fbCampaignId: "c1",
    fbAdsetId: "s1",
    fbAdId: "ad1",
    fbFormId: "f1",
    custom: {},
    createdAt: "2026-10-27T09:00:00.000Z",
    updatedAt: "2026-10-27T09:05:00.000Z",
  };

  it("keeps ids, ad IDs and hashes, never the name or raw contact details", () => {
    const row = leadFromRecord(record, "lead.created")!;
    expect(row).toMatchObject({ crmLeadId: "lead_1", kind: "lead", channel: "meta_ads", status: "open", value: "2500.50", fbAdId: "ad1", stageId: "st_1", lastEvent: "lead.created" });
    expect(row.emailSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(row.phoneSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toMatch(/Priya|example\.in|98765/i);
  });

  it("marks signups the CRM mirrors from billing, conversions and deletions", () => {
    expect(leadFromRecord({ ...record, custom: { mpAccountId: "acc_1", mpExternalRef: "u_9" } })).toMatchObject({ kind: "signup", userRef: "u_9" });
    const converted = leadFromRecord({ ...record, status: "CONVERTED" }, "lead.converted")!;
    expect(converted.status).toBe("converted");
    expect(converted.convertedAt).toBeInstanceOf(Date);
    expect(leadFromRecord({ ...record, deletedAt: "2026-10-28T00:00:00Z" })!.status).toBe("deleted");
  });

  it("needs an id and a creation time", () => {
    expect(leadFromRecord({ ...record, id: undefined })).toBeNull();
    expect(leadFromRecord({ ...record, createdAt: "not a date" })).toBeNull();
  });
});

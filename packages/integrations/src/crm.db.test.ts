/**
 * CRM webhooks to the funnel, against a real Postgres database, with the CRM's billing API
 * mocked at fetch. Creates and drops its own database; skipped when Postgres isn't reachable.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const base = process.env.DATABASE_URL ?? "postgres://bodh:bodh@localhost:5433/bodh";
const dbName = `bodh_crmtest_${Date.now()}`;
const admin = postgres(base, { max: 1, onnotice: () => {} });
const reachable = await admin`select 1`.then(() => true).catch(() => false);

describe.skipIf(!reachable)("CRM feeds with a database", () => {
  let dir: string;
  let m: {
    db: typeof import("@bodh/db");
    crm: typeof import("./crm");
    pipeline: typeof import("./pipeline");
    secrets: typeof import("./secrets");
  };
  let invoices: Record<string, unknown>[] = [];
  const calls: { url: string; auth: string | null }[] = [];

  beforeAll(async () => {
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    const url = base.replace(/\/[^/]+$/, `/${dbName}`);
    process.env.DATABASE_URL = url;
    dir = await mkdtemp(join(tmpdir(), "bodh-crm-"));
    process.env.SECRETS_DIR = join(dir, "secrets");
    delete process.env.SECRETS_BACKEND;

    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const mc = postgres(url, { max: 1, onnotice: () => {} });
    await migrate(drizzle(mc), { migrationsFolder: fileURLToPath(new URL("../../db/migrations", import.meta.url)) });
    await mc.end();

    m = { db: await import("@bodh/db"), crm: await import("./crm"), pipeline: await import("./pipeline"), secrets: await import("./secrets") };
    const store = await m.secrets.secretStore();
    await store.put("integration-crm_billing", JSON.stringify({ webhook_secret: "whsec_test", api_key: "mp_key", base_url: "https://crm.test/" }));
    await store.put("integration-crm_leads", JSON.stringify({ webhook_secret: "lead_secret" }));
    await m.db.db.insert(m.db.connections).values([{ key: "crm_billing" }, { key: "crm_leads" }]).onConflictDoNothing();

    vi.stubGlobal("fetch", async (u: string | URL, init?: RequestInit) => {
      const url = String(u);
      calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
      if (url.startsWith("https://crm.test/api/mp/v1/invoices?accountRef=u_1")) return Response.json({ invoices });
      return new Response("not mocked", { status: 500 });
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (m) await m.db.sql.end();
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const day = "2026-10-20";
  const paidInvoice = (status: string) => ({
    id: "inv_1",
    number: "BOD-0001",
    status: "paid",
    totalPaise: 118000,
    gstPaise: 18000,
    currency: "INR",
    paidAt: `${day}T08:00:00.000Z`,
    createdAt: `${day}T07:59:00.000Z`,
    payments: [{ provider: "razorpay", status, amountPaise: 118000 }],
  });

  it("registers a user from a Meta ad", async () => {
    const r = await m.pipeline.ingestEvents([
      {
        eventId: "reg:u_1",
        type: "registration",
        occurredAt: new Date(`${day}T06:00:00.000Z`),
        userRef: "u_1",
        emailSha256: null,
        phoneSha256: null,
        platform: "web",
        plan: null,
        value: null,
        currency: "INR",
        attribution: { utm_source: "meta", utm_medium: "paid_social", utm_campaign: "c1", utm_content: "ad1" },
        clientIp: null,
        userAgent: null,
      },
    ]);
    expect(r.accepted).toBe(1);
  });

  it("waits on a paid invoice until the account is linked, then reads the amounts", async () => {
    invoices = [paidInvoice("succeeded")];
    const waiting = await m.crm.handleBillingWebhook({ id: "invoice.paid:1", event: "invoice.paid", data: { subscriptionId: "sub_1", accountId: "acc_1" } }, "invoice.paid:1");
    expect(waiting.status).toBe("waiting");
    expect(calls).toHaveLength(0);

    const linked = await m.crm.handleBillingWebhook(
      { id: "subscription.updated:1", event: "subscription.updated", data: { accountId: "acc_1", externalRef: "u_1", subscriptionId: "sub_1", status: "ACTIVE", planSlug: "jyotish", from: "PENDING", to: "ACTIVE" } },
      "subscription.updated:1",
    );
    expect(linked).toMatchObject({ status: "processed" });
    expect(calls.at(-1)).toEqual({ url: "https://crm.test/api/mp/v1/invoices?accountRef=u_1", auth: "Bearer mp_key" });

    const { db, payments, conversionEvents } = m.db;
    const [p] = await db.select().from(payments);
    expect(p).toMatchObject({ invoiceId: "inv_1", userRef: "u_1", kind: "first", status: "paid", totalPaise: 118000, gstPaise: 18000, plan: "jyotish" });
    const paid = await db.select().from(conversionEvents).where(eq(conversionEvents.type, "paid"));
    // The paid conversion inherits the registration's channel and ad.
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ eventId: "mp:inv:inv_1", userRef: "u_1", channel: "meta_ads", utmContent: "ad1", plan: "jyotish", value: "1000.00" });
  });

  it("acknowledges a retried delivery once", async () => {
    const again = await m.crm.handleBillingWebhook({ id: "subscription.updated:1", event: "subscription.updated", data: { accountId: "acc_1", externalRef: "u_1" } }, "subscription.updated:1");
    expect(again.status).toBe("duplicate");
    const n = calls.length;
    await m.crm.handleBillingWebhook({ id: "invoice.paid:2", event: "invoice.paid", data: { subscriptionId: "sub_1", accountId: "acc_1" } }, "invoice.paid:2");
    expect(calls.length).toBe(n + 1);
    expect(await m.db.db.select().from(m.db.conversionEvents).where(eq(m.db.conversionEvents.type, "paid"))).toHaveLength(1);
  });

  it("mirrors lead webhooks and ignores an older update", async () => {
    const lead = { id: "lead_1", firstName: "Priya", email: "priya@example.in", source: "Facebook Lead Ads", status: "OPEN", fbCampaignId: "c1", fbAdId: "ad1", custom: {}, createdAt: `${day}T05:00:00.000Z`, updatedAt: `${day}T05:00:00.000Z` };
    const created = { event: "lead.created", entityType: "LEAD", entityId: "lead_1", record: lead };
    expect((await m.crm.handleLeadWebhook(created, JSON.stringify(created))).status).toBe("processed");
    expect((await m.crm.handleLeadWebhook(created, JSON.stringify(created))).status).toBe("duplicate");

    const converted = { event: "lead.converted", entityType: "LEAD", entityId: "lead_1", record: { ...lead, status: "CONVERTED", updatedAt: `${day}T09:00:00.000Z` } };
    await m.crm.handleLeadWebhook(converted, JSON.stringify(converted));
    const stale = { event: "lead.updated", entityType: "LEAD", entityId: "lead_1", record: { ...lead, status: "OPEN", updatedAt: `${day}T07:00:00.000Z` } };
    expect((await m.crm.handleLeadWebhook(stale, JSON.stringify(stale))).status).toBe("ignored");

    const signup = { event: "lead.created", entityType: "LEAD", entityId: "lead_2", record: { ...lead, id: "lead_2", source: "bodhlok", fbAdId: null, fbCampaignId: null, custom: { mpAccountId: "acc_1", mpExternalRef: "u_1" } } };
    await m.crm.handleLeadWebhook(signup, JSON.stringify(signup));
    const deal = { event: "deal.created", entityType: "DEAL", entityId: "d1", record: { id: "d1" } };
    expect((await m.crm.handleLeadWebhook(deal, JSON.stringify(deal))).status).toBe("ignored");

    const rows = await m.db.db.select().from(m.db.leads).orderBy(m.db.leads.crmLeadId);
    expect(rows.map((r) => [r.crmLeadId, r.kind, r.channel, r.status])).toEqual([["lead_1", "lead", "meta_ads", "converted"], ["lead_2", "signup", "other", "open"]]);
    const log = await m.db.db.select().from(m.db.webhookDeliveries);
    expect(JSON.stringify(log)).not.toMatch(/Priya|example\.in/);
  });

  it("puts leads, payers and revenue on the funnel and on the ad", async () => {
    const { db, adSpendDaily, funnelDaily, rebuildFunnel, creativePerformance } = m.db;
    await db.insert(adSpendDaily).values({ day, platform: "meta_ads", campaignId: "c1", campaignName: "Launch", adId: "ad1", adName: "Desk demo", spend: "500", impressions: 1000, clicks: 40 });
    await rebuildFunnel("2026-10-01", "2026-10-31");
    const [row] = await db.select().from(funnelDaily).where(eq(funnelDaily.channel, "meta_ads"));
    expect(row).toMatchObject({ day, spend: 500, registrations: 1, paid: 1, leads: 1, revenue: 1000 });
    const [ad] = await creativePerformance("2026-10-01", "2026-10-31");
    expect(ad).toMatchObject({ adId: "ad1", registrations: 1, leads: 1, revenue: 1000 });
  });

  it("takes a refund out of revenue on the nightly sync", async () => {
    invoices = [paidInvoice("refunded")];
    const r = await m.crm.reconcileBilling();
    expect(r).toMatchObject({ accounts: 1, payments: 1, failed: 0 });
    const [p] = await m.db.db.select().from(m.db.payments);
    expect(p!.status).toBe("refunded");
    await m.db.rebuildFunnel("2026-10-01", "2026-10-31");
    const [row] = await m.db.db.select().from(m.db.funnelDaily).where(eq(m.db.funnelDaily.channel, "meta_ads"));
    expect(row!.revenue).toBe(0);
  });
});

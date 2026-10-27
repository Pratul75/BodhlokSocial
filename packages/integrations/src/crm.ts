/**
 * The Agentic CRM (agentic.rechargestudio.com) owns people and money; Growth OS only counts
 * and attributes them. Two feeds come in:
 *
 *   crm_billing  the CRM's Monetization API (MP), which runs Bodhlok's billing. Its project
 *                webhooks (X-Mp-Signature) say when a subscription changes or an invoice is
 *                paid; the amounts come from GET /api/mp/v1/invoices, because the webhook
 *                carries none and refunds are not webhooked at all. A nightly sync re-reads
 *                every known account, which also catches refunds and missed deliveries.
 *   crm_leads    the CRM's org webhooks (X-Webhook-Signature) for lead.created, updated,
 *                stage_changed and converted, mirrored into `leads`; a nightly pull from
 *                GET /api/v1/leads fills in anything missed.
 *
 * Nothing personal is kept: emails and phones are hashed, names are never stored, and the
 * webhook log strips personal fields. docs/crm.md has the setup on the CRM side.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { billingAccounts, connections, conversionEvents, db, leads, payments, webhookDeliveries } from "@bodh/db";
import type { AttributionChannel } from "@bodh/shared";
import { attribute } from "./attribution";
import { normalizeEmail, normalizePhone, sha256, type NormalizedEvent } from "./bodh-events";
import { readJsonSecret } from "./secrets";

export const CRM_URL = "https://agentic.rechargestudio.com";

export type CrmFeed = "crm_billing" | "crm_leads";

export interface CrmCredentials {
  webhook_secret: string;
  api_key?: string;
  base_url?: string;
}

export async function crmCredentials(feed: CrmFeed): Promise<CrmCredentials | null> {
  const c = await readJsonSecret<CrmCredentials>(feed);
  return c?.webhook_secret ? c : null;
}

export const crmBase = (c: Pick<CrmCredentials, "base_url"> | null | undefined) => (c?.base_url?.trim() || CRM_URL).replace(/\/$/, "");

/* ---------- signatures and the delivery log ---------- */

/** Both CRM senders sign the raw body: "sha256=" + hex HMAC-SHA256 with the endpoint's secret. */
export function verifyCrmSignature(secret: string, rawBody: string, header: string | null | undefined): boolean {
  if (!header) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const given = Buffer.from(header.trim());
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const PERSONAL = new Set(["email", "billingemail", "phone", "mobile", "firstname", "lastname", "name", "fullname", "address", "gstin", "city", "companyname", "notes", "description"]);

/** A copy with personal fields replaced, for the webhook log. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "…";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, PERSONAL.has(k.toLowerCase()) && v != null ? "[removed]" : redact(v, depth + 1)]),
    );
  }
  return value;
}

/** Records a delivery once; false when the same delivery was already received. */
async function logDelivery(source: CrmFeed, deliveryKey: string, event: string, payload: unknown): Promise<boolean> {
  const rows = await db
    .insert(webhookDeliveries)
    .values({ source, deliveryKey, event, status: "received", payload: redact(payload) as Record<string, unknown> })
    .onConflictDoNothing()
    .returning({ id: webhookDeliveries.id });
  return rows.length > 0;
}

async function finishDelivery(source: CrmFeed, deliveryKey: string, status: string, detail?: string) {
  await db
    .update(webhookDeliveries)
    .set({ status, detail: detail?.slice(0, 500) ?? null })
    .where(and(eq(webhookDeliveries.source, source), eq(webhookDeliveries.deliveryKey, deliveryKey)));
}

async function markConnection(feed: CrmFeed, error: string | null) {
  await db
    .update(connections)
    .set(error ? { status: "error", error: error.slice(0, 500), updatedAt: new Date() } : { status: "connected", error: null, lastSyncAt: new Date(), updatedAt: new Date() })
    .where(eq(connections.key, feed));
}

export interface WebhookResult {
  status: "processed" | "ignored" | "waiting" | "duplicate";
  detail: string;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/* ---------- billing (MP) ---------- */

export interface MpWebhook {
  id: string;
  event: string;
  data: Record<string, unknown>;
  createdAt?: string;
}

/** One invoice as GET /api/mp/v1/invoices returns it. */
export interface MpInvoiceView {
  id: string;
  number?: string | null;
  status: string; // draft | issued | paid | void
  totalPaise: number;
  gstPaise?: number | null;
  currency?: string | null;
  paidAt?: string | null;
  createdAt: string;
  payments?: { provider?: string; status: string; amountPaise: number }[];
}

/**
 * Paid invoices as payment rows. An invoice counts once it has a paidAt; its status follows
 * its payments: a chargeback wins, then refunded (when nothing succeeded), else paid. The API
 * does not say renewal or add-on, so the earliest paid invoice is "first" and later ones "repeat".
 */
export function invoicesToPayments(
  invoices: MpInvoiceView[],
  account: { mpAccountId: string; userRef: string | null; plan: string | null },
): (typeof payments.$inferInsert)[] {
  const paid = invoices.filter((i) => i.paidAt && (i.status === "paid" || (i.payments ?? []).length > 0)).sort((a, b) => Date.parse(a.paidAt!) - Date.parse(b.paidAt!));
  return paid.map((i, n) => {
    const ps = i.payments ?? [];
    const status = ps.some((p) => p.status === "chargeback")
      ? "chargeback"
      : ps.some((p) => p.status === "refunded") && !ps.some((p) => p.status === "succeeded")
        ? "refunded"
        : "paid";
    return {
      invoiceId: i.id,
      mpAccountId: account.mpAccountId,
      userRef: account.userRef,
      number: i.number ?? null,
      kind: n === 0 ? "first" : "repeat",
      status,
      totalPaise: Math.round(i.totalPaise),
      gstPaise: Math.round(i.gstPaise ?? 0),
      currency: (i.currency ?? "INR").toUpperCase(),
      plan: account.plan,
      paidAt: new Date(i.paidAt!),
      updatedAt: new Date(),
    };
  });
}

async function mpGet<T>(creds: CrmCredentials, path: string): Promise<T> {
  if (!creds.api_key) throw new Error("The billing connection has no API key, so invoice amounts can't be read. Add one with entitlements:read.");
  const res = await fetch(`${crmBase(creds)}/api/mp/v1${path}`, {
    headers: { Authorization: `Bearer ${creds.api_key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Object.assign(new Error(`CRM billing API ${res.status}: ${body.slice(0, 200) || res.statusText}`), { status: res.status });
  }
  return (await res.json()) as T;
}

/**
 * The first paid invoice of a user becomes their `paid` conversion, so the funnel and Meta
 * hear about it. Skipped when the user already has one (from the BODH backend or earlier).
 */
async function ensurePaidConversion(userRef: string): Promise<boolean> {
  const [first] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.userRef, userRef), eq(payments.status, "paid")))
    .orderBy(asc(payments.paidAt))
    .limit(1);
  if (!first) return false;
  const [existing] = await db
    .select({ id: conversionEvents.id })
    .from(conversionEvents)
    .where(and(eq(conversionEvents.userRef, userRef), eq(conversionEvents.type, "paid")))
    .limit(1);
  if (existing) return false;
  const event: NormalizedEvent = {
    eventId: `mp:inv:${first.invoiceId}`,
    type: "paid",
    occurredAt: first.paidAt,
    userRef,
    emailSha256: null,
    phoneSha256: null,
    platform: "web",
    plan: first.plan,
    value: (first.totalPaise - first.gstPaise) / 100,
    currency: first.currency,
    attribution: null,
    clientIp: null,
    userAgent: null,
  };
  const { ingestEvents } = await import("./pipeline");
  return (await ingestEvents([event])).accepted > 0;
}

/** Reads one account's invoices from the CRM and stores them. Returns the payments written. */
export async function syncBillingAccount(mpAccountId: string, creds?: CrmCredentials | null): Promise<number> {
  const c = creds ?? (await crmCredentials("crm_billing"));
  if (!c) throw new Error("The CRM billing connection isn't set up.");
  const [acct] = await db.select().from(billingAccounts).where(eq(billingAccounts.mpAccountId, mpAccountId)).limit(1);
  if (!acct?.userRef) return 0;
  const { invoices } = await mpGet<{ invoices: MpInvoiceView[] }>(c, `/invoices?accountRef=${encodeURIComponent(acct.userRef)}`);
  const rows = invoicesToPayments(invoices, acct);
  for (const r of rows) {
    await db
      .insert(payments)
      .values(r)
      .onConflictDoUpdate({ target: payments.invoiceId, set: { status: r.status, kind: r.kind, totalPaise: r.totalPaise, gstPaise: r.gstPaise, userRef: r.userRef, plan: r.plan, paidAt: r.paidAt, updatedAt: new Date() } });
  }
  await db.update(billingAccounts).set({ syncedAt: new Date() }).where(eq(billingAccounts.mpAccountId, mpAccountId));
  await ensurePaidConversion(acct.userRef);
  return rows.length;
}

/** subscription.updated and entitlements.updated carry the account, its externalRef and plan. */
async function upsertAccount(d: Record<string, unknown>): Promise<string | null> {
  const mpAccountId = str(d.accountId);
  if (!mpAccountId) return null;
  const values = {
    mpAccountId,
    userRef: str(d.externalRef),
    subscriptionId: str(d.subscriptionId),
    status: str(d.status) ?? str(d.to),
    plan: str(d.planSlug),
    updatedAt: new Date(),
  };
  await db
    .insert(billingAccounts)
    .values(values)
    .onConflictDoUpdate({
      target: billingAccounts.mpAccountId,
      set: {
        userRef: sql`coalesce(excluded.user_ref, ${billingAccounts.userRef})`,
        subscriptionId: sql`coalesce(excluded.subscription_id, ${billingAccounts.subscriptionId})`,
        status: sql`coalesce(excluded.status, ${billingAccounts.status})`,
        plan: sql`coalesce(excluded.plan, ${billingAccounts.plan})`,
        updatedAt: new Date(),
      },
    });
  return mpAccountId;
}

/** Handles one verified billing webhook. Duplicate deliveries (same X-Mp-Id) are acknowledged and skipped. */
export async function handleBillingWebhook(body: MpWebhook, deliveryKey: string): Promise<WebhookResult> {
  if (!(await logDelivery("crm_billing", deliveryKey, body.event, body))) return { status: "duplicate", detail: "Already received." };
  const d = body.data ?? {};
  let result: WebhookResult;
  try {
    if (body.event === "subscription.updated" || body.event === "entitlements.updated" || body.event === "subscription.created") {
      const accountId = await upsertAccount(d);
      if (!accountId) result = { status: "ignored", detail: "No accountId." };
      else if (!str(d.externalRef)) result = { status: "processed", detail: "Account recorded; no externalRef yet." };
      else result = { status: "processed", detail: `Synced ${await syncBillingAccount(accountId)} invoice(s).` };
    } else if (body.event === "invoice.paid") {
      const accountId = str(d.accountId);
      const [acct] = accountId ? await db.select().from(billingAccounts).where(eq(billingAccounts.mpAccountId, accountId)).limit(1) : [];
      if (!accountId) result = { status: "ignored", detail: "No accountId." };
      else if (!acct?.userRef) {
        // The subscription event that names the user usually arrives alongside; the nightly sync catches the rest.
        await db.insert(billingAccounts).values({ mpAccountId: accountId, subscriptionId: str(d.subscriptionId) }).onConflictDoNothing();
        result = { status: "waiting", detail: "Paid invoice for an account not yet linked to a BODH user." };
      } else result = { status: "processed", detail: `Synced ${await syncBillingAccount(accountId)} invoice(s).` };
    } else {
      result = { status: "ignored", detail: `Not used: ${body.event}.` };
    }
    await markConnection("crm_billing", null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finishDelivery("crm_billing", deliveryKey, "failed", msg);
    await markConnection("crm_billing", msg);
    throw e;
  }
  await finishDelivery("crm_billing", deliveryKey, result.status, result.detail);
  return result;
}

/** Nightly: re-reads every linked account (oldest sync first), which catches refunds and missed webhooks. */
export async function reconcileBilling(limit = 500): Promise<{ accounts: number; payments: number; failed: number; detail: string }> {
  const creds = await crmCredentials("crm_billing");
  if (!creds) return { accounts: 0, payments: 0, failed: 0, detail: "CRM billing isn't connected." };
  if (!creds.api_key) return { accounts: 0, payments: 0, failed: 0, detail: "CRM billing has no API key; add one to read invoices." };
  const accounts = await db
    .select({ id: billingAccounts.mpAccountId })
    .from(billingAccounts)
    .where(isNotNull(billingAccounts.userRef))
    .orderBy(sql`${billingAccounts.syncedAt} asc nulls first`)
    .limit(limit);
  let written = 0;
  let failed = 0;
  let lastError = "";
  for (const a of accounts) {
    try {
      written += await syncBillingAccount(a.id, creds);
    } catch (e) {
      failed++;
      lastError = e instanceof Error ? e.message : String(e);
      // A bad key fails every account the same way; stop instead of hammering the API.
      if ((e as { status?: number }).status === 401 || (e as { status?: number }).status === 403) break;
    }
  }
  await markConnection("crm_billing", failed && !written ? lastError : null);
  return { accounts: accounts.length, payments: written, failed, detail: `${accounts.length} account(s), ${written} invoice(s)${failed ? `, ${failed} failed: ${lastError}` : ""}.` };
}

/* ---------- leads ---------- */

export interface CrmWebhook {
  event: string;
  entityType: string;
  entityId: string;
  record: Record<string, unknown> | null;
  changes?: unknown;
}

const LEAD_EVENTS = new Set(["lead.created", "lead.updated", "lead.stage_changed", "lead.converted"]);

/**
 * Which channel a CRM lead counts under. Facebook Lead Ads leads carry the campaign, ad set
 * and ad IDs and are paid Meta leads; otherwise the CRM's source label and any UTMs decide.
 */
export function leadChannel(l: { source?: string | null; fbAdId?: string | null; fbCampaignId?: string | null; fbFormId?: string | null; utmSource?: string | null; utmMedium?: string | null }): AttributionChannel {
  if (l.fbAdId || l.fbCampaignId || l.fbFormId) return "meta_ads";
  if (l.utmSource || l.utmMedium) return attribute({ utmSource: l.utmSource, utmMedium: l.utmMedium });
  const s = (l.source ?? "").toLowerCase();
  if (/google/.test(s) && /ads?\b|lead form|adwords/.test(s)) return "google_ads";
  if (/facebook|instagram|\bmeta\b|\bfb\b/.test(s)) return /lead ads?|lead form|\bads?\b/.test(s) ? "meta_ads" : /instagram/.test(s) ? "instagram" : "facebook";
  if (/whatsapp/.test(s)) return "whatsapp";
  if (/youtube/.test(s)) return "youtube";
  if (/linkedin/.test(s)) return "linkedin";
  if (/referr|affiliate/.test(s)) return "referral";
  if (/e-?mail|newsletter/.test(s)) return "email";
  if (/google|seo|organic/.test(s)) return "seo";
  return "other";
}

const STATUS: Record<string, string> = { OPEN: "open", CONVERTED: "converted", LOST: "lost" };
const date = (v: unknown) => {
  const d = typeof v === "string" || v instanceof Date ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/** A CRM lead record (webhook record or API row) as a mirror row, without names or raw contact details. */
export function leadFromRecord(record: Record<string, unknown>, event?: string): (typeof leads.$inferInsert) | null {
  const crmLeadId = str(record.id);
  const createdAt = date(record.createdAt);
  if (!crmLeadId || !createdAt) return null;
  const custom = (record.custom && typeof record.custom === "object" ? record.custom : {}) as Record<string, unknown>;
  const email = str(record.email);
  const phone = str(record.phone);
  const e = email ? normalizeEmail(email) : null;
  const p = phone ? normalizePhone(phone) : null;
  const row = {
    crmLeadId,
    kind: custom.mpAccountId ? "signup" : "lead",
    source: str(record.source),
    fbCampaignId: str(record.fbCampaignId),
    fbAdsetId: str(record.fbAdsetId),
    fbAdId: str(record.fbAdId),
    fbFormId: str(record.fbFormId),
    utmSource: str(custom.utm_source),
    utmMedium: str(custom.utm_medium),
    utmCampaign: str(custom.utm_campaign),
    utmContent: str(custom.utm_content),
  };
  const deleted = record.deletedAt != null;
  const status = deleted ? "deleted" : event === "lead.converted" ? "converted" : (STATUS[String(record.status ?? "").toUpperCase()] ?? "open");
  const value = record.value == null ? null : Number(record.value);
  return {
    ...row,
    channel: leadChannel(row),
    status,
    stageId: str(record.stageId),
    value: value == null || Number.isNaN(value) ? null : value.toFixed(2),
    userRef: str(custom.mpExternalRef),
    emailSha256: e ? sha256(e) : null,
    phoneSha256: p ? sha256(p) : null,
    crmCreatedAt: createdAt,
    crmUpdatedAt: date(record.updatedAt),
    convertedAt: status === "converted" ? (date(record.convertedAt) ?? date(record.updatedAt) ?? new Date()) : null,
    lastEvent: event ?? "pull",
    syncedAt: new Date(),
  };
}

/** Writes a webhook lead. An older record never overwrites a newer one. */
async function upsertLead(row: typeof leads.$inferInsert): Promise<"inserted" | "updated" | "stale"> {
  const [existing] = await db.select({ crmUpdatedAt: leads.crmUpdatedAt, convertedAt: leads.convertedAt }).from(leads).where(eq(leads.crmLeadId, row.crmLeadId)).limit(1);
  if (!existing) {
    await db.insert(leads).values(row).onConflictDoNothing();
    return "inserted";
  }
  if (existing.crmUpdatedAt && row.crmUpdatedAt && row.crmUpdatedAt < existing.crmUpdatedAt) return "stale";
  const { crmLeadId: _id, ...set } = row;
  await db.update(leads).set({ ...set, convertedAt: existing.convertedAt ?? set.convertedAt }).where(eq(leads.crmLeadId, row.crmLeadId));
  return "updated";
}

/** Handles one verified lead webhook. The CRM sends no event ID, so a hash of the body is the delivery key. */
export async function handleLeadWebhook(body: CrmWebhook, rawBody: string): Promise<WebhookResult> {
  const key = sha256(rawBody);
  if (!(await logDelivery("crm_leads", key, body.event, body))) return { status: "duplicate", detail: "Already received." };
  let result: WebhookResult;
  if (body.entityType !== "LEAD" || !LEAD_EVENTS.has(body.event) || !body.record) {
    result = { status: "ignored", detail: `Not used: ${body.event}.` };
  } else {
    const row = leadFromRecord(body.record, body.event);
    if (!row) result = { status: "ignored", detail: "Lead without id or createdAt." };
    else {
      const r = await upsertLead(row);
      result = { status: r === "stale" ? "ignored" : "processed", detail: r === "stale" ? "Older than the stored lead." : `Lead ${r} (${row.kind}, ${row.channel}).` };
    }
  }
  await finishDelivery("crm_leads", key, result.status, result.detail);
  await markConnection("crm_leads", null);
  return result;
}

/**
 * Nightly: pages through GET /api/v1/leads (newest first) and adds leads the webhooks missed.
 * The API row has no ad IDs, so it never overwrites a webhook's; for known leads it only
 * updates the status and value. Stops at leads older than `days`.
 */
export async function pullLeads(days = 30, maxPages = 20): Promise<{ added: number; updated: number; detail: string }> {
  const creds = await crmCredentials("crm_leads");
  if (!creds?.api_key) return { added: 0, updated: 0, detail: creds ? "CRM leads has no API key; webhooks only." : "CRM leads isn't connected." };
  const cutoff = Date.now() - days * 86_400_000;
  let added = 0;
  let updated = 0;
  try {
    for (let page = 1; page <= maxPages; page++) {
      const res = await fetch(`${crmBase(creds)}/api/v1/leads?page=${page}&pageSize=100`, {
        headers: { "X-API-Key": creds.api_key, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`CRM leads API ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
      const { data } = (await res.json()) as { data: Record<string, unknown>[] };
      if (!data?.length) break;
      let older = false;
      for (const rec of data) {
        const row = leadFromRecord(rec);
        if (!row) continue;
        if (row.crmCreatedAt.getTime() < cutoff) {
          older = true;
          continue;
        }
        const ins = await db.insert(leads).values(row).onConflictDoNothing().returning({ id: leads.id });
        if (ins.length) added++;
        else {
          const upd = await db
            .update(leads)
            .set({ status: row.status, value: row.value, syncedAt: new Date() })
            .where(and(eq(leads.crmLeadId, row.crmLeadId), sql`(${leads.status} is distinct from ${row.status} or ${leads.value} is distinct from ${row.value}::numeric)`))
            .returning({ id: leads.id });
          updated += upd.length;
        }
      }
      if (older || data.length < 100) break;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await markConnection("crm_leads", msg);
    throw e;
  }
  await markConnection("crm_leads", null);
  return { added, updated, detail: `Added ${added} lead(s), updated ${updated}.` };
}

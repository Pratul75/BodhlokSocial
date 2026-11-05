/**
 * Lead-form leads from Meta Lead Ads and Google Ads lead forms. Both arrive by webhook:
 *   Meta    POST /api/webhooks/meta-leads   X-Hub-Signature-256 = sha256 HMAC of the body with META_APP_SECRET;
 *           the body only names the lead, so its answers are read from the Graph API with the
 *           Meta Marketing connection's token (needs leads_retrieval).
 *   Google  POST /api/webhooks/google-leads JSON with every answer and google_key = GOOGLE_LEADS_WEBHOOK_KEY.
 * A re-delivered webhook is stored once (unique on source + platform lead id). New leads go to
 * the active Sales person with the fewest leads in the last 30 days.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, count, eq, gte, sql } from "drizzle-orm";
import { auditLog, db, leads, users } from "@bodh/db";
import { GRAPH_VERSION, type MarketingCredentials } from "./meta";
import { readJsonSecret } from "./secrets";

export interface IncomingLead {
  source: "meta_lead_form" | "google_lead_form";
  platformLeadId: string;
  name: string;
  email: string | null;
  phone: string | null;
  interest: string;
  formId: string | null;
  campaign: string | null;
  fields: Record<string, string>;
  createdAt?: Date;
}

/* ---------- Meta ---------- */

/** Checks Meta's X-Hub-Signature-256 header ("sha256=<hex>") against the raw body. */
export function verifyMetaSignature(appSecret: string, rawBody: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const want = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const got = Buffer.from(header.slice(7), "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** leadgen_id and form for each lead in a Meta webhook delivery. */
export function metaLeadRefs(body: unknown): { leadgenId: string; formId: string | null; adId: string | null }[] {
  const out: { leadgenId: string; formId: string | null; adId: string | null }[] = [];
  const entries = (body as { object?: string; entry?: { changes?: { field?: string; value?: Record<string, unknown> }[] }[] })?.entry ?? [];
  for (const e of entries) {
    for (const c of e.changes ?? []) {
      if (c.field !== "leadgen" || !c.value) continue;
      const id = c.value.leadgen_id;
      if (typeof id === "string" || typeof id === "number") {
        out.push({ leadgenId: String(id), formId: c.value.form_id != null ? String(c.value.form_id) : null, adId: c.value.ad_id != null ? String(c.value.ad_id) : null });
      }
    }
  }
  return out;
}

const pick = (f: Record<string, string>, ...names: string[]) => {
  for (const n of names) {
    const hit = Object.entries(f).find(([k]) => k.toLowerCase() === n);
    if (hit?.[1]?.trim()) return hit[1].trim();
  }
  return null;
};

/** Answers we don't promote to a column, the first one is the best guess at what they want. */
const STANDARD = new Set(["full_name", "first_name", "last_name", "email", "phone_number", "phone", "city", "state", "country", "zip", "post_code"]);

function interestFrom(fields: Record<string, string>, fallback: string): string {
  const other = Object.entries(fields).find(([k, v]) => !STANDARD.has(k.toLowerCase()) && v.trim());
  return (other ? `${other[0].replace(/_/g, " ")}: ${other[1]}` : fallback).slice(0, 200);
}

/** A Graph API lead (GET /{leadgen_id}) as a lead row. */
export function parseMetaLead(
  lead: { id: string; created_time?: string; form_id?: string; campaign_name?: string; ad_name?: string; field_data?: { name: string; values?: string[] }[] },
): IncomingLead {
  const fields: Record<string, string> = {};
  for (const f of lead.field_data ?? []) fields[f.name] = (f.values ?? []).join(", ");
  const name = pick(fields, "full_name") ?? ([pick(fields, "first_name"), pick(fields, "last_name")].filter(Boolean).join(" ") || "Lead without a name");
  return {
    source: "meta_lead_form",
    platformLeadId: lead.id,
    name,
    email: pick(fields, "email"),
    phone: pick(fields, "phone_number", "phone"),
    interest: interestFrom(fields, lead.ad_name ? `Ad: ${lead.ad_name}` : "Meta lead form"),
    formId: lead.form_id ?? null,
    campaign: lead.campaign_name ?? null,
    fields,
    createdAt: lead.created_time ? new Date(lead.created_time) : undefined,
  };
}

/** Reads one lead's answers from the Graph API. */
export async function fetchMetaLead(leadgenId: string, creds?: MarketingCredentials | null): Promise<IncomingLead> {
  const c = creds ?? (await readJsonSecret<MarketingCredentials>("meta_marketing"));
  if (!c?.access_token) throw new Error("Meta Marketing isn't connected, so the lead's answers can't be read.");
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(leadgenId)}?fields=id,created_time,form_id,ad_name,campaign_name,field_data`, {
    headers: { Authorization: `Bearer ${c.access_token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => null)) as Parameters<typeof parseMetaLead>[0] & { error?: { message?: string } };
  if (!res.ok || !body?.id) throw new Error(`Meta lead ${leadgenId}: ${body?.error?.message ?? `HTTP ${res.status}`}`);
  return parseMetaLead(body);
}

/* ---------- Google ---------- */

export interface GoogleLeadPayload {
  lead_id?: string;
  google_key?: string;
  form_id?: string | number;
  campaign_id?: string | number;
  is_test?: boolean;
  user_column_data?: { column_id?: string; column_name?: string; string_value?: string }[];
}

export function verifyGoogleKey(expected: string, payload: GoogleLeadPayload): boolean {
  const got = Buffer.from(String(payload.google_key ?? ""));
  const want = Buffer.from(expected);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A Google Ads lead form webhook body as a lead row. */
export function parseGoogleLead(p: GoogleLeadPayload): IncomingLead {
  if (!p.lead_id) throw new Error("No lead_id in the payload.");
  const fields: Record<string, string> = {};
  for (const c of p.user_column_data ?? []) {
    const key = (c.column_id ?? c.column_name ?? "").toLowerCase();
    if (key && c.string_value != null) fields[key] = c.string_value;
  }
  const name = pick(fields, "full_name") ?? ([pick(fields, "first_name"), pick(fields, "last_name")].filter(Boolean).join(" ") || "Lead without a name");
  return {
    source: "google_lead_form",
    platformLeadId: p.lead_id,
    name,
    email: pick(fields, "email"),
    phone: pick(fields, "phone_number", "phone"),
    interest: interestFrom(fields, "Google lead form"),
    formId: p.form_id != null ? String(p.form_id) : null,
    campaign: p.campaign_id != null ? String(p.campaign_id) : null,
    fields: p.is_test ? { ...fields, is_test: "true" } : fields,
  };
}

/* ---------- storing ---------- */

/** The active Sales person with the fewest leads in the last 30 days, or null if there is none. */
export async function nextSalesOwner(): Promise<string | null> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await db
    .select({ id: users.id, n: count(leads.id) })
    .from(users)
    .leftJoin(leads, and(eq(leads.assignedTo, users.id), gte(leads.createdAt, since)))
    .where(and(eq(users.role, "sales"), eq(users.active, true)))
    .groupBy(users.id, users.name)
    .orderBy(asc(count(leads.id)), asc(users.name))
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Stores a lead once. Returns whether it was new. */
export async function storeLead(lead: IncomingLead): Promise<{ created: boolean; id: string | null }> {
  const owner = await nextSalesOwner();
  const [row] = await db
    .insert(leads)
    .values({
      source: lead.source,
      platformLeadId: lead.platformLeadId,
      name: lead.name.slice(0, 200),
      email: lead.email?.slice(0, 200) ?? null,
      phone: lead.phone?.slice(0, 40) ?? null,
      interest: lead.interest,
      formId: lead.formId,
      campaign: lead.campaign,
      fields: lead.fields,
      assignedTo: owner,
      ...(lead.createdAt && !Number.isNaN(lead.createdAt.getTime()) ? { createdAt: lead.createdAt } : {}),
    })
    .onConflictDoNothing({ target: [leads.source, leads.platformLeadId] })
    .returning({ id: leads.id });
  if (!row) return { created: false, id: null };
  await db.insert(auditLog).values({
    actor: lead.source === "meta_lead_form" ? "Meta lead form" : "Google lead form",
    actorType: "agent",
    action: "lead_received",
    target: lead.name.slice(0, 120),
    reason: lead.campaign ? `campaign ${lead.campaign}` : null,
    result: owner ? "assigned" : "unassigned: no active Sales person",
  });
  return { created: true, id: row.id };
}

/** Leads received in the last `hours`, for the Leads page's intake status line. */
export async function recentLeadCount(hours = 24 * 7): Promise<number> {
  const [r] = await db.select({ n: count() }).from(leads).where(sql`${leads.createdAt} >= now() - make_interval(hours => ${hours}) AND ${leads.platformLeadId} IS NOT NULL`);
  return r?.n ?? 0;
}

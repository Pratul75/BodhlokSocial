import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import {
  adSpendDaily,
  connections,
  conversionEvents,
  conversionForwards,
  db,
  pipelineRuns,
  rebuildFunnel,
  reconcileAttribution,
  webSessionsDaily,
} from "@bodh/db";
import { attribute } from "./attribution";
import type { NormalizedEvent } from "./bodh-events";
import { fetchGa4Sessions } from "./ga4";
import { buildClickConversion, fetchGoogleAdsSpend, googleAdsConfigFromEnv, uploadClickConversions } from "./google-ads";
import { refreshAccessToken, type StoredGoogleGrant } from "./google-oauth";
import { fetchMetaSpend, sendCapiEvents, type CapiCredentials, type ConversionForCapi, type MarketingCredentials } from "./meta";
import { readJsonSecret } from "./secrets";

type ConversionRow = typeof conversionEvents.$inferSelect;

/* ---------- dates, in India time ---------- */

export function istDate(d = new Date(), offsetDays = 0): string {
  const t = new Date(d.getTime() + 330 * 60_000 + offsetDays * 86_400_000);
  return t.toISOString().slice(0, 10);
}

/* ---------- run log ---------- */

export interface JobResult {
  status: "succeeded" | "skipped";
  detail: string;
  rows?: number;
}

/** Runs a job and records it in pipeline_runs, including failures. */
export async function runJob(job: string, fn: () => Promise<JobResult>): Promise<JobResult & { job: string }> {
  const [run] = await db.insert(pipelineRuns).values({ job, status: "running" }).returning({ id: pipelineRuns.id });
  try {
    const r = await fn();
    await db
      .update(pipelineRuns)
      .set({ status: r.status, detail: r.detail, rows: r.rows ?? 0, finishedAt: new Date() })
      .where(eq(pipelineRuns.id, run!.id));
    return { job, ...r };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await db.update(pipelineRuns).set({ status: "failed", detail, finishedAt: new Date() }).where(eq(pipelineRuns.id, run!.id));
    throw Object.assign(new Error(`${job} failed: ${detail}`), { job });
  }
}

async function markSynced(key: string) {
  await db.update(connections).set({ lastSyncAt: new Date(), error: null }).where(eq(connections.key, key));
}

/* ---------- event intake ---------- */

export interface IngestResult {
  accepted: number;
  duplicates: number;
}

/**
 * Stores events from the BODH backend. Registrations are attributed from their touch
 * point; activation and paid events take the channel of the user's registration.
 * Every event is queued for Meta; events with a Google click ID are queued for Google.
 */
export async function ingestEvents(events: NormalizedEvent[]): Promise<IngestResult> {
  if (events.length === 0) return { accepted: 0, duplicates: 0 };
  const userRefs = [...new Set(events.filter((e) => e.type !== "registration").map((e) => e.userRef))];
  const regByUser = new Map<string, ConversionRow>();
  for (let i = 0; i < userRefs.length; i += 1000) {
    const regs = await db
      .select()
      .from(conversionEvents)
      .where(and(eq(conversionEvents.type, "registration"), inArray(conversionEvents.userRef, userRefs.slice(i, i + 1000))));
    for (const r of regs) regByUser.set(r.userRef, r);
  }

  const rows = events.map((e) => toRow(e, regByUser));
  // Registrations earlier in the same batch count too.
  const batchRegs = new Map(rows.filter((r) => r.type === "registration").map((r) => [r.userRef, r]));
  for (const r of rows) {
    if (r.type === "registration" || regByUser.has(r.userRef)) continue;
    const reg = batchRegs.get(r.userRef);
    if (reg) Object.assign(r, inheritFrom(reg));
    // Otherwise it stays "direct" until reconcileAttribution finds the registration.
  }

  let accepted = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const inserted = await db
      .insert(conversionEvents)
      .values(chunk)
      .onConflictDoNothing({ target: conversionEvents.eventId })
      .returning({ eventId: conversionEvents.eventId, gclid: conversionEvents.gclid, gbraid: conversionEvents.gbraid, wbraid: conversionEvents.wbraid });
    accepted += inserted.length;
    const forwards: (typeof conversionForwards.$inferInsert)[] = [];
    for (const r of inserted) {
      forwards.push({ eventId: r.eventId, destination: "meta_capi" });
      if (r.gclid || r.gbraid || r.wbraid) forwards.push({ eventId: r.eventId, destination: "google_ads" });
    }
    if (forwards.length) await db.insert(conversionForwards).values(forwards).onConflictDoNothing();
  }
  return { accepted, duplicates: events.length - accepted };
}

type Inherited = Pick<
  typeof conversionEvents.$inferInsert,
  "channel" | "utmSource" | "utmMedium" | "utmCampaign" | "utmContent" | "gclid" | "gbraid" | "wbraid" | "fbclid" | "fbp" | "fbc" | "landingPage"
>;

function inheritFrom(reg: Inherited): Inherited {
  return {
    channel: reg.channel,
    utmSource: reg.utmSource,
    utmMedium: reg.utmMedium,
    utmCampaign: reg.utmCampaign,
    utmContent: reg.utmContent,
    gclid: reg.gclid,
    gbraid: reg.gbraid,
    wbraid: reg.wbraid,
    fbclid: reg.fbclid,
    fbp: reg.fbp,
    fbc: reg.fbc,
    landingPage: reg.landingPage,
  };
}

function toRow(e: NormalizedEvent, regByUser: Map<string, ConversionRow>): typeof conversionEvents.$inferInsert {
  const base: typeof conversionEvents.$inferInsert = {
    eventId: e.eventId,
    type: e.type,
    occurredAt: e.occurredAt,
    userRef: e.userRef,
    platform: e.platform,
    plan: e.plan,
    value: e.value == null ? null : String(e.value),
    currency: e.currency,
    emailSha256: e.emailSha256,
    phoneSha256: e.phoneSha256,
    clientIp: e.clientIp,
    userAgent: e.userAgent,
    channel: "direct",
  };
  if (e.type !== "registration") {
    const reg = regByUser.get(e.userRef);
    return reg ? { ...base, ...inheritFrom(reg) } : base;
  }
  const a = e.attribution;
  return {
    ...base,
    channel: attribute({
      utmSource: a?.utm_source,
      utmMedium: a?.utm_medium,
      gclid: a?.gclid,
      gbraid: a?.gbraid,
      wbraid: a?.wbraid,
      fbclid: a?.fbclid,
      referralCode: a?.referral_code,
      referrer: a?.referrer,
    }),
    utmSource: a?.utm_source ?? null,
    utmMedium: a?.utm_medium ?? null,
    utmCampaign: a?.utm_campaign ?? null,
    utmContent: a?.utm_content ?? null,
    utmTerm: a?.utm_term ?? null,
    gclid: a?.gclid ?? null,
    gbraid: a?.gbraid ?? null,
    wbraid: a?.wbraid ?? null,
    fbclid: a?.fbclid ?? null,
    fbp: a?.fbp ?? null,
    fbc: a?.fbc ?? null,
    referralCode: a?.referral_code ?? null,
    referrer: a?.referrer ?? null,
    landingPage: a?.landing_page ?? null,
  };
}

/* ---------- server-side conversions ---------- */

const MAX_ATTEMPTS = 8;
/** How old an event may be when a destination accepts it. */
const MAX_AGE_DAYS = { meta_capi: 7, google_ads: 60 } as const;

const toCapi = (r: ConversionRow): ConversionForCapi => ({
  eventId: r.eventId,
  type: r.type as ConversionForCapi["type"],
  occurredAt: r.occurredAt,
  userRef: r.userRef,
  emailSha256: r.emailSha256,
  phoneSha256: r.phoneSha256,
  platform: r.platform,
  value: r.value == null ? null : Number(r.value),
  currency: r.currency,
  plan: r.plan,
  fbp: r.fbp,
  fbc: r.fbc,
  fbclid: r.fbclid,
  landingPage: r.landingPage,
  clientIp: r.clientIp,
  userAgent: r.userAgent,
});

async function dueForwards(destination: "meta_capi" | "google_ads", limit: number) {
  return db
    .select({ f: conversionForwards, e: conversionEvents })
    .from(conversionForwards)
    .innerJoin(conversionEvents, eq(conversionEvents.eventId, conversionForwards.eventId))
    .where(and(eq(conversionForwards.destination, destination), eq(conversionForwards.status, "pending"), lte(conversionForwards.nextAttemptAt, new Date())))
    .orderBy(asc(conversionForwards.nextAttemptAt))
    .limit(limit);
}

async function expireOld(destination: keyof typeof MAX_AGE_DAYS) {
  const res = await db.execute(sql`
    UPDATE conversion_forwards f SET status = 'skipped', last_error = 'Too old for this destination'
    FROM conversion_events e
    WHERE e.event_id = f.event_id AND f.destination = ${destination} AND f.status = 'pending'
      AND e.occurred_at < now() - make_interval(days => ${MAX_AGE_DAYS[destination]})`);
  return (res as unknown as { count?: number }).count ?? 0;
}

async function markSent(ids: string[]) {
  if (ids.length) await db.update(conversionForwards).set({ status: "sent", sentAt: new Date(), lastError: null }).where(inArray(conversionForwards.id, ids));
}

async function markFailure(rows: { id: string; attempts: number }[], error: string, retryable: boolean) {
  for (const r of rows) {
    const attempts = r.attempts + 1;
    const giveUp = !retryable || attempts >= MAX_ATTEMPTS;
    await db
      .update(conversionForwards)
      .set({
        attempts,
        lastError: error.slice(0, 500),
        status: giveUp ? "failed" : "pending",
        nextAttemptAt: new Date(Date.now() + 2 ** attempts * 60_000),
      })
      .where(eq(conversionForwards.id, r.id));
  }
}

export async function forwardToMeta(): Promise<JobResult> {
  const creds = await readJsonSecret<CapiCredentials>("meta_capi");
  if (!creds?.pixel_id || !creds.access_token) return { status: "skipped", detail: "Meta Conversions API is not connected. Events wait in the queue for 7 days." };
  const expired = await expireOld("meta_capi");
  let sent = 0;
  for (let batch = 0; batch < 5; batch++) {
    const due = await dueForwards("meta_capi", 500);
    if (due.length === 0) break;
    try {
      await sendCapiEvents(creds, due.map((d) => toCapi(d.e)));
      await markSent(due.map((d) => d.f.id));
      sent += due.length;
    } catch (e) {
      const retryable = (e as { retryable?: boolean }).retryable ?? true;
      await markFailure(due.map((d) => d.f), e instanceof Error ? e.message : String(e), retryable);
      throw e; // recorded as a failed run; the events retry with backoff
    }
  }
  await markSynced("meta_capi");
  return { status: "succeeded", detail: `Sent ${sent} events to Meta${expired ? `, expired ${expired}` : ""}.`, rows: sent };
}

async function googleAccessToken(): Promise<string | null> {
  const grant = await readJsonSecret<StoredGoogleGrant>("google_ads");
  if (!grant?.refresh_token) return null;
  return (await refreshAccessToken(grant.refresh_token)).access_token;
}

export async function forwardToGoogle(): Promise<JobResult> {
  const cfg = googleAdsConfigFromEnv();
  const token = cfg ? await googleAccessToken() : null;
  if (!cfg || !token) return { status: "skipped", detail: "Google Ads is not connected. Click conversions wait in the queue for 60 days." };
  const expired = await expireOld("google_ads");
  const due = await dueForwards("google_ads", 2000);
  const built = due.map((d) => ({ d, c: buildClickConversion(cfg, { ...toCapi(d.e), gclid: d.e.gclid, gbraid: d.e.gbraid, wbraid: d.e.wbraid }) }));
  const skip = built.filter((b) => !b.c).map((b) => b.d.f.id);
  if (skip.length) await db.update(conversionForwards).set({ status: "skipped", lastError: "No conversion action for this event type" }).where(inArray(conversionForwards.id, skip));
  const send = built.filter((b) => b.c);
  let partial: string | null = null;
  try {
    const r = await uploadClickConversions(cfg, token, send.map((b) => b.c!));
    partial = r.partialFailure;
    await markSent(send.map((b) => b.d.f.id));
  } catch (e) {
    await markFailure(send.map((b) => b.d.f), e instanceof Error ? e.message : String(e), (e as { retryable?: boolean }).retryable ?? true);
    throw e;
  }
  await markSynced("google_ads");
  return { status: "succeeded", detail: `Uploaded ${send.length} click conversions${partial ? `; some rejected: ${partial}` : ""}${expired ? `; expired ${expired}` : ""}.`, rows: send.length };
}

/* ---------- loaders ---------- */

async function upsertSpend(rows: Awaited<ReturnType<typeof fetchMetaSpend>>) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await db
      .insert(adSpendDaily)
      .values(chunk.map((r) => ({ ...r, spend: r.spend.toFixed(2) })))
      .onConflictDoUpdate({
        target: [adSpendDaily.day, adSpendDaily.platform, adSpendDaily.adId],
        set: {
          spend: sql`excluded.spend`,
          impressions: sql`excluded.impressions`,
          clicks: sql`excluded.clicks`,
          adName: sql`excluded.ad_name`,
          campaignName: sql`excluded.campaign_name`,
          loadedAt: new Date(),
        },
      });
  }
}

export async function loadMetaSpend(since: string, until: string): Promise<JobResult> {
  const creds = await readJsonSecret<MarketingCredentials>("meta_marketing");
  if (!creds?.ad_account_id || !creds.access_token) return { status: "skipped", detail: "Meta Marketing API is not connected." };
  const rows = await fetchMetaSpend(creds, since, until);
  await upsertSpend(rows);
  await markSynced("meta_marketing");
  return { status: "succeeded", detail: `Loaded ${rows.length} ad-days from Meta for ${since} to ${until}.`, rows: rows.length };
}

export async function loadGoogleSpend(since: string, until: string): Promise<JobResult> {
  const cfg = googleAdsConfigFromEnv();
  const token = cfg ? await googleAccessToken() : null;
  if (!cfg || !token) return { status: "skipped", detail: "Google Ads is not connected." };
  const rows = await fetchGoogleAdsSpend(cfg, token, since, until);
  await upsertSpend(rows);
  await markSynced("google_ads");
  return { status: "succeeded", detail: `Loaded ${rows.length} ad-days from Google Ads for ${since} to ${until}.`, rows: rows.length };
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export async function loadGa4Sessions(day: string): Promise<JobResult> {
  const dataset = process.env.GA4_BQ_DATASET;
  if (!dataset) return { status: "skipped", detail: "GA4_BQ_DATASET is not set." };
  const sa = await readJsonSecret<ServiceAccount>("ga4");
  const projectId = process.env.GA4_BQ_PROJECT ?? sa?.project_id ?? process.env.GCP_PROJECT_ID;
  if (!projectId) return { status: "skipped", detail: "No BigQuery project. Set GA4_BQ_PROJECT or connect GA4." };
  const byChannel = await fetchGa4Sessions(
    { projectId, dataset, credentials: sa ? { client_email: sa.client_email, private_key: sa.private_key } : undefined },
    day,
  );
  const rows = Object.entries(byChannel).map(([channel, sessions]) => ({ day, channel, sessions: sessions ?? 0 }));
  await db.delete(webSessionsDaily).where(eq(webSessionsDaily.day, day));
  if (rows.length) await db.insert(webSessionsDaily).values(rows);
  if (sa) await markSynced("ga4");
  return { status: "succeeded", detail: `Loaded sessions for ${rows.length} channels on ${day}.`, rows: rows.length };
}

export async function rebuild(from: string, to: string): Promise<JobResult> {
  const fixed = await reconcileAttribution();
  const rows = await rebuildFunnel(from, to);
  return { status: "succeeded", detail: `Rebuilt ${from} to ${to}: ${rows} funnel rows${fixed ? `, re-attributed ${fixed} events` : ""}.`, rows };
}

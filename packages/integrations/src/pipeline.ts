import { and, asc, eq, inArray, lte, sql, type AnyColumn } from "drizzle-orm";
import {
  adSpendDaily,
  connections,
  conversionEvents,
  conversionForwards,
  db,
  ga4Daily,
  ga4DailyPages,
  ga4DailySources,
  ga4PeriodTotals,
  pipelineRuns,
  rebuildFunnel,
  reconcileAttribution,
  webSessionsDaily,
} from "@bodh/db";
import { attribute } from "./attribution";
import type { NormalizedEvent } from "./bodh-events";
import { fetchGa4Sessions, findGa4Dataset } from "./ga4";
import {
  addDays,
  chunkRange,
  fetchDaily,
  fetchPages,
  fetchSources,
  fetchTotals,
  ga4Client,
  ga4PropertyId,
  sessionsByAttributionChannel,
  type Ga4ClientDeps,
  type Ga4DayRow,
  type Ga4PageRow,
  type Ga4ServiceAccount,
  type Ga4SourceRow,
} from "./ga4-data";
import { buildClickConversion, fetchGoogleAdsSpend, googleAdsConfigFromEnv, uploadClickConversions } from "./google-ads";
import { googleAccessToken } from "./google-oauth";
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

/**
 * Runs a job and records it in pipeline_runs, including failures. A Postgres advisory lock named
 * after the job is held for the whole run, so if a timer fires while the previous run of the
 * same job is still going (or the web app and the worker start it together), the second one is
 * recorded as skipped instead of loading or sending everything twice.
 */
export async function runJob(job: string, fn: () => Promise<JobResult>): Promise<JobResult & { job: string }> {
  return db.transaction(async (lockTx) => {
    const [got] = (await lockTx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${`bodh_job:${job}`})) AS ok`)) as unknown as { ok: boolean }[];
    if (!got?.ok) {
      await db.insert(pipelineRuns).values({ job, status: "skipped", detail: "Already running: the previous run of this job hasn't finished.", finishedAt: new Date() });
      return { job, status: "skipped" as const, detail: "Already running.", rows: 0 };
    }
    // The run log is written outside the lock's transaction so it shows up while the job runs.
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
  });
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
    // An event and its forwarding rows are written together: a crash between them would
    // leave events that are never sent to Meta or Google (a retry sees them as duplicates).
    accepted += await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(conversionEvents)
        .values(chunk)
        .onConflictDoNothing({ target: conversionEvents.eventId })
        .returning({ eventId: conversionEvents.eventId, gclid: conversionEvents.gclid, gbraid: conversionEvents.gbraid, wbraid: conversionEvents.wbraid });
      const forwards: (typeof conversionForwards.$inferInsert)[] = [];
      for (const r of inserted) {
        forwards.push({ eventId: r.eventId, destination: "meta_capi" });
        if (r.gclid || r.gbraid || r.wbraid) forwards.push({ eventId: r.eventId, destination: "google_ads" });
      }
      if (forwards.length) await tx.insert(conversionForwards).values(forwards).onConflictDoNothing();
      return inserted.length;
    });
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

type Due = Awaited<ReturnType<typeof dueForwards>>[number];

/**
 * Sends a batch to Meta. When Meta rejects the batch outright (a 4xx, usually one malformed
 * event), the batch is split in half and each half retried, down to single events, so only the
 * events Meta actually refuses are marked failed. A retryable error (429, 5xx) stops the split
 * and is thrown, so the whole batch waits for the next run.
 */
export async function sendCapiBisecting(
  send: (rows: Due[]) => Promise<unknown>,
  rows: Due[],
  budget = { calls: 64 },
): Promise<{ sent: Due[]; rejected: { row: Due; error: string }[]; deferred: Due[] }> {
  if (rows.length === 0) return { sent: [], rejected: [], deferred: [] };
  // Out of calls for this run: leave the rest queued for the next run rather than failing them.
  if (budget.calls <= 0) return { sent: [], rejected: [], deferred: rows };
  budget.calls--;
  try {
    await send(rows);
    return { sent: rows, rejected: [], deferred: [] };
  } catch (e) {
    const retryable = (e as { retryable?: boolean }).retryable ?? true;
    if (retryable) throw e;
    const error = e instanceof Error ? e.message : String(e);
    if (rows.length === 1) return { sent: [], rejected: [{ row: rows[0]!, error }], deferred: [] };
    const mid = Math.ceil(rows.length / 2);
    const a = await sendCapiBisecting(send, rows.slice(0, mid), budget);
    const b = await sendCapiBisecting(send, rows.slice(mid), budget);
    return { sent: [...a.sent, ...b.sent], rejected: [...a.rejected, ...b.rejected], deferred: [...a.deferred, ...b.deferred] };
  }
}

export async function forwardToMeta(): Promise<JobResult> {
  const creds = await readJsonSecret<CapiCredentials>("meta_capi");
  if (!creds?.pixel_id || !creds.access_token) return { status: "skipped", detail: "Meta Conversions API is not connected. Events wait in the queue for 7 days." };
  const expired = await expireOld("meta_capi");
  let sent = 0;
  let rejected = 0;
  for (let batch = 0; batch < 5; batch++) {
    const due = await dueForwards("meta_capi", 500);
    if (due.length === 0) break;
    try {
      const r = await sendCapiBisecting((rows) => sendCapiEvents(creds, rows.map((d) => toCapi(d.e))), due);
      await markSent(r.sent.map((d) => d.f.id));
      for (const x of r.rejected) await markFailure([x.row.f], x.error, false);
      if (r.deferred.length) await markFailure(r.deferred.map((d) => d.f), "Meta rejected part of this batch; retrying the rest on the next run.", true);
      sent += r.sent.length;
      rejected += r.rejected.length;
      if (r.deferred.length) break;
    } catch (e) {
      await markFailure(due.map((d) => d.f), e instanceof Error ? e.message : String(e), true);
      throw e; // recorded as a failed run; the events retry with backoff
    }
  }
  await markSynced("meta_capi");
  const test = creds.test_event_code ? " (test event code set: Meta shows them under Test Events only)" : "";
  return {
    status: "succeeded",
    detail: `Sent ${sent} events to Meta${test}${rejected ? `; Meta rejected ${rejected}` : ""}${expired ? `; expired ${expired}` : ""}.`,
    rows: sent,
  };
}

export async function forwardToGoogle(): Promise<JobResult> {
  const cfg = googleAdsConfigFromEnv();
  const token = cfg ? await googleAccessToken("google_ads") : null;
  if (!cfg || !token) return { status: "skipped", detail: "Google Ads is not connected. Click conversions wait in the queue for 60 days." };
  const expired = await expireOld("google_ads");
  const due = await dueForwards("google_ads", 2000);
  const built = due.map((d) => ({ d, c: buildClickConversion(cfg, { ...toCapi(d.e), gclid: d.e.gclid, gbraid: d.e.gbraid, wbraid: d.e.wbraid }) }));
  // No conversion action configured for this event type yet: keep it queued and look again
  // tomorrow, so filling in GOOGLE_ADS_CONVERSION_ACTIONS later still sends it (within 60 days).
  const wait = built.filter((b) => !b.c).map((b) => b.d.f.id);
  if (wait.length) {
    await db
      .update(conversionForwards)
      .set({ lastError: "No Google Ads conversion action for this event type yet; checking again daily.", nextAttemptAt: new Date(Date.now() + 86_400_000) })
      .where(inArray(conversionForwards.id, wait));
  }
  const send = built.filter((b) => b.c);
  let r: Awaited<ReturnType<typeof uploadClickConversions>>;
  try {
    r = await uploadClickConversions(cfg, token, send.map((b) => b.c!));
  } catch (e) {
    await markFailure(send.map((b) => b.d.f), e instanceof Error ? e.message : String(e), (e as { retryable?: boolean }).retryable ?? true);
    throw e;
  }
  const rejected = send.filter((_, i) => r.rejected.has(i));
  await markSent(send.filter((_, i) => !r.rejected.has(i)).map((b) => b.d.f.id));
  for (const [i, error] of r.rejected) await markFailure([send[i]!.d.f], error, false);
  await markSynced("google_ads");
  const unplaced = r.partialFailure && rejected.length === 0 ? `; Google reported: ${r.partialFailure}` : "";
  return {
    status: "succeeded",
    detail: `Uploaded ${send.length - rejected.length} click conversions${rejected.length ? `; Google rejected ${rejected.length}` : ""}${unplaced}${wait.length ? `; ${wait.length} waiting for a conversion action` : ""}${expired ? `; expired ${expired}` : ""}.`,
    rows: send.length - rejected.length,
  };
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
  const token = cfg ? await googleAccessToken("google_ads") : null;
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

/**
 * GA4 traffic for the funnel and the Analytics page.
 * With GA4_PROPERTY_ID set: the GA4 Data API (loadGa4Report). The daily run re-reads the last
 * 3 days (GA4 keeps updating them for up to 48 h), and backfills 90 days the first time.
 * `opts.days` asks for a specific window ending on `day` (at most 90 days).
 * Without it: the GA4 BigQuery export for one day, as before.
 */
export async function loadGa4Sessions(day: string, opts: { days?: number } = {}): Promise<JobResult> {
  const sa = await readJsonSecret<ServiceAccount>("ga4");
  const propertyId = ga4PropertyId();
  if (propertyId) {
    if (!sa?.client_email || !sa.private_key) return { status: "skipped", detail: "GA4_PROPERTY_ID is set but no GA4 service account is saved. Add it in Connections → GA4 / Firebase." };
    let days = opts.days ? Math.min(Math.max(Math.trunc(opts.days), 1), GA4_MAX_DAYS) : GA4_DAILY_DAYS;
    if (!opts.days) {
      const [have] = await db.select({ n: sql<number>`count(*)::int` }).from(ga4Daily).where(eq(ga4Daily.propertyId, propertyId));
      if (!have?.n) days = GA4_MAX_DAYS;
    }
    try {
      return await loadGa4Report(propertyId, sa, addDays(day, -(days - 1)), day);
    } catch (e) {
      await db
        .update(connections)
        .set({ status: "error", error: (e instanceof Error ? e.message : String(e)).slice(0, 500), updatedAt: new Date() })
        .where(eq(connections.key, "ga4"));
      throw e;
    }
  }
  const projectId = process.env.GA4_BQ_PROJECT || sa?.project_id || process.env.GCP_PROJECT_ID;
  if (!projectId) return { status: "skipped", detail: "No BigQuery project. Set GA4_BQ_PROJECT or connect GA4." };
  // Without GA4_BQ_DATASET, use the analytics_<property id> dataset once GA4 starts exporting.
  const dataset = process.env.GA4_BQ_DATASET || (await findGa4Dataset(projectId, sa ? { client_email: sa.client_email, private_key: sa.private_key } : undefined));
  if (!dataset) {
    return { status: "skipped", detail: `No GA4 export in BigQuery project ${projectId} yet. In GA4: Admin > Product links > BigQuery links. Or set GA4_PROPERTY_ID to read GA4 through its Data API.` };
  }
  const byChannel = await fetchGa4Sessions(
    { projectId, dataset, credentials: sa ? { client_email: sa.client_email, private_key: sa.private_key } : undefined },
    day,
  );
  const rows = Object.entries(byChannel).map(([channel, sessions]) => ({ day, channel, sessions: sessions ?? 0 }));
  await db.transaction(async (tx) => {
    await tx.delete(webSessionsDaily).where(eq(webSessionsDaily.day, day));
    if (rows.length) await tx.insert(webSessionsDaily).values(rows);
  });
  if (sa) await markSynced("ga4");
  return { status: "succeeded", detail: `Loaded sessions for ${rows.length} channels on ${day}.`, rows: rows.length };
}

export const GA4_DAILY_DAYS = 3;
export const GA4_MAX_DAYS = 90;
export const GA4_PERIODS = [7, 28, 90] as const;

const insertChunks = async <T>(rows: T[], insert: (part: T[]) => Promise<unknown>) => {
  for (let i = 0; i < rows.length; i += 1000) await insert(rows.slice(i, i + 1000));
};

/**
 * Reads GA4 for [from, to] (in 30-day requests) and replaces that window in the ga4_* tables and
 * web_sessions_daily in one transaction, then refreshes the 7/28/90-day totals ending on `to`.
 * Re-running it for the same window gives the same rows; a failure part-way changes nothing.
 */
export async function loadGa4Report(propertyId: string, sa: Ga4ServiceAccount, from: string, to: string, deps: Ga4ClientDeps = {}): Promise<JobResult> {
  const client = ga4Client(propertyId, sa, deps);
  const daily: Ga4DayRow[] = [];
  const sources: Ga4SourceRow[] = [];
  const pages: Ga4PageRow[] = [];
  const notes = new Set<string>();
  let tokensLeft: number | undefined;
  for (const [s, e] of chunkRange(from, to, 30)) {
    const [dd, ss, pp] = [await fetchDaily(client, s, e), await fetchSources(client, s, e), await fetchPages(client, s, e)];
    daily.push(...dd.rows);
    sources.push(...ss.rows);
    pages.push(...pp.rows);
    for (const r of [dd, ss, pp]) {
      if (r.meta?.subjectToThresholding) notes.add("GA4 withheld some small numbers (thresholding).");
      if (r.meta?.dataLossFromOtherRow) notes.add("GA4 grouped some rows as (other).");
      tokensLeft = r.quota?.tokensPerDay?.remaining ?? tokensLeft;
    }
  }
  const totals: (typeof ga4PeriodTotals.$inferInsert)[] = [];
  for (const days of GA4_PERIODS) {
    const startDay = addDays(to, -(days - 1));
    totals.push({ propertyId, rangeDays: days, startDay, endDay: to, ...(await fetchTotals(client, startDay, to)) });
  }
  const channels = sessionsByAttributionChannel(sources);
  const window = (col: AnyColumn) => and(sql`${col} >= ${from}::date`, sql`${col} <= ${to}::date`);

  await db.transaction(async (tx) => {
    await tx.delete(ga4Daily).where(and(eq(ga4Daily.propertyId, propertyId), window(ga4Daily.day)));
    await tx.delete(ga4DailySources).where(and(eq(ga4DailySources.propertyId, propertyId), window(ga4DailySources.day)));
    await tx.delete(ga4DailyPages).where(and(eq(ga4DailyPages.propertyId, propertyId), window(ga4DailyPages.day)));
    await tx.delete(webSessionsDaily).where(window(webSessionsDaily.day));
    await insertChunks(daily.map((r) => ({ propertyId, ...r })), (part) => tx.insert(ga4Daily).values(part));
    await insertChunks(sources.map((r) => ({ propertyId, ...r })), (part) => tx.insert(ga4DailySources).values(part));
    await insertChunks(pages.map((r) => ({ propertyId, ...r })), (part) => tx.insert(ga4DailyPages).values(part));
    await insertChunks(channels, (part) => tx.insert(webSessionsDaily).values(part));
    for (const t of totals) {
      const { propertyId: _propertyId, rangeDays: _rangeDays, ...set } = t;
      await tx
        .insert(ga4PeriodTotals)
        .values(t)
        .onConflictDoUpdate({ target: [ga4PeriodTotals.propertyId, ga4PeriodTotals.rangeDays], set: { ...set, loadedAt: new Date() } });
    }
    await tx.update(connections).set({ status: "connected", lastSyncAt: new Date(), error: null, updatedAt: new Date() }).where(eq(connections.key, "ga4"));
  });

  const sessions = daily.reduce((t, r) => t + r.sessions, 0);
  const detail = [
    `GA4 property ${propertyId}, ${from} to ${to}: ${sessions.toLocaleString("en-IN")} sessions, ${sources.length} source rows, ${pages.length} page rows.`,
    ...notes,
    tokensLeft !== undefined ? `Quota left today: ${tokensLeft} tokens.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return { status: "succeeded", detail, rows: daily.length + sources.length + pages.length };
}

export async function rebuild(from: string, to: string): Promise<JobResult> {
  const fixed = await reconcileAttribution(from);
  const rows = await rebuildFunnel(from, to);
  return { status: "succeeded", detail: `Rebuilt ${from} to ${to}: ${rows} funnel rows${fixed ? `, re-attributed ${fixed} events` : ""}.`, rows };
}

/* ---------- retention ---------- */

/** How long raw client IP addresses and user agents are kept. Meta only accepts events up to 7 days old. */
export const CLIENT_DATA_DAYS = 30;

/**
 * Clears the raw IP address and user agent from events older than CLIENT_DATA_DAYS. They are only
 * needed to match events when forwarding them; email and phone are never stored raw at all.
 */
export async function scrubClientData(): Promise<JobResult> {
  const res = await db.execute(sql`
    UPDATE conversion_events SET client_ip = NULL, user_agent = NULL
    WHERE received_at < now() - make_interval(days => ${CLIENT_DATA_DAYS}) AND (client_ip IS NOT NULL OR user_agent IS NOT NULL)`);
  const n = (res as unknown as { count?: number }).count ?? 0;
  return { status: "succeeded", detail: `Cleared IP and user agent on ${n} events older than ${CLIENT_DATA_DAYS} days.`, rows: n };
}

/**
 * GA4 Data API (analyticsdata.googleapis.com): website and app traffic for one GA4 property,
 * read with the ga4 connection's service account and the analytics.readonly scope.
 *
 * The property comes only from the server setting GA4_PROPERTY_ID, never from a request, so the
 * app can read no other property. The service account needs Viewer on that property, and the
 * Google Analytics Data API must be enabled in the service account's Google Cloud project.
 */
import { attribute } from "./attribution";
import type { AttributionChannel } from "@bodh/shared";

export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const API = "https://analyticsdata.googleapis.com/v1beta";
const TIMEOUT = 30_000;

export interface Ga4ServiceAccount {
  client_email: string;
  private_key: string;
  project_id?: string;
}

/** The configured GA4 property id, or null when GA4 Data API loading is off. Throws on a malformed id. */
export function ga4PropertyId(env: Record<string, string | undefined> = process.env): string | null {
  const v = env.GA4_PROPERTY_ID?.trim();
  if (!v) return null;
  if (!/^\d{4,15}$/.test(v)) throw new Ga4Error("GA4_PROPERTY_ID must be the numeric GA4 property id (GA4 → Admin → Property details).", { retryable: false });
  return v;
}

export class Ga4Error extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  constructor(message: string, opts: { retryable: boolean; status?: number }) {
    super(message);
    this.name = "Ga4Error";
    this.retryable = opts.retryable;
    this.status = opts.status;
  }
}

interface ApiErrorBody {
  error?: { code?: number; status?: string; message?: string; details?: { reason?: string }[] };
}

/** Turns a Google API error into a message the team can act on, and whether a retry may help. */
export function classifyGa4Error(httpStatus: number, body: ApiErrorBody | null, propertyId: string, sa?: Pick<Ga4ServiceAccount, "client_email" | "project_id">): Ga4Error {
  const e = body?.error;
  const reasons = (e?.details ?? []).map((d) => d.reason ?? "");
  const status = e?.status ?? "";
  const who = sa?.client_email ?? "the GA4 service account";
  if (reasons.includes("SERVICE_DISABLED") || /has not been used in project|is disabled/i.test(e?.message ?? "")) {
    return new Ga4Error(`The Google Analytics Data API is turned off in Google Cloud project ${sa?.project_id ?? "of the GA4 service account"}. Enable "Google Analytics Data API" there, then run the job again.`, { retryable: false, status: httpStatus });
  }
  if (httpStatus === 401) return new Ga4Error(`Google rejected ${who}. The key may have been deleted; paste a new service account key in Connections.`, { retryable: false, status: httpStatus });
  if (httpStatus === 403 || status === "PERMISSION_DENIED") {
    return new Ga4Error(`${who} can't read GA4 property ${propertyId}. Add it as Viewer in GA4 → Admin → Property access management.`, { retryable: false, status: httpStatus });
  }
  if (httpStatus === 404 || status === "NOT_FOUND") return new Ga4Error(`GA4 property ${propertyId} wasn't found. Check GA4_PROPERTY_ID.`, { retryable: false, status: httpStatus });
  if (httpStatus === 429 || status === "RESOURCE_EXHAUSTED") return new Ga4Error("GA4's API quota for this property is used up for now. It resets within the hour or by the next day.", { retryable: true, status: httpStatus });
  if (httpStatus >= 500 || status === "UNAVAILABLE" || status === "INTERNAL") return new Ga4Error(`GA4 answered ${httpStatus}: ${(e?.message ?? "server error").slice(0, 200)}`, { retryable: true, status: httpStatus });
  return new Ga4Error(`GA4 refused the request (${httpStatus}): ${(e?.message ?? "no detail").slice(0, 300)}`, { retryable: false, status: httpStatus });
}

/* ---------- client ---------- */

export interface RunReportRequest {
  dateRanges: { startDate: string; endDate: string }[];
  dimensions?: { name: string }[];
  metrics: { name: string }[];
  orderBys?: unknown[];
  limit?: string;
  offset?: string;
  keepEmptyRows?: boolean;
  returnPropertyQuota?: boolean;
}

interface Row {
  dimensionValues?: { value?: string }[];
  metricValues?: { value?: string }[];
}

export interface RunReportResponse {
  rows?: Row[];
  rowCount?: number;
  metadata?: { subjectToThresholding?: boolean; dataLossFromOtherRow?: boolean; timeZone?: string };
  propertyQuota?: { tokensPerDay?: { remaining?: number }; tokensPerHour?: { remaining?: number } };
}

export interface Ga4ClientDeps {
  fetchImpl?: typeof fetch;
  /** Returns a bearer token; tests pass a fake. */
  token?: () => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  /** Rows per page; the API allows up to 100,000. */
  pageSize?: number;
}

export interface Ga4Client {
  propertyId: string;
  /** Every row of a report, following pages. */
  runReport(req: RunReportRequest): Promise<{ rows: Row[]; meta: RunReportResponse["metadata"]; quota: RunReportResponse["propertyQuota"] }>;
  /** Cheapest call that proves access to the property. */
  checkAccess(): Promise<void>;
}

function serviceAccountToken(sa: Ga4ServiceAccount): () => Promise<string> {
  let jwt: { getAccessToken(): Promise<{ token?: string | null }> } | null = null;
  return async () => {
    if (!jwt) {
      const { JWT } = await import("google-auth-library");
      jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: [GA4_SCOPE] });
    }
    const t = (await jwt.getAccessToken()).token;
    if (!t) throw new Ga4Error("Google didn't return an access token for the GA4 service account.", { retryable: true });
    return t;
  };
}

export function ga4Client(propertyId: string, sa: Ga4ServiceAccount, deps: Ga4ClientDeps = {}): Ga4Client {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const token = deps.token ?? serviceAccountToken(sa);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pageSize = deps.pageSize ?? 100_000;

  async function call<T>(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let err: Ga4Error;
      try {
        const res = await fetchImpl(`${API}/properties/${propertyId}${path}`, {
          method: init.method,
          headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
          body: init.body ? JSON.stringify(init.body) : undefined,
          signal: AbortSignal.timeout(TIMEOUT),
        });
        const body = (await res.json().catch(() => null)) as T & ApiErrorBody;
        if (res.ok) return body;
        err = classifyGa4Error(res.status, body, propertyId, sa);
      } catch (e) {
        err = e instanceof Ga4Error ? e : new Ga4Error(`Couldn't reach GA4: ${e instanceof Error ? e.message : String(e)}`, { retryable: true });
      }
      if (!err.retryable || attempt >= 2) throw err;
      await sleep(2_000 * 2 ** attempt);
    }
  }

  return {
    propertyId,
    async runReport(req) {
      const rows: Row[] = [];
      let meta: RunReportResponse["metadata"];
      let quota: RunReportResponse["propertyQuota"];
      for (let offset = 0; ; offset += pageSize) {
        const r = await call<RunReportResponse>(":runReport", { method: "POST", body: { ...req, limit: String(pageSize), offset: String(offset), returnPropertyQuota: true } });
        rows.push(...(r.rows ?? []));
        meta = r.metadata ?? meta;
        quota = r.propertyQuota ?? quota;
        if (!r.rows?.length || rows.length >= (r.rowCount ?? 0)) break;
      }
      return { rows, meta, quota };
    },
    async checkAccess() {
      await call("/metadata", { method: "GET" });
    },
  };
}

/* ---------- reports ---------- */

const n = (v?: string) => (v === undefined || v === "" ? 0 : Math.round(Number(v)) || 0);
const d = (v?: string) => (v && /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : (v ?? ""));
const dims = (r: Row) => (r.dimensionValues ?? []).map((x) => x.value ?? "");
const mets = (r: Row) => (r.metricValues ?? []).map((x) => n(x.value));
const PLATFORMS: Record<string, string> = { web: "web", android: "android", ios: "ios" };

export interface Ga4DayRow {
  day: string;
  platform: string;
  sessions: number;
  engagedSessions: number;
  activeUsers: number;
  newUsers: number;
  totalUsers: number;
  screenPageViews: number;
  userEngagementSeconds: number;
}

export interface Ga4SourceRow {
  day: string;
  channelGroup: string;
  source: string;
  medium: string;
  sessions: number;
  engagedSessions: number;
  newUsers: number;
}

export interface Ga4PageRow {
  day: string;
  pagePath: string;
  screenPageViews: number;
  activeUsers: number;
  userEngagementSeconds: number;
}

export interface Ga4Totals {
  sessions: number;
  engagedSessions: number;
  activeUsers: number;
  totalUsers: number;
  newUsers: number;
  screenPageViews: number;
}

export const OTHER_PAGES = "(other)";

export async function fetchDaily(c: Ga4Client, from: string, to: string) {
  const r = await c.runReport({
    dateRanges: [{ startDate: from, endDate: to }],
    dimensions: [{ name: "date" }, { name: "platform" }],
    metrics: ["sessions", "engagedSessions", "activeUsers", "newUsers", "totalUsers", "screenPageViews", "userEngagementDuration"].map((name) => ({ name })),
  });
  const rows: Ga4DayRow[] = r.rows.map((row) => {
    const [day, platform] = dims(row);
    const [sessions, engagedSessions, activeUsers, newUsers, totalUsers, screenPageViews, userEngagementSeconds] = mets(row);
    return { day: d(day), platform: PLATFORMS[(platform ?? "").toLowerCase()] ?? (platform || "other").toLowerCase().slice(0, 40), sessions: sessions!, engagedSessions: engagedSessions!, activeUsers: activeUsers!, newUsers: newUsers!, totalUsers: totalUsers!, screenPageViews: screenPageViews!, userEngagementSeconds: userEngagementSeconds! };
  });
  return { rows, meta: r.meta, quota: r.quota };
}

export async function fetchSources(c: Ga4Client, from: string, to: string) {
  const r = await c.runReport({
    dateRanges: [{ startDate: from, endDate: to }],
    dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }, { name: "sessionSource" }, { name: "sessionMedium" }],
    metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "newUsers" }],
  });
  const rows: Ga4SourceRow[] = r.rows.map((row) => {
    const [day, channelGroup, source, medium] = dims(row);
    const [sessions, engagedSessions, newUsers] = mets(row);
    return { day: d(day), channelGroup: (channelGroup || "(not set)").slice(0, 80), source: (source || "(not set)").slice(0, 200), medium: (medium || "(not set)").slice(0, 120), sessions: sessions!, engagedSessions: engagedSessions!, newUsers: newUsers! };
  });
  return { rows, meta: r.meta, quota: r.quota };
}

/**
 * Page views per page per day. pagePath carries no query string, so nothing personal from a URL
 * is stored. Only the top `perDay` pages of each day are kept; the rest are summed as "(other)".
 */
export async function fetchPages(c: Ga4Client, from: string, to: string, perDay = 500) {
  const r = await c.runReport({
    dateRanges: [{ startDate: from, endDate: to }],
    dimensions: [{ name: "date" }, { name: "pagePath" }],
    metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }, { name: "userEngagementDuration" }],
  });
  const byDay = new Map<string, Ga4PageRow[]>();
  for (const row of r.rows) {
    const [day, path] = dims(row);
    const [screenPageViews, activeUsers, userEngagementSeconds] = mets(row);
    const key = d(day);
    const list = byDay.get(key) ?? [];
    list.push({ day: key, pagePath: (path || "(not set)").split("?")[0]!.split("#")[0]!.slice(0, 500), screenPageViews: screenPageViews!, activeUsers: activeUsers!, userEngagementSeconds: userEngagementSeconds! });
    byDay.set(key, list);
  }
  const rows: Ga4PageRow[] = [];
  for (const [day, list] of byDay) {
    // Merge paths that became equal after trimming, then keep the top pages.
    const merged = new Map<string, Ga4PageRow>();
    for (const p of list) {
      const m = merged.get(p.pagePath);
      if (m) {
        m.screenPageViews += p.screenPageViews;
        m.activeUsers += p.activeUsers;
        m.userEngagementSeconds += p.userEngagementSeconds;
      } else merged.set(p.pagePath, { ...p });
    }
    const sorted = [...merged.values()].sort((a, b) => b.screenPageViews - a.screenPageViews);
    rows.push(...sorted.slice(0, perDay));
    const rest = sorted.slice(perDay);
    const existingOther = rows.find((x) => x.day === day && x.pagePath === OTHER_PAGES);
    if (rest.length) {
      const other = existingOther ?? { day, pagePath: OTHER_PAGES, screenPageViews: 0, activeUsers: 0, userEngagementSeconds: 0 };
      for (const p of rest) {
        other.screenPageViews += p.screenPageViews;
        other.activeUsers += p.activeUsers;
        other.userEngagementSeconds += p.userEngagementSeconds;
      }
      if (!existingOther) rows.push(other);
    }
  }
  return { rows, meta: r.meta, quota: r.quota };
}

/** Totals for one period, with users counted once across the period (they can't be summed by day). */
export async function fetchTotals(c: Ga4Client, from: string, to: string): Promise<Ga4Totals> {
  const r = await c.runReport({
    dateRanges: [{ startDate: from, endDate: to }],
    metrics: ["sessions", "engagedSessions", "activeUsers", "totalUsers", "newUsers", "screenPageViews"].map((name) => ({ name })),
  });
  const [sessions = 0, engagedSessions = 0, activeUsers = 0, totalUsers = 0, newUsers = 0, screenPageViews = 0] = r.rows[0] ? mets(r.rows[0]) : [];
  return { sessions, engagedSessions, activeUsers, totalUsers, newUsers, screenPageViews };
}

/* ---------- funnel channels ---------- */

const PLACEHOLDERS = new Set(["(direct)", "(none)", "(not set)", "(not provided)", "(data deleted)"]);
const clean = (v: string) => (v && !PLACEHOLDERS.has(v.trim().toLowerCase()) ? v : null);

/** GA4 sessions per day in our attribution channels (the funnel's "visits"), with the same rules as registrations. */
export function sessionsByAttributionChannel(rows: Ga4SourceRow[]): { day: string; channel: AttributionChannel; sessions: number }[] {
  const out = new Map<string, { day: string; channel: AttributionChannel; sessions: number }>();
  for (const r of rows) {
    const source = clean(r.source);
    const medium = clean(r.medium);
    // GA4 labels an ordinary link visit as medium "referral" with the referring site as source. That
    // is a referrer, not a hand-tagged UTM, so it goes to attribute() as one (instagram.com → Instagram).
    const isReferrer = medium?.toLowerCase() === "referral";
    const channel = attribute(isReferrer ? { referrer: source } : { utmSource: source, utmMedium: medium });
    const key = `${r.day}|${channel}`;
    const cur = out.get(key) ?? { day: r.day, channel, sessions: 0 };
    cur.sessions += r.sessions;
    out.set(key, cur);
  }
  return [...out.values()];
}

/* ---------- dates ---------- */

export function addDays(day: string, delta: number): string {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + delta);
  return t.toISOString().slice(0, 10);
}

/** [from, to] split into chunks of at most `size` days. */
export function chunkRange(from: string, to: string, size = 30): [string, string][] {
  const out: [string, string][] = [];
  for (let s = from; s <= to; s = addDays(s, size)) {
    const e = addDays(s, size - 1);
    out.push([s, e < to ? e : to]);
  }
  return out;
}

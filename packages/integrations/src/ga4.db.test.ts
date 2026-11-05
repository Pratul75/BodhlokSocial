/**
 * The GA4 Data API load against a real Postgres database, with GA4 faked at fetch.
 * Creates and drops its own database; skipped when Postgres isn't reachable.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const base = process.env.DATABASE_URL ?? "postgres://bodh:bodh@localhost:5433/bodh";
const dbName = `bodh_ga4test_${Date.now()}`;
const admin = postgres(base, { max: 1, onnotice: () => {} });
const reachable = await admin`select 1`.then(() => true).catch(() => false);

const PROPERTY = "412345678";
const SA = { client_email: "ga4-reader@bodhlok.iam.gserviceaccount.com", private_key: "unused", project_id: "bodhlok" };

const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};
const ymd = (d: string) => d.replace(/-/g, "");
const row = (dims: string[], mets: number[]) => ({ dimensionValues: dims.map((value) => ({ value })), metricValues: mets.map((m) => ({ value: String(m) })) });

/** A fake GA4 answering every report the loader asks for, with numbers derived from the date. */
function fakeGa4(opts: { failOnCall?: number } = {}) {
  let calls = 0;
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls++;
    if (opts.failOnCall && calls === opts.failOnCall) {
      return new Response(JSON.stringify({ error: { code: 403, status: "PERMISSION_DENIED", message: "no access" } }), { status: 403 });
    }
    const body = JSON.parse(String(init?.body)) as { dateRanges: { startDate: string; endDate: string }[]; dimensions?: { name: string }[] };
    const [{ startDate, endDate }] = body.dateRanges as [{ startDate: string; endDate: string }];
    const dimNames = (body.dimensions ?? []).map((x) => x.name);
    const list = days(startDate, endDate);
    let rows: ReturnType<typeof row>[];
    if (dimNames.includes("platform")) rows = list.flatMap((d) => [row([ymd(d), "web"], [100, 60, 80, 40, 85, 260, 9000]), row([ymd(d), "android"], [20, 12, 16, 8, 17, 50, 1800])]);
    else if (dimNames.includes("sessionSource")) rows = list.flatMap((d) => [row([ymd(d), "Organic Search", "google", "organic"], [70, 45, 30]), row([ymd(d), "Direct", "(direct)", "(none)"], [30, 15, 12]), row([ymd(d), "Organic Social", "instagram.com", "referral"], [20, 12, 6])]);
    else if (dimNames.includes("pagePath")) rows = list.flatMap((d) => [row([ymd(d), "/"], [150, 90, 3000]), row([ymd(d), "/pricing?ref=x"], [60, 40, 1200])]);
    else rows = [row([], [list.length * 120, list.length * 72, list.length * 70, list.length * 75, list.length * 48, list.length * 310])];
    return new Response(JSON.stringify({ rows, rowCount: rows.length }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, token: async () => "tok", sleep: async () => {}, calls: () => calls };
}

describe.skipIf(!reachable)("GA4 Data API load with a database", () => {
  let m: { db: typeof import("@bodh/db"); pipeline: typeof import("./pipeline"); orm: typeof import("drizzle-orm") };
  let dir: string;

  beforeAll(async () => {
    // An empty secrets folder of its own, so no saved key on this machine is used.
    dir = await mkdtemp(join(tmpdir(), "bodh-ga4-"));
    process.env.SECRETS_DIR = join(dir, "secrets");
    delete process.env.SECRETS_BACKEND;
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    const url = base.replace(/\/[^/]+$/, `/${dbName}`);
    process.env.DATABASE_URL = url;
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const mc = postgres(url, { max: 1, onnotice: () => {} });
    await migrate(drizzle(mc), { migrationsFolder: fileURLToPath(new URL("../../db/migrations", import.meta.url)) });
    await mc.end();
    m = { db: await import("@bodh/db"), pipeline: await import("./pipeline"), orm: await import("drizzle-orm") };
    await m.db.db.insert(m.db.connections).values({ key: "ga4", status: "connected", secretRef: "ga4" }).onConflictDoNothing();
  });

  afterAll(async () => {
    await m?.db.sql.end();
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
    await rm(dir, { recursive: true, force: true });
  });

  const counts = async () => {
    const { db, ga4Daily, ga4DailySources, ga4DailyPages, ga4PeriodTotals, webSessionsDaily } = m.db;
    const c = async (t: PgTable) => (await db.select({ n: m.orm.sql<number>`count(*)::int` }).from(t))[0]!.n;
    return {
      daily: await c(ga4Daily),
      sources: await c(ga4DailySources),
      pages: await c(ga4DailyPages),
      totals: await c(ga4PeriodTotals),
      web: await c(webSessionsDaily),
      sessions: (await db.select({ s: m.orm.sql<number>`coalesce(sum(sessions),0)::int` }).from(ga4Daily))[0]!.s,
    };
  };

  it("backfills 90 days in 30-day requests into all GA4 tables and the funnel's sessions", async () => {
    const ga4 = fakeGa4();
    const r = await m.pipeline.loadGa4Report(PROPERTY, SA, "2026-08-08", "2026-11-05", ga4);
    expect(r.status).toBe("succeeded");
    expect(r.detail).toContain("GA4 property 412345678, 2026-08-08 to 2026-11-05: 10,800 sessions");
    // 3 chunks × 3 reports + 3 period totals.
    expect(ga4.calls()).toBe(12);
    expect(await counts()).toEqual({ daily: 180, sources: 270, pages: 180, totals: 3, web: 270, sessions: 10_800 });

    const { db, ga4DailyPages, webSessionsDaily, ga4PeriodTotals, connections } = m.db;
    const paths = await db.selectDistinct({ p: ga4DailyPages.pagePath }).from(ga4DailyPages);
    expect(paths.map((x) => x.p).sort()).toEqual(["/", "/pricing"]);
    const channels = await db.select({ channel: webSessionsDaily.channel, s: m.orm.sql<number>`sum(sessions)::int` }).from(webSessionsDaily).groupBy(webSessionsDaily.channel);
    expect(Object.fromEntries(channels.map((x) => [x.channel, x.s]))).toEqual({ seo: 6300, direct: 2700, instagram: 1800 });
    const [t28] = await db.select().from(ga4PeriodTotals).where(m.orm.eq(ga4PeriodTotals.rangeDays, 28));
    expect(t28).toMatchObject({ startDay: "2026-10-09", endDay: "2026-11-05", sessions: 28 * 120, totalUsers: 28 * 75 });
    const [conn] = await db.select().from(connections).where(m.orm.eq(connections.key, "ga4"));
    expect(conn).toMatchObject({ status: "connected", error: null });
    expect(conn!.lastSyncAt).not.toBeNull();
  });

  it("re-running the same window gives exactly the same rows", async () => {
    const before = await counts();
    await m.pipeline.loadGa4Report(PROPERTY, SA, "2026-08-08", "2026-11-05", fakeGa4());
    await m.pipeline.loadGa4Report(PROPERTY, SA, "2026-11-03", "2026-11-05", fakeGa4());
    expect(await counts()).toEqual(before);
  });

  it("a failure part-way through changes nothing", async () => {
    const before = await counts();
    // Call 5 is the second chunk's sources report.
    await expect(m.pipeline.loadGa4Report(PROPERTY, SA, "2026-08-08", "2026-11-05", fakeGa4({ failOnCall: 5 }))).rejects.toThrow(/can't read GA4 property 412345678/);
    expect(await counts()).toEqual(before);
  });

  it("the daily job reports a missing service account instead of calling GA4", async () => {
    process.env.GA4_PROPERTY_ID = PROPERTY;
    try {
      const r = await m.pipeline.loadGa4Sessions("2026-11-05");
      expect(r).toMatchObject({ status: "skipped" });
      expect(r.detail).toMatch(/no GA4 service account is saved/);
    } finally {
      delete process.env.GA4_PROPERTY_ID;
    }
  });
});

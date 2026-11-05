import { and, desc, eq, gte, lte, sql, type Column } from "drizzle-orm";
import { db, ga4Daily, ga4DailyPages, ga4DailySources, ga4PeriodTotals, pipelineRuns } from "@bodh/db";
import { daysAgo, toIsoDate } from "@/lib/format";

/**
 * GA4 numbers for the Analytics page, read from the tables the GA4 Data API job fills
 * (packages/integrations/src/ga4-data.ts). Only the property in GA4_PROPERTY_ID is read.
 */

export interface Ga4Kpis {
  sessions: number;
  engagedSessions: number;
  users: number;
  newUsers: number;
  pageViews: number;
}

export interface Ga4Overview {
  propertyId: string | null;
  /** Why there is nothing to show, when there isn't. */
  problem: "not_configured" | "invalid_property" | "no_data" | null;
  lastRun: { status: string; detail: string | null; startedAt: Date } | null;
  dataThrough: string | null;
  loadedAt: Date | null;
  kpis: Ga4Kpis | null;
  /** Users are counted once over the period when the job stored a total for this exact range. */
  usersExact: boolean;
  previous: { sessions: number; engagedSessions: number; pageViews: number } | null;
  series: { label: string; sessions: number }[];
  platforms: { platform: string; sessions: number }[];
  pages: { pagePath: string; views: number; users: number; avgEngagementSeconds: number }[];
  sources: { channelGroup: string; source: string; medium: string; sessions: number; engagedSessions: number }[];
}

function configuredProperty(): { id: string | null; invalid: boolean } {
  const v = process.env.GA4_PROPERTY_ID?.trim();
  if (!v) return { id: null, invalid: false };
  return /^\d{4,15}$/.test(v) ? { id: v, invalid: false } : { id: null, invalid: true };
}

const shortDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export async function ga4Overview(days: number): Promise<Ga4Overview> {
  const [lastRun] = await db
    .select({ status: pipelineRuns.status, detail: pipelineRuns.detail, startedAt: pipelineRuns.startedAt })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.job, "load_ga4_sessions"))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(1);
  const empty = { lastRun: lastRun ?? null, dataThrough: null, loadedAt: null, kpis: null, usersExact: false, previous: null, series: [], platforms: [], pages: [], sources: [] };
  const prop = configuredProperty();
  if (!prop.id) return { propertyId: null, problem: prop.invalid ? "invalid_property" : "not_configured", ...empty };
  const p = prop.id;

  const from = toIsoDate(daysAgo(days));
  const to = toIsoDate(daysAgo(1));
  const prevFrom = toIsoDate(daysAgo(days * 2));
  const prevTo = toIsoDate(daysAgo(days + 1));
  const inRange = (col: Column, a: string, b: string) => and(gte(col, a), lte(col, b));

  const [[fresh], [cur], [prev], [total], daily, platforms, pages, sources] = await Promise.all([
    db.select({ through: sql<string | null>`max(${ga4Daily.day})::text`, loadedAt: sql<Date | null>`max(${ga4Daily.loadedAt})` }).from(ga4Daily).where(eq(ga4Daily.propertyId, p)),
    db
      .select({
        sessions: sql<number>`coalesce(sum(${ga4Daily.sessions}),0)::int`,
        engagedSessions: sql<number>`coalesce(sum(${ga4Daily.engagedSessions}),0)::int`,
        activeUsers: sql<number>`coalesce(sum(${ga4Daily.activeUsers}),0)::int`,
        newUsers: sql<number>`coalesce(sum(${ga4Daily.newUsers}),0)::int`,
        pageViews: sql<number>`coalesce(sum(${ga4Daily.screenPageViews}),0)::int`,
        rows: sql<number>`count(*)::int`,
      })
      .from(ga4Daily)
      .where(and(eq(ga4Daily.propertyId, p), inRange(ga4Daily.day, from, to))),
    db
      .select({
        sessions: sql<number>`coalesce(sum(${ga4Daily.sessions}),0)::int`,
        engagedSessions: sql<number>`coalesce(sum(${ga4Daily.engagedSessions}),0)::int`,
        pageViews: sql<number>`coalesce(sum(${ga4Daily.screenPageViews}),0)::int`,
        rows: sql<number>`count(*)::int`,
      })
      .from(ga4Daily)
      .where(and(eq(ga4Daily.propertyId, p), inRange(ga4Daily.day, prevFrom, prevTo))),
    db.select().from(ga4PeriodTotals).where(and(eq(ga4PeriodTotals.propertyId, p), eq(ga4PeriodTotals.rangeDays, days))),
    db
      .select({ day: sql<string>`${ga4Daily.day}::text`, sessions: sql<number>`sum(${ga4Daily.sessions})::int` })
      .from(ga4Daily)
      .where(and(eq(ga4Daily.propertyId, p), inRange(ga4Daily.day, from, to)))
      .groupBy(ga4Daily.day)
      .orderBy(ga4Daily.day),
    db
      .select({ platform: ga4Daily.platform, sessions: sql<number>`sum(${ga4Daily.sessions})::int` })
      .from(ga4Daily)
      .where(and(eq(ga4Daily.propertyId, p), inRange(ga4Daily.day, from, to)))
      .groupBy(ga4Daily.platform)
      .orderBy(sql`2 desc`),
    db
      .select({
        pagePath: ga4DailyPages.pagePath,
        views: sql<number>`sum(${ga4DailyPages.screenPageViews})::int`,
        users: sql<number>`sum(${ga4DailyPages.activeUsers})::int`,
        engagement: sql<number>`sum(${ga4DailyPages.userEngagementSeconds})::int`,
      })
      .from(ga4DailyPages)
      .where(and(eq(ga4DailyPages.propertyId, p), inRange(ga4DailyPages.day, from, to)))
      .groupBy(ga4DailyPages.pagePath)
      // GA4's catch-all "(other)" row goes last, after the real pages.
      .orderBy(sql`${ga4DailyPages.pagePath} = '(other)'`, sql`2 desc`)
      .limit(10),
    db
      .select({
        channelGroup: ga4DailySources.channelGroup,
        source: ga4DailySources.source,
        medium: ga4DailySources.medium,
        sessions: sql<number>`sum(${ga4DailySources.sessions})::int`,
        engagedSessions: sql<number>`sum(${ga4DailySources.engagedSessions})::int`,
      })
      .from(ga4DailySources)
      .where(and(eq(ga4DailySources.propertyId, p), inRange(ga4DailySources.day, from, to)))
      .groupBy(ga4DailySources.channelGroup, ga4DailySources.source, ga4DailySources.medium)
      .orderBy(sql`4 desc`)
      .limit(10),
  ]);

  if (!fresh?.through || !cur?.rows) return { propertyId: p, problem: "no_data", ...empty, dataThrough: fresh?.through ?? null, loadedAt: fresh?.loadedAt ? new Date(fresh.loadedAt) : null };

  // A stored total counts each user once over the period; summing daily users would overcount.
  const usersExact = Boolean(total && total.endDay === to);
  // Weekly blocks for longer periods, so the chart stays readable.
  const byDay = new Map(daily.map((r) => [r.day, r.sessions]));
  const series: { label: string; sessions: number }[] = [];
  if (days <= 14) {
    for (let i = days; i >= 1; i--) {
      const dd = toIsoDate(daysAgo(i));
      series.push({ label: shortDay(dd), sessions: byDay.get(dd) ?? 0 });
    }
  } else {
    for (let end = 1; end <= days; end += 7) {
      let sum = 0;
      let first = "";
      for (let i = end; i < end + 7 && i <= days; i++) {
        const dd = toIsoDate(daysAgo(i));
        sum += byDay.get(dd) ?? 0;
        first = dd;
      }
      series.unshift({ label: shortDay(first), sessions: sum });
    }
  }

  return {
    propertyId: p,
    problem: null,
    lastRun: lastRun ?? null,
    dataThrough: fresh.through,
    loadedAt: fresh.loadedAt ? new Date(fresh.loadedAt) : null,
    kpis: {
      sessions: usersExact ? total!.sessions : cur.sessions,
      engagedSessions: usersExact ? total!.engagedSessions : cur.engagedSessions,
      users: usersExact ? total!.totalUsers : cur.activeUsers,
      newUsers: usersExact ? total!.newUsers : cur.newUsers,
      pageViews: usersExact ? total!.screenPageViews : cur.pageViews,
    },
    usersExact,
    previous: prev?.rows ? { sessions: prev.sessions, engagedSessions: prev.engagedSessions, pageViews: prev.pageViews } : null,
    series,
    platforms,
    pages: pages.map((r) => ({ pagePath: r.pagePath, views: r.views, users: r.users, avgEngagementSeconds: r.views ? Math.round(r.engagement / Math.max(r.users, 1)) : 0 })),
    sources,
  };
}

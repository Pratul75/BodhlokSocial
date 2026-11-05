import Link from "next/link";
import type { Ga4Overview } from "@/lib/ga4";
import { ago, change, num, pct } from "@/lib/format";
import { PeriodBars } from "@/components/charts";
import { Card, CardHeader, EmptyState, Stat, Table } from "@/components/ui";

const PLATFORM_LABEL: Record<string, string> = { web: "Web", android: "Android app", ios: "iOS app" };
const platformLabel = (p: string) => PLATFORM_LABEL[p] ?? p;

function minutes(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function Delta({ current, previous }: { current: number; previous?: number }) {
  const c = previous === undefined ? null : change(current, previous);
  if (!c) return null;
  return <span className={c.up ? "text-leaf" : "text-sindoor"}>{c.text} vs the previous period</span>;
}

/** "Website & app (GA4)" on the Analytics page: KPIs, sessions over time, top pages and traffic sources. */
export function Ga4Section({ data, days, isAdmin }: { data: Ga4Overview; days: number; isAdmin: boolean }) {
  const title = "Website & app (GA4)";
  const lastRunNote = data.lastRun ? (
    <>
      Last GA4 job {ago(data.lastRun.startedAt)}: <span className="font-medium">{data.lastRun.status}</span>
      {data.lastRun.detail ? <>. {data.lastRun.detail}</> : null}
    </>
  ) : (
    "The GA4 job hasn't run yet."
  );

  if (data.problem === "not_configured" || data.problem === "invalid_property") {
    return (
      <Card className="mb-6">
        <CardHeader title={title} />
        <EmptyState title={data.problem === "invalid_property" ? "GA4_PROPERTY_ID isn't a GA4 property id" : "GA4 isn't set up for this page yet"}>
          {isAdmin ? (
            <>
              Three steps: enable the Google Analytics Data API in the GA4 service account&apos;s Google Cloud project, add that service account as Viewer on the GA4 property, and set
              the numeric property id as <code className="font-mono">GA4_PROPERTY_ID</code> on the server. The daily job then loads the last 90 days. {lastRunNote}
            </>
          ) : (
            <>An admin needs to finish the GA4 setup. {lastRunNote}</>
          )}
        </EmptyState>
      </Card>
    );
  }

  if (data.problem === "no_data" || !data.kpis) {
    return (
      <Card className="mb-6">
        <CardHeader title={title} sub={data.propertyId ? `GA4 property ${data.propertyId}` : undefined} />
        <EmptyState title={data.dataThrough ? `No GA4 data for the last ${days} days` : "No GA4 data loaded yet"}>
          {lastRunNote}{" "}
          <Link href="/tracking" className="text-dusk hover:underline">
            Tracking
          </Link>{" "}
          shows every run.
        </EmptyState>
      </Card>
    );
  }

  const k = data.kpis;
  const totalPlatform = data.platforms.reduce((t, p) => t + p.sessions, 0);
  const sourceTotal = data.sources.reduce((t, s) => t + s.sessions, 0) || k.sessions;

  return (
    <Card className="mb-6">
      <CardHeader
        title={title}
        sub={
          <>
            Last {days} days · GA4 property {data.propertyId} · data through {data.dataThrough}
            {data.loadedAt ? <> · loaded {ago(data.loadedAt)}</> : null}. GA4 can keep updating the last two days.
          </>
        }
      />
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 px-5 py-5 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Sessions" value={num(k.sessions)} sub={<Delta current={k.sessions} previous={data.previous?.sessions} />} />
        <Stat label={data.usersExact ? "Users" : "Users (sum of daily)"} value={num(k.users)} sub={k.newUsers ? `${num(k.newUsers)} new` : undefined} />
        <Stat label="Engaged sessions" value={num(k.engagedSessions)} sub={<Delta current={k.engagedSessions} previous={data.previous?.engagedSessions} />} />
        <Stat label="Engagement rate" value={k.sessions ? pct(k.engagedSessions / k.sessions) : "—"} sub="Engaged sessions ÷ sessions" />
        <Stat label="Page and screen views" value={num(k.pageViews)} sub={<Delta current={k.pageViews} previous={data.previous?.pageViews} />} />
      </div>

      <div className="border-t border-rule">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-3">
          <p className="text-xs font-medium text-muted">{days <= 14 ? "Sessions per day" : "Sessions per week (7-day blocks ending yesterday)"}</p>
          {data.platforms.length > 1 && (
            <p className="text-xs text-muted">
              {data.platforms.map((p, i) => (
                <span key={p.platform}>
                  {i > 0 && " · "}
                  {platformLabel(p.platform)} {totalPlatform ? pct(p.sessions / totalPlatform, 0) : "—"}
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="pt-3">
          <PeriodBars data={data.series} valueKey="sessions" height={120} />
        </div>
      </div>

      <div className="grid grid-cols-1 border-t border-rule xl:grid-cols-2">
        <div className="min-w-0 xl:border-r xl:border-rule">
          <p className="px-5 pt-3 text-xs font-medium text-muted">Top pages and screens</p>
          {data.pages.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted">No page views in this period.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Page</th>
                  <th className="text-right">Views</th>
                  <th className="text-right">Users</th>
                  <th className="text-right" title="Engagement time per user">Avg. time</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[13px] tabular">
                {data.pages.map((r) => (
                  <tr key={r.pagePath}>
                    <td className="max-w-[18rem] truncate font-sans text-sm" title={r.pagePath}>
                      {r.pagePath}
                    </td>
                    <td className="text-right">{num(r.views)}</td>
                    <td className="text-right">{num(r.users)}</td>
                    <td className="text-right">{minutes(r.avgEngagementSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
        <div className="min-w-0 border-t border-rule xl:border-t-0">
          <p className="px-5 pt-3 text-xs font-medium text-muted">Traffic sources (GA4&apos;s own channel grouping)</p>
          {data.sources.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted">No sessions in this period.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Source / medium</th>
                  <th className="text-right">Sessions</th>
                  <th className="text-right">Engaged</th>
                  <th className="text-right">Share</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[13px] tabular">
                {data.sources.map((s) => (
                  <tr key={`${s.channelGroup}|${s.source}|${s.medium}`}>
                    <td className="font-sans text-sm">{s.channelGroup}</td>
                    <td className="max-w-[14rem] truncate font-sans text-sm text-muted" title={`${s.source} / ${s.medium}`}>
                      {s.source} / {s.medium}
                    </td>
                    <td className="text-right">{num(s.sessions)}</td>
                    <td className="text-right">{num(s.engagedSessions)}</td>
                    <td className="text-right">{pct(s.sessions / sourceTotal, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </div>
    </Card>
  );
}

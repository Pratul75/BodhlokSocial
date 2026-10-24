import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { creativePerformance, db, pipelineRuns } from "@bodh/db";
import { channelLabel } from "@bodh/shared";
import { requireModule } from "@/lib/auth";
import { ago, daysAgo, inr, num, pct, toIsoDate } from "@/lib/format";
import { costPerActivated, funnelByChannel, funnelTotals, weeklyActivations } from "@/lib/funnel";
import { FunnelStrip, PeriodBars } from "@/components/charts";
import { Card, CardHeader, PageHeader, Pill, Table } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics" };

const RANGES = [7, 28] as const;
const channelName = channelLabel;

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireModule("analytics");
  const { days: d } = await searchParams;
  const days = RANGES.includes(Number(d) as 7 | 28) ? Number(d) : 28;

  const [totals, channels, weeks, ads, [lastRebuild]] = await Promise.all([
    funnelTotals(days),
    funnelByChannel(days),
    weeklyActivations(8),
    creativePerformance(toIsoDate(daysAgo(days)), toIsoDate(daysAgo(1)), 15),
    db.select().from(pipelineRuns).where(eq(pipelineRuns.job, "rebuild_funnel")).orderBy(desc(pipelineRuns.startedAt)).limit(1),
  ]);
  const now = new Date();
  // Ads are judged against other ads, not against a blend that includes free organic signups.
  const adSpend = ads.reduce((t, a) => t + a.spend, 0);
  const adActivations = ads.reduce((t, a) => t + a.activations, 0);
  const paidCpa = adActivations ? adSpend / adActivations : null;
  const blended = costPerActivated(totals);
  const paidChannels = channels.filter((c) => c.spend > 0);
  const best = paidChannels.reduce<(typeof channels)[number] | null>(
    (b, c) => (!b || (costPerActivated(c) ?? Infinity) < (costPerActivated(b) ?? Infinity) ? c : b),
    null,
  );

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Every channel is judged on cost per activated user: an astrologer or student who created a free desk and opened a first chart."
        actions={
          <div className="flex rounded-lg bg-card p-0.5 ring-1 ring-rule">
            {RANGES.map((r) => (
              <Link
                key={r}
                href={`/analytics?days=${r}`}
                aria-current={days === r ? "page" : undefined}
                className={`rounded-md px-3 py-1 text-sm ${days === r ? "bg-night text-white" : "text-muted hover:text-ink"}`}
              >
                Last {r} days
              </Link>
            ))}
          </div>
        }
      />

      <div className="mb-6">
        <FunnelStrip totals={totals} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader title="Activated registrations per week" sub="7-day blocks ending yesterday. The North Star metric." />
          <PeriodBars data={weeks} valueKey="activations" />
        </Card>
        <Card>
          <CardHeader title="Where to put the next rupee" />
          <div className="space-y-3 px-5 py-4 text-sm">
            <p>
              Blended cost per activated user is{" "}
              <span className="font-mono font-medium tabular">{blended ? inr(blended) : "—"}</span> over the last {days} days,
              counting organic activations.
            </p>
            {best && costPerActivated(best) && (
              <p>
                <span className="font-medium">{channelName(best.channel)}</span> is the cheapest paid channel at{" "}
                <span className="font-mono font-medium tabular">{inr(costPerActivated(best)!)}</span> per activated user.
              </p>
            )}
            <p className="text-muted">
              The plan rebalances budget every two weeks toward the two channels with the lowest cost per activated user.
            </p>
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="By channel" sub={`Last ${days} days, sorted by activated registrations`} />
        <Table>
          <thead>
            <tr>
              <th>Channel</th>
              <th className="text-right">Spend</th>
              <th className="text-right" title="Ad clicks for paid channels, web sessions for the rest">Clicks or visits</th>
              <th className="text-right">Registered</th>
              <th className="text-right">Activated</th>
              <th className="text-right">Activation rate</th>
              <th className="text-right">Paid</th>
              <th className="text-right">Cost per activated</th>
            </tr>
          </thead>
          <tbody className="font-mono text-[13px] tabular">
            {channels.map((c) => {
              const cpa = costPerActivated(c);
              return (
                <tr key={c.channel}>
                  <td className="font-sans text-sm">{channelName(c.channel)}</td>
                  <td className="text-right">{c.spend ? inr(c.spend) : <span className="text-muted">—</span>}</td>
                  <td className="text-right">{num(c.clicks)}</td>
                  <td className="text-right">{num(c.registrations)}</td>
                  <td className="text-right font-medium">{num(c.activations)}</td>
                  <td className="text-right">{c.registrations ? pct(c.activations / c.registrations) : "—"}</td>
                  <td className="text-right">{num(c.paid)}</td>
                  <td className="text-right">
                    {c.spend === 0 ? <Pill>Organic</Pill> : cpa ? inr(cpa) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="By ad"
          sub={`Last ${days} days, most spend first. Green and red mark ads well below or above the ${paidCpa ? inr(paidCpa) : "paid"} average cost per activated user across ads.`}
        />
        {ads.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">No ad spend loaded yet. Connect Meta Marketing or Google Ads in Connections.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Ad</th>
                <th>Platform</th>
                <th className="text-right">Spend</th>
                <th className="text-right">Clicks</th>
                <th className="text-right">Registered</th>
                <th className="text-right">Activated</th>
                <th className="text-right">Cost per activated</th>
              </tr>
            </thead>
            <tbody>
              {ads.map((a) => {
                const cpa = a.activations ? a.spend / a.activations : null;
                const ratio = cpa && paidCpa ? cpa / paidCpa : 1;
                return (
                  <tr key={`${a.platform}-${a.adId}`}>
                    <td className="min-w-[220px]">
                      <div className="font-medium">{a.adName}</div>
                      <div className="text-xs text-muted">{a.campaignName}</div>
                    </td>
                    <td className="whitespace-nowrap text-muted">{channelName(a.platform)}</td>
                    <td className="text-right font-mono text-[13px] tabular">{inr(a.spend)}</td>
                    <td className="text-right font-mono text-[13px] tabular">{num(a.clicks)}</td>
                    <td className="text-right font-mono text-[13px] tabular">{num(a.registrations)}</td>
                    <td className="text-right font-mono text-[13px] tabular">{num(a.activations)}</td>
                    <td className={`text-right font-mono text-[13px] tabular ${!cpa ? "text-muted" : ratio > 1.3 ? "text-sindoor" : ratio < 0.85 ? "text-leaf" : ""}`}>
                      {cpa ? inr(cpa) : "No activations"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <p className="mt-4 text-xs text-muted">
        Built from BODH registration events, ad platform spend and GA4 sessions.{" "}
        {lastRebuild ? `Last rebuilt ${ago(lastRebuild.startedAt, now)}.` : "Not rebuilt yet."} Details on the Tracking page.
      </p>
    </>
  );
}

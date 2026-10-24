import Link from "next/link";
import { CHANNEL_LABELS, type Channel } from "@bodh/shared";
import { requireModule } from "@/lib/auth";
import { inr, num, pct } from "@/lib/format";
import { costPerActivated, funnelByChannel, funnelTotals, weeklyActivations } from "@/lib/funnel";
import { FunnelStrip, PeriodBars } from "@/components/charts";
import { Card, CardHeader, PageHeader, Pill, Table } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics" };

const RANGES = [7, 28] as const;
const channelName = (c: string) => (c === "referral" ? "Referral codes" : CHANNEL_LABELS[c as Channel] ?? c);

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireModule("analytics");
  const { days: d } = await searchParams;
  const days = RANGES.includes(Number(d) as 7 | 28) ? Number(d) : 28;

  const [totals, channels, weeks] = await Promise.all([funnelTotals(days), funnelByChannel(days), weeklyActivations(8)]);
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
        description="Every channel is judged on cost per activated user: registered and generated at least one chart."
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
              <th className="text-right">Clicks</th>
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

      <p className="mt-4 text-xs text-muted">
        In production these numbers come from BigQuery: the GA4 export joined with daily Google Ads and Meta spend.
      </p>
    </>
  );
}

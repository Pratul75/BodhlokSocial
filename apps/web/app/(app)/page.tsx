import Link from "next/link";
import { and, asc, count, desc, eq, gte, ne } from "drizzle-orm";
import { agentRuns, approvals, calendarItems, connections, db } from "@bodh/db";
import { CHANNEL_LABELS, FORMAT_LABELS, type Channel, type Format } from "@bodh/shared";
import { requireModule } from "@/lib/auth";
import { change, dayLabel, isoWeek, num, timeLabel, ago } from "@/lib/format";
import { funnelTotals } from "@/lib/funnel";
import { FunnelStrip } from "@/components/charts";
import { Card, CardHeader, EmptyState, LinkButton, PageHeader, StatusPill } from "@/components/ui";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  post: "Posts",
  ad_change: "Ad changes",
  reply: "Community replies",
  blog: "Blogs",
  listing: "Directory listings",
};

export default async function TodayPage() {
  const user = await requireModule("today");
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const [week, prevWeek, pendingByKind, runs, upcoming, notConnected] = await Promise.all([
    funnelTotals(7),
    funnelTotals(7, 7),
    db.select({ kind: approvals.kind, n: count() }).from(approvals).where(eq(approvals.status, "pending")).groupBy(approvals.kind),
    db.select().from(agentRuns).orderBy(desc(agentRuns.startedAt)).limit(5),
    db
      .select()
      .from(calendarItems)
      .where(and(gte(calendarItems.scheduledAt, startOfDay), ne(calendarItems.status, "published")))
      .orderBy(asc(calendarItems.scheduledAt))
      .limit(6),
    db.select({ n: count() }).from(connections).where(eq(connections.status, "not_connected")),
  ]);

  const delta = change(week.activations, prevWeek.activations);
  const pendingTotal = pendingByKind.reduce((s, r) => s + r.n, 0);
  const firstName = user.name.split(" ")[0];

  return (
    <>
      <PageHeader
        eyebrow={`${now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · week ${isoWeek(now)}`}
        title={`Good ${now.getHours() < 12 ? "morning" : now.getHours() < 17 ? "afternoon" : "evening"}, ${firstName}`}
        description={
          pendingTotal > 0
            ? `${pendingTotal} item${pendingTotal === 1 ? " is" : "s are"} waiting for your approval. Nothing goes public until someone approves it.`
            : "Nothing is waiting for approval."
        }
        actions={pendingTotal > 0 ? <LinkButton href="/approvals" variant="primary">Review approvals</LinkButton> : undefined}
      />

      <section aria-labelledby="funnel-heading" className="mb-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="funnel-heading" className="font-display text-lg font-semibold tracking-tight">
            Last 7 days:{" "}
            <span className="font-mono text-turmeric-ink tabular">{num(week.activations)}</span> activated registrations
            {delta && (
              <span className={`ml-2 align-middle text-sm font-normal ${delta.up ? "text-leaf" : "text-sindoor"}`}>
                {delta.text} vs the week before
              </span>
            )}
          </h2>
          <Link href="/analytics" className="text-sm text-dusk hover:underline">
            Funnel by channel
          </Link>
        </div>
        <FunnelStrip totals={week} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Waiting for approval" aside={<Link href="/approvals" className="text-sm text-dusk hover:underline">Open queue</Link>} />
          {pendingByKind.length === 0 ? (
            <EmptyState title="The queue is clear">Agents will add new drafts here after their next run.</EmptyState>
          ) : (
            <ul className="divide-y divide-rule">
              {pendingByKind.map((r) => (
                <li key={r.kind}>
                  <Link href={`/approvals?kind=${r.kind}`} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-paper">
                    <span>{KIND_LABELS[r.kind] ?? r.kind}</span>
                    <span className="font-mono tabular">{r.n}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Agent runs" sub="Most recent first" />
          <ul className="divide-y divide-rule">
            {runs.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{r.agent.charAt(0).toUpperCase() + r.agent.slice(1)} agent</div>
                  <div className="truncate text-muted">{r.summary}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusPill status={r.status} />
                  <span className="text-xs text-muted">{ago(r.startedAt, now)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Coming up on the calendar" aside={<Link href="/calendar" className="text-sm text-dusk hover:underline">Open calendar</Link>} />
          {upcoming.length === 0 ? (
            <EmptyState title="Nothing scheduled">Add an idea to the calendar, or ask the Content agent to draft next week.</EmptyState>
          ) : (
            <ul className="divide-y divide-rule">
              {upcoming.map((item) => (
                <li key={item.id} className="grid grid-cols-[96px_1fr_auto] items-center gap-3 px-5 py-3 text-sm sm:grid-cols-[120px_160px_1fr_auto]">
                  <span className="text-muted">
                    {dayLabel(item.scheduledAt)}
                    <span className="block text-xs">{timeLabel(item.scheduledAt)}</span>
                  </span>
                  <span className="hidden text-muted sm:block">
                    {CHANNEL_LABELS[item.channel as Channel] ?? item.channel} · {FORMAT_LABELS[item.format as Format] ?? item.format}
                  </span>
                  <span className="min-w-0 truncate">{item.idea}</span>
                  <StatusPill status={item.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {user.role === "admin" && notConnected[0] && notConnected[0].n > 0 && (
        <p className="mt-6 text-sm text-muted">
          {notConnected[0].n} integrations are not connected yet, so agents run on sample data.{" "}
          <Link href="/connections" className="text-dusk hover:underline">
            Set up connections
          </Link>
        </p>
      )}
    </>
  );
}

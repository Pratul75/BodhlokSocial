import { desc, sql } from "drizzle-orm";
import { conversionEvents, db } from "@bodh/db";
import { channelLabel } from "@bodh/shared";
import { requireModule } from "@/lib/auth";
import { ago, num, pct } from "@/lib/format";
import { Card, CardHeader, EmptyState, PageHeader, Pill, Stat, StatusPill, Table } from "@/components/ui";
import { CopyField } from "./copy-field";
import { RunButtons } from "./run-buttons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tracking" };

const JOBS: { key: string; label: string; schedule: string }[] = [
  { key: "forward_meta", label: "Send conversions to Meta", schedule: "Every 5 minutes" },
  { key: "forward_google", label: "Send conversions to Google Ads", schedule: "Every 5 minutes" },
  { key: "load_meta_spend", label: "Load Meta ad spend", schedule: "Hourly" },
  { key: "load_google_spend", label: "Load Google Ads spend", schedule: "Hourly" },
  { key: "load_ga4_sessions", label: "Load GA4 sessions", schedule: "Daily, 06:30" },
  { key: "rebuild_funnel", label: "Rebuild the funnel", schedule: "Hourly, and daily for 35 days" },
];

const TYPE_LABEL: Record<string, string> = { registration: "Desk created", activation: "First chart opened", paid: "Paid" };
const PLATFORM_LABEL: Record<string, string> = { web: "Web", android: "Android", ios: "iOS" };

export default async function TrackingPage() {
  const user = await requireModule("tracking");
  const now = new Date();

  const [totals, coverage, queues, runs, recent, lastReceived] = await Promise.all([
    db.execute(sql`SELECT type, count(*)::int AS n FROM conversion_events WHERE occurred_at > now() - interval '7 days' GROUP BY type`),
    db.execute(sql`
      SELECT count(*)::int AS registrations,
        count(*) FILTER (WHERE channel <> 'direct')::int AS with_source,
        count(*) FILTER (WHERE channel IN ('google_ads','meta_ads'))::int AS paid,
        count(*) FILTER (WHERE channel IN ('google_ads','meta_ads') AND utm_content IS NOT NULL)::int AS paid_with_ad
      FROM conversion_events WHERE type = 'registration' AND occurred_at > now() - interval '7 days'`),
    db.execute(sql`
      SELECT destination, status, count(*)::int AS n FROM conversion_forwards
      WHERE created_at > now() - interval '7 days' OR status = 'pending' GROUP BY 1, 2`),
    db.execute(sql`
      SELECT DISTINCT ON (job) job, status, detail, started_at, finished_at FROM pipeline_runs
      ORDER BY job, started_at DESC`),
    db.select().from(conversionEvents).orderBy(desc(conversionEvents.occurredAt)).limit(15),
    db.execute(sql`SELECT max(received_at) AS at FROM conversion_events`),
  ]);

  const t = Object.fromEntries((totals as unknown as { type: string; n: number }[]).map((r) => [r.type, r.n]));
  const cov = (coverage as unknown as { registrations: number; with_source: number; paid: number; paid_with_ad: number }[])[0]!;
  const q = queues as unknown as { destination: string; status: string; n: number }[];
  const qn = (d: string, s: string) => q.find((r) => r.destination === d && r.status === s)?.n ?? 0;
  const runByJob = new Map((runs as unknown as { job: string; status: string; detail: string | null; started_at: string }[]).map((r) => [r.job, r]));
  const last = (lastReceived as unknown as { at: string | null }[])[0]?.at;

  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const secretSet = Boolean(process.env.BODH_EVENTS_SECRET);

  return (
    <>
      <PageHeader
        title="Tracking"
        description="Where the funnel's numbers come from: events from the BODH backend, spend from the ad platforms, sessions from GA4, and conversions sent back to Meta and Google."
        actions={user.role === "admin" ? <RunButtons /> : undefined}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5">
          <Stat label="Registrations, last 7 days" value={num(t.registration ?? 0)} sub={`${num(t.activation ?? 0)} first charts · ${num(t.paid ?? 0)} paid`} />
        </Card>
        <Card className="p-5">
          <Stat label="Last event received" value={last ? ago(new Date(last), now) : "Never"} sub={secretSet ? "Signed intake is on" : "Signing secret not set"} />
        </Card>
        <Card className="p-5">
          <Stat
            label="Registrations with a known source"
            value={cov.registrations ? pct(cov.with_source / cov.registrations, 0) : "—"}
            sub="The rest arrived with no UTM, click ID or referrer"
          />
        </Card>
        <Card className="p-5">
          <Stat
            label="Paid registrations matched to an ad"
            value={cov.paid ? pct(cov.paid_with_ad / cov.paid, 0) : "—"}
            sub="Needs utm_content set to the ad ID"
          />
        </Card>
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <Card>
          <CardHeader title="Jobs" sub="Latest run of each job" />
          <Table>
            <thead><tr><th>Job</th><th>Runs</th><th>Last run</th><th>Result</th></tr></thead>
            <tbody>
              {JOBS.map((j) => {
                const r = runByJob.get(j.key);
                return (
                  <tr key={j.key}>
                    <td className="min-w-[170px] font-medium">{j.label}</td>
                    <td className="whitespace-nowrap text-muted">{j.schedule}</td>
                    <td className="whitespace-nowrap">{r ? <span className="flex items-center gap-2"><StatusPill status={r.status} /> <span className="text-xs text-muted">{ago(new Date(r.started_at), now)}</span></span> : <span className="text-xs text-muted">Not run yet</span>}</td>
                    <td className="max-w-[320px] text-xs text-muted">{r?.detail ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>

        <Card>
          <CardHeader title="Conversions sent back" sub="Server-side events, last 7 days plus anything still queued" />
          <Table>
            <thead><tr><th>Destination</th><th className="text-right">Queued</th><th className="text-right">Sent</th><th className="text-right">Failed</th></tr></thead>
            <tbody className="font-mono text-[13px] tabular">
              {[["meta_capi", "Meta Conversions API"], ["google_ads", "Google Ads"]].map(([d, label]) => (
                <tr key={d}>
                  <td className="font-sans text-sm">{label}</td>
                  <td className="text-right">{num(qn(d!, "pending"))}</td>
                  <td className="text-right">{num(qn(d!, "sent"))}</td>
                  <td className={`text-right ${qn(d!, "failed") ? "text-sindoor" : ""}`}>{num(qn(d!, "failed"))}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="px-5 pb-4 text-xs text-muted">
            Meta accepts events up to 7 days old and Google up to 60 days. Queued events go out as soon as the account is connected.
          </p>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader title="Recent events" sub="Newest first. Contact details are stored only as hashes." />
        {recent.length === 0 ? (
          <EmptyState title="No events yet">Events appear here once the BODH backend starts sending them.</EmptyState>
        ) : (
          <Table>
            <thead><tr><th>When</th><th>Event</th><th>Channel</th><th>Ad</th><th>Platform</th><th>User</th></tr></thead>
            <tbody>
              {recent.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-muted">{ago(e.occurredAt, now)}</td>
                  <td><Pill tone={e.type === "paid" ? "leaf" : e.type === "activation" ? "turmeric" : "dusk"}>{TYPE_LABEL[e.type] ?? e.type}</Pill></td>
                  <td>{channelLabel(e.channel)}</td>
                  <td className="font-mono text-xs text-muted">{e.utmContent ?? "—"}</td>
                  <td className="text-muted">{PLATFORM_LABEL[e.platform] ?? e.platform}</td>
                  <td className="font-mono text-xs text-muted">{e.userRef.length > 12 ? `${e.userRef.slice(0, 4)}…${e.userRef.slice(-4)}` : e.userRef}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="For the BODH backend team" sub="Send each desk created, first chart opened and purchase as a signed POST" />
          <div className="space-y-4 px-5 py-4">
            <CopyField label="Endpoint" value={`${appUrl}/api/events/bodh`} />
            <p className="text-sm">
              Signing secret:{" "}
              {secretSet ? <Pill tone="leaf">Set</Pill> : <Pill tone="sindoor">Not set</Pill>}{" "}
              <span className="text-muted">
                {secretSet ? "Share it with the BODH team through Secret Manager, never in chat or email." : "Set BODH_EVENTS_SECRET on the web service first."}
              </span>
            </p>
            <p className="text-sm text-muted">
              The full contract, with signing examples in Node and Python, is in <code className="font-mono text-xs">docs/bodh-events.md</code> in the repository.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader title="UTM templates for ads" sub="Paste into each platform's URL parameters so registrations match ads" />
          <div className="space-y-4 px-5 py-4">
            <CopyField label="Meta Ads, URL parameters" value="utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_content={{ad.id}}" />
            <CopyField label="Google Ads, final URL suffix" value="utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={creative}" />
            <p className="text-xs text-muted">Google adds gclid on its own when auto-tagging is on. Keep auto-tagging on.</p>
          </div>
        </Card>
      </div>
    </>
  );
}

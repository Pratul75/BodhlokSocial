import Link from "next/link";
import { ownerSql } from "@bodh/db";
import { platformAudit, requireOperator } from "@/lib/platform-auth";
import { allWorkspaceStats, platformTotals } from "@/lib/platform-stats";
import { ConsoleShell } from "./shell";
import { ConsoleCard, Money, StatTile, WhenText, WorkspacePill } from "./ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform overview" };

interface RecentRow {
  id: string;
  actor: string;
  action: string;
  target: string | null;
  slug: string | null;
  created_at: Date;
}

/** Where an operator lands: what the platform looks like right now, and what needs a look. */
export default async function PlatformOverview() {
  const op = await requireOperator();
  const stats = await allWorkspaceStats();
  const totals = await platformTotals(stats);

  const recent = (await ownerSql()<RecentRow[]>`
    select a.id, a.actor, a.action, a.target, t.slug, a.created_at
    from platform.platform_audit a
    left join platform.tenants t on t.id = a.tenant_id
    order by a.created_at desc limit 8`) as unknown as RecentRow[];

  await platformAudit({ actor: op.email, action: "view_overview", target: "console" });

  const needsAttention = stats.filter((s) => s.error || s.tenant.status !== "active" || s.pendingApprovals > 0);
  const busiest = [...stats].sort((a, b) => b.aiSpend30d - a.aiSpend30d).slice(0, 5);

  return (
    <ConsoleShell
      operator={op}
      title="Overview"
      description="Every workspace on this installation, read from the workspace itself through its read-only role."
      actions={
        <Link
          href="/super-admin/workspaces"
          className="rounded-lg bg-night px-3 py-2 text-sm font-medium text-white hover:bg-night-2"
        >
          Manage workspaces
        </Link>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Workspaces" value={totals.workspaces} sub={`${totals.active} active · ${totals.suspended} suspended`} />
        <StatTile label="People" value={totals.people} sub="active across all workspaces" />
        <StatTile label="Agent runs" value={totals.runs30d} sub="last 30 days" />
        <StatTile label="AI spend" value={<Money usd={totals.aiSpend30d} />} sub="last 30 days" />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <StatTile label="Operators" value={totals.operators} sub="with console access" />
        <StatTile
          label="Open looks"
          value={totals.openLooks}
          sub={totals.openLooks ? "read-only, time-limited" : "nobody is inside a workspace"}
          tone={totals.openLooks ? "turmeric" : "neutral"}
        />
        <StatTile label="Platform actions today" value={totals.auditToday} sub="in the audit log" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ConsoleCard
          title="Needs a look"
          sub="Suspended workspaces, approvals waiting, and anything the console could not read"
        >
          {needsAttention.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">Nothing waiting. Every workspace answered and is active.</p>
          ) : (
            <ul className="divide-y divide-rule">
              {needsAttention.map((s) => (
                <li key={s.tenant.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link href={`/super-admin/workspaces/${s.tenant.id}`} className="font-medium hover:underline">
                      {s.tenant.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted">
                      {s.error
                        ? s.error
                        : s.tenant.status !== "active"
                          ? `Workspace is ${s.tenant.status}`
                          : `${s.pendingApprovals} waiting for approval`}
                    </p>
                  </div>
                  <WorkspacePill status={s.tenant.status} error={Boolean(s.error)} />
                </li>
              ))}
            </ul>
          )}
        </ConsoleCard>

        <ConsoleCard title="Busiest workspaces" sub="By AI spend over the last 30 days">
          {busiest.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">No workspaces yet.</p>
          ) : (
            <ul className="divide-y divide-rule">
              {busiest.map((s) => (
                <li key={s.tenant.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link href={`/super-admin/workspaces/${s.tenant.id}`} className="font-medium hover:underline">
                      {s.tenant.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted">
                      {s.people} people · {s.runs30d} runs · {s.modulesOn}/{s.modulesTotal} modules
                    </p>
                  </div>
                  <span className="font-mono text-sm tabular">
                    <Money usd={s.aiSpend30d} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ConsoleCard>
      </div>

      <div className="mt-4">
        <ConsoleCard
          title="Recent platform activity"
          sub="The last eight things an operator did"
          aside={
            <Link href="/super-admin/audit" className="text-xs text-dusk hover:underline">
              Full audit log
            </Link>
          }
        >
          <ul className="divide-y divide-rule">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-5 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{r.actor}</span>{" "}
                  <span className="font-mono text-xs text-muted">{r.action}</span>{" "}
                  {r.target && <span className="text-muted">{r.target}</span>}
                  {r.slug && <span className="text-muted"> · {r.slug}</span>}
                </span>
                <WhenText at={r.created_at} />
              </li>
            ))}
          </ul>
        </ConsoleCard>
      </div>
    </ConsoleShell>
  );
}

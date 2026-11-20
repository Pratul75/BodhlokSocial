import Link from "next/link";
import { accessLevels, listOrgAdmins, orgLimits, ownerSql, workspacesOf, type AccessLevel } from "@bodh/db";
import { requireOrgAdmin } from "@/lib/org-auth";
import { workspaceStatsFor } from "@/lib/platform-stats";
import { Card, CardHeader, EmptyState, StatusPill } from "@/components/ui";
import { ago } from "@/lib/format";
import { AgencyShell } from "./shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview" };

const short = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString("en-IN");

interface Recent {
  id: string;
  actor: string;
  action: string;
  target: string | null;
  created_at: Date;
}

/**
 * Where an agency lands: what its workspaces look like right now, and what needs a look.
 *
 * The platform console's overview, asked about one agency. Same questions, same order, so
 * nobody has to learn two of these.
 */
export default async function AgencyOverview() {
  const { user, org } = await requireOrgAdmin();
  const all = await workspacesOf(org.id);
  const [levels, limits, admins] = await Promise.all([accessLevels(org.id), orgLimits(org.id), listOrgAdmins(org.id)]);
  const levelOf = (id: string): AccessLevel => levels.get(id) ?? "full";
  const visible = all.filter((t) => t.id === user.tenant.id || levelOf(t.id) !== "none");
  const stats = await workspaceStatsFor(visible);

  const waiting = stats.reduce((n, s) => n + s.pendingApprovals, 0);
  const tokens = stats.reduce((n, s) => n + s.tokensIn30d + s.tokensOut30d, 0);
  const spend = stats.reduce((n, s) => n + s.aiSpend30d, 0);
  const needsLook = stats.filter((s) => s.error || s.tenant.status !== "active" || s.pendingApprovals > 0);
  const busiest = [...stats].sort((a, b) => b.tokensIn30d + b.tokensOut30d - (a.tokensIn30d + a.tokensOut30d)).slice(0, 5);
  const now = new Date();

  // What has been done to this agency's workspaces, and to the agency itself, from the
  // platform's own trail. The agency-level entries carry no tenant id, which is why they are
  // asked for separately rather than joined away.
  const ids = visible.map((t) => t.id);
  const recent = (await ownerSql()<Recent[]>`
    select id, actor, action, target, created_at from platform.platform_audit
    where tenant_id = any(${ids}::uuid[]) or (tenant_id is null and target = ${org.slug})
    order by created_at desc limit 8`) as unknown as Recent[];

  return (
    <AgencyShell
      orgName={org.name}
      workspaceName={user.tenant.name}
      email={user.email}
      clients={visible.length}
      title="Overview"
      description="Your workspaces as they are right now, read from each one through its read-only role."
      actions={
        <Link href="/org/clients" className="rounded-lg bg-night px-3 py-2 text-sm font-medium text-white hover:bg-night-2">
          My clients
        </Link>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">Workspaces</div>
          <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">{visible.length}</div>
          <div className="mt-1.5 text-xs text-muted">
            {limits.maxWorkspaces === null ? "yours and your clients’" : `of ${limits.maxWorkspaces} allowed`}
          </div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">Waiting for approval</div>
          <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">{waiting}</div>
          <div className="mt-1.5 text-xs text-muted">across every workspace</div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">Tokens</div>
          <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">{short(tokens)}</div>
          <div className="mt-1.5 text-xs text-muted">
            <Link href="/org/usage" className="text-dusk hover:underline">
              last 30 days · by workspace
            </Link>
          </div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">AI spend</div>
          <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">${spend.toFixed(2)}</div>
          <div className="mt-1.5 text-xs text-muted">
            {limits.monthlyBudgetUsd === null ? "last 30 days" : `last 30 days, of $${limits.monthlyBudgetUsd} a month`}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">People</div>
          <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">
            {stats.reduce((n, s) => n + s.people, 0)}
          </div>
          <div className="mt-1.5 text-xs text-muted">across every workspace</div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">Runs</div>
          <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">
            {stats.reduce((n, s) => n + s.runs30d, 0)}
          </div>
          <div className="mt-1.5 text-xs text-muted">agents and chat, last 30 days</div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">Runs this agency</div>
          <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">{admins.length}</div>
          <div className="mt-1.5 text-xs text-muted">
            <Link href="/org/team" className="text-dusk hover:underline">
              who they are
            </Link>
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Needs a look" sub="Approvals waiting, anything not active, and anything that could not be read" />
          {needsLook.length === 0 ? (
            <EmptyState title="Nothing waiting">Every workspace answered and is active.</EmptyState>
          ) : (
            <ul className="divide-y divide-rule">
              {needsLook.map((s) => (
                <li key={s.tenant.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link href={`/org/clients/${s.tenant.id}`} className="font-medium hover:underline">
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
                  <StatusPill status={s.tenant.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Busiest workspaces" sub="By tokens over the last 30 days" />
          {busiest.length === 0 ? (
            <EmptyState title="No workspaces yet">Create your first client.</EmptyState>
          ) : (
            <ul className="divide-y divide-rule">
              {busiest.map((s) => (
                <li key={s.tenant.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link href={`/org/clients/${s.tenant.id}`} className="font-medium hover:underline">
                      {s.tenant.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted">
                      {s.runs30d} runs · ${s.aiSpend30d.toFixed(2)} · {s.people} people
                    </p>
                  </div>
                  <span className="font-mono text-sm tabular">{short(s.tokensIn30d + s.tokensOut30d)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader
            title="Recent activity"
            sub="The last eight things done to these workspaces from a console"
            aside={
              <Link href="/org/audit" className="text-xs text-dusk hover:underline">
                Full log
              </Link>
            }
          />
          {recent.length === 0 ? (
            <EmptyState title="Nothing yet">Nothing has been done to these workspaces from a console.</EmptyState>
          ) : (
            <ul className="divide-y divide-rule">
              {recent.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-5 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{r.actor}</span> <span className="font-mono text-xs text-muted">{r.action}</span>{" "}
                    {r.target && <span className="text-muted">{r.target}</span>}
                  </span>
                  <span className="text-xs whitespace-nowrap text-muted">{ago(new Date(r.created_at), now)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AgencyShell>
  );
}

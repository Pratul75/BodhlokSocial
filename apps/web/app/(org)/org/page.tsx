import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { accessLevels, orgLimits, workspacesOf, type AccessLevel } from "@bodh/db";
import { requireOrgAdmin } from "@/lib/org-auth";
import { workspaceStatsFor } from "@/lib/platform-stats";
import { Card, CardHeader, EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { WorkspaceFilters } from "@/app/(platform)/super-admin/workspaces/filters";
import { ago } from "@/lib/format";
import { NewClientForm } from "./forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "My clients" };

const short = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString("en-IN");

/**
 * The agency's workspaces, shown the way the platform console shows workspaces — the same
 * columns, the same search, the same sort. An agency running four clients is doing the same job
 * an operator does across forty, and two lists that answer the same question should not have to
 * be learned twice.
 *
 * What differs is the scope and what is on offer. Only this agency's workspaces are read — no
 * other agency's schema is touched, not even to throw the answer away — and none of the
 * platform's own business is here: no schema names, no database roles, no suspending and no
 * deleting.
 */
export default async function OrgHome({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; sort?: string }>;
}) {
  const { user, org } = await requireOrgAdmin();
  const { q = "", status = "all", sort = "name" } = await searchParams;

  const all = await workspacesOf(org.id);
  const [levels, limits] = await Promise.all([accessLevels(org.id), orgLimits(org.id)]);
  const levelOf = (id: string): AccessLevel => levels.get(id) ?? "full";

  // A client set to `none` is not listed at all. The workspace itself is untouched: it has its
  // own people and carries on exactly as before.
  const visible = all.filter((t) => t.id === user.tenant.id || levelOf(t.id) !== "none");
  const hidden = all.length - visible.length;
  const stats = await workspaceStatsFor(visible);

  const needle = q.trim().toLowerCase();
  let rows = stats.filter((s) => {
    if (status !== "all" && s.tenant.status !== status) return false;
    if (!needle) return true;
    return s.tenant.name.toLowerCase().includes(needle) || s.tenant.slug.includes(needle);
  });
  rows = [...rows].sort((a, b) => {
    if (sort === "people") return b.people - a.people;
    if (sort === "spend") return b.aiSpend30d - a.aiSpend30d;
    if (sort === "activity") return (b.lastActivity?.getTime() ?? 0) - (a.lastActivity?.getTime() ?? 0);
    return a.tenant.name.localeCompare(b.tenant.name);
  });

  const totalSpend = stats.reduce((n, r) => n + r.aiSpend30d, 0);
  const totalTokens = stats.reduce((n, r) => n + r.tokensIn30d + r.tokensOut30d, 0);
  const waiting = stats.reduce((n, r) => n + r.pendingApprovals, 0);
  const clients = all.filter((t) => t.id !== user.tenant.id).length;
  const now = new Date();

  return (
    <main className="mx-auto max-w-[1240px] px-4 py-6 sm:px-8 sm:py-8">
      <Link href="/" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={14} /> Back to {user.tenant.name}
      </Link>
      <PageHeader
        eyebrow={org.name}
        title="My clients"
        description={`${all.length} workspaces in this agency, including your own. Each has its own data, its own people and its own credentials.`}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">Clients</div>
          <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">{clients}</div>
          <div className="mt-1.5 text-xs text-muted">
            {limits.maxWorkspaces === null ? "plus your own workspace" : `${all.length} of ${limits.maxWorkspaces} workspaces used`}
          </div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">Waiting for approval</div>
          <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">{waiting}</div>
          <div className="mt-1.5 text-xs text-muted">across every workspace</div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">Tokens</div>
          <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">{short(totalTokens)}</div>
          <div className="mt-1.5 text-xs text-muted">last 30 days</div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">AI spend</div>
          <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">${totalSpend.toFixed(2)}</div>
          <div className="mt-1.5 text-xs text-muted">
            {limits.monthlyBudgetUsd === null ? "last 30 days" : `last 30 days, of $${limits.monthlyBudgetUsd} a month`}
          </div>
        </Card>
      </div>

      <WorkspaceFilters q={q} status={status} sort={sort} basePath="/org" />

      <div className="mt-4">
        <Card>
          {rows.length === 0 ? (
            <EmptyState title={stats.length === 0 ? "No workspaces yet" : "Nothing matches that"}>
              {stats.length === 0 ? "Create your first client below." : "Try a different search."}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="border-b border-rule text-left text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Workspace</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">People</th>
                    <th className="px-3 py-2.5 font-medium">Access</th>
                    <th className="px-3 py-2.5 font-medium">Waiting</th>
                    <th className="px-3 py-2.5 font-medium">AI (30d)</th>
                    <th className="px-3 py-2.5 font-medium">Last activity</th>
                    <th className="px-5 py-2.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const here = s.tenant.id === user.tenant.id;
                    const canOpen = here || levelOf(s.tenant.id) === "full";
                    return (
                      <tr key={s.tenant.id} className="border-b border-rule/60 last:border-0 hover:bg-paper/60">
                        <td className="px-5 py-3">
                          <Link href={`/org/clients/${s.tenant.id}`} className="font-medium hover:underline">
                            {s.tenant.name}
                          </Link>
                          {here && <span className="ml-2 text-xs text-muted">you are here</span>}
                          <div className="mt-0.5 font-mono text-xs text-muted">{s.tenant.slug}</div>
                          {s.error && <div className="mt-0.5 text-xs text-sindoor">{s.error}</div>}
                        </td>
                        <td className="px-3 py-3">
                          <StatusPill status={s.tenant.status} />
                        </td>
                        <td className="px-3 py-3 tabular">{s.error ? "—" : s.people}</td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span className="tabular">
                            {s.modulesOn}/{s.modulesTotal}
                          </span>
                          <span className="text-muted"> modules</span>
                        </td>
                        <td className="px-3 py-3 tabular">{s.error ? "—" : s.pendingApprovals}</td>
                        <td className="px-3 py-3 font-mono tabular">{s.error ? "—" : `$${s.aiSpend30d.toFixed(2)}`}</td>
                        <td className="px-3 py-3 text-xs whitespace-nowrap text-muted">
                          {s.lastActivity ? ago(s.lastActivity, now) : "never"}
                        </td>
                        <td className="px-5 py-3 text-right text-xs">
                          <Link href={`/org/clients/${s.tenant.id}`} className="text-dusk hover:underline">
                            View
                          </Link>
                          {!canOpen && <div className="mt-0.5 text-muted">numbers only</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {hidden > 0 && (
        <p className="mt-4 text-xs text-muted">
          {hidden} workspace{hidden === 1 ? " is" : "s are"} not shown here. Ask the platform if that is wrong.
        </p>
      )}

      <div className="mt-6">
        <Card>
          <CardHeader
            title="New client"
            sub="Its own schema, database role and tables, with every module switched on and ad spend capped at ₹0 until someone raises it. Everyone who runs this agency gets an account in it."
          />
          <NewClientForm />
        </Card>
      </div>

      <p className="mt-6 text-xs text-muted">
        Numbers here are read live from each workspace through its read-only role. Nothing on this page reaches a
        client&rsquo;s content — posts, leads and messages are behind that workspace&rsquo;s own door, which you open from
        the switcher in the corner.
      </p>
    </main>
  );
}

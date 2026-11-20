import Link from "next/link";
import { listOrgAdmins, listOrgs, listTenants, orgLimits, workspaceCounts } from "@bodh/db";
import { platformAudit, requireOperator } from "@/lib/platform-auth";
import { ConsoleShell } from "../shell";
import { ConsoleCard, ConsolePill, Empty, StatTile } from "../ui";
import { CreateOrgForm, OrgAdminsForm, OrgLimitsForm, OrgRowActions } from "../forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organizations" };

/**
 * The agencies on this installation.
 *
 * An organization holds no data of its own: no schema, no database role, no tables. It says
 * which workspaces belong together — the agency's own and each of its clients'. Everything a
 * customer can actually see still lives in a workspace, behind that workspace's own role.
 */
export default async function OrgsPage() {
  const op = await requireOperator();
  const isOwner = op.role === "owner";
  const [orgs, counts, tenants] = await Promise.all([listOrgs(), workspaceCounts(), listTenants()]);
  const admins = new Map(await Promise.all(orgs.map(async (o) => [o.id, await listOrgAdmins(o.id)] as const)));
  const limits = new Map(await Promise.all(orgs.map(async (o) => [o.id, await orgLimits(o.id)] as const)));
  // A workspace with no organization only exists between a deploy and its migrate step. Shown
  // rather than hidden: a number that should always be zero is worth seeing when it is not.
  const orphans = tenants.filter((t) => !t.orgId).length;
  await platformAudit({ actor: op.email, action: "view_orgs", target: "console" });

  const active = orgs.filter((o) => o.status === "active").length;
  const workspaces = [...counts.values()].reduce((n, v) => n + v, 0);

  return (
    <ConsoleShell
      operator={op}
      title="Organizations"
      crumbs={[{ label: "Organizations" }]}
      description="Each one is an agency: its own workspace and its clients' workspaces, grouped. The organization itself holds no data."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Organizations" value={orgs.length} sub={`${active} active`} />
        <StatTile label="Workspaces in them" value={workspaces} sub="each with its own schema and role" />
        <StatTile
          label="Without an organization"
          value={orphans}
          sub={orphans === 0 ? "as it should be" : "run the migrate step"}
          tone={orphans === 0 ? "neutral" : "turmeric"}
        />
      </div>

      <div className="mt-6">
        <ConsoleCard title="All organizations" sub="Oldest first, so the list does not move as names change">
          {orgs.length === 0 ? (
            <Empty>No organizations yet. Create the first one below.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="border-b border-rule text-left text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Organization</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Workspaces</th>
                    <th className="px-3 py-2.5 font-medium">Who runs it</th>
                    <th className="px-5 py-2.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((o) => (
                    <tr key={o.id} className="border-b border-rule/60 last:border-0 hover:bg-paper/60">
                      <td className="px-5 py-3">
                        <div className="font-medium">{o.name}</div>
                        <div className="mt-0.5 font-mono text-xs text-muted">{o.slug}</div>
                      </td>
                      <td className="px-3 py-3">
                        <ConsolePill tone={o.status === "active" ? "leaf" : "turmeric"}>{o.status}</ConsolePill>
                      </td>
                      <td className="px-3 py-3">
                        <Link href="/super-admin/workspaces" className="tabular hover:underline">
                          {counts.get(o.id) ?? 0}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        {isOwner ? (
                          <OrgAdminsForm id={o.id} admins={(admins.get(o.id) ?? []).map((a) => a.email)} />
                        ) : (
                          <span className="font-mono text-xs text-muted">
                            {(admins.get(o.id) ?? []).map((a) => a.email).join(", ") || "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right align-top">
                        {isOwner ? (
                          <OrgRowActions id={o.id} name={o.name} status={o.status} />
                        ) : (
                          <span className="text-xs text-muted">View only</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ConsoleCard>
      </div>

      {isOwner && orgs.length > 0 && (
        <div className="mt-6">
          <ConsoleCard title="What each agency was sold" sub="Empty means no ceiling. A ceiling an agency can raise itself is not one, so these are set here and nowhere else.">
            <ul className="divide-y divide-rule">
              {orgs.map((o) => (
                <li key={o.id} className="px-5 py-3">
                  <div className="mb-2 text-sm font-medium">{o.name}</div>
                  <OrgLimitsForm
                    id={o.id}
                    maxWorkspaces={limits.get(o.id)?.maxWorkspaces ?? null}
                    monthlyBudgetUsd={limits.get(o.id)?.monthlyBudgetUsd ?? null}
                    held={counts.get(o.id) ?? 0}
                  />
                </li>
              ))}
            </ul>
          </ConsoleCard>
        </div>
      )}

      {isOwner && (
        <div className="mt-6">
          <ConsoleCard
            title="New organization"
            sub="Creates the agency and its own workspace in one step — its own schema, database role and tables, with every module switched on. Its clients’ workspaces come afterwards."
          >
            <div className="px-5 pb-5">
              <CreateOrgForm />
            </div>
          </ConsoleCard>
        </div>
      )}
    </ConsoleShell>
  );
}

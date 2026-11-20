import Link from "next/link";
import { listOrgs } from "@bodh/db";
import { platformAudit, requireOperator } from "@/lib/platform-auth";
import { allWorkspaceStats } from "@/lib/platform-stats";
import { ConsoleShell } from "../shell";
import { ConsoleCard, Empty, Money, WhenText, WorkspacePill } from "../ui";
import { CreateTenantForm, WorkspaceRowActions } from "../forms";
import { WorkspaceFilters } from "./filters";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workspaces" };

/** Every workspace, with the numbers that say whether it is alive and what it is costing. */
export default async function WorkspacesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; sort?: string }>;
}) {
  const op = await requireOperator();
  // Suspending and deleting belong to an owner; everyone else gets View.
  const isOwner = op.role === "owner";
  const { q = "", status = "all", sort = "name" } = await searchParams;
  const [all, orgs] = await Promise.all([allWorkspaceStats(), listOrgs()]);
  await platformAudit({ actor: op.email, action: "view_workspaces", target: "console" });

  const needle = q.trim().toLowerCase();
  let rows = all.filter((s) => {
    if (status !== "all" && s.tenant.status !== status) return false;
    if (!needle) return true;
    return (
      s.tenant.name.toLowerCase().includes(needle) ||
      s.tenant.slug.includes(needle) ||
      s.tenant.dataSchema.includes(needle)
    );
  });
  rows = [...rows].sort((a, b) => {
    if (sort === "people") return b.people - a.people;
    if (sort === "spend") return b.aiSpend30d - a.aiSpend30d;
    if (sort === "activity") return (b.lastActivity?.getTime() ?? 0) - (a.lastActivity?.getTime() ?? 0);
    return a.tenant.name.localeCompare(b.tenant.name);
  });

  // Grouped by agency, with the groups in the order the organizations were created, so the
  // list does not reorder itself as workspaces are renamed. A workspace with no organization
  // only exists between a deploy and its migrate step, but it is shown rather than hidden.
  const groups = [
    ...orgs.map((o) => ({ id: o.id, name: o.name, rows: rows.filter((r) => r.tenant.orgId === o.id) })),
    { id: "none", name: "No organization", rows: rows.filter((r) => !r.tenant.orgId) },
  ].filter((g) => g.rows.length > 0);
  const COLUMNS = 8;

  return (
    <ConsoleShell
      operator={op}
      title="Workspaces"
      crumbs={[{ label: "Workspaces" }]}
      description={`${all.length} on this installation. Each has its own schema, its own database role and its own credentials.`}
    >
      <WorkspaceFilters q={q} status={status} sort={sort} />

      <div className="mt-4">
        <ConsoleCard>
          {rows.length === 0 ? (
            <Empty>
              {all.length === 0 ? "No workspaces yet. Create the first one below." : "No workspace matches that."}
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
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
                  {groups.flatMap((group) => [
                    <tr key={`g-${group.id}`} className="border-b border-rule bg-paper/70">
                      <td colSpan={COLUMNS} className="px-5 py-2 text-xs font-medium tracking-wide text-muted uppercase">
                        {group.name}
                        <span className="ml-2 font-normal normal-case">
                          {group.rows.length} workspace{group.rows.length === 1 ? "" : "s"}
                        </span>
                      </td>
                    </tr>,
                    ...group.rows.map((s) => (
                    <tr key={s.tenant.id} className="border-b border-rule/60 last:border-0 hover:bg-paper/60">
                      <td className="px-5 py-3">
                        <Link href={`/super-admin/workspaces/${s.tenant.id}`} className="font-medium hover:underline">
                          {s.tenant.name}
                        </Link>
                        <div className="mt-0.5 font-mono text-xs text-muted">
                          {s.tenant.slug} · {s.tenant.dataSchema}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <WorkspacePill status={s.tenant.status} error={Boolean(s.error)} />
                      </td>
                      <td className="px-3 py-3 tabular">{s.error ? "—" : s.people}</td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="tabular">
                          {s.modulesOn}/{s.modulesTotal}
                        </span>
                        <span className="text-muted"> modules</span>
                      </td>
                      <td className="px-3 py-3 tabular">{s.error ? "—" : s.pendingApprovals}</td>
                      <td className="px-3 py-3 font-mono tabular">{s.error ? "—" : <Money usd={s.aiSpend30d} />}</td>
                      <td className="px-3 py-3">
                        <WhenText at={s.lastActivity} />
                      </td>
                      <td className="px-5 py-3 text-right">
                        {isOwner ? (
                          <WorkspaceRowActions
                            id={s.tenant.id}
                            slug={s.tenant.slug}
                            name={s.tenant.name}
                            status={s.tenant.status}
                            isFirst={s.tenant.dataSchema === "public"}
                          />
                        ) : (
                          <Link href={`/super-admin/workspaces/${s.tenant.id}`} className="text-xs text-dusk hover:underline">
                            View
                          </Link>
                        )}
                      </td>
                    </tr>
                    )),
                  ])}
                </tbody>
              </table>
            </div>
          )}
        </ConsoleCard>
      </div>

      {op.role === "owner" && (
        <div className="mt-6">
          <ConsoleCard
            title="New workspace"
            sub="Creates its own schema, database role, read-only role and tables, with every module switched on and ad spend capped at ₹0 until someone raises it."
          >
            <div className="px-5 pb-5">
              <CreateTenantForm orgs={orgs.filter((o) => o.status === "active")} />
            </div>
          </ConsoleCard>
        </div>
      )}
    </ConsoleShell>
  );
}

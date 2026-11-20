import { accessLevels, ownerSql, workspacesOf, type AccessLevel } from "@bodh/db";
import { requireOrgAdmin } from "@/lib/org-auth";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { ago } from "@/lib/format";
import { AgencyShell } from "../shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log" };

interface Row {
  id: string;
  actor: string;
  action: string;
  target: string | null;
  slug: string | null;
  created_at: Date;
}

/**
 * Everything done to this agency and its workspaces from a console — by the platform or by the
 * agency itself.
 *
 * Deliberately not narrowed to the agency's own actions. If the platform suspended one of these
 * workspaces or changed what it may use, the agency should find that here rather than wonder.
 * Agency-level entries — somebody added to or taken off the agency — carry no workspace at all,
 * so they are asked for by name and shown against the agency.
 */
export default async function AgencyAudit() {
  const { user, org } = await requireOrgAdmin();
  const [all, levels] = await Promise.all([workspacesOf(org.id), accessLevels(org.id)]);
  const levelOf = (id: string): AccessLevel => levels.get(id) ?? "full";
  const visible = all.filter((t) => t.id === user.tenant.id || levelOf(t.id) !== "none");
  const ids = visible.map((t) => t.id);

  const rows = (await ownerSql()<Row[]>`
    select a.id, a.actor, a.action, a.target, t.slug, a.created_at
    from platform.platform_audit a
    left join platform.tenants t on t.id = a.tenant_id
    where a.tenant_id = any(${ids}::uuid[]) or (a.tenant_id is null and a.target = ${org.slug})
    order by a.created_at desc limit 200`) as unknown as Row[];
  const now = new Date();

  return (
    <AgencyShell
      orgName={org.name}
      workspaceName={user.tenant.name}
      email={user.email}
      clients={visible.length}
      title="Audit log"
      description="Everything done to your workspaces from a console, by the platform or by you. The last two hundred."
      crumbs={[{ label: "Audit log" }]}
    >
      <Card>
        <CardHeader title="Recent first" sub={`${rows.length} entries across ${visible.length} workspaces`} />
        {rows.length === 0 ? (
          <EmptyState title="Nothing yet">Nothing has been done to these workspaces from a console.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-rule text-left text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Who</th>
                  <th className="px-3 py-2.5 font-medium">Did what</th>
                  <th className="px-3 py-2.5 font-medium">To</th>
                  <th className="px-3 py-2.5 font-medium">Where</th>
                  <th className="px-5 py-2.5 text-right font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-rule/60 last:border-0">
                    <td className="px-5 py-2.5">{r.actor}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">{r.action}</td>
                    <td className="px-3 py-2.5 text-muted">{r.target ?? "\u2014"}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-muted">
                      {r.slug ?? <span className="font-sans not-italic">the agency</span>}
                    </td>
                    <td className="px-5 py-2.5 text-right text-xs whitespace-nowrap text-muted">
                      {ago(new Date(r.created_at), now)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AgencyShell>
  );
}

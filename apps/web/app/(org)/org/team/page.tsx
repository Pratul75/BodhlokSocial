import { accessLevels, listOrgAdmins, workspacesOf, type AccessLevel } from "@bodh/db";
import { requireOrgAdmin } from "@/lib/org-auth";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { ago } from "@/lib/format";
import { AgencyShell } from "../shell";
import { AddAgencyAdminForm, RemoveAgencyAdminForm } from "../forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Who runs this agency" };

/**
 * The people who run the agency.
 *
 * Being listed here is not a role inside any workspace: it opens this panel, and it is what
 * gives somebody an account in each client the agency is allowed inside. Which is why adding a
 * person here is a real change to those clients, and the clients can see it on their own People
 * page.
 */
export default async function AgencyTeam() {
  const { user, org } = await requireOrgAdmin();
  const [admins, all, levels] = await Promise.all([
    listOrgAdmins(org.id),
    workspacesOf(org.id),
    accessLevels(org.id),
  ]);
  const levelOf = (id: string): AccessLevel => levels.get(id) ?? "full";
  const visible = all.filter((t) => t.id === user.tenant.id || levelOf(t.id) !== "none");
  const reach = all.filter((t) => levelOf(t.id) === "full").length;
  const now = new Date();

  return (
    <AgencyShell
      orgName={org.name}
      workspaceName={user.tenant.name}
      email={user.email}
      clients={visible.length}
      title="Who runs this agency"
      description="They sign in the way everybody does. This list is what opens this panel to them, and what gives them an account in each client you may reach."
      crumbs={[{ label: "Team" }]}
    >
      <Card>
        <CardHeader
          title="People"
          sub={`${admins.length} ${admins.length === 1 ? "person runs" : "people run"} ${org.name} · each gets an account in ${reach} of your ${visible.length} workspaces`}
        />
        {admins.length === 0 ? (
          <EmptyState title="Nobody yet">Add the first person below.</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {admins.map((a) => (
                <tr key={a.email} className="border-b border-rule/60 last:border-0">
                  <td className="px-5 py-3">
                    <span className="font-mono">{a.email}</span>
                    {a.email === user.email && <span className="ml-2 text-xs text-muted">you</span>}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted">
                    added by {a.addedBy} · {ago(a.createdAt, now)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {a.email === user.email ? (
                      <span className="text-xs text-muted">you can&rsquo;t remove yourself</span>
                    ) : (
                      <RemoveAgencyAdminForm email={a.email} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="mt-6">
        <Card>
          <CardHeader
            title="Add somebody"
            sub="They get this panel, and an admin account in every workspace this agency fully reaches. The client sees them on its own People page."
          />
          <AddAgencyAdminForm />
        </Card>
      </div>
    </AgencyShell>
  );
}

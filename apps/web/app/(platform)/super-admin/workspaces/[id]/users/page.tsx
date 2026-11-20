import { db, ownerSql, users, withTenant } from "@bodh/db";
import { ROLE_LABELS, ROLES } from "@bodh/shared";
import { platformAudit } from "@/lib/platform-auth";
import { requireWorkspaceAdmin } from "@/lib/workspace-admin";
import { ConsoleCard, ConsolePill, Empty, WhenText } from "../../../ui";
import { InviteUserForm, UserAccessForm, UserRoleForm, WorkspacePasswordForm } from "../../../workspace-forms";

export const dynamic = "force-dynamic";

/**
 * The people in this workspace, read from the workspace's own `users` table.
 *
 * They sign in with Google, or with a password they set from a one-time link an owner hands
 * them. Being in this list and in the control plane's directory is what lets somebody in; the
 * password, where there is one, lives in the workspace's own schema and never leaves it.
 */
export default async function WorkspaceUsers({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { viewer, tenant } = await requireWorkspaceAdmin(id);
  await platformAudit({ actor: viewer.email, action: "view_tenant_users", target: tenant.slug, tenantId: id });

  const roles = ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

  let people: {
    id: string;
    email: string;
    name: string;
    role: string;
    active: boolean;
    createdAt: Date;
    passwordHash: string | null;
    phone: string | null;
  }[] = [];
  let error: string | null = null;
  try {
    people = await withTenant({ ...tenant, readOnly: true }, () => db.select().from(users).orderBy(users.name));
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 160) : "Could not read this workspace's people.";
  }

  const directory = (await ownerSql()<{ email: string; active: boolean }[]>`
    select email, active from platform.user_directory where tenant_id = ${id}`) as unknown as {
    email: string;
    active: boolean;
  }[];
  const known = new Set(directory.filter((d) => d.active).map((d) => d.email));
  const missing = people.filter((p) => p.active && !known.has(p.email));

  return (
    <>
      {error && <p className="mb-4 rounded-lg bg-sindoor-soft px-4 py-3 text-sm text-sindoor">{error}</p>}
      {missing.length > 0 && (
        <p className="mb-4 rounded-lg bg-turmeric-soft px-4 py-3 text-sm text-turmeric-ink">
          {missing.length} {missing.length === 1 ? "person is" : "people are"} in this workspace but not in the
          sign-in directory, so Google sign-in will not find them: {missing.map((m) => m.email).join(", ")}. Changing
          their access here writes them back into it.
        </p>
      )}

      <ConsoleCard title="People" sub={`${people.filter((p) => p.active).length} can sign in to ${tenant.name}`}>
        {people.length === 0 ? (
          <Empty>{error ? "Could not read them." : "Nobody has been added to this workspace yet."}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-rule text-left text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Name</th>
                  <th className="px-3 py-2.5 font-medium">Email</th>
                  <th className="px-3 py-2.5 font-medium">Mobile</th>
                  <th className="px-3 py-2.5 font-medium">Role</th>
                  <th className="px-3 py-2.5 font-medium">Password</th>
                  <th className="px-3 py-2.5 font-medium">Added</th>
                  <th className="px-5 py-2.5 font-medium">Access</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} className="border-b border-rule/60 last:border-0">
                    <td className="px-5 py-3 font-medium">
                      {p.name}
                      {!p.active && (
                        <span className="ml-2">
                          <ConsolePill tone="turmeric">removed</ConsolePill>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">{p.email}</td>
                    <td className="px-3 py-3 font-mono text-xs text-muted">{p.phone ?? "—"}</td>
                    <td className="px-3 py-3">
                      {p.active ? (
                        <UserRoleForm tenantId={id} userId={p.id} role={p.role} roles={roles} />
                      ) : (
                        <span className="text-muted">{ROLE_LABELS[p.role as keyof typeof ROLE_LABELS] ?? p.role}</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {p.active ? (
                        <WorkspacePasswordForm
                          tenantId={id}
                          userId={p.id}
                          email={p.email}
                          hasPassword={Boolean(p.passwordHash)}
                          isOwner={viewer.canManage}
                        />
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <WhenText at={p.createdAt} />
                    </td>
                    <td className="px-5 py-3">
                      <UserAccessForm tenantId={id} userId={p.id} email={p.email} active={p.active} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ConsoleCard>

      <div className="mt-6">
        <ConsoleCard
          title="Add somebody"
          sub="They sign in with the Google account for this address, or with a password they set from a one-time link. Nothing is emailed from here."
        >
          <InviteUserForm tenantId={id} roles={roles} />
        </ConsoleCard>
      </div>
    </>
  );
}

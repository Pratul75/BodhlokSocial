import { ownerSql } from "@bodh/db";
import { platformAudit, requireOperator } from "@/lib/platform-auth";
import { ConsoleShell } from "../shell";
import { ConsoleCard, ConsolePill, Empty, WhenText } from "../ui";
import { DeactivateOperatorForm, OperatorForm, ResetLinkForm } from "../forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operators" };

interface OperatorRow {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  created_at: Date;
  last_seen_at: Date | null;
  password_set_at: Date | null;
}

/** Who can run the platform, and who is inside a customer's workspace right now. */
export default async function OperatorsPage() {
  const op = await requireOperator();
  const sql = ownerSql();

  const operators = (await sql<OperatorRow[]>`
    select id, email, name, role, active, created_at, last_seen_at, password_set_at
    from platform.platform_operators order by active desc, email`) as unknown as OperatorRow[];

  const looks = (await sql<
    { operator: string; workspace: string; user_email: string; reason: string; expires_at: Date }[]
  >`
    select o.email as operator, t.slug as workspace, i.user_email, i.reason, i.expires_at
    from platform.impersonations i
    join platform.platform_operators o on o.id = i.operator_id
    join platform.tenants t on t.id = i.tenant_id
    where i.ended_at is null and i.expires_at > now()
    order by i.created_at desc`) as unknown as {
    operator: string;
    workspace: string;
    user_email: string;
    reason: string;
    expires_at: Date;
  }[];

  await platformAudit({ actor: op.email, action: "view_operators", target: "console" });

  return (
    <ConsoleShell
      operator={op}
      title="Operators"
      crumbs={[{ label: "Operators" }]}
      description="The people who can sign in to this console. A workspace admin is never one of them."
    >
      <ConsoleCard title="People" sub={`${operators.filter((o) => o.active).length} with access`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-rule text-left text-xs tracking-wide text-muted uppercase">
              <tr>
                <th className="px-5 py-2.5 font-medium">Email</th>
                <th className="px-3 py-2.5 font-medium">Name</th>
                <th className="px-3 py-2.5 font-medium">Role</th>
                <th className="px-3 py-2.5 font-medium">Password</th>
                <th className="px-3 py-2.5 font-medium">Last seen</th>
                <th className="px-5 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {operators.map((o) => (
                <tr key={o.id} className="border-b border-rule/60 last:border-0">
                  <td className="px-5 py-3 font-medium">
                    {o.email}
                    {!o.active && (
                      <span className="ml-2">
                        <ConsolePill tone="turmeric">removed</ConsolePill>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">{o.name}</td>
                  <td className="px-3 py-3 capitalize">{o.role}</td>
                  <td className="px-3 py-3">
                    {o.password_set_at ? (
                      <ConsolePill tone="leaf">set</ConsolePill>
                    ) : (
                      <ConsolePill tone="turmeric">not set</ConsolePill>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <WhenText at={o.last_seen_at} />
                  </td>
                  <td className="space-y-1 px-5 py-3 text-right">
                    {o.active && op.role === "owner" && <ResetLinkForm id={o.id} email={o.email} />}
                    {o.active && op.role === "owner" && o.id !== op.id && (
                      <DeactivateOperatorForm id={o.id} email={o.email} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {op.role === "owner" ? (
          <div className="border-t border-rule px-5 pb-5">
            <OperatorForm />
          </div>
        ) : (
          <p className="border-t border-rule px-5 py-4 text-sm text-muted">
            Only an owner can add or remove operators, or issue a password link.
          </p>
        )}
      </ConsoleCard>

      <div className="mt-6">
        <ConsoleCard
          title="Inside a workspace right now"
          sub="Every one is read-only: the workspace is opened through a database role that was never granted the right to change anything."
        >
          {looks.length === 0 ? (
            <Empty>Nobody is looking inside a workspace.</Empty>
          ) : (
            <ul className="divide-y divide-rule text-sm">
              {looks.map((l, i) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3">
                  <span>
                    <span className="font-medium">{l.operator}</span> in{" "}
                    <span className="font-medium">{l.workspace}</span> as {l.user_email} — {l.reason}
                  </span>
                  <span className="text-xs text-muted">
                    until <WhenText at={l.expires_at} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ConsoleCard>
      </div>
    </ConsoleShell>
  );
}

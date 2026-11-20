import { auditLog, db, ownerSql, withTenant } from "@bodh/db";
import { desc } from "drizzle-orm";
import { platformAudit, requireOperator } from "@/lib/platform-auth";
import { ConsoleCard, ConsolePill, Empty, WhenText } from "../../../ui";
import { ImpersonateForm } from "../../../forms";
import { loadWorkspace } from "../workspace";

export const dynamic = "force-dynamic";

/**
 * How this workspace is kept apart from the others, and who has been inside it.
 *
 * The isolation is not a claim this page makes: it names the schema and the two roles, and the
 * read-only one is what an operator is bound through when they look inside.
 */
export default async function WorkspaceSecurity({ params }: { params: Promise<{ id: string }> }) {
  const op = await requireOperator();
  const { id } = await params;
  const { tenant } = await loadWorkspace(id);
  await platformAudit({ actor: op.email, action: "view_tenant_security", target: tenant.slug, tenantId: id });

  const sql = ownerSql();
  const looks = (await sql<
    { operator: string; user_email: string; reason: string; expires_at: Date; ended_at: Date | null; created_at: Date }[]
  >`
    select o.email as operator, i.user_email, i.reason, i.expires_at, i.ended_at, i.created_at
    from platform.impersonations i
    join platform.platform_operators o on o.id = i.operator_id
    where i.tenant_id = ${id}
    order by i.created_at desc limit 10`) as unknown as {
    operator: string;
    user_email: string;
    reason: string;
    expires_at: Date;
    ended_at: Date | null;
    created_at: Date;
  }[];

  const roles = (await sql<{ rolname: string; can_write: boolean }[]>`
    select r.rolname,
           exists (
             select 1 from information_schema.role_table_grants g
             where g.grantee = r.rolname and g.table_schema = ${tenant.dataSchema}
               and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
           ) as can_write
    from pg_roles r
    where r.rolname in (${tenant.dbRole ?? ""}, ${tenant.dbRole ? `${tenant.dbRole}_ro` : ""})
    order by r.rolname`) as unknown as { rolname: string; can_write: boolean }[];

  let recent: { id: string; actor: string; action: string; target: string | null; createdAt: Date }[] = [];
  let error: string | null = null;
  try {
    recent = await withTenant({ ...tenant, readOnly: true }, () =>
      db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(12),
    );
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 160) : "Could not read this workspace's audit log.";
  }

  const live = looks.find((l) => !l.ended_at && new Date(l.expires_at).getTime() > Date.now());

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <ConsoleCard title="Isolation" sub="What keeps this workspace's data its own">
          <dl className="divide-y divide-rule text-sm">
            <div className="flex items-center justify-between px-5 py-3">
              <dt className="text-muted">Schema</dt>
              <dd className="font-mono">{tenant.dataSchema}</dd>
            </div>
            {roles.map((r) => (
              <div key={r.rolname} className="flex items-center justify-between gap-3 px-5 py-3">
                <dt className="font-mono text-xs">{r.rolname}</dt>
                <dd>
                  {r.can_write ? (
                    <ConsolePill tone="dusk">reads and writes</ConsolePill>
                  ) : (
                    <ConsolePill tone="leaf">read-only</ConsolePill>
                  )}
                </dd>
              </div>
            ))}
            {roles.length === 0 && (
              <div className="px-5 py-3 text-sm text-sindoor">
                This workspace has no database role of its own yet.
              </div>
            )}
          </dl>
          <p className="border-t border-rule px-5 py-3 text-xs text-muted">
            A role is granted its own schema and nothing else, so a query naming another
            workspace&apos;s table is refused by Postgres rather than by the application.
          </p>
        </ConsoleCard>

        <ConsoleCard
          title="Look inside"
          sub="Opens this workspace as one of its own admins, for a while, read-only. Recorded before it starts; it ends by itself."
        >
          {live ? (
            <div className="px-5 py-4 text-sm">
              <p>
                <span className="font-medium">{live.operator}</span> is inside as {live.user_email} until{" "}
                <WhenText at={live.expires_at} />.
              </p>
              <p className="mt-1 text-muted">{live.reason}</p>
            </div>
          ) : (
            <div className="px-5 py-4">
              <ImpersonateForm tenantId={id} tenantName={tenant.name} />
            </div>
          )}
        </ConsoleCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ConsoleCard title="Who has looked inside" sub="The last ten, whether they finished or expired">
          {looks.length === 0 ? (
            <Empty>Nobody has opened this workspace from the console.</Empty>
          ) : (
            <ul className="divide-y divide-rule text-sm">
              {looks.map((l, i) => (
                <li key={i} className="px-5 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{l.operator}</span>
                    <WhenText at={l.created_at} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    as {l.user_email} · {l.ended_at ? "ended" : new Date(l.expires_at).getTime() > Date.now() ? "open" : "expired"} ·{" "}
                    {l.reason}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </ConsoleCard>

        <ConsoleCard title="This workspace's own audit log" sub="What its people and agents did, newest first">
          {error ? (
            <Empty>{error}</Empty>
          ) : recent.length === 0 ? (
            <Empty>Nothing recorded yet.</Empty>
          ) : (
            <ul className="divide-y divide-rule text-sm">
              {recent.map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-3 px-5 py-2.5">
                  <span className="min-w-0">
                    <span className="font-medium">{a.actor}</span>{" "}
                    <span className="font-mono text-xs text-muted">{a.action}</span>{" "}
                    <span className="text-muted">{a.target}</span>
                  </span>
                  <WhenText at={a.createdAt} />
                </li>
              ))}
            </ul>
          )}
        </ConsoleCard>
      </div>
    </>
  );
}

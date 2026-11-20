import Link from "next/link";
import { ownerSql } from "@bodh/db";
import { platformAudit, requireOperator } from "@/lib/platform-auth";
import { ConsoleShell } from "../shell";
import { ConsoleCard, Empty, WhenText } from "../ui";
import { AuditFilters } from "./filters";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log" };

interface Row {
  id: string;
  actor: string;
  action: string;
  target: string | null;
  tenant_id: string | null;
  slug: string | null;
  detail: Record<string, unknown> | null;
  created_at: Date;
}

const PAGE = 100;

/**
 * Everything operators have done, with a filter per field.
 *
 * Reads of a workspace are in here as well as changes to one: "who looked at my data?" is the
 * question this log exists to answer, and a log that only recorded writes could not.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string; action?: string; workspace?: string; page?: string }>;
}) {
  const op = await requireOperator();
  const { actor = "", action = "", workspace = "", page = "1" } = await searchParams;
  const offset = Math.max(0, (Number(page) || 1) - 1) * PAGE;

  const sql = ownerSql();
  const rows = (await sql<Row[]>`
    select a.id, a.actor, a.action, a.target, a.tenant_id, t.slug, a.detail, a.created_at
    from platform.platform_audit a
    left join platform.tenants t on t.id = a.tenant_id
    where (${actor} = '' or a.actor = ${actor})
      and (${action} = '' or a.action = ${action})
      and (${workspace} = '' or t.slug = ${workspace})
    order by a.created_at desc
    limit ${PAGE + 1} offset ${offset}`) as unknown as Row[];

  const more = rows.length > PAGE;
  const shown = rows.slice(0, PAGE);

  const [actors, actions, workspaces] = (await Promise.all([
    sql`select distinct actor from platform.platform_audit order by actor`,
    sql`select distinct action from platform.platform_audit order by action`,
    sql`select slug from platform.tenants order by slug`,
  ])) as unknown as [{ actor: string }[], { action: string }[], { slug: string }[]];

  await platformAudit({ actor: op.email, action: "view_audit", target: "console" });

  const href = (p: number) => {
    const q = new URLSearchParams();
    if (actor) q.set("actor", actor);
    if (action) q.set("action", action);
    if (workspace) q.set("workspace", workspace);
    if (p > 1) q.set("page", String(p));
    return `/super-admin/audit${q.toString() ? `?${q}` : ""}`;
  };
  const current = Number(page) || 1;

  return (
    <ConsoleShell
      operator={op}
      title="Audit log"
      crumbs={[{ label: "Audit log" }]}
      description="Every platform action, newest first. Opening a workspace is recorded as well as changing one."
    >
      <AuditFilters
        actor={actor}
        action={action}
        workspace={workspace}
        actors={actors.map((a) => a.actor)}
        actions={actions.map((a) => a.action)}
        workspaces={workspaces.map((w) => w.slug)}
      />

      <div className="mt-4">
        <ConsoleCard>
          {shown.length === 0 ? (
            <Empty>Nothing matches that.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="border-b border-rule text-left text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">When</th>
                    <th className="px-3 py-2.5 font-medium">Who</th>
                    <th className="px-3 py-2.5 font-medium">Did</th>
                    <th className="px-3 py-2.5 font-medium">To</th>
                    <th className="px-5 py-2.5 font-medium">Workspace</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} className="border-b border-rule/60 last:border-0">
                      <td className="px-5 py-2.5 whitespace-nowrap">
                        <WhenText at={r.created_at} />
                      </td>
                      <td className="px-3 py-2.5">{r.actor}</td>
                      <td className="px-3 py-2.5 font-mono text-xs">{r.action}</td>
                      <td className="max-w-xs px-3 py-2.5 break-words">
                        {r.target}
                        {r.detail && Object.keys(r.detail).length > 0 && (
                          <span className="mt-0.5 block text-xs text-muted">
                            {Object.entries(r.detail)
                              .map(([k, v]) => `${k}: ${String(v)}`)
                              .join(" · ")}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-2.5">
                        {r.slug && r.tenant_id ? (
                          <Link href={`/super-admin/workspaces/${r.tenant_id}`} className="text-dusk hover:underline">
                            {r.slug}
                          </Link>
                        ) : (
                          <span className="text-muted">—</span>
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

      {(current > 1 || more) && (
        <div className="mt-4 flex items-center justify-between text-sm">
          {current > 1 ? (
            <Link href={href(current - 1)} className="text-dusk hover:underline">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">Page {current}</span>
          {more ? (
            <Link href={href(current + 1)} className="text-dusk hover:underline">
              Older →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </ConsoleShell>
  );
}

import Link from "next/link";
import { entitlementsFor, ownerSql } from "@bodh/db";
import { FEATURE_KEYS, MODULES } from "@bodh/shared";
import { platformAudit, requireOperator } from "@/lib/platform-auth";
import { allWorkspaceStats } from "@/lib/platform-stats";
import { ConsoleCard, Empty, Money, StatTile, WhenText } from "../../ui";
import { loadWorkspace } from "./workspace";

export const dynamic = "force-dynamic";

/** What this workspace is, in numbers, with the two or three things worth doing next. */
export default async function WorkspaceOverview({ params }: { params: Promise<{ id: string }> }) {
  const op = await requireOperator();
  const { id } = await params;
  const { tenant, plan, createdAt } = await loadWorkspace(id);
  await platformAudit({ actor: op.email, action: "view_tenant", target: tenant.slug, tenantId: tenant.id });

  const stats = (await allWorkspaceStats()).find((s) => s.tenant.id === id);
  const ent = await entitlementsFor(id);

  const audit = (await ownerSql()<{ id: string; actor: string; action: string; target: string | null; created_at: Date }[]>`
    select id, actor, action, target, created_at from platform.platform_audit
    where tenant_id = ${id} order by created_at desc limit 6`) as unknown as {
    id: string;
    actor: string;
    action: string;
    target: string | null;
    created_at: Date;
  }[];

  const modulesOff = MODULES.filter((m) => !ent.modules.has(m.key));
  const featuresOff = FEATURE_KEYS.filter((f) => !ent.features.has(f));

  return (
    <>
      {stats?.error && (
        <p className="mb-4 rounded-lg bg-sindoor-soft px-4 py-3 text-sm text-sindoor">
          This workspace could not be read: {stats.error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="People" value={stats?.people ?? 0} sub="can sign in" />
        <StatTile label="Waiting for approval" value={stats?.pendingApprovals ?? 0} sub="posts, pages, ad changes" />
        <StatTile label="Agent runs" value={stats?.runs30d ?? 0} sub="last 30 days" />
        <StatTile label="AI spend" value={<Money usd={stats?.aiSpend30d ?? 0} />} sub="last 30 days" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ConsoleCard title="Access" sub="What this workspace may use">
          <dl className="divide-y divide-rule text-sm">
            <div className="flex items-center justify-between px-5 py-3">
              <dt className="text-muted">Modules</dt>
              <dd className="tabular">
                {stats?.modulesOn ?? 0} of {MODULES.length} on
              </dd>
            </div>
            <div className="flex items-center justify-between px-5 py-3">
              <dt className="text-muted">Features</dt>
              <dd className="tabular">
                {stats?.featuresOn ?? 0} of {FEATURE_KEYS.length} on
              </dd>
            </div>
            <div className="flex items-start justify-between gap-4 px-5 py-3">
              <dt className="text-muted">Switched off</dt>
              <dd className="text-right">
                {modulesOff.length === 0 && featuresOff.length === 0 ? (
                  <span className="text-muted">nothing</span>
                ) : (
                  <span>
                    {modulesOff.map((m) => m.label).join(", ")}
                    {modulesOff.length > 0 && featuresOff.length > 0 && " · "}
                    {featuresOff.length > 0 && `${featuresOff.length} features`}
                  </span>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between px-5 py-3">
              <dt className="text-muted">Plan</dt>
              <dd className="capitalize">{plan}</dd>
            </div>
          </dl>
        </ConsoleCard>

        <ConsoleCard title="Where it lives" sub="The parts that make this workspace its own">
          <dl className="divide-y divide-rule text-sm">
            <div className="flex items-center justify-between px-5 py-3">
              <dt className="text-muted">Address</dt>
              <dd className="font-mono">/t/{tenant.slug}</dd>
            </div>
            <div className="flex items-center justify-between px-5 py-3">
              <dt className="text-muted">Schema</dt>
              <dd className="font-mono">{tenant.dataSchema}</dd>
            </div>
            <div className="flex items-center justify-between px-5 py-3">
              <dt className="text-muted">Database role</dt>
              <dd className="font-mono">{tenant.dbRole ?? "shared"}</dd>
            </div>
            <div className="flex items-center justify-between px-5 py-3">
              <dt className="text-muted">Read-only role</dt>
              <dd className="font-mono">{tenant.dbRole ? `${tenant.dbRole}_ro` : "—"}</dd>
            </div>
            <div className="flex items-center justify-between px-5 py-3">
              <dt className="text-muted">Created</dt>
              <dd>
                <WhenText at={createdAt} />
              </dd>
            </div>
            <div className="flex items-center justify-between px-5 py-3">
              <dt className="text-muted">Last activity</dt>
              <dd>
                <WhenText at={stats?.lastActivity ?? null} />
              </dd>
            </div>
          </dl>
        </ConsoleCard>
      </div>

      <div className="mt-4">
        <ConsoleCard
          title="Recent platform activity here"
          aside={
            <Link href="/super-admin/audit" className="text-xs text-dusk hover:underline">
              Full audit log
            </Link>
          }
        >
          {audit.length === 0 ? (
            <Empty>Nothing has been done to this workspace from the console yet.</Empty>
          ) : (
            <ul className="divide-y divide-rule">
              {audit.map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-3 px-5 py-2.5 text-sm">
                  <span>
                    <span className="font-medium">{a.actor}</span> <span className="font-mono text-xs text-muted">{a.action}</span>{" "}
                    <span className="text-muted">{a.target}</span>
                  </span>
                  <WhenText at={a.created_at} />
                </li>
              ))}
            </ul>
          )}
        </ConsoleCard>
      </div>
    </>
  );
}

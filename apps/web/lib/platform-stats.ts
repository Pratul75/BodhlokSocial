import "server-only";
import { and, count, eq, gte, sql as dsql } from "drizzle-orm";
import {
  agentRuns,
  approvals,
  auditLog,
  calendarItems,
  db,
  entitlementsFor,
  listTenants,
  ownerSql,
  users,
  withTenant,
  type TenantRef,
} from "@bodh/db";
import { FEATURE_KEYS, MODULES } from "@bodh/shared";

/**
 * The numbers the console shows.
 *
 * Every figure is read from the workspace it belongs to, through that workspace's **read-only**
 * role — the same binding an operator gets when they look inside one. The control plane holds
 * no copy of a workspace's row counts, and keeping one would only give the console something
 * else that can be wrong.
 */
export interface WorkspaceStats {
  tenant: TenantRef;
  plan: string;
  people: number;
  pendingApprovals: number;
  runs30d: number;
  aiSpend30d: number;
  scheduled: number;
  lastActivity: Date | null;
  modulesOn: number;
  modulesTotal: number;
  featuresOn: number;
  featuresTotal: number;
  /** Set when the workspace could not be read; the page says so rather than showing zeros. */
  error?: string;
}

const since = (days: number) => new Date(Date.now() - days * 86_400_000);

async function statsFor(tenant: TenantRef, plan: string): Promise<WorkspaceStats> {
  const ent = await entitlementsFor(tenant.id);
  const base = {
    tenant,
    plan,
    modulesOn: MODULES.filter((m) => ent.modules.has(m.key)).length,
    modulesTotal: MODULES.length,
    featuresOn: FEATURE_KEYS.filter((f) => ent.features.has(f)).length,
    featuresTotal: FEATURE_KEYS.length,
  };

  if (!tenant.dbRole) {
    return { ...base, people: 0, pendingApprovals: 0, runs30d: 0, aiSpend30d: 0, scheduled: 0, lastActivity: null, error: "No database role yet" };
  }

  try {
    return await withTenant({ ...tenant, readOnly: true }, async () => {
      const [[people], [pending], [runs], [scheduled], [last]] = await Promise.all([
        db.select({ n: count() }).from(users).where(eq(users.active, true)),
        db.select({ n: count() }).from(approvals).where(eq(approvals.status, "pending")),
        db
          .select({ n: count(), usd: dsql<number>`coalesce(sum(${agentRuns.costUsd}), 0)::float` })
          .from(agentRuns)
          .where(gte(agentRuns.startedAt, since(30))),
        db
          .select({ n: count() })
          .from(calendarItems)
          .where(and(eq(calendarItems.status, "approved"), gte(calendarItems.scheduledAt, new Date()))),
        db.select({ at: dsql<Date | null>`max(${auditLog.createdAt})` }).from(auditLog),
      ]);
      return {
        ...base,
        people: people?.n ?? 0,
        pendingApprovals: pending?.n ?? 0,
        runs30d: runs?.n ?? 0,
        aiSpend30d: runs?.usd ?? 0,
        scheduled: scheduled?.n ?? 0,
        lastActivity: last?.at ? new Date(last.at) : null,
      };
    });
  } catch (e) {
    return {
      ...base,
      people: 0,
      pendingApprovals: 0,
      runs30d: 0,
      aiSpend30d: 0,
      scheduled: 0,
      lastActivity: null,
      error: e instanceof Error ? e.message.slice(0, 120) : "Could not read this workspace",
    };
  }
}

/** Every workspace with its own numbers. One workspace failing does not lose the others. */
export async function allWorkspaceStats(): Promise<WorkspaceStats[]> {
  const tenants = await listTenants();
  const plans = (await ownerSql()<{ id: string; plan: string }[]>`
    select id, plan from platform.tenants`) as unknown as { id: string; plan: string }[];
  const planOf = new Map(plans.map((p) => [p.id, p.plan]));
  const out: WorkspaceStats[] = [];
  for (const t of tenants) out.push(await statsFor(t, planOf.get(t.id) ?? "full"));
  return out.sort((a, b) => a.tenant.name.localeCompare(b.tenant.name));
}

export interface PlatformTotals {
  workspaces: number;
  active: number;
  suspended: number;
  people: number;
  pendingApprovals: number;
  runs30d: number;
  aiSpend30d: number;
  operators: number;
  openLooks: number;
  auditToday: number;
}

export async function platformTotals(stats: WorkspaceStats[]): Promise<PlatformTotals> {
  const rows = (await ownerSql()<{ operators: string; looks: string; audit_today: string }[]>`
    select
      (select count(*)::text from platform.platform_operators where active = true) as operators,
      (select count(*)::text from platform.impersonations where ended_at is null and expires_at > now()) as looks,
      (select count(*)::text from platform.platform_audit where created_at >= date_trunc('day', now())) as audit_today
  `) as unknown as { operators: string; looks: string; audit_today: string }[];
  const r = rows[0] ?? { operators: "0", looks: "0", audit_today: "0" };
  return {
    workspaces: stats.length,
    active: stats.filter((s) => s.tenant.status === "active").length,
    suspended: stats.filter((s) => s.tenant.status === "suspended").length,
    people: stats.reduce((n, s) => n + s.people, 0),
    pendingApprovals: stats.reduce((n, s) => n + s.pendingApprovals, 0),
    runs30d: stats.reduce((n, s) => n + s.runs30d, 0),
    aiSpend30d: stats.reduce((n, s) => n + s.aiSpend30d, 0),
    operators: Number(r.operators),
    openLooks: Number(r.looks),
    auditToday: Number(r.audit_today),
  };
}

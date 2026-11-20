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
import { capacity, FEATURE_KEYS, MODULES } from "@bodh/shared";

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
  /**
   * Tokens over the same thirty days. Input counts what was read from cache and written to it
   * as well, because that is what the model was charged for and what `agent_runs` records.
   */
  tokensIn30d: number;
  tokensOut30d: number;
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
    return { ...base, people: 0, pendingApprovals: 0, runs30d: 0, aiSpend30d: 0, tokensIn30d: 0, tokensOut30d: 0, scheduled: 0, lastActivity: null, error: "No database role yet" };
  }

  try {
    return await withTenant({ ...tenant, readOnly: true }, async () => {
      const [[people], [pending], [runs], [scheduled], [last]] = await Promise.all([
        db.select({ n: count() }).from(users).where(eq(users.active, true)),
        db.select({ n: count() }).from(approvals).where(eq(approvals.status, "pending")),
        db
          .select({
            n: count(),
            usd: dsql<number>`coalesce(sum(${agentRuns.costUsd}), 0)::float`,
            tin: dsql<number>`coalesce(sum(${agentRuns.tokensIn}), 0)::bigint`,
            tout: dsql<number>`coalesce(sum(${agentRuns.tokensOut}), 0)::bigint`,
          })
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
        // bigint comes back as a string from postgres-js; Number() is safe well past any
        // plausible token count.
        tokensIn30d: Number(runs?.tin ?? 0),
        tokensOut30d: Number(runs?.tout ?? 0),
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
      tokensIn30d: 0,
      tokensOut30d: 0,
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
  tokens30d: number;
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
    tokens30d: stats.reduce((n, s) => n + s.tokensIn30d + s.tokensOut30d, 0),
    operators: Number(r.operators),
    openLooks: Number(r.looks),
    auditToday: Number(r.audit_today),
  };
}

/* -------------------------------------------------------------------------- */
/* Token use, per workspace                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Which window the console is asking about.
 *
 * "month" is the calendar month in India time — deliberately the same boundary
 * `spentThisMonthUsd` uses to enforce the budget, so a workspace's tokens and its budget are
 * never measured over two different months.
 */
export type UsageWindow = "month" | "30d" | "7d";

export const USAGE_WINDOWS: { key: UsageWindow; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "30d", label: "Last 30 days" },
  { key: "7d", label: "Last 7 days" },
];

export const isUsageWindow = (v: string | undefined): v is UsageWindow =>
  v === "month" || v === "30d" || v === "7d";

const windowStart = (w: UsageWindow) =>
  w === "month"
    ? dsql`date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`
    : w === "30d"
      ? dsql`now() - interval '30 days'`
      : dsql`now() - interval '7 days'`;

export interface AgentTokens {
  agent: string;
  runs: number;
  tokensIn: number;
  tokensOut: number;
  usd: number;
}

export interface WorkspaceTokens {
  tenant: TenantRef;
  plan: string;
  runs: number;
  tokensIn: number;
  tokensOut: number;
  tokens: number;
  usd: number;
  /** This workspace's own monthly ceiling, for the month window. */
  budgetUsd: number;
  byAgent: AgentTokens[];
  error?: string;
}

/**
 * What every workspace has spent its tokens on, read from each workspace itself.
 *
 * `agent_runs` is the whole ledger: agents, chat and AI-visibility checks all write a row there,
 * which is why the monthly budget can be enforced from it. So counting tokens is counting that
 * table — there is no second place AI usage hides.
 *
 * Each workspace is read through its own read-only role, one at a time, and a workspace that
 * cannot be read says so instead of reporting zero. A zero and a failure look identical on a
 * usage page, and only one of them means the workspace is idle.
 */
export async function tokenUseByWorkspace(window: UsageWindow): Promise<WorkspaceTokens[]> {
  const tenants = await listTenants();
  const plans = (await ownerSql()<{ id: string; plan: string }[]>`
    select id, plan from platform.tenants`) as unknown as { id: string; plan: string }[];
  const planOf = new Map(plans.map((p) => [p.id, p.plan]));
  const start = windowStart(window);

  const out: WorkspaceTokens[] = [];
  for (const tenant of tenants) {
    const ent = await entitlementsFor(tenant.id);
    const base = {
      tenant,
      plan: planOf.get(tenant.id) ?? "full",
      budgetUsd: capacity(ent, "ai.monthly_budget_usd"),
    };
    if (!tenant.dbRole) {
      out.push({ ...base, runs: 0, tokensIn: 0, tokensOut: 0, tokens: 0, usd: 0, byAgent: [], error: "No database role yet" });
      continue;
    }
    try {
      const byAgent = await withTenant({ ...tenant, readOnly: true }, async () =>
        db
          .select({
            agent: agentRuns.agent,
            runs: count(),
            tokensIn: dsql<string>`coalesce(sum(${agentRuns.tokensIn}), 0)::bigint`,
            tokensOut: dsql<string>`coalesce(sum(${agentRuns.tokensOut}), 0)::bigint`,
            usd: dsql<number>`coalesce(sum(${agentRuns.costUsd}), 0)::float`,
          })
          .from(agentRuns)
          .where(dsql`${agentRuns.startedAt} >= ${start}`)
          .groupBy(agentRuns.agent)
          .orderBy(dsql`sum(${agentRuns.tokensIn} + ${agentRuns.tokensOut}) desc`),
      );
      const rows: AgentTokens[] = byAgent.map((r) => ({
        agent: r.agent,
        runs: r.runs,
        tokensIn: Number(r.tokensIn),
        tokensOut: Number(r.tokensOut),
        usd: r.usd ?? 0,
      }));
      const tokensIn = rows.reduce((n, r) => n + r.tokensIn, 0);
      const tokensOut = rows.reduce((n, r) => n + r.tokensOut, 0);
      out.push({
        ...base,
        runs: rows.reduce((n, r) => n + r.runs, 0),
        tokensIn,
        tokensOut,
        tokens: tokensIn + tokensOut,
        usd: rows.reduce((n, r) => n + r.usd, 0),
        byAgent: rows,
      });
    } catch (e) {
      out.push({
        ...base,
        runs: 0,
        tokensIn: 0,
        tokensOut: 0,
        tokens: 0,
        usd: 0,
        byAgent: [],
        error: e instanceof Error ? e.message.slice(0, 120) : "Could not read this workspace",
      });
    }
  }
  // Heaviest first: the whole point of the page is which workspace is using the most.
  return out.sort((a, b) => b.tokens - a.tokens || a.tenant.name.localeCompare(b.tenant.name));
}

import { agentRuns, calendarItems, db, entitlementsFor, withTenant } from "@bodh/db";
import { CAPACITY_DEFAULTS, CAPACITY_ENV, CAPACITY_KEYS, capacity, type CapacityKey } from "@bodh/shared";
import { count, gte, sql as dsql } from "drizzle-orm";
import { platformAudit, requireOperator } from "@/lib/platform-auth";
import { allWorkspaceStats } from "@/lib/platform-stats";
import { ConsoleCard, Empty, Money, StatTile } from "../../../ui";
import { CapacityForm } from "../../../workspace-forms";
import { loadWorkspace } from "../workspace";

export const dynamic = "force-dynamic";

const LABELS: Record<CapacityKey, string> = {
  "ai.monthly_budget_usd": "Monthly AI budget (USD)",
  "ai.run_cap_usd": "Most one agent run may spend (USD)",
  "creative.monthly_images": "Images a month",
  "creative.monthly_videos": "Videos a month",
  "publishing.postiz_hourly": "Posts an hour through Postiz",
  "seo.audit_max_pages": "Pages a site audit may crawl",
};

const HINTS: Partial<Record<CapacityKey, string>> = {
  "ai.monthly_budget_usd": "Agents, chat and AI-visibility checks all draw on this.",
  "ai.run_cap_usd": "A single run stops here even if the month has budget left.",
};

/** What this workspace has used, and the limits it may not exceed. */
export default async function WorkspaceUsage({ params }: { params: Promise<{ id: string }> }) {
  const op = await requireOperator();
  const { id } = await params;
  const { tenant } = await loadWorkspace(id);
  await platformAudit({ actor: op.email, action: "view_tenant_usage", target: tenant.slug, tenantId: id });

  const ent = await entitlementsFor(id);
  const stats = (await allWorkspaceStats()).find((s) => s.tenant.id === id);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  let byAgent: { agent: string; runs: number; usd: number }[] = [];
  let published = 0;
  let error: string | null = null;
  try {
    await withTenant({ ...tenant, readOnly: true }, async () => {
      byAgent = await db
        .select({
          agent: agentRuns.agent,
          runs: count(),
          usd: dsql<number>`coalesce(sum(${agentRuns.costUsd}), 0)::float`,
        })
        .from(agentRuns)
        .where(gte(agentRuns.startedAt, monthStart))
        .groupBy(agentRuns.agent)
        .orderBy(dsql`sum(${agentRuns.costUsd}) desc`);
      const [p] = await db
        .select({ n: count() })
        .from(calendarItems)
        .where(gte(calendarItems.publishedAt, monthStart));
      published = p?.n ?? 0;
    });
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 160) : "Could not read this workspace's usage.";
  }

  const spentThisMonth = byAgent.reduce((n, r) => n + (r.usd ?? 0), 0);
  const budget = capacity(ent, "ai.monthly_budget_usd");

  return (
    <>
      {error && <p className="mb-4 rounded-lg bg-sindoor-soft px-4 py-3 text-sm text-sindoor">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="AI this month"
          value={<Money usd={spentThisMonth} />}
          sub={`of $${budget} budget`}
          tone={spentThisMonth > budget * 0.8 ? "turmeric" : "neutral"}
        />
        <StatTile label="Agent runs (30d)" value={stats?.runs30d ?? 0} sub="every agent and chat" />
        <StatTile label="Published this month" value={published} sub="calendar items" />
        <StatTile label="Scheduled ahead" value={stats?.scheduled ?? 0} sub="approved and waiting" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ConsoleCard title="AI spend by agent" sub="This calendar month, India time">
          {byAgent.length === 0 ? (
            <Empty>{error ? "Could not read it." : "No agent has run this month."}</Empty>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {byAgent.map((r) => (
                  <tr key={r.agent} className="border-b border-rule/60 last:border-0">
                    <td className="px-5 py-2.5 capitalize">{r.agent}</td>
                    <td className="px-3 py-2.5 text-right tabular text-muted">{r.runs} runs</td>
                    <td className="px-5 py-2.5 text-right font-mono tabular">
                      <Money usd={r.usd ?? 0} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ConsoleCard>

        <ConsoleCard
          title="Limits"
          sub="Each is this workspace's own. Leave one empty to use the server's default."
        >
          <div>
            {CAPACITY_KEYS.map((key) => {
              // Capacities live with the entitlements, not with the workspace's settings.
              const set = ent.capacities.get(key);
              const fallback = process.env[CAPACITY_ENV[key]] ?? String(CAPACITY_DEFAULTS[key]);
              return (
                <CapacityForm
                  key={key}
                  tenantId={id}
                  capacityKey={key}
                  label={LABELS[key]}
                  value={set === undefined || set === null ? "" : String(set)}
                  fallback={fallback}
                  hint={HINTS[key]}
                />
              );
            })}
          </div>
        </ConsoleCard>
      </div>
    </>
  );
}

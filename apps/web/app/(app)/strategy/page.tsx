import { desc, inArray, sql } from "drizzle-orm";
import { Check } from "lucide-react";
import { agentRuns, brandKit, db, strategyPlans } from "@bodh/db";
import { requireModule } from "@/lib/auth";
import { ago } from "@/lib/format";
import { AgentRunPanel } from "@/components/agent-run-panel";
import { Card, CardHeader, EmptyState, PageHeader, StatusPill, btn } from "@/components/ui";
import { approvePlan } from "./actions";
import { PositioningForm } from "./positioning-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Strategy" };

export default async function StrategyPage() {
  const user = await requireModule("strategy");
  const now = new Date();
  const [[kit], busyRuns] = await Promise.all([
    db.select().from(brandKit).limit(1),
    db.select({ id: agentRuns.id }).from(agentRuns).where(sql`${agentRuns.agent} in ('strategy', 'content') and ${agentRuns.status} in ('queued', 'running') and ${agentRuns.startedAt} > now() - interval '1 hour'`).limit(1),
  ]);
  const briefCard = (
    <Card className="mb-6">
      <CardHeader
        title="Positioning brief"
        sub="What every agent follows, before anything else: the plan, every post, page and ad. The launch film's positioning is built in; what you write here is current and wins where they differ. Save and re-plan rewrites this month's plan and the rest of its calendar from it."
      />
      <PositioningForm
        positioning={kit?.positioning ?? ""}
        sources={(kit?.positioningSources ?? []).join("\n")}
        updatedLabel={kit?.positioningUpdatedAt ? ago(kit.positioningUpdatedAt, now) : null}
        canEdit={user.role === "admin" || user.role === "social_manager"}
        busy={busyRuns.length > 0}
      />
    </Card>
  );
  const runPanel = (
    <AgentRunPanel
      agent="strategy"
      title="Strategy agent"
      sub="Runs on the 25th for next month. Run it now to draft or redo the plan; an approved plan is only replaced by a re-plan from the brief above."
      label="Run Strategy agent"
      placeholder="Optional: anything to focus on, e.g. the KP module for practitioners, or institutes"
    />
  );
  // The newest plan for the newest month: a re-plan's fresh draft shows over the plan it superseded.
  const [plan] = await db.select().from(strategyPlans).where(inArray(strategyPlans.status, ["draft", "approved"])).orderBy(desc(strategyPlans.month), desc(strategyPlans.createdAt)).limit(1);

  if (!plan) {
    return (
      <>
        <PageHeader title="Strategy" />
        {briefCard}
        <Card>
          <EmptyState title="No plan yet">The Strategy agent writes next month's plan on the 25th from the brief, the funnel, ads, keywords and the month's astrological events. You can also run it now.</EmptyState>
        </Card>
        <Card className="mt-6">{runPanel}</Card>
      </>
    );
  }

  const month = new Date(`${plan.month}T00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  return (
    <>
      <PageHeader
        eyebrow={<span className="flex items-center gap-2">Monthly plan <StatusPill status={plan.status} /></span>}
        title={month}
        description="Written by the Strategy agent from the positioning brief, the funnel, ads, keywords and the month's astrological events. Approve it before the Content agent plans the calendar."
        actions={
          user.role === "admin" && plan.status === "draft" ? (
            <form action={approvePlan}>
              <input type="hidden" name="id" value={plan.id} />
              <button className={btn.approve}><Check size={16} /> Approve plan</button>
            </form>
          ) : undefined
        }
      />

      {briefCard}

      <Card className="mb-6 p-5">
        <p className="max-w-3xl text-[17px] leading-relaxed">{plan.summary}</p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <Card>
          <CardHeader title="Content pillars" sub="Share of the month's posts" />
          <ul className="space-y-4 px-5 py-4">
            {plan.pillars.map((p) => (
              <li key={p.name}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">{p.name}</span>
                  <span className="font-mono tabular">{p.share}%</span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-paper">
                  <div className="h-2 rounded-full bg-dusk/70" style={{ width: `${p.share}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted">{p.why}</p>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Bets for the month" sub="Each bet has one metric and a target" />
          <ul className="divide-y divide-rule">
            {plan.bets.map((b) => (
              <li key={b.title} className="px-5 py-3.5">
                <p className="text-sm font-medium">{b.title}</p>
                <p className="mt-1 text-xs text-muted">
                  {b.metric}: <span className="font-mono text-ink tabular">{b.target}</span>
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-6">{runPanel}</Card>
    </>
  );
}

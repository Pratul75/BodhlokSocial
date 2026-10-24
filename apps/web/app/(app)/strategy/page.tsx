import { desc } from "drizzle-orm";
import { Check } from "lucide-react";
import { db, strategyPlans } from "@bodh/db";
import { requireModule } from "@/lib/auth";
import { Card, CardHeader, EmptyState, PageHeader, StatusPill, btn } from "@/components/ui";
import { approvePlan } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Strategy" };

export default async function StrategyPage() {
  const user = await requireModule("strategy");
  const [plan] = await db.select().from(strategyPlans).orderBy(desc(strategyPlans.month)).limit(1);

  if (!plan) {
    return (
      <>
        <PageHeader title="Strategy" />
        <Card>
          <EmptyState title="No plan yet">The Strategy agent writes next month's plan on the 25th from trends, competitors and this month's results.</EmptyState>
        </Card>
      </>
    );
  }

  const month = new Date(`${plan.month}T00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  return (
    <>
      <PageHeader
        eyebrow={<span className="flex items-center gap-2">Monthly plan <StatusPill status={plan.status} /></span>}
        title={month}
        description="Written by the Strategy agent from last month's funnel, trends and competitor activity. Edit or approve it before the Content agent plans the calendar."
        actions={
          user.role === "admin" && plan.status === "draft" ? (
            <form action={approvePlan}>
              <input type="hidden" name="id" value={plan.id} />
              <button className={btn.approve}><Check size={16} /> Approve plan</button>
            </form>
          ) : undefined
        }
      />

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
    </>
  );
}

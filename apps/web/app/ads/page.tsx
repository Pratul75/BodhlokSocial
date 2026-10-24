import { desc, eq } from "drizzle-orm";
import { adChanges, budgets, campaigns, db, experiments } from "@bodh/db";
import { AUTO_BID_LIMIT } from "@bodh/guardrails";
import { CHANNEL_LABELS, type Channel } from "@bodh/shared";
import { requireModule } from "@/lib/auth";
import { ago, inr, num } from "@/lib/format";
import { Meter } from "@/components/charts";
import { Card, CardHeader, PageHeader, Pill, StatusPill, Table } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ads manager" };

export default async function AdsPage() {
  await requireModule("ads");
  const [caps, camps, tests, log] = await Promise.all([
    db.select().from(budgets),
    db.select().from(campaigns).orderBy(campaigns.platform, desc(campaigns.activations7d)),
    db.select().from(experiments).orderBy(desc(experiments.startedAt)),
    db
      .select({ c: adChanges, campaign: campaigns.name })
      .from(adChanges)
      .leftJoin(campaigns, eq(campaigns.id, adChanges.campaignId))
      .orderBy(desc(adChanges.createdAt))
      .limit(12),
  ]);
  const now = new Date();
  const totalSpend = camps.reduce((s, c) => s + c.spend7d, 0);
  const totalAct = camps.reduce((s, c) => s + c.activations7d, 0);
  const accountCpa = totalAct ? totalSpend / totalAct : 0;

  return (
    <>
      <PageHeader
        title="Ads manager"
        description={`The Ads agent can pause losing ads and move bids within ±${AUTO_BID_LIMIT * 100}% on its own. New campaigns and budget increases go to Approvals. Caps are set in Admin.`}
      />

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {caps.map((b) => (
          <Card key={b.platform} className="p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-[16px] font-semibold tracking-tight">{CHANNEL_LABELS[b.platform as Channel]}</h2>
              <span className="text-xs text-muted">Caps set by {b.updatedBy}</span>
            </div>
            <div className="mt-4 space-y-4 text-sm">
              <div>
                <div className="mb-1.5 flex justify-between">
                  <span className="text-muted">Today</span>
                  <span className="font-mono tabular">
                    {inr(b.spentToday)} <span className="text-muted">of {inr(b.dailyCap)}</span>
                  </span>
                </div>
                <Meter value={b.spentToday} max={b.dailyCap} />
              </div>
              <div>
                <div className="mb-1.5 flex justify-between">
                  <span className="text-muted">This month</span>
                  <span className="font-mono tabular">
                    {inr(b.spentThisMonth)} <span className="text-muted">of {inr(b.monthlyCap)}</span>
                  </span>
                </div>
                <Meter value={b.spentThisMonth} max={b.monthlyCap} />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="mb-6">
        <CardHeader title="Campaigns" sub={`Last 7 days. Account average: ${inr(accountCpa)} per activated user.`} />
        <Table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Platform</th>
              <th>Status</th>
              <th className="text-right">Daily budget</th>
              <th className="text-right">Spend</th>
              <th className="text-right">Registered</th>
              <th className="text-right">Activated</th>
              <th className="text-right">Cost per activated</th>
            </tr>
          </thead>
          <tbody>
            {camps.map((c) => {
              const cpa = c.activations7d ? c.spend7d / c.activations7d : null;
              const good = cpa !== null && cpa < accountCpa * 0.85;
              const bad = cpa !== null && cpa > accountCpa * 1.3;
              return (
                <tr key={c.id}>
                  <td>
                    <div className="min-w-[200px] font-medium">{c.name}</div>
                    <div className="text-xs text-muted">{c.objective}</div>
                  </td>
                  <td className="whitespace-nowrap text-muted">{CHANNEL_LABELS[c.platform as Channel]}</td>
                  <td><StatusPill status={c.status} /></td>
                  <td className="text-right font-mono tabular">{inr(c.dailyBudget)}</td>
                  <td className="text-right font-mono tabular">{inr(c.spend7d)}</td>
                  <td className="text-right font-mono tabular">{num(c.registrations7d)}</td>
                  <td className="text-right font-mono tabular">{num(c.activations7d)}</td>
                  <td className={`text-right font-mono tabular ${good ? "text-leaf" : bad ? "text-sindoor" : ""}`}>
                    {cpa ? inr(cpa) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="A/B tests" sub="Cost per activated user for each variant" />
          <ul className="divide-y divide-rule">
            {tests.map((t) => {
              const known = t.variants.filter((v) => v.cpa !== null);
              const winner = known.length ? known.reduce((a, b) => (a.cpa! <= b.cpa! ? a : b)) : null;
              return (
                <li key={t.id} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium">{t.hypothesis}</p>
                    <StatusPill status={t.status} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {t.variants.map((v) => (
                      <span key={v.name} className={`rounded-md px-2 py-1 ring-1 ring-inset ${winner?.name === v.name && t.status !== "running" ? "bg-leaf-soft text-leaf ring-leaf/20" : "bg-paper text-muted ring-rule"}`}>
                        {v.name}: <span className="font-mono tabular">{v.cpa !== null ? inr(v.cpa) : "collecting"}</span>
                      </span>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-muted">
                    {CHANNEL_LABELS[t.platform as Channel]} · started {t.startedAt}
                  </p>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Change log" sub="Every change the agent or a person made, and what the guardrails decided" />
          <ul className="divide-y divide-rule">
            {log.map(({ c, campaign }) => (
              <li key={c.id} className="px-5 py-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-medium">{c.change}</span>
                    {campaign && <span className="text-muted"> · {campaign}</span>}
                  </div>
                  <StatusPill status={c.outcome} />
                </div>
                <p className="mt-1 text-xs text-muted">{c.reason}</p>
                <p className="mt-1 text-xs text-muted">
                  <Pill>{c.actor}</Pill> <span className="ml-1">{ago(c.createdAt, now)}</span>
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

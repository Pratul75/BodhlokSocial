import { Fragment } from "react";
import Link from "next/link";
import { desc, ne } from "drizzle-orm";
import { adChanges, adEntities, db } from "@bodh/db";
import { AUTO_BID_LIMIT, LOSING_RULES } from "@bodh/guardrails";
import { adResults, adsConnected, judgeAd, JUDGE_DAYS, PLATFORM_LABELS, spendNow, testsWithResults } from "@bodh/integrations/ads";
import type { Platform } from "@bodh/integrations/ads-platforms";
import { requireModule } from "@/lib/auth";
import { ago, inr, num } from "@/lib/format";
import { Meter } from "@/components/charts";
import { AgentRunPanel } from "@/components/agent-run-panel";
import { JobButton } from "@/components/job-button";
import { Card, CardHeader, EmptyState, PageHeader, Pill, StatusPill, Table } from "@/components/ui";
import { pauseAdAction, syncAdsAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ads manager" };

const PLATFORMS: Platform[] = ["meta_ads", "google_ads"];

export default async function AdsPage() {
  const user = await requireModule("ads");
  const [connected, caps, ents, results, judged, tests, log] = await Promise.all([
    adsConnected(),
    Promise.all(PLATFORMS.map((p) => spendNow(p))),
    db.select().from(adEntities).where(ne(adEntities.status, "removed")),
    adResults(7),
    adResults(JUDGE_DAYS),
    testsWithResults(),
    db.select().from(adChanges).orderBy(desc(adChanges.createdAt)).limit(30),
  ]);
  const now = new Date();
  const stat = (platform: string, id: string) => results.get(`${platform}:${id}`);
  const ads = ents.filter((e) => e.level === "ad");
  const verdicts = new Map(await Promise.all(ads.filter((a) => a.status === "active").map(async (a) => [a.id, await judgeAd(a, judged)] as const)));
  const campaignRows = ents
    .filter((e) => e.level === "campaign")
    .map((c) => {
      const mine = ads.filter((a) => a.platform === c.platform && a.campaignId === c.platformId);
      const t = mine.reduce((s, a) => {
        const r = stat(a.platform, a.platformId);
        return { spend: s.spend + (r?.spend ?? 0), registrations: s.registrations + (r?.registrations ?? 0), activations: s.activations + (r?.activations ?? 0) };
      }, { spend: 0, registrations: 0, activations: 0 });
      const sets = ents.filter((e) => e.level === "ad_set" && e.platform === c.platform && e.parentId === c.platformId);
      const budget = c.dailyBudget ? Number(c.dailyBudget) : sets.reduce((s, x) => s + Number(x.dailyBudget ?? 0), 0) || null;
      return { c, sets, ads: mine, budget, ...t };
    })
    .sort((a, b) => b.spend - a.spend);
  const total = campaignRows.reduce((s, r) => ({ spend: s.spend + r.spend, act: s.act + r.activations }), { spend: 0, act: 0 });
  const accountCpa = total.act ? total.spend / total.act : 0;
  const anyConnected = connected.meta_ads || connected.google_ads;

  return (
    <>
      <PageHeader
        title="Ads manager"
        description={`The Ads agent pauses ads the guardrail counts as losing and moves bids within ±${AUTO_BID_LIMIT * 100}% on its own. Budget increases, new campaigns, resumed ads and new test copy go to Approvals. Caps are set in Admin.`}
        actions={<JobButton action={syncAdsAction} job="sync" label="Sync accounts" pendingLabel="Syncing…" />}
      />

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {caps.map((b, i) =>
          b ? (
            <Card key={PLATFORMS[i]} className="p-5">
              <div className="flex items-baseline justify-between">
                <h2 className="font-display text-[16px] font-semibold tracking-tight">{PLATFORM_LABELS[b.platform]}</h2>
                <span className="text-xs text-muted">{connected[b.platform] ? "Connected" : <Link href="/connections" className="underline">Not connected</Link>}</span>
              </div>
              {b.dailyCap === 0 ? (
                <p className="mt-3 text-sm text-sindoor">Caps are ₹0, so every change except pausing is blocked. {user.role === "admin" ? <Link href="/admin" className="underline">Set caps in Admin.</Link> : "An admin sets them in Admin."}</p>
              ) : null}
              <div className="mt-4 space-y-4 text-sm">
                {[
                  { label: "Spent today", v: b.spentToday, max: b.dailyCap },
                  { label: "Daily budgets running", v: b.committedDaily, max: b.dailyCap },
                  { label: "Spent this month", v: b.spentThisMonth, max: b.monthlyCap },
                ].map((m) => (
                  <div key={m.label}>
                    <div className="mb-1.5 flex justify-between">
                      <span className="text-muted">{m.label}</span>
                      <span className="font-mono tabular">{inr(m.v)} <span className="text-muted">of {inr(m.max)}</span></span>
                    </div>
                    <Meter value={m.v} max={m.max} />
                  </div>
                ))}
              </div>
            </Card>
          ) : null,
        )}
      </div>

      <Card className="mb-6">
        <AgentRunPanel
          agent="ads"
          title="Ads agent"
          sub="Reviews both accounts every morning at 07:30 against cost per activated user, acts within the guardrails and proposes the rest."
          label="Run Ads agent"
          placeholder="Optional: e.g. focus on the institutes campaign, or propose a test of problem-first hooks"
        />
      </Card>

      <Card className="mb-6">
        <CardHeader title="Campaigns" sub={`Last 7 days. Account average: ${accountCpa ? inr(accountCpa) : "—"} per activated user.`} />
        {campaignRows.length ? (
          <Table>
            <thead>
              <tr>
                <th>Campaign, ad set and ads</th>
                <th>Status</th>
                <th className="text-right">Daily budget</th>
                <th className="text-right">Spend</th>
                <th className="text-right">Activated</th>
                <th className="text-right">Cost per activated</th>
              </tr>
            </thead>
            <tbody>
              {campaignRows.map(({ c, sets, ads: campaignAds, budget, spend, activations }) => (
                <Fragment key={c.id}>
                  <tr className="bg-paper/50">
                    <td>
                      <div className="min-w-[220px] font-medium">{c.name}</div>
                      <div className="text-xs text-muted">{PLATFORM_LABELS[c.platform as Platform]} · {c.objective?.toLowerCase().replace(/_/g, " ")}</div>
                    </td>
                    <td><StatusPill status={c.status} /></td>
                    <td className="text-right font-mono tabular">{budget ? inr(budget) : "—"}</td>
                    <td className="text-right font-mono tabular">{inr(spend)}</td>
                    <td className="text-right font-mono tabular">{num(activations)}</td>
                    <td className={`text-right font-mono tabular ${activations && accountCpa && spend / activations > accountCpa * 1.3 ? "text-sindoor" : activations && spend / activations < accountCpa * 0.85 ? "text-leaf" : ""}`}>{activations ? inr(spend / activations) : "—"}</td>
                  </tr>
                  {sets.map((s) =>
                    campaignAds
                      .filter((a) => a.parentId === s.platformId)
                      .map((a) => {
                        const r = stat(a.platform, a.platformId);
                        const v = verdicts.get(a.id);
                        return (
                          <tr key={a.id}>
                            <td className="pl-9">
                              <div className="text-sm">{a.name}</div>
                              <div className="text-xs text-muted">{s.name}{v ? ` · ${v.reason}` : ""}</div>
                            </td>
                            <td>{v?.losing ? <Pill tone="sindoor">Losing</Pill> : <StatusPill status={a.status} />}</td>
                            <td className="text-right font-mono text-muted tabular">{s.dailyBudget ? inr(Number(s.dailyBudget)) : ""}</td>
                            <td className="text-right font-mono tabular">{inr(r?.spend ?? 0)}</td>
                            <td className="text-right font-mono tabular">{num(r?.activations ?? 0)}</td>
                            <td className="text-right">
                              {a.status === "active" ? (
                                <JobButton action={pauseAdAction} job="pause" label="Pause" pendingLabel="…" variant="ghost" fields={{ platform: a.platform, adId: a.platformId }} />
                              ) : (
                                <span className="font-mono tabular">{r?.activations ? inr(r.spend / r.activations) : "—"}</span>
                              )}
                            </td>
                          </tr>
                        );
                      }),
                  )}
                </Fragment>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={anyConnected ? "Nothing synced yet" : "No ad account connected"}>
            {anyConnected ? "Click Sync accounts, or wait for the hourly sync." : <>Connect the Meta Marketing API (and Google Ads once the developer token is approved) in <Link href="/connections" className="underline">Connections</Link>.</>}
          </EmptyState>
        )}
        <p className="border-t border-rule px-5 py-3 text-xs text-muted">
          An ad counts as losing once it has spent ₹{LOSING_RULES.minSpend} in {JUDGE_DAYS} days and costs {LOSING_RULES.cpaRatio}x the best ad in its ad set per activation (or {LOSING_RULES.zeroActivationSpendRatio}x with none), where that best ad has {LOSING_RULES.minPeerActivations}+ activations. The last running ad in an ad set is never paused automatically.
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="A/B tests" sub="Cost per activated user for each variant" />
          {tests.length ? (
            <ul className="divide-y divide-rule">
              {tests.map((t) => (
                <li key={t.id} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium">{t.hypothesis}</p>
                    <StatusPill status={t.status} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {t.variants.map((v) => (
                      <span key={v.name} className={`rounded-md px-2 py-1 ring-1 ring-inset ${t.winnerAdId && t.winnerAdId === v.adId ? "bg-leaf-soft text-leaf ring-leaf/20" : "bg-paper text-muted ring-rule"}`}>
                        {v.name}: <span className="font-mono tabular">{v.cpa ? inr(v.cpa) : v.spend ? `${inr(v.spend)} spent` : "collecting"}</span>
                      </span>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-muted">{PLATFORM_LABELS[t.platform as Platform] ?? t.platform} · started {t.startedAt}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No tests yet">The Ads agent proposes copy tests; they start once approved.</EmptyState>
          )}
        </Card>

        <Card>
          <CardHeader title="Change log" sub="Every change the agent or a person asked for, and what the guardrails decided" />
          {log.length ? (
            <ul className="divide-y divide-rule">
              {log.map((c) => (
                <li key={c.id} className="px-5 py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 font-medium">{c.change}</span>
                    <StatusPill status={c.outcome} />
                  </div>
                  <p className="mt-1 text-xs text-muted">{c.reason}</p>
                  {c.guardrail && <p className="mt-0.5 text-xs text-muted">Guardrail: {c.guardrail}</p>}
                  {c.error && <p className="mt-0.5 text-xs text-sindoor">{c.error}</p>}
                  <p className="mt-1 text-xs text-muted">
                    <Pill>{c.actor}</Pill> <span className="ml-1">{ago(c.createdAt, now)}</span>
                    {c.approvalId && c.outcome === "sent_to_approval" && <Link href="/approvals?kind=ad_change" className="ml-2 text-dusk hover:underline">In Approvals</Link>}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No changes yet" />
          )}
        </Card>
      </div>
    </>
  );
}

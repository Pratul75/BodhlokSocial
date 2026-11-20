import Link from "next/link";
import { platformAudit, requireOperator } from "@/lib/platform-auth";
import { isUsageWindow, tokenUseByWorkspace, USAGE_WINDOWS, type UsageWindow } from "@/lib/platform-stats";
import { ConsoleShell } from "../shell";
import { ConsoleCard, Empty, Money, ShareBar, StatTile, Tokens, WorkspacePill } from "../ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Token use" };

const WINDOW_NOTE: Record<UsageWindow, string> = {
  month: "This calendar month in India time — the same month the AI budget is measured over.",
  "30d": "The last thirty days, rolling.",
  "7d": "The last seven days, rolling.",
};

/**
 * Which workspace is using how many tokens.
 *
 * Every figure is read from the workspace itself through its read-only role. `agent_runs` is
 * the whole of it: agents, chat and AI-visibility checks all write a row there, which is why
 * the monthly budget can be enforced from the same table.
 */
export default async function TokenUse({ searchParams }: { searchParams: Promise<{ window?: string }> }) {
  const op = await requireOperator();
  const sp = await searchParams;
  const window: UsageWindow = isUsageWindow(sp.window) ? sp.window : "month";

  const rows = await tokenUseByWorkspace(window);
  await platformAudit({ actor: op.email, action: "view_token_use", target: window });

  const tokensIn = rows.reduce((n, r) => n + r.tokensIn, 0);
  const tokensOut = rows.reduce((n, r) => n + r.tokensOut, 0);
  const total = tokensIn + tokensOut;
  const spend = rows.reduce((n, r) => n + r.usd, 0);
  const runs = rows.reduce((n, r) => n + r.runs, 0);
  const heaviest = rows[0]?.tokens ?? 0;
  const unreadable = rows.filter((r) => r.error);

  // Across the platform, which agent is doing the spending.
  const byAgent = new Map<string, { runs: number; tokens: number; usd: number }>();
  for (const r of rows) {
    for (const a of r.byAgent) {
      const seen = byAgent.get(a.agent) ?? { runs: 0, tokens: 0, usd: 0 };
      seen.runs += a.runs;
      seen.tokens += a.tokensIn + a.tokensOut;
      seen.usd += a.usd;
      byAgent.set(a.agent, seen);
    }
  }
  const agents = [...byAgent.entries()].map(([agent, v]) => ({ agent, ...v })).sort((a, b) => b.tokens - a.tokens);

  return (
    <ConsoleShell
      operator={op}
      title="Token use"
      description="Which workspace is using how many tokens, read from each workspace through its read-only role."
      crumbs={[{ label: "Token use" }]}
      actions={
        <div className="flex gap-1 rounded-lg border border-rule bg-card p-1">
          {USAGE_WINDOWS.map((w) => (
            <Link
              key={w.key}
              href={`/super-admin/usage?window=${w.key}`}
              aria-current={w.key === window ? "page" : undefined}
              className={`rounded-md px-2.5 py-1.5 text-sm font-medium ${
                w.key === window ? "bg-night text-white" : "text-muted hover:bg-paper hover:text-ink"
              }`}
            >
              {w.label}
            </Link>
          ))}
        </div>
      }
    >
      <p className="-mt-3 mb-5 text-sm text-muted">{WINDOW_NOTE[window]}</p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Tokens" value={<Tokens n={total} />} sub={`${runs} runs across ${rows.length} workspaces`} />
        <StatTile label="Input" value={<Tokens n={tokensIn} />} sub="new and cached, as the model was charged" />
        <StatTile label="Output" value={<Tokens n={tokensOut} />} sub="what the models wrote back" />
        <StatTile label="AI spend" value={<Money usd={spend} />} sub="the same rows, priced" />
      </div>

      {unreadable.length > 0 && (
        <p className="mt-4 rounded-lg bg-sindoor-soft px-4 py-3 text-sm text-sindoor">
          {unreadable.length} workspace{unreadable.length > 1 ? "s" : ""} could not be read, so{" "}
          {unreadable.length > 1 ? "their" : "its"} tokens are missing from these totals:{" "}
          {unreadable.map((r) => r.tenant.name).join(", ")}.
        </p>
      )}

      <div className="mt-6">
        <ConsoleCard
          title="By workspace"
          sub="Heaviest first. The bar compares each workspace with the heaviest one."
        >
          {rows.length === 0 ? (
            <Empty>No workspaces yet.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-rule text-left text-xs tracking-wide text-muted uppercase">
                    <th className="px-5 py-2.5 font-medium">Workspace</th>
                    <th className="px-3 py-2.5 text-right font-medium">Runs</th>
                    <th className="px-3 py-2.5 text-right font-medium">Input</th>
                    <th className="px-3 py-2.5 text-right font-medium">Output</th>
                    <th className="px-3 py-2.5 text-right font-medium">Tokens</th>
                    <th className="w-32 px-3 py-2.5 font-medium">Share</th>
                    <th className="px-5 py-2.5 text-right font-medium">Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.tenant.id} className="border-b border-rule/60 last:border-0">
                      <td className="px-5 py-2.5">
                        <Link
                          href={`/super-admin/workspaces/${r.tenant.id}/usage`}
                          className="font-medium hover:underline"
                        >
                          {r.tenant.name}
                        </Link>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                          <span className="font-mono">{r.tenant.slug}</span>
                          {(r.tenant.status !== "active" || r.error) && (
                            <WorkspacePill status={r.tenant.status} error={Boolean(r.error)} />
                          )}
                        </div>
                        {r.error && <div className="mt-0.5 text-xs text-sindoor">{r.error}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular text-muted">{r.runs}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-muted">
                        <Tokens n={r.tokensIn} />
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-muted">
                        <Tokens n={r.tokensOut} />
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-medium">
                        <Tokens n={r.tokens} />
                      </td>
                      <td className="px-3 py-2.5">
                        <ShareBar value={r.tokens} of={heaviest} />
                      </td>
                      <td className="px-5 py-2.5 text-right font-mono tabular">
                        <Money usd={r.usd} />
                        {window === "month" && r.budgetUsd > 0 && (
                          <div className={`mt-0.5 text-xs ${r.usd > r.budgetUsd * 0.8 ? "text-turmeric-ink" : "text-muted"}`}>
                            of ${r.budgetUsd}
                          </div>
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

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ConsoleCard title="By agent, everywhere" sub="The same rows, grouped by what was running">
          {agents.length === 0 ? (
            <Empty>Nothing has run in this window.</Empty>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {agents.map((a) => (
                  <tr key={a.agent} className="border-b border-rule/60 last:border-0">
                    <td className="px-5 py-2.5 capitalize">{a.agent}</td>
                    <td className="px-3 py-2.5 text-right tabular text-muted">{a.runs} runs</td>
                    <td className="px-3 py-2.5 text-right font-mono">
                      <Tokens n={a.tokens} />
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono tabular text-muted">
                      <Money usd={a.usd} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ConsoleCard>

        <ConsoleCard title="What this counts" sub="So the number can be trusted or argued with">
          <div className="space-y-3 px-5 py-4 text-sm text-muted">
            <p>
              Every agent run, every chat turn and every AI-visibility check writes a row in its
              workspace&apos;s <span className="font-mono text-xs">agent_runs</span> table. That table is also what the
              monthly budget is enforced from, so there is no AI usage that spends money without being counted here.
            </p>
            <p>
              <strong className="font-medium text-ink">Input</strong> includes tokens read from the prompt cache and
              written to it, because that is what the model charged for. A run still going counts at the amount it
              reserved until it finishes.
            </p>
            <p>
              Nothing is copied into the control plane: each workspace is read live, through its own read-only database
              role. A workspace that cannot be read is named above rather than counted as zero.
            </p>
          </div>
        </ConsoleCard>
      </div>
    </ConsoleShell>
  );
}

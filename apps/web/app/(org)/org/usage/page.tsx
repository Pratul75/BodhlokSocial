import Link from "next/link";
import { accessLevels, workspacesOf, type AccessLevel } from "@bodh/db";
import { requireOrgAdmin } from "@/lib/org-auth";
import { isUsageWindow, tokenUseByWorkspace, USAGE_WINDOWS, type UsageWindow } from "@/lib/platform-stats";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { AgencyShell } from "../shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Token use" };

const WINDOW_NOTE: Record<UsageWindow, string> = {
  month: "This calendar month in India time — the same month the AI budget is measured over.",
  "30d": "The last thirty days, rolling.",
  "7d": "The last seven days, rolling.",
};

const short = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString("en-IN");

/** Which of this agency's workspaces is using how many tokens. The console's page, scoped. */
export default async function AgencyUsage({ searchParams }: { searchParams: Promise<{ window?: string }> }) {
  const { user, org } = await requireOrgAdmin();
  const sp = await searchParams;
  const window: UsageWindow = isUsageWindow(sp.window) ? sp.window : "month";

  const [levels, all] = await Promise.all([accessLevels(org.id), workspacesOf(org.id)]);
  const levelOf = (id: string): AccessLevel => levels.get(id) ?? "full";
  // Which workspaces may be read is settled before anything is read. A client hidden from this
  // agency has its schema left alone, not opened and then dropped from the table.
  const mine = all.filter((t) => t.id === user.tenant.id || levelOf(t.id) !== "none");
  const visible = await tokenUseByWorkspace(
    window,
    mine.map((t) => t.id),
  );

  const tokensIn = visible.reduce((n, r) => n + r.tokensIn, 0);
  const tokensOut = visible.reduce((n, r) => n + r.tokensOut, 0);
  const spend = visible.reduce((n, r) => n + r.usd, 0);
  const runs = visible.reduce((n, r) => n + r.runs, 0);
  const heaviest = visible[0]?.tokens ?? 0;

  return (
    <AgencyShell
      orgName={org.name}
      workspaceName={user.tenant.name}
      email={user.email}
      clients={mine.length}
      title="Token use"
      description="Which of your workspaces is using how many tokens, read from each one through its read-only role."
      crumbs={[{ label: "Token use" }]}
      actions={
        <div className="flex gap-1 rounded-lg border border-rule bg-card p-1">
          {USAGE_WINDOWS.map((w) => (
            <Link
              key={w.key}
              href={`/org/usage?window=${w.key}`}
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
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">Tokens</div>
          <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">{short(tokensIn + tokensOut)}</div>
          <div className="mt-1.5 text-xs text-muted">{runs} runs across {visible.length} workspaces</div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">Input</div>
          <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">{short(tokensIn)}</div>
          <div className="mt-1.5 text-xs text-muted">new and cached, as the model was charged</div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">Output</div>
          <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">{short(tokensOut)}</div>
          <div className="mt-1.5 text-xs text-muted">what the models wrote back</div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">AI spend</div>
          <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">${spend.toFixed(2)}</div>
          <div className="mt-1.5 text-xs text-muted">the same rows, priced</div>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader title="By workspace" sub="Heaviest first. The bar compares each one with the heaviest." />
          {visible.length === 0 ? (
            <EmptyState title="No workspaces yet">Create your first client.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-rule text-left text-xs tracking-wide text-muted uppercase">
                  <tr>
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
                  {visible.map((r) => (
                    <tr key={r.tenant.id} className="border-b border-rule/60 last:border-0">
                      <td className="px-5 py-2.5">
                        <Link href={`/org/clients/${r.tenant.id}/usage`} className="font-medium hover:underline">
                          {r.tenant.name}
                        </Link>
                        <div className="mt-0.5 font-mono text-xs text-muted">{r.tenant.slug}</div>
                        {r.error && <div className="mt-0.5 text-xs text-sindoor">{r.error}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular text-muted">{r.runs}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-muted">{short(r.tokensIn)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-muted">{short(r.tokensOut)}</td>
                      <td className="px-3 py-2.5 text-right font-mono font-medium">{short(r.tokens)}</td>
                      <td className="px-3 py-2.5">
                        <span className="block h-1.5 w-full overflow-hidden rounded-full bg-paper" aria-hidden="true">
                          <span
                            className="block h-full rounded-full bg-dusk"
                            style={{ width: `${heaviest > 0 ? Math.max(r.tokens > 0 ? 2 : 0, Math.round((r.tokens / heaviest) * 100)) : 0}%` }}
                          />
                        </span>
                      </td>
                      <td className="px-5 py-2.5 text-right font-mono tabular">
                        ${r.usd.toFixed(2)}
                        {window === "month" && r.budgetUsd > 0 && (
                          <div className="mt-0.5 text-xs text-muted">of ${r.budgetUsd}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AgencyShell>
  );
}

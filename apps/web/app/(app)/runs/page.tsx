import Link from "next/link";
import { desc } from "drizzle-orm";
import { agentRuns, db } from "@bodh/db";
import { requireModule } from "@/lib/auth";
import { ago } from "@/lib/format";
import { Card, PageHeader, StatusPill, Table } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent runs" };

const AGENT_LABEL: Record<string, string> = { strategy: "Strategy", content: "Content", seo: "SEO", ads: "Ads", chat: "Chat" };
const TRIGGER: Record<string, string> = { schedule: "on schedule", manual: "on request", chat: "from chat" };

export default async function RunsPage() {
  await requireModule("runs");
  const runs = await db.select().from(agentRuns).orderBy(desc(agentRuns.startedAt)).limit(60);
  const now = new Date();
  return (
    <>
      <PageHeader
        title="Agent runs"
        description="Every time an agent worked: what it was asked, what it read and searched, what it wrote, and what it cost. Open a run to follow it step by step."
      />
      <Card>
        <Table>
          <thead>
            <tr>
              <th>When</th>
              <th>Agent</th>
              <th>Asked to</th>
              <th>Result</th>
              <th className="text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap text-muted">
                  <Link href={`/runs/${r.id}`} className="hover:underline">{ago(r.startedAt, now)}</Link>
                  <div className="text-xs">{TRIGGER[r.trigger] ?? r.trigger}</div>
                </td>
                <td className="whitespace-nowrap">
                  <Link href={`/runs/${r.id}`} className="font-medium hover:underline">{AGENT_LABEL[r.agent] ?? r.agent}</Link>
                  <div className="mt-1"><StatusPill status={r.status} /></div>
                </td>
                <td className="max-w-[320px] text-xs text-muted"><span className="line-clamp-2">{r.task ?? "—"}</span></td>
                <td className="max-w-[460px]"><span className="line-clamp-3 text-sm">{r.summary ?? (r.status === "running" || r.status === "queued" ? "Working…" : "—")}</span></td>
                <td className="text-right font-mono text-[13px] tabular text-muted">{Number(r.costUsd) > 0 ? `$${Number(r.costUsd).toFixed(2)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        {runs.length === 0 && <p className="px-5 py-6 text-sm text-muted">No runs yet.</p>}
      </Card>
    </>
  );
}

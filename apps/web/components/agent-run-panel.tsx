import { and, desc, eq } from "drizzle-orm";
import { agentRuns, db } from "@bodh/db";
import { CardHeader, StatusPill } from "./ui";
import { AgentRunForm } from "./agent-run-form";

const fmt = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The agent's Run button, with how its last run went. */
export async function AgentRunPanel({ agent, title, sub, label, placeholder }: { agent: "strategy" | "content" | "seo"; title: string; sub: string; label: string; placeholder: string }) {
  const [last] = await db.select().from(agentRuns).where(and(eq(agentRuns.agent, agent))).orderBy(desc(agentRuns.startedAt)).limit(1);
  const busy = last?.status === "queued" || last?.status === "running";
  return (
    <>
      <CardHeader title={title} sub={sub} />
      <div className="space-y-3 px-5 py-4">
        <AgentRunForm agent={agent} label={label} placeholder={placeholder} disabled={busy} />
        {last && (
          <div className="rounded-lg bg-paper px-3 py-2.5 text-sm">
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <StatusPill status={last.status} /> Last run {fmt(last.startedAt)}, {last.trigger === "schedule" ? "scheduled" : "on request"}
              {Number(last.costUsd) > 0 && <span className="font-mono tabular">${Number(last.costUsd).toFixed(2)}</span>}
            </p>
            {busy ? (
              <p className="mt-1.5 text-muted">Working on it. Refresh in a few minutes.</p>
            ) : (
              last.summary && <p className="mt-1.5 line-clamp-6 whitespace-pre-wrap">{last.summary}</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

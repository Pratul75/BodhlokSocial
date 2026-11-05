import Link from "next/link";
import { desc, inArray } from "drizzle-orm";
import { communityItems, connections, db } from "@bodh/db";
import { requireModule } from "@/lib/auth";
import { ago } from "@/lib/format";
import { AgentRunPanel } from "@/components/agent-run-panel";
import { Card, CardHeader, EmptyState, PageHeader, Pill, StatusPill } from "@/components/ui";
import { MarkPostedForm, RetryButton, SkipButton } from "./item-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Community" };

const PLATFORM: Record<string, string> = { reddit: "Reddit", quora: "Quora", youtube: "YouTube comments" };
const STAGES = [
  { key: ["found"], label: "Found", empty: "The agent saves questions worth answering here." },
  { key: ["drafted"], label: "Needs a rewrite", empty: "Answers a reviewer sent back show here with the note." },
  { key: ["in_review", "approved", "failed"], label: "In review or posting", empty: "Drafted answers wait in Approvals." },
  { key: ["posted"], label: "Posted", empty: "Nothing posted yet." },
] as const;

export default async function CommunityPage() {
  await requireModule("community");
  const [items, conns] = await Promise.all([
    db.select().from(communityItems).orderBy(desc(communityItems.foundAt)).limit(300),
    db.select().from(connections).where(inArray(connections.key, ["reddit", "youtube"])),
  ]);
  const connected = (k: string) => conns.find((c) => c.key === k)?.status === "connected";
  const now = new Date();
  const skipped = items.filter((i) => i.status === "skipped");

  return (
    <>
      <PageHeader
        title="Community"
        description="Real questions on Reddit, YouTube and Quora where a helpful answer from the Bodhlok team fits. Every answer is approved by a person, says who wrote it, and is posted from a named team account. Quora answers are posted by hand."
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <AgentRunPanel
            agent="community"
            title="Community agent"
            sub="Runs daily at 08:00. Finds questions, rewrites answers sent back, and drafts up to 8 answers into Approvals."
            label="Run Community agent"
            placeholder="Optional: e.g. look in r/KPastrology for questions about sub-lords"
          />
        </Card>
        <Card>
          <CardHeader title="Accounts" />
          <ul className="space-y-2 px-5 py-4 text-sm">
            <li className="flex items-center justify-between gap-2">Reddit <StatusPill status={connected("reddit") ? "connected" : "not_connected"} /></li>
            <li className="flex items-center justify-between gap-2">YouTube comments <StatusPill status={connected("youtube") ? "connected" : "not_connected"} /></li>
            <li className="flex items-center justify-between gap-2">Quora <span className="text-xs text-muted">no API, posted by hand</span></li>
          </ul>
          {(!connected("reddit") || !connected("youtube")) && (
            <p className="px-5 pb-4 text-xs text-muted">
              Without an account the agent can still find questions with web search, but approved answers can&apos;t be posted there. <Link href="/connections" className="text-dusk hover:underline">Connections</Link>
            </p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {STAGES.map((s) => {
          const list = items.filter((i) => (s.key as readonly string[]).includes(i.status));
          return (
            <Card key={s.label}>
              <CardHeader title={s.label} aside={<span className="font-mono text-sm text-muted tabular">{list.length}</span>} />
              {list.length === 0 ? (
                <EmptyState title="None">{s.empty}</EmptyState>
              ) : (
                <ul className="divide-y divide-rule">
                  {list.map((i) => (
                    <li key={i.id} className="space-y-1.5 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                        <Pill>{PLATFORM[i.platform] ?? i.platform}</Pill>
                        {i.place && <span>{i.place}</span>}
                        <span>{ago(i.foundAt, now)}</span>
                        {i.status !== "found" && i.status !== "drafted" && i.status !== "posted" && <StatusPill status={i.status} />}
                      </div>
                      <a href={i.url} target="_blank" rel="noreferrer" className="block text-sm font-medium hover:text-dusk">{i.question}</a>
                      {i.why && i.status === "found" && <p className="text-xs text-muted">{i.why}</p>}
                      {i.draft && <p className="line-clamp-3 text-xs text-muted">{i.draft}</p>}
                      {i.reviewNote && i.status === "drafted" && <p className="text-xs text-turmeric-ink">Reviewer: {i.reviewNote}</p>}
                      {i.error && i.status === "failed" && <p className="text-xs text-sindoor">{i.error}</p>}
                      {i.status === "in_review" && (
                        <Link href="/approvals?kind=reply" className="inline-block text-xs text-dusk hover:underline">Review in Approvals</Link>
                      )}
                      {i.status === "posted" && i.postedUrl && (
                        <a href={i.postedUrl} target="_blank" rel="noreferrer" className="inline-block text-xs text-dusk hover:underline">See the answer</a>
                      )}
                      {i.status === "approved" && i.platform === "quora" && <MarkPostedForm id={i.id} />}
                      {i.status === "failed" && <RetryButton id={i.id} />}
                      {(i.status === "found" || i.status === "drafted" || i.status === "failed") && <SkipButton id={i.id} />}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      {skipped.length > 0 && (
        <details className="mt-4 text-xs text-muted">
          <summary className="cursor-pointer">Skipped ({skipped.length})</summary>
          <ul className="mt-2 space-y-1">
            {skipped.slice(0, 50).map((i) => (
              <li key={i.id}>
                {i.question} <span className="opacity-70">({i.error ?? "skipped"})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}


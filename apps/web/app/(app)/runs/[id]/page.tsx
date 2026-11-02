import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen, Globe, MessageSquare, PenLine, Search, Wrench } from "lucide-react";
import { desc, eq, sql } from "drizzle-orm";
import { agentRuns, calendarItems, db, seoPages } from "@bodh/db";
import { CHANNEL_LABELS, type Channel } from "@bodh/shared";
import { requireModule } from "@/lib/auth";
import { Markdown } from "@/components/markdown";
import { Card, CardHeader, PageHeader, Stat, StatusPill } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent run" };

const AGENT_LABEL: Record<string, string> = { strategy: "Strategy agent", content: "Content agent", seo: "SEO agent", ads: "Ads agent", chat: "Chat" };
const ICON = { tool: Wrench, search: Search, read: Globe, said: MessageSquare, wrote: PenLine, note: BookOpen } as const;
const fmt = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule("runs");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, id)).limit(1);
  if (!run) notFound();
  const [posts, pages] = await Promise.all([
    db.select().from(calendarItems).where(sql`${calendarItems.settings}->>'run_id' = ${id}`).orderBy(calendarItems.scheduledAt).limit(60),
    db.select().from(seoPages).where(eq(seoPages.runId, id)).orderBy(desc(seoPages.updatedAt)).limit(60),
  ]);
  const live = run.status === "running" || run.status === "queued";
  const minutes = run.finishedAt ? Math.max(1, Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 60_000)) : null;

  return (
    <>
      <Link href="/runs" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={14} /> Agent runs
      </Link>
      <PageHeader
        eyebrow={<span className="flex items-center gap-2">{run.trigger === "schedule" ? "Scheduled run" : run.trigger === "chat" ? "From chat" : "Run on request"} <StatusPill status={run.status} /></span>}
        title={`${AGENT_LABEL[run.agent] ?? run.agent}, ${fmt(run.startedAt)}`}
        description={run.task ? <>Asked to: <span className="text-ink">{run.task}</span></> : undefined}
      />

      <Card className="mb-6">
        <div className="grid grid-cols-2 gap-6 px-5 py-4 sm:grid-cols-4">
          <Stat label="Steps" value={run.steps.length} />
          <Stat label="Wrote" value={posts.length + pages.length} sub={posts.length || pages.length ? [posts.length && `${posts.length} post${posts.length === 1 ? "" : "s"}`, pages.length && `${pages.length} page${pages.length === 1 ? "" : "s"}`].filter(Boolean).join(", ") : undefined} />
          <Stat label="Cost" value={Number(run.costUsd) > 0 ? `$${Number(run.costUsd).toFixed(2)}` : "—"} sub={`${(run.tokensIn / 1000).toFixed(0)}k tokens in, ${(run.tokensOut / 1000).toFixed(1)}k out`} />
          <Stat label="Took" value={minutes ? `${minutes} min` : live ? "running" : "—"} />
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="What it did" sub={live ? "Still working; reload to see more." : "In order, with the time of each step (IST)"} />
          {run.steps.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">{live ? "Starting up…" : "This run kept no step log (runs before 2 November only have a summary)."}</p>
          ) : (
            <ol className="divide-y divide-rule">
              {run.steps.map((s, i) => {
                const Icon = ICON[s.kind] ?? BookOpen;
                return (
                  <li key={i} className={`flex gap-3 px-5 py-2.5 text-sm ${s.kind === "said" ? "bg-paper/60" : ""}`}>
                    <span className="mt-0.5 w-16 shrink-0 font-mono text-[11px] text-muted tabular">{time(s.at)}</span>
                    <Icon size={15} className={`mt-0.5 shrink-0 ${s.kind === "wrote" ? "text-leaf" : s.kind === "note" ? "text-sindoor" : "text-muted"}`} />
                    <span className={s.kind === "said" ? "whitespace-pre-wrap text-ink" : s.kind === "wrote" ? "font-medium" : "text-muted"}>{s.text}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Its summary" />
            <div className="px-5 py-4 text-sm">{run.summary ? <Markdown text={run.summary} /> : <p className="text-muted">{live ? "Not finished yet." : "No summary."}</p>}</div>
          </Card>
          {posts.length > 0 && (
            <Card>
              <CardHeader title="Posts it drafted or planned" sub="Open one to edit it, add media and send it for approval" />
              <ul className="divide-y divide-rule">
                {posts.map((p) => (
                  <li key={p.id} className="px-5 py-2.5 text-sm">
                    <Link href={`/calendar/${p.id}`} className="font-medium hover:underline">{p.title || p.idea}</Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                      {CHANNEL_LABELS[p.channel as Channel] ?? p.channel} · {p.scheduledAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })} <StatusPill status={p.status} />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {pages.length > 0 && (
            <Card>
              <CardHeader title="Pages it wrote" sub="Each one is in Approvals" />
              <ul className="divide-y divide-rule">
                {pages.map((p) => (
                  <li key={p.id} className="px-5 py-2.5 text-sm">
                    <Link href={`/seo/pages/${p.id}`} className="font-medium hover:underline">{p.title}</Link>
                    <div className="mt-0.5 text-xs text-muted">{p.keyword ?? p.template} <StatusPill status={p.status} /></div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

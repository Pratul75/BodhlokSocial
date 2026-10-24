import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, ne } from "drizzle-orm";
import { ArrowLeft, ExternalLink, Send, Trash2, Undo2 } from "lucide-react";
import { approvals, assets, calendarItems, db } from "@bodh/db";
import { CHANNEL_LABELS, CHANNELS, FORMAT_LABELS, FORMATS, type Channel } from "@bodh/shared";
import { requireModule } from "@/lib/auth";
import { ago } from "@/lib/format";
import { checkItem, itemAssets } from "@/lib/posts";
import { Card, CardHeader, PageHeader, StatusPill, btn } from "@/components/ui";
import { deleteItem, sendForApproval, unschedule } from "./actions";
import { ItemEditor } from "./editor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendar item" };

const pad = (n: number) => String(n).padStart(2, "0");

export default async function CalendarItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string; blocked?: string }> }) {
  await requireModule("calendar");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [item] = await db.select().from(calendarItems).where(eq(calendarItems.id, id)).limit(1);
  if (!item) notFound();

  const [library, chosen, [lastDecision], check] = await Promise.all([
    db.select().from(assets).orderBy(desc(assets.createdAt)).limit(120),
    itemAssets(item),
    db.select().from(approvals).where(and(eq(approvals.calendarItemId, id), ne(approvals.status, "pending"))).orderBy(desc(approvals.decidedAt)).limit(1),
    checkItem(item),
  ]);
  const now = new Date();
  const d = item.scheduledAt;
  const canSend = ["idea", "drafted", "failed"].includes(item.status);

  return (
    <>
      <Link href="/calendar" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={14} /> Calendar
      </Link>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            {CHANNEL_LABELS[item.channel as Channel] ?? item.channel} · {FORMAT_LABELS[item.format as keyof typeof FORMAT_LABELS] ?? item.format}
            <StatusPill status={item.status} />
          </span>
        }
        title={item.title || item.idea}
        description={`Scheduled for ${d.toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" })}. Last edited ${ago(item.updatedAt, now)}.`}
        actions={
          <>
            {canSend && (
              <form action={sendForApproval}>
                <input type="hidden" name="id" value={item.id} />
                <button className={btn.approve} disabled={check.errors.length > 0} title={check.errors.length ? "Fix the problems below first" : undefined}>
                  <Send size={15} /> Send for approval
                </button>
              </form>
            )}
            {["approved", "scheduled"].includes(item.status) && (
              <form action={unschedule}>
                <input type="hidden" name="id" value={item.id} />
                <button className={btn.secondary}><Undo2 size={15} /> Unschedule</button>
              </form>
            )}
            {item.publishedUrl && (
              <a href={item.publishedUrl} target="_blank" rel="noopener noreferrer" className={btn.secondary}>
                <ExternalLink size={15} /> View post
              </a>
            )}
            {["idea", "drafted"].includes(item.status) && !item.postizId && (
              <form action={deleteItem}>
                <input type="hidden" name="id" value={item.id} />
                <button className={btn.ghost} aria-label="Delete item"><Trash2 size={15} /> Delete</button>
              </form>
            )}
          </>
        }
      />

      {sp.sent && item.status === "in_review" && (
        <p className="mb-5 rounded-xl bg-leaf-soft px-5 py-3 text-sm text-leaf" role="status">Sent for approval. It's in the Approvals queue.</p>
      )}
      {sp.blocked && (
        <p className="mb-5 rounded-xl bg-sindoor-soft px-5 py-3 text-sm text-sindoor" role="alert">Fix the problems below before sending for approval.</p>
      )}
      {item.error && (
        <p className="mb-5 rounded-xl bg-sindoor-soft px-5 py-3 text-sm text-sindoor" role="alert">Publishing failed: {item.error}</p>
      )}
      {lastDecision?.status === "rejected" && item.status !== "approved" && (
        <p className="mb-5 rounded-xl bg-turmeric-soft px-5 py-3 text-sm text-turmeric-ink">
          <span className="font-medium">Changes requested {lastDecision.decidedAt ? ago(lastDecision.decidedAt, now) : ""}:</span> {lastDecision.decisionNote}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
        <Card className="p-5">
          <ItemEditor
            item={{
              id: item.id,
              idea: item.idea,
              title: item.title,
              script: item.script,
              caption: item.caption,
              channel: item.channel,
              format: item.format,
              date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
              time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
              assetIds: item.assetIds,
              settings: item.settings,
              locked: item.status === "published",
            }}
            library={library}
            channels={CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABELS[c] }))}
            formats={FORMATS.map((f) => ({ value: f, label: FORMAT_LABELS[f] }))}
          />
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Checks" sub="Run on the saved version" />
            <div className="space-y-2 px-5 py-4 text-sm">
              {check.errors.length === 0 && check.warnings.length === 0 && <p className="text-leaf">Ready to send for approval.</p>}
              {check.errors.map((e) => (
                <p key={e} className="text-sindoor">{e}</p>
              ))}
              {check.warnings.map((w) => (
                <p key={w} className="text-turmeric-ink">{w}</p>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="What happens next" />
            <ol className="list-decimal space-y-1.5 py-4 pr-5 pl-9 text-sm text-muted">
              <li className={item.status === "drafted" || item.status === "idea" ? "font-medium text-ink" : ""}>Draft the caption and pick media</li>
              <li className={item.status === "in_review" ? "font-medium text-ink" : ""}>A social media manager approves it</li>
              <li className={item.status === "approved" ? "font-medium text-ink" : ""}>The publisher schedules it in Postiz</li>
              <li className={item.status === "scheduled" ? "font-medium text-ink" : ""}>Postiz posts it at the scheduled time</li>
              <li className={item.status === "published" ? "font-medium text-ink" : ""}>The link appears here</li>
            </ol>
            <p className="px-5 pb-4 text-xs text-muted">Editing an approved post sends it back to draft.</p>
          </Card>
          {chosen.length === 0 && item.assetIds.length > 0 && (
            <p className="text-xs text-sindoor">Some chosen media no longer exist.</p>
          )}
        </div>
      </div>
    </>
  );
}

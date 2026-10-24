import Link from "next/link";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { ExternalLink, RotateCcw } from "lucide-react";
import { calendarItems, db, pipelineRuns, publishingChannels } from "@bodh/db";
import { CHANNEL_LABELS, FORMAT_LABELS, type Channel, type Format } from "@bodh/shared";
import { channelFor, listIntegrations, type PostizIntegration } from "@bodh/integrations/postiz";
import { postizCredentials } from "@bodh/integrations/publisher";
import { requireModule } from "@/lib/auth";
import { ago, dayLabel, timeLabel } from "@/lib/format";
import { Card, CardHeader, EmptyState, PageHeader, StatusPill, Table, btn } from "@/components/ui";
import { retryPublish } from "./actions";
import { ChannelSelect, RunPublisherButton } from "./forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Publishing" };

const PUBLISHED_CHANNELS = ["instagram", "facebook", "linkedin", "youtube"] as const;

export default async function PublishingPage() {
  const user = await requireModule("publishing");
  const creds = await postizCredentials();
  let integrations: PostizIntegration[] = [];
  let postizError: string | null = null;
  if (creds) {
    try {
      integrations = (await listIntegrations(creds)).filter((i) => !i.disabled);
    } catch (e) {
      postizError = e instanceof Error ? e.message : "Couldn't reach Postiz.";
    }
  }

  const [waiting, scheduled, failed, recent, mapped, [lastRun]] = await Promise.all([
    db.select().from(calendarItems).where(eq(calendarItems.status, "approved")).orderBy(asc(calendarItems.scheduledAt)),
    db.select().from(calendarItems).where(eq(calendarItems.status, "scheduled")).orderBy(asc(calendarItems.scheduledAt)),
    db.select().from(calendarItems).where(eq(calendarItems.status, "failed")).orderBy(desc(calendarItems.scheduledAt)),
    db.select().from(calendarItems).where(inArray(calendarItems.status, ["published"])).orderBy(desc(calendarItems.scheduledAt)).limit(10),
    db.select().from(publishingChannels),
    db.select().from(pipelineRuns).where(eq(pipelineRuns.job, "publisher")).orderBy(desc(pipelineRuns.startedAt)).limit(1),
  ]);
  const mapBy = new Map(mapped.map((m) => [m.channel, m]));
  const now = new Date();

  const rows = (list: typeof waiting, extra?: (it: (typeof waiting)[number]) => React.ReactNode) => (
    <Table>
      <thead><tr><th>When</th><th>Channel</th><th>Format</th><th>Post</th><th>Status</th>{extra && <th><span className="sr-only">Actions</span></th>}</tr></thead>
      <tbody>
        {list.map((it) => (
          <tr key={it.id}>
            <td className="whitespace-nowrap text-muted">{dayLabel(it.scheduledAt)}, {timeLabel(it.scheduledAt)}</td>
            <td className="whitespace-nowrap text-muted">{CHANNEL_LABELS[it.channel as Channel] ?? it.channel}</td>
            <td className="text-muted">{FORMAT_LABELS[it.format as Format] ?? it.format}</td>
            <td className="min-w-[220px]">
              <Link href={`/calendar/${it.id}`} className="font-medium hover:underline">{it.title || it.idea}</Link>
              {it.error && <div className="text-xs text-sindoor">{it.error}</div>}
            </td>
            <td><StatusPill status={it.status} /></td>
            {extra && <td className="text-right">{extra(it)}</td>}
          </tr>
        ))}
      </tbody>
    </Table>
  );

  return (
    <>
      <PageHeader
        title="Publishing"
        description="The publisher hands approved posts to Postiz up to two days ahead, then reads back whether each one went live. It runs every five minutes."
        actions={user.role === "admin" && creds ? <RunPublisherButton /> : undefined}
      />

      {!creds && (
        <div className="mb-6 rounded-xl bg-turmeric-soft px-5 py-3 text-sm text-turmeric-ink">
          Postiz isn't connected, so approved posts wait here. Add its API URL and key in <Link href="/connections" className="underline">Connections</Link>.
        </div>
      )}
      {postizError && <div className="mb-6 rounded-xl bg-sindoor-soft px-5 py-3 text-sm text-sindoor" role="alert">{postizError}</div>}

      <div className="mb-6 grid gap-6 xl:grid-cols-[1fr_1.6fr] [&>*]:min-w-0">
        <Card>
          <CardHeader title="Where posts go" sub="Connect the accounts inside Postiz, then choose them here" />
          <div className="space-y-3 px-5 py-4">
            {PUBLISHED_CHANNELS.map((ch) => (
              <ChannelSelect
                key={ch}
                channel={ch}
                label={CHANNEL_LABELS[ch]}
                current={mapBy.get(ch)?.postizIntegrationId ?? ""}
                options={integrations.filter((i) => channelFor(i.identifier) === ch).map((i) => ({ id: i.id, name: `${i.name}${i.profile ? ` (@${i.profile})` : ""} · ${i.identifier}` }))
                  .concat(mapBy.get(ch) && !integrations.some((i) => i.id === mapBy.get(ch)!.postizIntegrationId) ? [{ id: mapBy.get(ch)!.postizIntegrationId, name: `${mapBy.get(ch)!.name} (not found in Postiz)` }] : [])}
                canEdit={user.role === "admin" && Boolean(creds) && !postizError}
              />
            ))}
            {lastRun && (
              <p className="pt-2 text-xs text-muted">
                Publisher last ran {ago(lastRun.startedAt, now)}: {lastRun.detail ?? lastRun.status}
              </p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Waiting for the publisher" sub="Approved; handed to Postiz when they are within two days" />
          {waiting.length === 0 ? <EmptyState title="Nothing waiting">Approved posts appear here.</EmptyState> : rows(waiting)}
        </Card>
      </div>

      {failed.length > 0 && (
        <Card className="mb-6 border-sindoor/30">
          <CardHeader title="Failed" sub="Fix the cause, then retry. A retry goes back through the publisher's checks." />
          {rows(failed, (it) => (
            <form action={retryPublish}>
              <input type="hidden" name="id" value={it.id} />
              <button className={btn.secondary}><RotateCcw size={14} /> Retry</button>
            </form>
          ))}
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader title="Scheduled in Postiz" />
        {scheduled.length === 0 ? <EmptyState title="Nothing scheduled yet" /> : rows(scheduled)}
      </Card>

      <Card>
        <CardHeader title="Recently published" />
        {recent.length === 0 ? (
          <EmptyState title="Nothing published yet" />
        ) : (
          rows(recent, (it) =>
            it.publishedUrl ? (
              <a href={it.publishedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-dusk hover:underline">
                View <ExternalLink size={13} />
              </a>
            ) : null,
          )
        )}
      </Card>
    </>
  );
}

import { asc, desc, eq, inArray } from "drizzle-orm";
import { RotateCcw } from "lucide-react";
import { calendarItems, connections, db } from "@bodh/db";
import { CHANNEL_LABELS, FORMAT_LABELS, type Channel, type Format } from "@bodh/shared";
import { requireModule } from "@/lib/auth";
import { dayLabel, timeLabel } from "@/lib/format";
import { Card, CardHeader, EmptyState, PageHeader, StatusPill, Table, btn } from "@/components/ui";
import { retryPublish } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Publishing" };

export default async function PublishingPage() {
  await requireModule("publishing");
  const [queue, failed, recent, [postiz]] = await Promise.all([
    db.select().from(calendarItems).where(inArray(calendarItems.status, ["approved", "scheduled"])).orderBy(asc(calendarItems.scheduledAt)),
    db.select().from(calendarItems).where(eq(calendarItems.status, "failed")).orderBy(desc(calendarItems.scheduledAt)),
    db.select().from(calendarItems).where(eq(calendarItems.status, "published")).orderBy(desc(calendarItems.scheduledAt)).limit(8),
    db.select().from(connections).where(eq(connections.key, "postiz")),
  ]);

  const row = (it: (typeof queue)[number], extra?: React.ReactNode) => (
    <tr key={it.id}>
      <td className="whitespace-nowrap text-muted">{dayLabel(it.scheduledAt)}, {timeLabel(it.scheduledAt)}</td>
      <td className="text-muted">{CHANNEL_LABELS[it.channel as Channel] ?? it.channel}</td>
      <td className="text-muted">{FORMAT_LABELS[it.format as Format] ?? it.format}</td>
      <td className="font-medium">{it.idea}</td>
      <td><StatusPill status={it.status} /></td>
      {extra !== undefined && <td>{extra}</td>}
    </tr>
  );

  return (
    <>
      <PageHeader
        title="Publishing"
        description="The Publisher agent sends approved items to Postiz at their scheduled time and retries failures."
      />

      {postiz?.status !== "connected" && (
        <div className="mb-6 rounded-xl bg-turmeric-soft px-5 py-3 text-sm text-turmeric-ink">
          Postiz is not connected, so nothing is actually posted yet. Add its API key in Connections.
        </div>
      )}

      {failed.length > 0 && (
        <Card className="mb-6 border-sindoor/30">
          <CardHeader title="Failed" sub="Fix the cause, then retry. A retry schedules the item 10 minutes from now." />
          <ul className="divide-y divide-rule">
            {failed.map((it) => (
              <li key={it.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <div>
                  <div className="font-medium">{it.idea}</div>
                  <div className="text-xs text-sindoor">{it.error}</div>
                  <div className="text-xs text-muted">{CHANNEL_LABELS[it.channel as Channel]} · was due {dayLabel(it.scheduledAt)}</div>
                </div>
                <form action={retryPublish}>
                  <input type="hidden" name="id" value={it.id} />
                  <button className={btn.secondary}><RotateCcw size={15} /> Retry</button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader title="Queue" sub="Approved and scheduled, soonest first" />
        {queue.length === 0 ? (
          <EmptyState title="Nothing in the queue">Approved posts appear here until they go out.</EmptyState>
        ) : (
          <Table>
            <thead><tr><th>When</th><th>Channel</th><th>Format</th><th>Item</th><th>Status</th></tr></thead>
            <tbody>{queue.map((it) => row(it))}</tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Recently published" />
        <Table>
          <thead><tr><th>When</th><th>Channel</th><th>Format</th><th>Item</th><th>Status</th></tr></thead>
          <tbody>{recent.map((it) => row(it))}</tbody>
        </Table>
      </Card>
    </>
  );
}

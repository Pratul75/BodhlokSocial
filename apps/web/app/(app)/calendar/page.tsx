import Link from "next/link";
import { and, asc, gte, lt } from "drizzle-orm";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { calendarItems, db } from "@bodh/db";
import { CHANNEL_LABELS, CHANNELS, FORMAT_LABELS, FORMATS, type Channel, type Format } from "@bodh/shared";
import { requireModule } from "@/lib/auth";
import { timeLabel, toIsoDate } from "@/lib/format";
import { Card, CardHeader, PageHeader, StatusPill, statusLabel } from "@/components/ui";
import { AgentRunPanel } from "@/components/agent-run-panel";
import { AddIdeaForm } from "./add-idea-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Content calendar" };

const STATUS_DOT: Record<string, string> = {
  idea: "bg-muted/40",
  drafted: "bg-dusk",
  in_review: "bg-turmeric",
  approved: "bg-leaf",
  scheduled: "bg-leaf",
  published: "bg-ink",
  failed: "bg-sindoor",
};

const CHANNEL_SHORT: Record<string, string> = {
  instagram: "IG",
  youtube: "YT",
  facebook: "FB",
  linkedin: "LI",
  seo: "Blog",
};

function startOfWeek(d: Date) {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); // Monday
  return s;
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; d?: string }> }) {
  await requireModule("calendar");
  const sp = await searchParams;
  const view = sp.view === "week" ? "week" : "month";
  const anchor = sp.d && !Number.isNaN(new Date(sp.d).getTime()) ? new Date(`${sp.d}T00:00`) : new Date();
  anchor.setHours(0, 0, 0, 0);

  let rangeStart: Date;
  let rangeEnd: Date;
  let prev: Date;
  let next: Date;
  let heading: string;
  if (view === "month") {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    rangeStart = startOfWeek(first);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    rangeEnd = startOfWeek(last);
    rangeEnd.setDate(rangeEnd.getDate() + 7);
    prev = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1);
    next = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    heading = anchor.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  } else {
    rangeStart = startOfWeek(anchor);
    rangeEnd = new Date(rangeStart);
    rangeEnd.setDate(rangeEnd.getDate() + 7);
    prev = new Date(rangeStart);
    prev.setDate(prev.getDate() - 7);
    next = new Date(rangeEnd);
    const endLabel = new Date(rangeEnd.getTime() - 86400000);
    heading = `${rangeStart.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${endLabel.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;
  }

  const items = await db
    .select()
    .from(calendarItems)
    .where(and(gte(calendarItems.scheduledAt, rangeStart), lt(calendarItems.scheduledAt, rangeEnd)))
    .orderBy(asc(calendarItems.scheduledAt));

  const days: Date[] = [];
  for (let d = new Date(rangeStart); d < rangeEnd; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  const byDay = new Map<string, typeof items>();
  for (const it of items) {
    const k = toIsoDate(it.scheduledAt);
    byDay.set(k, [...(byDay.get(k) ?? []), it]);
  }
  const todayKey = toIsoDate(new Date());
  const href = (v: string, d: Date) => `/calendar?view=${v}&d=${toIsoDate(d)}`;
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <>
      <PageHeader
        title="Content calendar"
        description="What goes out on each channel, and where each piece is between idea and published."
      />

      <Card className="mb-6">
        <AgentRunPanel
          agent="content"
          title="Content agent"
          sub="Drafts captions, scripts and creative briefs for the next 7 days each morning, following the approved plan. Drafts wait here for media and approval."
          label="Draft next week"
          placeholder="Optional: e.g. three Reels on Shani's transit, one carousel on nakshatras"
        />
      </Card>

      <Card className="mb-6">
        <CardHeader title="Add an idea" sub="Ideas start here. Open any item to write the caption, pick media and send it for approval." />
        <AddIdeaForm
          channels={CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABELS[c] }))}
          formats={FORMATS.map((f) => ({ value: f, label: FORMAT_LABELS[f] }))}
          defaultDate={todayKey}
        />
      </Card>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Link href={href(view, prev)} className="rounded-md p-1.5 text-muted hover:bg-card hover:text-ink" aria-label="Previous">
            <ChevronLeft size={18} />
          </Link>
          <Link href={href(view, next)} className="rounded-md p-1.5 text-muted hover:bg-card hover:text-ink" aria-label="Next">
            <ChevronRight size={18} />
          </Link>
          <h2 className="ml-2 font-display text-lg font-semibold tracking-tight">{heading}</h2>
          <Link href={href(view, new Date())} className="ml-3 text-sm text-dusk hover:underline">Today</Link>
        </div>
        <div className="flex rounded-lg bg-card p-0.5 ring-1 ring-rule">
          {(["month", "week"] as const).map((v) => (
            <Link
              key={v}
              href={href(v, anchor)}
              aria-current={view === v ? "page" : undefined}
              className={`rounded-md px-3 py-1 text-sm capitalize ${view === v ? "bg-night text-white" : "text-muted hover:text-ink"}`}
            >
              {v}
            </Link>
          ))}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {Object.entries(STATUS_DOT).map(([s, c]) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${c}`} /> {statusLabel(s)}
          </span>
        ))}
      </div>

      {view === "month" ? (
        <div className="overflow-x-auto rounded-xl border border-rule bg-rule">
          <div className="grid min-w-[640px] grid-cols-7 gap-px">
            {weekdays.map((w) => (
              <div key={w} className="bg-paper px-2.5 py-1.5 text-xs font-medium text-muted">{w}</div>
            ))}
            {days.map((d) => {
              const key = toIsoDate(d);
              const inMonth = d.getMonth() === anchor.getMonth();
              const list = byDay.get(key) ?? [];
              return (
                <div key={key} className={`min-h-[112px] p-2 ${inMonth ? "bg-card" : "bg-paper/60"}`}>
                  <div className={`mb-1 text-xs tabular ${key === todayKey ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-turmeric font-semibold text-night" : inMonth ? "text-ink" : "text-muted/60"}`}>
                    {d.getDate()}
                  </div>
                  <ul className="space-y-1">
                    {list.slice(0, 4).map((it) => (
                      <li key={it.id}>
                        <Link
                          href={`/calendar/${it.id}`}
                          className="-mx-1 flex items-start gap-1.5 rounded px-1 text-[12px] leading-tight hover:bg-paper"
                          title={`${CHANNEL_LABELS[it.channel as Channel]} · ${it.idea} · ${statusLabel(it.status)}`}
                        >
                          <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[it.status] ?? "bg-muted"}`} />
                          <span className="line-clamp-2">
                            <span className="font-medium text-muted">{CHANNEL_SHORT[it.channel] ?? CHANNEL_LABELS[it.channel as Channel]} </span>
                            {it.idea}
                          </span>
                        </Link>
                      </li>
                    ))}
                    {list.length > 4 && <li className="text-[11px] text-muted">+{list.length - 4} more</li>}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-7">
          {days.map((d, i) => {
            const key = toIsoDate(d);
            const list = byDay.get(key) ?? [];
            return (
              <div key={key} className="min-w-0">
                <div className={`mb-2 text-sm ${key === todayKey ? "font-semibold text-turmeric-ink" : "text-muted"}`}>
                  {weekdays[i]} <span className="tabular">{d.getDate()}</span>
                </div>
                <div className="space-y-2">
                  {list.length === 0 && <div className="rounded-lg border border-dashed border-rule px-2 py-3 text-center text-xs text-muted">Free</div>}
                  {list.map((it) => (
                    <Link key={it.id} href={`/calendar/${it.id}`} className="block rounded-lg border border-rule bg-card p-2.5 hover:border-dusk/40">
                      <div className="text-[11px] text-muted">
                        {timeLabel(it.scheduledAt)} · {CHANNEL_LABELS[it.channel as Channel] ?? it.channel}
                      </div>
                      <div className="mt-1 text-[13px] leading-snug font-medium">{it.idea}</div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <span className="text-[11px] text-muted">{FORMAT_LABELS[it.format as Format] ?? it.format}</span>
                        <StatusPill status={it.status} />
                      </div>
                      {it.error && <p className="mt-1.5 text-[11px] text-sindoor">{it.error}</p>}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

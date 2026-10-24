import Link from "next/link";
import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";
import { approvals, calendarItems, db, users } from "@bodh/db";
import { APPROVAL_KINDS, canApprove, CHANNEL_LABELS, type ApprovalKind, type Channel } from "@bodh/shared";
import { lintAdCopy } from "@bodh/guardrails";
import { requireModule } from "@/lib/auth";
import { ago } from "@/lib/format";
import { checkItem, itemAssets } from "@/lib/posts";
import { Card, CardHeader, EmptyState, PageHeader, StatusPill, Table } from "@/components/ui";
import { ApprovalCard, type ApprovalView } from "./approval-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approvals" };

const KIND_LABELS: Record<ApprovalKind, string> = {
  post: "Post",
  ad_change: "Ad change",
  reply: "Community reply",
  blog: "Blog",
  listing: "Directory listing",
};

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const user = await requireModule("approvals");
  const { kind } = await searchParams;
  const activeKind = (APPROVAL_KINDS as readonly string[]).includes(kind ?? "") ? (kind as ApprovalKind) : null;

  const [pending, counts, decided] = await Promise.all([
    db
      .select()
      .from(approvals)
      .where(activeKind ? and(eq(approvals.status, "pending"), eq(approvals.kind, activeKind)) : eq(approvals.status, "pending"))
      .orderBy(asc(approvals.createdAt)),
    db.select({ kind: approvals.kind, n: count() }).from(approvals).where(eq(approvals.status, "pending")).groupBy(approvals.kind),
    db
      .select({ a: approvals, by: users.name })
      .from(approvals)
      .leftJoin(users, eq(users.id, approvals.decidedBy))
      .where(ne(approvals.status, "pending"))
      .orderBy(desc(approvals.decidedAt))
      .limit(10),
  ]);

  const total = counts.reduce((s, c) => s + c.n, 0);
  const now = new Date();
  const itemIds = pending.map((a) => a.calendarItemId).filter((x): x is string => Boolean(x));
  const items = itemIds.length ? await db.select().from(calendarItems).where(inArray(calendarItems.id, itemIds)) : [];
  const postInfo = new Map(
    await Promise.all(
      items.map(async (it) => {
        const list = await itemAssets(it);
        return [it.id, { item: it, assets: list, check: await checkItem(it, list) }] as const;
      }),
    ),
  );
  const views: ApprovalView[] = pending.map((a) => {
    const post = a.calendarItemId ? postInfo.get(a.calendarItemId) : undefined;
    const payload = a.payload as Record<string, unknown>;
    const flags: string[] = [];
    if (payload.needsJyotishReview) flags.push("Needs Jyotish review");
    return {
      id: a.id,
      kind: a.kind,
      kindLabel: KIND_LABELS[a.kind as ApprovalKind] ?? a.kind,
      channelLabel: CHANNEL_LABELS[a.channel as Channel] ?? a.channel,
      agent: a.agent,
      title: a.title,
      body: a.body,
      reason: a.reason,
      createdLabel: ago(a.createdAt, now),
      flags,
      // Calendar posts get the full post check, which includes these copy rules.
      copyIssues: post ? [] : a.kind === "ad_change" || a.kind === "post" ? lintAdCopy(`${a.title}\n${a.body}`) : [],
      canDecide: canApprove(user.role, a.kind as ApprovalKind),
      assets: post?.assets,
      calendarItemId: a.calendarItemId,
      scheduledLabel: post ? post.item.scheduledAt.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : undefined,
      checkErrors: post?.check.errors,
      checkWarnings: post?.check.warnings,
    };
  });

  const tabs = [{ key: null, label: "All", n: total }, ...APPROVAL_KINDS.map((k) => ({ key: k, label: KIND_LABELS[k], n: counts.find((c) => c.kind === k)?.n ?? 0 }))];

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Every post, ad change, reply and listing an agent drafts waits here. Nothing goes public until someone approves it."
      />

      <nav className="mb-5 flex flex-wrap gap-1.5" aria-label="Filter by kind">
        {tabs.map((t) => {
          const active = t.key === activeKind;
          return (
            <Link
              key={t.label}
              href={t.key ? `/approvals?kind=${t.key}` : "/approvals"}
              aria-current={active ? "page" : undefined}
              className={`rounded-full px-3 py-1 text-sm transition-colors ${active ? "bg-night text-white" : "bg-card text-muted ring-1 ring-rule hover:text-ink"}`}
            >
              {t.label} <span className="font-mono text-xs tabular opacity-70">{t.n}</span>
            </Link>
          );
        })}
      </nav>

      {views.length === 0 ? (
        <Card>
          <EmptyState title="Nothing waiting here">
            Agents add drafts after each run. Check back after the next Content or Ads agent run.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {views.map((v) => (
            <ApprovalCard key={v.id} item={v} />
          ))}
        </div>
      )}

      <Card className="mt-8">
        <CardHeader title="Recently decided" />
        {decided.length === 0 ? (
          <EmptyState title="No decisions yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Decision</th>
                <th>By</th>
                <th>When</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {decided.map(({ a, by }) => (
                <tr key={a.id}>
                  <td className="max-w-[340px] truncate">{a.title}</td>
                  <td><StatusPill status={a.status} /></td>
                  <td className="text-muted">{by ?? "—"}</td>
                  <td className="text-muted">{a.decidedAt ? ago(a.decidedAt, now) : "—"}</td>
                  <td className="max-w-[240px] truncate text-muted">{a.decisionNote ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

import Link from "next/link";
import { desc } from "drizzle-orm";
import { communityItems, db } from "@bodh/db";
import { requireModule } from "@/lib/auth";
import { ago } from "@/lib/format";
import { Card, CardHeader, EmptyState, PageHeader, Pill, StatusPill } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Community" };

const PLATFORM: Record<string, string> = { reddit: "Reddit", quora: "Quora", youtube: "YouTube comments" };
const STAGES = [
  { key: "found", label: "Found" },
  { key: "drafted", label: "Drafted" },
  { key: "in_review", label: "In review" },
  { key: "posted", label: "Posted" },
];

export default async function CommunityPage() {
  await requireModule("community");
  const items = await db.select().from(communityItems).orderBy(desc(communityItems.foundAt));
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Community"
        description="Real questions on Reddit, Quora and YouTube where a helpful answer from the Bodhlok team fits. Every answer is posted from a named account and says who we are."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {STAGES.map((s) => {
          const list = items.filter((i) => i.status === s.key);
          return (
            <Card key={s.key}>
              <CardHeader title={s.label} aside={<span className="font-mono text-sm text-muted tabular">{list.length}</span>} />
              {list.length === 0 ? (
                <EmptyState title="None" />
              ) : (
                <ul className="divide-y divide-rule">
                  {list.map((i) => (
                    <li key={i.id} className="px-4 py-3">
                      <div className="flex items-center gap-2 text-xs text-muted">
                        <Pill>{PLATFORM[i.platform] ?? i.platform}</Pill>
                        <span>{ago(i.foundAt, now)}</span>
                      </div>
                      <p className="mt-1.5 text-sm font-medium">{i.question}</p>
                      {i.draft && <p className="mt-1 line-clamp-2 text-xs text-muted">{i.draft}</p>}
                      {i.status === "in_review" && (
                        <Link href="/approvals?kind=reply" className="mt-1.5 inline-block text-xs text-dusk hover:underline">
                          Review in Approvals
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
      {items.some((i) => i.status === "skipped") && (
        <p className="mt-4 text-xs text-muted">
          Skipped: {items.filter((i) => i.status === "skipped").map((i) => i.question).join(", ")}. <StatusPill status="skipped" />
        </p>
      )}
    </>
  );
}

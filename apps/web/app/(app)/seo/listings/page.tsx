import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, directoryListings } from "@bodh/db";
import { requireModule } from "@/lib/auth";
import { ago } from "@/lib/format";
import { AgentRunPanel } from "@/components/agent-run-panel";
import { Card, EmptyState, PageHeader, Pill, StatusPill, Table } from "@/components/ui";
import { SkipListingButton, SubmittedForm } from "./forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Directory listings" };

const CATEGORY: Record<string, string> = {
  software_directory: "Software directory",
  review_site: "Review site",
  best_of_list: "Best-of list",
  association: "Association",
  other: "Other",
};

export default async function ListingsPage() {
  await requireModule("seo");
  const rows = await db.select().from(directoryListings).orderBy(desc(directoryListings.updatedAt)).limit(300);
  const now = new Date();
  const live = rows.filter((r) => r.status === "submitted").length;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/seo" className="hover:underline">SEO &amp; GEO</Link>}
        title="Directory listings"
        description={`Places Bodhlok should be listed, found and drafted by the Mentions agent. ${live} submitted. A person approves each listing, then submits it by hand and records the link here.`}
      />
      <Card className="mb-6">
        <AgentRunPanel
          agent="mentions"
          title="Mentions agent"
          sub="Runs Tuesdays at 05:00. Finds directories and drafts up to 6 listings into Approvals."
          label="Run Mentions agent"
          placeholder="Optional: e.g. focus on directories institutes use"
        />
      </Card>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No directories yet">The Mentions agent adds them here. Run it above, or wait for Tuesday&apos;s run.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Directory</th>
                <th>Type</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Next step</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const draft = r.draft as { tagline?: string };
                return (
                  <tr key={r.id}>
                    <td className="min-w-[220px]">
                      <a href={r.url} target="_blank" rel="noreferrer" className="font-medium hover:text-dusk">{r.name}</a>
                      <div className="text-xs text-muted">{r.why}</div>
                      {draft.tagline && <div className="mt-1 text-xs italic text-muted">{draft.tagline}</div>}
                      {r.reviewNote && r.status === "drafted" && <div className="mt-1 text-xs text-turmeric-ink">Reviewer: {r.reviewNote}</div>}
                    </td>
                    <td className="whitespace-nowrap"><Pill>{CATEGORY[r.category] ?? r.category}</Pill></td>
                    <td><StatusPill status={r.status} /></td>
                    <td className="whitespace-nowrap text-muted">{ago(r.updatedAt, now)}</td>
                    <td className="min-w-[240px]">
                      {r.status === "in_review" && <Link href="/approvals?kind=listing" className="text-xs text-dusk hover:underline">Review in Approvals</Link>}
                      {r.status === "approved" && <SubmittedForm id={r.id} />}
                      {r.status === "submitted" && r.submittedUrl && <a href={r.submittedUrl} target="_blank" rel="noreferrer" className="text-xs text-dusk hover:underline">Live listing</a>}
                      {(r.status === "found" || r.status === "drafted" || r.status === "approved") && <SkipListingButton id={r.id} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

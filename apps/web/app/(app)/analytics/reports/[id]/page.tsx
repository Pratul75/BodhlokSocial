import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, reports } from "@bodh/db";
import { requireModule } from "@/lib/auth";
import { Markdown } from "@/components/markdown";
import { Card, PageHeader, StatusPill } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Report" };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule("analytics");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [r] = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
  if (!r) notFound();
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/analytics" className="hover:underline">Analytics</Link>}
        title={r.title}
        description={<span className="inline-flex items-center gap-2"><StatusPill status={r.kind} /> {r.periodStart} to {r.periodEnd}, written by the Analyst agent</span>}
      />
      <Card className="px-6 py-5">
        <Markdown text={r.body} className="space-y-3 text-[15px] leading-relaxed" />
      </Card>
    </>
  );
}

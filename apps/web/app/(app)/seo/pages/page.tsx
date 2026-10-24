import Link from "next/link";
import { and, asc, eq, type SQL } from "drizzle-orm";
import { db, seoPages } from "@bodh/db";
import { TEMPLATE_LABELS, type Template } from "@bodh/integrations/seo-catalog";
import { requireModule } from "@/lib/auth";
import { Card, PageHeader, StatusPill, Table } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "SEO pages" };

const STATUS_LABEL: Record<string, string> = { planned: "planned", drafted: "changes asked", in_review: "in_review", live: "live" };

export default async function SeoPagesList({ searchParams }: { searchParams: Promise<{ template?: string; status?: string }> }) {
  await requireModule("seo");
  const { template, status } = await searchParams;
  const where: SQL[] = [];
  if (template && template in TEMPLATE_LABELS) where.push(eq(seoPages.template, template));
  if (status) where.push(eq(seoPages.status, status));
  const pages = await db.select().from(seoPages).where(where.length ? and(...where) : undefined).orderBy(asc(seoPages.template), asc(seoPages.slug)).limit(500);
  const chip = (href: string, label: string, active: boolean) => (
    <Link key={label} href={href} aria-current={active ? "page" : undefined} className={`rounded-full px-3 py-1 text-sm ring-1 ring-rule ${active ? "bg-night text-white" : "text-muted hover:text-ink"}`}>
      {label}
    </Link>
  );
  const q = (t?: string, s?: string) => `/seo/pages?${new URLSearchParams({ ...(t ? { template: t } : {}), ...(s ? { status: s } : {}) })}`;

  return (
    <>
      <PageHeader eyebrow={<Link href="/seo" className="hover:underline">SEO & GEO</Link>} title="SEO pages" description="Every programmatic page and blog, from planned to live." />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {chip(q(undefined, status), "All templates", !template)}
        {(Object.keys(TEMPLATE_LABELS) as Template[]).map((t) => chip(q(t, status), TEMPLATE_LABELS[t], template === t))}
      </div>
      <div className="mb-5 flex flex-wrap gap-1.5">
        {chip(q(template), "Any status", !status)}
        {["planned", "in_review", "drafted", "live"].map((s) => chip(q(template, s), s === "drafted" ? "Changes asked" : s === "in_review" ? "In review" : s[0]!.toUpperCase() + s.slice(1), status === s))}
      </div>
      <Card>
        <Table>
          <thead>
            <tr>
              <th>Page</th>
              <th>Template</th>
              <th>Keyword</th>
              <th>Status</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((p) => (
              <tr key={p.id}>
                <td className="font-medium">{p.body ? <Link href={`/seo/pages/${p.id}`} className="hover:underline">{p.title}</Link> : p.title}</td>
                <td className="text-muted">{TEMPLATE_LABELS[p.template as Template] ?? p.template}</td>
                <td className="text-muted">{p.keyword}</td>
                <td><StatusPill status={STATUS_LABEL[p.status] ?? p.status} /></td>
                <td className="text-muted">{p.body ? p.updatedAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        {pages.length === 0 && <p className="px-5 py-6 text-sm text-muted">No pages match.</p>}
      </Card>
    </>
  );
}

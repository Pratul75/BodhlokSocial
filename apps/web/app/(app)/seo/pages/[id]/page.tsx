import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, seoPages } from "@bodh/db";
import { CITIES, istTime } from "@bodh/integrations/panchang";
import { TEMPLATE_LABELS, type Template } from "@bodh/integrations/seo-catalog";
import { requireModule } from "@/lib/auth";
import { jsonLd, panchangWeek, siteUrl, SITE_PATHS } from "@/lib/seo-feed";
import { Markdown } from "@/components/markdown";
import { Card, CardHeader, PageHeader, Pill, StatusPill } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Page preview" };

export default async function SeoPagePreview({ params }: { params: Promise<{ id: string }> }) {
  await requireModule("seo");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [page] = await db.select().from(seoPages).where(eq(seoPages.id, id)).limit(1);
  if (!page) notFound();
  const url = `${await siteUrl()}${SITE_PATHS[page.template]?.(page.slug, page.params) ?? `/${page.slug}`}`;
  const today = page.template === "panchang_city" ? panchangWeek(String(page.params.city ?? ""))[0] : undefined;
  const city = CITIES.find((c) => c.slug === page.params.city);

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/seo/pages" className="hover:underline">SEO pages</Link> · {TEMPLATE_LABELS[page.template as Template] ?? page.template} <StatusPill status={page.status === "drafted" ? "changes asked" : page.status} />
            {page.needsReview && <Pill tone="turmeric">Needs Jyotish review</Pill>}
          </span>
        }
        title={page.title}
        description={<span className="font-mono text-xs">{url}</span>}
      />
      {page.reviewNote && <p className="mb-5 rounded-xl bg-turmeric-soft px-5 py-3 text-sm text-turmeric-ink"><span className="font-medium">Changes asked:</span> {page.reviewNote}</p>}
      {page.siteStatus && (
        <p className={`mb-5 rounded-xl px-5 py-3 text-sm ${page.siteStatus === "failed" ? "bg-sindoor-soft text-sindoor" : "bg-paper text-ink"}`}>
          <span className="font-medium">bodhlok.com:</span>{" "}
          {page.siteStatus === "live" && page.siteUrl ? <>live at <a href={page.siteUrl} className="underline" target="_blank" rel="noreferrer">{page.siteUrl}</a></>
            : page.siteStatus === "pr_open" ? <>waiting for the <a href={page.sitePrUrl ?? "#"} className="underline" target="_blank" rel="noreferrer">pull request</a> to be merged</>
            : page.siteStatus === "merged" ? "merged; the site is deploying (about 10 minutes)"
            : page.siteStatus === "queued" ? "approved; goes into the next pull request (daily at 10:00, or from the SEO page now)"
            : page.siteStatus === "failed" ? `publishing failed: ${page.siteError ?? "unknown error"}`
            : page.siteStatus}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card className="p-6">
          {page.description && <p className="mb-4 text-sm text-muted"><span className="text-xs">Meta description: </span>{page.description}</p>}
          {page.answer && <div className="mb-5 rounded-xl border-l-4 border-dusk bg-paper px-4 py-3 text-[15px] leading-relaxed">{page.answer}</div>}
          {today && city && (
            <div className="mb-5 grid grid-cols-2 gap-3 rounded-xl bg-paper p-4 text-sm sm:grid-cols-3">
              <div><div className="text-xs text-muted">Tithi</div>{today.tithi.paksha} {today.tithi.name} <span className="text-muted">to {istTime(today.tithi.endsAt)}</span></div>
              <div><div className="text-xs text-muted">Nakshatra</div>{today.nakshatra.name} <span className="text-muted">to {istTime(today.nakshatra.endsAt)}</span></div>
              <div><div className="text-xs text-muted">Yoga</div>{today.yoga.name}</div>
              <div><div className="text-xs text-muted">Sunrise / sunset</div>{istTime(today.sunrise)} / {istTime(today.sunset)}</div>
              <div><div className="text-xs text-muted">Rahu Kaal</div>{istTime(today.rahuKaal.start)} to {istTime(today.rahuKaal.end)}</div>
              <div><div className="text-xs text-muted">Vara</div>{today.vara}</div>
            </div>
          )}
          {page.body ? <Markdown text={page.body} className="space-y-3 text-[15px] leading-relaxed" /> : <p className="text-muted">Not drafted yet. The SEO agent writes planned pages, highest search volume first.</p>}
          {page.faq.length > 0 && (
            <div className="mt-8">
              <h2 className="font-display text-lg font-semibold">Frequently asked questions</h2>
              <dl className="mt-3 space-y-3 text-[15px]">
                {page.faq.map((f) => (
                  <div key={f.q}>
                    <dt className="font-medium">{f.q}</dt>
                    <dd className="mt-0.5 text-ink/85">{f.a}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </Card>
        <div className="space-y-6">
          {page.brief && (
            <Card>
              <CardHeader title="Brief" sub={page.keyword ? `Target: ${page.keyword}` : undefined} />
              <p className="px-5 py-4 text-sm whitespace-pre-wrap">{page.brief}</p>
            </Card>
          )}
          <Card>
            <CardHeader title="Schema (JSON-LD)" sub="Sent with the page in the feed" />
            <pre className="max-h-[420px] overflow-auto px-5 py-4 font-mono text-[11px] leading-relaxed">{JSON.stringify(jsonLd(page, url), null, 2)}</pre>
          </Card>
        </div>
      </div>
    </>
  );
}

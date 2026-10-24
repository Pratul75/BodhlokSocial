import { asc, count, desc, sql } from "drizzle-orm";
import { aiVisibilityChecks, db, keywords, seoPages } from "@bodh/db";
import { requireModule } from "@/lib/auth";
import { num, pct } from "@/lib/format";
import { PeriodBars } from "@/components/charts";
import { Card, CardHeader, PageHeader, Pill, Table } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "SEO & GEO" };

const ENGINES = [
  { key: "chatgpt", label: "ChatGPT" },
  { key: "gemini", label: "Gemini" },
  { key: "perplexity", label: "Perplexity" },
];
const PAGE_STATUSES = [
  { key: "live", label: "Live", cls: "bg-leaf" },
  { key: "in_review", label: "In review", cls: "bg-turmeric" },
  { key: "drafted", label: "Drafted", cls: "bg-dusk" },
  { key: "planned", label: "Planned", cls: "bg-rule" },
];

export default async function SeoPage() {
  await requireModule("seo");
  const [kws, pageCounts, pageClicks, weekly, latestChecks] = await Promise.all([
    db.select().from(keywords).orderBy(desc(keywords.volume)),
    db.select({ status: seoPages.status, n: count() }).from(seoPages).groupBy(seoPages.status),
    db.select().from(seoPages).where(sql`${seoPages.status} = 'live'`).orderBy(desc(seoPages.clicks28d)).limit(5),
    db
      .select({
        week: aiVisibilityChecks.checkedAt,
        rate: sql<number>`avg(case when ${aiVisibilityChecks.mentioned} then 1 else 0 end)::float`,
      })
      .from(aiVisibilityChecks)
      .groupBy(aiVisibilityChecks.checkedAt)
      .orderBy(asc(aiVisibilityChecks.checkedAt)),
    db
      .select()
      .from(aiVisibilityChecks)
      .where(sql`${aiVisibilityChecks.checkedAt} = (select max(checked_at) from ai_visibility_checks)`),
  ]);

  const totalPages = pageCounts.reduce((s, p) => s + p.n, 0);
  const questions = [...new Set(latestChecks.map((c) => c.question))];
  const weeks = weekly.map((w) => ({
    label: new Date(`${w.week}T00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
    rate: Math.round(w.rate * 100),
  }));

  return (
    <>
      <PageHeader
        title="SEO & GEO"
        description="Search rankings for the keywords BODH targets, programmatic pages from BODH's engine, and whether AI assistants recommend Asttrolok."
      />

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Programmatic pages" sub={`Planets in houses: ${num(totalPages)} pages. Nakshatras, yogas, Lagnas and city Panchang follow.`} />
          <div className="px-5 py-4">
            <div className="flex h-3 overflow-hidden rounded-full bg-paper" role="img" aria-label="Pages by status">
              {PAGE_STATUSES.map((s) => {
                const n = pageCounts.find((p) => p.status === s.key)?.n ?? 0;
                return <div key={s.key} className={s.cls} style={{ width: `${(n / Math.max(totalPages, 1)) * 100}%` }} />;
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {PAGE_STATUSES.map((s) => (
                <span key={s.key} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${s.cls}`} /> {s.label}{" "}
                  <span className="font-mono text-muted tabular">{pageCounts.find((p) => p.status === s.key)?.n ?? 0}</span>
                </span>
              ))}
            </div>
            <h3 className="mt-5 mb-2 text-xs font-medium text-muted">Top live pages, last 28 days</h3>
            <ul className="space-y-1.5 text-sm">
              {pageClicks.map((p) => (
                <li key={p.id} className="flex justify-between gap-3">
                  <span className="truncate">{p.title}</span>
                  <span className="font-mono text-muted tabular">{num(p.clicks28d)} clicks</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card>
          <CardHeader title="AI visibility" sub="Share of checks where ChatGPT, Gemini or Perplexity mention Asttrolok, per week" />
          <PeriodBars data={weeks} valueKey="rate" format={(n) => `${n}%`} height={120} />
          <div className="border-t border-rule">
            <Table>
              <thead>
                <tr>
                  <th>Question, latest check</th>
                  {ENGINES.map((e) => <th key={e.key} className="text-center">{e.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {questions.map((q) => (
                  <tr key={q}>
                    <td className="min-w-[180px] text-sm">{q}</td>
                    {ENGINES.map((e) => {
                      const hit = latestChecks.find((c) => c.question === q && c.engine === e.key)?.mentioned;
                      return (
                        <td key={e.key} className="text-center">
                          {hit ? <Pill tone="leaf">Mentioned</Pill> : <span className="text-xs text-muted">No</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Keywords" sub="Positions from Search Console and DataForSEO once connected" />
        <Table>
          <thead>
            <tr>
              <th>Keyword</th>
              <th>Intent</th>
              <th className="text-right">Monthly searches</th>
              <th className="text-right">Difficulty</th>
              <th className="text-right">Our position</th>
              <th>Page</th>
            </tr>
          </thead>
          <tbody>
            {kws.map((k) => (
              <tr key={k.id}>
                <td className="font-medium">{k.keyword}</td>
                <td><Pill tone={k.intent === "software" ? "dusk" : k.intent === "tool" ? "turmeric" : "neutral"}>{k.intent === "tool" ? "Free tool" : k.intent === "software" ? "Software" : "Learn"}</Pill></td>
                <td className="text-right font-mono tabular">{num(k.volume)}</td>
                <td className="text-right font-mono tabular">{k.difficulty}</td>
                <td className={`text-right font-mono tabular ${k.position && k.position <= 10 ? "text-leaf" : ""}`}>
                  {k.position ?? <span className="text-sindoor">No page</span>}
                </td>
                <td className="text-muted">{k.pageUrl ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <p className="mt-4 text-xs text-muted">
        Page-one keywords: {kws.filter((k) => k.position && k.position <= 10).length} of {kws.length} ({pct(kws.filter((k) => k.position && k.position <= 10).length / Math.max(kws.length, 1), 0)}).
      </p>
    </>
  );
}

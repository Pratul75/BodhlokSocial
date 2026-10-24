import Link from "next/link";
import { asc, desc, eq, sql } from "drizzle-orm";
import { aiVisibilityChecks, connections, db, geoQuestions, keywords, seoAudits } from "@bodh/db";
import { ENGINE_LABELS, ENGINES, ensureGeoQuestions } from "@bodh/agents";
import { ensurePageCatalog, latestAudit, pageCounts } from "@bodh/integrations/seo";
import { TEMPLATE_LABELS, type Template } from "@bodh/integrations/seo-catalog";
import { requireModule } from "@/lib/auth";
import { num, pct } from "@/lib/format";
import { PeriodBars } from "@/components/charts";
import { AgentRunPanel } from "@/components/agent-run-panel";
import { JobButton } from "@/components/job-button";
import { Card, CardHeader, EmptyState, PageHeader, Pill, Table, btn, inputClass } from "@/components/ui";
import { addQuestion, seoJobAction, toggleQuestion } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "SEO & GEO" };

const STATUSES = [
  { key: "live", label: "Live", cls: "bg-leaf" },
  { key: "in_review", label: "In review", cls: "bg-turmeric" },
  { key: "drafted", label: "Changes asked", cls: "bg-sindoor/70" },
  { key: "planned", label: "Planned", cls: "bg-rule" },
];
const TEMPLATES: Template[] = ["planet_house", "nakshatra", "yoga", "lagna", "panchang_city", "blog"];
const fmt = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function SeoPage({ searchParams }: { searchParams: Promise<{ kw?: string }> }) {
  const user = await requireModule("seo");
  const { kw } = await searchParams;
  await ensureGeoQuestions();
  if ((await pageCounts()).length === 0) await ensurePageCatalog();
  const [kws, counts, weekly, latestChecks, questions, audit, running, conns] = await Promise.all([
    db
      .select()
      .from(keywords)
      .where(kw === "ranking" ? sql`${keywords.position} is not null` : kw === "missing" ? sql`${keywords.position} is null` : undefined)
      .orderBy(desc(keywords.volume), desc(keywords.impressions28d))
      .limit(100),
    pageCounts(),
    db
      .select({
        day: aiVisibilityChecks.checkedAt,
        rate: sql<number>`avg(case when ${aiVisibilityChecks.mentioned} then 1 else 0 end)::float`,
      })
      .from(aiVisibilityChecks)
      .where(sql`${aiVisibilityChecks.error} is null`)
      .groupBy(aiVisibilityChecks.checkedAt)
      .orderBy(asc(aiVisibilityChecks.checkedAt)),
    db.select().from(aiVisibilityChecks).where(sql`${aiVisibilityChecks.checkedAt} = (select max(checked_at) from ai_visibility_checks)`),
    db.select().from(geoQuestions).orderBy(desc(geoQuestions.active), asc(geoQuestions.createdAt)),
    latestAudit(),
    db.select().from(seoAudits).where(eq(seoAudits.status, "running")).limit(1),
    db.select().from(connections).where(sql`${connections.key} in ('dataforseo','search_console','openai','perplexity','vertex','anthropic')`),
  ]);
  const connected = (k: string) => conns.find((c) => c.key === k)?.status === "connected";

  const total = counts.reduce((s, c) => s + c.n, 0);
  const n = (status: string, template?: string) => counts.filter((c) => c.status === status && (!template || c.template === template)).reduce((s, c) => s + c.n, 0);
  const asked = [...new Set(latestChecks.map((c) => c.question))];
  const engines = ENGINES.filter((e) => latestChecks.some((c) => c.engine === e));
  const answered = latestChecks.filter((c) => !c.error);
  const competitors = Object.entries(
    answered.flatMap((c) => c.competitors).reduce<Record<string, number>>((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {}),
  ).sort((a, b) => b[1] - a[1]);
  const weeks = weekly.map((w) => ({ label: new Date(`${w.day}T00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }), rate: Math.round(w.rate * 100) }));
  const pageOne = kws.filter((k) => k.position && k.position <= 10).length;

  return (
    <>
      <PageHeader
        title="SEO & GEO"
        description="Search rankings, programmatic pages for BODH's site, the weekly site audit, and whether AI assistants recommend Asttrolok."
        actions={<Link href="/seo/pages" className={btn.secondary}>All pages</Link>}
      />

      <Card className="mb-6">
        <AgentRunPanel
          agent="seo"
          title="SEO agent"
          sub="Every Monday it drafts the next programmatic pages and a blog, highest search volume first. Drafts go to Approvals; approved pages go live in the page feed."
          label="Run SEO agent"
          placeholder="Optional: e.g. write all 27 nakshatra pages, or a blog on Shani's transit"
        />
      </Card>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Programmatic pages" sub={`${num(n("live"))} live of ${num(total)}. Each opens with a direct answer and an FAQ with schema.`} />
          <div className="px-5 py-4">
            <div className="flex h-3 overflow-hidden rounded-full bg-paper" role="img" aria-label="Pages by status">
              {STATUSES.map((s) => (
                <div key={s.key} className={s.cls} style={{ width: `${(n(s.key) / Math.max(total, 1)) * 100}%` }} />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {STATUSES.map((s) => (
                <span key={s.key} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${s.cls}`} /> {s.label} <span className="font-mono text-muted tabular">{n(s.key)}</span>
                </span>
              ))}
            </div>
          </div>
          <Table>
            <thead>
              <tr>
                <th>Template</th>
                <th className="text-right">Live</th>
                <th className="text-right">In review</th>
                <th className="text-right">Planned</th>
              </tr>
            </thead>
            <tbody>
              {TEMPLATES.map((t) => (
                <tr key={t}>
                  <td><Link href={`/seo/pages?template=${t}`} className="hover:underline">{TEMPLATE_LABELS[t]}</Link></td>
                  <td className="text-right font-mono tabular">{n("live", t)}</td>
                  <td className="text-right font-mono tabular">{n("in_review", t)}</td>
                  <td className="text-right font-mono tabular">{n("planned", t) + n("drafted", t)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card>
          <CardHeader
            title="AI visibility"
            sub="Share of answers that mention Asttrolok, each Monday"
            aside={<JobButton action={seoJobAction} job="geo" label="Check now" pendingLabel="Starting…" />}
          />
          {weeks.length ? (
            <PeriodBars data={weeks} valueKey="rate" format={(v) => `${v}%`} height={110} />
          ) : (
            <p className="px-5 py-4 text-sm text-muted">
              No checks yet. They use ChatGPT ({connected("openai") ? "connected" : "add an OpenAI key"}), Gemini ({connected("vertex") ? "connected" : "connect Vertex AI"}), Perplexity (
              {connected("perplexity") ? "connected" : "add a key"}) and Claude ({connected("anthropic") ? "connected" : "add a key"}) in{" "}
              <Link href="/connections" className="underline">Connections</Link>.
            </p>
          )}
          {asked.length > 0 && (
            <div className="border-t border-rule">
              <Table>
                <thead>
                  <tr>
                    <th>Latest check</th>
                    {engines.map((e) => <th key={e} className="text-center">{ENGINE_LABELS[e]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {asked.map((q) => (
                    <tr key={q}>
                      <td className="min-w-[200px] text-sm">{q}</td>
                      {engines.map((e) => {
                        const c = latestChecks.find((x) => x.question === q && x.engine === e);
                        return (
                          <td key={e} className="text-center" title={c?.error ?? c?.competitors.join(", ")}>
                            {c?.error ? <span className="text-xs text-sindoor">Error</span> : c?.mentioned ? <Pill tone="leaf">Yes</Pill> : <span className="text-xs text-muted">No</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </Table>
              {competitors.length > 0 && (
                <p className="border-t border-rule px-5 py-3 text-xs text-muted">
                  Named instead: {competitors.slice(0, 8).map(([c, k]) => `${c} (${k})`).join(", ")}
                </p>
              )}
            </div>
          )}
          <details className="border-t border-rule px-5 py-3 text-sm">
            <summary className="cursor-pointer text-muted">Questions asked ({questions.filter((q) => q.active).length})</summary>
            <ul className="mt-3 space-y-1.5">
              {questions.map((q) => (
                <li key={q.id} className="flex items-start justify-between gap-3">
                  <span className={q.active ? "" : "text-muted line-through"}>{q.question}</span>
                  <form action={toggleQuestion}>
                    <input type="hidden" name="id" value={q.id} />
                    <button className="text-xs text-dusk hover:underline">{q.active ? "Stop asking" : "Ask again"}</button>
                  </form>
                </li>
              ))}
            </ul>
            <form action={addQuestion} className="mt-3 flex gap-2">
              <label htmlFor="geo-q" className="sr-only">New question</label>
              <input id="geo-q" name="question" className={inputClass} placeholder="A question your customers ask an AI assistant" minLength={10} maxLength={200} />
              <button className={btn.secondary}>Add</button>
            </form>
          </details>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader
          title="Site audit"
          sub={audit ? `${audit.target}, crawled ${audit.finishedAt ? fmt(audit.finishedAt) : ""}: ${num(audit.pagesCrawled)} pages` : "A DataForSEO crawl of BODH's site every Sunday"}
          aside={
            running.length ? (
              <span className="text-xs text-muted">Crawl running: {num(running[0]!.pagesCrawled)} pages so far</span>
            ) : (
              <JobButton action={seoJobAction} job="audit-start" label="Start audit" pendingLabel="Starting…" />
            )
          }
        />
        {audit ? (
          <div className="grid gap-6 px-5 py-4 lg:grid-cols-[160px_1fr]">
            <div>
              <div className="text-xs text-muted">On-page score</div>
              <div className="mt-1 font-mono text-[28px] font-medium tabular">{audit.onpageScore ? Number(audit.onpageScore).toFixed(0) : "—"}</div>
              <div className="text-xs text-muted">out of 100</div>
            </div>
            <ul className="divide-y divide-rule text-sm">
              {audit.issues.slice(0, 10).map((i) => (
                <li key={i.check} className="py-2">
                  <div className="flex justify-between gap-3">
                    <span className="font-medium">{i.label}</span>
                    <span className="font-mono text-muted tabular">{num(i.pages)} pages</span>
                  </div>
                  {i.examples.length > 0 && <p className="mt-0.5 truncate text-xs text-muted">{i.examples.slice(0, 3).join("  ·  ")}</p>}
                </li>
              ))}
              {audit.issues.length === 0 && <li className="py-2 text-leaf">No failing checks.</li>}
            </ul>
          </div>
        ) : (
          <EmptyState title={connected("dataforseo") ? "No audit yet" : "Connect DataForSEO"}>
            {connected("dataforseo") ? "Start one now, or wait for Sunday's." : <>Add the login, password and site domain in <Link href="/connections" className="underline">Connections</Link>.</>}
          </EmptyState>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Keywords"
          sub={`From DataForSEO and Search Console. Page one: ${pageOne} of ${kws.length} (${pct(pageOne / Math.max(kws.length, 1), 0)}).`}
          aside={<JobButton action={seoJobAction} job="keywords" label="Refresh keywords" pendingLabel="Refreshing…" />}
        />
        <nav className="flex gap-1.5 px-5 pt-3 text-sm" aria-label="Filter keywords">
          {[
            { k: undefined, label: "All" },
            { k: "ranking", label: "Ranking" },
            { k: "missing", label: "Not ranking" },
          ].map((f) => (
            <Link key={f.label} href={f.k ? `/seo?kw=${f.k}` : "/seo"} aria-current={kw === f.k ? "page" : undefined} className={`rounded-full px-3 py-1 ring-1 ring-rule ${kw === f.k ? "bg-night text-white" : "text-muted hover:text-ink"}`}>
              {f.label}
            </Link>
          ))}
        </nav>
        {kws.length ? (
          <Table>
            <thead>
              <tr>
                <th>Keyword</th>
                <th>Intent</th>
                <th className="text-right">Monthly searches</th>
                <th className="text-right">Difficulty</th>
                <th className="text-right">Clicks, 28 days</th>
                <th className="text-right">Position</th>
                <th>Page</th>
              </tr>
            </thead>
            <tbody>
              {kws.map((k) => (
                <tr key={k.id}>
                  <td className="font-medium">{k.keyword}</td>
                  <td><Pill tone={k.intent === "software" ? "dusk" : k.intent === "tool" ? "turmeric" : "neutral"}>{k.intent === "tool" ? "Free tool" : k.intent === "software" ? "App" : "Learn"}</Pill></td>
                  <td className="text-right font-mono tabular">{k.volume ? num(k.volume) : "—"}</td>
                  <td className="text-right font-mono tabular">{k.source === "search_console" && !k.difficulty ? "—" : k.difficulty}</td>
                  <td className="text-right font-mono tabular">{k.clicks28d ?? "—"}</td>
                  <td className={`text-right font-mono tabular ${k.position && k.position <= 10 ? "text-leaf" : ""}`}>{k.position ?? <span className="text-muted">—</span>}</td>
                  <td className="max-w-[220px] truncate text-muted">{k.pageUrl?.replace(/^https?:\/\/(www\.)?/, "") ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No keywords yet">Connect DataForSEO or Search Console, then refresh.</EmptyState>
        )}
      </Card>

      {user.role === "admin" && <FeedCard />}
    </>
  );
}

async function FeedCard() {
  const token = process.env.SEO_FEED_TOKEN;
  const base = `${process.env.APP_URL ?? ""}/api/feed`;
  return (
    <Card className="mt-6">
      <CardHeader title="Page feed for BODH's website" sub="Approved pages, live Panchang and llms.txt, for the web team to pull. Admins only." />
      {token ? (
        <div className="space-y-2 px-5 py-4 text-sm">
          <p className="text-muted">Send the token as <code className="font-mono">Authorization: Bearer …</code>. Responses are marked noindex so this app never competes with the site.</p>
          <ul className="space-y-1 font-mono text-[13px]">
            <li>{base}/pages?full=1</li>
            <li>{base}/pages/&lt;template&gt;/&lt;slug&gt;</li>
            <li>{base}/panchang?city=delhi&amp;date=YYYY-MM-DD</li>
            <li>{base}/llms.txt</li>
          </ul>
          <label className="block pt-2 text-xs text-muted" htmlFor="feed-token">Feed token</label>
          <input id="feed-token" readOnly value={token} className={`${inputClass} font-mono`} />
        </div>
      ) : (
        <p className="px-5 py-4 text-sm text-muted">The feed is off. Set SEO_FEED_TOKEN on the server to turn it on.</p>
      )}
    </Card>
  );
}

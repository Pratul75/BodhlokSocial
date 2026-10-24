/** SEO jobs: page catalog, keyword sync and the weekly site audit, all through DataForSEO. */
import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { connections, db, keywords, seoAudits, seoPages } from "@bodh/db";
import {
  CHECK_LABELS,
  keywordOverview,
  onPagePagesFailing,
  onPageSummary,
  rankedKeywords,
  startOnPage,
  type DataForSeoCredentials,
} from "./dataforseo";
import { pageCatalog } from "./seo-catalog";
import { readJsonSecret } from "./secrets";

export async function dataForSeoCredentials(): Promise<DataForSeoCredentials | null> {
  const c = await readJsonSecret<DataForSeoCredentials>("dataforseo");
  return c?.login && c.password && c.target ? c : null;
}

async function markConnection(error: string | null) {
  await db
    .update(connections)
    .set(error ? { status: "error", error, updatedAt: new Date() } : { status: "connected", error: null, lastSyncAt: new Date(), updatedAt: new Date() })
    .where(eq(connections.key, "dataforseo"));
}

/** Flags a DataForSEO connection whose saved value isn't the login, password and domain. */
export async function checkDataForSeoConnection(): Promise<void> {
  const [row] = await db.select().from(connections).where(eq(connections.key, "dataforseo"));
  if (row?.status === "connected" && !(await dataForSeoCredentials())) {
    await markConnection("Enter the API login, API password and website domain again.");
  }
}

/** Adds catalog pages that aren't in seo_pages yet, as planned. Never touches existing rows. */
export async function ensurePageCatalog(): Promise<number> {
  const pages = pageCatalog();
  const rows = await db
    .insert(seoPages)
    .values(pages.map((p) => ({ ...p, status: "planned", needsReview: p.template !== "panchang_city" })))
    .onConflictDoNothing()
    .returning({ id: seoPages.id });
  // Keep the catalog's title, keyword and inputs current on pages nobody has written yet.
  for (const p of pages) {
    await db
      .update(seoPages)
      .set({ title: p.title, keyword: p.keyword, params: p.params })
      .where(
        and(
          eq(seoPages.template, p.template),
          eq(seoPages.slug, p.slug),
          eq(seoPages.status, "planned"),
          sql`(${seoPages.params} is distinct from ${JSON.stringify(p.params)}::jsonb or ${seoPages.title} <> ${p.title} or ${seoPages.keyword} is distinct from ${p.keyword})`,
        ),
      );
  }
  // Retired templates: drop their unwritten pages.
  await db.delete(seoPages).where(and(eq(seoPages.template, "panchang_city"), eq(seoPages.status, "planned")));
  return rows.length;
}

/** Keywords BODH's site ranks for in Google India: volume, difficulty, position and page. */
export async function syncKeywords(): Promise<string> {
  const creds = await dataForSeoCredentials();
  if (!creds) return "DataForSEO isn't connected.";
  try {
    const rows = await rankedKeywords(creds, 300);
    for (const r of rows) {
      await db
        .insert(keywords)
        .values({ keyword: r.keyword.toLowerCase(), volume: r.volume, difficulty: r.difficulty, intent: r.intent, position: r.position, pageUrl: r.url, source: "dataforseo" })
        .onConflictDoUpdate({
          target: keywords.keyword,
          set: { volume: r.volume, difficulty: r.difficulty, position: r.position, pageUrl: r.url, updatedAt: new Date() },
        });
    }
    const tracked = await trackTargetKeywords(creds);
    await markConnection(null);
    return `Synced ${rows.length} ranking keywords for ${creds.target}.${tracked ? ` Looked up volume and difficulty for ${tracked} target keywords.` : ""}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await markConnection(msg);
    throw e;
  }
}

/** What Bodhlok sells, as people search for it. The page catalog adds the learning topics. */
export const PRODUCT_KEYWORDS = [
  "vedic astrology software",
  "jagannatha hora alternative",
  "jagannatha hora for mac",
  "parashara's light software",
  "leostar astrology software",
  "astrology software for institutes",
  "astrology client management software",
  "bhrigu nandi nadi software",
  "ai astrology software",
  "kundli software",
  "kp astrology software",
  "jyotish software",
  "astrology software for astrologers",
  "online kundli software",
  "astrology software online",
  "kp horary software",
  "astrology software in hindi",
  "jagannatha hora online",
  "professional astrology software",
  "dasha calculator",
  "ashtakavarga calculator",
  "prashna kundli",
  "muhurta calculator",
];

/**
 * Volume, difficulty and intent for every catalog page's keyword and the product keywords, so
 * pages can be ordered by demand before the site ranks for anything. Refreshed monthly.
 */
export async function trackTargetKeywords(creds: DataForSeoCredentials): Promise<number> {
  const words = [...PRODUCT_KEYWORDS, ...pageCatalog().map((p) => p.keyword)];
  const fresh = await db
    .select({ keyword: keywords.keyword })
    .from(keywords)
    .where(and(inArray(keywords.keyword, words), sql`${keywords.updatedAt} > now() - interval '30 days'`, sql`${keywords.volume} > 0`));
  const known = new Set(fresh.map((k) => k.keyword));
  const todo = words.filter((w) => !known.has(w));
  if (!todo.length) return 0;
  const rows = await keywordOverview(creds, todo);
  for (const r of rows) {
    await db
      .insert(keywords)
      .values({ keyword: r.keyword.toLowerCase(), volume: r.volume, difficulty: r.difficulty, intent: r.intent, source: "dataforseo" })
      .onConflictDoUpdate({ target: keywords.keyword, set: { volume: r.volume, difficulty: r.difficulty, intent: r.intent, updatedAt: new Date() } });
  }
  return rows.length;
}

export const AUDIT_MAX_PAGES = Number(process.env.SEO_AUDIT_MAX_PAGES ?? 500);

/** Starts a crawl unless one is already running. */
export async function startSiteAudit(): Promise<string> {
  const creds = await dataForSeoCredentials();
  if (!creds) return "DataForSEO isn't connected.";
  const [running] = await db.select().from(seoAudits).where(eq(seoAudits.status, "running")).limit(1);
  if (running && Date.now() - running.startedAt.getTime() < 2 * 86_400_000) return "An audit is already running.";
  if (running) await db.update(seoAudits).set({ status: "failed", error: "Timed out", finishedAt: new Date() }).where(eq(seoAudits.id, running.id));
  const taskId = await startOnPage(creds, AUDIT_MAX_PAGES);
  await db.insert(seoAudits).values({ target: creds.target, taskId, status: "running" });
  return `Started a crawl of ${creds.target} (up to ${AUDIT_MAX_PAGES} pages).`;
}

/** Checks running crawls and stores the results of finished ones. */
export async function pollSiteAudits(): Promise<string> {
  const creds = await dataForSeoCredentials();
  if (!creds) return "DataForSEO isn't connected.";
  const running = await db.select().from(seoAudits).where(eq(seoAudits.status, "running"));
  const out: string[] = [];
  for (const a of running) {
    try {
      const s = await onPageSummary(creds, a.taskId);
      if (!s.finished) {
        await db.update(seoAudits).set({ pagesCrawled: s.pagesCrawled }).where(eq(seoAudits.id, a.id));
        out.push(`${a.target}: ${s.pagesCrawled} pages so far`);
        continue;
      }
      const issues = [];
      for (const c of s.checks.slice(0, 15)) {
        issues.push({ check: c.check, pages: c.pages, examples: c.pages ? await onPagePagesFailing(creds, a.taskId, c.check, 5).catch(() => []) : [] });
      }
      await db
        .update(seoAudits)
        .set({ status: "finished", pagesCrawled: s.pagesCrawled, onpageScore: s.onpageScore?.toFixed(2) ?? null, metrics: s.metrics, issues, finishedAt: new Date() })
        .where(eq(seoAudits.id, a.id));
      out.push(`${a.target}: finished, ${s.pagesCrawled} pages, score ${s.onpageScore ?? "n/a"}`);
    } catch (e) {
      out.push(`${a.target}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return out.join("; ") || "No audits running.";
}

export async function latestAudit() {
  const [a] = await db.select().from(seoAudits).where(eq(seoAudits.status, "finished")).orderBy(desc(seoAudits.finishedAt)).limit(1);
  return a ? { ...a, issues: a.issues.map((i) => ({ ...i, label: CHECK_LABELS[i.check] ?? i.check.replace(/_/g, " ") })) } : null;
}

export async function pageCounts() {
  return db
    .select({ template: seoPages.template, status: seoPages.status, n: sql<number>`count(*)::int` })
    .from(seoPages)
    .groupBy(seoPages.template, seoPages.status);
}

/** Planned pages (and ones sent back with changes asked), by search volume, then the catalog's priority. */
export async function nextPlannedPages(limit: number, template?: string, search?: string, offset = 0) {
  const conds = [inArray(seoPages.status, ["planned", "drafted"])];
  if (template) conds.push(eq(seoPages.template, template));
  if (search) conds.push(ilike(seoPages.title, `%${search.replace(/[%_]/g, "")}%`));
  return db
    .select({ page: seoPages, volume: keywords.volume })
    .from(seoPages)
    .leftJoin(keywords, eq(keywords.keyword, seoPages.keyword))
    .where(and(...conds))
    .orderBy(
      sql`case when ${seoPages.status} = 'drafted' then 0 else 1 end`,
      sql`coalesce(${keywords.volume}, 0) desc`,
      sql`coalesce((${seoPages.params}->>'priority')::int, 0) desc`,
      seoPages.template,
      seoPages.slug,
    )
    .limit(limit)
    .offset(offset);
}

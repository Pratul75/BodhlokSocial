import "server-only";
import { timingSafeEqual, createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db, seoPages } from "@bodh/db";
import { CITIES, istToday, panchang, type Panchang } from "@bodh/integrations/panchang";
import { dataForSeoCredentials } from "@bodh/integrations/seo";
import { normalizeTarget } from "@bodh/integrations/dataforseo";

type Page = typeof seoPages.$inferSelect;

/** Where each template lives on BODH's site. The web team can map these however they like. */
export const SITE_PATHS: Record<string, (slug: string, params: Record<string, unknown>) => string> = {
  planet_house: (s) => `/astrology/planets-in-houses/${s}`,
  nakshatra: (s) => `/astrology/nakshatras/${s}`,
  yoga: (s) => `/astrology/yogas/${s}`,
  lagna: (s) => `/astrology/lagna/${s}`,
  panchang_city: (_s, p) => `/panchang/${String(p.city ?? "")}`,
  blog: (s) => `/blog/${s}`,
};

export async function siteUrl(): Promise<string> {
  if (process.env.SEO_SITE_URL) return process.env.SEO_SITE_URL.replace(/\/$/, "");
  const creds = await dataForSeoCredentials();
  return creds ? `https://${normalizeTarget(creds.target)}` : "https://asttrolok.com";
}

/** The feed is off unless SEO_FEED_TOKEN is set; callers send it as a Bearer token or ?token=. */
export function feedAuthorized(req: Request): boolean {
  const token = process.env.SEO_FEED_TOKEN;
  if (!token) return false;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? new URL(req.url).searchParams.get("token") ?? "";
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(given), h(token));
}

export const FEED_HEADERS = { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "private, max-age=300" };

export function feedDenied() {
  return Response.json({ error: process.env.SEO_FEED_TOKEN ? "Unauthorized" : "The page feed is off: SEO_FEED_TOKEN isn't set." }, { status: process.env.SEO_FEED_TOKEN ? 401 : 503, headers: FEED_HEADERS });
}

export function jsonLd(page: Page, url: string) {
  const graph: Record<string, unknown>[] = [
    {
      "@type": page.template === "blog" ? "Article" : "WebPage",
      "@id": `${url}#page`,
      url,
      name: page.title,
      headline: page.title,
      description: page.description,
      dateModified: page.updatedAt.toISOString(),
      ...(page.publishedAt ? { datePublished: page.publishedAt.toISOString() } : {}),
      inLanguage: "en-IN",
      publisher: { "@type": "Organization", name: "Asttrolok", url: url.replace(/^(https?:\/\/[^/]+).*$/, "$1") },
    },
  ];
  if (page.faq.length) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${url}#faq`,
      mainEntity: page.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    });
  }
  return { "@context": "https://schema.org", "@graph": graph };
}

export function panchangWeek(citySlug: string, from = istToday()): Panchang[] {
  const city = CITIES.find((c) => c.slug === citySlug);
  if (!city) return [];
  return Array.from({ length: 7 }, (_, i) => panchang(new Date(new Date(`${from}T00:00:00Z`).getTime() + i * 86_400_000).toISOString().slice(0, 10), city));
}

export async function pageDocument(page: Page, base: string) {
  const url = `${base}${SITE_PATHS[page.template]?.(page.slug, page.params) ?? `/${page.slug}`}`;
  return {
    template: page.template,
    slug: page.slug,
    url,
    title: page.title,
    description: page.description,
    keyword: page.keyword,
    answer: page.answer,
    body_markdown: page.body,
    faq: page.faq,
    json_ld: jsonLd(page, url),
    params: page.params,
    published_at: page.publishedAt?.toISOString() ?? null,
    updated_at: page.updatedAt.toISOString(),
    ...(page.template === "panchang_city" ? { panchang: panchangWeek(String(page.params.city ?? "")) } : {}),
  };
}

export async function livePages(): Promise<Page[]> {
  return db.select().from(seoPages).where(eq(seoPages.status, "live")).orderBy(asc(seoPages.template), asc(seoPages.slug));
}

export async function livePage(template: string, slug: string): Promise<Page | null> {
  const [p] = await db.select().from(seoPages).where(and(eq(seoPages.template, template), eq(seoPages.slug, slug), eq(seoPages.status, "live"))).limit(1);
  return p ?? null;
}

const SECTION: Record<string, string> = {
  planet_house: "Planets in houses",
  nakshatra: "Nakshatras",
  yoga: "Yogas",
  lagna: "Lagnas (ascendants)",
  panchang_city: "Daily Panchang by city",
  blog: "Articles",
};

/** llms.txt (llmstxt.org): a plain index of the site's best pages for AI assistants. */
export async function llmsTxt(): Promise<string> {
  const base = await siteUrl();
  const pages = await livePages();
  const lines = [
    "# Asttrolok BODH",
    "",
    "> BODH is Asttrolok's Vedic astrology (Jyotish) app: a free kundli (birth chart) with sidereal Lahiri calculations, dasha timelines, daily Panchang for Indian cities, and readings from trained astrologers. Asttrolok also teaches Vedic astrology courses.",
    "",
  ];
  for (const [template, title] of Object.entries(SECTION)) {
    const group = pages.filter((p) => p.template === template);
    if (!group.length) continue;
    lines.push(`## ${title}`, "");
    for (const p of group) lines.push(`- [${p.title}](${base}${SITE_PATHS[template]!(p.slug, p.params)}): ${p.description ?? p.answer?.slice(0, 150) ?? ""}`);
    lines.push("");
  }
  return lines.join("\n");
}

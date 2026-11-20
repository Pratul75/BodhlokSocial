import "server-only";
import { timingSafeEqual, createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { currentTenant, db, entitlementsFor, seoPages } from "@bodh/db";
import { featureUsable, isUnrestricted, type Entitlements } from "@bodh/shared";
import { CITIES, istToday, panchang, type Panchang } from "@bodh/integrations/panchang";
import { dataForSeoCredentials } from "@bodh/integrations/seo";
import { normalizeTarget } from "@bodh/integrations/dataforseo";
import { FEED_TOKEN_KEY, tenantSecret } from "@/lib/tenant-secrets";

type Page = typeof seoPages.$inferSelect;

/** Where each template lives on BODH's site. The web team can map these however they like. */
export const SITE_PATHS: Record<string, (slug: string, params: Record<string, unknown>) => string> = {
  compare: (s) => `/compare/${s}`,
  guide: (s) => `/guides/${s}`,
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
  return creds ? `https://${normalizeTarget(creds.target)}` : "https://www.bodhlok.com";
}

/** The SEO module and the feed feature, both of which the page feed needs. */
function effectiveAccessForTenant(ent: Entitlements): boolean {
  return (isUnrestricted(ent) || ent.modules.has("seo")) && featureUsable(ent, "feed.pages");
}

/**
 * The feed is off for a workspace until it has a feed token; callers send it as
 * `Authorization: Bearer <token>`. A ?token= query parameter is not accepted: URLs end up in
 * proxy and access logs. The token belongs to the workspace, so one workspace's token never
 * opens another's pages.
 */
export async function feedAuthorized(req: Request): Promise<boolean> {
  // The feed serves the SEO module's pages, so a workspace without that module — or without
  // the feature that serves them — has no feed, whatever token the caller is holding. A token
  // issued before the module was switched off must not outlive it.
  const tenant = currentTenant();
  const ent = await entitlementsFor(tenant.id);
  if (!effectiveAccessForTenant(ent)) return false;

  const token = await tenantSecret(FEED_TOKEN_KEY);
  if (!token) return false;
  const given = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  if (!given) return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(given), h(token));
}

export const FEED_HEADERS = { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "private, max-age=300" };

export async function feedDenied() {
  const configured = (await tenantSecret(FEED_TOKEN_KEY)) !== null;
  return Response.json(
    { error: configured ? "Unauthorized" : "The page feed is off: this workspace has no feed token." },
    { status: configured ? 401 : 503, headers: FEED_HEADERS },
  );
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
      publisher: { "@type": "Organization", name: "Bodhlok", url: url.replace(/^(https?:\/\/[^/]+).*$/, "$1") },
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
  compare: "Choosing astrology software",
  guide: "Module guides: techniques on the desk",
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
    "# Bodhlok",
    "",
    "> Bodhlok is professional Vedic astrology (Jyotish) software in the browser, by Retrograde Technologies, for learners, practising astrologers and institutes. One desk holds chart calculations on the Swiss Ephemeris with a choice of ayanamsa, D1 and divisional charts, KP, Jaimini, Vimshottari, Ashtottari and Yogini dashas, Ashtakavarga, Prashna, Muhurta, client notes, and an AI consult in English or Hindi. Start with a free desk.",
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

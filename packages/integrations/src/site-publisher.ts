/**
 * Publishes approved SEO pages to bodhlok.com as blog posts, through pull requests to the
 * site's repo (Pratul75/Jyotish-web-app, branch `bodhlok`). The site's blog is static HTML
 * baked into its image, plus an allow-list of slugs in backend/app/api/public_site.py, so a
 * post is three changes: the post file, a card in blog/index.html, and the slug in the list.
 * A merge triggers the site's own Cloud Build deploy; the sync job then checks the URL.
 */
import { marked } from "marked";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { auditLog, connections, db, seoPages, type FaqItem } from "@bodh/db";
import { GitHub, type GitHubCredentials } from "./github";
import { readJsonSecret } from "./secrets";

export const SITE = process.env.SEO_SITE_URL?.replace(/\/$/, "") ?? "https://bodhlok.com";
export const TEMPLATE_PATH = "frontend/public/site/blog/kp-astrology-249-sub-lords.html";
export const INDEX_PATH = "frontend/public/site/blog/index.html";
export const SLUGS_PATH = "backend/app/api/public_site.py";
const POSTS_DIR = "frontend/public/site/blog";

export interface SiteCredentials extends GitHubCredentials {
  branch: string;
  auto_merge?: string;
}

export async function siteCredentials(): Promise<SiteCredentials | null> {
  const c = await readJsonSecret<SiteCredentials>("github_site");
  return c?.token && c.repo && c.branch ? c : null;
}

/* ---------- categories and images: the site's own vocabulary ---------- */

const MODULE_CATEGORY: Record<string, string> = {
  KP: "KP astrology",
  Jaimini: "Jaimini",
  Ashtakavarga: "Ashtakavarga",
  Dashas: "Dasha periods",
  Muhurta: "Muhurta",
  Consult: "Consult",
  Practice: "Consult",
  Transits: "Ashtakavarga",
};

export function categoryFor(page: { template: string; params: Record<string, unknown> }): string {
  if (page.template === "compare") return "Choosing software";
  if (page.template === "guide") return MODULE_CATEGORY[String(page.params.module ?? "")] ?? "Chart methods";
  if (page.template === "blog") return "Consult";
  return "Study guides";
}

/** Which "Explore" tile a category counts under, as blog.js groups them. */
const TILE_FOR: Record<string, string> = {
  "KP astrology": 'data-group="systems"',
  Jaimini: 'data-group="systems"',
  Ashtakavarga: 'data-group="systems"',
  "Dasha periods": 'data-group="timing"',
  Muhurta: 'data-group="timing"',
  Consult: 'data-category="Consult"',
};

const COVER: Record<string, string> = {
  "KP astrology": "signature-zodiac-study.jpg",
  "Dasha periods": "inner-hero-nebula.jpg",
  Ashtakavarga: "why-timing-planet.jpg",
  Jaimini: "why-insights-planets.jpg",
  Muhurta: "inner-hero-nebula.jpg",
  Consult: "desk-consult-panel.webp",
  "Choosing software": "desk-consult-panel.webp",
};
const coverFor = (category: string) => COVER[category] ?? "signature-zodiac-study.jpg";

const TRY_BOX: Record<string, { h: string; p: string }> = {
  compare: { h: "Compare on a real chart", p: "Open a free desk, bring a sample chart, and see the calculations, timing tools and consult side by side with whatever you use today." },
  guide: { h: "Bring the method to a sample chart", p: "Open the desk, load a sample chart and follow the steps above screen by screen. The free desk has everything this guide uses." },
  default: { h: "See it on a sample chart", p: "Open the desk, load a sample chart and find this in D1, the divisional charts and the dasha timeline. The free desk has everything you need to study it." },
};

/* ---------- helpers ---------- */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const istDay = (d = new Date()) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const stripTags = (s: string) => s.replace(/<[^>]*>/g, "");

export interface PageForSite {
  slug: string;
  template: string;
  params: Record<string, unknown>;
  title: string;
  description: string | null;
  answer: string | null;
  body: string | null;
  faq: FaqItem[];
}

export interface RelatedPost {
  href: string;
  title: string;
  category: string;
  img: string;
}

/** Markdown body to the site's article HTML, with numbered section ids for the sidebar. */
export function renderBody(markdown: string): { html: string; sections: { id: string; title: string }[] } {
  const safe = markdown.replace(/</g, "&lt;");
  let html = marked.parse(safe, { async: false, gfm: true }) as string;
  const sections: { id: string; title: string }[] = [];
  html = html.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/g, (_m, inner: string) => {
    const id = `section-${sections.length + 1}`;
    sections.push({ id, title: stripTags(inner).trim() });
    return `<h2 id="${id}">${inner}</h2>`;
  });
  return { html: html.trim(), sections };
}

export function renderPost(template: string, page: PageForSite, opts: { category: string; date: string; related: RelatedPost[] }): string {
  const url = `${SITE}/blog/${page.slug}`;
  const title = page.title.replace(/\s*\|\s*Bodhlok$/, "");
  const fullTitle = `${title} | Bodhlok`;
  const description = (page.description ?? page.answer ?? "").trim().slice(0, 300);
  const cover = `${SITE}/site/img/${coverFor(opts.category)}`;
  const { html: body, sections } = renderBody(page.body ?? "");
  const faqHtml = page.faq.length
    ? `<h2 id="faq">Frequently asked questions</h2>\n${page.faq.map((f) => `<h3>${esc(f.q)}</h3>\n<p>${esc(f.a)}</p>`).join("\n")}`
    : "";
  const tryBox = TRY_BOX[page.template] ?? TRY_BOX.default!;

  const graph: Record<string, unknown>[] = [
    { "@type": "Organization", "@id": `${SITE}/#organization`, name: "Retrograde Technologies Private Limited", alternateName: "Bodhlok", url: `${SITE}/`, logo: `${SITE}/site/img/logo.svg`, email: "support@retrogradetech.in" },
    { "@type": "WebSite", "@id": `${SITE}/#website`, name: "Bodhlok", url: `${SITE}/`, publisher: { "@id": `${SITE}/#organization` }, inLanguage: "en" },
    { "@type": "WebPage", "@id": `${url}#webpage`, url, name: fullTitle, description, isPartOf: { "@id": `${SITE}/#website` }, inLanguage: "en", primaryImageOfPage: { "@type": "ImageObject", url: cover }, breadcrumb: { "@id": `${url}#breadcrumb` } },
    { "@type": "BreadcrumbList", "@id": `${url}#breadcrumb`, itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` }, { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE}/blog` }, { "@type": "ListItem", position: 3, name: opts.category, item: url }] },
    { "@type": "Article", "@id": `${url}#article`, headline: title, description, datePublished: opts.date, dateModified: opts.date, inLanguage: "en", author: { "@type": "Organization", name: "Bodhlok", url: `${SITE}/about` }, publisher: { "@id": `${SITE}/#organization` }, mainEntityOfPage: { "@id": `${url}#webpage` }, image: cover },
  ];
  if (page.faq.length) graph.push({ "@type": "FAQPage", "@id": `${url}#faq`, mainEntity: page.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });

  const head = `<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Bodhlok">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${cover}">
<meta property="og:image:alt" content="Bodhlok astrology software chart preview">
<meta property="og:locale" content="en_IN">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(fullTitle)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${cover}">
<meta name="twitter:image:alt" content="Bodhlok astrology software chart preview">
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph })}</script>
`;

  const toc = sections.map((s) => `<a href="#${s.id}">${esc(s.title)}</a>`).join("") + (page.faq.length ? `<a href="#faq">Frequently asked questions</a>` : "");
  const related = opts.related
    .slice(0, 3)
    .map((r) => `<a href="${r.href}"><img src="${r.img}" alt="" loading="lazy" width="400" height="240"><span>${esc(r.category)}</span><h3>${esc(r.title)}</h3></a>`)
    .join("");
  const main = `<main id="main"><section class="blog-detail-hero"><div class="wrap"><img class="blog-detail-cover" src="../img/${coverFor(opts.category)}" alt="" width="1240" height="520"><div class="blog-detail-title"><nav class="blog-crumb" aria-label="Breadcrumb"><a href="/">Bodhlok</a><span>›</span><a href="/blog">Blog</a></nav><h1>${esc(title)}</h1><div class="detail-meta"><span><small>Written by</small><b>Bodhlok</b></span><span><small>Published on</small><b>${longDate(opts.date)}</b></span><span><small>Category</small><b>${esc(opts.category)}</b></span></div></div></div></section><section class="blog-article-layout wrap"><article class="blog-article">
        <p class="lede">${esc((page.answer ?? "").trim())}</p>
        
${body}
${faqHtml}

        <div class="try"><h3>${esc(tryBox.h)}</h3><p>${esc(tryBox.p)}</p><div><a class="btn green" href="/login">Create a free account</a></div></div>
        <nav class="article-nav"><a href="/blog">← All posts</a><a href="/product">See the desk →</a></nav>
      </article><aside class="article-sidebar"><div class="blog-side-panel"><h3>In this article</h3><nav>${toc}</nav></div><div class="blog-side-panel"><h3>Explore the desk</h3><p>Take the method back to the chart. Explore the tools with the same birth details and calculation profile.</p><a class="btn green" href="/product">See the desk</a></div></aside></section>${related ? `<section class="blog-related wrap"><h2>Keep reading</h2><div class="blog-related-grid">${related}</div></section>` : ""}</main>`;

  const headStart = template.indexOf("<title>");
  const headEnd = template.indexOf("<link rel=\"stylesheet\" href=\"../bodhlok/enquiry.css\"></head>");
  const mainStart = template.indexOf('<main id="main">');
  const mainEnd = template.indexOf("</main>") + "</main>".length;
  if (headStart < 0 || headEnd < 0 || mainStart < 0 || mainEnd < 7) throw new Error("The site's blog template changed shape; the publisher needs updating.");
  return template.slice(0, headStart) + head + template.slice(headEnd, mainStart) + main + template.slice(mainEnd);
}

/* ---------- blog/index.html ---------- */

export interface CardInfo {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  date: string;
}

const bump = (html: string, pattern: RegExp, delta: number) => html.replace(pattern, (_m, pre: string, n: string, post: string) => `${pre}${Math.max(0, Number(n) + delta)}${post}`);

/** The "N articles" count on an Explore tile, with the right plural. */
function bumpTile(html: string, tile: string, delta: number): string {
  const at = html.indexOf(tile);
  if (at < 0) return html;
  const after = html.slice(at).replace(/(class="category-count">)(\d+) articles?</, (_m, pre: string, n: string) => {
    const count = Math.max(0, Number(n) + delta);
    return `${pre}${count} article${count === 1 ? "" : "s"}<`;
  });
  return html.slice(0, at) + after;
}

export function addToIndex(index: string, card: CardInfo): string {
  if (index.includes(`href="/blog/${card.slug}"`)) return index;
  const img = `../img/${coverFor(card.category)}`;
  const cardHtml = `<article class="blog-post-card" data-post-category="${esc(card.category)}" data-title="${esc(card.title)}"><a class="blog-post-cover" href="/blog/${card.slug}"><img src="${img}" alt="" loading="lazy" width="600" height="380"><span class="pill">${esc(card.category)}</span></a><div class="blog-post-body"><h2><a href="/blog/${card.slug}">${esc(card.title)}</a></h2><p>${esc(card.excerpt)}</p><div class="blog-author"><span class="author-avatar"><img src="../img/logo.svg" alt="" width="32" height="32"></span><span><b>Bodhlok</b><small>Feature explainers</small></span></div><div class="blog-post-meta"><span>${longDate(card.date)}</span><a href="/blog/${card.slug}">Read article →</a></div></div></article>`;
  let out = index.replace('<div class="blog-posts">', `<div class="blog-posts">${cardHtml}`);
  if (out === index) throw new Error("blog/index.html has no .blog-posts list; the publisher needs updating.");
  out = bump(out, /(All articles <span>)(\d+)(<\/span>)/, 1);
  const button = new RegExp(`(data-category="${card.category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" aria-pressed="false">[^<]*<span>)(\\d+)(</span>)`);
  if (button.test(out)) out = bump(out, button, 1);
  else out = out.replace('</div><div class="blog-side-panel"><h3>Recent articles</h3>', `<button class="category-filter" data-category="${esc(card.category)}" aria-pressed="false">${esc(card.category)}<span>1</span></button></div><div class="blog-side-panel"><h3>Recent articles</h3>`);
  const tile = TILE_FOR[card.category];
  if (tile) out = bumpTile(out, tile, 1);
  const recent = `<a class="recent-post" href="/blog/${card.slug}"><img src="${img}" alt="" width="64" height="64"><span><b>${esc(card.title)}</b><small>${longDate(card.date)}</small></span></a>`;
  out = out.replace("<h3>Recent articles</h3>", `<h3>Recent articles</h3>${recent}`);
  // Keep the sidebar to three recent posts.
  const panelStart = out.indexOf("<h3>Recent articles</h3>");
  const panelEnd = out.indexOf("</div>", panelStart);
  const panel = out.slice(panelStart, panelEnd);
  const posts = panel.match(/<a class="recent-post"[\s\S]*?<\/a>/g) ?? [];
  if (posts.length > 3) out = out.slice(0, panelStart) + "<h3>Recent articles</h3>" + posts.slice(0, 3).join("") + out.slice(panelEnd);
  return out;
}

export function removeFromIndex(index: string, slug: string): string {
  const card = index.match(new RegExp(`<article class="blog-post-card" data-post-category="([^"]*)"[^>]*>[\\s\\S]*?href="/blog/${slug}"[\\s\\S]*?</article>`));
  if (!card) return index.replace(new RegExp(`<a class="recent-post" href="/blog/${slug}">[\\s\\S]*?</a>`), "");
  const category = card[1]!;
  let out = index.replace(card[0], "");
  out = bump(out, /(All articles <span>)(\d+)(<\/span>)/, -1);
  const button = new RegExp(`(data-category="${category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" aria-pressed="false">[^<]*<span>)(\\d+)(</span>)`);
  out = bump(out, button, -1).replace(new RegExp(`<button class="category-filter" data-category="${category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" aria-pressed="false">[^<]*<span>0</span></button>`), "");
  const tile = TILE_FOR[category];
  if (tile) out = bumpTile(out, tile, -1);
  return out.replace(new RegExp(`<a class="recent-post" href="/blog/${slug}">[\\s\\S]*?</a>`), "");
}

/** The existing posts on the index, for "Keep reading". */
export function postsOnIndex(index: string): RelatedPost[] {
  const out: RelatedPost[] = [];
  for (const m of index.matchAll(/<article class="blog-post-card" data-post-category="([^"]*)" data-title="([^"]*)"><a class="blog-post-cover" href="([^"]+)"><img src="([^"]+)"/g)) {
    out.push({ category: m[1]!, title: m[2]!.replace(/&amp;/g, "&").replace(/&quot;/g, '"'), href: m[3]!, img: m[4]! });
  }
  return out;
}

/* ---------- backend/app/api/public_site.py ---------- */

const SLUGS_RE = /_BLOG_SLUGS = frozenset\(\{([\s\S]*?)\}\)/;

export function slugsIn(py: string): string[] {
  const m = py.match(SLUGS_RE);
  if (!m) throw new Error("public_site.py has no _BLOG_SLUGS block; the publisher needs updating.");
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}

export function withSlugs(py: string, slugs: string[]): string {
  const body = [...new Set(slugs)].sort().map((s) => `    "${s}",`).join("\n");
  return py.replace(SLUGS_RE, `_BLOG_SLUGS = frozenset({\n${body}\n})`);
}

/* ---------- the jobs ---------- */

async function audit(action: string, target: string, result: string, reason?: string) {
  await db.insert(auditLog).values({ actor: "site publisher", actorType: "agent", action, target, result, reason: reason ?? null });
}

async function markConnection(error: string | null) {
  await db.update(connections).set(error ? { status: "error", error, updatedAt: new Date() } : { status: "connected", error: null, lastSyncAt: new Date(), updatedAt: new Date() }).where(eq(connections.key, "github_site"));
}

const slugOk = (s: string) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);

/** Opens one pull request with every approved page that is waiting. */
export async function publishQueued(): Promise<string> {
  const creds = await siteCredentials();
  if (!creds) return "GitHub (site repo) isn't connected.";
  const pages = await db
    .select()
    .from(seoPages)
    .where(and(eq(seoPages.status, "live"), or(isNull(seoPages.siteStatus), eq(seoPages.siteStatus, "queued"), eq(seoPages.siteStatus, "failed"))))
    .limit(20);
  const todo = pages.filter((p) => p.body && p.answer && slugOk(p.slug));
  if (!todo.length) return "No approved pages waiting.";

  const gh = new GitHub(creds);
  try {
    const base = await gh.branchSha(creds.branch);
    const [template, index, py] = await Promise.all([gh.getFile(TEMPLATE_PATH, creds.branch), gh.getFile(INDEX_PATH, creds.branch), gh.getFile(SLUGS_PATH, creds.branch)]);
    const stamp = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/(\d{8})(\d{4})/, "$1-$2");
    const branch = `growth-os/pages-${stamp}`;
    await gh.createBranch(branch, base);

    const date = istDay();
    let indexHtml = index.content;
    const slugs = new Set(slugsIn(py.content));
    const related = postsOnIndex(index.content);
    const lines: string[] = [];
    for (const p of todo) {
      const category = p.siteCategory ?? categoryFor(p);
      const html = renderPost(template.content, { ...p, description: p.description, faq: p.faq }, { category, date, related: related.filter((r) => r.href !== `/blog/${p.slug}`) });
      const existing = slugs.has(p.slug) ? await gh.getFile(`${POSTS_DIR}/${p.slug}.html`, branch).catch(() => null) : null;
      await gh.putFile(`${POSTS_DIR}/${p.slug}.html`, branch, html, `blog: ${existing ? "update" : "add"} ${p.slug}`, existing?.sha);
      indexHtml = addToIndex(removeFromIndex(indexHtml, p.slug), { slug: p.slug, title: p.title.replace(/\s*\|\s*Bodhlok$/, ""), excerpt: (p.description ?? p.answer ?? "").slice(0, 220), category, date });
      slugs.add(p.slug);
      lines.push(`- **${p.title}** → ${SITE}/blog/${p.slug} (${category})`);
      await db.update(seoPages).set({ siteCategory: category }).where(eq(seoPages.id, p.id));
    }
    await gh.putFile(INDEX_PATH, branch, indexHtml, `blog: list ${todo.length} new post${todo.length === 1 ? "" : "s"}`, index.sha);
    await gh.putFile(SLUGS_PATH, branch, withSlugs(py.content, [...slugs]), `blog: allow ${todo.length} new slug${todo.length === 1 ? "" : "s"}`, py.sha);

    const title = todo.length === 1 ? `Blog: ${todo[0]!.title.replace(/\s*\|\s*Bodhlok$/, "")}` : `Blog: ${todo.length} new posts from Growth OS`;
    const body = `Approved in BODH Growth OS on ${longDate(date)}.\n\n${lines.join("\n")}\n\nEach post adds its HTML under \`${POSTS_DIR}/\`, a card on the blog index, and its slug to \`_BLOG_SLUGS\`. Merging deploys the site through \`bodhlok-deploy\`.`;
    const pr = await gh.createPull(branch, creds.branch, title, body);
    let status = "pr_open";
    if ((creds.auto_merge ?? "").trim().toLowerCase() === "yes") {
      try {
        if (await gh.mergePull(pr.number, title)) status = "merged";
      } catch (e) {
        await audit("site_merge", `PR #${pr.number}`, "failed", e instanceof Error ? e.message : String(e));
      }
    }
    await db
      .update(seoPages)
      .set({ siteStatus: status, sitePrNumber: pr.number, sitePrUrl: pr.html_url, siteError: null, updatedAt: new Date() })
      .where(inArray(seoPages.id, todo.map((p) => p.id)));
    await markConnection(null);
    await audit("site_publish", `PR #${pr.number}`, status, `${todo.length} page(s)`);
    return `Opened ${pr.html_url} with ${todo.length} page${todo.length === 1 ? "" : "s"}${status === "merged" ? ", merged" : ""}.`;
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 400);
    await db.update(seoPages).set({ siteStatus: "failed", siteError: msg }).where(inArray(seoPages.id, todo.map((p) => p.id)));
    await markConnection(msg);
    await audit("site_publish", `${todo.length} page(s)`, "failed", msg);
    throw e;
  }
}

/** Opens a pull request that takes withdrawn pages off the site. */
export async function removeQueued(): Promise<string> {
  const creds = await siteCredentials();
  if (!creds) return "GitHub (site repo) isn't connected.";
  const pages = await db.select().from(seoPages).where(eq(seoPages.siteStatus, "remove_queued")).limit(20);
  if (!pages.length) return "Nothing to remove.";
  const gh = new GitHub(creds);
  try {
    const base = await gh.branchSha(creds.branch);
    const [index, py] = await Promise.all([gh.getFile(INDEX_PATH, creds.branch), gh.getFile(SLUGS_PATH, creds.branch)]);
    const branch = `growth-os/remove-${Date.now().toString(36)}`;
    await gh.createBranch(branch, base);
    let indexHtml = index.content;
    const slugs = new Set(slugsIn(py.content));
    for (const p of pages) {
      const file = await gh.getFile(`${POSTS_DIR}/${p.slug}.html`, branch).catch(() => null);
      if (file) await gh.deleteFile(`${POSTS_DIR}/${p.slug}.html`, branch, file.sha, `blog: remove ${p.slug}`);
      indexHtml = removeFromIndex(indexHtml, p.slug);
      slugs.delete(p.slug);
    }
    await gh.putFile(INDEX_PATH, branch, indexHtml, `blog: unlist ${pages.length} post(s)`, index.sha);
    await gh.putFile(SLUGS_PATH, branch, withSlugs(py.content, [...slugs]), `blog: disallow ${pages.length} slug(s)`, py.sha);
    const pr = await gh.createPull(branch, creds.branch, `Blog: remove ${pages.length} post${pages.length === 1 ? "" : "s"}`, `Withdrawn in BODH Growth OS.\n\n${pages.map((p) => `- ${p.title}`).join("\n")}`);
    let status = "removing";
    if ((creds.auto_merge ?? "").trim().toLowerCase() === "yes" && (await gh.mergePull(pr.number, `Blog: remove ${pages.length} post(s)`).catch(() => false))) status = "removed";
    await db.update(seoPages).set({ siteStatus: status, sitePrNumber: pr.number, sitePrUrl: pr.html_url, updatedAt: new Date() }).where(inArray(seoPages.id, pages.map((p) => p.id)));
    await audit("site_remove", `PR #${pr.number}`, status, `${pages.length} page(s)`);
    return `Opened ${pr.html_url} removing ${pages.length} page${pages.length === 1 ? "" : "s"}.`;
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 400);
    await db.update(seoPages).set({ siteStatus: "failed", siteError: msg }).where(inArray(seoPages.id, pages.map((p) => p.id)));
    throw e;
  }
}

/** Follows open pull requests to merge, and merged pages to the live URL. */
export async function syncSite(): Promise<string> {
  const creds = await siteCredentials();
  if (!creds) return "GitHub (site repo) isn't connected.";
  const pages = await db.select().from(seoPages).where(inArray(seoPages.siteStatus, ["pr_open", "merged", "removing"]));
  if (!pages.length) return "Nothing in flight.";
  const gh = new GitHub(creds);
  const notes: string[] = [];
  const prs = new Map<number, Awaited<ReturnType<GitHub["getPull"]>>>();
  for (const p of pages) {
    try {
      if ((p.siteStatus === "pr_open" || p.siteStatus === "removing") && p.sitePrNumber) {
        const pr = prs.get(p.sitePrNumber) ?? (await gh.getPull(p.sitePrNumber));
        prs.set(p.sitePrNumber, pr);
        if (pr.merged) {
          await db.update(seoPages).set({ siteStatus: p.siteStatus === "removing" ? "removed" : "merged", updatedAt: new Date() }).where(eq(seoPages.id, p.id));
          notes.push(`#${pr.number} merged`);
        } else if (pr.state === "closed") {
          await db.update(seoPages).set({ siteStatus: "failed", siteError: "Pull request closed without merging.", updatedAt: new Date() }).where(eq(seoPages.id, p.id));
          notes.push(`#${pr.number} closed`);
        }
        continue;
      }
      if (p.siteStatus === "merged") {
        const url = `${SITE}/blog/${p.slug}`;
        const res = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(20_000) }).catch(() => null);
        if (res?.status === 200) {
          await db.update(seoPages).set({ siteStatus: "live", siteUrl: url, sitePublishedAt: new Date(), updatedAt: new Date() }).where(eq(seoPages.id, p.id));
          notes.push(`${p.slug} live`);
        }
      }
    } catch (e) {
      notes.push(`${p.slug}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return notes.join("; ") || `${pages.length} page(s) still waiting on a merge or deploy.`;
}

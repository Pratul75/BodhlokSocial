/**
 * Publishes approved SEO pages to bodhlok.com as blog posts through the site's own CMS
 * (bodhlok-cms.ts). A page approved in Growth OS becomes a CMS post document: created or given a
 * new draft, then published, in one pass. The CMS renders it in the site's template, runs its SEO
 * checks (title, description, one H1, social image, alt text) and serves it at /blog/<slug> at
 * once. A page sent back with changes is unpublished the same way.
 *
 * The connection is `bodhlok_cms`: a Bodhlok account that is a CMS member with blog publishing
 * (preset "blog_publisher"), signed in by a person at bodhlok.com (reCAPTCHA) and handed over
 * as the browser's sign-in key. Each use stores the fresh key the site hands back, and the hourly
 * sync uses it even when nothing is waiting, so it never reaches its 7 days. The site must allow
 * that account to approve its own drafts (site setting `self_approval_allowed`); approval
 * already happened here.
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { auditLog, connections, db, seoPages, type FaqItem } from "@bodh/db";
import { allows, BodhlokCms, CmsError, markdownToRichText, tokenExpiry, type CmsCredentials, type CmsTaxonomy, type PostFields } from "./bodhlok-cms";
import { readJsonSecret, secretName, secretStore } from "./secrets";

export const SITE = process.env.SEO_SITE_URL?.replace(/\/$/, "") ?? "https://bodhlok.com";
export const AUTHOR_NAME = "Bodhlok";

export async function siteCredentials(): Promise<CmsCredentials | null> {
  const c = await readJsonSecret<CmsCredentials>("bodhlok_cms");
  return c?.refresh_token || (c?.email && c.password) ? c : null;
}

/** A CMS client that stores each fresh sign-in key in place of the old one. */
export function cmsClient(creds: CmsCredentials): BodhlokCms {
  return new BodhlokCms(creds, fetch, async (refresh_token) => {
    const current = (await readJsonSecret<CmsCredentials>("bodhlok_cms")) ?? creds;
    await (await secretStore()).put(secretName("bodhlok_cms"), JSON.stringify({ ...current, refresh_token }));
  });
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

/** Cover images already on the site (frontend/public/site/img), by category. */
const COVER: Record<string, string> = {
  "KP astrology": "signature-zodiac-study.jpg",
  "Dasha periods": "inner-hero-nebula.jpg",
  Ashtakavarga: "why-timing-planet.jpg",
  Jaimini: "why-insights-planets.jpg",
  Muhurta: "inner-hero-nebula.jpg",
  Consult: "desk-consult-panel.webp",
  "Choosing software": "desk-consult-panel.webp",
};
export const coverFor = (category: string) => `/site/img/${COVER[category] ?? "signature-zodiac-study.jpg"}`;

const TRY_BOX: Record<string, { h: string; p: string }> = {
  compare: { h: "Compare on a real chart", p: "Open a free desk, bring a sample chart, and see the calculations, timing tools and consult side by side with whatever you use today." },
  guide: { h: "Bring the method to a sample chart", p: "Open the desk, load a sample chart and follow the steps above screen by screen. The free desk has everything this guide uses." },
  default: { h: "See it on a sample chart", p: "Open the desk, load a sample chart and find this in D1, the divisional charts and the dasha timeline. The free desk has everything you need to study it." },
};

/* ---------- the post as a CMS document ---------- */

export interface PageForSite {
  slug: string;
  template: string;
  params: Record<string, unknown>;
  title: string;
  keyword: string | null;
  description: string | null;
  answer: string | null;
  body: string | null;
  faq: FaqItem[];
}

const stripSuffix = (title: string) => title.replace(/\s*\|\s*Bodhlok$/, "").trim();

/** At most `max` characters, cut at a word; the CMS wants a 50–155 character description. */
export function trimTo(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return (at > max * 0.6 ? cut.slice(0, at) : clean.slice(0, max)).replace(/[,;:\s]+$/, "");
}

/** The FAQ as Markdown under its own heading, so it renders like the rest of the body. */
export function faqMarkdown(faq: FaqItem[]): string {
  if (!faq.length) return "";
  return `\n\n## Frequently asked questions\n\n${faq.map((f) => `### ${f.q.trim()}\n\n${f.a.trim()}`).join("\n\n")}\n`;
}

/** Title, content, SEO fields and excerpt for the CMS; the same shape creates a post or saves a new draft. */
export function postFields(page: PageForSite, category: string): PostFields {
  const title = stripSuffix(page.title);
  const description = trimTo(page.description ?? page.answer ?? "", 155);
  const cover = coverFor(category);
  const tryBox = TRY_BOX[page.template] ?? TRY_BOX.default!;
  const body = markdownToRichText(`${page.body ?? ""}${faqMarkdown(page.faq)}`);
  const seo: Record<string, unknown> = {
    title,
    description,
    schema_type: "Article",
    og_image: `${SITE}${cover}`,
    og_image_alt: "Bodhlok astrology software chart preview",
  };
  if (page.keyword) seo.focus_keyword = page.keyword;
  if (page.faq.length) {
    seo.extra_jsonld = [{ "@type": "FAQPage", mainEntity: page.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }];
  }
  return {
    title,
    excerpt: page.answer ? trimTo(page.answer, 400) : null,
    seo,
    content: {
      regions: {
        main: [
          {
            id: "article",
            type: "blog_article",
            body,
            cover: { src: cover, alt: "Bodhlok astrology software chart preview" },
            try_heading: tryBox.h,
            try_text: tryBox.p,
            try_link: { label: "Create a free account", href: "/login", style: "primary" },
          },
        ],
      },
      meta: {},
    },
  };
}

/* ---------- the jobs ---------- */

async function audit(action: string, target: string, result: string, reason?: string) {
  await db.insert(auditLog).values({ actor: "site publisher", actorType: "agent", action, target, result, reason: reason ?? null });
}

async function markConnection(error: string | null, label?: string) {
  await db
    .update(connections)
    .set(error ? { status: "error", error, updatedAt: new Date() } : { status: "connected", error: null, lastSyncAt: new Date(), updatedAt: new Date(), ...(label ? { accountLabel: label } : {}) })
    .where(eq(connections.key, "bodhlok_cms"));
}

const slugOk = (s: string) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
const errorText = (e: unknown) => (e instanceof CmsError ? e.detail : e instanceof Error ? e.message : String(e)).slice(0, 600);

const SELF_APPROVAL_HINT = " The site requires a second person to approve: a Bodhlok platform admin can turn on self-approval for the site (CMS → Site settings → Review), since approval already happened in Growth OS.";

/** Signs in and checks that the account can publish posts. Used by the jobs and the Connections page. */
export async function openCms(creds: CmsCredentials): Promise<{ cms: BodhlokCms; label: string }> {
  const cms = cmsClient(creds);
  const me = await cms.me();
  if (!allows(me.features, "blog:publish") && !me.is_platform_admin) {
    throw new CmsError(`${me.user.email} can sign in but has no blog publishing on ${me.site.name} (CMS access: ${Object.entries(me.features).map(([k, v]) => `${k}:${v}`).join(", ") || "none"}). Ask a CMS admin for the "blog_publisher" preset.`, 403);
  }
  const until = creds.refresh_token ? tokenExpiry(creds.refresh_token) : null;
  const keyNote = until ? `, sign-in key good until ${until.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })} and renewed hourly` : "";
  return { cms, label: `${me.user.email} · ${me.site.name}${me.is_platform_admin ? " (platform admin)" : ""}${keyNote}` };
}

export async function checkCmsConnection(): Promise<string> {
  const creds = await siteCredentials();
  if (!creds) return "bodhlok.com CMS isn't connected.";
  try {
    const { label } = await openCms(creds);
    await markConnection(null, label);
    return `Signed in to the CMS as ${label}.`;
  } catch (e) {
    const msg = errorText(e);
    await markConnection(msg);
    throw new Error(msg);
  }
}

async function ensureCategory(cms: BodhlokCms, known: CmsTaxonomy[], name: string): Promise<CmsTaxonomy> {
  const found = known.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (found) return found;
  const made = await cms.createCategory(name);
  known.push(made);
  return made;
}

async function ensureAuthor(cms: BodhlokCms): Promise<number> {
  const authors = await cms.authors();
  const org = authors.find((a) => a.display_name.toLowerCase() === AUTHOR_NAME.toLowerCase()) ?? authors.find((a) => a.is_organization);
  return (org ?? (await cms.createAuthor(AUTHOR_NAME, true))).id;
}

/** Publishes every approved page that is waiting; each page succeeds or fails on its own. */
export async function publishQueued(): Promise<string> {
  const creds = await siteCredentials();
  if (!creds) return "bodhlok.com CMS isn't connected.";
  const pages = await db
    .select()
    .from(seoPages)
    .where(and(eq(seoPages.status, "live"), or(isNull(seoPages.siteStatus), eq(seoPages.siteStatus, "queued"), eq(seoPages.siteStatus, "failed"))))
    .limit(20);
  const todo = pages.filter((p) => p.body && p.answer && slugOk(p.slug));
  if (!todo.length) return "No approved pages waiting.";

  let cms: BodhlokCms;
  let categories: CmsTaxonomy[];
  let authorId: number;
  try {
    const opened = await openCms(creds);
    cms = opened.cms;
    [categories, authorId] = await Promise.all([cms.categories(), ensureAuthor(cms)]);
    await markConnection(null, opened.label);
  } catch (e) {
    const msg = errorText(e);
    await db.update(seoPages).set({ siteStatus: "failed", siteError: msg, updatedAt: new Date() }).where(inArray(seoPages.id, todo.map((p) => p.id)));
    await markConnection(msg);
    await audit("site_publish", `${todo.length} page(s)`, "failed", msg);
    throw new Error(msg);
  }

  const done: string[] = [];
  const failed: string[] = [];
  for (const p of todo) {
    const category = p.siteCategory ?? categoryFor(p);
    try {
      const cat = await ensureCategory(cms, categories, category);
      const fields: PostFields = { ...postFields(p, category), primary_category_id: cat.id, author_id: authorId };
      let doc = p.siteDocumentId ? await cms.getDocument(p.siteDocumentId).catch(() => null) : null;
      doc ??= await cms.findPost(p.slug);
      if (doc) await cms.saveDraft(doc.id, { ...fields, change_note: "Updated from BODH Growth OS" });
      else doc = await cms.createPost(p.slug, fields);
      let published = doc;
      try {
        published = await cms.action(doc.id, "publish");
      } catch (e) {
        // The same revision was published earlier (a retry after a lost reply): the page is live.
        if (!(e instanceof CmsError && e.status === 409 && /already published/i.test(e.message))) throw e;
      }
      const url = `${cms.site}${published.path}`;
      await db
        .update(seoPages)
        .set({ siteStatus: "live", siteDocumentId: doc.id, siteUrl: url, siteCategory: category, siteError: null, sitePublishedAt: new Date(), updatedAt: new Date() })
        .where(eq(seoPages.id, p.id));
      done.push(`${stripSuffix(p.title)} → ${url}`);
    } catch (e) {
      let msg = errorText(e);
      if (/cannot approve your own work|must be approved/i.test(msg)) msg += SELF_APPROVAL_HINT;
      failed.push(`${p.slug}: ${msg}`);
      await db.update(seoPages).set({ siteStatus: "failed", siteError: msg, updatedAt: new Date() }).where(eq(seoPages.id, p.id));
    }
  }
  await audit("site_publish", `${todo.length} page(s)`, failed.length ? (done.length ? "partly failed" : "failed") : "published", [...done, ...failed].join("\n"));
  const parts = [];
  if (done.length) parts.push(`Published ${done.length} page${done.length === 1 ? "" : "s"} to bodhlok.com.`);
  if (failed.length) parts.push(`${failed.length} failed: ${failed.join(" · ")}`);
  return parts.join(" ");
}

/** Takes withdrawn pages off the site (unpublish: the CMS answers 410 at the old address). */
export async function removeQueued(): Promise<string> {
  const creds = await siteCredentials();
  if (!creds) return "";
  const pages = await db.select().from(seoPages).where(eq(seoPages.siteStatus, "remove_queued")).limit(20);
  if (!pages.length) return "";
  const cms = cmsClient(creds);
  const notes: string[] = [];
  for (const p of pages) {
    try {
      const doc = p.siteDocumentId ? await cms.getDocument(p.siteDocumentId).catch(() => null) : await cms.findPost(p.slug);
      if (doc?.live) await cms.action(doc.id, "unpublish");
      await db.update(seoPages).set({ siteStatus: "removed", siteError: null, updatedAt: new Date() }).where(eq(seoPages.id, p.id));
      notes.push(`${p.slug} taken down`);
    } catch (e) {
      const msg = errorText(e);
      await db.update(seoPages).set({ siteStatus: "failed", siteError: `Taking the page down failed: ${msg}`, updatedAt: new Date() }).where(eq(seoPages.id, p.id));
      notes.push(`${p.slug}: ${msg}`);
    }
  }
  await audit("site_remove", `${pages.length} page(s)`, "done", notes.join("\n"));
  return notes.join("; ");
}

/**
 * Hourly. Signs in first, even with nothing published, which renews the sign-in key so it never
 * reaches its 7 days; then compares what Growth OS thinks is live with the CMS (a post
 * unpublished in the CMS panel shows up here).
 */
export async function syncSite(): Promise<string> {
  const creds = await siteCredentials();
  if (!creds) return "bodhlok.com CMS isn't connected.";
  let cms: BodhlokCms;
  try {
    const opened = await openCms(creds);
    cms = opened.cms;
    await markConnection(null, opened.label);
  } catch (e) {
    const msg = errorText(e);
    await markConnection(msg);
    throw new Error(msg);
  }
  const pages = await db.select().from(seoPages).where(inArray(seoPages.siteStatus, ["live", "removed"]));
  if (!pages.length) return "Signed in; nothing published yet.";
  const notes: string[] = [];
  let checked = 0;
  for (const p of pages) {
    if (!p.siteDocumentId) continue;
    try {
      const doc = await cms.getDocument(p.siteDocumentId);
      checked++;
      if (p.siteStatus === "live" && !doc.live) {
        await db.update(seoPages).set({ siteStatus: "removed", siteError: "Taken down in the CMS.", updatedAt: new Date() }).where(eq(seoPages.id, p.id));
        notes.push(`${p.slug} was taken down in the CMS`);
      } else if (p.siteStatus === "removed" && doc.live) {
        await db.update(seoPages).set({ siteStatus: "live", siteUrl: `${cms.site}${doc.path}`, siteError: null, updatedAt: new Date() }).where(eq(seoPages.id, p.id));
        notes.push(`${p.slug} is live again`);
      }
    } catch (e) {
      if (e instanceof CmsError && e.status === 404) {
        await db.update(seoPages).set({ siteStatus: "removed", siteError: "The CMS document no longer exists.", updatedAt: new Date() }).where(eq(seoPages.id, p.id));
        notes.push(`${p.slug}: document gone`);
      } else notes.push(`${p.slug}: ${errorText(e)}`);
    }
  }
  return notes.length ? notes.join("; ") : `${checked} page${checked === 1 ? "" : "s"} checked; everything matches the CMS.`;
}

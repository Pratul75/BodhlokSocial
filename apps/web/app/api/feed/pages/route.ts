import { FEED_HEADERS, feedAuthorized, feedDenied, livePages, pageDocument, siteUrl } from "@/lib/seo-feed";
import { publicTenant } from "@/lib/tenant";
import { enterTenant } from "@bodh/db";

export const dynamic = "force-dynamic";

/** Approved SEO pages for BODH's website. ?full=1 includes each page's content. */
export async function GET(req: Request) {
  // Which workspace's pages. `/t/<slug>/api/feed/...` says so; the bare path is tenant #1's.
  const tenant = await publicTenant();
  if (!tenant) return Response.json({ error: "Unknown workspace" }, { status: 404 });
  enterTenant(tenant);
  if (!(await feedAuthorized(req))) return await feedDenied();
  const full = new URL(req.url).searchParams.get("full") === "1";
  const base = await siteUrl();
  const pages = await livePages();
  const docs = await Promise.all(pages.map((p) => pageDocument(p, base)));
  return Response.json(
    { site: base, count: docs.length, pages: full ? docs : docs.map(({ template, slug, url, title, description, updated_at }) => ({ template, slug, url, title, description, updated_at })) },
    { headers: FEED_HEADERS },
  );
}

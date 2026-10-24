import { FEED_HEADERS, feedAuthorized, feedDenied, livePages, pageDocument, siteUrl } from "@/lib/seo-feed";

export const dynamic = "force-dynamic";

/** Approved SEO pages for BODH's website. ?full=1 includes each page's content. */
export async function GET(req: Request) {
  if (!feedAuthorized(req)) return feedDenied();
  const full = new URL(req.url).searchParams.get("full") === "1";
  const base = await siteUrl();
  const pages = await livePages();
  const docs = await Promise.all(pages.map((p) => pageDocument(p, base)));
  return Response.json(
    { site: base, count: docs.length, pages: full ? docs : docs.map(({ template, slug, url, title, description, updated_at }) => ({ template, slug, url, title, description, updated_at })) },
    { headers: FEED_HEADERS },
  );
}

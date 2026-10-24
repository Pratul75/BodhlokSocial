import { FEED_HEADERS, feedAuthorized, feedDenied, livePage, pageDocument, siteUrl } from "@/lib/seo-feed";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ template: string; slug: string }> }) {
  if (!feedAuthorized(req)) return feedDenied();
  const { template, slug } = await params;
  const page = await livePage(template, slug);
  if (!page) return Response.json({ error: "Not found" }, { status: 404, headers: FEED_HEADERS });
  return Response.json(await pageDocument(page, await siteUrl()), { headers: FEED_HEADERS });
}

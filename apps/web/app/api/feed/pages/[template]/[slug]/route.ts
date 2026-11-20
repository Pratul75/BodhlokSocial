import { FEED_HEADERS, feedAuthorized, feedDenied, livePage, pageDocument, siteUrl } from "@/lib/seo-feed";
import { publicTenant } from "@/lib/tenant";
import { enterTenant } from "@bodh/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ template: string; slug: string }> }) {
  // Which workspace's pages. `/t/<slug>/api/feed/...` says so; the bare path is tenant #1's.
  const tenant = await publicTenant();
  if (!tenant) return Response.json({ error: "Unknown workspace" }, { status: 404 });
  enterTenant(tenant);
  if (!(await feedAuthorized(req))) return await feedDenied();
  const { template, slug } = await params;
  const page = await livePage(template, slug);
  if (!page) return Response.json({ error: "Not found" }, { status: 404, headers: FEED_HEADERS });
  return Response.json(await pageDocument(page, await siteUrl()), { headers: FEED_HEADERS });
}

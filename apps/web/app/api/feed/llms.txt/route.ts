import { FEED_HEADERS, feedAuthorized, feedDenied, llmsTxt } from "@/lib/seo-feed";
import { publicTenant } from "@/lib/tenant";
import { enterTenant } from "@bodh/db";

export const dynamic = "force-dynamic";

/** The site's llms.txt, built from live pages. The website serves it at /llms.txt. */
export async function GET(req: Request) {
  // Which workspace's pages. `/t/<slug>/api/feed/...` says so; the bare path is tenant #1's.
  const tenant = await publicTenant();
  if (!tenant) return Response.json({ error: "Unknown workspace" }, { status: 404 });
  enterTenant(tenant);
  if (!(await feedAuthorized(req))) return await feedDenied();
  return new Response(await llmsTxt(), { headers: { ...FEED_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}

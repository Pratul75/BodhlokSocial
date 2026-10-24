import { FEED_HEADERS, feedAuthorized, feedDenied, llmsTxt } from "@/lib/seo-feed";

export const dynamic = "force-dynamic";

/** The site's llms.txt, built from live pages. The website serves it at /llms.txt. */
export async function GET(req: Request) {
  if (!feedAuthorized(req)) return feedDenied();
  return new Response(await llmsTxt(), { headers: { ...FEED_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}

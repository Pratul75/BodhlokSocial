import { CITIES, istToday, panchang } from "@bodh/integrations/panchang";
import { FEED_HEADERS, feedAuthorized, feedDenied } from "@/lib/seo-feed";
import { publicTenant } from "@/lib/tenant";
import { enterTenant } from "@bodh/db";

export const dynamic = "force-dynamic";

/** ?city=delhi&date=YYYY-MM-DD (default today, India time). Without city: the city list. */
export async function GET(req: Request) {
  // Which workspace's pages. `/t/<slug>/api/feed/...` says so; the bare path is tenant #1's.
  const tenant = await publicTenant();
  if (!tenant) return Response.json({ error: "Unknown workspace" }, { status: 404 });
  enterTenant(tenant);
  if (!(await feedAuthorized(req))) return await feedDenied();
  const q = new URL(req.url).searchParams;
  const slug = q.get("city");
  if (!slug) return Response.json({ cities: CITIES }, { headers: FEED_HEADERS });
  const city = CITIES.find((c) => c.slug === slug);
  if (!city) return Response.json({ error: "Unknown city" }, { status: 404, headers: FEED_HEADERS });
  const date = q.get("date") ?? istToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: "date must be YYYY-MM-DD" }, { status: 400, headers: FEED_HEADERS });
  return Response.json(panchang(date, city), { headers: FEED_HEADERS });
}

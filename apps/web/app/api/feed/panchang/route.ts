import { CITIES, istToday, panchang } from "@bodh/integrations/panchang";
import { FEED_HEADERS, feedAuthorized, feedDenied } from "@/lib/seo-feed";

export const dynamic = "force-dynamic";

/** ?city=delhi&date=YYYY-MM-DD (default today, India time). Without city: the city list. */
export async function GET(req: Request) {
  if (!feedAuthorized(req)) return feedDenied();
  const q = new URL(req.url).searchParams;
  const slug = q.get("city");
  if (!slug) return Response.json({ cities: CITIES }, { headers: FEED_HEADERS });
  const city = CITIES.find((c) => c.slug === slug);
  if (!city) return Response.json({ error: "Unknown city" }, { status: 404, headers: FEED_HEADERS });
  const date = q.get("date") ?? istToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: "date must be YYYY-MM-DD" }, { status: 400, headers: FEED_HEADERS });
  return Response.json(panchang(date, city), { headers: FEED_HEADERS });
}

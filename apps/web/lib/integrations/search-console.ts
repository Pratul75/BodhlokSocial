import "server-only";

const API = "https://www.googleapis.com/webmasters/v3";

export interface SiteEntry {
  siteUrl: string;
  permissionLevel: string;
}

export async function listSites(accessToken: string): Promise<SiteEntry[]> {
  const res = await fetch(`${API}/sites`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Search Console sites request failed (${res.status})`);
  const body = (await res.json()) as { siteEntry?: SiteEntry[] };
  return (body.siteEntry ?? []).filter((s) => s.permissionLevel !== "siteUnverifiedUser");
}

/** Pick the site to sync: SEARCH_CONSOLE_SITE if set, else an Asttrolok property, else the first one. */
export function pickSite(sites: SiteEntry[]): SiteEntry | undefined {
  const wanted = process.env.SEARCH_CONSOLE_SITE;
  if (wanted) return sites.find((s) => s.siteUrl === wanted);
  return sites.find((s) => /asttrolok/i.test(s.siteUrl)) ?? sites[0];
}

export interface QueryRow {
  query: string;
  clicks: number;
  impressions: number;
  position: number;
}

export async function topQueries(accessToken: string, siteUrl: string, days = 28): Promise<QueryRow[]> {
  const end = new Date(Date.now() - 2 * 86400000); // Search Console data lags about two days
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const res = await fetch(`${API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate: iso(start), endDate: iso(end), dimensions: ["query"], rowLimit: 1000 }),
  });
  if (!res.ok) throw new Error(`Search Console query failed (${res.status})`);
  const body = (await res.json()) as { rows?: { keys: string[]; clicks: number; impressions: number; position: number }[] };
  return (body.rows ?? []).map((r) => ({ query: r.keys[0] ?? "", clicks: r.clicks, impressions: r.impressions, position: r.position }));
}

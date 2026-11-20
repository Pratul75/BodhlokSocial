import "server-only";
import { tenantSetting } from "@bodh/db";

const API = "https://www.googleapis.com/webmasters/v3";

/** Google's own reason, e.g. "Google Search Console API has not been used in project ..." */
async function failure(what: string, res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  const reason = body?.error?.message?.split(". ")[0];
  return new Error(`Search Console ${what} failed (${res.status})${reason ? `: ${reason}` : ""}`);
}

export interface SiteEntry {
  siteUrl: string;
  permissionLevel: string;
}

export async function listSites(accessToken: string): Promise<SiteEntry[]> {
  const res = await fetch(`${API}/sites`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw await failure("sites request", res);
  const body = (await res.json()) as { siteEntry?: SiteEntry[] };
  return (body.siteEntry ?? []).filter((s) => s.permissionLevel !== "siteUnverifiedUser");
}

/** Pick the site to sync: this workspace's configured site if it has one, else a likely property, else the first. */
export async function pickSite(sites: SiteEntry[]): Promise<SiteEntry | undefined> {
  const wanted = await tenantSetting("search_console.site");
  if (wanted) return sites.find((s) => s.siteUrl === wanted);
  return sites.find((s) => /asttrolok|bodh/i.test(s.siteUrl)) ?? sites[0];
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
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw await failure("query", res);
  const body = (await res.json()) as { rows?: { keys: string[]; clicks: number; impressions: number; position: number }[] };
  return (body.rows ?? []).map((r) => ({ query: r.keys[0] ?? "", clicks: r.clicks, impressions: r.impressions, position: r.position }));
}

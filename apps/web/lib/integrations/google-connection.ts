import "server-only";
import { eq } from "drizzle-orm";
import { connections, db, keywords } from "@bodh/db";
import { googleAccessToken, revokeGoogleGrant, type StoredGoogleGrant } from "@bodh/integrations/google-oauth";
import { syncAdStructure } from "@bodh/integrations/ads";
import { googleAdsConfigFromEnv, verifyGoogleAdsAccess } from "@bodh/integrations/google-ads";
import { intentFor } from "@bodh/integrations/dataforseo";
import { myChannel } from "@bodh/integrations/youtube";
import { listSites, pickSite, topQueries } from "./search-console";

export type { StoredGoogleGrant };

export async function accessTokenFor(key: string): Promise<string> {
  const token = await googleAccessToken(key);
  if (!token) throw new Error("No stored grant. Connect again.");
  return token;
}

/** Check a fresh grant works and describe the account it reaches. */
export async function describeAccount(key: string, accessToken: string): Promise<string> {
  if (key === "search_console") {
    const sites = await listSites(accessToken);
    const site = pickSite(sites);
    if (!site) throw new Error("This Google account has no verified Search Console properties.");
    return site.siteUrl;
  }
  if (key === "google_ads") {
    const cfg = googleAdsConfigFromEnv();
    // Without the developer token the account can't be checked yet; the card already says so.
    if (!cfg) return "Signed in (developer token pending)";
    return verifyGoogleAdsAccess(cfg, accessToken);
  }
  if (key === "youtube") {
    const channel = await myChannel(accessToken);
    if (!channel) throw new Error("This Google account has no YouTube channel. Sign in with the account that owns BODH's channel.");
    return channel.title;
  }
  return "Connected";
}

export interface SyncResult {
  message: string;
}

/** Pull data for a connected integration: Search Console keyword positions, Google Ads account structure. */
export async function syncIntegration(key: string): Promise<SyncResult> {
  const token = await accessTokenFor(key);
  if (key === "google_ads") {
    if (!googleAdsConfigFromEnv()) throw new Error("Set GOOGLE_ADS_DEVELOPER_TOKEN and GOOGLE_ADS_CUSTOMER_ID on the server first.");
    const message = await syncAdStructure();
    await db.update(connections).set({ status: "connected", lastSyncAt: new Date(), error: null, updatedAt: new Date() }).where(eq(connections.key, key));
    return { message };
  }
  if (key !== "search_console") {
    await db.update(connections).set({ status: "connected", lastSyncAt: new Date(), error: null, updatedAt: new Date() }).where(eq(connections.key, key));
    return { message: "Google accepted the stored grant." };
  }

  const sites = await listSites(token);
  const site = pickSite(sites);
  if (!site) throw new Error("No verified Search Console property found.");
  const rows = await topQueries(token, site.siteUrl);
  const byQuery = new Map(rows.map((r) => [r.query.toLowerCase(), r]));

  const tracked = await db.select().from(keywords);
  let updated = 0;
  for (const k of tracked) {
    const row = byQuery.get(k.keyword.toLowerCase());
    const position = row ? Math.round(row.position) : null;
    if (position !== k.position || row?.clicks !== k.clicks28d) {
      await db
        .update(keywords)
        .set({ position, clicks28d: row?.clicks ?? null, impressions28d: row?.impressions ?? null, updatedAt: new Date() })
        .where(eq(keywords.id, k.id));
      updated++;
    }
  }
  // Start tracking the queries that already bring impressions; DataForSEO fills volume later.
  const known = new Set(tracked.map((k) => k.keyword.toLowerCase()));
  const fresh = rows
    .filter((r) => r.query && !known.has(r.query.toLowerCase()))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, Math.max(0, 300 - tracked.length));
  if (fresh.length) {
    await db
      .insert(keywords)
      .values(
        fresh.map((r) => ({
          keyword: r.query.toLowerCase(),
          volume: 0,
          difficulty: 0,
          position: Math.round(r.position),
          intent: intentFor(r.query),
          source: "search_console",
          clicks28d: r.clicks,
          impressions28d: r.impressions,
        })),
      )
      .onConflictDoNothing();
  }
  await db
    .update(connections)
    .set({ status: "connected", accountLabel: site.siteUrl, lastSyncAt: new Date(), error: null, updatedAt: new Date() })
    .where(eq(connections.key, key));
  return { message: `Read ${rows.length} queries from ${site.siteUrl}. Updated ${updated} of ${tracked.length} tracked keywords${fresh.length ? ` and started tracking ${fresh.length} more` : ""}.` };
}

export async function revokeGrant(key: string) {
  await revokeGoogleGrant(key);
}

import "server-only";
import { eq } from "drizzle-orm";
import { connections, db, keywords } from "@bodh/db";
import { refreshAccessToken } from "@/lib/google";
import { secretName, secretStore } from "@/lib/secrets";
import { listSites, pickSite, topQueries } from "./search-console";

/** What we keep in the secrets store for a Google OAuth connection. */
export interface StoredGoogleGrant {
  refresh_token: string;
  scope: string;
  connected_by: string;
  connected_at: string;
}

export async function accessTokenFor(key: string): Promise<string> {
  const raw = await (await secretStore()).get(secretName(key));
  if (!raw) throw new Error("No stored grant. Connect again.");
  const grant = JSON.parse(raw) as StoredGoogleGrant;
  const { access_token } = await refreshAccessToken(grant.refresh_token);
  return access_token;
}

/** Check a fresh grant works and describe the account it reaches. */
export async function describeAccount(key: string, accessToken: string): Promise<string> {
  if (key === "search_console") {
    const sites = await listSites(accessToken);
    const site = pickSite(sites);
    if (!site) throw new Error("This Google account has no verified Search Console properties.");
    return site.siteUrl;
  }
  return "Connected";
}

export interface SyncResult {
  message: string;
}

/** Pull data for a connected integration. Search Console updates keyword positions. */
export async function syncIntegration(key: string): Promise<SyncResult> {
  const token = await accessTokenFor(key);
  if (key !== "search_console") {
    await db.update(connections).set({ lastSyncAt: new Date(), error: null }).where(eq(connections.key, key));
    return { message: "Connection works." };
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
    if (position !== k.position) {
      await db.update(keywords).set({ position }).where(eq(keywords.id, k.id));
      updated++;
    }
  }
  await db
    .update(connections)
    .set({ status: "connected", accountLabel: site.siteUrl, lastSyncAt: new Date(), error: null, updatedAt: new Date() })
    .where(eq(connections.key, key));
  return { message: `Read ${rows.length} queries from ${site.siteUrl}. Updated ${updated} of ${tracked.length} tracked keywords.` };
}

export async function revokeGrant(key: string) {
  const raw = await (await secretStore()).get(secretName(key));
  if (!raw) return;
  try {
    const grant = JSON.parse(raw) as StoredGoogleGrant;
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(grant.refresh_token)}`, { method: "POST" });
  } catch {
    // Revocation is best effort; the stored grant is deleted either way.
  }
}

/**
 * Google OAuth access tokens for connected integrations (Search Console, Google Ads), shared by
 * the web app and the worker. Only the refresh token is stored; access tokens are minted on use
 * and cached in memory until shortly before they expire.
 */
import { eq } from "drizzle-orm";
import { connections, db } from "@bodh/db";
import { readJsonSecret } from "./secrets";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/** A Google OAuth grant as stored in the secrets store by the web app's connect flow. */
export interface StoredGoogleGrant {
  refresh_token: string;
  scope: string;
  connected_by: string;
  connected_at: string;
}

/** Google said the refresh token is no longer valid (revoked, expired, or the password changed). */
export class GoogleGrantRevokedError extends Error {
  readonly revoked = true;
  constructor(public readonly integration?: string) {
    super("Google access for this connection was revoked or has expired. Reconnect it in Connections.");
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set.");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (res.status === 400 && body?.error === "invalid_grant") throw new GoogleGrantRevokedError();
    throw new Error(`Google token refresh failed (${res.status}${body?.error ? `: ${body.error}` : ""})`);
  }
  return (await res.json()) as { access_token: string; expires_in: number };
}

const cache = new Map<string, { token: string; refreshToken: string; expiresAt: number }>();

/** Clears cached access tokens; the next call refreshes. Used on disconnect and in tests. */
export function forgetAccessToken(integration?: string) {
  if (integration) cache.delete(integration);
  else cache.clear();
}

/**
 * An access token for a connected Google integration, or null when nothing is stored.
 * When Google rejects the refresh token, the connection is marked as an error (so the card says
 * "reconnect") and GoogleGrantRevokedError is thrown.
 */
export async function googleAccessToken(integration: string): Promise<string | null> {
  const grant = await readJsonSecret<StoredGoogleGrant>(integration);
  if (!grant?.refresh_token) return null;
  const hit = cache.get(integration);
  if (hit && hit.refreshToken === grant.refresh_token && hit.expiresAt > Date.now() + 60_000) return hit.token;
  try {
    const t = await refreshAccessToken(grant.refresh_token);
    cache.set(integration, { token: t.access_token, refreshToken: grant.refresh_token, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 });
    return t.access_token;
  } catch (e) {
    if (e instanceof GoogleGrantRevokedError) {
      cache.delete(integration);
      await db
        .update(connections)
        .set({ status: "error", error: e.message, updatedAt: new Date() })
        .where(eq(connections.key, integration))
        .catch(() => undefined);
      throw new GoogleGrantRevokedError(integration);
    }
    throw e;
  }
}

/** Revokes a stored grant at Google. Best effort: the token goes in the POST body, never the URL. */
export async function revokeGoogleGrant(integration: string): Promise<void> {
  forgetAccessToken(integration);
  const grant = await readJsonSecret<StoredGoogleGrant>(integration);
  if (!grant?.refresh_token) return;
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: grant.refresh_token }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // The stored grant is deleted either way.
  }
}

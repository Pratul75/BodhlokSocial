const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** A Google OAuth grant as stored in the secrets store by the web app's connect flow. */
export interface StoredGoogleGrant {
  refresh_token: string;
  scope: string;
  connected_by: string;
  connected_at: string;
}

export async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set.");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed (${res.status})`);
  return (await res.json()) as { access_token: string; expires_in: number };
}

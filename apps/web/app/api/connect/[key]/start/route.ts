import { NextResponse } from "next/server";
import { getIntegration } from "@bodh/shared";
import { googleConnectClient } from "@bodh/integrations/google-oauth";
import { getCurrentUser } from "@/lib/auth";
import { appUrl, buildAuthUrl, randomToken } from "@/lib/google";
import { cookieOptions, OAUTH_COOKIE, sealOAuthState } from "@/lib/session";

/**
 * Starts a Google OAuth grant for an integration. Admins only. It goes through Growth OS's own
 * Google app when one is saved in Connections (outside accounts can use it), otherwise the staff
 * sign-in app.
 */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const user = await getCurrentUser();
  const back = (q: string) => NextResponse.redirect(new URL(`/connections?${q}`, appUrl(req)));
  if (user.role !== "admin") return back("error=admin_only");
  const def = getIntegration(key);
  if (!def?.googleOAuth?.enabled) return back(`error=not_enabled&key=${key}`);
  const client = await googleConnectClient();
  if (!client) return back("error=no_oauth_client");

  const state = randomToken();
  const verifier = randomToken(48);
  const url = await buildAuthUrl({
    redirectUri: `${appUrl(req)}/api/connect/google/callback`,
    scopes: def.googleOAuth.scopes,
    state,
    verifier,
    offline: true,
    clientId: client.client_id,
  });
  const res = NextResponse.redirect(url);
  res.cookies.set(
    OAUTH_COOKIE,
    await sealOAuthState({ state, verifier, nonce: "", purpose: "connect", integration: key, clientId: client.client_id, returnTo: "/connections" }),
    cookieOptions(600),
  );
  return res;
}

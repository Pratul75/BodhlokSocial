import { NextResponse } from "next/server";
import { getIntegration, integrationAllowed } from "@bodh/shared";
import { googleConnectClient } from "@bodh/integrations/google-oauth";
import { enterTenantScope, getCurrentUser, allowed } from "@/lib/auth";
import { appUrl, buildAuthUrl, randomToken } from "@/lib/google";
import { cookieOptions, OAUTH_COOKIE, sealOAuthState } from "@/lib/session";

/**
 * Starts a Google OAuth grant for an integration. Admins only. It goes through Growth OS's own
 * Google app when one is saved in Connections (outside accounts can use it), otherwise the staff
 * sign-in app.
 */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const user = enterTenantScope(await getCurrentUser());
  const back = (q: string) => NextResponse.redirect(new URL(`/connections?${q}`, appUrl(req)));
  if (!allowed(user, "connections") || user.role !== "admin") return back("error=admin_only");
  // The account itself has to be one this workspace was given, not merely one Google offers.
  if (!integrationAllowed(user.ent, key)) return back(`error=not_enabled&key=${key}`);
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

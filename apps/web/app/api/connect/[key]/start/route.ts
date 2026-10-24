import { NextResponse } from "next/server";
import { getIntegration } from "@bodh/shared";
import { getCurrentUser } from "@/lib/auth";
import { appUrl, buildAuthUrl, randomToken } from "@/lib/google";
import { authEnabled, cookieOptions, OAUTH_COOKIE, sealOAuthState } from "@/lib/session";

/** Starts a Google OAuth grant for an integration. Admins only. */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const user = await getCurrentUser();
  const back = (q: string) => NextResponse.redirect(new URL(`/connections?${q}`, appUrl(req)));
  if (user.role !== "admin") return back("error=admin_only");
  if (!authEnabled()) return back("error=no_oauth_client");
  const def = getIntegration(key);
  if (!def?.googleOAuth?.enabled) return back(`error=not_enabled&key=${key}`);

  const state = randomToken();
  const verifier = randomToken(48);
  const url = await buildAuthUrl({
    redirectUri: `${appUrl(req)}/api/connect/google/callback`,
    scopes: def.googleOAuth.scopes,
    state,
    verifier,
    offline: true,
    loginHint: user.email,
  });
  const res = NextResponse.redirect(url);
  res.cookies.set(
    OAUTH_COOKIE,
    await sealOAuthState({ state, verifier, nonce: "", purpose: "connect", integration: key, returnTo: "/connections" }),
    cookieOptions(600),
  );
  return res;
}

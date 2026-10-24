import { NextResponse } from "next/server";
import { appUrl, buildAuthUrl, randomToken } from "@/lib/google";
import { authEnabled, cookieOptions, OAUTH_COOKIE, safeReturnTo, sealOAuthState } from "@/lib/session";

/** Starts Google sign-in. */
export async function GET(req: Request) {
  if (!authEnabled()) return NextResponse.redirect(new URL("/", req.url));
  const returnTo = safeReturnTo(new URL(req.url).searchParams.get("next"));
  const state = randomToken();
  const verifier = randomToken(48);
  const nonce = randomToken();
  const url = await buildAuthUrl({
    redirectUri: `${appUrl(req)}/api/auth/callback/google`,
    scopes: ["openid", "email", "profile"],
    state,
    verifier,
    nonce,
  });
  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_COOKIE, await sealOAuthState({ state, verifier, nonce, purpose: "signin", returnTo }), cookieOptions(600));
  return res;
}

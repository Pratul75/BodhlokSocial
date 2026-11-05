import { NextResponse } from "next/server";
import { authorizeUrl, type RedditApp } from "@bodh/integrations/reddit";
import { getCurrentUser } from "@/lib/auth";
import { appUrl, randomToken } from "@/lib/google";
import { readJsonSecret } from "@/lib/secrets";
import { cookieOptions, OAUTH_COOKIE, sealOAuthState } from "@/lib/session";

const redditRedirectUri = (req: Request) => new URL("/api/connect/reddit/callback", appUrl(req)).toString();

/** Sends an admin to Reddit to sign in with the team's named account and approve BODH Growth OS. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  const back = (q: string) => NextResponse.redirect(new URL(`/connections?${q}`, appUrl(req)));
  if (user.role !== "admin") return back("error=admin_only");
  const app = await readJsonSecret<RedditApp>("reddit_app");
  if (!app?.client_id || !app.client_secret) return back("error=not_enabled&key=reddit");
  const state = randomToken();
  const res = NextResponse.redirect(authorizeUrl(app, redditRedirectUri(req), state));
  res.cookies.set(OAUTH_COOKIE, await sealOAuthState({ state, verifier: "", nonce: "", purpose: "connect", integration: "reddit", returnTo: "/connections" }), cookieOptions(600));
  return res;
}

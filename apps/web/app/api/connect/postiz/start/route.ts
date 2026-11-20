import { NextResponse } from "next/server";
import { enterTenantScope, getCurrentUser, allowed } from "@/lib/auth";
import { integrationAllowed } from "@bodh/shared";
import { appUrl, randomToken } from "@/lib/google";
import { postizApp, postizUrls } from "@/lib/integrations/postiz-oauth";
import { cookieOptions, OAUTH_COOKIE, sealOAuthState } from "@/lib/session";

/** Sends an admin to Postiz to approve BODH Growth OS. */
export async function GET(req: Request) {
  const user = enterTenantScope(await getCurrentUser());
  const back = (q: string) => NextResponse.redirect(new URL(`/connections?${q}`, appUrl(req)));
  if (!allowed(user, "connections") || !integrationAllowed(user.ent, "postiz") || user.role !== "admin") return back("error=admin_only");
  const app = await postizApp();
  if (!app) return back("error=not_enabled&key=postiz");
  const state = randomToken();
  const url = new URL(`${postizUrls(app).frontend}/oauth/authorize`);
  url.search = new URLSearchParams({ client_id: app.client_id, response_type: "code", state }).toString();
  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_COOKIE, await sealOAuthState({ state, verifier: "", nonce: "", purpose: "connect", integration: "postiz", returnTo: "/connections" }), cookieOptions(600));
  return res;
}

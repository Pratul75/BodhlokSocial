import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { connections, db } from "@bodh/db";
import { exchangeRedditCode, redditMe, REDDIT_SCOPES, type RedditApp, type RedditGrant } from "@bodh/integrations/reddit";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { appUrl } from "@/lib/google";
import { readJsonSecret, secretName, secretStore } from "@/lib/secrets";
import { OAUTH_COOKIE, openOAuthState } from "@/lib/session";

/** Reddit redirects here with a one-time code; swap it for a permanent grant and store it. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const jar = await cookies();
  const saved = await openOAuthState(jar.get(OAUTH_COOKIE)?.value);
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/connections?${q}`, appUrl(req)));
    res.cookies.delete(OAUTH_COOKIE);
    return res;
  };
  const user = await getCurrentUser();
  if (user.role !== "admin") return back("error=admin_only");
  if (params.get("error")) return back("error=cancelled");
  const code = params.get("code");
  if (!saved || saved.integration !== "reddit" || saved.purpose !== "connect" || !code || params.get("state") !== saved.state) return back("error=expired");
  const app = await readJsonSecret<RedditApp>("reddit_app");
  if (!app) return back("error=not_enabled&key=reddit");

  try {
    const tokens = await exchangeRedditCode(app, code, new URL("/api/connect/reddit/callback", appUrl(req)).toString());
    if (!tokens.refresh_token) throw new Error("Reddit didn't return a lasting grant. Remove the app's access at reddit.com/prefs/apps and connect again.");
    const granted = (tokens.scope ?? "").split(/[ ,]+/);
    const missing = REDDIT_SCOPES.filter((s) => !granted.includes(s));
    if (missing.length) throw new Error(`Reddit didn't grant: ${missing.join(", ")}.`);
    const username = await redditMe({ token: tokens.access_token, username: "" });
    const grant: RedditGrant = { refresh_token: tokens.refresh_token, username, scope: tokens.scope ?? "", connected_by: user.email, connected_at: new Date().toISOString() };
    const ref = await (await secretStore()).put(secretName("reddit"), JSON.stringify(grant));
    await db.update(connections).set({ status: "connected", secretRef: ref, accountLabel: `u/${username}`, error: null, lastSyncAt: new Date(), updatedAt: new Date() }).where(eq(connections.key, "reddit"));
    await audit({ actor: user.email, actorType: "user", action: "connect", target: "Reddit", result: `connected as u/${username}` });
    return back("connected=reddit");
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    await db.update(connections).set({ status: "error", error: message, updatedAt: new Date() }).where(eq(connections.key, "reddit"));
    return back("error=failed&key=reddit");
  }
}

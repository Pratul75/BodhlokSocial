import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db, users } from "@bodh/db";
import { audit } from "@/lib/audit";
import { allowedDomains, appUrl, checkIdentityClaims, exchangeCode, verifyIdToken } from "@/lib/google";
import {
  authEnabled,
  cookieOptions,
  createSessionToken,
  OAUTH_COOKIE,
  openOAuthState,
  SESSION_COOKIE,
  SESSION_DAYS,
} from "@/lib/session";

function fail(req: Request, error: string) {
  const res = NextResponse.redirect(new URL(`/signin?error=${error}`, appUrl(req)));
  res.cookies.delete(OAUTH_COOKIE);
  return res;
}

/** Google redirects here after sign-in. */
export async function GET(req: Request) {
  if (!authEnabled()) return NextResponse.redirect(new URL("/", req.url));
  const params = new URL(req.url).searchParams;
  if (params.get("error")) return fail(req, "cancelled");

  const jar = await cookies();
  const saved = await openOAuthState(jar.get(OAUTH_COOKIE)?.value);
  const code = params.get("code");
  if (!saved || saved.purpose !== "signin" || !code || params.get("state") !== saved.state) {
    return fail(req, "expired");
  }

  let claims: Record<string, unknown>;
  try {
    const tokens = await exchangeCode(code, `${appUrl(req)}/api/auth/callback/google`, saved.verifier);
    if (!tokens.id_token) return fail(req, "google");
    claims = await verifyIdToken(tokens.id_token, saved.nonce);
  } catch {
    return fail(req, "google");
  }

  const check = checkIdentityClaims(claims, allowedDomains());
  if (!check.ok) return fail(req, check.reason);

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, check.identity.email), eq(users.active, true)))
    .limit(1);
  if (!user) {
    await audit({ actor: check.identity.email, actorType: "user", action: "sign_in", target: "app", result: "refused: not added" });
    return fail(req, "no_access");
  }

  await audit({ actor: user.email, actorType: "user", action: "sign_in", target: "app", result: "signed in" });
  const res = NextResponse.redirect(new URL(saved.returnTo, appUrl(req)));
  res.cookies.delete(OAUTH_COOKIE);
  res.cookies.set(SESSION_COOKIE, await createSessionToken({ sub: user.id, email: user.email }), cookieOptions(SESSION_DAYS * 86400));
  return res;
}

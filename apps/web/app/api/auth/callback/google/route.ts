import { NextResponse } from "next/server";
import { log } from "@bodh/shared/log";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db, enterTenant, resolveTenant, tenantBySlug, tenantsForEmail, users, type TenantRef } from "@bodh/db";
import { audit } from "@/lib/audit";
import { slugFromHost, slugFromPath } from "@/lib/tenant";
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
  } catch (e) {
    // Usually a redirect URI or client secret mismatch; the reason only shows in the server log.
    log.warn("google sign-in failed", { error: e });
    return fail(req, "google");
  }

  // Which domains may sign in is the workspace's own setting, so the workspace has to be known
  // before the claims are judged.
  const intended = await signInTenant(String(claims.email ?? ""), saved.returnTo, new URL(req.url).host);
  if (!intended) {
    await audit({ actor: String(claims.email ?? "unknown"), actorType: "user", action: "sign_in", target: "app", result: "refused: no workspace" });
    return fail(req, "no_access");
  }
  enterTenant(intended);
  const check = checkIdentityClaims(claims, await allowedDomains());
  if (!check.ok) return fail(req, check.reason);

  const tenant = intended;

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, check.identity.email), eq(users.active, true)))
    .limit(1);
  if (!user) {
    await audit({ actor: check.identity.email, actorType: "user", action: "sign_in", target: "app", result: "refused: not added" });
    return fail(req, "no_access");
  }

  await audit({ actor: user.email, actorType: "user", action: "sign_in", target: "app", result: `signed in to ${tenant.slug}` });
  const res = NextResponse.redirect(new URL(saved.returnTo, appUrl(req)));
  res.cookies.delete(OAUTH_COOKIE);
  res.cookies.set(
    SESSION_COOKIE,
    // The tenant travels in the session, so every later request knows whose data this is even
    // when the address does not say.
    await createSessionToken({ sub: user.id, email: user.email, sv: user.sessionVersion, tid: tenant.id }),
    cookieOptions(SESSION_DAYS * 86400),
  );
  return res;
}

/**
 * The workspace a sign-in belongs to: the one in the address if there is one, otherwise the
 * only one this address can open. Someone in two workspaces has to come in through one of
 * their addresses, because there is no right answer to guess.
 */
async function signInTenant(email: string, returnTo: string, host: string): Promise<TenantRef | null> {
  const named = slugFromPath(returnTo) ?? slugFromHost(host);
  if (named) {
    const t = await tenantBySlug(named);
    return t && t.status === "active" ? t : null;
  }
  const options = await tenantsForEmail(email);
  if (options.length === 1) return options[0]!;
  if (options.length === 0) {
    // No directory row: a single-tenant installation that predates the control plane.
    const fallback = await resolveTenant(null);
    return fallback && fallback.status === "active" ? fallback : null;
  }
  return null;
}

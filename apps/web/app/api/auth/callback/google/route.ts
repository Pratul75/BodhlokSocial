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
  createChoiceToken,
  createSessionToken,
  OAUTH_COOKIE,
  openOAuthState,
  safeReturnTo,
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

  // Which workspaces this address could be signing in to. The address decides when it names
  // one; otherwise the control plane's directory does, and it can name several.
  const candidates = await signInCandidates(String(claims.email ?? ""), saved.returnTo, new URL(req.url).host);
  if (candidates.length === 0) {
    // Nothing is bound yet, so there is no audit log to write this into: the server log is
    // where a sign-in that belongs to no workspace is recorded.
    log.warn("google sign-in refused: no workspace", { email: String(claims.email ?? "unknown") });
    return fail(req, "no_access");
  }

  // Each workspace judges this sign-in by its own rules and its own people: which domains may
  // sign in is a per-workspace setting, and being listed in the directory is not the same as
  // still having an active row inside the workspace.
  const open: { tenant: TenantRef; user: typeof users.$inferSelect }[] = [];
  let refused: "unverified" | "domain" | "no_access" = "no_access";
  for (const candidate of candidates) {
    enterTenant(candidate);
    const check = checkIdentityClaims(claims, await allowedDomains());
    if (!check.ok) {
      // The first real reason is the one they are told: a later workspace's refusal must not
      // overwrite the explanation that actually fits.
      if (refused === "no_access") refused = check.reason;
      continue;
    }
    const [row] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, check.identity.email), eq(users.active, true)))
      .limit(1);
    if (row) open.push({ tenant: candidate, user: row });
  }

  if (open.length === 0) {
    enterTenant(candidates[0]!);
    await audit({
      actor: String(claims.email ?? "unknown"),
      actorType: "user",
      action: "sign_in",
      target: "app",
      result: refused === "no_access" ? "refused: not added" : `refused: ${refused}`,
    });
    return fail(req, refused);
  }

  // The same address really is in more than one workspace, and these are separate accounts that
  // happen to share it. There is no right one to guess, so they say which they meant — the same
  // step the password door asks for, reached with a token that is minutes' proof of this
  // verified Google identity and names only the workspaces it just opened.
  if (open.length > 1) {
    enterTenant(open[0]!.tenant);
    await audit({
      actor: open[0]!.user.email,
      actorType: "user",
      action: "sign_in",
      target: "app",
      result: `choosing between ${open.length} workspaces`,
    });
    const token = await createChoiceToken({
      email: open[0]!.user.email,
      opened: open.map((o) => `${o.tenant.id}:${o.user.id}`),
      door: "google",
    });
    const to = new URL("/signin", appUrl(req));
    to.searchParams.set("choose", token);
    const next = safeReturnTo(saved.returnTo);
    if (next !== "/") to.searchParams.set("next", next);
    const picker = NextResponse.redirect(to);
    picker.cookies.delete(OAUTH_COOKIE);
    return picker;
  }

  const { tenant, user } = open[0]!;
  enterTenant(tenant);
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
 * The workspaces a sign-in could belong to.
 *
 * An address that names a workspace means that one and no other. Otherwise the directory
 * answers, and it may name several — the caller asks which, rather than guessing.
 */
async function signInCandidates(email: string, returnTo: string, host: string): Promise<TenantRef[]> {
  const named = slugFromPath(returnTo) ?? slugFromHost(host);
  if (named) {
    const t = await tenantBySlug(named);
    return t && t.status === "active" ? [t] : [];
  }
  const options = await tenantsForEmail(email);
  if (options.length) return options;
  // No directory row: a single-tenant installation that predates the control plane.
  const fallback = await resolveTenant(null);
  return fallback && fallback.status === "active" ? [fallback] : [];
}

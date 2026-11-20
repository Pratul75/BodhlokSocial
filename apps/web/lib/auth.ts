import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, enterTenant, ownerSql, tenantById, users, type TenantRef } from "@bodh/db";
import {
  effectiveAccess,
  hasFeature,
  isRole,
  MODULES,
  type Entitlements,
  type FeatureKey,
  type ModuleKey,
  type Role,
} from "@bodh/shared";
import {
  authEnabled,
  devAuthAllowed,
  IMPERSONATION_COOKIE,
  SESSION_COOKIE,
  verifyImpersonationToken,
  verifySessionToken,
} from "./session";
import { bindTenant, NoTenant, TenantMismatch, TenantSuspended, tenantPrefix, UnknownTenant } from "./tenant";
import { tenantEntitlements } from "./entitlements";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** True when Google sign-in is not configured and the dev user is used. */
  devMode: boolean;
  /** The tenant this request belongs to. Every query in the request is bound to it. */
  tenant: TenantRef;
  /**
   * What this tenant may use, read once per request. It travels on the user so that every
   * guard is a plain synchronous call: an async predicate inside `.some()` or a ternary is
   * always truthy, and an entitlement check that is always true is no check at all.
   */
  ent: Entitlements;
  /**
   * Set when a platform operator is looking inside this workspace rather than one of its own
   * people being here. The workspace is bound through its read-only database role, so the
   * database refuses every write; this says who to show in the banner.
   */
  impersonatedBy?: string;
}

export const DEV_ROLE_COOKIE = "bodh_dev_role";

/**
 * An operator looking inside a workspace, if that is what this request is.
 *
 * Checked before any ordinary session: the cookie is its own principal, and its workspace comes
 * from the control plane rather than from the address, so it cannot be pointed somewhere else.
 * The row is read every time, so ending a session in the console ends it at once rather than
 * when the token happens to expire.
 */
async function impersonation(jar: Awaited<ReturnType<typeof cookies>>): Promise<CurrentUser | null> {
  const claims = await verifyImpersonationToken(jar.get(IMPERSONATION_COOKIE)?.value);
  if (!claims) return null;

  const rows = (await ownerSql()<{ ended_at: Date | null; expires_at: Date }[]>`
    select ended_at, expires_at from platform.impersonations where id = ${claims.sub}`) as unknown as {
    ended_at: Date | null;
    expires_at: Date;
  }[];
  const row = rows[0];
  if (!row || row.ended_at || new Date(row.expires_at).getTime() <= Date.now()) return null;

  const tenant = await tenantById(claims.tenantId);
  if (!tenant || tenant.status !== "active") return null;
  const readOnly: TenantRef = { ...tenant, readOnly: true };
  enterTenant(readOnly);

  const [person] = await db.select().from(users).where(eq(users.id, claims.userId)).limit(1);
  if (!person) return null;
  return {
    id: person.id,
    email: person.email,
    name: person.name,
    role: isRole(person.role) ? person.role : "social_manager",
    devMode: false,
    tenant: readOnly,
    ent: await tenantEntitlements(tenant.id),
    impersonatedBy: claims.operatorEmail,
  };
}

/**
 * With Google sign-in configured, the user comes from the session cookie and their
 * role from the database. Without it (local development only), every request runs
 * as DEV_USER_EMAIL and a cookie can preview other roles.
 *
 * This is also where the request's tenant is resolved and bound, before any query runs.
 */
export const getCurrentUser: () => Promise<CurrentUser> = cache(loadCurrentUser);

async function loadCurrentUser(): Promise<CurrentUser> {
  const jar = await cookies();

  // An operator looking inside a workspace comes first, and brings its own read-only binding.
  const asOperator = await impersonation(jar);
  if (asOperator) return asOperator;

  // A session first, whichever door it came through. Google is one of them; a password set from
  // an invitation is the other, and a workspace that uses only passwords has no Google client
  // configured at all — so asking "is Google set up?" before "are they signed in?" would lock
  // those workspaces out of their own application.
  const claims = await verifySessionToken(jar.get(SESSION_COOKIE)?.value);
  if (claims) {
    const tenant = await bind(claims.tid);
    // bind() entered the tenant in ITS frame; enterWith does not carry back to a caller, so
    // this function has to enter it in its own before it queries anything.
    enterTenant(tenant);
    const [row] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, claims.sub), eq(users.active, true)))
      .limit(1);
    if (!row) redirect("/signin?error=no_access");
    // Signed out elsewhere, or access was removed and restored: this cookie is from before that.
    if (row.sessionVersion !== claims.sv) redirect("/signin?error=session_ended");
    const role: Role = isRole(row.role) ? row.role : "social_manager";
    const ent = await tenantEntitlements(tenant.id);
    return { id: row.id, email: row.email, name: row.name, role, devMode: false, tenant, ent };
  }

  // No session. With a way to sign in, send them to it; the sign-in page offers whichever doors
  // this installation has.
  if (authEnabled() || !devAuthAllowed()) redirect(`${await tenantPrefix()}/signin`);

  // Development only, and only with no sign-in client at all: everybody is DEV_USER_EMAIL.
  const tenant = await bind(null);
  enterTenant(tenant);
  const email = process.env.DEV_USER_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error("Set DEV_USER_EMAIL in .env to run without Google sign-in.");
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), eq(users.active, true)))
    .limit(1);
  if (!row) throw new Error(`No active user ${email} in tenant ${tenant.slug}. Run "pnpm db:seed" or add the user in Admin.`);
  const override = jar.get(DEV_ROLE_COOKIE)?.value;
  const role: Role = isRole(override) ? override : isRole(row.role) ? row.role : "social_manager";
  const ent = await tenantEntitlements(tenant.id);
  return { id: row.id, email: row.email, name: row.name, role, devMode: true, tenant, ent };
}

/**
 * Binds the rest of THIS function to the user's tenant.
 *
 * It must be called from the entry point itself, not from a helper: AsyncLocalStorage's
 * enterWith() binds the current execution context, and a context entered inside an awaited
 * callee does not carry back to its caller. One line at the top of each page, action and
 * route is the price of leaving all 285 query call sites untouched.
 */
export function enterTenantScope(user: CurrentUser): CurrentUser {
  enterTenant(user.tenant);
  return user;
}

/** Resolves and binds the tenant, turning the failures into the right redirect. */
async function bind(hint: string | null | undefined): Promise<TenantRef> {
  try {
    return await bindTenant(hint);
  } catch (e) {
    if (e instanceof UnknownTenant) notFound();
    if (e instanceof TenantMismatch) redirect("/signin?error=wrong_tenant");
    if (e instanceof TenantSuspended) redirect("/signin?error=tenant_suspended");
    if (e instanceof NoTenant) redirect("/signin?error=no_tenant");
    throw e;
  }
}

/**
 * The one access question, asked the same way by pages, server actions, API routes and the
 * sidebar: does this person's role allow the module, AND is the tenant entitled to it?
 */
export function allowed(user: CurrentUser, key: ModuleKey): boolean {
  return effectiveAccess(user.role, key, user.ent);
}

/** Whether the tenant has a capability inside a module. Role is not part of this question. */
export function featureOn(user: CurrentUser, key: FeatureKey): boolean {
  return hasFeature(user.ent, key);
}

/**
 * The same question for an API route, which must refuse rather than redirect.
 *
 * A page can send somebody somewhere else; a `fetch` cannot be sent anywhere — a 307 to another
 * module reads as success to whatever called it. Routes that serve a module's data use this and
 * get a 404: that a module exists is not something a workspace without it needs told.
 */
export async function requireModuleApi(key: ModuleKey): Promise<CurrentUser | Response> {
  const user = await getCurrentUser();
  if (allowed(user, key)) return user;
  return new Response("Not found", { status: 404 });
}

/**
 * Use at the top of each page. Sends people without access to the first page they may see,
 * which is never the page they were refused — redirecting to "/" when Today itself is off
 * is an infinite loop.
 */
export async function requireModule(key: ModuleKey): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (allowed(user, key)) return user;
  redirect(await landingFor(user));
}

/** The first page this person may open in this tenant, with the tenant's own address kept. */
export async function landingFor(user: CurrentUser): Promise<string> {
  const prefix = await tenantPrefix();
  const first = MODULES.find((m) => allowed(user, m.key));
  if (!first) return `${prefix}/no-access`;
  return first.href === "/" ? `${prefix}/` : `${prefix}${first.href}`;
}

import "server-only";
import { headers } from "next/headers";
import { enterTenant, firstTenant, resolveTenant, tenantBySlug, type TenantRef } from "@bodh/db";

/**
 * Which tenant a web request belongs to, and binding the rest of the request to it.
 *
 * Resolution order, first match wins:
 *   1. the tenant claim in the session cookie (the signed-in person's own tenant)
 *   2. a `/t/<slug>/…` path prefix
 *   3. the host, when a tenant has been given its own hostname
 *   4. DEFAULT_TENANT_SLUG, while the application is still a single-tenant installation
 *
 * A claim that disagrees with the path or host is refused rather than trusted.
 */

/** The `/t/<slug>` prefix of a path, if it has one. */
export function slugFromPath(pathname: string): string | null {
  const m = /^\/t\/([a-z0-9-]{2,40})(?:\/|$)/.exec(pathname);
  return m ? m[1]! : null;
}

/** Strips the `/t/<slug>` prefix, so the rest of the app sees the paths it already knows. */
export function pathWithoutTenant(pathname: string): string {
  const m = /^\/t\/[a-z0-9-]{2,40}(\/.*)?$/.exec(pathname);
  if (!m) return pathname;
  return m[1] && m[1] !== "" ? m[1] : "/";
}

/** The slug a hostname maps to, when tenants are given their own hostnames. Off by default. */
export function slugFromHost(host: string | null): string | null {
  const base = process.env.TENANT_HOST_SUFFIX?.trim();
  if (!base || !host) return null;
  const name = host.split(":")[0]!.toLowerCase();
  if (!name.endsWith(`.${base}`)) return null;
  const sub = name.slice(0, -(base.length + 1));
  return /^[a-z0-9-]{2,40}$/.test(sub) ? sub : null;
}

/**
 * The tenant implied by the request itself (path or host), ignoring the session.
 * `named` says whether the address named a tenant at all, which matters: an address that
 * names an unknown tenant must be refused, never quietly served as the default one.
 */
export async function tenantFromRequest(): Promise<{ named: string | null; tenant: TenantRef | null }> {
  const h = await headers();
  const fromProxy = h.get("x-tenant-slug");
  const pathname = h.get("x-tenant-path") ?? "";
  const named = fromProxy ?? slugFromPath(pathname) ?? slugFromHost(h.get("host"));
  return { named, tenant: named ? await tenantBySlug(named) : null };
}

/**
 * The `/t/<slug>` prefix this request came in on, or "" when it did not use one. Redirects add
 * it back: a redirect to "/" from `/t/acme/ads` would otherwise leave the tenant's address.
 */
export async function tenantPrefix(): Promise<string> {
  const h = await headers();
  const slug = h.get("x-tenant-slug") ?? slugFromPath(h.get("x-tenant-path") ?? "");
  return slug ? `/t/${slug}` : "";
}

/**
 * Resolves the tenant for this request and binds the rest of it. Every page, action and route
 * reaches this through `getCurrentUser()` before it touches data, which is what keeps the
 * application's existing query call sites unchanged.
 */
export async function bindTenant(hint?: string | null): Promise<TenantRef> {
  const { named, tenant: fromRequest } = await tenantFromRequest();

  // An address that names a tenant we do not have is refused. Falling back to the default
  // tenant here would serve tenant #1 under any slug anyone typed.
  if (named && !fromRequest) throw new UnknownTenant(named);

  // A session claim that disagrees with the address is not trusted.
  if (hint && fromRequest && fromRequest.id !== hint && fromRequest.slug !== hint) {
    throw new TenantMismatch(fromRequest.slug);
  }

  // Precedence: the address, then the session's own tenant, then — only while the application
  // is still a single-tenant installation — the default fallback.
  //
  // A session that names a workspace which no longer resolves is refused, not quietly served as
  // tenant #1: a cookie from a deleted or renamed workspace must not become access to another.
  let tenant = fromRequest;
  if (!tenant && hint) {
    tenant = await resolveTenant(hint);
    // Their session names a workspace that no longer resolves. Sending them to sign in again is
    // the only safe answer; falling through would hand them somebody else's workspace.
    if (!tenant) throw new NoTenant();
  }
  tenant = tenant ?? (await resolveTenant(null));
  if (!tenant) throw new NoTenant();
  if (tenant.status === "suspended") throw new TenantSuspended(tenant.slug);
  enterTenant(tenant);
  return tenant;
}

/**
 * The tenant for a public endpoint — a webhook or the page feed — which has no session to go by.
 *
 * `/t/<slug>/api/…` names its tenant. The bare `/api/…` paths are the ones the live
 * installation's webhooks already point at; they stay with tenant #1 so nothing outside has to
 * be reconfigured, and once the single-tenant fallback is gone they are refused rather than
 * delivered to whichever tenant happens to be first.
 */
export async function publicTenant(): Promise<TenantRef | null> {
  const { named, tenant } = await tenantFromRequest();
  if (named) return tenant && tenant.status === "active" ? tenant : null;
  // No tenant in the address: these are the URLs the outside world already holds, and they
  // belong to tenant #1 whether or not the single-tenant fallback is still switched on.
  const fallback = (await resolveTenant(null)) ?? (await firstTenant());
  return fallback && fallback.status === "active" ? fallback : null;
}

export class NoTenant extends Error {
  constructor() {
    super("No tenant for this request.");
    this.name = "NoTenant";
  }
}

export class UnknownTenant extends Error {
  constructor(public readonly slug: string) {
    super(`No tenant named ${slug}.`);
    this.name = "UnknownTenant";
  }
}

export class TenantMismatch extends Error {
  constructor(public readonly expected: string) {
    super(`This session belongs to a different tenant than ${expected}.`);
    this.name = "TenantMismatch";
  }
}

export class TenantSuspended extends Error {
  constructor(public readonly slug: string) {
    super(`Tenant ${slug} is suspended.`);
    this.name = "TenantSuspended";
  }
}

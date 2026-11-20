/**
 * Booting a throwaway test database as a single-tenant installation.
 *
 * Every database-backed test makes its own empty database and then runs the application's real
 * code against it. That code now expects a workspace: there is no silent fall-back to tenant #1
 * any more, by design. So a test has to do what a first deploy does — create the control plane,
 * register the workspace its data belongs to, and read the registry once so the single-tenant
 * default is established rather than assumed.
 *
 * This lives in `src` rather than a test folder because the tests that need it are in other
 * packages, and a test helper that only tests import is still part of what this package offers.
 */
import { forgetOwnerPool, rememberTenantCount, type TenantRef } from "./client";
import { listTenants, registerFirstTenant, setupPlatform } from "./tenancy";

export interface SingleTenantBoot {
  tenant: TenantRef;
  /** The cluster-wide role this created, for the test to drop when it drops its database. */
  role: string | null;
}

/**
 * Call right after the test has pointed DATABASE_URL at its own database and applied the
 * migrations. Returns the workspace everything in that database belongs to.
 */
export async function bootstrapSingleTenant(
  opts: { slug?: string; name?: string } = {},
): Promise<SingleTenantBoot> {
  const slug = opts.slug ?? "first";
  // The owner connection reads the control plane. A test has pointed DATABASE_URL at its own
  // database; MIGRATE_DATABASE_URL may still name the development one, and registering this
  // test's workspace there is exactly the accident worth preventing.
  process.env.MIGRATE_DATABASE_URL = process.env.DATABASE_URL;
  await forgetOwnerPool();
  // Set before the registry is read: that is where the default workspace is resolved.
  process.env.DEFAULT_TENANT_SLUG = slug;
  await setupPlatform();
  const tenant = await registerFirstTenant({ slug, name: opts.name ?? "First" });
  const all = await listTenants();
  rememberTenantCount(all.length);
  return { tenant, role: tenant.dbRole };
}

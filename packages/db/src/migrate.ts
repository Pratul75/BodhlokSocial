/**
 * Database setup, run on every deploy:
 * 1. the control plane (`platform` schema) — additive and idempotent
 * 2. tenant #1's own schema (`public`) brought up to date, so the registry below can be read
 * 3. register the existing installation as tenant #1, without moving a row, and put every
 *    workspace in an organization
 * 4. EVERY tenant brought up to date, suspended ones included
 * 5. seed tenant #1's baseline rows (connections, ₹0 spend caps, brand kit, first admin)
 * 6. seed the first platform operator from PLATFORM_OWNER_EMAIL, if it is set
 *
 * Step 4 is the point of this file: one set of migration files, every schema. Each schema keeps
 * its own record of what it has had, inside itself. Drizzle's `drizzle.__drizzle_migrations` is
 * left exactly as it is — it is how tenant #1's record is seeded the first time this runs, and
 * after that it is history.
 */
import { ownerSql, withTenant, type TenantRef } from "./client";
import { migrateAllTenants, migrateTenant, type TenantMigrationResult } from "./migrate-tenants";
import { backfillEntitlements, ensureTenantRoles, listTenants, registerFirstTenant, setupPlatform } from "./tenancy";
import { backfillOrgs } from "./orgs";
import { seedTenantBaseline } from "./seed-tenant";

const FIRST_TENANT_SLUG = process.env.FIRST_TENANT_SLUG?.trim() || "bodhlok";
const FIRST_TENANT_NAME = process.env.FIRST_TENANT_NAME?.trim() || "Bodhlok";

function report(r: TenantMigrationResult): void {
  const bits = [`${r.slug} (${r.schema})`];
  if (r.applied.length) bits.push(`applied ${r.applied.length}: ${r.applied.join(", ")}`);
  if (r.baselined.length) bits.push(`recorded ${r.baselined.length} already present`);
  if (!r.applied.length && !r.baselined.length) bits.push(`already up to date (${r.skipped})`);
  if (r.error) {
    console.error(`  ✗ ${bits.join(" — ")}\n    ${r.error}`);
  } else {
    console.log(`  ✓ ${bits.join(" — ")}`);
  }
}

async function main() {
  // 1. The control plane. Nothing else can be read until it exists.
  await setupPlatform();
  console.log("Platform schema present.");

  // 2. Tenant #1's schema, before the registry is read: on a new database `public` has no
  //    tables at all, so registerFirstTenant() has nothing to read until this has run.
  const firstRef: TenantRef = {
    id: "bootstrap",
    slug: FIRST_TENANT_SLUG,
    name: FIRST_TENANT_NAME,
    dataSchema: process.env.FIRST_TENANT_SCHEMA?.trim() || "public",
    dbRole: null,
    status: "active",
  };
  console.log("Migrations:");
  const bootstrap = await migrateTenant(firstRef);
  report(bootstrap);
  if (bootstrap.error) throw new Error(bootstrap.error);

  // 3. Tenant #1, registered against the schema its data already lives in.
  const first = await registerFirstTenant({ slug: FIRST_TENANT_SLUG, name: FIRST_TENANT_NAME });
  console.log(`Tenant #1 registered: ${first.slug} -> schema ${first.dataSchema}.`);

  // 3a. The agency every workspace belongs to. An installation made before organizations
  //     existed has workspaces and nobody holding them; this is who holds them. One column
  //     gains a value — no schema, no role and no row of customer data is touched.
  const { org, placed } = await backfillOrgs(FIRST_TENANT_NAME);
  console.log(
    placed > 0
      ? `Organization ${org.name} (${org.slug}): ${placed} workspace(s) placed in it.`
      : `Organization ${org.name} (${org.slug}) present; every workspace already has one.`,
  );

  // 4. Every tenant. Tenant #1 is already done and reports as up to date. Each one's roles and
  //    grants are checked too, so a workspace made before a feature existed gains it here.
  const results = await migrateAllTenants();
  for (const t of await listTenants()) {
    await ensureTenantRoles(t.id).catch(() => undefined);
    // Entitlement rows for anything that did not exist when this workspace was provisioned.
    // `on conflict do nothing`, so a switch an operator has already set is never overwritten;
    // this only fills in kinds and keys that were added since. Without it a deploy that adds a
    // kind would leave every existing workspace with no rows of it, and the deploy would be the
    // decision rather than an operator.
    const added = await backfillEntitlements(t.id, "migrate").catch(() => 0);
    if (added) console.log(`  ${t.slug}: ${added} new entitlement row(s) for things added since it was made.`);
  }
  for (const r of results) if (r.slug !== first.slug) report(r);
  const failed = results.filter((r) => r.error);

  // 5. Tenant #1's baseline rows, written inside its own scope.
  await withTenant(first, () =>
    seedTenantBaseline({
      adminEmail: process.env.BOOTSTRAP_ADMIN_EMAIL,
      adminName: process.env.BOOTSTRAP_ADMIN_NAME,
    }),
  );
  console.log("Connection rows, spend caps and brand kit present.");

  // 6. The first platform operator. Never guessed: without the variable, none is created and
  //    the Super Admin console has nobody who can sign in.
  const ownerEmail = process.env.PLATFORM_OWNER_EMAIL?.trim().toLowerCase();
  if (ownerEmail) {
    const sql = ownerSql();
    await sql`
      insert into platform.platform_operators (email, name, role, active)
      values (${ownerEmail}, ${process.env.PLATFORM_OWNER_NAME?.trim() || ownerEmail.split("@")[0]!}, 'owner', true)
      on conflict (email) do update set active = true, role = 'owner'`;
    console.log(`Platform owner present: ${ownerEmail}.`);
  } else {
    console.warn(
      "PLATFORM_OWNER_EMAIL is not set: no platform operator was created, so nobody can sign in to /super-admin. " +
        "Set it and run this again to create the first Super Admin.",
    );
  }

  await ownerSql().end();

  // A tenant left behind is a deploy that half-worked: say so, and fail the step.
  if (failed.length) {
    throw new Error(
      `${failed.length} tenant(s) were not migrated: ${failed.map((f) => `${f.slug} (${f.error})`).join("; ")}`,
    );
  }
}

main().catch(async (err) => {
  console.error(err);
  await ownerSql().end().catch(() => undefined);
  process.exit(1);
});

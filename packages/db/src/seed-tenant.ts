/**
 * The baseline rows every tenant starts with. This is the body of the single-tenant
 * bootstrap in migrate.ts, lifted so both callers use the same code:
 *   - one `connections` row per integration in the catalogue
 *   - ₹0 spend caps for both ad platforms, so a new tenant cannot spend money
 *   - the single brand-kit row
 *   - the first admin
 *
 * Runs inside a tenant scope, so every write lands in that tenant's own schema.
 */
import { eq } from "drizzle-orm";
import { INTEGRATIONS } from "@bodh/shared";
import { currentTenant, db } from "./client";
import { brandKit, budgets, connections, users } from "./schema";
import { noteUserInDirectory } from "./tenancy";

export interface TenantBaseline {
  adminEmail?: string;
  adminName?: string;
}

export async function seedTenantBaseline(opts: TenantBaseline = {}): Promise<void> {
  await db
    .insert(connections)
    .values(INTEGRATIONS.map((i) => ({ key: i.key })))
    .onConflictDoNothing();

  await db
    .insert(budgets)
    .values([
      { platform: "google_ads", dailyCap: 0, monthlyCap: 0, updatedBy: "setup" },
      { platform: "meta_ads", dailyCap: 0, monthlyCap: 0, updatedBy: "setup" },
    ])
    .onConflictDoNothing();

  await db.insert(brandKit).values({ id: 1 }).onConflictDoNothing();

  const email = opts.adminEmail?.trim().toLowerCase();
  if (email) {
    const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
    if (admins.length === 0) {
      const name = opts.adminName?.trim() || email.split("@")[0]!;
      await db
        .insert(users)
        .values({ email, name, role: "admin" })
        .onConflictDoUpdate({ target: users.email, set: { role: "admin", active: true } });
    }
    // The control plane's directory is how sign-in finds which workspaces an address can open,
    // before any workspace is bound. A user row written here and nowhere else would leave the
    // very first admin of a new installation unable to sign in to it.
    const tenant = currentTenant();
    if (tenant.id !== "bootstrap") await noteUserInDirectory(tenant.id, email, true);
  }
}

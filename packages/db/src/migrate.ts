/**
 * Production database setup, run as a Cloud Run job on every deploy:
 * 1. apply SQL migrations from ./migrations
 * 2. make sure every integration has a connections row and each ad platform has caps
 *    (caps start at ₹0, which blocks all spend until an admin sets them)
 * 3. create the first admin from BOOTSTRAP_ADMIN_EMAIL if there is no admin yet
 */
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import { INTEGRATIONS } from "@bodh/shared";
import { db, sql } from "./client";
import { budgets, connections, users } from "./schema";

async function main() {
  const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
  await migrate(db, { migrationsFolder });
  console.log("Migrations applied.");

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
  console.log("Connection rows and spend caps present.");

  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (email) {
    const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
    if (admins.length === 0) {
      const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || email.split("@")[0]!;
      await db
        .insert(users)
        .values({ email, name, role: "admin" })
        .onConflictDoUpdate({ target: users.email, set: { role: "admin", active: true } });
      console.log(`Created first admin ${email}.`);
    }
  }
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});

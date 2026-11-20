/**
 * Mints the session cookie the Google callback would have set, and prints it.
 *
 * For testing the application the way a Google-only installation runs it: a person with no
 * password at all, in tenant #1, exactly as production works today. Nothing here is a way in
 * that the application does not already have — it signs the same claims with the same secret,
 * and only works for somebody who is already an active user of that workspace.
 */
import { SignJWT } from "jose";
import { and, eq } from "drizzle-orm";
import { db, tenantBySlug, users, withTenant } from "@bodh/db";

async function main() {
  const [slug, email] = process.argv.slice(2);
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must be set");

  const tenant = await tenantBySlug(slug!);
  if (!tenant) throw new Error(`No workspace ${slug}`);

  const row = await withTenant(tenant, async () => {
    const [found] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, email!), eq(users.active, true)))
      .limit(1);
    return found ?? null;
  });
  if (!row) throw new Error(`No active user ${email} in ${slug}`);

  const token = await new SignJWT({ email: row.email, sv: row.sessionVersion, tid: tenant.id })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(row.id)
    .setIssuedAt()
    .setExpirationTime("7d")
    .setAudience("bodh-session")
    .sign(new TextEncoder().encode(secret));

  console.log(token);
  console.error(`(${row.email}, role ${row.role}, password ${row.passwordHash ? "set" : "none"}, workspace ${tenant.slug})`);
  process.exit(0);
}

main();

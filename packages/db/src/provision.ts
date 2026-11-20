/**
 * Create a tenant from the command line. The Super Admin console calls the same function.
 *
 *   pnpm --filter @bodh/db provision -- --slug acme --name "Acme Ltd" --admin someone@acme.com
 *
 * Idempotent: running it again for an existing slug finishes anything left undone.
 */
import { ownerSql } from "./client";
import { provisionTenant } from "./tenancy";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const slug = arg("slug");
  const name = arg("name");
  const admin = arg("admin");
  if (!slug || !name || !admin) {
    console.error('Usage: provision --slug <slug> --name "<name>" --admin <email> [--admin-name "<name>"] [--plan full]');
    process.exit(2);
  }

  const result = await provisionTenant({
    slug,
    name,
    adminEmail: admin,
    adminName: arg("admin-name"),
    plan: arg("plan") ?? "full",
    actor: process.env.PROVISION_ACTOR ?? "cli",
  });

  console.log(
    `${result.created ? "Created" : "Completed"} tenant ${result.tenant.slug}: ` +
      `schema ${result.tenant.dataSchema}, role ${result.tenant.dbRole}, ${result.tables} tables.`,
  );
  for (const n of result.notes) console.log(`  - ${n}`);
  await ownerSql().end();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await ownerSql().end().catch(() => undefined);
  process.exit(1);
});

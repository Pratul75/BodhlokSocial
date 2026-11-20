/**
 * What this deploy will do to the database it is pointed at — before it does it.
 *
 * Read-only. It opens no transaction, writes no row and changes no setting; every statement is
 * a SELECT. Run it against production with production's DATABASE_URL and read the answers.
 *
 *   cd packages/db && pnpm exec tsx ../../scripts/preflight.ts
 *
 * It answers the questions that decide whether this is a safe deploy:
 *   - is the control plane there at all, and which of its files have been applied
 *   - which per-workspace migrations are missing, per workspace
 *   - does each workspace have entitlement rows, and of which kinds
 *   - would any module disappear from a workspace the moment this ships
 *   - is anything relying on a capability whose module is off
 */
import { INTEGRATIONS, MODULES, FEATURE_KEYS, MODULE_INTEGRATIONS, FEATURE_MODULE, type ModuleKey } from "@bodh/shared";
import { buildEntitlements, listTenants, migrationFiles, ownerSql, sql as tenantSql, withTenant } from "@bodh/db";

const ok = (s: string) => console.log(`  ok      ${s}`);
const warn = (s: string) => console.log(`  CHECK   ${s}`);
const bad = (s: string) => console.log(`  PROBLEM ${s}`);

async function exists(table: string): Promise<boolean> {
  const rows = (await ownerSql()<{ n: string }[]>`
    select count(*)::text as n from information_schema.tables
    where table_schema = 'platform' and table_name = ${table}`) as unknown as { n: string }[];
  return rows[0]!.n !== "0";
}

/**
 * The question a deploy day actually turns on: which migration files would RUN against the
 * existing installation, as opposed to being recorded as already there.
 *
 * On a database that predates per-schema migration records, the runner reads Drizzle's own
 * `__drizzle_migrations` and marks every file whose journal timestamp it finds as applied
 * WITHOUT running it. If that matching ever failed, an old file would run a second time — and
 * two of them are destructive (`DROP TABLE "leads"`, a `DELETE FROM "connections"`). This says
 * in advance exactly which files would run, and shouts if one of them removes anything.
 */
async function migrationPlan(): Promise<number> {
  const sql = ownerSql();
  const already = (await sql`
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = '__tenant_migrations' limit 1`) as unknown as unknown[];
  if (already.length) {
    ok("public already keeps its own migration record — the baseline step is behind this database");
    return 0;
  }

  const files = await migrationFiles();
  const hasDrizzle = (await sql`
    select 1 from information_schema.tables
    where table_schema = 'drizzle' and table_name = '__drizzle_migrations' limit 1`) as unknown as unknown[];
  if (!hasDrizzle.length) {
    warn("no drizzle.__drizzle_migrations: this looks like an empty database, where every file runs and that is correct");
    return 0;
  }

  const rows = (await sql`select created_at::text as created_at from drizzle.__drizzle_migrations`) as unknown as {
    created_at: string;
  }[];
  const stamps = new Set(rows.map((r) => String(r.created_at)));
  const baselined = files.filter((f) => stamps.has(String(f.when)));
  const wouldRun = files.filter((f) => !stamps.has(String(f.when)));

  ok(`${baselined.length} file(s) recognised as already applied — recorded, not run`);
  if (wouldRun.length === 0) {
    ok("nothing would run");
    return 0;
  }

  let problems = 0;
  for (const f of wouldRun) {
    const destructive = f.statements.filter((s) => /^\s*(drop|truncate|delete\s+from)\b/i.test(s));
    if (destructive.length) {
      bad(`${f.tag} WOULD RUN and it removes things: ${destructive.map((s) => s.split("\n")[0]!.slice(0, 60)).join(" | ")}`);
      problems++;
    } else {
      warn(`${f.tag} would run (additive)`);
    }
  }
  if (problems) {
    bad("a destructive file is about to run again — do not deploy until you know why its timestamp was not recognised");
  }
  return problems;
}

async function main() {
  let problems = 0;
  let checks = 0;

  console.log("\n=== Control plane ===");
  for (const t of ["tenants", "entitlements", "platform_operators", "user_directory", "invite_tokens"]) {
    if (await exists(t)) ok(`platform.${t}`);
    else {
      bad(`platform.${t} is missing — run the platform SQL (setupPlatform) before serving traffic`);
      problems++;
    }
  }

  const opCols = (await ownerSql()<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_schema = 'platform' and table_name = 'platform_operators'`) as unknown as { column_name: string }[];
  const haveOp = new Set(opCols.map((c) => c.column_name));
  for (const c of ["password_hash", "failed_sign_ins", "locked_until"]) {
    if (haveOp.has(c)) ok(`platform_operators.${c}`);
    else {
      bad(`platform_operators.${c} is missing — console sign-in will fail`);
      problems++;
    }
  }

  const tenantCols = (await ownerSql()<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_schema = 'platform' and table_name = 'tenants'`) as unknown as { column_name: string }[];
  const haveT = new Set(tenantCols.map((c) => c.column_name));
  for (const c of ["archived_at", "purge_after"]) {
    if (haveT.has(c)) ok(`tenants.${c}`);
    else {
      bad(`tenants.${c} is missing — archiving a workspace will fail`);
      problems++;
    }
  }

  const kindCheck = (await ownerSql()<{ def: string }[]>`
    select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'entitlements_kind_check'`) as unknown as {
    def: string;
  }[];
  if (!kindCheck[0]) warn("no entitlements_kind_check constraint — unusual, but nothing will break");
  else if (kindCheck[0].def.includes("integration")) ok("entitlements allows the 'integration' kind");
  else {
    bad("entitlements_kind_check does not allow 'integration' — run platform SQL 006 first");
    problems++;
  }

  console.log("\n=== What this deploy would run on tenant #1 ===");
  problems += await migrationPlan();

  console.log("\n=== Workspaces ===");
  const tenants = await listTenants();
  if (tenants.length === 0) {
    warn("no workspaces registered — a single-tenant installation that has not been migrated yet");
  }

  for (const t of tenants) {
    console.log(`\n  ${t.slug}  (${t.dataSchema}, ${t.status})`);

    // Per-workspace migrations.
    try {
      const applied = await withTenant({ ...t, readOnly: true }, async () => {
        const rows = (await tenantSql`select tag from __tenant_migrations`) as unknown as { tag: string }[];
        return rows.map((r) => r.tag);
      });
      ok(`${applied.length} migrations recorded, latest ${applied.sort().at(-1) ?? "(none)"}`);
    } catch (e) {
      warn(`could not read __tenant_migrations: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
      checks++;
    }

    // Entitlement rows, by kind.
    const rows = (await ownerSql()<{ kind: string; key: string; enabled: boolean; value: string | null }[]>`
      select kind, key, enabled, value::text as value from platform.entitlements where tenant_id = ${t.id}`) as unknown as {
      kind: string;
      key: string;
      enabled: boolean;
      value: string | null;
    }[];
    const byKind = (k: string) => rows.filter((r) => r.kind === k);

    if (rows.length === 0) {
      bad("no entitlement rows at all — this workspace will see NOTHING. Provision it before deploying");
      problems++;
      continue;
    }
    ok(
      `${byKind("module").filter((r) => r.enabled).length}/${byKind("module").length} modules, ` +
        `${byKind("feature").filter((r) => r.enabled).length}/${byKind("feature").length} features, ` +
        `${byKind("integration").filter((r) => r.enabled).length}/${byKind("integration").length} integrations`,
    );

    if (byKind("integration").length === 0) {
      warn("no integration rows — every account is granted until an operator decides otherwise (this is intended for workspaces older than that feature). Run the backfill to make it explicit");
      checks++;
    }
    for (const kind of ["module", "feature"] as const) {
      const expected = kind === "module" ? MODULES.length : FEATURE_KEYS.length;
      if (byKind(kind).length < expected) {
        warn(`${expected - byKind(kind).length} ${kind} row(s) missing — those read as off`);
        checks++;
      }
    }

    // What the application will actually show.
    const ent = buildEntitlements(rows);
    const hidden = MODULES.filter((m) => {
      if (!ent.modules.has(m.key)) return false; // switched off deliberately
      const needs = MODULE_INTEGRATIONS[m.key as ModuleKey];
      return needs?.length ? !needs.some((k) => ent.integrations.has(k)) : false;
    });
    if (hidden.length) {
      bad(`${hidden.length} module(s) are ON but would be hidden for want of an account: ${hidden.map((m) => m.label).join(", ")}`);
      problems++;
    } else {
      ok("no module would disappear");
    }

    const inert = FEATURE_KEYS.filter((f) => ent.features.has(f) && !ent.modules.has(FEATURE_MODULE[f]));
    if (inert.length) {
      warn(`${inert.length} feature(s) on while their module is off, so they do nothing: ${inert.join(", ")}`);
      checks++;
    }

    const unknownIntegration = byKind("integration").filter((r) => !INTEGRATIONS.some((i) => i.key === r.key));
    if (unknownIntegration.length) {
      warn(`rows for accounts this build does not know: ${unknownIntegration.map((r) => r.key).join(", ")}`);
      checks++;
    }
  }

  console.log("\n=== Summary ===");
  console.log(`  ${problems} problem(s), ${checks} thing(s) to look at.`);
  console.log(problems === 0 ? "  Nothing here blocks the deploy.\n" : "  Fix the problems above before deploying.\n");
  process.exit(problems === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("preflight failed:", e);
  process.exit(2);
});

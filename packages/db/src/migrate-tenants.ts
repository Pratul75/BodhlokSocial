/**
 * The migration runner, for every tenant.
 *
 * One set of SQL files, applied to every tenant's schema — tenant #1's `public` included — with
 * each schema keeping its own record of what it has had. Before this existed, migrations reached
 * `public` and nowhere else: a tenant provisioned last month would still be on the table
 * definitions of the day it was made, and the first query against a new column would fail for it
 * and for nobody else.
 *
 * How it stays safe to run again:
 *  - each schema has `__tenant_migrations` (tag, hash, when) inside itself, so the record travels
 *    with the data and a schema dropped or restored carries its own truth;
 *  - a migration runs in one transaction, so a failure leaves nothing recorded and the next run
 *    tries it again from the same place;
 *  - a tenant that fails does not stop the others — the run reports each one and ends non-zero;
 *  - a session advisory lock per schema, so two deploys cannot apply the same file twice;
 *  - a file whose text changed after it was applied is refused, because that means the schema this
 *    code expects and the schema that exists are no longer the same thing;
 *  - after every tenant's run, the "no foreign key leaves this schema" assertion runs again.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ownerSql, type TenantRef } from "./client";

export const TRACKING_TABLE = "__tenant_migrations";

export interface MigrationFile {
  /** `0013_ga4_data_api` — the name the journal and the filename share. */
  tag: string;
  /** The journal's timestamp, which is also what Drizzle's own bookkeeping stores. */
  when: number;
  /** The file's statements, with `"public".` stripped so they land in the tenant's own schema. */
  statements: string[];
  /** SHA-256 of the file as written on disk, before de-qualification. */
  hash: string;
}

export interface TenantMigrationResult {
  slug: string;
  schema: string;
  /** Tags applied by this run. */
  applied: string[];
  /** Tags recorded as already present without being run (first run on an existing schema). */
  baselined: string[];
  /** Tags that were already recorded. */
  skipped: number;
  error?: string;
}

function migrationsDir(): string {
  // dirname twice: .../packages/db/src/migrate-tenants.ts -> .../packages/db
  return join(dirname(dirname(fileURLToPath(import.meta.url))), "migrations");
}

/** Statements of one migration file, in order, with `"public".` removed. */
export function splitStatements(text: string): string[] {
  return text
    .replaceAll('"public".', "")
    .split("--> statement-breakpoint")
    .map((s) => s.trim().replace(/;\s*$/, ""))
    .filter(Boolean);
}

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/**
 * Every migration on disk, in the order the journal gives. The journal is the authority on
 * order and on `when`, which is the only thing that ties a file to Drizzle's own record of it.
 */
export async function migrationFiles(): Promise<MigrationFile[]> {
  const dir = migrationsDir();
  let entries: JournalEntry[] = [];
  try {
    const journal = JSON.parse(await readFile(join(dir, "meta", "_journal.json"), "utf8")) as {
      entries?: JournalEntry[];
    };
    entries = journal.entries ?? [];
  } catch {
    // No journal: fall back to the filenames, which carry the same order.
    const files = (await readdir(dir)).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
    entries = files.map((f, i) => ({ idx: i, when: 0, tag: f.replace(/\.sql$/, "") }));
  }
  entries.sort((a, b) => a.idx - b.idx);

  const out: MigrationFile[] = [];
  for (const e of entries) {
    const text = await readFile(join(dir, `${e.tag}.sql`), "utf8");
    out.push({
      tag: e.tag,
      when: e.when,
      statements: splitStatements(text),
      hash: createHash("sha256").update(text).digest("hex"),
    });
  }
  return out;
}

/** Every statement of every migration, for building a schema from nothing. */
export async function tenantDdlStatements(files?: MigrationFile[]): Promise<string[]> {
  return (files ?? (await migrationFiles())).flatMap((f) => f.statements);
}

const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new Error(`Refusing an unsafe schema name: ${name}`);
  return `"${name}"`;
};

/** The record table, inside the tenant's own schema. */
export async function ensureTrackingTable(schema: string): Promise<void> {
  const sql = ownerSql();
  await sql.unsafe(`create table if not exists ${ident(schema)}.${ident(TRACKING_TABLE)} (
    tag text primary key,
    hash text not null,
    applied_at timestamptz not null default now(),
    applied_by text
  )`);
}

export async function appliedMigrations(schema: string): Promise<Map<string, string>> {
  const sql = ownerSql();
  const rows = (await sql.unsafe(
    `select tag, hash from ${ident(schema)}.${ident(TRACKING_TABLE)}`,
  )) as unknown as { tag: string; hash: string }[];
  return new Map(rows.map((r) => [r.tag, r.hash]));
}

/** Records a migration as present without running it. */
export async function recordMigration(schema: string, file: MigrationFile, by: string): Promise<void> {
  const sql = ownerSql();
  await sql.unsafe(
    `insert into ${ident(schema)}.${ident(TRACKING_TABLE)} (tag, hash, applied_by)
     values ($1, $2, $3) on conflict (tag) do nothing`,
    [file.tag, file.hash, by],
  );
}

/**
 * Which migrations a schema already has, when it has no record of its own yet.
 *
 * `public` is answered exactly: Drizzle's own `__drizzle_migrations` kept one row per applied
 * migration, stamped with the journal's `when`. Any other schema was built by provisioning from
 * every file that existed at the time, so everything on disk now is taken as present — which is
 * true for every schema this code has ever made, and is why the runner has to be deployed before
 * the next migration is written. The run says out loud what it baselined.
 */
async function baselineTags(schema: string, files: MigrationFile[]): Promise<Set<string>> {
  const sql = ownerSql();
  if (schema === "public") {
    const has = (await sql`
      select 1 from information_schema.tables
      where table_schema = 'drizzle' and table_name = '__drizzle_migrations' limit 1`) as unknown as unknown[];
    if (has.length) {
      const rows = (await sql`
        select created_at::text as created_at from drizzle.__drizzle_migrations`) as unknown as {
        created_at: string;
      }[];
      const stamps = new Set(rows.map((r) => String(r.created_at)));
      return new Set(files.filter((f) => stamps.has(String(f.when))).map((f) => f.tag));
    }
  }
  return new Set(files.map((f) => f.tag));
}

/** Whether the schema holds anything at all besides the record table. */
async function hasTables(schema: string): Promise<boolean> {
  const sql = ownerSql();
  const rows = (await sql`
    select count(*)::text as n from information_schema.tables
    where table_schema = ${schema} and table_name <> ${TRACKING_TABLE}`) as unknown as { n: string }[];
  return Number(rows[0]?.n ?? "0") > 0;
}

/** A stable 64-bit key for this schema's advisory lock. */
async function lockKey(schema: string): Promise<string> {
  const sql = ownerSql();
  const rows = (await sql`select hashtextextended(${`bodh_migrate:${schema}`}, 0)::text as k`) as unknown as {
    k: string;
  }[];
  return rows[0]!.k;
}

/**
 * Brings one tenant's schema up to date.
 *
 * Never throws for a migration failure: the failure is the result's `error`, so one tenant's
 * broken migration does not hide what happened to the rest.
 */
export async function migrateTenant(
  tenant: TenantRef,
  files?: MigrationFile[],
  by = "migrate",
): Promise<TenantMigrationResult> {
  const sql = ownerSql();
  const all = files ?? (await migrationFiles());
  const schema = tenant.dataSchema;
  const result: TenantMigrationResult = { slug: tenant.slug, schema, applied: [], baselined: [], skipped: 0 };

  const key = await lockKey(schema);
  await sql.unsafe(`select pg_advisory_lock(${key})`);
  try {
    const firstRun = !(await trackingTableExists(schema));
    await ensureTrackingTable(schema);

    if (firstRun && (await hasTables(schema))) {
      const baseline = await baselineTags(schema, all);
      for (const f of all) {
        if (baseline.has(f.tag)) {
          await recordMigration(schema, f, `${by}:baseline`);
          result.baselined.push(f.tag);
        }
      }
    }

    const already = await appliedMigrations(schema);
    for (const f of all) {
      const seen = already.get(f.tag);
      if (seen !== undefined) {
        if (seen !== f.hash) {
          result.error = `${f.tag} was applied to ${schema} from a different file (recorded ${seen.slice(0, 12)}, on disk ${f.hash.slice(0, 12)}). A migration that has run must never be edited.`;
          return result;
        }
        result.skipped += 1;
        continue;
      }
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(`set local search_path to ${ident(schema)}`);
          for (const s of f.statements) await tx.unsafe(s);
          await tx.unsafe(
            `insert into ${ident(schema)}.${ident(TRACKING_TABLE)} (tag, hash, applied_by) values ($1, $2, $3)`,
            [f.tag, f.hash, by],
          );
        });
        result.applied.push(f.tag);
      } catch (e) {
        result.error = `${f.tag} failed on ${schema}: ${e instanceof Error ? e.message : String(e)}`;
        return result;
      }
    }

    // Tables a migration added belong to the owner; both of this workspace's roles need to be
    // granted them, or the application loses access to its own new table on the next deploy.
    if (result.applied.length) {
      const { ensureTenantRoles } = await import("./tenancy");
      await ensureTenantRoles(tenant.id).catch(() => undefined);
    }

    // The assertion that makes a shared set of migration files safe to replay per schema.
    const { foreignKeysLeaving } = await import("./tenancy");
    const escaping = await foreignKeysLeaving(schema);
    if (escaping.length) {
      result.error = `${schema} now has ${escaping.length} foreign keys pointing outside it: ${escaping.slice(0, 3).join("; ")}`;
    }
    return result;
  } finally {
    await sql.unsafe(`select pg_advisory_unlock(${key})`);
  }
}

async function trackingTableExists(schema: string): Promise<boolean> {
  const rows = (await ownerSql()`
    select 1 from information_schema.tables
    where table_schema = ${schema} and table_name = ${TRACKING_TABLE} limit 1`) as unknown as unknown[];
  return rows.length > 0;
}

/**
 * Every tenant, suspended ones included: a workspace that is switched off still has to be at the
 * same table definitions when it comes back, and skipping it is how a schema falls permanently
 * behind.
 */
export async function migrateAllTenants(by = "migrate"): Promise<TenantMigrationResult[]> {
  const { listTenants } = await import("./tenancy");
  const files = await migrationFiles();
  const tenants = await listTenants();
  const out: TenantMigrationResult[] = [];
  for (const t of tenants) out.push(await migrateTenant(t, files, by));
  return out;
}

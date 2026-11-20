/**
 * The migration runner, against a real Postgres, with three tenants.
 *
 * What these prove is the thing the single-schema migrator could not do: one migration file
 * reaches every tenant's schema, reaches each exactly once, changes nobody else's schema on the
 * way, and leaves nothing recorded when it fails. Creates and drops its own database and roles.
 */
import { createHash } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const base = process.env.DATABASE_URL ?? "postgres://bodh:bodh@localhost:5433/bodh";
const dbName = `bodh_migrun_${Date.now()}`;
const admin = postgres(base, { max: 1, onnotice: () => {} });
const reachable = await admin`select 1`.then(() => true).catch(() => false);

const file = (tag: string, statements: string[]) => ({
  tag,
  when: 0,
  statements,
  hash: createHash("sha256").update(statements.join(";")).digest("hex"),
});

describe.skipIf(!reachable)("migrations across every tenant", () => {
  let mod: typeof import("./index");
  let tenants: import("./client").TenantRef[] = [];

  const schemaHas = async (schema: string, table: string): Promise<boolean> => {
    const rows = (await mod.ownerSql()`
      select 1 from information_schema.tables
      where table_schema = ${schema} and table_name = ${table} limit 1`) as unknown as unknown[];
    return rows.length > 0;
  };

  const columnHas = async (schema: string, table: string, column: string): Promise<boolean> => {
    const rows = (await mod.ownerSql()`
      select 1 from information_schema.columns
      where table_schema = ${schema} and table_name = ${table} and column_name = ${column} limit 1`) as unknown as unknown[];
    return rows.length > 0;
  };

  beforeAll(async () => {
    await admin.unsafe(`create database ${dbName}`);
    const url = new URL(base);
    url.pathname = `/${dbName}`;
    process.env.DATABASE_URL = url.toString();
    process.env.MIGRATE_DATABASE_URL = url.toString();
    delete process.env.DEFAULT_TENANT_SLUG;

    mod = await import("./index");
    await mod.setupPlatform();

    // Tenant #1 keeps `public`; it has no tables yet, so the runner builds it from the files.
    const one = await mod.migrateTenant(
      { id: "bootstrap", slug: "first", name: "First", dataSchema: "public", dbRole: null, status: "active" },
      undefined,
      "test",
    );
    expect(one.error).toBeUndefined();
    expect(one.applied.length).toBeGreaterThan(0);

    const first = await mod.registerFirstTenant({ slug: "first", name: "First" });
    const second = (await mod.provisionTenant({ slug: "second", name: "Second", adminEmail: "a@second.test", actor: "test" })).tenant;
    const third = (await mod.provisionTenant({ slug: "third", name: "Third", adminEmail: "a@third.test", actor: "test" })).tenant;
    tenants = [first, second, third];
  }, 180_000);

  afterAll(async () => {
    const roles = tenants.map((t) => t.dbRole).filter((r): r is string => Boolean(r));
    await mod?.sql?.end?.({ timeout: 5 }).catch(() => undefined);
    await mod?.ownerSql?.().end({ timeout: 5 }).catch(() => undefined);
    await admin.unsafe(`drop database if exists ${dbName} with (force)`).catch(() => undefined);
    for (const role of roles) {
      await admin.unsafe(`drop role if exists "${role.replace(/"/g, '""')}"`).catch(() => undefined);
    }
    await admin.end();
  }, 60_000);

  it("gives every tenant, however it was made, its own record of what it has had", async () => {
    for (const t of tenants) {
      const applied = await mod.appliedMigrations(t.dataSchema);
      expect(applied.size).toBeGreaterThan(0);
      // Provisioning records the same tags the runner would, so a later migration knows where
      // a freshly made tenant starts from.
      const files = await mod.migrationFiles();
      for (const f of files) expect(applied.get(f.tag)).toBe(f.hash);
    }
  });

  it("applies a new migration to the tenant it was asked for, and to nobody else", async () => {
    const files = await mod.migrationFiles();
    const probe = file("9999_probe", [
      'create table "probe" ("id" integer primary key, "note" text)',
      'alter table "calendar_items" add column "probe_note" text',
    ]);

    const [one, two, three] = tenants;
    const r = await mod.migrateTenant(one!, [...files, probe], "test");
    expect(r.error).toBeUndefined();
    expect(r.applied).toEqual(["9999_probe"]);

    expect(await schemaHas(one!.dataSchema, "probe")).toBe(true);
    expect(await columnHas(one!.dataSchema, "calendar_items", "probe_note")).toBe(true);
    // The other two are untouched: a migration run for one tenant changes one schema.
    expect(await schemaHas(two!.dataSchema, "probe")).toBe(false);
    expect(await schemaHas(three!.dataSchema, "probe")).toBe(false);
    expect(await columnHas(two!.dataSchema, "calendar_items", "probe_note")).toBe(false);
  });

  it("reaches every remaining tenant when the whole set is run", async () => {
    const files = await mod.migrationFiles();
    const probe = file("9999_probe", [
      'create table "probe" ("id" integer primary key, "note" text)',
      'alter table "calendar_items" add column "probe_note" text',
    ]);
    const [, two, three] = tenants;
    for (const t of [two!, three!]) {
      const r = await mod.migrateTenant(t, [...files, probe], "test");
      expect(r.error).toBeUndefined();
      expect(r.applied).toEqual(["9999_probe"]);
    }
    for (const t of tenants) {
      expect(await schemaHas(t.dataSchema, "probe")).toBe(true);
      expect(await columnHas(t.dataSchema, "calendar_items", "probe_note")).toBe(true);
      expect(await mod.foreignKeysLeaving(t.dataSchema)).toEqual([]);
    }
  });

  it("runs each migration once, however many times it is run", async () => {
    const files = await mod.migrationFiles();
    const probe = file("9999_probe", [
      'create table "probe" ("id" integer primary key, "note" text)',
      'alter table "calendar_items" add column "probe_note" text',
    ]);
    // The statements would fail a second time: that they do not run is the assertion.
    for (const t of tenants) {
      const again = await mod.migrateTenant(t, [...files, probe], "test");
      expect(again.error).toBeUndefined();
      expect(again.applied).toEqual([]);
      expect(again.skipped).toBe(files.length + 1);
    }
  });

  it("refuses a migration whose file changed after it was applied", async () => {
    const files = await mod.migrationFiles();
    const edited = file("9999_probe", ['create table "probe_two" ("id" integer primary key)']);
    const r = await mod.migrateTenant(tenants[0]!, [...files, edited], "test");
    expect(r.error).toMatch(/different file/i);
    // Nothing of the edited file ran.
    expect(await schemaHas(tenants[0]!.dataSchema, "probe_two")).toBe(false);
  });

  it("records nothing when a migration fails, so the next run tries it again", async () => {
    const files = await mod.migrationFiles();
    const broken = file("9998_broken", [
      'create table "half_made" ("id" integer primary key)',
      "this is not sql",
    ]);
    const t = tenants[1]!;
    const bad = await mod.migrateTenant(t, [...files, broken], "test");
    expect(bad.error).toMatch(/9998_broken failed/);
    // The whole migration rolled back: neither the table nor the record survives.
    expect(await schemaHas(t.dataSchema, "half_made")).toBe(false);
    expect((await mod.appliedMigrations(t.dataSchema)).has("9998_broken")).toBe(false);

    const fixed = file("9998_broken", ['create table "half_made" ("id" integer primary key)']);
    const good = await mod.migrateTenant(t, [...files, fixed], "test");
    expect(good.error).toBeUndefined();
    expect(good.applied).toEqual(["9998_broken"]);
    expect(await schemaHas(t.dataSchema, "half_made")).toBe(true);
  });

  it("one tenant's failure does not stop the others, and the run says which failed", async () => {
    const files = await mod.migrationFiles();
    const sql = mod.ownerSql();
    const [one, two, three] = tenants;
    // Make the migration impossible for tenant #3 alone: the object it creates is already there.
    await sql.unsafe(`create table "${three!.dataSchema}"."dup_probe" ("id" integer primary key)`);
    const dup = file("9997_dup", ['create table "dup_probe" ("id" integer primary key)']);

    const results = [];
    for (const t of [one!, two!, three!]) results.push(await mod.migrateTenant(t, [...files, dup], "test"));

    expect(results[0]!.error).toBeUndefined();
    expect(results[0]!.applied).toEqual(["9997_dup"]);
    expect(results[1]!.error).toBeUndefined();
    expect(results[1]!.applied).toEqual(["9997_dup"]);
    // The third failed, said so, and recorded nothing — so a later run can try it again.
    expect(results[2]!.error).toMatch(/9997_dup failed on/);
    expect(results[2]!.applied).toEqual([]);
    expect((await mod.appliedMigrations(three!.dataSchema)).has("9997_dup")).toBe(false);
    // The two that worked are not rolled back by the one that did not.
    expect(await schemaHas(one!.dataSchema, "dup_probe")).toBe(true);
    expect(await schemaHas(two!.dataSchema, "dup_probe")).toBe(true);
  });

  it("adopts a schema that has tables but no record, without re-running anything", async () => {
    const t = tenants[2]!;
    const sql = mod.ownerSql();
    await sql.unsafe(`drop table "${t.dataSchema}"."${mod.TRACKING_TABLE}"`);
    const files = await mod.migrationFiles();
    const r = await mod.migrateTenant(t, files, "test");
    expect(r.error).toBeUndefined();
    expect(r.applied).toEqual([]);
    expect(r.baselined.length).toBe(files.length);
    // The data is still there: adopting records, it does not rebuild.
    const rows = (await sql.unsafe(`select count(*)::text as n from "${t.dataSchema}".users`)) as unknown as { n: string }[];
    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
  });

  it("migrateAllTenants covers every registered tenant, suspended ones included", async () => {
    const sql = mod.ownerSql();
    await sql`update platform.tenants set status = 'suspended' where slug = 'third'`;
    mod.forgetTenants();
    try {
      const results = await mod.migrateAllTenants("test");
      expect(results.map((r) => r.slug).sort()).toEqual(["first", "second", "third"]);
      for (const r of results) expect(r.error).toBeUndefined();
    } finally {
      await sql`update platform.tenants set status = 'active' where slug = 'third'`;
      mod.forgetTenants();
    }
  });
});

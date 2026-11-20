/**
 * Archiving and purging a workspace, against a real Postgres.
 *
 * Purging drops a schema and two roles; there is no undoing it. So what matters here is not
 * that it works — it is that each guard refuses on its own, before anything is dropped. Every
 * refusal below is a different mistake somebody could make on a bad afternoon.
 *
 * Creates and drops its own database; skipped when Postgres isn't reachable.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const base = process.env.DATABASE_URL ?? "postgres://bodh:bodh@localhost:5433/bodh";
const dbName = `bodh_archive_${Date.now()}`;
const admin = postgres(base, { max: 1, onnotice: () => {} });
const reachable = await admin`select 1`.then(() => true).catch(() => false);

describe.skipIf(!reachable)("archive and purge", () => {
  let mod: typeof import("./index");
  let one: import("./client").TenantRef;
  let two: import("./client").TenantRef;

  const schemaExists = async (name: string) => {
    const rows = (await mod.ownerSql()<{ n: string }[]>`
      select count(*)::text as n from information_schema.schemata where schema_name = ${name}`) as unknown as {
      n: string;
    }[];
    return rows[0]!.n !== "0";
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
    await mod.migrateTenant(
      { id: "bootstrap", slug: "first", name: "First", dataSchema: "public", dbRole: null, status: "active" },
      undefined,
      "test",
    );
    one = await mod.registerFirstTenant({ slug: "first", name: "First" });
    two = (await mod.provisionTenant({ slug: "second", name: "Second", adminEmail: "a@second.test", actor: "test" })).tenant;
  }, 180_000);

  afterAll(async () => {
    const roles = [one?.dbRole, two?.dbRole].filter((r): r is string => Boolean(r));
    await mod?.sql?.end?.({ timeout: 5 }).catch(() => undefined);
    await mod?.ownerSql?.().end({ timeout: 5 }).catch(() => undefined);
    await admin.unsafe(`drop database if exists ${dbName} with (force)`).catch(() => undefined);
    for (const role of roles) {
      await admin.unsafe(`drop role if exists "${role.replace(/"/g, '""')}"`).catch(() => undefined);
      await admin.unsafe(`drop role if exists "${role.replace(/"/g, '""')}_ro"`).catch(() => undefined);
    }
    await admin.end();
  }, 60_000);

  it("refuses to purge a workspace that is still live", async () => {
    await expect(mod.purgeTenant(two.id, "second", "owner@test")).rejects.toThrow(/Archive the workspace first/);
    expect(await schemaExists("t_second")).toBe(true);
  });

  it("archiving takes it out of service and removes nothing", async () => {
    const archived = await mod.archiveTenant(two.id, "owner@test", "customer left");
    expect(archived?.status).toBe("archived");

    // Still every table and row where it was.
    expect(await schemaExists("t_second")).toBe(true);
    const info = await mod.archiveInfo(two.id);
    expect(info?.archivedBy).toBe("owner@test");
    expect(info?.reason).toBe("customer left");
    expect(info?.purgeAfter).toBeInstanceOf(Date);
    // And kept for the retention window, not purgeable today.
    expect(info!.purgeAfter!.getTime()).toBeGreaterThan(Date.now());
  });

  it("refuses to purge before the retention window has passed", async () => {
    await expect(mod.purgeTenant(two.id, "second", "owner@test")).rejects.toThrow(/kept until/);
    expect(await schemaExists("t_second")).toBe(true);
  });

  it("can be brought back, because nothing was removed", async () => {
    const back = await mod.restoreTenant(two.id);
    expect(back?.status).toBe("active");
    expect(await mod.archiveInfo(two.id)).toMatchObject({ archivedAt: null, purgeAfter: null });

    // Its data is still readable through its own role.
    const people = await mod.withTenant(back!, () => mod.db.select().from(mod.users));
    expect(people.length).toBeGreaterThan(0);
  });

  it("refuses to purge without the workspace's own name typed exactly", async () => {
    await mod.archiveTenant(two.id, "owner@test", null);
    // Pretend the retention window has passed.
    await mod.ownerSql()`update platform.tenants set purge_after = now() - interval '1 day' where id = ${two.id}`;

    await expect(mod.purgeTenant(two.id, "", "owner@test")).rejects.toThrow(/Type second exactly/);
    await expect(mod.purgeTenant(two.id, "Second", "owner@test")).rejects.toThrow(/Type second exactly/);
    await expect(mod.purgeTenant(two.id, "first", "owner@test")).rejects.toThrow(/Type second exactly/);
    expect(await schemaExists("t_second")).toBe(true);
  });

  it("never purges the first workspace, whose schema is the installation", async () => {
    await mod.ownerSql()`
      update platform.tenants set status = 'archived', purge_after = now() - interval '1 day' where id = ${one.id}`;
    await expect(mod.purgeTenant(one.id, "first", "owner@test")).rejects.toThrow(/cannot be purged/);
    expect(await schemaExists("public")).toBe(true);
  });

  it("purges once every guard is satisfied, and leaves nothing behind", async () => {
    const role = two.dbRole!;
    const result = await mod.purgeTenant(two.id, "second", "owner@test");
    expect(result.schema).toBe("t_second");

    expect(await schemaExists("t_second")).toBe(false);
    const tenants = (await mod.ownerSql()<{ n: string }[]>`
      select count(*)::text as n from platform.tenants where id = ${two.id}`) as unknown as { n: string }[];
    expect(tenants[0]!.n).toBe("0");

    // The roles go too: a role left in the cluster is how one database reaches into another.
    for (const r of [role, `${role}_ro`]) {
      const rows = (await mod.ownerSql()<{ n: string }[]>`
        select count(*)::text as n from pg_roles where rolname = ${r}`) as unknown as { n: string }[];
      expect(rows[0]!.n, r).toBe("0");
    }
  });
});

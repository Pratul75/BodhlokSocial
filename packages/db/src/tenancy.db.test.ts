/**
 * Two-tenant isolation, against a real Postgres. Creates and drops its own database, so it
 * never touches the development data; skipped when Postgres isn't reachable.
 *
 * These are the assertions the whole multi-tenant design rests on. If one of them fails,
 * tenant data is reachable from the wrong tenant.
 */
import postgres from "postgres";
import { eq, sql as dsql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const base = process.env.DATABASE_URL ?? "postgres://bodh:bodh@localhost:5433/bodh";
const dbName = `bodh_tenancy_${Date.now()}`;
const admin = postgres(base, { max: 1, onnotice: () => {} });
const reachable = await admin`select 1`.then(() => true).catch(() => false);

describe.skipIf(!reachable)("two-tenant isolation", () => {
  let mod: typeof import("./index");
  let one: import("./client").TenantRef;
  let two: import("./client").TenantRef;

  beforeAll(async () => {
    await admin.unsafe(`create database ${dbName}`);
    const url = new URL(base);
    url.pathname = `/${dbName}`;
    process.env.DATABASE_URL = url.toString();
    process.env.MIGRATE_DATABASE_URL = url.toString();
    delete process.env.DEFAULT_TENANT_SLUG;

    // Build the schema the way a deploy does: the control plane, then the migration runner over
    // tenant #1's own schema — the same path migrate.ts takes.
    mod = await import("./index");
    await mod.setupPlatform();
    const bootstrap = await mod.migrateTenant(
      { id: "bootstrap", slug: "first", name: "First", dataSchema: "public", dbRole: null, status: "active" },
      undefined,
      "test",
    );
    expect(bootstrap.error).toBeUndefined();

    // Tenant #1 keeps the existing `public` schema; tenant #2 gets its own.
    one = await mod.registerFirstTenant({ slug: "first", name: "First" });
    const provisioned = await mod.provisionTenant({
      slug: "second",
      name: "Second",
      adminEmail: "admin@second.test",
      actor: "test",
    });
    two = provisioned.tenant;

    // Distinguishable data in each.
    await mod.withTenant(one, async () => {
      await mod.db.insert(mod.users).values({ email: "a@first.test", name: "A", role: "admin" });
      await mod.db.insert(mod.users).values({ email: "b@first.test", name: "B", role: "sales" });
    });
  }, 120_000);

  afterAll(async () => {
    const roles = [one?.dbRole, two?.dbRole].filter((r): r is string => Boolean(r));
    await mod?.sql?.end?.({ timeout: 5 }).catch(() => undefined);
    await mod?.ownerSql?.().end({ timeout: 5 }).catch(() => undefined);
    await admin.unsafe(`drop database if exists ${dbName} with (force)`).catch(() => undefined);
    // Roles live in the cluster, not the database: dropping the database leaves them behind,
    // and a leftover role is how one database's provisioning reaches into another's.
    for (const role of roles) {
      await admin.unsafe(`drop role if exists "${role.replace(/"/g, '""')}"`).catch(() => undefined);
    }
    await admin.end();
  }, 60_000);

  it("provisioning leaves no foreign key pointing outside the tenant", async () => {
    expect(await mod.foreignKeysLeaving(two.dataSchema)).toEqual([]);
  });

  it("builds a schema structurally identical to tenant #1", async () => {
    const count = async (s: string) =>
      (await mod.ownerSql()<{ n: string }[]>`
        select count(*)::text as n from information_schema.tables
        where table_schema = ${s} and table_type = 'BASE TABLE'`)[0]!.n;
    expect(await count(two.dataSchema)).toBe(await count(one.dataSchema));
  });

  it("returns only that tenant's rows, through unmodified query call sites", async () => {
    const first = await mod.withTenant(one, () => mod.db.select().from(mod.users));
    const second = await mod.withTenant(two, () => mod.db.select().from(mod.users));
    expect(first.map((u) => u.email).sort()).toEqual(["a@first.test", "b@first.test"]);
    expect(second.map((u) => u.email)).toEqual(["admin@second.test"]);
  });

  it("writes land only in the tenant that wrote them", async () => {
    await mod.withTenant(two, () => mod.db.insert(mod.users).values({ email: "c@second.test", name: "C", role: "sales" }));
    const first = await mod.withTenant(one, () => mod.db.select().from(mod.users));
    const second = await mod.withTenant(two, () => mod.db.select().from(mod.users));
    expect(first.map((u) => u.email).sort()).toEqual(["a@first.test", "b@first.test"]);
    expect(second.map((u) => u.email).sort()).toEqual(["admin@second.test", "c@second.test"]);
  });

  it("throws rather than guessing when there is no tenant context", () => {
    // Fails fast, on the first property access, before any query is built.
    expect(() => mod.db.select().from(mod.users)).toThrow(/No tenant context/);
    expect(() => mod.sql`select 1`).toThrow(/No tenant context/);
  });

  it("keeps rows apart under 50 interleaved scopes", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => {
        const t = i % 2 ? two : one;
        return mod.withTenant(t, async () => {
          await mod.db.execute(dsql`select pg_sleep(0.002)`);
          return { slug: t.slug, n: (await mod.db.select().from(mod.users)).length };
        });
      }),
    );
    const wrong = results.filter((r) => (r.slug === "first" ? r.n !== 2 : r.n !== 2));
    expect(wrong).toEqual([]);
  }, 60_000);

  it("runs transactions inside a scope, and they stay in the tenant", async () => {
    const n = await mod.withTenant(two, () =>
      mod.db.transaction(async (tx) => {
        await tx.insert(mod.geoQuestions).values({ question: `q-${Date.now()}` });
        return (await tx.select().from(mod.geoQuestions)).length;
      }),
    );
    expect(n).toBeGreaterThan(0);
    const inFirst = await mod.withTenant(one, () => mod.db.select().from(mod.geoQuestions));
    expect(inFirst).toHaveLength(0);
  });

  it("denies a SCHEMA-QUALIFIED cross-tenant read, because the role is the boundary", async () => {
    // search_path only scopes unqualified names: the role grant is what makes this isolation.
    const url = new URL(process.env.DATABASE_URL!);
    const secret = (await mod.ownerSql()<{ db_role_secret: string }[]>`
      select db_role_secret from platform.tenants where id = ${two.id}`)[0]!.db_role_secret;
    url.username = encodeURIComponent(two.dbRole!);
    url.password = encodeURIComponent(secret);
    const asTenantTwo = postgres(url.toString(), { max: 1, onnotice: () => {}, connection: { search_path: two.dataSchema } });
    try {
      await expect(asTenantTwo`select count(*) from public.users`).rejects.toThrow(/permission denied|does not exist/i);
      // its own schema still works
      const own = await asTenantTwo`select count(*)::int as n from users`;
      expect(Number(own[0]!.n)).toBeGreaterThan(0);
    } finally {
      await asTenantTwo.end({ timeout: 5 });
    }
  });

  it("denies the reverse too: tenant #1 cannot read tenant #2", async () => {
    // The boundary has to hold in both directions. Tenant #1 lives in `public` and, without a
    // role of its own, would connect as the database owner — the one tenant able to read
    // everyone else. registerFirstTenant gives it a role for exactly this reason.
    expect(one.dbRole).toBeTruthy();
    const url = new URL(process.env.DATABASE_URL!);
    const secret = (await mod.ownerSql()<{ db_role_secret: string }[]>`
      select db_role_secret from platform.tenants where id = ${one.id}`)[0]!.db_role_secret;
    url.username = encodeURIComponent(one.dbRole!);
    url.password = encodeURIComponent(secret);
    const asTenantOne = postgres(url.toString(), { max: 1, onnotice: () => {}, connection: { search_path: one.dataSchema } });
    try {
      await expect(asTenantOne.unsafe(`select count(*) from ${two.dataSchema}.users`)).rejects.toThrow(
        /permission denied|does not exist/i,
      );
      await expect(asTenantOne.unsafe(`update ${two.dataSchema}.users set name = name`)).rejects.toThrow(
        /permission denied|does not exist/i,
      );
      const own = await asTenantOne`select count(*)::int as n from users`;
      expect(Number(own[0]!.n)).toBeGreaterThan(0);
    } finally {
      await asTenantOne.end({ timeout: 5 });
    }
  });

  it("a connection with no search path finds nothing, instead of reading tenant #1", async () => {
    const url = new URL(process.env.DATABASE_URL!);
    const secret = (await mod.ownerSql()<{ db_role_secret: string }[]>`
      select db_role_secret from platform.tenants where id = ${two.id}`)[0]!.db_role_secret;
    url.username = encodeURIComponent(two.dbRole!);
    url.password = encodeURIComponent(secret);
    const naked = postgres(url.toString(), { max: 1, onnotice: () => {} });
    try {
      await expect(naked`select count(*) from users`).rejects.toThrow(/does not exist/i);
    } finally {
      await naked.end({ timeout: 5 });
    }
  });

  it("connects as the tenant's own role, not the database owner", async () => {
    // urlForTenant() quietly falls back to the owner URL when a role secret is missing, so a
    // page that works proves nothing about who served it. Ask the connection itself.
    const asOne = await mod.withTenant(one, () => mod.sql`select current_user as who`);
    const asTwo = await mod.withTenant(two, () => mod.sql`select current_user as who`);
    expect(asOne[0]!.who).toBe(one.dbRole);
    expect(asTwo[0]!.who).toBe(two.dbRole);
    expect(asOne[0]!.who).not.toBe(asTwo[0]!.who);
  });

  it("writes as the restricted role, not only reads", async () => {
    // Tenant #1 used to connect as the owner. Now that it does not, every write it makes has to
    // still work with nothing but the grants provisioning gave it.
    await mod.withTenant(one, async () => {
      const [row] = await mod.db.insert(mod.users).values({ email: "w@first.test", name: "W", role: "sales" }).returning();
      expect(row).toBeTruthy();
      await mod.db.update(mod.users).set({ name: "W2" }).where(eq(mod.users.id, row!.id));
      await mod.db.delete(mod.users).where(eq(mod.users.id, row!.id));
    });
  });

  it("a capability switched off for one workspace is off only there", async () => {
    // The one gate every page, action, agent and job shares.
    const off = await mod.ownerSql();
    await off`
      insert into platform.entitlements (tenant_id, kind, key, enabled, updated_by)
      values (${two.id}, 'feature', 'ads.write', false, 'test')
      on conflict (tenant_id, kind, key) do update set enabled = false`;
    mod.forgetEntitlements();
    expect(await mod.withTenant(two, () => mod.tenantHasFeature("ads.write"))).toBe(false);
    expect(await mod.withTenant(one, () => mod.tenantHasFeature("ads.write"))).toBe(true);

    await off`update platform.entitlements set enabled = true where tenant_id = ${two.id} and key = 'ads.write'`;
    mod.forgetEntitlements();
    expect(await mod.withTenant(two, () => mod.tenantHasFeature("ads.write"))).toBe(true);
  });

  it("a workspace with no entitlement rows at all is entitled to nothing", async () => {
    const off = await mod.ownerSql();
    const saved = await off`select kind, key, enabled, value from platform.entitlements where tenant_id = ${two.id}`;
    await off`delete from platform.entitlements where tenant_id = ${two.id}`;
    mod.forgetEntitlements();
    try {
      const ent = await mod.entitlementsFor(two.id);
      expect(mod.moduleAllowed(ent, "ads")).toBe(false);
      expect(await mod.withTenant(two, () => mod.tenantHasFeature("ads.write"))).toBe(false);
    } finally {
      for (const r of saved) {
        await off`
          insert into platform.entitlements (tenant_id, kind, key, enabled, value, updated_by)
          values (${two.id}, ${r.kind}, ${r.key}, ${r.enabled}, ${r.value}, 'test')
          on conflict (tenant_id, kind, key) do update set enabled = excluded.enabled`;
      }
      mod.forgetEntitlements();
    }
  });

  it("stops falling back to tenant #1 once a second workspace exists", async () => {
    // The fallback is the one fail-open left in the design. With two workspaces registered it
    // must not answer, whatever DEFAULT_TENANT_SLUG says, because there is no right guess.
    process.env.DEFAULT_TENANT_SLUG = one.slug;
    try {
      mod.forgetTenants();
      await mod.listTenants(); // the registry is what tells the fallback how many there are
      expect(mod.tenantFallbackActive()).toBe(false);
      expect(() => mod.currentTenant()).toThrow(/more than one workspace/i);
      expect(() => mod.db.select()).toThrow(/No tenant context/i);
    } finally {
      delete process.env.DEFAULT_TENANT_SLUG;
      mod.forgetTenants();
    }
  });

  it("does not fall back before the registry has been read at all", async () => {
    // Fail-closed by default: being a single-tenant installation has to be established.
    process.env.DEFAULT_TENANT_SLUG = one.slug;
    mod.forgetTenantCount();
    try {
      expect(mod.tenantFallbackActive()).toBe(false);
      expect(() => mod.currentTenant()).toThrow(/No tenant context/i);
    } finally {
      delete process.env.DEFAULT_TENANT_SLUG;
      mod.forgetTenants();
    }
  });

  it("never re-enables the fallback once two workspaces have been seen", async () => {
    process.env.DEFAULT_TENANT_SLUG = one.slug;
    try {
      mod.forgetTenants();
      await mod.listTenants();
      // Even told there is one again, the latch holds.
      mod.rememberTenantCount(1);
      expect(mod.tenantFallbackActive()).toBe(false);
      expect(() => mod.currentTenant()).toThrow(/No tenant context/i);
    } finally {
      delete process.env.DEFAULT_TENANT_SLUG;
      mod.forgetTenants();
    }
  });

  it("opens a workspace read-only, so an operator can look but not change", async () => {
    // What an operator may do while looking inside a customer's workspace is not a flag the
    // application remembers to check: the workspace is bound through a role that was never
    // granted INSERT, UPDATE or DELETE, so Postgres refuses the write. 42501 is that refusal.
    const readOnly = { ...two, readOnly: true };
    const refusal = async (fn: () => Promise<unknown>): Promise<string> => {
      try {
        await fn();
        return "not refused";
      } catch (e) {
        return (e as { cause?: { code?: string } }).cause?.code ?? (e as Error).message;
      }
    };

    const seen = await mod.withTenant(readOnly, () => mod.db.select().from(mod.users));
    expect(seen.length).toBeGreaterThan(0);

    expect(await refusal(() => mod.withTenant(readOnly, () => mod.db.update(mod.users).set({ name: "Changed" })))).toBe("42501");
    expect(
      await refusal(() =>
        mod.withTenant(readOnly, () =>
          mod.db.insert(mod.users).values({ email: "sneak@second.test", name: "Sneak", role: "admin" }),
        ),
      ),
    ).toBe("42501");
    expect(await refusal(() => mod.withTenant(readOnly, () => mod.db.delete(mod.users)))).toBe("42501");

    // The workspace's own people are unaffected: the read-write binding still writes.
    const before = (await mod.withTenant(two, () => mod.db.select().from(mod.users))).length;
    await mod.withTenant(two, () =>
      mod.db.insert(mod.users).values({ email: "ok@second.test", name: "Ok", role: "sales" }),
    );
    const after = await mod.withTenant(two, () => mod.db.select().from(mod.users));
    expect(after.length).toBe(before + 1);
    await mod.withTenant(two, () => mod.db.delete(mod.users).where(eq(mod.users.email, "ok@second.test")));
  });

  it("refuses to open a workspace read-only when it has no role of its own", () => {
    // Falling back to the owner connection here would be the opposite of read-only.
    const roleless = { ...two, dbRole: null, readOnly: true };
    expect(() => mod.withTenant(roleless, () => mod.db.select().from(mod.users))).toThrow(/read-only/i);
  });

  it("isolates a failing tenant inside forEachTenant", async () => {
    const results = await mod.forEachTenant(async (t) => {
      if (t.slug === "first") throw new Error("boom");
      return (await mod.db.select().from(mod.users)).length;
    });
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.tenant.slug === "first")?.error).toBe("boom");
    expect(results.find((r) => r.tenant.slug === "second")?.value).toBeGreaterThan(0);
  });

  it("refuses a reserved or malformed tenant slug", () => {
    expect(() => mod.schemaForSlug("platform")).toThrow(/Reserved/);
    expect(() => mod.schemaForSlug("public")).toThrow(/Reserved/);
    expect(() => mod.schemaForSlug("Bad Slug")).toThrow(/Invalid/);
    expect(() => mod.schemaForSlug("a")).toThrow(/Invalid/);
    expect(mod.schemaForSlug("acme-two")).toBe("t_acme_two");
  });
});

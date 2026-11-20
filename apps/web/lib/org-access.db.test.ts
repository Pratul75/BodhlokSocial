/**
 * How far an agency reaches into a client, against a real Postgres.
 *
 * The claim being tested is the one the whole permission model rests on: the level is not a
 * flag the application promises to check, it is accounts existing or not existing inside the
 * client's own schema. So the test looks at the client's `users` table, not at the level row.
 *
 * Creates and drops its own database, so it never touches development data; skipped when
 * Postgres isn't reachable.
 */
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const base = process.env.DATABASE_URL ?? "postgres://bodh:bodh@localhost:5433/bodh";
const dbName = `bodh_access_${Date.now()}`;
const admin = postgres(base, { max: 1, onnotice: () => {} });
const reachable = await admin`select 1`.then(() => true).catch(() => false);

describe.skipIf(!reachable)("how far an agency reaches", () => {
  let mod: typeof import("@bodh/db");
  let access: typeof import("./org-access");
  let ws: typeof import("./workspaces");
  let agency: import("@bodh/db").OrgRef;
  let client: import("@bodh/db").TenantRef;
  let own: import("@bodh/db").TenantRef;
  const roles: string[] = [];

  const BOSS = "boss@agency.test";

  /** Whether the agency's person has a live account inside the client. */
  const accountInside = async (tenant: import("@bodh/db").TenantRef) =>
    mod.withTenant(tenant, async () => {
      const [row] = await mod.db.select().from(mod.users).where(eq(mod.users.email, BOSS)).limit(1);
      return row ? row.active : null;
    });

  beforeAll(async () => {
    await admin.unsafe(`create database ${dbName}`);
    const url = new URL(base);
    url.pathname = `/${dbName}`;
    process.env.DATABASE_URL = url.toString();
    process.env.MIGRATE_DATABASE_URL = url.toString();
    delete process.env.DEFAULT_TENANT_SLUG;

    mod = await import("@bodh/db");
    await mod.setupPlatform();
    const bootstrap = await mod.migrateTenant(
      { id: "bootstrap", slug: "first", name: "First", dataSchema: "public", dbRole: null, status: "active" },
      undefined,
      "test",
    );
    expect(bootstrap.error).toBeUndefined();
    const first = await mod.registerFirstTenant({ slug: "first", name: "First" });
    if (first.dbRole) roles.push(first.dbRole);

    agency = await mod.createOrg({ name: "Recharge Studio" });
    await mod.addOrgAdmin(agency.id, BOSS, "super-admin@test");

    // The agency's own workspace and one client, both made after the appointment, so both get
    // the agency's people inside them the way the console builds them.
    for (const [slug, name] of [
      ["recharge-studio", "Recharge Studio"],
      ["client-abc", "Client ABC"],
    ] as const) {
      const { tenant } = await mod.provisionTenant({
        slug,
        name,
        adminEmail: `admin@${slug}.test`,
        orgId: agency.id,
        actor: "test",
      });
      if (tenant.dbRole) roles.push(tenant.dbRole);
      if (slug === "client-abc") client = tenant;
      else own = tenant;
      // Provisioning from the console adds the agency's people; here, do what it does.
      await mod.withTenant(tenant, () =>
        mod.db.insert(mod.users).values({ email: BOSS, name: "Boss", role: "admin" }).onConflictDoNothing(),
      );
      await mod.noteUserInDirectory(tenant.id, BOSS, true);
    }

    access = await import("./org-access");
    ws = await import("./workspaces");
  }, 240_000);

  afterAll(async () => {
    await mod?.sql?.end?.({ timeout: 5 }).catch(() => undefined);
    await mod?.ownerSql?.().end({ timeout: 5 }).catch(() => undefined);
    await admin.unsafe(`drop database if exists ${dbName} with (force)`).catch(() => undefined);
    for (const role of roles) {
      await admin.unsafe(`drop role if exists "${role.replace(/"/g, '""')}"`).catch(() => undefined);
      await admin.unsafe(`drop role if exists "${`${role}_ro`.replace(/"/g, '""')}"`).catch(() => undefined);
    }
    await admin.end();
  }, 60_000);

  it("starts at full, with a real account inside the client", async () => {
    expect(await mod.accessLevel(agency.id, client.id)).toBe("full");
    expect(await accountInside(client)).toBe(true);
    expect((await ws.openableWorkspaces(BOSS, own)).map((t) => t.slug).sort()).toEqual(["client-abc", "recharge-studio"]);
  });

  it("manage takes the account away, so the switcher stops offering the client", async () => {
    const change = await access.applyAccessLevel(agency, client, "manage", "super-admin@test");
    expect(change.changed).toBe(1);
    expect(await mod.accessLevel(agency.id, client.id)).toBe("manage");
    // The account is what enforces it, not the level row.
    expect(await accountInside(client)).toBe(false);
    expect((await ws.openableWorkspaces(BOSS, own)).map((t) => t.slug)).toEqual(["recharge-studio"]);
  });

  it("none behaves the same inside; the difference is only in the agency's panel", async () => {
    await access.applyAccessLevel(agency, client, "none", "super-admin@test");
    expect(await mod.accessLevel(agency.id, client.id)).toBe("none");
    expect(await accountInside(client)).toBe(false);
    // The client itself is untouched: its own admin is still there and still active.
    const theirAdmin = await mod.withTenant(client, async () => {
      const [row] = await mod.db.select().from(mod.users).where(eq(mod.users.email, "admin@client-abc.test")).limit(1);
      return row ?? null;
    });
    expect(theirAdmin?.active).toBe(true);
  });

  it("full gives the account back", async () => {
    const change = await access.applyAccessLevel(agency, client, "full", "super-admin@test");
    expect(change.changed).toBe(1);
    expect(await accountInside(client)).toBe(true);
    expect((await ws.openableWorkspaces(BOSS, own)).map((t) => t.slug).sort()).toEqual(["client-abc", "recharge-studio"]);
  });

  it("counts workspaces against the agency's ceiling, its own included", async () => {
    expect(await mod.roomForAnotherWorkspace(agency.id)).toEqual({ ok: true });

    await mod.setOrgLimits(agency.id, { maxWorkspaces: 2, monthlyBudgetUsd: null });
    const full = await mod.roomForAnotherWorkspace(agency.id);
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.reason).toMatch(/allowed 2 workspaces and already has 2/);

    await mod.setOrgLimits(agency.id, { maxWorkspaces: 3, monthlyBudgetUsd: null });
    expect(await mod.roomForAnotherWorkspace(agency.id)).toEqual({ ok: true });

    // No ceiling is the state every agency starts in, and it must keep meaning "no ceiling".
    await mod.setOrgLimits(agency.id, { maxWorkspaces: null, monthlyBudgetUsd: null });
    expect(await mod.roomForAnotherWorkspace(agency.id)).toEqual({ ok: true });
  });
  it("somebody added to the agency gets an account in the clients it fully reaches, and only those", async () => {
    // The other half of the model: `applyAccessLevel` is one client and every person,
    // `grantAgencyAdminAccounts` is one person and every client. Without it a new agency admin
    // holds a panel full of workspaces they cannot open.
    const NEWBIE = "second@agency.test";
    const accountFor = async (tenant: import("@bodh/db").TenantRef) =>
      mod.withTenant(tenant, async () => {
        const [row] = await mod.db.select().from(mod.users).where(eq(mod.users.email, NEWBIE)).limit(1);
        return row ? row.active : null;
      });

    // The client is deliberately held at manage: adding a colleague must not widen the agency's
    // reach, only match it.
    await access.applyAccessLevel(agency, client, "manage", "super-admin@test");
    await mod.addOrgAdmin(agency.id, NEWBIE, BOSS);

    const grant = await access.grantAgencyAdminAccounts(agency, NEWBIE);
    expect(grant.failed).toEqual([]);
    expect(grant.granted).toBe(1);
    expect(await accountFor(own)).toBe(true);
    expect(await accountFor(client)).toBeNull();
    expect((await ws.openableWorkspaces(NEWBIE, own)).map((t) => t.slug)).toEqual(["recharge-studio"]);

    // Once the platform opens the client, the same call reaches it.
    await access.applyAccessLevel(agency, client, "full", "super-admin@test");
    const again = await access.grantAgencyAdminAccounts(agency, NEWBIE);
    expect(again.granted).toBe(2);
    expect(await accountFor(client)).toBe(true);
    expect((await ws.openableWorkspaces(NEWBIE, own)).map((t) => t.slug).sort()).toEqual([
      "client-abc",
      "recharge-studio",
    ]);

    // Taking them off the agency closes the panel and leaves the accounts alone — the same rule
    // the platform console follows, so neither door surprises the other.
    await mod.removeOrgAdmin(agency.id, NEWBIE);
    expect(await mod.runsOrg(NEWBIE, agency.id)).toBe(false);
    expect(await accountFor(client)).toBe(true);
  });
});

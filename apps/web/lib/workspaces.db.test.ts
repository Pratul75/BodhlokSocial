/**
 * Which workspaces the switcher may offer, against a real Postgres.
 *
 * The rule being tested is the one that keeps two agencies apart: a person who works for both
 * sees, from inside one of them, only that one's workspaces. Sign out and sign in to reach the
 * other. The switcher is the only place that list is drawn, so this is where the rule lives or
 * is lost.
 *
 * Creates and drops its own database, so it never touches development data; skipped when
 * Postgres isn't reachable.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const base = process.env.DATABASE_URL ?? "postgres://bodh:bodh@localhost:5433/bodh";
const dbName = `bodh_switch_${Date.now()}`;
const admin = postgres(base, { max: 1, onnotice: () => {} });
const reachable = await admin`select 1`.then(() => true).catch(() => false);

describe.skipIf(!reachable)("workspaces the switcher offers", () => {
  let mod: typeof import("@bodh/db");
  let ws: typeof import("./workspaces");
  let agencyOwn: import("@bodh/db").TenantRef;
  let clientAbc: import("@bodh/db").TenantRef;
  let otherAgency: import("@bodh/db").TenantRef;
  const roles: string[] = [];

  const FREELANCER = "freelancer@example.test";

  /** Puts somebody in a workspace, the way Admin and the console both do. */
  async function addPerson(tenant: import("@bodh/db").TenantRef, email: string) {
    await mod.withTenant(tenant, async () => {
      await mod.db.insert(mod.users).values({ email, name: "A Person", role: "social_manager" }).onConflictDoNothing();
    });
    await mod.noteUserInDirectory(tenant.id, email, true);
  }

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

    const agency = await mod.createOrg({ name: "Recharge Studio" });
    const rival = await mod.createOrg({ name: "Other Agency" });

    for (const [slug, name, orgId, into] of [
      ["recharge-studio", "Recharge Studio", agency.id, "own"],
      ["client-abc", "Client ABC", agency.id, "abc"],
      ["other-client", "Other Client", rival.id, "other"],
    ] as const) {
      const { tenant } = await mod.provisionTenant({ slug, name, adminEmail: `admin@${slug}.test`, orgId, actor: "test" });
      if (tenant.dbRole) roles.push(tenant.dbRole);
      if (into === "own") agencyOwn = tenant;
      else if (into === "abc") clientAbc = tenant;
      else otherAgency = tenant;
    }

    // One person, three workspaces, two agencies.
    for (const t of [agencyOwn, clientAbc, otherAgency]) await addPerson(t, FREELANCER);

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

  it("offers the agency's own workspace and its clients, and nothing from another agency", async () => {
    const from = await ws.openableWorkspaces(FREELANCER, agencyOwn);
    expect(from.map((t) => t.slug).sort()).toEqual(["client-abc", "recharge-studio"]);
    expect(from.map((t) => t.slug)).not.toContain("other-client");
  });

  it("shows the other agency only from inside it", async () => {
    const from = await ws.openableWorkspaces(FREELANCER, otherAgency);
    expect(from.map((t) => t.slug)).toEqual(["other-client"]);
  });

  it("offers nothing extra to somebody who is only in one workspace", async () => {
    const only = "oneplace@example.test";
    await addPerson(clientAbc, only);
    const from = await ws.openableWorkspaces(only, clientAbc);
    // One entry means the switcher is not drawn at all.
    expect(from.map((t) => t.slug)).toEqual(["client-abc"]);
  });

  it("drops a workspace that has been suspended", async () => {
    await mod.ownerSql()`update platform.tenants set status = 'suspended' where id = ${clientAbc.id}`;
    mod.forgetTenants();
    try {
      const from = await ws.openableWorkspaces(FREELANCER, agencyOwn);
      expect(from.map((t) => t.slug)).toEqual(["recharge-studio"]);
    } finally {
      await mod.ownerSql()`update platform.tenants set status = 'active' where id = ${clientAbc.id}`;
      mod.forgetTenants();
    }
  });

  it("drops a workspace the person has been removed from", async () => {
    await mod.noteUserInDirectory(clientAbc.id, FREELANCER, false);
    try {
      const from = await ws.openableWorkspaces(FREELANCER, agencyOwn);
      expect(from.map((t) => t.slug)).toEqual(["recharge-studio"]);
    } finally {
      await mod.noteUserInDirectory(clientAbc.id, FREELANCER, true);
    }
  });
});

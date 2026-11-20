/**
 * Organizations, against a real Postgres.
 *
 * An organization holds no data, so there is little to test about what it *is*. What matters is
 * what it must never do: lose a workspace, let one be deleted out from under its workspaces, or
 * let a deploy leave a workspace belonging to nobody.
 *
 * Creates and drops its own database, so it never touches development data; skipped when
 * Postgres isn't reachable.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const base = process.env.DATABASE_URL ?? "postgres://bodh:bodh@localhost:5433/bodh";
const dbName = `bodh_orgs_${Date.now()}`;
const admin = postgres(base, { max: 1, onnotice: () => {} });
const reachable = await admin`select 1`.then(() => true).catch(() => false);

describe.skipIf(!reachable)("organizations", () => {
  let mod: typeof import("./index");
  let first: import("./client").TenantRef;
  const roles: string[] = [];

  beforeAll(async () => {
    await admin.unsafe(`create database ${dbName}`);
    const url = new URL(base);
    url.pathname = `/${dbName}`;
    process.env.DATABASE_URL = url.toString();
    process.env.MIGRATE_DATABASE_URL = url.toString();
    delete process.env.DEFAULT_TENANT_SLUG;
    delete process.env.FIRST_ORG_NAME;
    delete process.env.FIRST_ORG_SLUG;

    mod = await import("./index");
    await mod.setupPlatform();
    const bootstrap = await mod.migrateTenant(
      { id: "bootstrap", slug: "one", name: "One", dataSchema: "public", dbRole: null, status: "active" },
      undefined,
      "test",
    );
    expect(bootstrap.error).toBeUndefined();
    first = await mod.registerFirstTenant({ slug: "one", name: "One" });
    if (first.dbRole) roles.push(first.dbRole);
  }, 180_000);

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

  it("a workspace starts with no organization, and the backfill gives it one", async () => {
    // This is the deploy-day path: an installation that predates organizations has workspaces
    // and nobody holding them.
    expect((await mod.tenantBySlug("one"))?.orgId ?? null).toBeNull();

    const { org, placed } = await mod.backfillOrgs("One");
    expect(placed).toBe(1);
    mod.forgetTenants();
    expect((await mod.tenantBySlug("one"))?.orgId).toBe(org.id);
  });

  it("running the backfill again moves nothing", async () => {
    // It runs on every deploy, so doing nothing the second time is the whole requirement.
    const again = await mod.backfillOrgs("One");
    expect(again.placed).toBe(0);
    expect((await mod.listOrgs())).toHaveLength(1);
  });

  it("a workspace created for an organization belongs to it from the first row", async () => {
    const agency = await mod.createOrg({ name: "Recharge Studio" });
    const { tenant } = await mod.provisionTenant({
      slug: "client-abc",
      name: "Client ABC",
      adminEmail: "admin@abc.test",
      orgId: agency.id,
      actor: "test",
    });
    if (tenant.dbRole) roles.push(tenant.dbRole);
    expect(tenant.orgId).toBe(agency.id);
    mod.forgetTenants();
    expect((await mod.tenantBySlug("client-abc"))?.orgId).toBe(agency.id);
    expect((await mod.workspaceCounts()).get(agency.id)).toBe(1);
  });

  it("an agency's own workspace is just a workspace, made the same way", async () => {
    // What the console does when an organization is created: the row, then a workspace of the
    // same name inside it. Nothing about it is a special kind of workspace — it has its own
    // schema, its own role, its own admin and its own directory row, exactly like a client's.
    const agency = await mod.createOrg({ name: "Full Service Co" });
    const { tenant, tables } = await mod.provisionTenant({
      slug: await mod.uniqueSlug("Full Service Co"),
      name: "Full Service Co",
      adminEmail: "admin@fullservice.test",
      orgId: agency.id,
      actor: "test",
    });
    if (tenant.dbRole) roles.push(tenant.dbRole);

    expect(tenant.name).toBe(agency.name);
    expect(tenant.orgId).toBe(agency.id);
    expect(tenant.dataSchema).not.toBe("public");
    expect(tables).toBeGreaterThan(20);

    // Its admin exists inside it, and sign-in can find the workspace from that address.
    const admin = await mod.withTenant(tenant, async () => {
      const [row] = await mod.db.select().from(mod.users).limit(1);
      return row ?? null;
    });
    expect(admin?.email).toBe("admin@fullservice.test");
    expect(admin?.role).toBe("admin");
    expect((await mod.tenantsForEmail("admin@fullservice.test")).map((t) => t.id)).toContain(tenant.id);
  });

  it("two organizations cannot share a short name", async () => {
    const a = await mod.createOrg({ name: "Acme Digital" });
    const slug = await mod.uniqueOrgSlug("Acme Digital");
    expect(slug).not.toBe(a.slug);
    const b = await mod.createOrg({ name: "Acme Digital", slug });
    expect(b.slug).not.toBe(a.slug);
    await expect(mod.createOrg({ name: "Acme Digital", slug: a.slug })).rejects.toThrow();
  });

  it("an organization with workspaces cannot be deleted out from under them", async () => {
    // The database refuses, not the application. Deleting an agency has to mean dealing with
    // its clients first, and that is a decision for a person rather than a cascade.
    const [withClients] = await mod.ownerSql()<{ id: string }[]>`
      select org_id as id from platform.tenants where org_id is not null limit 1`;
    await expect(mod.ownerSql()`delete from platform.orgs where id = ${withClients!.id}`).rejects.toThrow();
  });

  it("a suspended organization is not offered at sign-in, and its workspaces are untouched", async () => {
    const agency = (await mod.listOrgs()).find((o) => o.name === "Recharge Studio")!;
    const before = (await mod.tenantBySlug("client-abc"))!.status;
    await mod.setOrgStatus(agency.id, "suspended");

    expect((await mod.activeOrgs()).map((o) => o.id)).not.toContain(agency.id);
    expect((await mod.listOrgs()).map((o) => o.id)).toContain(agency.id);
    // Closing the agency's account is not the same decision as closing its clients'.
    mod.forgetTenants();
    expect((await mod.tenantBySlug("client-abc"))!.status).toBe(before);

    await mod.setOrgStatus(agency.id, "active");
  });

  it("says which agencies somebody runs, and only those", async () => {
    const mine = (await mod.listOrgs()).find((o) => o.name === "Recharge Studio")!;
    const theirs = (await mod.listOrgs()).find((o) => o.name === "Full Service Co")!;
    await mod.addOrgAdmin(mine.id, "Boss@Agency.Test", "super-admin@test");

    // Stored and matched lower-case: the same address typed two ways is one person.
    expect((await mod.orgsRunBy("boss@agency.test")).map((o) => o.id)).toEqual([mine.id]);
    expect(await mod.runsOrg("boss@agency.test", mine.id)).toBe(true);
    expect(await mod.runsOrg("boss@agency.test", theirs.id)).toBe(false);
    expect(await mod.runsOrg("someone@else.test", mine.id)).toBe(false);
    expect(await mod.runsOrg("boss@agency.test", null)).toBe(false);
  });

  it("appointing the same person twice changes nothing", async () => {
    const mine = (await mod.listOrgs()).find((o) => o.name === "Recharge Studio")!;
    await mod.addOrgAdmin(mine.id, "boss@agency.test", "someone-else@test");
    const admins = await mod.listOrgAdmins(mine.id);
    expect(admins.filter((a) => a.email === "boss@agency.test")).toHaveLength(1);
    // The first appointment stands, so the audit trail keeps who actually made it.
    expect(admins.find((a) => a.email === "boss@agency.test")?.addedBy).toBe("super-admin@test");
  });

  it("a suspended agency is run by nobody", async () => {
    // /org asks this on every request, so suspending an agency closes its panel at once.
    const mine = (await mod.listOrgs()).find((o) => o.name === "Recharge Studio")!;
    await mod.setOrgStatus(mine.id, "suspended");
    try {
      expect(await mod.orgsRunBy("boss@agency.test")).toEqual([]);
      expect(await mod.runsOrg("boss@agency.test", mine.id)).toBe(false);
    } finally {
      await mod.setOrgStatus(mine.id, "active");
    }
  });

  it("removing somebody takes the agency away, and nothing else", async () => {
    const mine = (await mod.listOrgs()).find((o) => o.name === "Recharge Studio")!;
    const before = await mod.workspacesOf(mine.id);
    await mod.removeOrgAdmin(mine.id, "boss@agency.test");
    expect(await mod.runsOrg("boss@agency.test", mine.id)).toBe(false);
    // Their accounts inside workspaces are a separate decision and are left alone.
    expect((await mod.workspacesOf(mine.id)).map((t) => t.id)).toEqual(before.map((t) => t.id));
  });

  it("the first organization can be named by the deployment", async () => {
    process.env.FIRST_ORG_NAME = "Named By Deploy";
    process.env.FIRST_ORG_SLUG = "named-by-deploy";
    try {
      const org = await mod.ensureFirstOrg("ignored");
      expect(org.name).toBe("Named By Deploy");
      // Idempotent: a second deploy finds the same row rather than making another.
      expect((await mod.ensureFirstOrg("ignored")).id).toBe(org.id);
    } finally {
      delete process.env.FIRST_ORG_NAME;
      delete process.env.FIRST_ORG_SLUG;
    }
  });
});

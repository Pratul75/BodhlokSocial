/**
 * The tenant registry and provisioning.
 *
 * Provisioning creates a schema, a database role granted only that schema, the 39 tables from
 * de-qualified DDL, the same seed rows the single-tenant bootstrap writes, every entitlement
 * switched on, and the first admin — then asserts that no foreign key points outside the
 * tenant's schema before marking it active.
 */
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  currentTenantOrNull,
  defaultTenantSlug,
  forgetTenantPool,
  ownerSql,
  rememberDefaultTenant,
  rememberTenantCount,
  readOnlyRole,
  rememberTenantRoleSecret,
  withTenant,
  type TenantRef,
} from "./client";
import { EMPTY_SCHEMA, RESERVED_SLUGS, schemaForSlug, slugCandidate } from "./platform";
import { forgetEntitlements } from "./entitlements-store";
import { ensureTrackingTable, migrationFiles, tenantDdlStatements, TRACKING_TABLE } from "./migrate-tenants";

// Built with path.join rather than new URL(..., import.meta.url): the latter is a static asset
// reference to a bundler, and this module is reachable from the web app's server bundle.
const packageRoot = () => dirname(dirname(fileURLToPath(import.meta.url)));
const platformDir = () => join(packageRoot(), "platform");

/* -------------------------------------------------------------------------- */
/* Control plane setup                                                        */
/* -------------------------------------------------------------------------- */

/** Creates the `platform` schema and its tables. Additive and idempotent. */
export async function setupPlatform(): Promise<void> {
  const sql = ownerSql();
  const dir = platformDir();
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
    await sql.unsafe(await readFile(`${dir}/${file}`, "utf8"));
  }
}

/* -------------------------------------------------------------------------- */
/* Registry                                                                   */
/* -------------------------------------------------------------------------- */

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  data_schema: string;
  db_role: string | null;
  db_role_secret: string | null;
  status: string;
  org_id?: string | null;
}

const toRef = (r: TenantRow): TenantRef => {
  if (r.db_role && r.db_role_secret) rememberTenantRoleSecret(r.db_role, r.db_role_secret);
  return { id: r.id, slug: r.slug, name: r.name, dataSchema: r.data_schema, dbRole: r.db_role, status: r.status, orgId: r.org_id ?? null };
};

let cache: { at: number; byId: Map<string, TenantRef>; bySlug: Map<string, TenantRef> } | null = null;
const CACHE_MS = Number(process.env.TENANT_CACHE_MS ?? 30_000);

/** Drops the cached registry, so the next lookup re-reads it. */
export function forgetTenants() {
  cache = null;
}

async function registry() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  const rows = (await ownerSql()<TenantRow[]>`
    select id, slug, name, data_schema, db_role, db_role_secret, status, org_id
    from platform.tenants`) as unknown as TenantRow[];
  const byId = new Map<string, TenantRef>();
  const bySlug = new Map<string, TenantRef>();
  for (const r of rows) {
    const ref = toRef(r);
    byId.set(ref.id, ref);
    bySlug.set(ref.slug, ref);
  }
  cache = { at: Date.now(), byId, bySlug };
  // The fallback is only ever allowed to answer for a single-tenant installation, so the count
  // is what switches it off — permanently, the first time a second tenant appears.
  rememberTenantCount(byId.size);
  // Let the transitional fallback use the tenant's real row (and role) rather than a stub.
  const fallbackSlug = defaultTenantSlug();
  rememberDefaultTenant(fallbackSlug ? (bySlug.get(fallbackSlug) ?? null) : null);
  return cache;
}

export async function listTenants(): Promise<TenantRef[]> {
  return [...(await registry()).byId.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

export interface ArchiveInfo {
  archivedAt: Date | null;
  archivedBy: string | null;
  reason: string | null;
  purgeAfter: Date | null;
}

/** How long an archived workspace is kept before anyone may purge it. */
export const RETENTION_DAYS = Number(process.env.WORKSPACE_RETENTION_DAYS ?? 30);

/**
 * Archives a workspace: it stops answering, and nothing is removed.
 *
 * This is what the console's Delete does. The schema, the roles and every row stay exactly
 * where they are, so the mistake that this protects against — the wrong row, the wrong moment —
 * costs an undo rather than a customer's data. `purge_after` is the earliest a purge may run.
 */
export async function archiveTenant(tenantId: string, by: string, reason: string | null): Promise<TenantRef | null> {
  const sql = ownerSql();
  const rows = (await sql<TenantRow[]>`
    update platform.tenants
    set status = 'archived',
        archived_at = now(),
        archived_by = ${by},
        archived_reason = ${reason},
        purge_after = now() + ${`${RETENTION_DAYS} days`}::interval,
        updated_at = now()
    where id = ${tenantId} and status <> 'archived'
    returning id, slug, name, data_schema, db_role, db_role_secret, status, org_id`) as unknown as TenantRow[];
  forgetTenants();
  return rows[0] ? toRef(rows[0]) : null;
}

/** Brings an archived workspace back. Nothing was removed, so there is nothing to restore. */
export async function restoreTenant(tenantId: string): Promise<TenantRef | null> {
  const sql = ownerSql();
  const rows = (await sql<TenantRow[]>`
    update platform.tenants
    set status = 'active', archived_at = null, archived_by = null, archived_reason = null,
        purge_after = null, updated_at = now()
    where id = ${tenantId} and status = 'archived'
    returning id, slug, name, data_schema, db_role, db_role_secret, status, org_id`) as unknown as TenantRow[];
  forgetTenants();
  return rows[0] ? toRef(rows[0]) : null;
}

export async function archiveInfo(tenantId: string): Promise<ArchiveInfo | null> {
  const rows = (await ownerSql()<ArchiveInfo[]>`
    select archived_at as "archivedAt", archived_by as "archivedBy",
           archived_reason as "reason", purge_after as "purgeAfter"
    from platform.tenants where id = ${tenantId}`) as unknown as ArchiveInfo[];
  return rows[0] ?? null;
}

export class PurgeRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurgeRefused";
  }
}

/**
 * Removes a workspace for good: its schema, its two roles, and every control-plane row.
 *
 * Four things have to be true before a single statement runs, and each is a different kind of
 * mistake being refused: it must already be archived (so nobody deletes a live workspace), the
 * retention window must have passed (so nobody deletes one today that they archived today), the
 * caller must have typed the workspace's own short name (so nobody deletes the row below the one
 * they meant), and it must not be tenant #1 (whose schema is `public` — dropping that is the
 * whole installation).
 */
export async function purgeTenant(tenantId: string, typedSlug: string, by: string): Promise<{ schema: string; roles: string[] }> {
  const sql = ownerSql();
  const rows = (await sql<{ slug: string; data_schema: string; db_role: string | null; status: string; purge_after: Date | null }[]>`
    select slug, data_schema, db_role, status, purge_after from platform.tenants where id = ${tenantId}`) as unknown as {
    slug: string;
    data_schema: string;
    db_role: string | null;
    status: string;
    purge_after: Date | null;
  }[];
  const t = rows[0];
  if (!t) throw new PurgeRefused("No such workspace.");
  if (t.data_schema === "public") throw new PurgeRefused("The first workspace cannot be purged: its schema is the installation.");
  if (t.status !== "archived") throw new PurgeRefused("Archive the workspace first. Only an archived workspace can be purged.");
  if (!t.purge_after || t.purge_after.getTime() > Date.now()) {
    const when = t.purge_after ? t.purge_after.toISOString().slice(0, 10) : "later";
    throw new PurgeRefused(`This workspace is kept until ${when}. It cannot be purged before then.`);
  }
  if (typedSlug.trim() !== t.slug) throw new PurgeRefused(`Type ${t.slug} exactly to confirm.`);

  const roles = [t.db_role, t.db_role ? `${t.db_role}_ro` : null].filter((r): r is string => Boolean(r));
  await sql.unsafe(`drop schema if exists "${t.data_schema.replace(/"/g, '""')}" cascade`);
  // Control-plane rows: entitlements, settings, directory and impersonations cascade from the
  // tenant row, but the invite pointers and the row itself are removed here explicitly.
  await sql`delete from platform.invite_tokens where tenant_id = ${tenantId}`;
  await sql`delete from platform.tenants where id = ${tenantId}`;
  for (const role of roles) {
    const q = role.replace(/"/g, '""');
    await sql.unsafe(`drop owned by "${q}" cascade`).catch(() => undefined);
    await sql.unsafe(`drop role if exists "${q}"`).catch(() => undefined);
  }
  forgetTenants();
  forgetEntitlements(tenantId);
  void by;
  return { schema: t.data_schema, roles };
}

/**
 * Tenant #1: the workspace that was here before there were workspaces, the one in the `public`
 * schema. The addresses the outside world already points at — webhooks, the page feed — belong
 * to it, so they keep working after the DEFAULT_TENANT_SLUG fallback is taken away.
 */
export async function firstTenant(): Promise<TenantRef | null> {
  return (await listTenants()).find((t) => t.dataSchema === "public") ?? null;
}

/** Only the tenants a job or a sign-in should act on. */
export async function activeTenants(): Promise<TenantRef[]> {
  return (await listTenants()).filter((t) => t.status === "active");
}

export async function tenantBySlug(slug: string): Promise<TenantRef | null> {
  return (await registry()).bySlug.get(slug) ?? null;
}

export async function tenantById(id: string): Promise<TenantRef | null> {
  return (await registry()).byId.get(id) ?? null;
}

/**
 * The workspace a request with no address of its own belongs to.
 *
 * Only ever answers for a single-tenant installation. Once a second workspace exists there is no
 * right guess: an address that names nobody is refused, rather than quietly handed tenant #1's
 * data under a URL that says nothing about whose it is. `firstTenant()` remains for the few
 * addresses the outside world already holds, where tenant #1 is a decision, not a guess.
 */
export async function defaultTenant(): Promise<TenantRef | null> {
  const slug = defaultTenantSlug();
  if (!slug) return null;
  const all = await listTenants();
  if (all.length > 1) return null;
  return (await tenantBySlug(slug)) ?? null;
}

/**
 * Resolves the tenant for a request. `hint` is a tenant id or slug from the session, the path
 * or the host. With no hint, the single-tenant default above, which stops answering as soon as
 * there is more than one workspace.
 */
export async function resolveTenant(hint?: string | null): Promise<TenantRef | null> {
  if (hint) {
    const byId = await tenantById(hint);
    if (byId) return byId;
    const bySlug = await tenantBySlug(hint);
    if (bySlug) return bySlug;
    return null;
  }
  return defaultTenant();
}

/** Runs `fn` inside a tenant scope, looked up by id or slug. */
export async function withTenantRef<T>(hint: string, fn: () => Promise<T>): Promise<T> {
  const t = await resolveTenant(hint);
  if (!t) throw new Error(`Unknown tenant: ${hint}`);
  return withTenant(t, fn);
}

/** Runs `fn` once per active tenant, isolating failures so one tenant cannot skip the rest. */
export async function forEachTenant<T>(
  fn: (tenant: TenantRef) => Promise<T>,
): Promise<{ tenant: TenantRef; value?: T; error?: string }[]> {
  const out: { tenant: TenantRef; value?: T; error?: string }[] = [];
  for (const tenant of await activeTenants()) {
    try {
      out.push({ tenant, value: await withTenant(tenant, () => fn(tenant)) });
    } catch (e) {
      out.push({ tenant, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Provisioning                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The committed migrations name the `public` schema in 18 foreign-key clauses. Replaying them
 * into another schema produces foreign keys pointing at tenant #1 — silently. Provisioning
 * therefore applies the same DDL with that qualification stripped, and asserts afterwards.
 */
export async function tenantDdl(): Promise<string[]> {
  return tenantDdlStatements();
}

/** Foreign keys in `schema` that point anywhere else. Must be empty. */
export async function foreignKeysLeaving(schemaName: string): Promise<string[]> {
  const rows = (await ownerSql()<{ fk: string }[]>`
    select rel.relname || '.' || c.conname || ' -> ' || fnsp.nspname || '.' || frel.relname as fk
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    join pg_class frel on frel.oid = c.confrelid
    join pg_namespace fnsp on fnsp.oid = frel.relnamespace
    where c.contype = 'f' and nsp.nspname = ${schemaName} and fnsp.nspname <> ${schemaName}
    order by 1`) as unknown as { fk: string }[];
  return rows.map((r) => r.fk);
}

export interface ProvisionInput {
  slug: string;
  name: string;
  /** The first admin's email address. */
  adminEmail: string;
  adminName?: string;
  plan?: string;
  /** The agency this workspace belongs to. Left out only by tests and the first migration. */
  orgId?: string | null;
  actor: string;
}

export interface ProvisionResult {
  tenant: TenantRef;
  created: boolean;
  tables: number;
  notes: string[];
}

/**
 * Creates a tenant end to end. Idempotent and resumable: running it again for a slug that is
 * mid-provision continues where it stopped.
 */
/* -------------------------------------------------------------------------- */
/* Password links: which workspace a token belongs to                         */
/* -------------------------------------------------------------------------- */

/**
 * Remembers, in the control plane, which workspace a password link was made in.
 *
 * Only the link's hash and the workspace id. The page that opens the link has no session and no
 * workspace in the address, so without this it would have to look in every workspace — or the
 * address would have to carry the workspace, which is the thing being taken out of it.
 *
 * Expired rows are swept here rather than on a schedule: a table that is only read by the page
 * that spends a token does not need a job of its own.
 */
export async function rememberInviteToken(tenantId: string, tokenHash: string, expiresAt: Date): Promise<void> {
  const sql = ownerSql();
  await sql`delete from platform.invite_tokens where expires_at < now()`;
  await sql`
    insert into platform.invite_tokens (token_hash, tenant_id, expires_at)
    values (${tokenHash}, ${tenantId}, ${expiresAt})
    on conflict (token_hash) do update set tenant_id = excluded.tenant_id, expires_at = excluded.expires_at`;
}

/** The workspace a live password link belongs to, or null. The hash still has to match inside it. */
export async function tenantForInviteHash(tokenHash: string): Promise<TenantRef | null> {
  if (!tokenHash) return null;
  const rows = (await ownerSql()<{ tenant_id: string }[]>`
    select tenant_id from platform.invite_tokens
    where token_hash = ${tokenHash} and expires_at > now()
    limit 1`) as unknown as { tenant_id: string }[];
  return rows[0] ? await tenantById(rows[0].tenant_id) : null;
}

/** Forgets a link once it has been spent. */
export async function forgetInviteToken(tokenHash: string): Promise<void> {
  await ownerSql()`delete from platform.invite_tokens where token_hash = ${tokenHash}`;
}

/**
 * A short name no other workspace has, worked out from the one the operator typed.
 *
 * Collisions get a number, which is the only honest answer: two customers really can be called
 * Zenith Dental, and the second one is not a mistake to be refused.
 */
export async function uniqueSlug(name: string): Promise<string> {
  const sql = ownerSql();
  const base = slugCandidate(name);
  const taken = async (s: string) =>
    RESERVED_SLUGS.has(s) ||
    ((await sql<{ n: string }[]>`select count(*)::text as n from platform.tenants where slug = ${s}`) as unknown as {
      n: string;
    }[])[0]!.n !== "0";

  if (!(await taken(base))) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = `-${n}`;
    const candidate = base.slice(0, 39 - suffix.length).replace(/-+$/, "") + suffix;
    if (!(await taken(candidate))) return candidate;
  }
  throw new Error(`Could not find a free short name for ${name}.`);
}

export async function provisionTenant(input: ProvisionInput): Promise<ProvisionResult> {
  const sql = ownerSql();
  const slug = input.slug.trim().toLowerCase();
  const dataSchema = schemaForSlug(slug);
  const notes: string[] = [];

  // Creating the second tenant is what switches the single-tenant fallback off for good, in
  // this process immediately and in every other one as soon as it re-reads the registry. It
  // used to be refused here; it no longer has to be, because an unscoped query now throws
  // instead of resolving to tenant #1.
  const existingCount = Number(
    ((await sql<{ n: string }[]>`select count(*)::text as n from platform.tenants`) as unknown as { n: string }[])[0]!.n,
  );
  const already = await rowBySlug(slug);
  if (!already && existingCount >= 1) {
    rememberTenantCount(existingCount + 1);
    if (defaultTenantSlug()) {
      notes.push("DEFAULT_TENANT_SLUG is set but no longer answers: with more than one workspace there is no default. Remove it from the deployment configuration.");
    }
  }

  let row = already;
  if (!row) {
    const inserted = (await sql<TenantRow[]>`
      insert into platform.tenants (slug, name, data_schema, status, plan, org_id)
      values (${slug}, ${input.name}, ${dataSchema}, 'provisioning', ${input.plan ?? "full"}, ${input.orgId ?? null})
      returning id, slug, name, data_schema, db_role, db_role_secret, status, org_id`) as unknown as TenantRow[];
    row = inserted[0]!;
  }

  // 1. the schema
  await sql.unsafe(`create schema if not exists ${ident(dataSchema)}`);

  // 2. the role, granted this schema and nothing else, defaulting to the empty schema
  const { role, secret } = await ensureTenantRole(sql, dataSchema, row);

  // 3. the tables, one migration at a time, each recorded in the schema's own record
  //    so that later migrations know exactly where this tenant starts from.
  const before = await tableCount(dataSchema);
  const files = await migrationFiles();
  await ensureTrackingTable(dataSchema);
  if (before === 0) {
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local search_path to ${ident(dataSchema)}`);
      for (const f of files) {
        for (const st of f.statements) await tx.unsafe(st);
        await tx.unsafe(
          `insert into ${ident(dataSchema)}.${ident(TRACKING_TABLE)} (tag, hash, applied_by) values ($1, $2, $3)
           on conflict (tag) do nothing`,
          [f.tag, f.hash, `provision:${input.actor}`],
        );
      }
    });
    notes.push(`applied ${files.length} migrations`);
  } else {
    notes.push(`schema already had ${before} tables`);
  }
  const tables = await tableCount(dataSchema);

  // 4. the assertion that makes this safe
  const escaping = await foreignKeysLeaving(dataSchema);
  if (escaping.length) {
    await sql`update platform.tenants set status = 'provisioning' where id = ${row.id}`;
    throw new Error(
      `Refusing to activate ${slug}: ${escaping.length} foreign keys point outside its schema: ${escaping.slice(0, 3).join("; ")}`,
    );
  }

  // 5. grants for the tables that now exist, and for anything a later migration adds
  await grantTenantTables(sql, dataSchema, role);

  await sql`
    update platform.tenants
    set db_role = ${role}, db_role_secret = ${secret}, name = ${input.name}, updated_at = now()
    where id = ${row.id}`;
  rememberTenantRoleSecret(role, secret);
  forgetTenants();
  await forgetTenantPool(row.id);

  const ref: TenantRef = {
    id: row.id,
    slug,
    name: input.name,
    dataSchema,
    dbRole: role,
    status: "provisioning",
    orgId: row.org_id ?? input.orgId ?? null,
  };

  // 6. the same seed rows the single-tenant bootstrap writes, inside the tenant
  await withTenant(ref, async () => {
    const { seedTenantBaseline } = await import("./seed-tenant");
    await seedTenantBaseline({ adminEmail: input.adminEmail, adminName: input.adminName });
  });

  // 7. entitlements: everything on, written explicitly
  await writeFullEntitlements(row.id, input.actor);

  // 8. the directory row, so sign-in can find this tenant from an address
  await sql`
    insert into platform.user_directory (email, tenant_id, active)
    values (${input.adminEmail.trim().toLowerCase()}, ${row.id}, true)
    on conflict (email, tenant_id) do update set active = true, updated_at = now()`;

  await sql`update platform.tenants set status = 'active', updated_at = now() where id = ${row.id}`;
  await sql`
    insert into platform.platform_audit (actor, action, target, tenant_id, detail)
    values (${input.actor}, 'provision_tenant', ${slug}, ${row.id}, ${sql.json({ tables, notes })})`;
  forgetTenants();

  return { tenant: { ...ref, status: "active" }, created: !already, tables, notes };
}

async function rowBySlug(slug: string): Promise<TenantRow | null> {
  const rows = (await ownerSql()<TenantRow[]>`
    select id, slug, name, data_schema, db_role, db_role_secret, status, org_id
    from platform.tenants where slug = ${slug}`) as unknown as TenantRow[];
  return rows[0] ?? null;
}

/**
 * Makes sure a workspace has both of its database roles and their grants, and that the registry
 * knows them. Idempotent, and run after every migration so that tables a migration added are
 * granted to both roles rather than being readable by the owner alone.
 */
export async function ensureTenantRoles(tenantId: string): Promise<{ role: string } | null> {
  const sql = ownerSql();
  const rows = (await sql<TenantRow[]>`
    select id, slug, name, data_schema, db_role, db_role_secret, status, org_id
    from platform.tenants where id = ${tenantId}`) as unknown as TenantRow[];
  const row = rows[0];
  if (!row) return null;
  const { role, secret } = await ensureTenantRole(sql, row.data_schema, row);
  await grantTenantTables(sql, row.data_schema, role);
  if (row.db_role !== role || row.db_role_secret !== secret) {
    await sql`
      update platform.tenants set db_role = ${role}, db_role_secret = ${secret}, updated_at = now()
      where id = ${tenantId}`;
    forgetTenants();
    await forgetTenantPool(tenantId);
  }
  rememberTenantRoleSecret(role, secret);
  return { role };
}

async function tableCount(schemaName: string): Promise<number> {
  const rows = (await ownerSql()<{ n: string }[]>`
    select count(*)::text as n from information_schema.tables
    where table_schema = ${schemaName} and table_type = 'BASE TABLE'`) as unknown as { n: string }[];
  return Number(rows[0]!.n);
}

/** Quotes an identifier this code built itself. Never called with request input. */
/**
 * A role name that cannot collide with another database's.
 *
 * Postgres roles live in the cluster, not in the database, so naming a role after the schema
 * alone means two databases in one cluster — a development database and a test database, say —
 * fight over the same role and the second one to provision silently changes the first one's
 * password. The database name in the role name keeps them apart.
 */
async function defaultRoleName(sql: ReturnType<typeof ownerSql>, dataSchema: string): Promise<string> {
  const rows = (await sql<{ db: string }[]>`select current_database() as db`) as unknown as { db: string }[];
  const db = (rows[0]?.db ?? "app").replace(/[^a-z0-9_]/gi, "_").toLowerCase();
  // 63 is Postgres's identifier limit; keep the tail, which is the part that varies.
  return `${db}_${dataSchema}_app`.slice(-63);
}

/**
 * The tenant's own database role: the boundary that actually holds.
 *
 * `search_path` only scopes unqualified names, so a query that writes `public.users` reaches
 * another tenant's data whatever the search path says. What stops it is connecting as a role
 * that was never granted anything outside its own schema — including tenant #1, which would
 * otherwise connect as the owner and be the one tenant able to read all the others.
 */
async function ensureTenantRole(
  sql: ReturnType<typeof ownerSql>,
  dataSchema: string,
  row: { db_role: string | null; db_role_secret: string | null },
): Promise<{ role: string; secret: string }> {
  const role = row.db_role ?? (await defaultRoleName(sql, dataSchema));
  const secret = row.db_role_secret ?? randomBytes(24).toString("base64url");
  const roleExists = Number(
    ((await sql<{ n: string }[]>`select count(*)::text as n from pg_roles where rolname = ${role}`) as unknown as { n: string }[])[0]!.n,
  );
  if (!roleExists) {
    await sql.unsafe(`create role ${ident(role)} login password ${literal(secret)}`);
  } else if (!row.db_role_secret) {
    await sql.unsafe(`alter role ${ident(role)} with password ${literal(secret)}`);
  }
  // Fail closed: a connection that forgets to set its search path lands in an empty schema and
  // every query says the table does not exist, rather than quietly finding someone else's.
  await sql.unsafe(`alter role ${ident(role)} set search_path to ${ident(EMPTY_SCHEMA)}`);
  await sql.unsafe(`grant usage on schema ${ident(dataSchema)} to ${ident(role)}`);
  if (dataSchema !== "public") await sql.unsafe(`revoke all on schema public from ${ident(role)}`);

  // Its read-only twin, for an operator looking at this workspace. Same password, so nothing
  // extra has to be stored; what differs is what it was granted, which is only SELECT.
  const ro = readOnlyRole(role);
  const roExists = Number(
    ((await sql<{ n: string }[]>`select count(*)::text as n from pg_roles where rolname = ${ro}`) as unknown as { n: string }[])[0]!.n,
  );
  if (!roExists) {
    await sql.unsafe(`create role ${ident(ro)} login password ${literal(secret)}`);
  } else if (!row.db_role_secret) {
    await sql.unsafe(`alter role ${ident(ro)} with password ${literal(secret)}`);
  }
  await sql.unsafe(`alter role ${ident(ro)} set search_path to ${ident(EMPTY_SCHEMA)}`);
  await sql.unsafe(`grant usage on schema ${ident(dataSchema)} to ${ident(ro)}`);
  if (dataSchema !== "public") await sql.unsafe(`revoke all on schema public from ${ident(ro)}`);
  return { role, secret };
}

/** The table and sequence grants, applied after the tables exist. */
async function grantTenantTables(sql: ReturnType<typeof ownerSql>, dataSchema: string, role: string): Promise<void> {
  await sql.unsafe(`grant select, insert, update, delete on all tables in schema ${ident(dataSchema)} to ${ident(role)}`);
  await sql.unsafe(`grant usage, select on all sequences in schema ${ident(dataSchema)} to ${ident(role)}`);
  await sql.unsafe(
    `alter default privileges in schema ${ident(dataSchema)} grant select, insert, update, delete on tables to ${ident(role)}`,
  );
  await sql.unsafe(`alter default privileges in schema ${ident(dataSchema)} grant usage, select on sequences to ${ident(role)}`);

  // The read-only twin gets SELECT and nothing else, now and for every table a later migration
  // adds. This is what makes "an operator may look but not change" a fact rather than a promise.
  const ro = readOnlyRole(role);
  await sql.unsafe(`grant select on all tables in schema ${ident(dataSchema)} to ${ident(ro)}`);
  await sql.unsafe(`revoke insert, update, delete, truncate on all tables in schema ${ident(dataSchema)} from ${ident(ro)}`);
  await sql.unsafe(`alter default privileges in schema ${ident(dataSchema)} grant select on tables to ${ident(ro)}`);
}

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return `"${name}"`;
}

function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/* -------------------------------------------------------------------------- */
/* Entitlements                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Fills in entitlement rows for modules, features and accounts added since a workspace was made.
 *
 * `on conflict do nothing`: a switch somebody has already set is never touched. This exists so
 * that shipping a new kind of entitlement — as integrations were — does not silently refuse it
 * to every workspace that predates it. Returns how many rows were new.
 */
export async function backfillEntitlements(tenantId: string, actor: string): Promise<number> {
  const { MODULES, FEATURE_KEYS, INTEGRATIONS } = await import("@bodh/shared");
  const sql = ownerSql();
  const rows = [
    ...MODULES.map((m) => ({ kind: "module", key: m.key as string })),
    ...FEATURE_KEYS.map((f) => ({ kind: "feature", key: f as string })),
    ...INTEGRATIONS.map((i) => ({ kind: "integration", key: i.key as string })),
  ];
  let added = 0;
  for (const r of rows) {
    const result = await sql`
      insert into platform.entitlements (tenant_id, kind, key, enabled, updated_by)
      values (${tenantId}, ${r.kind}, ${r.key}, true, ${actor})
      on conflict (tenant_id, kind, key) do nothing
      returning key`;
    added += result.length;
  }
  if (added) forgetEntitlements(tenantId);
  return added;
}

/** Written at provisioning so an absent row is a bug, not an implicit grant. */
export async function writeFullEntitlements(tenantId: string, actor: string): Promise<void> {
  const { MODULES, FEATURE_KEYS, CAPACITY_KEYS, INTEGRATIONS } = await import("@bodh/shared");
  const sql = ownerSql();
  const rows = [
    ...MODULES.map((m) => ({ kind: "module", key: m.key as string, enabled: true })),
    ...FEATURE_KEYS.map((f) => ({ kind: "feature", key: f as string, enabled: true })),
    ...INTEGRATIONS.map((i) => ({ kind: "integration", key: i.key as string, enabled: true })),
  ];
  for (const r of rows) {
    await sql`
      insert into platform.entitlements (tenant_id, kind, key, enabled, updated_by)
      values (${tenantId}, ${r.kind}, ${r.key}, ${r.enabled}, ${actor})
      on conflict (tenant_id, kind, key) do nothing`;
  }
  for (const key of CAPACITY_KEYS) {
    await sql`
      insert into platform.entitlements (tenant_id, kind, key, enabled, value, updated_by)
      values (${tenantId}, 'capacity', ${key}, true, null, ${actor})
      on conflict (tenant_id, kind, key) do nothing`;
  }
}

/* -------------------------------------------------------------------------- */
/* Tenant #1                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Registers the existing installation as tenant #1 against its existing `public` schema.
 * No data moves; one row is written. Idempotent.
 */
export async function registerFirstTenant(opts: { slug: string; name: string }): Promise<TenantRef> {
  const sql = ownerSql();
  const existing = await rowBySlug(opts.slug);
  if (existing) {
    if (existing.db_role && existing.db_role_secret) return toRef(existing);
    // Registered before it had a role of its own: give it one now.
    const { role, secret } = await ensureTenantRole(sql, existing.data_schema, existing);
    await grantTenantTables(sql, existing.data_schema, role);
    const updated = (await sql<TenantRow[]>`
      update platform.tenants set db_role = ${role}, db_role_secret = ${secret}, updated_at = now()
      where id = ${existing.id}
      returning id, slug, name, data_schema, db_role, db_role_secret, status, org_id`) as unknown as TenantRow[];
    const ref = toRef(updated[0]!);
    await forgetTenantPool(ref.id);
    forgetTenants();
    return ref;
  }
  const rows = (await sql<TenantRow[]>`
    insert into platform.tenants (slug, name, data_schema, status, plan)
    values (${opts.slug}, ${opts.name}, 'public', 'active', 'full')
    on conflict (slug) do update set name = excluded.name
    returning id, slug, name, data_schema, db_role, db_role_secret, status, org_id`) as unknown as TenantRow[];
  // Tenant #1 gets its own role too. Without one it connects as the database owner, and the
  // role boundary holds in only one direction: every other tenant is sealed off from it, while
  // it can read all of them.
  const { role, secret } = await ensureTenantRole(sql, "public", rows[0]!);
  await grantTenantTables(sql, "public", role);
  const withRole = (await sql<TenantRow[]>`
    update platform.tenants set db_role = ${role}, db_role_secret = ${secret}, updated_at = now()
    where id = ${rows[0]!.id}
    returning id, slug, name, data_schema, db_role, db_role_secret, status, org_id`) as unknown as TenantRow[];
  const ref = toRef(withRole[0]!);
  await forgetTenantPool(ref.id);
  await writeFullEntitlements(ref.id, "bootstrap");
  // Everyone already in the tenant's own users table can sign in to it.
  await withTenant(ref, async () => {
    const { db } = await import("./client");
    const { users } = await import("./schema");
    const people = await db.select({ email: users.email, active: users.active }).from(users);
    for (const p of people) {
      await sql`
        insert into platform.user_directory (email, tenant_id, active)
        values (${p.email}, ${ref.id}, ${p.active})
        on conflict (email, tenant_id) do update set active = excluded.active, updated_at = now()`;
    }
  });
  forgetTenants();
  return ref;
}

/**
 * The workspaces an email address can sign in to, from the control plane.
 *
 * Sign-in needs this before any tenant is bound: without it the callback would look the person
 * up in whichever tenant happened to be the default, and one address exists in more than one
 * workspace. Kept current by provisioning and by each tenant's own Admin page.
 */
export async function tenantsForEmail(email: string): Promise<TenantRef[]> {
  const rows = (await ownerSql()<TenantRow[]>`
    select t.id, t.slug, t.name, t.data_schema, t.db_role, t.db_role_secret, t.status
    from platform.user_directory d
    join platform.tenants t on t.id = d.tenant_id
    where d.email = ${email.trim().toLowerCase()} and d.active = true and t.status = 'active'
    order by t.created_at`) as unknown as TenantRow[];
  return rows.map(toRef);
}

/** Records (or updates) which workspaces an address can sign in to. */
export async function noteUserInDirectory(tenantId: string, email: string, active: boolean): Promise<void> {
  await ownerSql()`
    insert into platform.user_directory (email, tenant_id, active)
    values (${email.trim().toLowerCase()}, ${tenantId}, ${active})
    on conflict (email, tenant_id) do update set active = excluded.active, updated_at = now()`;
}

/** True while the application is still a single-tenant installation. */
export async function isSingleTenant(): Promise<boolean> {
  return (await listTenants()).length <= 1;
}

export { currentTenantOrNull };

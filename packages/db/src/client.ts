/**
 * Tenant-aware database access.
 *
 * Every tenant gets its own connection pool, bound once at connect time to that tenant's
 * schema (`connection: { search_path }`) and, where one has been provisioned, connecting as
 * that tenant's own database role. The role is the boundary: a search path only scopes
 * UNQUALIFIED names, so a query naming another schema would otherwise cross tenants.
 *
 * The `db` export keeps its name and shape, so the application's existing query call sites
 * are unchanged; they simply run against whichever tenant's pool is current.
 *
 * A query outside a tenant scope throws. A connection that somehow has no search path lands
 * in an empty schema and fails with `relation ... does not exist`, rather than quietly
 * reading tenant #1.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { EMPTY_SCHEMA, SCHEMA_NAME_RE } from "./platform";

const baseUrl = process.env.DATABASE_URL ?? "postgres://bodh:bodh@localhost:5433/bodh";
// On Cloud Run, Cloud SQL is reached through a Unix socket in /cloudsql/<instance>.
const socketDir = process.env.DB_SOCKET_DIR;
const socketOptions = socketDir ? { path: `${socketDir}/.s.PGSQL.5432` } : {};

/** Connections a single tenant's pool may hold. Smaller than the old single pool, since there are now several. */
const TENANT_POOL_MAX = Number(process.env.DB_TENANT_POOL_SIZE ?? process.env.DB_POOL_SIZE ?? 5);
/** Idle pools release every connection, so an idle tenant costs nothing. */
const TENANT_POOL_IDLE_SECONDS = Number(process.env.DB_TENANT_POOL_IDLE ?? 30);

/**
 * While exactly one tenant exists, a request that resolves no tenant falls back to this slug so
 * the application behaves exactly as the single-tenant version did. It is FAIL-OPEN, so
 * provisioning refuses to create a second tenant while it is set (see provisionTenant).
 */
export const defaultTenantSlug = () => process.env.DEFAULT_TENANT_SLUG?.trim() || null;

export interface TenantRef {
  id: string;
  slug: string;
  name: string;
  dataSchema: string;
  dbRole: string | null;
  status: string;
  /** The agency this workspace belongs to. Null only before the migrate step has filled it in. */
  orgId?: string | null;
  /**
   * Bind the workspace through its read-only role instead of its application role.
   *
   * Used while an operator is looking at a customer's workspace. A flag the code remembers to
   * check would be worth little — one forgotten action and support staff can approve a post or
   * raise an ad budget. Connecting as a role that was never granted INSERT, UPDATE or DELETE
   * means the database refuses the write, whatever the application does.
   */
  readOnly?: boolean;
}

/** The read-only companion of a workspace's application role. */
export const readOnlyRole = (dbRole: string) => `${dbRole}_ro`;

/** Secrets for a tenant's own database role, when one has been provisioned. */
const roleSecrets = new Map<string, string>();
export function rememberTenantRoleSecret(role: string, password: string) {
  roleSecrets.set(role, password);
}

function urlForTenant(t: TenantRef): string {
  if (!t.dbRole) {
    // A read-only binding with no role of its own would connect as the owner, which is the
    // opposite of read-only. Refuse rather than quietly hand over a writable connection.
    if (t.readOnly) throw new Error(`Workspace ${t.slug} has no database role, so it cannot be opened read-only.`);
    return baseUrl;
  }
  // The read-only role shares the application role's password: provisioning sets both.
  const password = roleSecrets.get(t.dbRole);
  if (!password) {
    if (t.readOnly) throw new Error(`Workspace ${t.slug}'s role is not unlocked in this process, so it cannot be opened read-only.`);
    return baseUrl; // role not unlocked in this process; search_path still applies
  }
  const u = new URL(baseUrl);
  u.username = encodeURIComponent(t.readOnly ? readOnlyRole(t.dbRole) : t.dbRole);
  u.password = encodeURIComponent(password);
  return u.toString();
}

interface Pooled {
  sql: ReturnType<typeof postgres>;
  db: ReturnType<typeof drizzle<typeof schema>>;
  key: string;
}

const pools = new Map<string, Pooled>();

function poolFor(t: TenantRef): Pooled {
  if (!SCHEMA_NAME_RE.test(t.dataSchema) && t.dataSchema !== "public") {
    throw new Error(`Refusing to connect to an invalid schema name: ${t.dataSchema}`);
  }
  // The key holds everything the connection depends on, the read-only binding included: a
  // workspace may legitimately have both pools open at once, one for its own people and one for
  // an operator looking at it.
  const key = `${t.id}:${t.dataSchema}:${t.dbRole ?? "-"}:${t.readOnly ? "ro" : "rw"}:${roleSecrets.has(t.dbRole ?? "") ? "r" : "b"}`;
  const existing = pools.get(key);
  if (existing) return existing;

  const client = postgres(urlForTenant(t), {
    max: TENANT_POOL_MAX,
    idle_timeout: TENANT_POOL_IDLE_SECONDS,
    onnotice: () => {},
    // Bound once, when the connection opens: nothing per-statement to leak or forget.
    connection: { search_path: t.dataSchema },
    ...socketOptions,
  });
  const pooled: Pooled = { sql: client, db: drizzle(client, { schema }), key };
  pools.set(key, pooled);
  return pooled;
}

const store = new AsyncLocalStorage<{ tenant: TenantRef }>();

/**
 * The real registry row for the default tenant, once it has been read. Lets the transitional
 * fallback below use the tenant's own role rather than a synthesised reference.
 */
let defaultRef: TenantRef | null = null;
export function rememberDefaultTenant(t: TenantRef | null) {
  defaultRef = t;
}

/**
 * How many tenants this installation has, as the registry last saw it, and whether it has EVER
 * had more than one. The second is a latch: once a second tenant exists, no cached count, no
 * stale read and no restart can switch the fallback back on.
 */
let tenantCount: number | null = null;
let everMultiTenant = false;

export function rememberTenantCount(n: number) {
  tenantCount = n;
  if (n > 1) everMultiTenant = true;
}

/** Test support: forget what the registry said. Never used by the application. */
export function forgetTenantCount() {
  tenantCount = null;
  everMultiTenant = false;
}

/**
 * The transitional fallback, for a single-tenant installation only.
 *
 * While DEFAULT_TENANT_SLUG is set AND this installation has exactly one tenant, a query with no
 * scope resolves to that tenant, so the application that has always had one workspace keeps
 * behaving exactly as it does. The moment a second tenant exists it is off, permanently and in
 * every process: an unscoped query then throws rather than quietly reading tenant #1, which is
 * the only answer that cannot be silently wrong for somebody.
 *
 * It is also off until the registry has been read at all. Fail-closed is the default; the
 * single-tenant case has to be established, not assumed.
 */
/**
 * The id of the synthesised fallback tenant: not a real registry row, so anything that looks
 * a tenant up by id has to recognise it rather than query for it.
 */
export const SYNTHETIC_TENANT_ID = "default:unregistered";

function fallbackTenant(): TenantRef | null {
  const slug = defaultTenantSlug();
  if (!slug) return null;
  if (everMultiTenant || tenantCount === null || tenantCount > 1) return null;
  if (defaultRef && defaultRef.slug === slug) return defaultRef;
  return {
    id: SYNTHETIC_TENANT_ID,
    slug,
    name: slug,
    dataSchema: process.env.DEFAULT_TENANT_SCHEMA?.trim() || "public",
    dbRole: null,
    status: "active",
  };
}

/** The tenant of the current scope, or null outside one. Ignores the fallback. */
export function currentTenantOrNull(): TenantRef | null {
  return store.getStore()?.tenant ?? null;
}

/** The tenant of the current scope. Throws rather than guessing, unless the fallback is on. */
export function currentTenant(): TenantRef {
  const t = store.getStore()?.tenant ?? fallbackTenant();
  if (!t) {
    throw new Error(
      "No tenant context: every database query must run inside withTenant(). " +
        "If this is a background job, pass the tenant explicitly." +
        (everMultiTenant || (tenantCount ?? 0) > 1
          ? " This installation has more than one workspace, so there is no default to fall back to."
          : ""),
    );
  }
  return t;
}

/** True while the single-tenant fallback can still answer. */
export const tenantFallbackActive = () =>
  Boolean(defaultTenantSlug()) && !everMultiTenant && tenantCount === 1;

/** Runs `fn` with every query inside it bound to this tenant. */
export function withTenant<T>(tenant: TenantRef, fn: () => T): T {
  return store.run({ tenant }, fn);
}

/**
 * Binds the REST of the current async context to this tenant, without a callback.
 *
 * This is how a web request gets its tenant: the framework already runs each request in its
 * own async context, and `getCurrentUser()` — which every page, action and route calls before
 * it touches data — enters the tenant there. That keeps all 285 query call sites unchanged.
 *
 * Background work does NOT use this: a job or an agent run outlives its request, so it passes
 * its tenant explicitly through `withTenant`.
 */
export function enterTenant(tenant: TenantRef): void {
  store.enterWith({ tenant });
}

/** Closes a tenant's pool, e.g. after its role or schema changed. */
export async function forgetTenantPool(tenantId: string): Promise<void> {
  // A workspace may have more than one pool open — read-write and read-only — and a changed
  // role or password invalidates all of them.
  const doomed = [...pools.entries()].filter(([key]) => key.startsWith(`${tenantId}:`));
  for (const [key, p] of doomed) {
    pools.delete(key);
    await p.sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

/**
 * The application's database handle. Same export, same shape, same call sites — it now
 * resolves to the current tenant's pool.
 */
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop, receiver) {
    const real = poolFor(currentTenant()).db as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});

/**
 * The raw postgres-js client for the current tenant (the seed uses it for TRUNCATE).
 * `sql.end()` closes every tenant pool, matching the old single-pool behaviour.
 */
export const sql = new Proxy(function () {} as unknown as ReturnType<typeof postgres>, {
  apply(_t, _thisArg, args) {
    const real = poolFor(currentTenant()).sql as unknown as (...a: unknown[]) => unknown;
    return real(...(args as unknown[]));
  },
  get(_t, prop, receiver) {
    if (prop === "end") {
      return async (opts?: { timeout?: number }) => {
        const all = [...pools.values(), ...(ownerPool ? [ownerPool] : [])];
        pools.clear();
        ownerPool = null;
        await Promise.all(all.map((p) => (p as { end?: (o?: unknown) => Promise<unknown> }).end?.(opts) ?? Promise.resolve()));
      };
    }
    const real = poolFor(currentTenant()).sql as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});

/* -------------------------------------------------------------------------- */
/* The owner connection: migrations, provisioning and the control plane.       */
/* It is never used for tenant data.                                          */
/* -------------------------------------------------------------------------- */

let ownerPool: ReturnType<typeof postgres> | null = null;

/** Drops the cached owner connection. Used when a process re-points at another database. */
export async function forgetOwnerPool(): Promise<void> {
  const pool = ownerPool;
  ownerPool = null;
  ownerDrizzle = null;
  if (pool) await pool.end({ timeout: 5 }).catch(() => undefined);
}

/** Raw owner client. Used for DDL, provisioning and reading `platform`. */
/** The database a connection string names, for comparing two of them. */
function databaseOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, "");
  } catch {
    return url;
  }
}

/**
 * The owner connection: the control plane, and anything that has to act outside one tenant.
 *
 * MIGRATE_DATABASE_URL may name a different ROLE from DATABASE_URL — a migration user with the
 * rights an application user must not have — but never a different DATABASE. If it did, the
 * registry would be read from one database while tenant data was read from another, and a test
 * pointed at a throwaway database would register its workspace in the real one. That is not a
 * configuration anybody wants, so it is refused rather than obeyed.
 */
export function ownerSql(): ReturnType<typeof postgres> {
  if (!ownerPool) {
    const migrateUrl = process.env.MIGRATE_DATABASE_URL;
    const url = migrateUrl ?? baseUrl;
    const appUrl = process.env.DATABASE_URL ?? baseUrl;
    if (migrateUrl && databaseOf(migrateUrl) !== databaseOf(appUrl)) {
      throw new Error(
        `MIGRATE_DATABASE_URL names database "${databaseOf(migrateUrl)}" while DATABASE_URL names "${databaseOf(appUrl)}". ` +
          "They must be the same database; only the role may differ.",
      );
    }
    ownerPool = postgres(url, {
      max: Number(process.env.DB_OWNER_POOL_SIZE ?? 4),
      onnotice: () => {},
      connection: { search_path: `platform,public` },
      ...socketOptions,
    });
  }
  return ownerPool;
}

let ownerDrizzle: ReturnType<typeof drizzle> | null = null;
/** Drizzle bound to the control plane (`platform` schema). */
export function platformDb() {
  if (!ownerDrizzle) ownerDrizzle = drizzle(ownerSql(), {});
  return ownerDrizzle;
}

export { EMPTY_SCHEMA };
export type DB = ReturnType<typeof drizzle<typeof schema>>;

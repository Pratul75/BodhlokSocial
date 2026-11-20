/**
 * The control plane: one shared `platform` schema beside the tenants' own schemas.
 * Nothing here is tenant data; every row is about tenants rather than inside one.
 *
 * Tenant data keeps living in its own schema (tenant #1 in `public`), untouched.
 */
import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, numeric, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const platform = pgSchema("platform");

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const TENANT_STATUSES = ["provisioning", "active", "suspended", "archived"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const OPERATOR_ROLES = ["owner", "support", "billing"] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

export const ENTITLEMENT_KINDS = ["module", "feature", "capacity"] as const;
export type EntitlementKind = (typeof ENTITLEMENT_KINDS)[number];

/** One row per client. `dataSchema` is where its 39 tables live; tenant #1 is `public`. */
export const tenants = platform.table(
  "tenants",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** The Postgres schema holding this tenant's tables. Validated, never built from a request. */
    dataSchema: text("data_schema").notNull(),
    /** The database role this tenant's pool connects as. Null until the role is provisioned. */
    dbRole: text("db_role"),
    /** That role's password, readable only by the owner connection (tenant roles cannot see `platform`). */
    dbRoleSecret: text("db_role_secret"),
    status: text("status").notNull().default("provisioning"),
    /** Preset applied at creation, e.g. "full". Entitlements are the truth; this is a label. */
    plan: text("plan").notNull().default("full"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tenants_slug_uq").on(t.slug), uniqueIndex("tenants_schema_uq").on(t.dataSchema)],
);

/**
 * Platform operators are a separate principal from tenant users: their own table, their own
 * session audience. No tenant's `users` table ever holds one, so a tenant admin cannot become one.
 */
export const platformOperators = platform.table(
  "platform_operators",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull().default("support"),
    active: boolean("active").notNull().default(true),
    /** Raised on sign-out and when access is removed; older session cookies stop working. */
    sessionVersion: integer("session_version").notNull().default(0),
    /** scrypt, as "scrypt\$<salt>\$<key>". Null until an owner issues a reset link and it is used. */
    passwordHash: text("password_hash"),
    passwordSetAt: timestamp("password_set_at", { withTimezone: true }),
    /** SHA-256 of the one-time reset token; the token itself is never stored. */
    resetTokenHash: text("reset_token_hash"),
    resetExpiresAt: timestamp("reset_expires_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("platform_operators_email_uq").on(t.email)],
);

/**
 * What a tenant may use. Written explicitly at provisioning (every module and feature on),
 * so an absent row is a bug rather than an implicit grant.
 */
export const entitlements = platform.table(
  "entitlements",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    /** module and feature rows. */
    enabled: boolean("enabled").notNull().default(true),
    /** capacity rows: the number. Null means "fall back to the server default". */
    value: numeric("value", { precision: 14, scale: 2 }),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("entitlements_pk").on(t.tenantId, t.kind, t.key)],
);

/**
 * The per-tenant values that are server environment variables in the single-tenant app.
 * A missing row falls back to that environment variable, which is how tenant #1 keeps
 * behaving exactly as it does today.
 */
export const tenantSettings = platform.table(
  "tenant_settings",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value"),
    /** True for values that must never be shown again once saved (tokens, shared secrets). */
    secret: boolean("secret").notNull().default(false),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tenant_settings_pk").on(t.tenantId, t.key)],
);

/**
 * Which tenants an email address belongs to. Lets sign-in find the tenant before it can look
 * a user up, and lets one person belong to several tenants. Written by the same code that
 * creates or deactivates a tenant user, so it never diverges from the tenant's own table.
 */
export const userDirectory = platform.table(
  "user_directory",
  {
    email: text("email").notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    active: boolean("active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_directory_pk").on(t.email, t.tenantId)],
);

/** Every platform action, including reads of a tenant's data. */
export const platformAudit = platform.table("platform_audit", {
  id: id(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target").notNull(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
});

/** A time-boxed support grant, visible to the tenant while it is active. */
export const impersonations = platform.table("impersonations", {
  id: id(),
  operatorId: uuid("operator_id")
    .notNull()
    .references(() => platformOperators.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  /** The tenant user being acted as, by id in that tenant's own schema. */
  userId: uuid("user_id").notNull(),
  userEmail: text("user_email").notNull(),
  reason: text("reason").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** A schema name this code is willing to create or connect to. Never taken from a request. */
export const SCHEMA_NAME_RE = /^[a-z][a-z0-9_]{1,62}$/;
/** Reserved slugs: they would shadow a route or a Postgres schema we rely on. */
export const RESERVED_SLUGS = new Set([
  "platform", "api", "signin", "about", "privacy", "terms", "public", "drizzle",
  "admin", "t", "_next", "static", "assets", "health", "postgres", "pg_catalog",
]);

/**
 * The short name a workspace is known by inside the machine: its schema (`t_zenith`), its
 * database roles, its secret names, and one day its subdomain.
 *
 * Nobody types it. It is worked out from the workspace's own name, because a name typed twice is
 * a name typed wrong once — this installation already carries an `acme` and an `aceme` from the
 * days when it was a field on a form, and a schema cannot be renamed afterwards.
 *
 * A name with nothing Latin in it (Devanagari, say) leaves nothing to build from, so it falls
 * back to a plain `workspace`, which the caller then makes unique.
 */
export function slugCandidate(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  // The schema name is `t_` + this, and the pattern wants a letter first.
  const started = /^[a-z]/.test(base) ? base : `w-${base}`.replace(/-+$/, "");
  const capped = started.slice(0, 39).replace(/-+$/, "");
  return capped.length >= 2 ? capped : "workspace";
}

export function schemaForSlug(slug: string): string {
  if (!/^[a-z][a-z0-9-]{1,38}$/.test(slug)) throw new Error(`Invalid tenant slug: ${slug}`);
  if (RESERVED_SLUGS.has(slug)) throw new Error(`Reserved tenant slug: ${slug}`);
  const name = `t_${slug.replace(/-/g, "_")}`;
  if (!SCHEMA_NAME_RE.test(name)) throw new Error(`Invalid schema name: ${name}`);
  return name;
}

/** The empty schema a connection with no tenant falls into, so such a query fails loudly. */
export const EMPTY_SCHEMA = "nothing_here";

export const platformSchemaSql = sql;

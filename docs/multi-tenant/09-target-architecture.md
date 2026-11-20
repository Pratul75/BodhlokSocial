# 9. Recommended multi-tenant architecture

This document compares the three isolation models against the numbers measured in
[3](03-database-schema.md) and [7](07-single-tenant-dependencies.md), and recommends one. The
comparison is the argument; the recommendation follows from it.

## 9.1 What the decision has to optimise

Your constraint is explicit: **the existing application must not break**. That makes the right
question not "which model is most elegant?" but **"which model touches the least of the working
system?"**

The measured surface of the working system:

| Quantity | Measured |
|---|---|
| Tables | 39 |
| Global unique constraints | 17 |
| Natural-key primary keys | 6 |
| Database call sites (non-test) | 285 in 67 files |
| Transaction call sites | 19 |
| Raw `sql` / `.execute()` sites | 54 in 16 files |
| Upserts resolving against a unique index | 31 |
| Server actions | 38 |
| API routes | 19 |
| Scheduled jobs | 22 |

## 9.2 The comparison

### Model A — `tenant_id` column in a shared schema

Add `tenant_id` to all 39 tables, re-key 17 uniques, change 6 primary keys, and add a tenant
predicate to all 285 call sites (including 54 raw-SQL sites and 30 upserts).

- **Changes to the existing data model:** 39 tables, 17 indexes, 6 primary keys, 1 composite
  foreign key, 1 dropped `CHECK`.
- **Changes to existing queries:** all 285, each a chance to miss one.
- **Risk profile:** a missed `SELECT` filter leaks; a missed `UPDATE`/`DELETE` filter destroys.
  Without RLS this is **fail-open**.
- **Per-tenant restore:** not possible from a `pg_dump`; needs purpose-built logical exports.
- **Super Admin cross-tenant queries:** trivial (`GROUP BY tenant_id`).
- **Connections:** one pool, as today.
- **Migrations:** one run, as today.
- **Scales to:** hundreds of tenants.

### Model B — schema per tenant in one database

One Postgres schema per tenant, each holding today's 39 tables **exactly as they are**. A separate
shared `platform` schema holds tenants, operators, entitlements and settings. `search_path` selects
the tenant.

- **Changes to the existing data model:** **none.** No column added, no unique re-keyed, no primary
  key changed, no `CHECK` dropped. `brand_kit` stays a singleton — correctly, because it now *is*
  one per tenant.
- **Changes to existing queries:** **none.** All 285 call sites, 54 raw-SQL sites and 30 upserts
  keep working verbatim — provided `db` resolves its tenant ambiently (§9.4). The one exception is
  eight values frozen at module load, which must become function calls
  ([6 §6.3](06-integrations.md#values-frozen-at-module-load)).
- **Risk profile:** the whole risk collapses into **one** mechanism — setting `search_path` for each
  unit of work. One place to get right, one place to test, instead of 285.
- **Per-tenant restore:** `pg_dump --schema=t_<tenant>` and restore just that schema. **Keeps
  today's remedy working.**
- **Super Admin cross-tenant queries:** no single SQL query spans tenants; the console aggregates
  per tenant in application code (N small queries). Fine for a dashboard, poor for analytics over
  hundreds of tenants.
- **Connections:** **one pool per tenant** (not one pool, as an earlier draft of this document said —
  the mechanism in §9.4 requires a pool per tenant so each can carry its own `search_path` and role).
  Idle pools release every connection, so the cost tracks *active* tenants.
- **Migrations:** one run per schema, **and the committed migrations cannot be replayed as they
  stand** — they create cross-tenant foreign keys (§9.5). Provisioning needs a de-qualified DDL path.
- **Isolation enforcement:** role grants per tenant. `search_path` alone is a default, not a
  boundary.
- **Scales to:** tens of tenants comfortably; migration time and catalogue size grow linearly.

### Model C — database per tenant

- **Changes to the existing data model:** none.
- **Changes to existing queries:** none.
- **Risk profile:** strongest isolation; a bug cannot cross a database boundary.
- **Per-tenant restore:** the best of the three — exactly today's backup script, per tenant.
- **Super Admin cross-tenant queries:** impossible in SQL; every roll-up is N round trips to N
  databases.
- **Connections:** **N pools.** With `DB_POOL_SIZE=10` (`packages/db/src/client.ts:12`), ten tenants
  is 100 connections per process, before the worker's own. This is the binding constraint.
- **Migrations:** N runs, N failure modes, N things to monitor.
- **Scales to:** a handful of tenants, or many with a connection proxy (PgBouncer) and real
  operational investment.

### The comparison, side by side

| | A: `tenant_id` + RLS | **B: schema per tenant** | C: database per tenant |
|---|---|---|---|
| Tables changed | 39 | **0** | 0 |
| Uniques re-keyed | 17 | **0** | 0 |
| Primary keys changed | 6 | **0** | 0 |
| Query call sites to edit | 285 | **0** | 0 |
| Upserts to revisit | 30 | **0** | 0 |
| Places tenancy can be got wrong | 285 + policies | **1 mechanism plus its boundaries — fail-closed when one is missed** | 1 (the connection string) |
| Failure mode if the mechanism breaks | fail-open without RLS; fail-closed with it | **fail-closed, if configured as below** | fail-closed |
| Per-tenant restore | purpose-built | **`pg_dump -n`** | whole-database dump |
| Connection pools | 1 | **N (per active tenant, idle-released)** | N (per tenant, always on) |
| Migration runs per deploy | 1 | **N (one loop)** | N (N processes) |
| New provisioning DDL path needed | no | **yes (§9.5)** — the committed migrations would create 17 cross-tenant FKs | **no** — a fresh database replays the committed migrations unchanged, as CI already does |
| Isolation enforced by | RLS policies | schema + **role grants** | separate database + credentials |
| Cross-tenant SQL for Super Admin | native | per-tenant aggregation | per-tenant aggregation |
| Comfortable ceiling | hundreds | **tens** | handful |

## 9.3 Recommendation

**Model B — schema per tenant in one database, with a shared `platform` schema for the control
plane — conditional on you expecting tens of tenants rather than hundreds.**

The reasoning is the table above, and specifically:

1. **It touches none of the working application.** Your primary constraint is preservation. Model B
   is the only option that requires **zero** changes to the 39-table schema, the 17 unique
   constraints, the 6 natural primary keys, the 30 upserts and the 285 query call sites. Every risk
   in [8](08-risk-assessment.md) numbered R1, R2, R5, R8 and R23 — five of the eight most severe —
   **does not exist** in this model.
2. **Today's database becomes tenant #1 with nothing moved.** Keep Bodhlok's data in the existing
   `public` schema and register it as the first tenant. No backfill, no `UPDATE` over live rows, no
   primary-key surgery on a production database. The riskiest single step of Model A disappears.
3. **It keeps per-tenant backup and restore**, so the remedy in `docs/operations.md:49-62` survives
   ([8](08-risk-assessment.md), R21).
4. **It concentrates the risk into one mechanism** that can be tested exhaustively, rather than
   spreading it over 285 call sites that cannot be.

### What still discriminates B from C, after the spike

The spike removed two of B's advantages: it needs a pool per tenant (as C does), and it needs a
de-qualified DDL path (which C does not — a fresh database replays the committed migrations
unchanged). What remains:

**For B (schema per tenant):** one database to back up, monitor and tune; the `platform` schema sits
beside the tenants so Super Admin's own queries are ordinary SQL; `pg_dump --schema=` still gives
per-tenant restore; and adding a tenant is a `CREATE SCHEMA`, not a new database to provision.

**For C (database per tenant):** the committed migrations replay with no transformation, so R25
disappears; isolation is a connection string rather than a grant; and a client who demands physical
separation gets it.

**The recommendation stands with B** for tens of tenants, because operating one database and
co-locating the control plane outweighs C's cleaner migrations — but it is now a closer call, and if
provisioning proves troublesome in Phase 3, **C is a smaller retreat than it looked**: the
application code is identical either way.

**Switch to Model A if** you expect more than roughly fifty tenants, or you need cross-tenant
analytics in SQL.

**This is why [00](00-index.md)'s "expected tenant count" question blocks Phase 0.** It is the one
input that changes the answer.

## 9.4 How `db` gets its tenant — the mechanism, as proven

> **This section was rewritten on 19 Nov 2026 after the W0.4 spike.** The design it previously
> specified — a reserved connection with a session-level `SET search_path` — **was falsified**. The
> evidence is in [21 §21.3](21-phase0-verification.md#213-withtenant-does-not-exist-yet--and-the-design-on-paper-was-wrong);
> the summary is that `db.transaction()` cannot work on a postgres-js reserved connection, which
> breaks all 19 existing transaction sites, and that constructing it at all needs private driver
> internals.

### The mechanism

**One connection pool per tenant, each pool connecting as that tenant's own database role, with
`search_path` fixed when the connection opens.** `AsyncLocalStorage` carries the tenant's Drizzle
instance to call sites that are not changed.

```ts
// packages/db/src/client.ts — the only file that changes
const poolFor = (tenant) => postgres(DATABASE_URL_FOR(tenant), {   // tenant's own role
  max: 2, idle_timeout: 30,
  connection: { search_path: schemaFor(tenant) },                  // set once, at connect time
});
export const db = /* Proxy resolving to poolFor(currentTenant()) */;
export function withTenant<T>(tenant, fn: () => T): T { /* AsyncLocalStorage */ }
```

Three properties, each measured:

1. **`search_path` is set once, when the connection opens** — not per statement or per scope. There
   is no `SET` to leak into the next request, so the "stale `search_path`" failure mode
   ([8](08-risk-assessment.md), R24) does not arise.
2. **Drizzle gets an ordinary pool**, so transactions, prepared statements and all 285 call sites
   behave exactly as today. Proven: the repository's **294 tests, 7 typecheck tasks and 26 Playwright
   tests all pass** with only `client.ts` replaced, and `rebuildFunnel` — raw SQL plus a transaction —
   stays inside its tenant.
3. **The role is the boundary, not the `search_path`.** `search_path` scopes *unqualified* names
   only; a schema-qualified query crosses tenants freely, which the spike demonstrated. A role
   granted only its own schema refuses that read. **Both are required.**

### Why the role matters (the correction that cost the most to find)

```
the t_two pool read public.users and saw 5 rows          <- search_path alone: NOT isolation
role granted only t_two: qualified cross-tenant read DENIED   <- with a role: isolation
```

So provisioning creates, per tenant: a schema, a role, grants on that schema only, and
`ALTER ROLE … SET search_path` to an empty schema as the fail-closed default.

### The five contexts

| Context | Where the tenant comes from | Status |
|---|---|---|
| **RSC page render** | `getCurrentUser()` → the session's `tid`, cross-checked against host or path | **works** — 26/26 e2e, including the app shell's own queries in a child component |
| **Server action** | re-resolved from the session, never from form data | **works** |
| **Route handler** | session, or the **secret/token** for `/api/events/*` and `/api/feed/*` | **works** |
| **Worker job loop** | the job enumerates tenants | one scope per tenant, per-tenant `try/catch` |
| **Detached agent run** | passed **explicitly** through `queueRun`/`runAgent`/every tool | ambient context does survive a detached promise, but explicit passing is still the rule for work that outlives a request |

**Two contexts need the scope re-established, and both exist in the code today:**

- **`after()`** — `apps/web/app/(app)/approvals/actions.ts:136`. The request's ambient tenant does
  **not** reach it; measured. Work scheduled there must open its own scope.
- **Async generators** — `/api/chat` builds one and advances it inside a stream's `pull`
  (`apps/web/app/api/chat/route.ts:28-44`). The context is lost across `next()`; it must capture the
  tenant's `db` or re-enter the scope.

### Module-load constants

Eight exported constants read `process.env` once at import and cannot become per-tenant without
being turned into functions ([6 §6.3](06-integrations.md#values-frozen-at-module-load)). This is the
one place where "no call site changes" is untrue.

### The cost

Connections scale with **concurrently active** tenants: 3 pools × `max` 3 = 9 while busy, **0** after
5 seconds idle with `idle_timeout=2`. The budget is `active tenants × per-tenant max × instances`;
at `max` 2, 5 busy tenants and 6 Cloud Run instances that is **60** connections
([21 §21.3](21-phase0-verification.md#the-cost-measured)). A connection pooler is the usual remedy,
but whether transaction-level pooling preserves a connection-level `search_path` is **untested** and
must not be assumed.

## 9.5 Per-tenant migration is not "run the migrations unedited"

Two facts, both now demonstrated rather than inferred
([21 §21.3a](21-phase0-verification.md#213a-the-migration-finding--the-most-consequential-result)):

**1. The migrations hard-code the `public` schema.** 18 `REFERENCES "public"."…"` clauses across
`0000_init.sql`, `0001_tracking.sql` and `0012_audit_additive.sql` (e.g.
`packages/db/migrations/0012_audit_additive.sql:52`). Running them into another schema — **including
through Drizzle's own `migrate()` with `migrationsSchema` set** — produced **17 foreign keys
pointing at `public`**, so tenant 2's `approvals` referenced tenant 1's `users`. It did not error:
39 tables and correct bookkeeping, with the damage visible only in `pg_constraint`.

**2. Bookkeeping must be per tenant, and tenant #1 must keep the shared table.** `migrate()` with
`migrationsSchema` does create a per-schema table (verified: 14 rows in `t_three`, shared table
untouched). But tenant #1 is `public` and already uses `drizzle.__drizzle_migrations`, which the live
checks read (`scripts/vm/predeploy-check.sql:6`) — changing it would make the migrator see an empty
history and try to replay `0000` against the live database.

So provisioning must:

- apply **de-qualified** DDL — the same 14 migrations with `"public".` stripped produce 39 tables,
  **zero** escaping foreign keys, and a schema **structurally identical** to `public` (642 structural
  lines, zero diff);
- **create and baseline** a bookkeeping table for the new schema (a hand-applied schema has none, so
  the next deploy would try to replay everything);
- **assert** afterwards with a `pg_constraint` query that no foreign key leaves the tenant's schema —
  acceptance criterion 3.1a in [19](19-acceptance-criteria.md);
- leave the committed migrations **unedited** (CI regenerates them and other environments have
  applied them), and refuse any new migration containing `"public".`.

## 9.6 Spike status: six of eight criteria pass

Run on 19 Nov 2026. Full detail and output in
[21 §21.3](21-phase0-verification.md#the-eight-criteria-from-doc-9-96-each-with-its-status).

| # | Criterion | Status |
|---|---|---|
| 1 | Unmodified queries return only that tenant's rows | **pass** |
| 2 | Fail-closed when no tenant is set | **pass** |
| 3 | 50 interleaved scopes never mix rows | **pass** |
| 4 | Context survives RSC children, `after()`, streaming | **partial** — RSC children and streams yes; **`after()` and async generators no** |
| 5 | The 19 transaction sites work inside a scope | **pass** |
| 6 | Migrator into a named schema matches `public` | **pass only with de-qualified DDL** (§9.5) |
| 7 | Pool behaviour; no connection held across an await | **pass** |
| 8 | The whole existing suite passes with the helper in place | **pass** — 294 tests, 7 typecheck tasks, 26 e2e |

Still unproven, and carried into Phase 2: **per-request tenant resolution** in Next (the spike ran
one tenant chosen by environment variable), a **connection pooler** preserving connection-level
`search_path`, and **role-per-tenant provisioning** at scale.

## 9.7 The two planes

```
platform schema (shared, one copy)
  tenants              id, slug, name, status, created_at, data_schema
  platform_operators   the Super Admin principals — never in tenant users
  platform_sessions    operator sessions, separate JWT audience
  entitlements         per-tenant module and feature switches        [12]
  tenant_settings      the 27 per-tenant config values               [7 §7.4]
  tenant_secret_refs   per-tenant secret names                       [13]
  platform_audit       every Super Admin action, including support access
  impersonations       time-boxed support grants, visible to the tenant   [10]

t_<tenant> schema (one per tenant, today's 39 tables, unchanged)
  users, connections, calendar_items, approvals, agent_runs, … brand_kit (correctly one row)
```

Tenant #1 is the existing `public` schema. Nothing about it moves.

## 9.8 What stays exactly as it is

Stated explicitly, because it is the point of choosing this model:

- All 39 tables, their columns, constraints, indexes and the `brand_kit` singleton `CHECK`.
- All 14 migrations, unreplayed and unedited — they stay the history of the `public` schema, and new
  tenants are created from generated current-schema DDL instead (§9.5).
- All 285 query call sites, 54 raw-SQL sites and 30 upserts.
- `funnel_daily`'s rebuild SQL (`packages/db/src/funnel.ts`) — the largest raw query in the project.
- The five roles, `MODULES`, `canAccess`, `APPROVERS`, and every `requireModule` call.
- Every guardrail and its 43 tests.
- The 22 scheduled jobs' names, paths and times, so `pnpm check:schedules` keeps passing.
- All three registered webhook URLs and the OAuth redirect URIs.
- The deploy, backup, pre/post-deploy-check and rollback scripts, extended rather than replaced.

## 9.9 What is new

| Piece | Where | Doc |
|---|---|---|
| `platform` schema and its tables | `packages/db` (a second Drizzle schema) | this doc |
| `withTenant` and tenant resolution | `packages/db`, `apps/web/lib/auth.ts` | this doc |
| Tenant provisioning (lifted from `migrate.ts`) | `packages/db` | [14](14-data-migration.md) |
| Super Admin console | a route group in `apps/web`, separate session | [10](10-super-admin.md) |
| Entitlement checks | `packages/shared` + one `requireFeature` helper | [12](12-entitlements.md) |
| Per-tenant secret naming and token caches | `packages/integrations` | [13](13-tenant-isolation.md) |
| Per-tenant job iteration | `apps/worker/src/app.ts` | [13](13-tenant-isolation.md) |
| Tenant-scoped webhook and feed entry points | `apps/web/app/api` | [13](13-tenant-isolation.md) |

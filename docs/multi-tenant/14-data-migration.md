# 14. Existing data migration strategy

How today's live data becomes tenant #1. Under the recommended model
([9](09-target-architecture.md)) the answer is unusually short, and that is the main argument for
the model.

## 14.1 The headline: the data does not move

Bodhlok's data stays in the `public` schema of the existing database. It is **registered** as
tenant #1 rather than migrated into it.

```sql
-- in the platform schema, not in public
INSERT INTO platform.tenants (slug, name, data_schema, status)
VALUES ('bodhlok', 'Bodhlok', 'public', 'active');
```

What this avoids, compared with a `tenant_id` column (Model A):

| Model A would need | Model B needs |
|---|---|
| `ALTER TABLE ... ADD COLUMN tenant_id` × 39 | nothing |
| Backfill every row in 39 tables, including the largest (`conversion_events`, `ad_spend_daily`, the four `ga4_*`) | nothing |
| `SET NOT NULL` × 39 after the backfill | nothing |
| Drop and recreate 17 unique indexes | nothing |
| Drop and recreate 6 primary keys and 1 composite foreign key | nothing |
| Drop `brand_kit`'s `CHECK (id = 1)` | nothing |
| Revisit 30 upsert conflict targets | nothing |

**Risks R2 and R8 in [8](08-risk-assessment.md) — the two that could damage live data — are
eliminated rather than mitigated.**

## 14.2 What is actually created

Additive, in the `platform` schema only. Nothing in `public` is read for writing, altered or
dropped.

```
CREATE SCHEMA platform;
  platform.tenants, platform_operators, platform_sessions,
           entitlements, tenant_settings, tenant_secret_refs,
           platform_audit, impersonations
INSERT the Bodhlok tenant row (data_schema = 'public')
INSERT entitlements: every module and feature ON, capacities NULL (fall back to env)
INSERT tenant_settings: empty (every value falls back to its environment variable)
CREATE ROLE bodh_app with default search_path pointing at an empty schema
GRANT usage on public and platform to bodh_app
```

The one change outside `platform` is the **database role** the application connects as, which is a
configuration change (`DATABASE_URL`), not a schema change. It can be rehearsed and reverted by
changing one connection string back.

## 14.3 Order of operations for the first deploy

Each step is independently reversible until step 6.

| Step | Action | Reversible by |
|---|---|---|
| 1 | Take a backup and verify it restores into a scratch database | n/a (read-only) |
| 2 | Run the read-only pre-deploy checks (extended, §14.6) | n/a |
| 3 | `CREATE SCHEMA platform` and its tables, from a **second** migrations folder and drizzle config of its own — not the per-tenant folder, or the platform tables would be created inside every tenant schema | `DROP SCHEMA platform CASCADE` |
| 4 | Seed the Bodhlok tenant row, entitlements and empty settings | delete those rows |
| 5 | Deploy application code in which **tenant resolution always returns tenant #1** | redeploy the previous release |
| 6 | Switch the application to per-tenant roles with the fail-closed `search_path` default, **keeping a separate owner URL for migrations, the seed and backups** (§14.3a) | switch it back |
| 7 | Run the post-deploy checks and the e2e smoke suite against live | n/a |

### 14.3a The restricted role needs more than a connection string

Three existing scripts run SQL with the **same** `DATABASE_URL` the application uses, and all three
would break under a restricted role:

| Script | How it connects | Consequence |
|---|---|---|
| `scripts/vm/install.sh:95-98` | runs `migrate.ts` as user `bodh` with every line of `bodh.env`, so with `DATABASE_URL` | **migrations would run as the restricted role** and fail to create or alter anything |
| `scripts/vm/backup.sh` | `sed -n 's/^DATABASE_URL=//p'` from the same file | `pg_dump` would silently dump nothing it cannot read |
| `apps/worker/src/seed.ts` | the same pool | `TRUNCATE` would be denied |

(`scripts/prod-check.sh` is unaffected: it connects as the `postgres` superuser over SSH and forces
`default_transaction_read_only=on`.)

So the role switch is three changes, not one:

1. Add a second variable — `MIGRATE_DATABASE_URL` (owner role) — and use it in `migrate.ts`,
   `seed.ts` and `backup.sh`, leaving `DATABASE_URL` for the application.
2. Grant the restricted role what it actually needs: `USAGE` on each tenant schema **and**
   `SELECT, INSERT, UPDATE, DELETE` on all its tables and `USAGE` on its sequences. `GRANT USAGE`
   on the schema alone gives permission-denied on every query.
3. `ALTER DEFAULT PRIVILEGES IN SCHEMA <tenant> GRANT … TO bodh_app` so tables created by a future
   migration are reachable without a manual grant — otherwise the next release's new table is
   invisible to the application until someone remembers.

Steps 3–5 are safe because the new code reads the same `public` tables through the same queries. The
only behavioural difference after step 5 is that queries now run inside `withTenant` — which is why
step 6 is separate: it is the step that proves fail-closed behaviour, and the one with a one-line
rollback.

## 14.4 Provisioning tenant #2

Tenant #2 is the real test of the model, and it touches tenant #1 not at all.

```
provisionTenant({ slug: 'acme', ... })        [10 §10.3]
  CREATE SCHEMA t_acme
  apply the generated current-schema DDL      (NOT a replay of the 14 migrations — see below)
  create t_acme's own migration bookkeeping, marked up to date
  seed connections / budgets(₹0) / brand_kit  (today's migrate.ts code)
  entitlements all ON, settings from the plan
  first admin user
```

**Why not replay the 14 migrations.** Two facts in the repository forbid it, both checked
([9 §9.5](09-target-architecture.md#95-per-tenant-migration-is-not-run-the-migrations-unedited)):

1. **18 foreign keys name the schema explicitly** — `REFERENCES "public"."agent_runs"` and the like,
   in `0000_init.sql`, `0001_tracking.sql` and `0012_audit_additive.sql` (for example
   `packages/db/migrations/0012_audit_additive.sql:52`). Replayed into `t_acme` they would point at
   **tenant #1's rows**. `search_path` does not help, because the schema is named.
2. **Bookkeeping is one shared table.** Drizzle records applied migrations in
   `drizzle.__drizzle_migrations`, which the live checks read directly
   (`scripts/vm/predeploy-check.sql:6`). A naive loop would see all 14 as applied and create
   nothing.

**Tested, and it is worse than it reads:** using Drizzle's own `migrate()` with `migrationsSchema`
set — the approach this document previously proposed — produced 39 tables, correct bookkeeping, and
**17 foreign keys pointing at `public`**, silently
([21 §21.3a](21-phase0-verification.md#213a-the-migration-finding--the-most-consequential-result)).

So: generate one current-schema DDL file from `schema.ts` (unqualified), apply it under the tenant's
`search_path`, and give each **new** tenant schema its own bookkeeping table, baselined as up to
date. Tenant #1 keeps the shared bookkeeping exactly as it is. Then **assert** with a
`pg_constraint` query that no foreign key leaves the schema — the de-qualified route was verified to
produce a schema structurally identical to `public` (642 structural lines, zero diff) with zero
escaping keys.

**Do not edit the committed migrations.** CI regenerates them from `schema.ts` and fails on a diff
(`.github/workflows/ci.yml`), and other environments have already applied them. The migrator decides
what to apply from `packages/db/migrations/meta/_journal.json`'s `when` timestamps against the
recorded rows and also stores a hash per migration; **whether an edited file would be re-applied or
would merely mismatch its stored hash was not verified by this audit**, and confirming it — along
with how a baselined row is written — is a Phase 0 spike item.

Before tenant #2 goes live, three things must be true, and each has a test
([19](19-acceptance-criteria.md)):

1. Every page renders for a tenant with **no data at all** — never exercised today, because the only
   empty database the project has seen is immediately seeded
   ([11 §11.6](11-tenant-admin.md#116-first-run-experience-for-a-new-tenant)).
2. Both tenants' agents can run at the same time.
3. Tenant #2's webhooks and feeds resolve to tenant #2, and tenant #1's legacy URLs still resolve to
   tenant #1.

## 14.5 Migrations after this point

`migrate.ts` becomes a loop:

```
# Tenant #1 is 'public' and KEEPS the existing shared bookkeeping in drizzle.__drizzle_migrations,
# which the live checks read (scripts/vm/predeploy-check.sql:6). Changing it would make the
# migrator see an empty history and try to replay 0000 against the live database.
migrate(db, { migrationsFolder })                      # tenant #1: exactly as today, unchanged

# Only NEW tenants get their own schema and their own bookkeeping.
for each tenant where data_schema <> 'public':
    applyTenantDdl(tenant.data_schema)                 # generated current-schema DDL
    markUpToDate(tenant.data_schema)                   # its own bookkeeping, baselined
```

Properties to preserve:

- **Idempotent**, as it is today (`packages/db/src/migrate.ts:16-44`).
- **Resumable**: a failure at tenant 7 of 12 must leave tenants 1–6 migrated and be safe to re-run.
  This requires the per-tenant bookkeeping described above — it is **not** automatic, because
  Drizzle's default bookkeeping is a single shared `drizzle.__drizzle_migrations` table.
- **Observable**: the deploy must report which tenants migrated, and fail the deploy if any did not.
  A silently half-migrated platform is the worst outcome here.
- **CI still checks drift**: the workflow's `drizzle-kit generate` check
  (`.github/workflows/ci.yml`) is unaffected for the existing tables, because their definitions do
  not change. Two checks are added: the generated tenant DDL must match `schema.ts`, and no
  migration from `0014` onwards may contain `"public".`.

The deploy's migration step becomes the longest part of a release, growing linearly with tenants.
At tens of tenants that is minutes; this is the practical ceiling named in
[9 §9.2](09-target-architecture.md#92-the-comparison).

## 14.6 Extending the existing safety checks

The project already has the right tools; they need tenant awareness.

- **`scripts/vm/predeploy-check.sql`** — add: `platform` schema absent (first deploy) or present and
  consistent; no queued or running agent runs in any tenant schema; every tenant in
  `platform.tenants` has a schema that exists; every schema has the same applied-migration count.
- **`scripts/vm/postdeploy-check.sql`** — add: per-tenant row counts for the tables a release
  touched, so a problem in one tenant is not hidden behind healthy totals. Note while you are in
  there: its line 5 asserts `migrations applied (expect 13)` while the repository holds **14**
  migrations (`0000`–`0013`), so that assertion is one release stale and should be fixed or made
  dynamic
  ([7 §7.11](07-single-tenant-dependencies.md#711-tenant-blind-destructive-and-operational-tooling)).
- **`scripts/vm/backup.sh`** — keep the whole-database dump, and add a per-tenant
  `pg_dump --schema=<schema>` so a single tenant can be restored without touching the others
  ([8](08-risk-assessment.md), R21). This is the step that keeps today's recovery promise.
- **`apps/worker/src/seed.ts` and `scripts/vm/remove-sample-data.sql`** — both `TRUNCATE` whole
  tables (`apps/worker/src/seed.ts:51`, `scripts/vm/remove-sample-data.sql:19`). Scoped to one
  schema they become safe; until they are, they must not be run on a multi-tenant database. Add a
  refusal when more than one tenant exists and no tenant is named.

## 14.7 Verifying the live schema first

This audit did not see the live database, and git history shows live and repo have diverged before
([8](08-risk-assessment.md), R9). Before step 3 of §14.3:

1. Dump the live schema (`pg_dump --schema-only`) and diff it against a database built from
   `packages/db/migrations` on a scratch instance.
2. Compare `drizzle.__drizzle_migrations` against the 14 files in the repository.
3. Treat any difference as a blocker and resolve it as a normal change **before** starting the
   tenancy work, not during it.

This is cheap, read-only, and it is the single highest-value hour of the whole project.

## 14.8 If Model A is chosen instead

Should the tenant count argue for `tenant_id` + RLS ([9 §9.3](09-target-architecture.md#93-recommendation)),
the migration strategy changes completely and must be written out in full before any code. The
outline, for comparison:

1. Add nullable `tenant_id` with `DEFAULT '<tenant-1-uuid>'` to all 39 tables (fast: no table
   rewrite, since Postgres 11 stores the default in the catalogue).
2. Backfill in **batches** (`UPDATE ... WHERE tenant_id IS NULL LIMIT n`), never one long
   transaction. Size the batches against real row counts, which are unknown to this audit.
3. `SET NOT NULL` per table, after verifying zero nulls.
4. Add the new composite uniques **alongside** the old ones.
5. Deploy code that writes `tenant_id` everywhere and still reads unscoped.
6. Deploy code that reads scoped.
7. Only then, in a **separate** release, drop the old uniques and primary keys and the `brand_kit`
   `CHECK` — the irreversible step, deliberately last and alone.
8. Enable RLS with `FORCE ROW LEVEL SECURITY`, after proving the whole suite passes with it on.

Steps 7 and 8 cannot be undone by rolling the application back, which is the fundamental reason
Model B is recommended.

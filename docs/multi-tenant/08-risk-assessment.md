# 8. Multi-tenant transformation risk assessment

Risks are rated for **impact on the live application** (the stated non-negotiable), not on the
project schedule. "Likelihood" assumes the work is done competently but without the specific
mitigation named.

**Which risks apply depends on the isolation model** ([9](09-target-architecture.md)). The
**Model** column reads: **A** = shared schema with a `tenant_id` column; **B** = schema per tenant
(recommended); **both** = either. Five of the severe risks below — R1, R2, R5, R8 and R23 — exist
only under Model A, which is the main argument for Model B. Model B introduces three of its own:
**R24, R25 and R26**.

| Risk | Model |
|---|---|
| R1 missed filter, R2 primary-key migration, R5 global run index, R8 backfill damage, R10 RLS breakage, R23 upsert target | **A only** |
| R3 token cache, R4 webhooks, R6 job partial failure, R7 detached runs, R9 live drift, R11–R22 | **both** |
| R24 stale `search_path`, R25 provisioning DDL, R26 ambient context loss | **B only** |

## 8.1 Critical risks

### R1 — A missed filter leaks or corrupts data across tenants
**Likelihood: high. Impact: severe (and possibly unrecoverable in reputation).**
285 query call sites must all be scoped. One missed `WHERE tenant_id = ...` in a `SELECT` shows one
client another's data; one missed filter in an `UPDATE` or `DELETE` destroys it.
**Mitigation:** do not rely on reviewing 285 sites. Make the database the enforcement floor with
**Row-Level Security**, so an unscoped query returns zero rows instead of everyone's rows
([9](09-target-architecture.md), [13](13-tenant-isolation.md)). Add a test that fails if any table
lacks RLS, and a two-tenant fixture that asserts every page and job sees only its own rows.

### R2 — Primary-key migrations on the six natural-key tables fail or cannot be rolled back
**Likelihood: medium. Impact: severe (deploy-time outage).**
`connections`, `budgets`, `publishing_channels`, `brand_kit`, `billing_accounts`, `payments` need
their primary key changed, and `brand_kit` needs a `CHECK` dropped. A failed migration mid-deploy
leaves the schema between two states, and rolling the application back does not undo a dropped
constraint.
**Mitigation:** copy the `0012_audit_additive` pattern exactly — additive first (add nullable
`tenant_id`, backfill, add the new composite unique *alongside* the old key), and only drop the old
primary key in a **later, separate** deploy once the new code is live and proven. Take a backup
immediately before, and run read-only pre-deploy checks as `scripts/vm/predeploy-check.sql` does.

### R3 — An OAuth token cache serves one tenant's credential to another
**Likelihood: high if unaddressed. Impact: severe (posting or spending on the wrong account).**
`packages/integrations/src/google-oauth.ts:90` caches tokens keyed by integration name only; `packages/integrations/src/reddit.ts:60` caches a single
token with no key.
**Mitigation:** change both to be keyed by `(tenantId, integration)` in the **same** change that
introduces per-tenant credentials, never later. Add a unit test with two tenants asserting two
distinct tokens.

### R4 — Webhooks and feeds stop working for the existing client
**Likelihood: medium. Impact: severe (silent data loss).**
`/api/events/bodh`, `/api/events/crm-billing`, `/api/events/crm-leads` are registered inside systems
Recharge Studio does not control. If their behaviour changes — a new required path segment, a
different secret, a tenant header — events are rejected and the funnel quietly goes wrong.
**Mitigation:** treat those three paths as **frozen**. New tenants get new paths or a tenant-scoped
secret; the old paths resolve to the default tenant forever. Add route tests that post a legacy
signed payload with no tenant information and assert it lands on tenant #1.

### R5 — The global one-active-run index blocks tenants
**Likelihood: certain if unaddressed. Impact: high (a client's agents simply stop).**
`agent_runs_one_active_idx` is global (`packages/db/src/schema.ts:78`).
**Mitigation:** re-key to `(tenant_id, agent)` in the same migration that adds the column; cover it
with a test that starts the same agent for two tenants at once.

## 8.2 High risks

### R6 — A scheduled job fails for one tenant and skips the rest
**Likelihood: high. Impact: high.** A loop over tenants that lets an exception escape stops every
later tenant, and today's jobs are written to throw so the scheduler retries
(`apps/worker/src/app.ts:208`).
**Mitigation:** per-tenant try/catch with a `pipeline_runs` row per tenant, an aggregate status, and
a digest that reports per tenant. Retries must be per tenant, not whole-job.

### R7 — Fire-and-forget agent runs lose their tenant
**Likelihood: medium. Impact: high (an agent writes to the wrong tenant).** `void
agents.runAgent(...)` (`apps/worker/src/app.ts:381`) outlives the request, so any implicit request-scoped context is
gone by the time it runs.
**Mitigation:** pass `tenantId` explicitly as an argument through `queueRun`, `runAgent` and every
tool. Never use an ambient/async-local tenant for background work. If RLS is used, the run must open
its own connection and set its tenant before the first query.

### R8 — The existing client's data is damaged during backfill
**Likelihood: low. Impact: severe.** Backfilling `tenant_id` on live tables touches every row.
**Mitigation:** `DEFAULT '<default tenant uuid>'` plus `UPDATE` in batches, never a bare
`UPDATE ... SET tenant_id = ...` on large tables inside a long transaction. `conversion_events`,
`ad_spend_daily` and the `ga4_*` tables are the only plausibly large ones — size them on the live
database first (row counts are unknown to this audit). Take a backup, run the backfill, verify
counts, then add `NOT NULL`.

### R9 — Live schema drift makes the migration behave differently than in testing
**Likelihood: medium. Impact: high.** This audit could not see the live database, and git history
shows live and repo have diverged before (`45f796f`, `b2400b2`).
**Mitigation:** before any tenancy migration, run a read-only comparison of the live schema against
`packages/db/migrations` and against the applied-migration table, exactly as
`scripts/vm/predeploy-check.sql` does for its own change. Treat any difference as a blocker.

### R10 — RLS breaks existing queries or the migration/seed paths
**Likelihood: medium. Impact: high (the whole app fails to read anything).**
RLS applies to the table owner only when `FORCE ROW LEVEL SECURITY` is set, and migrations, the seed
and the funnel rebuild must be able to work across tenants.
**Mitigation:** run the application as a non-owner role with RLS policies; keep migrations and
maintenance on the owner role, which bypasses RLS by default. Stage RLS behind a setting so it can
be enabled per environment, and prove the whole test suite passes with it on before production.

### R21 — "Restore from backup" stops being a per-tenant remedy
**Likelihood: certain in a shared database. Impact: high.**
`scripts/vm/backup.sh` dumps the whole database, and restore repoints `DATABASE_URL`
(`docs/operations.md:49-62`). With several tenants in one database, restoring to recover tenant A
rolls back every other tenant to last night.
**Mitigation:** decide this explicitly before tenant #2 arrives. Either add per-tenant logical
exports (`pg_dump` filtered by `tenant_id`, or a per-tenant export job) plus a tested row-level
restore path, or keep tenants in separate databases
([9](09-target-architecture.md)). Whichever is chosen, say so in the client contract and record the
drill date in `docs/operations.md` as the runbook already asks.

### R22 — Tenant-blind destructive tooling is run against a shared database
**Likelihood: medium. Impact: severe.**
`apps/worker/src/seed.ts:51` and `scripts/vm/remove-sample-data.sql:19` `TRUNCATE` whole tables. The
seed guard asks about the *database* and `NODE_ENV`, not about a tenant
(`apps/worker/src/seed-guard.ts`), so neither tool can be made safe by the existing checks.
**Mitigation:** make both tenant-scoped (`DELETE ... WHERE tenant_id = $1`) in the same phase that
adds the column, and add a guard that refuses to run when the database holds more than one tenant
unless a tenant is named. Until then, never run either on a multi-tenant database.

### R23 — An upsert's conflict target no longer matches its re-keyed index
**Likelihood: high. Impact: high (runtime failures in jobs, not at build time).**
30 `onConflict*` sites resolve against specific unique indexes
([3](03-database-schema.md#36-risks-specific-to-the-schema)). Re-keying an index without updating
its upsert produces a runtime error — or, worse, a successful insert that should have been an
update, duplicating rows.
**Mitigation:** change each constraint and its upserts in one commit; the database tests
(`*.db.test.ts`) exercise several of these paths and should be extended to cover each target.

### R24 — A leaked `search_path` serves another tenant's data (Model B) — **downgraded by the spike**
**Likelihood: low with the chosen mechanism. Impact: severe if it occurred.**
The concern was that a session-level `SET search_path` persists on a pooled connection and is
inherited by the next, unrelated query. **The mechanism chosen after the spike removes this**: each
tenant has its own pool whose `search_path` is fixed by `connection: { search_path }` when the
connection opens, so no statement ever sets it and there is nothing to leak
([9 §9.4](09-target-architecture.md#94-how-db-gets-its-tenant--the-mechanism-as-proven)).
**What replaces it, and is real:** `search_path` scopes **unqualified** names only. The spike showed
a tenant's pool reading `public.users` successfully when the query named the schema. **Mitigation:**
a database **role per tenant**, granted only its own schema — verified to deny the qualified read —
plus the empty-schema role default so a pool with no `search_path` fails loudly.

### R25 — Tenant provisioning creates cross-tenant foreign keys (Model B) — **CONFIRMED by test**
**Likelihood: certain, including via Drizzle's own migrator. Impact: severe, and silent.**
**This was reproduced.** `migrate()` with `migrationsSchema` set produced 39 tables, correct
bookkeeping — and **17 foreign keys pointing at `public`**, so the new tenant's `approvals`
referenced tenant 1's `users`. No error, no warning
([21 §21.3a](21-phase0-verification.md#213a-the-migration-finding--the-most-consequential-result)).
The de-qualified DDL mitigation was also tested and produces a schema structurally identical to
`public` with zero escaping keys.
18 foreign keys in the committed migrations name the schema explicitly
(`REFERENCES "public"."agent_runs"`, e.g.
`packages/db/migrations/0012_audit_additive.sql:52`). Replaying them into `t_acme` makes tenant B's
rows reference **tenant #1's**. Separately, Drizzle's bookkeeping is one shared table
(`scripts/vm/predeploy-check.sql:6`), so a naive loop creates nothing at all for tenant #2.
**Mitigation:** provision from generated current-schema DDL with per-tenant bookkeeping for **new**
tenants only — tenant #1 keeps the existing shared bookkeeping, or the migrator would see an empty
history and try to replay `0000` against the live database. Never edit the committed migrations (CI
regenerates them and other environments have applied them). CI refuses any new migration containing
`"public".`, and a post-provision check compares the new schema with `public`'s via
`pg_dump --schema-only`, asserting no foreign key in it references `public`. See
[9 §9.5](09-target-architecture.md#95-per-tenant-migration-is-not-run-the-migrations-unedited).

### R26 — The ambient tenant context is lost in a callback — **narrowed to two confirmed cases**
**Likelihood: certain in those two places. Impact: high if unaddressed.**
Measured ([21 §21.3](21-phase0-verification.md#criterion-4-in-detail-where-the-ambient-context-survives-and-where-it-does-not)).
The context **does** survive RSC child components (`apps/web/components/app-shell.tsx:12-24`),
detached promises, timers and a stream's `pull`. It **does not** survive:
- **`after()`** — `apps/web/app/(app)/approvals/actions.ts:136` ran with the wrong tenant;
- **async generators** — `/api/chat` advances one inside a stream
  (`apps/web/app/api/chat/route.ts:28-44`) and the context is gone across `next()`.
**Mitigation:** both must open their own scope explicitly. With the fail-closed role they throw
rather than read the wrong tenant, so the failure is loud — but they must be fixed, not relied on to
throw.

## 8.3 Medium risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R11 | Secret re-keying orphans live credentials | Low | High | Never rename existing secrets; resolve the default tenant to the legacy `integration-<key>` name |
| R12 | Existing storage paths stop resolving | Low | Medium | Prefix new paths only; `assets.storage_path` keeps absolute truth |
| R13 | Sessions issued before the change are rejected | Medium | Medium | Treat a missing `tid` claim as the default tenant for at least 7 days (the cookie lifetime) |
| R14 | Entitlement checks are added to pages but not actions or jobs | Medium | High | One `requireFeature` helper used by pages, actions, agents and jobs; a test enumerating all four surfaces |
| R15 | Super Admin becomes a sixth role and leaks into tenant UI | Medium | High | Keep platform operators in a separate table with their own session audience, never in `users.role` |
| R16 | Shared Postiz or AI budget lets one tenant starve another | High | Medium | Per-tenant capacity entitlements and per-tenant ledgers |
| R17 | Per-tenant verification fan-out hits provider rate limits | Medium | Medium | Stagger `ops/alerts` per tenant; respect provider quotas |
| R18 | The dev-mode single user becomes meaningless with tenants | High | Low | `DEV_USER_EMAIL` resolves within the default tenant; keep the production ban untouched |
| R19 | `pnpm check:schedules` fails once jobs become per tenant | Medium | Low | Keep the job list identical; iterate tenants *inside* the job, not by adding timers |
| R20 | The CI schema-drift check fails on hand-edited migrations | Medium | Low | Regenerate, hand-edit for safety, then re-run `drizzle-kit generate` to confirm no diff remains |

## 8.4 Risks that are product decisions, not engineering risks

- **A new tenant gets an astrology marketing system.** Prompts, skills, SEO templates, the panchang
  feed and the funnel's stage names are Bodhlok-specific
  ([7](07-single-tenant-dependencies.md#710-the-product-is-bodhlok-shaped)). Selling to a
  non-astrology client without addressing this means the agents produce wrong work on day one.
- **One person in two tenants** is impossible while `users.email` is globally unique. Agencies will
  want it.
- **Super Admin support access** is a promise to clients. Reading a tenant's data and impersonating
  a tenant user are different promises ([10](10-super-admin.md)).

## 8.5 What makes this project safer than it looks

Worth stating, because it shapes the plan:

1. **The approval gates are re-checked at every stage** — post rules at draft, approval and publish;
   ad caps at proposal and again at approval (`apps/web/app/(app)/approvals/actions.ts:45-80`). A tenancy bug that
   slips through one layer still meets another.
2. **₹0 default spend caps** mean a misconfigured new tenant cannot spend money
   (`packages/db/src/migrate.ts:25`).
3. **`migrate.ts` is already an idempotent per-installation bootstrap** — exactly the shape a
   `provisionTenant()` function needs (`packages/db/src/migrate.ts:16-44`).
4. **The four `ga4_*` tables already key on `property_id`**, so they are nearly partitioned already.
5. **`funnel_daily` is derived** and can be rebuilt rather than migrated.
6. **No page or server-side data caching to leak across tenants**: all 22 application pages are
   `force-dynamic`, and there is no `unstable_cache`, `"use cache"` or `revalidate` anywhere. The
   three responses that do set `Cache-Control` are all `private` or `no-store`, so no shared cache
   or CDN can hold one tenant's content
   ([7](07-single-tenant-dependencies.md#713-caching-a-small-surface-and-no-shared-cache-leak)).
7. **Real operational discipline exists**: nightly backups, pre/post-deploy SQL checks, a documented
   rollback, CI schema-drift detection, nightly credential verification. The transformation should
   use these rather than invent new ones.

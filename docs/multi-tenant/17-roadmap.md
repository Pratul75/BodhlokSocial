# 17. Implementation roadmap

Seven phases. Every phase ships on its own, leaves the live application behaving exactly as it does
today, and can be rolled back by redeploying the previous release. Nothing in Phase 0 writes code.

Estimates are engineering effort for one experienced developer who knows this codebase, excluding
your review time. They are ranges because two unknowns remain: the Phase 0 spike result and the
live-schema check.

## Phase 0 — Decide and prove (no application code)

**Blocked on your answers to decisions 1, 2, 3 and 4 in [00](00-index.md).**

| Work package | Output |
|---|---|
| W0.1 | ~~Install dependencies, run the full suite, record the real green baseline~~ — **done 19 Nov 2026: green, 294 unit + 26 e2e ([20](20-baseline-run.md))** |
| W0.2 | **Live schema check**: diff the live schema and applied migrations against the repository ([14 §14.7](14-data-migration.md#147-verifying-the-live-schema-first)). Any drift is resolved as ordinary work before tenancy begins |
| W0.3 | Row counts for the large tables, so backfill sizing is known if Model A is chosen |
| W0.4 | **The `withTenant` spike** against all 7 pass criteria ([9 §9.5](09-target-architecture.md#96-spike-status-six-of-eight-criteria-pass)), on a throwaway branch |
| W0.5 | Confirm the isolation model and the URL model in writing, given the spike and your tenant-count answer |

**Exit:** a green baseline (**done**), a verified live schema (**outstanding — W0.2**), a passed
spike (**done, with the design corrected**), and a decided model.

Criterion 4 came back **partial**: `after()` and async generators lose the ambient tenant, so those
two call sites need explicit scopes. That is a known, bounded piece of Phase 2 work, not a reason to
re-plan.

**Effort: 3–5 days.** Do not compress this. It is the phase that prevents the expensive mistakes.

## Phase 1 — The safety net (no tenancy code)

| Work package | Output |
|---|---|
| **W1.0** | **One line in `turbo.json` so the `test` task passes `DATABASE_URL` through, and a check that `pnpm test` reports zero skipped against a non-default database. First, because every later test needs a purpose-made database** ([20 §20.2](20-baseline-run.md#202-finding-pnpm-test-silently-ignores-a-database_url-override)) |
| W1.1 | Contract tests: three webhooks, four feed routes ([16](16-regression-testing.md), Group 1) |
| W1.2 | Authorization matrix test: 5 roles × 16 modules, 5 roles × 6 approval kinds |
| W1.3 | Approval-flow database test, including the ad-cap re-check at approval |
| W1.4 | Funnel rebuild test |
| W1.5 | Playwright run against a migrated-but-unseeded database; fix what it finds |
| W1.6 | Structural tests ([16](16-regression-testing.md), Group 4) |
| W1.7 | Per-tenant `pg_dump --schema=` added to `scripts/vm/backup.sh`; restore drill performed and the date recorded in `docs/operations.md` |
| W1.8 | **Dependency housekeeping, as its own commit**: `hono` ≥ 4.13.16, `@hono/node-server` ≥ 2.1.6, `next` ≥ 16.4.5, `fast-xml-parser` ≥ 5.12.0 — all within existing semver ranges, so lockfile-only. None is exploitable today ([21 §21.2](21-phase0-verification.md#212-the-seven-hono-advisories-none-exploitable-here)); gate on the worker's 23 tests and the 30-path bypass test |

**Exit:** the behaviours that must not change are pinned by tests, and single-tenant restore is
proven.

**Effort: 1–1.5 weeks.** W1.5 may uncover real empty-state bugs; that is a finding, not a delay.

**This phase is worth doing even if multi-tenancy is cancelled.**

## Phase 2 — The control plane (invisible to Bodhlok)

| Work package | Output |
|---|---|
| W2.1 | `platform` schema and its tables, from a **second migrations folder and drizzle config** of its own, applied once rather than per tenant ([14 §14.2](14-data-migration.md#142-what-is-actually-created)) |
| W2.2 | `withTenant` in `packages/db`: **a pool per tenant** with `connection: { search_path }`, **a role per tenant** granted only its own schema, and the empty-schema default ([9 §9.4](09-target-architecture.md#94-how-db-gets-its-tenant--the-mechanism-as-proven)) |
| W2.3 | Tenant resolution in `getCurrentUser`: `tid` claim, host/path override, default-tenant fallback with its gate ([15 §15.4](15-backward-compatibility.md#the-fallback-must-be-removed-before-tenant-2)) |
| W2.4 | Register Bodhlok as tenant #1 against the existing `public` schema |
| W2.5 | Wrap all 22 pages, 38 actions and 19 routes in `withTenant` — mechanical, no query changes. **Load-bearing**: without it, 22 of 26 e2e tests fail once the default-tenant fallback is off. Includes the two contexts that lose the ambient tenant: the `after()` block in `approvals/actions.ts:136` and `/api/chat`'s async generator |
| W2.6 | `tenant_settings` with environment-variable fallback for the 27 values, **including turning the eight module-load constants into functions** ([6 §6.3](06-integrations.md#values-frozen-at-module-load)) |
| W2.7 | Per-tenant secret naming, with the legacy name for tenant #1 |
| W2.8 | Fix the two token caches to be tenant-keyed ([13 §13.6](13-tenant-isolation.md#136-in-process-caches)) |
| W2.9 | Tenant id on every log line |
| W2.10 | The restricted role: a separate `MIGRATE_DATABASE_URL` for `migrate.ts`, `seed.ts` and `backup.sh`, plus table grants and `ALTER DEFAULT PRIVILEGES` ([14 §14.3a](14-data-migration.md#143a-the-restricted-role-needs-more-than-a-connection-string)) |

**Exit:** the live application runs entirely through `withTenant`, with one tenant, and behaves
identically. Deploy in the order at [14 §14.3](14-data-migration.md#143-order-of-operations-for-the-first-deploy),
with the role switch (step 6) as its own change.

**Effort: 2–3 weeks.** W2.5 is the bulk — repetitive, reviewable, low-risk individually.

## Phase 3 — Provisioning and the Super Admin console

| Work package | Output |
|---|---|
| W3.1 | `provisionTenant()`, lifted from `migrate.ts`, idempotent and resumable ([10 §10.3](10-super-admin.md#103-creating-a-tenant)) |
| W3.1a | **The provisioning DDL path**: a generated current-schema DDL file (unqualified), per-tenant migration bookkeeping, a CI check that it matches `schema.ts`, and a CI check refusing any new migration containing `"public".` ([9 §9.5](09-target-architecture.md#95-per-tenant-migration-is-not-run-the-migrations-unedited)) |
| W3.2 | `migrate.ts` loops over tenants with per-tenant bookkeeping, reporting per tenant and failing the deploy on any failure |
| W3.3 | Platform operators, their session (separate JWT audience) and `/super-admin` route-group guards |
| W3.4 | Console: tenant list, create, suspend, resume; tenant detail |
| W3.5 | Console: per-tenant settings (secrets write-only), tenant users, first-admin bootstrap |
| W3.6 | `platform_audit` on every platform action, reads included |
| W3.7 | Extended pre/post-deploy checks ([14 §14.6](14-data-migration.md#146-extending-the-existing-safety-checks)) |

**Exit:** a tenant can be created from the console; Bodhlok is unaffected. Still **one** live tenant.

**Effort: 2–3 weeks.**

## Phase 4 — Entitlements

| Work package | Output |
|---|---|
| W4.1 | `platform.entitlements`, with every module and feature written on at provisioning |
| W4.2 | `requireFeature` / `featureEnabled`, cached per tenant with the tenant in the key |
| W4.3 | Module gating on all five surfaces: pages, sidebar, actions, agents, jobs ([12 §12.4](12-entitlements.md#124-enforcement--all-five-surfaces-not-just-pages)) |
| W4.4 | The 14 feature flags and 6 capacity limits, with environment fallbacks ([12 §12.5](12-entitlements.md#125-the-feature-list)) |
| W4.5 | Console: entitlement and capacity editing; plans as presets |
| W4.6 | Graceful degradation behaviour ([12 §12.8](12-entitlements.md#128-degrading-gracefully-not-breaking)) |
| W4.7 | Tenant Admin's read-only view of its entitlements ([11](11-tenant-admin.md)) |

**Exit:** modules and features can be switched per tenant with no deploy. Bodhlok has everything on
and is unchanged — proven by the Phase 1 authorization matrix test still passing.

**Effort: 2 weeks.**

## Phase 5 — Multi-tenant entry points and jobs

The phase that actually makes a second tenant workable.

| Work package | Output |
|---|---|
| W5.1 | Per-tenant webhook entry points; the three legacy paths frozen to tenant #1 ([13 §13.4](13-tenant-isolation.md#134-webhooks-and-feeds--the-entry-points-with-no-user)) |
| W5.2 | Per-tenant feed tokens; the legacy token still reads tenant #1 |
| W5.3 | All 22 jobs iterate tenants with per-tenant error isolation and per-tenant `pipeline_runs` |
| W5.4 | Agent runs take an explicit tenant through `queueRun`, `runAgent` and every tool |
| W5.5 | Per-tenant AI, creative and Postiz capacity accounting |
| W5.6 | Per-tenant digest; the console's health roll-up |
| W5.7 | `seed.ts` and `remove-sample-data.sql` scoped to one tenant, refusing to run unscoped on a multi-tenant database |
| W5.8 | The full Group 3 tenancy test set; CI runs with two tenants |

**Exit:** two tenants can run side by side. **Do not switch off the default-tenant fallback until
this phase's tests pass.**

**Effort: 2–3 weeks.**

## Phase 6 — The second tenant, for real

| Work package | Output |
|---|---|
| W6.1 | Provision a pilot tenant and run it internally for a fortnight |
| W6.2 | Switch off the default-tenant fallback (at least 7 days after `tid` shipped, so no live session lacks it) |
| W6.3 | Watch pool usage, migration duration and job runtime against the Phase 0 baseline |
| W6.4 | Support access: impersonation if you want it, with the tenant-visible banner and the approval prohibition ([10 §10.5](10-super-admin.md#105-support-access-into-a-tenant)) |
| W6.5 | Per-tenant de-branding: the sidebar's hard-coded "BODH Growth / Bodhlok marketing" (`apps/web/components/app-shell.tsx:34-35`) reads the tenant's name |

**Exit:** a second tenant in production, and Bodhlok demonstrably unchanged.

**Effort: 1–2 weeks plus the pilot period.**

## Phase 7 — Product work for non-astrology tenants (only if needed)

**Scoped separately, because it is a product workstream, not isolation work.** Needed only if
tenants are not astrology brands ([00](00-index.md), decision 2).

| Work package | Output |
|---|---|
| W7.1 | Agent prompts take the tenant's industry, audience and product from the brand kit instead of prose (`packages/agents/src/prompts.ts:6-21`) |
| W7.2 | Per-tenant skills, replacing the five bundled Bodhlok ones |
| W7.3 | Per-tenant SEO page templates, replacing `planet_house`/`nakshatra`/`yoga`/`lagna`/`panchang_city` (`packages/integrations/src/seo-catalog.ts:10`) |
| W7.4 | Configurable funnel stage names, replacing registration → activation → paid |
| W7.5 | The panchang feed becomes an optional, astrology-only feature |
| W7.6 | Full white-labelling: per-tenant product name, company, logo and theme (`apps/web/lib/legal.ts:6-8` already reads these from the environment) |

**Effort: 4–8 weeks, and genuinely uncertain** until the target market is decided. It can be
reduced greatly by restricting early tenants to adjacent brands.

## Summary

| Phase | Effort | Live risk | Gate to the next phase |
|---|---|---|---|
| 0 Decide and prove | 3–5 days | **none** (read-only) | Spike passes; model decided |
| 1 Safety net | 1–1.5 wk | **none** (tests only) | Baseline green; restore drill done |
| 2 Control plane | 2–3 wk | low | Bodhlok identical through `withTenant` |
| 3 Provisioning + console | 2–3 wk | low | A tenant can be created |
| 4 Entitlements | 2 wk | low | Matrix test unchanged for Bodhlok |
| 5 Entry points + jobs | 2–3 wk | medium | All Group 3 tests pass with two tenants |
| 6 Second tenant | 1–2 wk + pilot | medium | Fallback off; Bodhlok unchanged |
| 7 De-branding | 4–8 wk | low | Only if non-astrology tenants |

**Phases 0–6: roughly 10–14 weeks.** Phase 7 depends entirely on decision 2.

Two scheduling notes:

- **Phases 0 and 1 carry no risk to the live application at all** and are worth starting whatever
  you decide about the rest.
- **The live-schema check (W0.2) should happen this week**, independently of everything else. If the
  live database has drifted from the repository, every later estimate changes, and it is an hour of
  read-only work to find out.

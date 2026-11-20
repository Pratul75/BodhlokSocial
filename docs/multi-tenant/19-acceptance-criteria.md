# 19. Acceptance criteria

One section per phase in [17](17-roadmap.md). Each criterion is written so it can only be answered
yes or no. A phase is not done until every criterion is yes.

Two criteria apply to **every** phase, and are not repeated below:

- **G1.** The entire existing CI pipeline passes unchanged: schema-drift check, migrate, seed, lint,
  `check:schedules`, typecheck, all ~281 unit cases, build, all 24 Playwright tests.
- **G2.** The live application's observable behaviour is unchanged for Bodhlok: same pages, same
  sidebar, same redirects, same approval gates, same job schedule, same webhook and feed responses.

## Phase 0 — Decide and prove

| # | Criterion |
|---|---|
| 0.1 | ~~The full test suite has been run and the real baseline recorded~~ — **met: [20](20-baseline-run.md)**, green, 294 unit + 26 e2e, matching CI |
| 0.2 | The live schema and its applied-migration list have been diffed against the repository, and any drift is either resolved or documented with a decision |
| 0.3 | Row counts for `conversion_events`, `ad_spend_daily` and the four `ga4_*` tables are known and recorded |
| 0.4 | All **7** spike criteria in [9 §9.5](09-target-architecture.md#96-spike-status-six-of-eight-criteria-pass) pass — in particular: a query outside `withTenant` **throws**, and 50 interleaved two-tenant calls never mix rows |
| 0.5 | The isolation model and the URL model are decided in writing, with the tenant-count assumption stated |
| 0.6 | Decisions 1–4 in [00](00-index.md) are answered |

## Phase 1 — Safety net

| # | Criterion |
|---|---|
| 1.0 | `pnpm test` reports **zero skipped** tests against a database that is **not** on the default port 5433 — i.e. `DATABASE_URL` is honoured |
| 1.1 | A legacy signed payload to each of the three webhooks is accepted and produces the same stored rows — as a test, not a manual check |
| 1.2 | All four feed routes return the same shape for the same bearer token — as a test |
| 1.3 | The authorization matrix test covers all 5 roles × 16 modules and 5 roles × 6 approval kinds, and passes |
| 1.4 | The approval-flow database test covers: approve a post, reject without a note (refused), approve an item changed after sending (refused), approve an `ad_change` the caps now block (rejected, nothing applied) |
| 1.5 | The funnel rebuild test asserts `funnel_daily` rows from known inputs |
| 1.6 | Playwright passes against a **migrated-but-unseeded** database, and any empty-state bugs it found are fixed |
| 1.7 | The structural tests pass: every `page.tsx` calls `requireModule`; every action resolves a user before its first query |
| 1.8 | `scripts/vm/backup.sh` writes a per-tenant schema dump, **and** a restore of one schema into a scratch database has been performed and the date recorded in `docs/operations.md` |

## Phase 2 — Control plane

| # | Criterion |
|---|---|
| 2.1 | The `platform` schema exists; **no existing table, index, constraint or column was altered** — provable by diffing the schema before and after |
| 2.2 | Bodhlok is registered as tenant #1 with `data_schema = 'public'`, and **no row of its data was moved, rewritten or backfilled** |
| 2.3 | All 22 pages, 38 server actions and 19 API routes run their queries inside `withTenant` |
| 2.4 | With the fail-closed role active, a query outside `withTenant` throws, and a test asserts it. Also: a schema-qualified read of another tenant is **denied by privileges** |
| 2.4a | `app-shell.tsx`, `agent-run-panel.tsx`, the `after()` block in `approvals/actions.ts:136` and `/api/chat`'s async generator all run their queries inside a tenant scope — one test each. The last two are **known** to lose the ambient context, so they need explicit scopes |
| 2.4c | The e2e suite passes with the default-tenant fallback **off**, proving every entry point establishes a tenant (it is 22-of-26 failing without the wrapping) |
| 2.4b | The eight module-load constants are functions, and each reads the tenant's value with the environment variable as fallback |
| 2.5 | A session cookie issued **before** this release still works, without re-signing in |
| 2.6 | All 27 per-tenant settings fall back to their environment variables, and Bodhlok reads the same values as before — asserted per setting |
| 2.7 | Integration secrets still resolve under their legacy `integration-<key>` names; **no secret was renamed or re-versioned** |
| 2.8 | The Google and Reddit token caches are keyed by tenant, with a two-tenant test asserting two distinct tokens |
| 2.9 | Every log line carries a tenant id |
| 2.10 | Rolling back to the previous release and switching `DATABASE_URL` back has been **tested on a copy**, not just reasoned about |

## Phase 3 — Provisioning and Super Admin

| # | Criterion |
|---|---|
| 3.1 | `provisionTenant()` creates a schema, applies the generated current-schema DDL, seeds a connections row per catalogue integration, ₹0 caps for both platforms, the `brand_kit` row and a first admin |
| 3.1a | The new tenant's schema is **identical** to `public`'s, compared with `pg_dump --schema-only`, and **no foreign key in it references `public`** — asserted by a query over `pg_constraint` |
| 3.1b | Each tenant schema has its own migration bookkeeping; a second tenant provisioned after a new migration lands gets that migration |
| 3.1c | CI refuses a new migration containing `"public".`, and asserts the generated tenant DDL matches `schema.ts` |
| 3.2 | Running `provisionTenant()` twice for the same slug is a no-op, and a provision interrupted midway completes correctly on re-run |
| 3.3 | A new tenant's ad spend caps are **₹0**, so it cannot spend money |
| 3.4 | `migrate.ts` migrates every tenant, reports per tenant, and **fails the deploy** if any tenant did not migrate |
| 3.5 | A platform session is refused everywhere in the tenant app; a tenant session is refused everywhere under `/super-admin` — both asserted |
| 3.6 | No platform operator exists in any tenant's `users` table |
| 3.7 | Every console action, **including reads of tenant data**, writes `platform_audit` |
| 3.8 | A tenant slug cannot be `platform`, `api`, `signin`, `about`, `privacy`, `terms` or `_next`, and cannot contain characters outside `[a-z0-9-]` |
| 3.9 | Deleting a tenant is refused unless a logical export exists, and requires typed confirmation |

## Phase 4 — Entitlements

| # | Criterion |
|---|---|
| 4.1 | Provisioning writes an explicit entitlement row for **every** module and feature, all enabled |
| 4.2 | Disabling a module for a tenant stops **all five** surfaces: the page redirects, the sidebar omits it, the action refuses, the agent will not start, the job records `skipped` — one test per surface |
| 4.3 | Bodhlok with everything enabled behaves identically: the Phase 1 authorization matrix test passes unchanged |
| 4.4 | A Super Admin entitlement change takes effect within 60 seconds, with no deploy or restart |
| 4.5 | All 6 capacity limits fall back to their environment variables; a capacity check that gates spending reads the live value, not a cached one |
| 4.6 | The entitlement cache includes the tenant in its key — asserted by a two-tenant test |
| 4.7 | Disabling a module destroys no data, and re-enabling restores the module intact |
| 4.8 | A pending approval of a now-disabled kind is visible with an explanation, not vanished |
| 4.9 | Tenant Admin can see its entitlements and cannot change them |

## Phase 5 — Entry points and jobs

| # | Criterion |
|---|---|
| 5.1 | The three legacy webhook paths still accept their legacy signed payloads and land on tenant #1 — the Phase 1 contract tests pass unchanged |
| 5.2 | A payload signed with tenant B's secret lands on tenant B and is invisible to tenant #1 |
| 5.3 | A payload matching no tenant is recorded and rejected, not silently dropped |
| 5.4 | Secret matching is constant-time; a timing test shows no difference between a matched and unmatched tenant |
| 5.5 | The legacy feed token reads tenant #1; a per-tenant token reads only that tenant |
| 5.6 | All 22 job names, paths and times are unchanged, and `pnpm check:schedules` passes |
| 5.7 | A job that throws for tenant 2 still processes tenants 3..N, and each tenant has its own `pipeline_runs` row |
| 5.8 | Two tenants' content agents run **concurrently**; neither blocks the other |
| 5.9 | An agent run carries its tenant explicitly through `queueRun`, `runAgent` and every tool, and holds no connection across an LLM call |
| 5.10 | Tenant A's AI spend does not count against tenant B's budget; the same for creative generations and Postiz throughput |
| 5.11 | `seed.ts` and `remove-sample-data.sql` affect one tenant only, and refuse to run on a multi-tenant database without a named tenant |
| 5.12 | All 8 isolation properties in [13 §13.11](13-tenant-isolation.md#1311-isolation-properties-to-prove-not-assume) pass as tests |
| 5.13 | **CI runs the whole suite with two tenants present** |

## Phase 6 — The second tenant

| # | Criterion |
|---|---|
| 6.1 | A pilot tenant has run for a fortnight with its own connections, agents, jobs and approvals |
| 6.2 | Every page renders correctly for the pilot tenant from its first, empty day |
| 6.3 | Bodhlok's behaviour over that fortnight is unchanged: no new failed jobs, no new failed publishes, the funnel matches, no new errors in the digest |
| 6.4 | The default-tenant fallback is **off**, at least 7 days after `tid` shipped; a request with no resolvable tenant is refused, and a test asserts it |
| 6.5 | `provisionTenant` refuses to create a second tenant while the fallback is on |
| 6.6 | Pool usage, migration duration and job runtime are measured against the Phase 0 baseline and are within budget |
| 6.7 | One tenant's data has been restored from its own schema dump without affecting the other |
| 6.8 | If impersonation is enabled: it is time-boxed, recorded in `platform.impersonations`, shown as a banner in the tenant's app, attributed in `audit_log` as `operator as user`, and **refused for approvals and for anything that spends money** |
| 6.9 | The sidebar shows the tenant's own name, not "BODH Growth / Bodhlok marketing" |

## Phase 7 — De-branding (only if needed)

| # | Criterion |
|---|---|
| 7.1 | Agent prompts contain no hard-coded brand, product, audience or parent company; all come from the tenant's brand kit |
| 7.2 | A tenant can have its own skills; the five Bodhlok skills belong to the Bodhlok tenant |
| 7.3 | SEO page templates are per tenant; the five astrology templates belong to the Bodhlok tenant |
| 7.4 | Funnel stage names are configurable per tenant |
| 7.5 | The panchang feed is an optional feature, off by default for a new tenant |
| 7.6 | Product name, company, contact, logo and theme are per tenant, and no Recharge Studio or Bodhlok string appears for another tenant — asserted by a grep-style structural test over the rendered pages |

## How to use this document

- Treat **G1 and G2** as the gate on every deploy, not just at phase boundaries.
- A criterion that cannot be tested automatically should be struck or rewritten until it can be —
  except the manual provider checks in `docs/integration-smoke-tests.md`, which stay manual by
  nature.
- **0.4, 2.4, 5.8 and 6.4 are the four that would most likely be skipped under schedule pressure,
  and they are the four that catch the failure modes this architecture is exposed to.** Do not
  trade them away.

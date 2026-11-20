# 16. Regression testing strategy

## 16.1 The baseline today

**The suite has now been run: it is green.** See [20](20-baseline-run.md) for the full result,
the command-by-command output and the deviations from CI. Headline: every step of the CI pipeline
passes — **294 unit tests and 26 Playwright tests, nothing failing**.

**One caveat on the 294.** `pnpm test` strips `DATABASE_URL` (Turbo's strict env mode, with no `env`
declared on the `test` task), so the six `*.db.test.ts` files fall back to a hardcoded
`localhost:5433`. In CI that is exactly CI's own Postgres, so all 294 run there — confirmed in CI's
log. Anywhere else, those **36 tests skip while the suite still reports success**. A two-tenant
fixture will not live on the default port, so fix this one line before the first tenancy test is
written ([20 §20.2](20-baseline-run.md#202-finding-pnpm-test-silently-ignores-a-database_url-override)).

The inventory below is kept because it maps the coverage; the counts are corrected from the run.

### What CI does on every push and PR

From `.github/workflows/ci.yml`, in order, against a Postgres 16 service:

1. `drizzle-kit generate` — **fails the build if the schema and migrations disagree**
2. `pnpm db:migrate` against an empty database, with a bootstrap admin
3. `pnpm db:seed` (sample data)
4. `pnpm lint` (ESLint, `--max-warnings=0`)
5. `pnpm check:schedules` — VM timers and `infra/scheduler.tf` must list the same jobs at the same
   times
6. `pnpm typecheck`
7. `pnpm test` (Vitest across all packages)
8. `pnpm --filter @bodh/web build`
9. Playwright end-to-end against the seeded database

### Unit and integration tests: 35 files, 294 cases

Counts from the run, not from grepping:

| Area | Files | Cases | Notes |
|---|---|---|---|
| Guardrails | 3 | 40 | Spend caps, auto-allow, losing-ad rule, post and community checks — the densest logic in the repo |
| Integrations | 20 | 170 | Postiz, CRM, GA4, DataForSEO, CMS, secrets, attribution, forwarding, Vertex, validate, publisher, ads |
| Agents | 3 | 21 | Run loop, skills, tools |
| Web | 6 | 36 | Auth, routes, server-action shape, compose, google, search-console |
| Worker | 2 | 23 | Route cases and seed-guard |
| Shared | 1 | 4 | Logging |

Six files are `*.db.test.ts` and run against a real Postgres when `DATABASE_URL` points at one:
`packages/agents/src/run.db.test.ts` and `packages/integrations/src/{ads,crm,ga4,publisher,verify-connections}.db.test.ts`. **These are the most valuable
files for this project**, because they are where two-tenant assertions belong.

### End-to-end: 26 Playwright tests

`apps/web/e2e/smoke.spec.ts`: 18 module pages each asserted to load with their heading and no error
page, plus 6 behavioural tests (add an idea and open it, open a run's step log, refuse a key for a
planned connection, two phone-viewport no-horizontal-scroll checks, GA4 analytics rendering). That
is 24 in the desktop project; the two `@phone` tests also run in the phone project, so a full run
reports **26**.

### Where coverage is thin

Honest assessment of what the suite does **not** cover, which is where tenancy bugs would hide:

| Gap | Why it matters here |
|---|---|
| **Server-action behaviour** — only their *shape* is tested (`apps/web/lib/server-actions.test.ts`), not what any of the 38 do | Every action needs a tenant scope; nothing would catch a wrong one |
| **Authorization matrix** — no test asserts role × module access | Entitlements intersect with this; a regression would be silent |
| **Page rendering against an empty database** — e2e always runs seeded | A new tenant *is* an empty database ([11 §11.6](11-tenant-admin.md#116-first-run-experience-for-a-new-tenant)) |
| **The approval flow end to end** — the re-check logic at `apps/web/app/(app)/approvals/actions.ts:45-80` is the heart of the product and has no test | Any change near it is unprotected |
| **The funnel rebuild** — `packages/db/src/funnel.ts` is the largest raw SQL in the project, with no direct test | Tenant scoping touches raw SQL |
| **Job orchestration** — worker routes are tested with fakes, not the real job bodies | Per-tenant iteration changes exactly this |
| **Cross-request state** — nothing exercises the OAuth token caches | This is the leak vector in [13 §13.6](13-tenant-isolation.md#136-in-process-caches) |

## 16.2 Build the safety net before the work, not after

Four groups, in this order. All of them are valuable whether or not multi-tenancy proceeds, which
makes them easy to justify.

### Group 0 — Make `DATABASE_URL` reach the tests (first, before anything)

One line in `turbo.json` so the `test` task passes `DATABASE_URL` through. Without it, every test
below that needs a purpose-made database will skip rather than fail, and the suite will still say
"passed".

### Group 1 — Contract tests (before any tenancy code)

The definition of "did not break the people who depend on us":

- A legacy signed `POST /api/events/bodh` body is accepted and produces the same stored events.
- Both CRM webhooks accept a legacy signed body.
- `GET /api/feed/pages`, `/api/feed/pages/[template]/[slug]`, `/api/feed/panchang` and
  `/api/feed/llms.txt` return the same shape for the same bearer token.
- `pnpm check:schedules` still passes (it already runs in CI).

`apps/web/app/api/routes.test.ts` already has the harness for the first three.

### Group 2 — Behaviour snapshots (before any tenancy code)

Lock in today's behaviour where it is currently untested:

- **The authorization matrix**: a table test over all 5 roles × 16 modules asserting
  `canAccess`, plus 5 roles × 6 approval kinds asserting `canApprove`. Cheap, and it becomes the
  baseline the entitlement intersection must not change for a fully-entitled tenant.
- **The approval flow**, as a `*.db.test.ts`: send a post for approval, approve it, assert the
  calendar item's state; reject without a note and assert the refusal; change the item after sending
  and assert "needs a fresh approval request"; approve an `ad_change` whose caps now block it and
  assert nothing was applied.
- **The funnel rebuild**: insert known spend, sessions, events and payments; rebuild; assert the
  `funnel_daily` rows. This also documents the derivation, which nothing currently does.
- **Every page renders empty**: a Playwright run against a migrated-but-unseeded database. Expect
  this to find real bugs on day one — that is the point.

### Group 3 — Tenancy tests (with the work)

The eight properties in [13 §13.11](13-tenant-isolation.md#1311-isolation-properties-to-prove-not-assume),
each as a test:

1. A query outside `withTenant` throws (fail-closed).
2. 50 interleaved `withTenant` calls across two tenants never mix rows.
3. Tenant A's session cannot read tenant B's rows, assets or secrets — per module.
4. Webhooks and feeds resolve to the right tenant; legacy ones to tenant #1.
5. Two tenants' Google tokens do not collide in the OAuth cache.
6. A job that throws for tenant 2 still processes tenants 3..N.
7. A disabled module stops the page, the action, the agent **and** the job.
8. A platform session is refused in the tenant app and vice versa.

Plus: both tenants' agents start concurrently (the property the global index would have broken).

### Group 4 — Structural tests

Cheap, high-leverage, and the repository already uses this technique
(`apps/web/lib/server-actions.test.ts` walks the file tree to prove a property):

- Every `page.tsx` under `app/(app)` calls `requireModule`.
- Every exported server action resolves a user before its first database call.
- No source file outside `packages/db` imports the raw `db` client without going through
  `withTenant` (once that helper exists).
- Every module key in `MODULES` has an entitlement row written by provisioning.

## 16.3 The two-tenant fixture

The single most important piece of test infrastructure. One helper that creates two fully
provisioned tenants in the test database, seeds each with distinguishable data, and returns a
session for a user in each. Every Group 3 test is then three lines.

The seven `*.db.test.ts` files already establish the pattern of testing against real Postgres, so
this slots into the existing setup rather than introducing a new one.

## 16.4 Running the suite per phase

| Phase | What must pass |
|---|---|
| Every phase | The whole existing CI pipeline, unchanged, plus Groups 1 and 2 |
| Phase 0 | The spike's 7 pass criteria ([9 §9.5](09-target-architecture.md#96-spike-status-six-of-eight-criteria-pass)) |
| Phase 1+ | Group 3 tests for the properties that phase introduces |
| Before tenant #2 | The entire Group 3 set, plus the empty-tenant Playwright run |

**CI must run the suite with two tenants present**, not one. A one-tenant CI run cannot catch the
bugs this project is exposed to — the global-index blocker, the token cache collision and the job
loop's partial failure are all invisible with a single tenant.

## 16.5 Manual verification that stays manual

Some things cannot be automated and are already documented:

- `docs/integration-smoke-tests.md` — live checks against each provider.
- The spend-cap discipline: caps stay at ₹0 until the Meta and Google rows in that document pass
  (`docs/operations.md:87`).
- A restore drill. The runbook asks for one quarterly and records that it has **not yet been done**
  (`docs/operations.md:49-62`). Do it before tenant #2, because per-tenant restore is the thing
  multi-tenancy puts at risk ([8](08-risk-assessment.md), R21).

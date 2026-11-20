# 20. Phase 0 W0.1 — the real test baseline

Run on **2026-11-19** against commit `c9ee294` (clean tree). This replaces the read-only inventory in
[16 §16.1](16-regression-testing.md#161-the-baseline-today), which was compiled from the test files
rather than from a run.

Nothing in the repository was changed to get this result. The only files created were `.env`
(gitignored) and `node_modules`.

## 20.1 Result: everything passes

The full CI pipeline, in CI's order:

| # | Step | Result | Notes |
|---|---|---|---|
| 1 | Migrations match the schema (`drizzle-kit generate`) | **PASS** | "No schema changes, nothing to migrate"; no file written |
| 2 | `pnpm db:migrate` on an empty database | **PASS** | 14 migrations applied, **39 tables** created, bootstrap admin created |
| 3 | `pnpm db:seed` | **PASS** | 29,442 events, 491 ad-days, 330 session-days, 440 funnel rows |
| 4 | `pnpm lint` | **PASS** | eslint `--max-warnings=0`, exit 0 |
| 5 | `pnpm check:schedules` | **PASS** | "Schedules match: **22 jobs**" |
| 6 | `pnpm typecheck` | **PASS** | 7 packages, 25.6s |
| 7 | `pnpm test` | **PASS** | 258 passed, 36 skipped — see §20.2; all 36 pass when the database is reachable, giving **294** |
| 8 | `pnpm --filter @bodh/web build` | **PASS** | Next 16.4.2 production build |
| 9 | Playwright e2e | **PASS** | **26 passed** in 28.5s, 0 failed |

**This is a green baseline.** No test failed anywhere.

Three of the audit's counts are now independently confirmed against a real database and a real run:
**14 migrations**, **39 tables**, **22 scheduled jobs**.

## 20.2 Finding: `pnpm test` silently ignores a `DATABASE_URL` override

**Correction to an earlier draft of this document.** It claimed the 36 database tests never run in
CI. **That was wrong, and CI's own log disproves it.** The real defect is narrower, and still worth
fixing.

### What CI actually does

The last CI run on `main` (run `42037263981`, 5 Nov 2026) reports, package by package:
4 + 40 + 36 + 23 + 21 + 170 = **294 tests passed, zero skipped**, including `@bodh/integrations` at
20 files / 170 tests and `@bodh/agents` at 3 files / 21 tests. So **the database tests do run in
CI**, and always have.

### Why they ran there and skipped here

Each database test resolves its connection as:

```ts
const base = process.env.DATABASE_URL ?? "postgres://bodh:bodh@localhost:5433/bodh";
```

— identical in all six files (`packages/integrations/src/ads.db.test.ts:13`, `crm.db.test.ts:13`,
`ga4.db.test.ts:13`, `publisher.db.test.ts:12`, `verify-connections.db.test.ts:12`,
`packages/agents/src/run.db.test.ts:10`), then skips the suite when a `select 1` fails.

Turbo **does** strip `DATABASE_URL` — `turbo run test --dry=json` reports `envMode: strict` with the
`test` task declaring `env: []` and no `passThroughEnv`. But in CI that does not matter: the
hardcoded fallback `postgres://bodh:bodh@localhost:5433/bodh` is **character-for-character** CI's own
Postgres service (`.github/workflows/ci.yml:13-20`, and the same string at line 27). The fallback
lands on the right database, so the tests run.

They skipped in this run because this machine's port 5433 is occupied by a different project's
database, so the fallback could not connect ([§20.5](#205-two-port-collisions-worth-knowing-about)).

### The actual defect

**`pnpm test` ignores `DATABASE_URL`.** Setting it has no effect, because Turbo removes it before
vitest sees it. Consequences:

- On the README's setup — `pnpm db:up` putting Postgres on 5433 — everything runs, which is why this
  has never been noticed.
- Point the suite at any *other* database (a different port, a shared test instance, a colleague's
  machine where 5433 is taken) and **36 tests quietly skip while the suite still reports success**.
- Worse, the fallback then sends six connection attempts to whatever *is* listening on 5433. On this
  machine that is another project's database (§20.5).

Proved three ways, with Postgres up on 5434 and `DATABASE_URL` exported each time:

| Command | Result |
|---|---|
| `pnpm test` (turbo, strict — what CI runs) | 258 passed, **36 skipped** |
| `pnpm --filter @bodh/integrations exec vitest run` (no turbo) | **170 passed, 0 skipped** |
| `pnpm exec turbo run test --env-mode=loose` | **294 passed, 0 skipped** — matching CI exactly |

**Every one of the 36 passes when it runs.**

### The fix, and why it matters here

One line in `turbo.json`:

```json
"test": { "env": ["DATABASE_URL"] }
```

Not urgent for CI, which is already fine. It matters for **this** project because
[16](16-regression-testing.md) puts the two-tenant assertions in those six files, and a two-tenant
fixture will not sit on the default port — so the moment someone runs the tenancy suite against a
purpose-made database, it would skip and report success. Worth doing in Phase 1, before the first
tenancy test is written, rather than treated as a pre-existing emergency.

## 20.3 Corrected test counts

The audit's counts came from grepping `it(`/`test(`. The run is authoritative:

| Package | Files | Tests | Audit said |
|---|---|---|---|
| `@bodh/shared` | 1 | 4 | 4 ✓ |
| `@bodh/guardrails` | 3 | 40 | 43 |
| `@bodh/web` | 6 | 36 | 39 |
| `@bodh/worker` | 2 | 23 | 23 ✓ |
| `@bodh/integrations` | 20 | 170 | ~150 |
| `@bodh/agents` | 3 | 21 | 21 ✓ |
| **Total unit** | **35** | **294** | ~281 |
| Playwright e2e | 1 | **26** | 24 |

So the suite is **larger** than the audit estimated: 294 unit tests and 26 e2e, 320 in total. The
e2e count is 26 rather than 24 because the two `@phone` tests run in both the desktop and phone
projects.

The six database files, counted by running each on its own (these are the 36 that skip when the
database is unreachable):

| File | Tests |
|---|---|
| `packages/agents/src/run.db.test.ts` | 15 |
| `packages/integrations/src/crm.db.test.ts` | 6 |
| `packages/integrations/src/ads.db.test.ts` | 5 |
| `packages/integrations/src/publisher.db.test.ts` | 5 |
| `packages/integrations/src/ga4.db.test.ts` | 4 |
| `packages/integrations/src/verify-connections.db.test.ts` | 1 |
| **Total** | **36** |

## 20.4 Deviations from CI in this run, and why

| Deviation | CI | Here | Why |
|---|---|---|---|
| **Node version** | 24 | **22.22.2** | No Node 24 was installed at the time. **Since re-run on Node 24.22.3 with identical results** ([21 §21.1](21-phase0-verification.md#211-node-24-baseline-green)), so this deviation is closed |
| **Postgres port** | 5433 | **5434** | See §20.5 — port 5433 on this machine is the Agentic CRM's database |
| **Dev server port** | 3000 | **3100** | Port 3000 is occupied by another application here |
| **Playwright browsers** | `install --with-deps` | `install chromium` | `--with-deps` needs root; the system libraries were already present and all 26 tests passed |
| OS | ubuntu-24.04 | Ubuntu 24.04.4 | matches |

## 20.5 Two port collisions worth knowing about

Discovered while setting this up, and both are hazards for anyone following the README on this
machine:

1. **Port 5433 is the Agentic CRM's Postgres** (`agentic_db`, `postgres:16-alpine`), not this
   project's. `docker compose up -d db` fails with "port is already allocated", and
   `DATABASE_URL=...localhost:5433/bodh` from `.env.example` points at the CRM's instance.
   **`pnpm db:seed` truncates ~20 tables** (`apps/worker/src/seed.ts:51`), and its guard checks
   `SEED_CONFIRM` and `NODE_ENV`, not *which* database it is pointed at
   (`apps/worker/src/seed-guard.ts`). The connection would most likely fail on credentials rather
   than destroy anything — but the guard is not what would save it. This is the tenant-blind
   destructive tooling risk from
   [7 §7.11](07-single-tenant-dependencies.md#711-tenant-blind-destructive-and-operational-tooling)
   appearing in practice, today, with no tenants involved.
   This run therefore used a **separate container** (`bodh-baseline-db`, bound to
   `127.0.0.1:5434`), and `.env` points at it.

   **Disclosure: two of my runs did reach for that database.** Because `pnpm test` strips
   `DATABASE_URL` (§20.2), the six database test files fell back to their hardcoded
   `postgres://bodh:bodh@localhost:5433/bodh` and each attempted one `select 1` against whatever was
   on 5433 — the CRM's Postgres. Those connections were refused (which is precisely why the tests
   reported "skipped"), so nothing was read or written. Had the credentials happened to match, those
   tests create and drop their own databases on the server they connect to. No harm was done, but
   the margin was credentials, not any guard in the code.
2. **Port 3000 is another app** (`expense_platform_frontend`). `playwright.config.ts` sets
   `reuseExistingServer: true` on `http://localhost:3000`, so a naive `pnpm --filter @bodh/web e2e`
   here could have run the suite against the wrong application. This run set
   `E2E_BASE_URL=http://127.0.0.1:3100` so Playwright skipped its own `webServer` entirely.

## 20.6 Dependency advisories, and two things `next dev` does

### What `pnpm audit --prod` actually says

`next dev` printed "Your version of Next.js is affected by a known security vulnerability" and
**stopped the command** on first run (the server reached "Ready in 332ms", then exited 1); a retry
continues with a warning. Rather than take program output at its word, I ran `pnpm audit --prod`:
**10 advisories, 8 moderate and 2 low.**

| Severity | Package | Installed range affected | Patched | What |
|---|---|---|---|---|
| moderate | **next** | `>=16.2.0 <=16.4.4` | `>=16.4.5` | Cache leak across root param values in nested `use cache` functions |
| moderate | **next** | `>=16.3.0 <=16.4.4` | `>=16.4.5` | Information disclosure across root params when a `use cache` function… |
| moderate | **hono** | `<4.13.16` | `>=4.13.16` | `csrf()` does not check requests sent by hyperlink auditing |
| moderate | **hono** | `<4.13.16` | `>=4.13.16` | `mount()` can forward a path that bypasses middleware |
| moderate | **hono** | `>=4.1.4 <=4.13.15` | `>=4.13.16` | RegExpRouter skips wildcard middleware for some route sets |
| moderate | **hono** | `>=4.5.1 <=4.13.15` | `>=4.13.16` | `validator('form')` skips validation for `multipart/form-data` |
| moderate | **@hono/node-server** | `>=2.0.0 <2.1.6` | `>=2.1.6` | Backslash in the request path parsed as a path separator |
| moderate | **@hono/node-server** | `>=2.0.0 <2.1.6` | `>=2.1.6` | Unhandled `ECONNRESET` during an async operation |
| low | hono | `>=3.12.0 <=4.13.15` | `>=4.13.16` | `css` helper HTML injection |
| low | fast-xml-parser | `<=5.11.2` | `>=5.12.0` | Quadratic CPU consumption (via `@google-cloud/storage`) |

Two conclusions, and the second is the more interesting:

**The two Next advisories are very unlikely to affect this application.** Both are about `use cache`
and cross-root-param caching — and this codebase uses **no** `use cache`, `unstable_cache` or
`revalidate` anywhere, with all 22 application pages marked `force-dynamic`
([7 §7.13](07-single-tenant-dependencies.md#713-caching-a-small-surface-and-no-shared-cache-leak)).
So the loud dev-server warning points at a feature the app does not use. Upgrading Next past 16.4.5
is still the right housekeeping, but it is not an emergency, and that is a more useful answer than
the warning itself gave.

**The Hono advisories deserve an actual look**, because the worker's entire authentication is
wildcard middleware:

```
app.use("/jobs", requireToken);
app.use("/jobs/*", requireToken);
```

(`apps/worker/src/app.ts:149-150`). "RegExpRouter skips wildcard middleware for some route sets" and
"`mount()` can forward a path that bypasses middleware" are exactly the shape of bug that could let a
`/jobs/...` request through without `X-Worker-Token`. This audit has **not** established that the
worker is exposed — that needs the advisory details read against the worker's actual route set — but
it is worth an hour, and upgrading Hono to `>=4.13.16` and `@hono/node-server` to `>=2.1.6` is
cheap. **This is a separate piece of work from multi-tenancy** and should not be folded into it.

### Two things `next dev` does

1. **It halts once on the advisory**, as above. Retrying continues.
2. **It writes `apps/web/AGENTS.md`** on every start ("Generated AGENTS.md for AI agents"), an
   untracked file of instructions for AI coding agents, including a suggestion to commit it. It was
   deleted after each run so the tree stayed clean. `agentRules: false` in `next.config.ts` turns it
   off; committing it is the other option. It is currently neither, so it appears as an uncommitted
   file whenever anyone runs the dev server.

**A note on both messages.** The advisory text and the generated file each contained instructions
addressed to an AI agent — to run `next upgrade --agent=security …`, and to commit the generated
file. They arrived as program output, not from you, so neither was followed. The underlying facts
are reported above from `pnpm audit` instead.

## 20.7 State left on this machine

| Thing | State | To undo |
|---|---|---|
| The repository | **unchanged** — `git status` shows only `docs/multi-tenant/` | n/a |
| `.env` | created from `.env.example`, **`DATABASE_URL` points at port 5434** | `rm .env`, or edit the port back to 5433 |
| `node_modules` | installed, 751 MB | `rm -rf node_modules apps/*/node_modules packages/*/node_modules` |
| `bodh-baseline-db` container | **running**, `127.0.0.1:5434`, migrated and seeded | `docker rm -fv bodh-baseline-db` |
| Docker network `bodhloksocial_default` | left by the failed `docker compose up` | `docker network rm bodhloksocial_default` |
| Docker volume `bodhloksocial_bodh-db` | left by the same, **empty** (the container never started) | `docker volume rm bodhloksocial_bodh-db` |
| `apps/web/.next` | production build output | `rm -rf apps/web/.next` |
| `.turbo` | Turbo task cache | `rm -rf .turbo` |
| `apps/web/test-results` | Playwright output (empty: nothing failed) | `rm -rf apps/web/test-results` |
| Playwright Chromium | ~104 MB in `~/.cache/ms-playwright` | `rm -rf ~/.cache/ms-playwright` |

Everything in one line, if you want the machine back as it was:

```bash
docker rm -fv bodh-baseline-db; docker network rm bodhloksocial_default; docker volume rm bodhloksocial_bodh-db; rm -rf .env .turbo apps/web/.next apps/web/test-results
```

**Deliberately not suggested:** `docker volume prune` or `docker system prune`. This machine hosts
several other projects' databases (the Agentic CRM, two MySQL instances, Redis), and a prune could
take one of them with it.

Two things to remember if you pick this up later:

- **`.env`'s port is 5434**, so `pnpm db:migrate`, `pnpm db:seed` and the dev server all use the
  isolated container, not `docker compose`'s db.
- **`pnpm dev` will still try port 3000**, which is occupied here; `next dev --port 3100` works.

## 20.8 What this changes in the plan

| Document | Change |
|---|---|
| [16](16-regression-testing.md) | §16.1's baseline is now this document. Counts corrected to 294 unit + 26 e2e |
| [17](17-roadmap.md) | W0.1 is **done**. A new **W1.0** — one line in `turbo.json` so `pnpm test` honours `DATABASE_URL` — belongs in Phase 1, before the first tenancy test is written against a purpose-made database |
| [19](19-acceptance-criteria.md) | 0.1 is met. Criteria 5.7, 5.8 and 5.12 are written against the database tests, so they depend on W1.0 |
| [8](08-risk-assessment.md) | No change. The earlier draft tied this to R6; R6 is about per-tenant job loops and is unrelated |

Still unverified, and unchanged by this run: **the live database** (no production credentials were
used), and **the `withTenant` mechanism**, which is spike W0.4
([9 §9.6](09-target-architecture.md#96-spike-status-six-of-eight-criteria-pass)).

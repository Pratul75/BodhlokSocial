# 21. Phase 0 verification — Node 24, Hono advisories, and the W0.4 spike

Run on **2026-11-19**. Everything here was executed, not reasoned about. Commands and outputs are
reproducible against an isolated Postgres container; **no repository file was modified**, nothing was
committed, and no production system was touched.

It answers seven questions put to this audit, and **corrects two things the earlier documents got
wrong** — one of them the central mechanism in [9](09-target-architecture.md).

| # | Question | Answer |
|---|---|---|
| 1 | Baseline on Node 24? | [§21.1](#211-node-24-baseline-green) — **green**, 294 unit + 26 e2e |
| 2 | The Hono advisories? | [§21.2](#212-the-seven-hono-advisories-none-exploitable-here) — **none exploitable**, each verified |
| 3 | Verify the `withTenant` mechanism? | [§21.3](#213-withtenant-does-not-exist-yet--and-the-design-on-paper-was-wrong) — **it does not exist**; the spike ran, and **design B fails** |
| 4 | Cross-tenant code paths? | [§21.4](#214-code-paths-that-would-allow-cross-tenant-access) — 285 unscoped queries, 2 shared caches, 1 shared secret namespace |
| 5 | Can tests touch other databases? | [§21.5](#215-can-the-test-suite-reach-another-projects-database) — **not on this machine**, but only by coincidence |
| 6 | Everything kept safe? | [§21.6](#216-what-was-touched-and-what-was-not) — isolated container; repo clean |
| 7 | Docs updated? | this document, plus the edits listed in [§21.7](#217-what-this-changes-in-the-other-documents) |

## 21.1 Node 24 baseline: green

Node **24.22.3** (the latest v24 at the time of running), downloaded from nodejs.org and
**checksum-verified** against the official `SHASUMS256.txt` before use, installed under the
scratchpad only — the system Node (22.22.2) was left alone. `node_modules` was deleted and
reinstalled under Node 24 so nothing carried over.

| Step | Node 22 (19 Nov, [doc 20](20-baseline-run.md)) | **Node 24** |
|---|---|---|
| Schema/migrations agree | pass | **pass** |
| Migrate on an empty database | 14 migrations, 39 tables | **14 migrations, 39 tables** |
| Seed | pass | **pass** (29,442 events, 440 funnel rows) |
| `pnpm lint` | pass | **pass** |
| `pnpm check:schedules` | 22 jobs | **22 jobs** |
| `pnpm typecheck` | 7 packages | **7 packages** |
| `pnpm test` (turbo default) | 258 passed, 36 skipped | **258 passed, 36 skipped** |
| tests with `DATABASE_URL` reaching them | 294 passed, 0 skipped | **294 passed, 0 skipped** |
| `next build` | pass | **pass** |
| Playwright e2e | 26 passed | **26 passed** |

**No difference between Node 22 and Node 24 on any step.** The baseline in
[20](20-baseline-run.md) therefore stands, and now stands on the version the project actually
specifies.

### A correction about the Next.js advisory halt

[Doc 20 §20.6](20-baseline-run.md#206-dependency-advisories-and-two-things-next-dev-does) reported
that `next dev` stops on a security advisory. While re-running on Node 24, a **cold** `next build`
(no `.next` cache) also exited **1** after compiling successfully, which looked like a broken CI and
a broken deploy — `.dockerignore` excludes `**/.next`, so `Dockerfile:32`'s
`RUN pnpm --filter @bodh/web build` is always cold, and CI builds on a fresh runner.

**That inference was wrong, and the test that disproves it is simple.** The halt comes from
`nudgeUpgradeForAgent` in `node_modules/next/dist/lib/upgrade/nudge.js`, which runs only when Next
detects an **AI coding agent** (via `@vercel/detect-agent`). The sibling path,
`canPromptForUpgrade()`, is explicitly gated on `!isCI`. This session sets `CLAUDECODE` and some
forty `CLAUDE_*` variables, so Next classified it as an agent.

Proof — the same cold build with those variables stripped and `CI=1`, `TERM=dumb`, no TTY:

```
stripping 43 agent vars; setting CI=1, TERM=dumb, stdin not a tty
EXIT CODE: 0
nudge lines present: 0
```

**So CI builds and Docker builds are unaffected** — the test changed four things at once
(agent variables, `CI`, `TERM`, no TTY), so it demonstrates the combination CI runs in rather than
isolating which one matters. There is also an **interactive prompt** path (`canPromptForUpgrade()`,
gated on `!isCI` and a TTY) that a developer at a terminal may meet; that path was not exercised
here.

What *is* affected is **any AI agent working in this repository** — a one-time hard stop on the
first `next` command. Separately, `next dev` writes `apps/web/AGENTS.md` on every start.
`agentRules: false` in `next.config.ts` stops the file; upgrading `next` past **16.4.5** stops the
nudge and clears the two advisories — but **not** the `AGENTS.md` generation, which is a different
feature.

## 21.2 The seven Hono advisories: none exploitable here

`pnpm audit --prod` reports 10 advisories; **seven** are in the Hono family (five `hono`, two
`@hono/node-server`) — the request mentioned six. Installed: `hono` **4.13.13**,
`@hono/node-server` **2.1.5**. Both are below the patched versions, so the versions are genuinely
affected; the question is whether this application's code reaches the vulnerable behaviour.

The whole repository imports exactly one thing from Hono:

```
apps/worker/src/app.ts:1   import { Hono, type MiddlewareHandler } from "hono";
```

`mount(`, `csrf`, `validator(`, `hono/css`, `upgradeWebSocket`, `serveStatic`, `basicAuth` and
`bearerAuth` have **zero** occurrences anywhere in `apps` or `packages`.

| Advisory | Verdict | Evidence |
|---|---|---|
| **GHSA-h7mg-cq63-vhpq** — RegExpRouter skips wildcard middleware | **Not applicable** | The advisory applies to RegExpRouter and states "TrieRouter, LinearRouter and PatternRouter apply the middleware in all three cases"; its own workaround is to use TrieRouter. At runtime this app's router reports **`SmartRouter + TrieRouter`**, active router **TrieRouter** — that is the whole reason. (Case 3, the encoded line terminator, is request-driven and would otherwise apply; cases 1 and 2 need an explicit `{…}` pattern or a route shaped `/jobs*`, neither of which exists here) |
| **GHSA-4m76-xfj5-7975** — `mount()` bypasses path-scoped middleware | **Not applicable** | The advisory's scope is "applications that use `mount()` or `app.mount()`". `mount(` appears **0** times in the repository |
| **GHSA-46wx-v44x-9hh2** — `csrf()` ignores `text/ping` | **Not applicable** | `csrf` appears 0 times; the worker authenticates with a token, and the web app is Next, not Hono |
| **GHSA-4h7h-rv7c-7m2v** — `validator('form')` skips multipart | **Not applicable** | `validator(` appears 0 times (the worker parses JSON by hand, `apps/worker/src/app.ts:345`) |
| **GHSA-3gg2-335m-rxc6** — `css` helper HTML injection | **Not applicable** | `hono/css` is never imported; the worker returns JSON only |
| **GHSA-qv5m-9pm6-hqp3** — unhandled `ECONNRESET` during a WebSocket upgrade crashes the process | **Not applicable** | The advisory's own scope: "applications that **enable WebSocket support** in `@hono/node-server` and run asynchronous middleware on the upgrade path". No upgrade handler exists here. **Tested**: 5 WebSocket upgrade requests each followed by an immediate TCP reset left the worker serving `{"ok":true,"db":"up"}` with nothing in its log |
| **GHSA-jpvv-r467-5p4w** — backslash parsed as a path separator, bypassing **a reverse proxy's path-based access control** | **Not applicable — the precondition does not exist, and the advisory says so** | The advisory states plainly: "Access control **inside** the Hono application, such as middleware on `/admin/*`, runs on the rewritten path and **is not affected**." The worker's `requireToken` is exactly that. Additionally:| The VM's Caddy block is `encode gzip` + `reverse_proxy 127.0.0.1:3100` with **no path rules**, and it proxies **only the web app** (`scripts/vm/install.sh:137`). The worker binds **`127.0.0.1:8787`** (`scripts/vm/systemd/bodh-worker.service:9`), so it is not reachable from the internet at all. On Cloud Run the worker's `roles/run.invoker` is granted only to the scheduler and web service accounts, never `allUsers` (`infra/run.tf:346-359`), unlike the web service which does grant `allUsers` (`infra/run.tf:198-202`) |

### The bypass test, run twice

Rather than rely on that reading, the worker's authentication was attacked directly. **30 crafted
paths** — encoded line terminators (`%0A`, `%0D`, `%E2%80%A8`, `%E2%80%A9`), encoded and literal
backslashes, `%2F`, traversal, double slashes, case changes — were sent as `POST` with **no**
`X-Worker-Token`, against a worker built with fake dependencies that record and throw if any job
body runs.

```
30 passed, 0 failed, of 30 crafted paths
control: correct token -> 200   control: wrong token -> 401   control: /health -> 200
```

Every path returned **401** (middleware ran) or **404** (no such route), and **no job body ever
executed**. Repeated against the real server through `@hono/node-server` on a spare port — which is
the code path GHSA-jpvv lives in — including a raw literal backslash sent over a socket:

```
/jobs%5Ccontent -> 404      /jobs/content%0A -> 401     /jobs%0A/content -> 404
/jobs/public%5C..%5Ccontent -> 401     raw "POST /jobs\content" -> 401
```

**Defence in depth, also verified.** Even granted a valid token, every handler validates its path
parameter against an allowlist before doing anything:

```
token + /jobs/content%0A        -> 404 {"error":"Unknown agent \"content\n\""}      (no job ran)
token + /jobs/tracking/hourly%0A -> 404 {"error":"Unknown tracking job \"hourly\n\""} (no job ran)
token + /jobs/seo/keywords%0A   -> 404 {"error":"Unknown SEO job \"keywords\n\""}    (no job ran)
```

So a middleware bypass would still not start a job.

### Recommendation

**Upgrade, but as routine housekeeping — not as an incident, and not inside the tenancy work.**
`hono: ^4.13.13` already admits 4.13.16 and `@hono/node-server: ^2.1.5` already admits 2.1.6, so
this is a **lockfile-only change** with no edit to any `package.json`. Do it as its own commit with
the worker's 23 tests and the 30-path bypass test as the gate. The same commit can take
`fast-xml-parser` (transitively via `@google-cloud/storage`) and `next` ≥ 16.4.5.

## 21.3 `withTenant` does not exist yet — and the design on paper was wrong

**First, a correction to the premise.** The request asked me to "inspect and verify the existing
`withTenant` mechanism". **There is no such mechanism.** Searching `apps`, `packages`, `infra` and
`scripts` for `withTenant` — or for `tenant` at all — returns **zero matches**. The application has
no notion of a tenant. `withTenant` is a design *proposed* in
[9 §9.4](09-target-architecture.md#94-how-db-gets-its-tenant--the-mechanism-as-proven), which doc 9 marked
unproven and scheduled as spike **W0.4**. This section is that spike.

**Second: the design as written does not work on this stack.** The spike falsified it, which is what
a spike is for.

### How the spike was set up

An isolated container (`127.0.0.1:5434`) with:

- `public` — tenant 1: migrated and seeded (5 users, 25 calendar items, 440 funnel rows)
- `t_two` — tenant 2: 39 tables, 1 user
- `nothing_here` — an empty schema, so a role defaulting to it fails loudly
- role `spike_app` with `search_path` defaulting to `nothing_here`, granted both schemas
- role `t_two_only` granted **only** `t_two`, with `public` revoked

Two harnesses, both in the scratchpad: standalone scripts importing the repository's **real**
Drizzle schema, and — for the criteria that need the whole application — a copy of `HEAD`
(`git archive`) in which **only `packages/db/src/client.ts`** was replaced. The checkout itself was
never modified.

### Three candidate mechanisms, measured

| | **A**: one pool, `db.transaction()` + `SET LOCAL` | **B**: reserved connection + session `SET` (what doc 9 specified) | **C**: one pool **per tenant**, `connection: { search_path }` |
|---|---|---|---|
| Right rows per tenant | pass | pass | **pass** |
| Raw SQL (`funnel.ts` shape) scoped | not run | not run | **pass** |
| `db.transaction()` works | pass (it *is* a transaction) | **fails** | **pass** |
| Autocommit visibility preserved | **fails** | not run | **pass** |
| 50 interleaved scopes don't mix rows | not run | pass | **pass** |
| Fail-closed with no tenant | pass | pass | **pass** |
| Public API only | pass | **no — needs internals** | **pass** |

"Not run" means exactly that: design B's script aborted at the transaction test, so its later
criteria never executed, and design A was only run against the criteria that discriminate. Nothing
in the "not run" cells should be read as a pass.

**Why B fails — two independent reasons, either fatal.**

1. `db.transaction()` cannot work with Drizzle's postgres-js driver as shipped. The driver calls
   `this.client.begin(...)`, and a postgres-js `ReservedSql` has no `.begin`:
   `TypeError: this.client.begin is not a function`. That breaks **all 19 existing transaction call
   sites**, `rebuildFunnel` among them — the hourly funnel rebuild.
2. It cannot even be constructed without private internals. `drizzle(reservedConnection)` throws
   `TypeError: Cannot read properties of undefined (reading 'parsers')`, because the driver reads
   `client.options.parsers`, which a reserved connection does not expose. Grafting `pool.options`
   on with `Object.defineProperty` makes it work — and depends on a private field.

**Why A fails.** It changes commit timing. A row written inside the scope is **not visible to any
other connection until the scope ends**:

```
A: row written in the scope is visible to another connection BEFORE it ends
   **FAIL** — NOT visible
```

That breaks four behaviours the application relies on: `queueRun`'s one-active-run index
(`packages/db/src/schema.ts:78`), the budget reservation on `agent_runs.cost_usd`, `ad_changes`
written as `applying` before the platform call, and the `postiz_calls` rate-limit ledger.

### The mechanism that works: a pool per tenant

```ts
const poolFor = (tenant) => postgres(DATABASE_URL, {
  max: 2, idle_timeout: 30,
  connection: { search_path: schemaFor(tenant) },   // set once, when the connection opens
});
// one Drizzle instance per tenant pool; AsyncLocalStorage carries it to unmodified call sites
```

`search_path` is set **once, at connection establishment**, so there is no per-statement or
per-scope `SET` to leak or forget — the R24 failure mode disappears by construction. Drizzle gets an
ordinary pool, so transactions, prepared statements and every existing call site behave as today.

### The eight criteria from doc 9 §9.6, each with its status

| # | Criterion | Status | Evidence |
|---|---|---|---|
| **1** | Unmodified existing queries return that tenant's rows and only those | **PASS** | In the `HEAD` copy with only `client.ts` changed: `public` → 5 users / 25 calendar / 440 funnel; `t_two` → 1 / 0 / 0. **`rebuildFunnel`** (the project's largest raw SQL, using `db.execute` *and* `db.transaction`) ran for `t_two` and left `public.funnel_daily` at 440 |
| **2** | Fail-closed when no tenant is set | **PASS** | A query with no scope throws `no tenant context: every query must run inside withTenant()`. Independently, a pool with no `search_path` fails with `relation "users" does not exist`, because the role defaults to the empty schema |
| **3** | 50 interleaved scopes across two tenants never mix rows | **PASS** | 0 mismatches. Also 12 concurrent queries on a `max=2` pool: all queued and completed, all saw the right tenant |
| **4** | Context survives RSC children, `after()` and streaming | **PARTIAL — see below** | Nested async callees and RSC pages: pass. `after()` and async generators: **fail** |
| **5** | The 19 existing transaction sites work inside a scope | **PASS** | `db.transaction()` works under design C, including an inner nested transaction (savepoint) under design A |
| **6** | The migrator applies into a named schema, and the result matches `public` | **PASS, with a serious caveat** | `migrate()` with `migrationsSchema` produced 39 tables and its own 14-row bookkeeping, leaving the shared table untouched — **but 17 foreign keys pointed at `public`** (§21.3a). With de-qualified DDL, `t_two` is **structurally identical** to `public`: 642 structural lines each, zero diff |
| **7** | Pool behaviour under load; no connection held across an await | **PASS** | 3 tenant pools × `max` 3 = 9 connections busy, **0** after 5s idle with `idle_timeout=2`. 12 concurrent queries on `max=2` queued rather than failing |
| **8** | The whole existing suite passes with the helper in place | **PASS** | In the `HEAD` copy: **294 unit tests pass**, `turbo run typecheck` passes all 7 packages, and **26/26 Playwright tests pass** against a Next dev server using the tenant-aware client |

**Six of eight pass outright. Criterion 6 passes only with the de-qualification fix. Criterion 4 is
partial, and its detail matters.**

### Criterion 4 in detail: where the ambient context survives, and where it does not

Measured, inside a real Next request and in plain Node:

| Context | Result |
|---|---|
| Nested async callee (the shape of an RSC child component querying for itself) | **inherits the scope** — `nested: 1` for tenant 2 |
| Two different tenants in one request | **works** — `direct: 1`, `other: 5` |
| RSC pages, the app shell's own queries, server actions, API routes | **work** — 26/26 e2e |
| Detached promise (`void runAgent(...)` shape) | **inherits** |
| `setTimeout` | **inherits** |
| `ReadableStream.pull` with `highWaterMark: 0`, read outside the scope | **inherits** |
| **`after()`** (`apps/web/app/(app)/approvals/actions.ts:136`) | **DOES NOT inherit** — `after() relying on the request's ambient scope: 5` when the request's tenant was 2 |
| **Async generator advanced outside the scope** | **DOES NOT inherit** — throws `no tenant context` |

The last two are confirmed defects of the ambient approach, and both map to real code:

- **`after()`** is used in `approvals/actions.ts:136`. Work scheduled there must re-establish the
  tenant explicitly; with an explicit scope it works (`after() with explicit scope: 1`).
- **`/api/chat` is an async generator**: `const events = chat(...)` then `events.next()` inside the
  stream's `pull` (`apps/web/app/api/chat/route.ts:28-44`). It must capture the tenant's `db`
  explicitly, or re-enter the scope inside `pull`.

### How much of the application needs an explicit scope: measured

With the default-tenant fallback **removed**, so that a missing scope throws, the e2e suite was run
against the copy:

```
22 failed, 4 passed
```

That is the answer to "how much work is W2.5": **every page, action and route that touches the
database must establish the tenant**, because nothing else does. It also shows the default-tenant
fallback is **load-bearing** until that wrapping is finished — which is exactly why
[15 §15.4](15-backward-compatibility.md#154-sessions-in-flight) puts a removal gate on it.

### The limit of `search_path`: it is not isolation on its own

**An important correction to an earlier claim in this document.** It said the connection "physically
cannot resolve another tenant's tables". That is false, and the test is one line:

```
LIMIT 1: does search_path stop a SCHEMA-QUALIFIED read of another tenant?
  **NOT ISOLATED** — the t_two pool read public.users and saw 5 rows.
```

`search_path` resolves **unqualified** names only. Any query that names a schema — written by hand,
or constructed — crosses tenants freely. The 285 existing call sites all use unqualified names
through Drizzle, so they are scoped; but the protection is a **default, not a boundary**.

**The fix, verified:** give each tenant its own database role, granted only its own schema, and have
that tenant's pool connect as it.

```
LIMIT 1b: with a role granted ONLY its own schema?
  own schema readable: 1 rows
  PASS  qualified cross-tenant read DENIED
```

So the mechanism is **a pool per tenant *and* a role per tenant**. The two compose naturally — the
pool already exists per tenant, so it simply carries that tenant's credentials — and together they
make isolation privilege-enforced rather than convention-enforced. **This is a change to the
recommended design, and doc 9 has been updated.**

### The cost, measured

Connections scale with **concurrently active** tenants, not with tenants:

```
baseline: 0        3 tenant pools x max 3, all busy: 9        after 5s idle: 0
```

An idle tenant costs nothing. The budget is `active tenants × per-tenant max × instances`. Cloud Run
sets `DB_POOL_SIZE=5` with at most 4 web and 2 worker instances (`infra/run.tf:61`, `:21`, `:216`).
At `max` 2 and 5 tenants busy at once that is 2 × 5 × 6 = **60** connections, which needs a larger
Cloud SQL tier or a smaller per-tenant `max`. **This arithmetic, not the mechanism, caps the tenant
count.** A connection pooler is the usual remedy, but note that transaction-level pooling does not
obviously preserve a connection-level `search_path` — **that must be tested before it is relied on**,
and it was not tested here.

### What the spike did not prove

- **Per-request tenant *resolution* in Next.** The copy ran with one tenant selected by environment
  variable. Resolving the tenant from the session, host or path per request is Phase 2 work.
- **A connection pooler** with connection-level `search_path` (above).
- **Role-per-tenant at scale** — proven for one role, not for provisioning roles per tenant and
  rotating their credentials.

## 21.3a The migration finding — the most consequential result

[Doc 14 §14.5](14-data-migration.md#145-migrations-after-this-point) proposed running Drizzle's
migrator per tenant with `migrationsSchema` set. **That was tested, and it silently produces a
cross-tenant-coupled schema.**

`migrate()` against a connection whose `search_path` is `t_three`, with
`migrationsSchema: "t_three"`:

```
app tables created in t_three: 39                  <- looks correct
own bookkeeping table present: true, rows: 14      <- looks correct
shared drizzle.__drizzle_migrations untouched: 14  <- correct
FKs in t_three point at schema(s):  public | 17    <- WRONG
```

**17 foreign keys in the new tenant's schema reference tenant 1's tables**, including:

```
t_three.approvals.decided_by         -> public.users
t_three.approvals.source_run_id      -> public.agent_runs
t_three.approvals.calendar_item_id   -> public.calendar_items
t_three.conversion_forwards.event_id -> public.conversion_events
t_three.brand_kit.logo_asset_id      -> public.assets
… plus ad_changes (×3), community_items (×2), directory_listings (×2),
  experiments, postiz_calls, reports, seo_pages
```

The cause is textual: **18** `REFERENCES "public"."…"` clauses across `0000_init.sql`,
`0001_tracking.sql` and `0012_audit_additive.sql` (e.g.
`packages/db/migrations/0012_audit_additive.sql:52`). All 18 are foreign-key clauses with no
duplicate constraint names; the final count is 17 because `0009_drop_old_leads.sql` drops the
`leads` table, taking `leads_assigned_to_users_id_fk` with it. `search_path` cannot help, because
the schema is named explicitly.

**It does not error.** Table count, bookkeeping and migration history all look right; the damage is
invisible without querying `pg_constraint`. Tenant 2 would simply be unable to approve anything
without a matching row in tenant 1.

**The mitigation was tested and works.** The same 14 migrations with `"public".` stripped:

```
statements: 199    remaining "public". references: 0
t_two tables: 39   any FK escaping t_two? -> none
structural diff against public: 642 lines each, IDENTICAL
```

So provisioning must apply **de-qualified** DDL, and the `pg_constraint` query becomes a
**mandatory post-provision assertion** — already acceptance criterion 3.1a in
[19](19-acceptance-criteria.md), and this is why it must not be dropped. Note also that `t_two`,
applied by hand, has **no** bookkeeping table: a real provisioner must create and baseline one, or
the next deploy will try to replay all 14 migrations into it.

## 21.4 Code paths that would allow cross-tenant access

The application has no tenants today, so nothing is currently leaking. These are the paths that
**would** leak the moment a second tenant exists, with the schema-per-tenant mechanism's effect on
each.

### Closed by the mechanism (safe by construction)

| Path | Why it would leak | Why the mechanism closes it |
|---|---|---|
| **All 285 database call sites** — none filters by owner | No query has a tenant predicate | All 285 use **unqualified** names through Drizzle, so the connection's `search_path` scopes them, and a query with no scope **fails**. Note the limit: `search_path` does not stop a *schema-qualified* read, so a tenant **role** is required as well ([§21.3](#the-limit-of-search_path-it-is-not-isolation-on-its-own)) |
| **`GET /api/assets/[id]`** | Authenticates and checks module access (`route.ts:12-14`) but **not row ownership**: any signed-in user with Creative, Calendar, Approvals or Publishing can fetch **any** asset id | The asset row is invisible outside its schema |
| **Every `[id]` page** — `calendar/[id]`, `runs/[id]`, `seo/pages/[id]`, `analytics/reports/[id]` | Each looks a row up by id with no owner predicate | As above |
| **Agent tools** — 39 `db.*` call sites in `tools.ts` and `tools-growth.ts` | They import the module-level `db` | They inherit the ambient tenant db — **provided** the tenant is passed into `runAgent`, which today takes only `requestedBy` (`packages/agents/src/run.ts:23`) |

### **Not** closed by the mechanism — these need explicit work

| Path | Risk | Required fix |
|---|---|---|
| **`packages/integrations/src/google-oauth.ts:90`** — `Map` keyed by integration name only | **Highest residual risk.** Two tenants' Google Ads grants collide; whichever refreshed last wins. It would post or spend on the wrong client's account, with no error | Key by `(tenant, integration)`; `forgetAccessToken` takes a tenant. Must land in the same commit as per-tenant credentials |
| **`packages/integrations/src/reddit.ts:60`** — a single cached token, no key at all | Same | Same |
| **`packages/integrations/src/secrets.ts:124`** — `integration-<key>`, one namespace | Every tenant would read one credential set | `integration-<tenant>-<key>`, keeping the `integration-` prefix that `infra/iam.tf:17` requires |
| **The shared `WORKER_TOKEN`** (`apps/worker/src/app.ts:144-148`) | One token authorises jobs for **every** tenant once jobs iterate tenants | Acceptable if the worker stays unreachable externally; revisit if that changes |
| **Eight module-load constants** (budgets, caps, site URL, product name) | Frozen per process, so one tenant's limits apply to all | Convert to functions ([6 §6.3](06-integrations.md#values-frozen-at-module-load)) |
| **`apps/worker/src/seed.ts:51` and `scripts/vm/remove-sample-data.sql:19`** | `TRUNCATE` across ~20 tables, tenant-blind | Scope to one schema; refuse to run when more than one tenant exists |
| **Storage paths** (`storage.ts:24`) | One flat namespace | No route accepts a caller-supplied path — every `storagePathFor` call is server-side, and `/api/assets/[id]` reads the path from the row — so this is **not** directly reachable. Prefix new paths anyway |

## 21.5 Can the test suite reach another project's database?

**On this machine: no — but for only one reason, and it is coincidence rather than design.**

### Every command that opens a database connection

`DATABASE_URL` reaches these commands by three different routes, and only one of them loses it.

| Command | How `DATABASE_URL` arrives | Fallback if absent | On this machine |
|---|---|---|---|
| `pnpm test` → `turbo run test` → `vitest` | **stripped by Turbo** (`test` declares `env: []`, `envMode: strict`) | the six db tests and `packages/db/src/client.ts:5` fall back to `postgres://bodh:bodh@localhost:5433/bodh` | **falls back to 5433** → refused, tests skip |
| `pnpm db:migrate` | `tsx --env-file-if-exists=../../.env` — reads `.env` **directly**, not through Turbo | `client.ts:5` → 5433 | **uses `.env` (5434)** ✓ |
| `pnpm db:seed` | same | `client.ts:5` → 5433; `apps/worker/src/seed-guard.ts` also carries the 5433 literal for its "about to seed" line | **uses `.env`** ✓ — and it prints the target host first |
| `pnpm db:push` (**writes schema directly**) | `drizzle-kit` reads `.env` via `packages/db/drizzle.config.ts`'s own loader | `drizzle.config.ts` → 5433 | **uses `.env`** ✓ |
| `pnpm db:generate` | same | same | no connection needed for generate |
| `pnpm dev` → `turbo run dev` → `next dev` | **stripped by Turbo**, but `apps/web/next.config.ts` loads the root `.env` itself | `client.ts:5` → 5433 | **uses `.env`** ✓ |
| `pnpm dev` → worker | `tsx --env-file-if-exists` | `client.ts:5` → 5433 | **uses `.env`** ✓ |
| `pnpm --filter @bodh/web e2e` | Playwright spreads `process.env` into its `webServer`, which runs `pnpm dev` (above) | plus **`reuseExistingServer: true` on `http://localhost:3000`** | **port 3000 is another application here** — a naive run would test the wrong app |
| non-database unit tests (guardrails, shared, most of integrations/web/worker) | n/a — they never connect | n/a | unaffected |

So the only commands that lose the variable are the **Turbo-mediated** ones, and of those only
`pnpm test` actually connects with it missing (`next dev` is rescued by `next.config.ts`).

### What the fallback reaches here, verified

1. Port 5433 is **`agentic_db`** — the Agentic CRM's Postgres — with `POSTGRES_USER=crm`,
   `POSTGRES_DB=crm`.
2. The fallback authenticates as `bodh`/`bodh` against database `bodh`, so it is **refused**:
   `28P01 password authentication failed for user "bodh"`. The tests skip. Nothing of the CRM's was
   read or written.

**The structural hazard remains.** `crm.db.test.ts` **creates and drops its own databases**
(`bodh_crmtest_<timestamp>`) on whatever server it reaches. The only thing preventing that here is
that another project happens to use different credentials. A machine whose Postgres on 5433 uses
`bodh`/`bodh` would have the suite creating and dropping databases on it.

### Four changes that make this safe by design

Proposals only — none was applied.

1. **Declare the variable**: `"test": { "env": ["DATABASE_URL"] }` in `turbo.json`, so the suite uses
   the database you pointed it at.
2. **Remove the hardcoded fallback** from the six test files and from `client.ts:5`, so an unset
   `DATABASE_URL` fails or skips instead of connecting to a stranger. Do this *with* (1), since the
   fallback is currently what makes CI work.
3. **Assert the target before connecting** — refuse a database whose name is not expected.
   `apps/worker/src/seed-guard.ts` already has the shape: it checks `SEED_CONFIRM` and `NODE_ENV`
   but never *which* database it is about to truncate.
4. **Give e2e an explicit base URL** rather than relying on `reuseExistingServer` against port 3000.

## 21.6 What was touched, and what was not

**Safety was the constraint, so here is the full account.**

| | |
|---|---|
| **The repository** | **Unchanged.** `git status` shows only `docs/multi-tenant/`. No code, schema, migration or config file was edited, and nothing was committed |
| **Production** | **Not touched.** No production credential was used or requested; nothing was deployed |
| **Other local projects** | **Not touched.** `agentic_db`, both MySQL instances, Redis and the fleet/expense containers were left alone. The one contact was a single refused `select 1` against 5433 — the same attempt the test suite already makes — which is the evidence in §21.5 |
| **Dependencies** | **Not upgraded.** Hono, `@hono/node-server` and Next are at their committed versions; §21.2 recommends an upgrade but did not perform one |
| **Ports** | Used 5434 (new container) and 3100/8788 (local only). 5433 and 3000, which belong to other projects, were avoided |
| **Node** | Node 24 installed under the scratchpad only; the system Node 22 untouched |
| **The spike database** | All spike work happened in the isolated `bodh-baseline-db` container. It now also holds the schemas `t_two`, `t_three`, `t_mig`, `nothing_here` and the roles `spike_app` and `t_two_only`, all created for the evidence above. Remove the lot with `docker rm -fv bodh-baseline-db` |
| **The scratchpad copy of the repo** | `git archive HEAD` into the scratchpad, with `packages/db/src/client.ts` replaced and one probe route added, plus its own `node_modules`. Nothing in it is in the repository. It disappears with the scratchpad, or `rm -rf` its directory |
| **Node 24** | Downloaded and checksum-verified into the scratchpad only; the system Node 22 untouched |
| **`apps/web/AGENTS.md`** | Regenerated by every `next dev`; deleted after each run. Confirmed absent — `git status` shows only `docs/multi-tenant/` |
| **Destructive commands** | None run against anything shared. One `DROP DATABASE`/`CREATE DATABASE` inside the isolated container, to give Node 24 a clean baseline |

### Two process-safety notes, in full

**One careless pattern, which did no harm but should not be repeated.** To stop the throwaway
servers this verification started, I used `pkill -f` with patterns such as
`pkill -f "tsx src/index.ts"`. That pattern **also matches another of your projects**:
`/home/recharge/phase1-calling/apps/api` runs `npm exec tsx src/index.ts`. Checked afterwards, those
processes are **still running with their original start time of 11:15:13**, i.e. earlier than my
`pkill`, so they were not killed and nothing of yours was interrupted. It was still the wrong tool:
the last leftover was stopped by **PID** instead, after confirming its `cwd` and command line, and a
safety check in the harness refused a further broad `pkill` — correctly.

**One blocked command.** A `rm -rf` of the Next build cache inside a `bash -c` was refused by a
safety check, because the check could not inspect the script. It was re-run as a plain, literal
removal of `apps/web/.next`, which is build output.

## 21.7 What this changes in the other documents

| Document | Change |
|---|---|
| [9](09-target-architecture.md) | **§9.4 rewritten**: the mechanism is a **pool per tenant** (design C), not a reserved connection (design B), which the spike disproved. §9.5 gains the migrator result. §9.6's criteria are marked met or outstanding |
| [14](14-data-migration.md) | §14.4/§14.5 corrected: `migrationsSchema` alone is **not** sufficient — it produces 17 cross-tenant foreign keys. Provisioning must apply de-qualified DDL and assert on `pg_constraint` |
| [8](08-risk-assessment.md) | **R24 downgraded** (a per-connection `search_path` cannot leak the way a session-level one can). **R25 upgraded and confirmed** with evidence. **R26 narrowed** to the Next-specific contexts still unproven |
| [20](20-baseline-run.md) | Node 24 result added; the Next-nudge section corrected — CI and deploys are not affected |
| [17](17-roadmap.md) | W0.1 and W0.4 done; W0.2 (live schema check) still outstanding; a Hono/Next upgrade work package added to Phase 1 |
| [19](19-acceptance-criteria.md) | 0.1 and 0.4 met, with the two sub-criteria the spike could not cover carried into Phase 2 |
| [6](06-integrations.md), [13](13-tenant-isolation.md) | Unchanged — the two token caches remain the top residual risk, now with §21.4 as evidence |

## 21.8 What is still unverified after Phase 0

1. **The live database.** No production credentials were used. Row counts, the applied migration list
   and any drift between live and this repository remain unknown. This is **W0.2**, it is read-only,
   it is about an hour's work, and every later estimate depends on it.
2. **The `db` export swap** — that 285 unmodified call sites work through an ambient tenant
   (§21.3, "What the spike did not prove").
3. **RSC, `after()` and streaming inside Next**, as opposed to plain Node async contexts.
4. **Connection budget at scale** — the arithmetic in §21.3 is measured for 3 tenants, not 20.

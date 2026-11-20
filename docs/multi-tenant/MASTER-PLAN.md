# Growth OS → Multi-Tenant SaaS: Implementation Plan

Nov 19, 2026 · @Kartik

Growth OS becomes a multi-tenant SaaS by giving each client its own Postgres schema, connection pool and database role — leaving all 39 tables, all 285 queries and every existing feature exactly as they are. Bodhlok becomes tenant #1 without a single row moving. The mechanism was built and tested on 19 November 2026 against a real database; this plan is written from that evidence, not from theory.

## What gets built

Everything new sits beside the application. Not one of the 39 tables, 285 database queries, 38 server actions or 22 scheduled jobs changes shape.

| New piece | Where | What it is |
| --- | --- | --- |
| `platform` schema | `packages/db` | Tenants, platform operators, entitlements, per-tenant settings, secret references, platform audit, impersonation grants |
| Tenant-aware `db` | `packages/db/src/client.ts` | One connection pool and one database role per tenant; the same `db` export the 285 call sites already import |
| `withTenant()` | `packages/db` | Opens a tenant scope; everything inside it reads and writes that tenant only |
| Tenant provisioning | `packages/db` | Creates a schema, role, grants, tables, seed rows and the first admin — lifted from today's `migrate.ts` |
| Super Admin console | `apps/web/app/(platform)` | A new route group with its own sign-in, never mixed with a tenant session |
| Entitlement checks | `packages/shared` | `requireFeature()` / `featureEnabled()`, used by pages, actions, agents and jobs |
| Per-tenant secrets | `packages/integrations` | `integration-<tenant>-<key>` naming, with tenant #1 keeping its existing names |
| Per-tenant job loops | `apps/worker/src/app.ts` | The same 22 jobs, each iterating tenants with per-tenant error isolation |

Two smaller changes inside existing files, both unavoidable and both enumerable: the two OAuth token caches gain a tenant key, and eight constants that read `process.env` once at import become functions so they can differ per tenant.

## How the application becomes multi-tenant

> **Diagram — tenant isolation: request path, pools and schemas.**
> A signed-in request resolves its tenant from the session and opens a `withTenant` scope.
> That selects one of several pools: tenant 1's pool connects as role `bodhlok_app` with
> `search_path = public`; tenant 2's connects as `acme_app` with `search_path = t_acme`.
> One Postgres database holds `platform` (tenants, operators, entitlements, settings),
> `public` (tenant 1, all 39 tables, not one row moved) and `t_acme` (tenant 2, all 39
> tables, built at provisioning). A pool with no tenant reaches an empty schema, so the
> query fails instead of quietly reading tenant 1.
> *(Drawn version in the live document.)*

Each tenant gets a Postgres schema holding the same 39 tables, a connection pool whose search path is fixed when the connection opens, and a database role granted that schema and nothing else. A scope opened at the start of a request selects the tenant; every query inside it is bound to that tenant without a single call site changing.

### This was built and tested, not assumed

Three mechanisms were tried against a real database. Two failed. A shared pool using transaction-scoped scoping changes commit timing, which breaks four behaviours the application depends on — the one-active-run lock, the agent budget reservation, the ad-change record written before the platform call, and the publishing rate-limit ledger. A reserved-connection approach cannot run transactions at all with the ORM as shipped, which would break all 19 existing transaction sites including the hourly funnel rebuild.

The pool-per-tenant mechanism passed every check. Then it was proven against the application itself: in a copy of the repository with **only the database client file replaced**, all 294 unit tests, all 7 type-check tasks and all 26 end-to-end tests passed, and the funnel rebuild — raw SQL inside a transaction — stayed inside its tenant.

### Two things the mechanism does not cover

Both are known, bounded, and in the plan. Work deferred until after a response is sent loses the ambient tenant, so the block that runs after an approval must open its own scope. And the chat endpoint streams through an async generator, which also loses it, so it must capture its tenant explicitly.

## Bodhlok becomes tenant #1 without moving a row

Bodhlok's data stays exactly where it is — the `public` schema of the existing database. It is **registered** as a tenant, not migrated into one.

```sql
INSERT INTO platform.tenants (slug, name, data_schema, status)
VALUES ('bodhlok', 'Bodhlok', 'public', 'active');
```

That one row is the whole of it. What this avoids, compared with adding a `tenant_id` column to every table:

| A column-based approach would need | This needs |
| --- | --- |
| `ALTER TABLE … ADD COLUMN tenant_id` on 39 tables | nothing |
| A backfill of every row, including the largest tables | nothing |
| 17 unique constraints dropped and rebuilt | nothing |
| 6 primary keys and 1 foreign key rebuilt | nothing |
| `brand_kit`'s singleton `CHECK` dropped | nothing |
| 30 upsert conflict targets revisited | nothing |

The two additive changes Bodhlok's database does take: the new `platform` schema, and a restricted database role for the application to connect as. Both are reversible by a connection-string change.

For the first stretch, tenant resolution returns Bodhlok for every request, so the live application behaves identically while the machinery goes in underneath it.

## Super Admin: the platform console

**A Super Admin is not a sixth role.** Today's `admin` is a *client's* role — it manages that client's people and ad spend caps. Adding `super_admin` to the role list would put a platform principal inside a tenant's user table, expose it in the Admin role dropdown, and let a client's admin grant it.

Instead, platform operators live in the `platform` schema with their own table, their own session cookie and their own JWT audience. A tenant's database never contains a platform principal, and a tenant admin can never escalate to one.

The console lives at `/super-admin` in the same Next.js application — sharing the database layer and the integrations catalogue, separated by session and schema rather than by process.

| Area | What it does |
| --- | --- |
| Tenants | Create, rename, suspend, resume, archive, delete. Suspend = sign-in refused and jobs skip the tenant; data untouched |
| Access | Every module and feature on or off per tenant; capacity limits; plans as presets |
| Configuration | The 27 per-tenant settings — GA4 property, Google Ads customer, Search Console site, site URL, feed token, allowed sign-in domains, alert webhook, budgets, which agents run, product and company name |
| Tenant users | List, add the first admin, deactivate. Day-to-day user management belongs to the Tenant Admin |
| Monitoring | Per tenant: failed jobs, failing connections, pending approvals, AI spend against budget, last run per agent, publishing failures |
| Support access | Read-only inspection, or time-boxed impersonation, both fully audited |

### What Super Admin deliberately cannot do

This list is what makes the platform sellable, so it is a design rule rather than a preference.

- **Approve anything on a tenant's behalf.** Approving a post, an ad change or a page is the client's decision, and the whole product is built around that gate. An impersonated session is refused by the approval action and by anything that spends money.
- **Read a tenant's integration secrets.** They are write-only, exactly as they are today.
- **Sign in as a tenant user invisibly.** Impersonation is time-boxed, recorded in `platform.impersonations`, attributed in the tenant's own audit log as `operator as user`, and shown as a banner inside the tenant's app while it is active.
- **Raise a tenant's ad spend caps quietly.** That is an audited configuration change the tenant can see.

## Creating a tenant

Super Admin fills in a name, a slug, a plan and a first admin's email address. Everything after that is automatic, idempotent and resumable — a failure halfway through is fixed by running it again.

Most of it is today's code. `packages/db/src/migrate.ts` is already an idempotent per-installation bootstrap; its body is lifted into `provisionTenant()` and both callers use it.

1. **Write the tenant row** with status `provisioning`.
2. **Create the schema** `t_<slug>` and a **database role** for it, granted that schema and nothing else, with its default search path pointing at an empty schema.
3. **Create the 39 tables** from generated, de-qualified DDL — not by replaying the committed migrations, for the reason below.
4. **Create and baseline its migration bookkeeping**, so the next deploy does not try to replay everything into it.
5. **Assert no foreign key leaves the schema** with a `pg_constraint` query. This check is mandatory, not optional.
6. **Seed one `connections` row per integration** in the catalogue — today's `migrate.ts` code.
7. **Seed ₹0 ad spend caps** for both platforms, so a new tenant cannot spend money until someone sets them.
8. **Seed the brand kit row.**
9. **Write every entitlement on**, explicitly — a new tenant receives the whole application by default.
10. **Seed settings** from the plan's defaults.
11. **Create the first tenant admin.**
12. **Set status `active`** and write the platform audit entry.

### Why step 3 does not replay the migrations

This was tested, and it fails silently. Running the committed migrations into a new schema — **including through Drizzle's own migrator with the per-schema option set** — produced 39 tables, correct bookkeeping, and **17 foreign keys pointing back at tenant #1**: the new tenant's approvals referencing Bodhlok's users, its conversion forwards referencing Bodhlok's events.

The cause is 18 `REFERENCES "public".…` clauses written into three of the migration files. A search path cannot override a schema that is named explicitly. Nothing errors; the damage is invisible unless you query the constraint catalogue.

Applying the same migrations with that qualification stripped produces 39 tables, **zero** escaping foreign keys, and a schema **structurally identical** to Bodhlok's — 642 structural lines, byte-for-byte diff clean. That is why provisioning uses generated DDL and ends with an assertion.

## Tenant Admin: managing their own people

Today's `admin` role is already a tenant administrator in everything but name. It keeps every capability it has, scoped to its own tenant and bounded by what Super Admin has enabled. **No existing admin screen changes** for a tenant with everything switched on.

**Unchanged, working exactly as now:**

- Add a person by email with a role; change a role; deactivate someone, which raises their session version and invalidates their cookies immediately
- The guard that refuses to leave the tenant with no admin
- Set daily and monthly ad spend caps
- Connect, disconnect, sync and verify all 26 integrations
- Approve whatever their role may approve; run any agent; read every run and its step log
- Edit the brand kit and the positioning brief

**New, because these are server environment variables today:** a Settings area holding the values a client legitimately owns — GA4 property, Google Ads customer and conversion actions, Search Console site, website address, page-feed token, product-event secret, allowed sign-in domains, alert webhook, which agent timers run, and the product and company name shown on the public pages. Each falls back to the current environment variable when a tenant has set nothing, which is how Bodhlok keeps behaving identically on day one.

**Read-only, set by Super Admin:** the tenant's modules, features, capacity limits and plan. Showing them rather than hiding them means a client can see what they have and what they could ask for; where a module is off, the sidebar simply omits it — no greyed-out doors.

**Out of scope, deliberately:** per-tenant custom roles. The five roles are woven into module access, approval authority, the agent map and a database constraint. Module-level entitlements already deliver what "limited access" means in practice. If it is needed later, the clean path is to keep the five roles as templates and let a tenant disable modules per role — an override layered on top, not a replacement.

## Full, Limited and Custom access

All three are the same mechanism with different rows. There is no separate "limited edition" of the product to maintain.

|  | What the tenant gets | How it is set |
| --- | --- | --- |
| **Full** | Every one of the 16 modules, every feature, default capacity limits. This is what a new tenant receives | The "Full" plan writes every entitlement row on |
| **Limited** | A named subset — say, content and approvals but no ads and no SEO | A plan preset writes the chosen rows on and the rest off |
| **Custom** | Any combination, changed whenever you like | Individual switches on the tenant's page, on top of whatever plan was applied |

A plan is a preset over entitlements, not a separate mechanism. Applying one overwrites the tenant's rows and is audited; per-tenant overrides on top of it stay possible, so "customise whenever I want" holds.

The effective rule everywhere in the application is one line:

```
access = the role allows this module  AND  the tenant has this module enabled
```

So a tenant with everything on behaves **exactly** as the application does today — same sidebar, same redirects, same refusals. That is checked by a test that pins today's role-by-module matrix and must keep passing unchanged.

## Module and feature permissions, changed without a deploy

Three kinds of switch, because "turn a feature off" means three different things in practice.

| Kind | Granularity | Example |
| --- | --- | --- |
| **Module** | One of the 16 | Ads manager off for a client who does no paid media |
| **Feature** | A capability inside a module | "May publish to Postiz", "agents may apply ad changes automatically", "may publish to the website CMS" |
| **Capacity** | A number | AI budget per month, creative generations per month, Postiz posts per hour |

Capacity is an entitlement rather than a config value for a reason: a shared Postiz server or a shared Anthropic key means one tenant can otherwise consume another's allowance.

### Enforced on five surfaces, not one

The common failure is gating the page and forgetting the action or the job. One helper, used in all five places:

| Surface | What a disabled module looks like |
| --- | --- |
| **Page** | Redirect, exactly as a role refusal does today |
| **Sidebar** | The item is absent |
| **Server action** | Refused, in the shape each action already returns |
| **Agent** | The run is refused when queued, so a timer cannot start a disabled tenant's agent |
| **Scheduled job** | The tenant is skipped and recorded as `skipped`, so the digest does not read it as a failure |

The last two matter most: those paths have no user, so a UI-level check would never run. A disabled module must stop the *work*, not just the view. A test enumerates all five — the repository already proves properties this way by walking the file tree.

### Taking effect without a deploy

Entitlements are read on nearly every request, so they want caching — and caching them is the easiest way to leak one tenant's configuration into another's request. The rules: cache per tenant with the tenant in the key, never in a bare module-level variable; a short time-to-live of 30 to 60 seconds so a Super Admin change lands within a minute; invalidate on write from the console; and read capacity live, never cached, wherever it gates spending.

### Turning something off does not break it

Existing rows stay — disabling SEO hides the module, it does not delete pages. A running agent finishes and records its result; the next one is refused. Approvals already pending for a now-disabled kind stay visible with a clear reason rather than vanishing. Jobs skip and say so. Re-enabling restores everything, because nothing was destroyed.

## Isolation

### Data

Each tenant has its own schema, its own connection pool and its own database role. The pool's search path is fixed when the connection opens, and the role is granted that schema and nothing else.

**Both halves are required, and the test that proves it is one line.** A search path on its own scopes *unqualified* names only: in the spike, a tenant's pool read `public.users` successfully simply by naming the schema. With a role granted only its own schema, the same read is **denied**. So the search path is a default and the role is the boundary. All 285 existing queries use unqualified names through the ORM, so they are scoped — but the privilege is what makes it isolation rather than convention.

A connection with no tenant set reaches an empty schema and fails loudly: `relation "users" does not exist`. That is deliberate — a lost tenant context breaks visibly instead of quietly reading Bodhlok.

### Users and sessions

A tenant's users live in that tenant's schema, so **one person can belong to two tenants** with no schema change — the existing global unique on email already means "unique within this tenant". The session gains a tenant claim, cross-checked against the host or path; a mismatch means signing in again, never trusting the cookie. Sign-in has to resolve the tenant *before* it looks the user up, which it does from the sealed OAuth state or a platform-level address directory.

### APIs and webhooks

Seven entry points carry no session. The rule: **the existing URLs never change and always mean tenant #1.**

| Entry point | New tenants | Tenant #1 |
| --- | --- | --- |
| Product events webhook | A per-tenant path with a per-tenant secret | Unchanged path, unchanged secret |
| The two CRM webhooks | The stored secret already identifies the tenant | Unchanged |
| The four page-feed routes | A per-tenant bearer token identifies the tenant | Unchanged token |

Resolving by secret beats resolving by URL, because a URL can be edited and a signature cannot. A delivery matching no tenant is recorded and rejected, never silently dropped — a rotated secret should not look like silence.

### Integrations and secrets

Secret names become `integration-<tenant>-<key>`, keeping the `integration-` prefix that the infrastructure's access rule requires — a name outside that prefix would be refused at runtime on the Cloud Run deployment. Tenant #1 keeps its existing names, so **no live secret is renamed, re-created or re-versioned**; that matters because each save destroys older versions, making a botched rename unrecoverable.

**The sharpest remaining risk is not in the database at all.** Two in-process caches hold OAuth tokens keyed by integration name only, with no tenant. Left alone, two tenants' Google Ads grants collide and whichever refreshed last wins — posting or spending on the wrong client's account, with no error and no failing test. They must be re-keyed in the same change that introduces per-tenant credentials, with a two-tenant test asserting two distinct tokens.

### Files

New storage paths gain a tenant prefix. Existing paths are **not** migrated — the database row holds the absolute truth and those rows live in tenant #1's schema. No route accepts a caller-supplied path: every path is generated server-side, and the asset route reads it from the row.

### Background jobs

The same 22 jobs keep their names, paths and times, so the check that holds the VM timers and the cloud scheduler in step keeps passing. Each job enumerates tenants and runs them in a per-tenant try/catch, so one tenant's failure cannot skip the rest, with its own pipeline row per tenant. Agent runs take their tenant as an explicit argument rather than relying on ambient context, because they outlive the request that started them — and the one-active-run lock becomes per-tenant for free, so one client's agent no longer blocks another's.

## Preserving every existing feature

The governing rule: **at every commit, the live application is a one-tenant installation of a multi-tenant system, and behaves exactly as it does today.** There is no intermediate state in which Bodhlok is half-migrated. Each phase ships on its own and is observable as a no-op.

### Guaranteed unchanged

| What | Guaranteed by |
| --- | --- |
| All 39 tables, their columns, constraints, indexes and the brand-kit singleton | The model changes no table |
| All 14 migrations | Unreplayed and unedited |
| All 285 query call sites, 54 raw-SQL sites, 30 upserts | Unchanged; only the connection differs |
| Bodhlok's data location | Stays in `public`, registered as tenant #1 |
| The five roles, module access and approval authority | Untouched; entitlements intersect, never replace |
| Every guardrail and its 43 tests | Untouched |
| The three approval re-checks and the spend-cap re-check at approval | Untouched |
| The 22 job names, paths and schedules | Unchanged, so the schedule-parity check keeps passing |
| The three registered webhook URLs and the OAuth redirect URIs | Frozen; new tenants get new paths |
| Existing secret names and storage paths | Resolved through the legacy names |
| Deploy, backup, pre/post-deploy checks and rollback | Extended, never replaced |

### The fallback layer

Every new per-tenant lookup falls back to today's source when a tenant has no value: settings fall back to their environment variables, capacity limits to the current caps, secret names to `integration-<key>`, feed and webhook secrets to the existing ones. So on the day each phase ships, Bodhlok reads exactly the values it reads now, from exactly where it reads them.

**One fallback is different and must be removed.** "If no tenant can be resolved at all, use tenant #1" is fail-open: any bug that loses the tenant reads Bodhlok's data. It is also load-bearing until every entry point sets a tenant — with it removed and no wrapping in place, **22 of 26 end-to-end tests fail**, which is the measured size of that work. So the order is fixed: wrap the entry points first, then remove the fallback, never the reverse. Provisioning refuses to create a second tenant while it is still on.

### Sessions in flight

Session cookies last 7 days. A cookie issued before the change carries no tenant claim, so a missing claim resolves to the default tenant and **nobody is signed out by the deploy**. The codebase already uses this pattern for an older claim. Switch the fallback off at least 7 days after the claim ships, and no live session can lack it.

### What will visibly change, and why it is acceptable

Honesty matters more than claiming nothing changes. URLs gain a tenant prefix *if* path-based addressing is chosen — avoidable, because un-prefixed paths can resolve the tenant from the session, so bookmarks keep working. Admin gains a Settings area, which is additive. Deploys take longer, because migrations run per tenant. And connection-pool pressure rises, which is measured rather than assumed.

## The phases

Seven phases. Each ships on its own, leaves the live application behaving as it does today, and rolls back by redeploying the previous release.

### Phase 0 — Decide and prove · mostly done

**Build:** nothing. **Done already:** the test suite runs green on Node 24 (294 unit tests, 26 end-to-end); the tenant mechanism was built and tested against a real database; the Hono advisories were investigated and found not exploitable.

**Still open:** a read-only comparison of the live schema against the repository. It needs database access, it is about an hour's work, and every later estimate depends on it.

**Done when:** the live schema is verified, or the risk of drift is accepted in writing.

### Phase 1 — The safety net · no tenancy code

**Build:** contract tests for the three webhooks and four feed routes; a test pinning today's role-by-module matrix; a database test of the approval flow including the spend-cap re-check; a funnel-rebuild test; an end-to-end run against an empty database; structural tests that every page guards and every action resolves a user; per-tenant backup added to the backup script and a restore drill actually performed; the pending dependency upgrades as their own commit.

**How:** six database test files already test against real Postgres — the new tests follow that pattern. One line in the build config so the test runner honours the database URL you point it at.

**Depends on:** nothing.

**Testing:** the existing pipeline, unchanged, plus the new tests.

**Done when:** the behaviours that must not change are pinned by tests, and a single tenant's data has been restored from its own dump without touching anything else.

*Worth doing even if multi-tenancy is cancelled.*

### Phase 2 — The control plane · invisible to Bodhlok

**Build:** the `platform` schema from its own migration set; the tenant-aware database client; tenant resolution with the default-tenant fallback and its removal gate; Bodhlok registered against `public`; all 22 pages, 38 actions and 19 routes wrapped; per-tenant settings with environment fallbacks, including turning the eight frozen constants into functions; per-tenant secret naming with legacy names for tenant #1; the two token caches re-keyed; tenant id on every log line; a separate owner connection for migrations, seed and backups, plus the grants the restricted role needs.

**How:** the client swap is one file — proven, with the whole suite passing through it. The wrapping is mechanical and reviewable; the two contexts that lose the ambient tenant (the deferred block after an approval, and the chat stream's generator) take explicit scopes.

**Depends on:** Phase 1's tests, so regressions are visible.

**Testing:** full suite; a query with no tenant throws; a schema-qualified cross-tenant read is denied; sessions issued before the deploy still work.

**Done when:** the live application runs entirely through tenant scopes, with one tenant, and behaves identically. Deploy the code first and the role switch second, each with a fresh backup.

### Phase 3 — Provisioning and the console

**Build:** `provisionTenant()`; the generated de-qualified DDL path with per-tenant bookkeeping and the constraint assertion; the migration loop reporting per tenant and failing the deploy on any failure; platform operators and their separate session; the console's tenant list, creation, suspend and detail pages; per-tenant settings and first-admin bootstrap; platform audit on every action including reads; extended pre- and post-deploy checks.

**How:** steps 6 to 11 of provisioning are today's bootstrap code, lifted.

**Depends on:** Phase 2.

**Testing:** provisioning twice is a no-op; an interrupted provision completes on re-run; the new schema matches Bodhlok's structurally with no foreign key escaping; a platform session is refused in the tenant app and vice versa; a new tenant's spend caps are ₹0.

**Done when:** a tenant can be created from the console. Still one live tenant.

### Phase 4 — Entitlements

**Build:** the entitlements table with every row written on at provisioning; the check helpers with per-tenant caching; module gating on all five surfaces; the feature flags and capacity limits with environment fallbacks; the console's editing screens and plan presets; graceful degradation; the Tenant Admin read-only view.

**Depends on:** Phase 3.

**Testing:** disabling a module stops the page, the sidebar, the action, the agent and the job — one test each; Bodhlok with everything on passes Phase 1's matrix test unchanged; a change takes effect within 60 seconds with no deploy.

**Done when:** modules and features can be switched per tenant from the console.

### Phase 5 — Entry points and jobs · the riskiest deploy

**Build:** per-tenant webhook entry points with the three legacy paths frozen; per-tenant feed tokens; all 22 jobs iterating tenants with per-tenant error isolation and pipeline rows; agent runs taking an explicit tenant through the queue, the runner and every tool; per-tenant AI, creative and publishing capacity accounting; a per-tenant digest; the seed and sample-data script scoped to one tenant and refusing to run unscoped on a multi-tenant database.

**Depends on:** Phase 4.

**Testing:** the Phase 1 contract tests pass unchanged; a payload signed with tenant B's secret lands on tenant B and is invisible to tenant #1; secret matching is constant-time; a job that throws for one tenant still processes the rest; two tenants' agents run concurrently; the full isolation set passes; **the pipeline runs with two tenants present**, because a one-tenant run cannot catch these bugs.

**Done when:** two tenants run side by side. Do not switch off the default-tenant fallback until this passes.

### Phase 6 — The second tenant, for real

**Build:** provision a pilot tenant and run it internally for a fortnight; switch off the fallback at least 7 days after the tenant claim shipped; watch pool usage, migration duration and job runtime against the Phase 0 baseline; support impersonation if you want it; the tenant's own name in the sidebar in place of the hard-coded one.

**Done when:** a second tenant is in production and Bodhlok is demonstrably unchanged over that fortnight — no new failed jobs, no new failed publishes, the funnel matching.

### Phase 7 — Product work for non-astrology tenants · only if needed

**Build:** agent prompts taking the tenant's industry, audience and product from the brand kit instead of hard-coded prose; per-tenant skills; per-tenant SEO page templates; configurable funnel stage names; the astrology-specific feed as an optional feature; full white-labelling.

This is a product workstream, not isolation work, and it is only needed if tenants are not astrology brands. Its size is genuinely uncertain until that is decided.

## Rollout order and gates

> **Diagram — rollout: 7 phases, 6 gates.** No phase starts until the previous gate passes.
> Phase 0 Decide and prove (~1 day left) → *live schema verified against the repository* →
> Phase 1 Safety net (1–1.5 wk) → *behaviour pinned by tests, single-tenant restore proven* →
> Phase 2 Control plane (2–3 wk) → *Bodhlok behaves identically through tenant scopes* →
> Phase 3 Provisioning and console (2–3 wk) → *a tenant can be created, with no foreign key
> escaping it* → Phase 4 Entitlements (2 wk) → *role matrix unchanged for a fully entitled
> tenant* → Phase 5 Entry points and jobs, the riskiest deploy (2–3 wk) → *two tenants pass
> the whole suite, run side by side* → Phase 6 Second tenant, for real (1–2 wk).
> *(Drawn version in the live document.)*

Phases 0 and 1 carry no risk to the live application at all — one is read-only, the other adds tests — so they are worth starting whatever you decide about the rest. Phase 7, the product work for non-astrology tenants, sits outside this sequence and is only needed depending on your answer about who the tenants are.

The gate matters more than the schedule. Each one is a measurable condition, not a judgement call, and the two most likely to be skipped under time pressure are the ones that catch the failures this architecture is actually exposed to: the foreign-key assertion after provisioning, and running the whole suite with two tenants present rather than one.

## Migrating production data

**There is almost nothing to migrate, and that is the point of the design.** Bodhlok's rows never move. No backfill runs over live tables, no primary key is rebuilt, no constraint is dropped and rebuilt. The live database takes two additive changes: a new schema beside the existing one, and a restricted role for the application to connect as.

This plan assumes **no production database access today**, and nothing in it requires any. Here is what happens when access arrives.

### Step 1 — Verify the live schema · read-only, about an hour

The one task that genuinely needs access, and the highest-value hour in the project.

1. Dump the live schema definition and compare it against a database built from the committed migrations on a scratch instance.
2. Compare the applied-migration list against the 14 files in the repository.
3. Record row counts for the largest tables.

The repository's own history shows live and repo have diverged before, so any difference is treated as a blocker and resolved as ordinary work **before** tenancy begins, not during it. Nothing here writes.

### Step 2 — Rehearse on a restored copy

Restore a recent backup into a scratch database and run the whole sequence against it: create the platform schema, register tenant #1, switch to the restricted role, provision a second tenant, run the suite. This doubles as the restore drill the runbook asks for and has never had.

### Step 3 — Apply to production, in reversible order

| Step | Action | Reversed by |
| --- | --- | --- |
| 1 | Fresh backup, verified to restore | n/a |
| 2 | Read-only pre-deploy checks | n/a |
| 3 | Create the platform schema and its tables | Drop the schema |
| 4 | Register Bodhlok as tenant #1 | Delete the rows |
| 5 | Deploy code where tenant resolution always returns Bodhlok | Redeploy the previous release |
| 6 | Switch the application to its restricted role | Switch the connection string back |
| 7 | Post-deploy checks and the end-to-end suite against live | n/a |

Steps 3 to 5 are safe because the new code reads the same tables through the same queries. Step 6 is deployed alone precisely because it is the one that proves failure-closed behaviour, and it is the easiest step in the plan to undo.

### There is no irreversible database step in this plan

Every migration is additive: a new schema, new tables in it, new nullable columns, new indexes. Nothing is dropped, no type changes, no constraint removed. That is what keeps "repoint the release and restart" a working rollback at every phase — and it is a direct consequence of choosing schemas over a tenant column.

## Effort, risks, backup and rollback

### Effort

One experienced developer who knows this codebase, excluding your review time. Ranges, because two unknowns remain: the live schema check, and whether tenants are astrology brands.

| Phase | Effort | Risk to the live app |
| --- | --- | --- |
| 0 Decide and prove | mostly done; \~1 day left | none · read-only |
| 1 Safety net | 1–1.5 weeks | none · tests only |
| 2 Control plane | 2–3 weeks | low |
| 3 Provisioning and console | 2–3 weeks | low |
| 4 Entitlements | 2 weeks | low |
| 5 Entry points and jobs | 2–3 weeks | medium |
| 6 Second tenant | 1–2 weeks + pilot | medium |
| **Phases 0–6** | **10–14 weeks** |  |
| 7 De-branding | 4–8 weeks | low · only if needed |

### The risks that matter

| Risk | Why it is contained |
| --- | --- |
| **Cross-tenant data leak** | The role, not the code, is the boundary; a lost tenant context fails loudly rather than reading tenant #1 |
| **Provisioning creates cross-tenant foreign keys** | Confirmed real, and silent. Contained by generated de-qualified DDL plus a mandatory constraint assertion after every provision |
| **OAuth token caches collide** | The sharpest residual risk: no error, no failing test, wrong client's account. Must be re-keyed in the same commit as per-tenant credentials, with a two-tenant test |
| **A job fails for one tenant and skips the rest** | Per-tenant try/catch and per-tenant pipeline rows; retries are per tenant |
| **Entitlements gated on pages but not jobs** | One helper used on all five surfaces, with a test enumerating each |
| **Live schema drift** | Unknown until the read-only check runs; treated as a blocker, not a surprise |
| **Connection pressure** | Measured, not assumed: idle tenants release every connection; the budget is active tenants × pool size × instances |
| **A tenant count beyond this design** | Past roughly fifty tenants, a tenant column with row-level security becomes the better model. The application code is nearly identical either way |

### Backup

The nightly dump and 14-day retention stay as they are. **One addition is required before a second tenant exists:** a per-tenant dump, so one client can be restored without rolling every other client back to last night. Without it, "restore from backup" quietly stops being a per-client remedy — which is a promise you do not want to discover you have made.

### Rollback

**Application rollback** is unchanged and takes seconds: point the release symlink at the previous build and restart. It is safe at every phase, because no migration in this plan is destructive.

**The one step with its own rollback** is the switch to the restricted database role. If the application starts failing with missing-relation errors, a tenant scope is missing somewhere: switch the connection string back and restart. The application then behaves exactly as today — it simply no longer fails closed. That is why it ships alone.

**Data rollback:** one tenant damaged → restore that tenant's schema dump. The whole database damaged → today's documented restore. A tenant provisioned wrongly → drop its schema and its platform rows, which is clean because nothing else references it.

### Staging

There is no staging environment today, and the VM deploy path has no automated gate. For work that changes how every query reaches the database, that gap matters more than usual. The minimum: a second database holding a restored copy of a recent backup, deployed to before the live deploy — which doubles as the restore drill. Failing that, deploy Phases 2 and 5 immediately after a verified backup, outside the agents' busy window, with the timers stopped until the post-deploy checks pass.

## Decisions needed from you

These are product and commercial choices the code cannot answer. The first three block Phase 1; the rest can be settled during it.

1. **How many tenants do you expect, and how soon?** Five pilot clients and fifty are different architectures. This is the one answer that could still change the design: past roughly fifty, a tenant column with row-level security becomes the better model.
2. **Who are the tenants — other astrology brands, or any business?** The agents, the five bundled skills, the accuracy rules and the programmatic page templates are all built for this one client. Generic tenants need those made per-tenant content, which is Phase 7 and is a product workstream of its own.
3. **How does a tenant reach the app — path, subdomain or custom domain?** Not cosmetic: Google's OAuth accepts no wildcard redirect URIs, so subdomains need one central callback host. Path-based is recommended first, because it needs no new OAuth registration and no DNS work, and subdomains can be layered on later.
4. **Which services are shared and which are per tenant?** Specifically the Anthropic key and who pays for agent spend; whether Postiz is one shared server or one per client; and whether each client brings its own analytics, ads and search accounts, which is almost certainly yes.
5. **What support access may Super Admin have?** Read-only inspection, time-boxed impersonation, or neither. Impersonation as designed is audited and visible to the tenant, and is refused for approvals and anything that spends money.
6. **Is "restore last night's backup" still an acceptable remedy?** With a shared database it restores every tenant at once, until per-tenant dumps are added in Phase 1.
7. **Can one person belong to two tenants?** This design allows it for free. Worth confirming you want it, since agencies will ask.

---

The evidence behind this plan — the full audit, the test runs, the spike output and the per-criterion results — is in `docs/multi-tenant/` in the repository, 22 documents built over the preceding sessions. This plan is the single document that supersedes them for execution; they remain the record of how each conclusion was reached.

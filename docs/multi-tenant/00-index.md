# Multi-tenant transformation: audit and plan

A read-only audit of BODH Growth OS (live at `growth.rechargestudio.com`) and a plan for turning it
into a multi-tenant SaaS platform **without changing how the current application behaves**.

Nothing in this folder changes the application. No code, schema, migration or existing file was
touched while writing it. Every factual claim cites a file and line, and **every citation in these
documents was verified by printing the cited line** — so you can check any of them in seconds.

**How much of the repository this audit read** (356 tracked files), stated so you can judge the
weight of each claim:

| Depth | What |
|---|---|
| **Read in full** | `packages/db/src/schema.ts` (all 867 lines), `client.ts`, `migrate.ts`, `funnel.ts` (the rebuild), `apps/web/lib/auth.ts`, `session.ts`, `audit.ts`, `apps/web/proxy.ts`, `next.config.ts`, `apps/worker/src/app.ts`, `seed-guard.ts`, `packages/shared/src/roles.ts`, `modules.ts`, `integrations.ts`, `packages/integrations/src/secrets.ts`, `storage.ts`, `packages/agents/src/prompts.ts`, `cost.ts` (prices and budget), `apps/web/app/api/assets/[id]/route.ts`, `api/chat/route.ts`, `api/auth/callback/google/route.ts`, `app/(app)/approvals/actions.ts`, `admin/actions.ts`, `connections/actions.ts`, `community/actions.ts`, `strategy/actions.ts`, `components/app-shell.tsx`, `scripts/vm/job.sh`, `backup.sh`, `predeploy-check.sql`, `remove-sample-data.sql` (head), `scripts/prod-check.sh`, `infra/iam.tf`, `secrets.tf`, `database.tf`, `scheduler.tf`, `.github/workflows/ci.yml`, `deploy.yml`, `docs/operations.md` (the relevant sections), `e2e/smoke.spec.ts`, `packages/db/migrations/meta/_journal.json` |
| **Inventoried mechanically** (grep/count across every non-test source file, results in the docs) | all 39 tables and their keys; all unique constraints and foreign keys; every `process.env` read; every `"use server"` export and its guard, checked one by one; every `route.ts` and its auth; every `db.*` and `tx.*` call site; every raw `sql` site; every `onConflict*` site and its target; every module-level mutable or collection constant; every `Cache-Control`, `revalidate`, `unstable_cache` and `dynamic` export; every timer and scheduler job; every hard-coded host; every test file and case count; all 14 migration files for `"public".` qualification and bookkeeping |
| **Sampled** | `packages/integrations/src/*` (53 files — read where cited: `publisher.ts`, `crm.ts`, `google-oauth.ts`, `reddit.ts`, `creative.ts`, `seo.ts`, `site-publisher.ts`, `validate.ts`, `ga4*.ts`, `ads.ts`), `packages/agents/src/tools*.ts`, `run.ts`, `chat.ts`, `skills.ts`, `scripts/vm/install.sh`, `deploy-vm.sh` |
| **Read in part** | `PLAN.md` (headings, the roles table, the open questions), `infra/run.tf` and `storage.tf` (instance counts, pool size, bucket settings), `scripts/vm/install.sh` (migrate, restart and timer sections), `deploy-vm.sh` (targets and release flow), `postdeploy-check.sql` (its migration-count assertion) |
| **Not read** | the five agent skill files' contents, `apps/worker/src/seed.ts` beyond its destructive statements, most `page.tsx` bodies (their guards and `dynamic` exports were checked mechanically), the test bodies (titles and counts only), `infra/{apis,github,outputs,postiz,registry,variables,versions}.tf` |

Nothing in the documents rests on the "not read" row. Two notes from the partial reads that matter:
`PLAN.md`'s roles table matches `packages/shared/src/modules.ts`, and **it contains no mention of
tenants, multiple clients, white-labelling or SaaS** — there is no prior design intent for this work
to align with. And `infra/iam.tf:17` turned out to constrain the secret-naming scheme
([13 §13.5](13-tenant-isolation.md#135-secrets)), which is why the Terraform was worth reading.

## The documents

| # | Document | What it answers |
|---|---|---|
| 1 | [Architecture](01-architecture.md) | How the app is built and what runs where |
| 2 | [Module inventory](02-module-inventory.md) | Every module, page, action, route and job |
| 3 | [Database schema](03-database-schema.md) | All 39 tables, keys, and who would own each row |
| 4 | [Auth and permissions](04-auth-permissions.md) | Sign-in, sessions, roles, module access |
| 5 | [Workflows](05-workflows.md) | The business processes the app runs end to end |
| 6 | [Integrations](06-integrations.md) | All 26 integrations and how credentials are held |
| 7 | [Single-tenant dependencies](07-single-tenant-dependencies.md) | Everything that assumes one client |
| 8 | [Risk assessment](08-risk-assessment.md) | What could break, how likely, and the mitigation |
| 9 | [Recommended architecture](09-target-architecture.md) | The isolation model, with the numbers behind it |
| 10 | [Super Admin](10-super-admin.md) | The platform console you asked for |
| 11 | [Tenant Admin](11-tenant-admin.md) | What a client's own admin gets |
| 12 | [Entitlements](12-entitlements.md) | Per-tenant module and feature switches |
| 13 | [Tenant isolation](13-tenant-isolation.md) | How data, users, secrets and files stay apart |
| 14 | [Data migration](14-data-migration.md) | Moving today's live data into tenant #1 |
| 15 | [Backward compatibility](15-backward-compatibility.md) | What must keep working unchanged |
| 16 | [Regression testing](16-regression-testing.md) | The baseline today, and the safety net to add |
| 17 | [Roadmap](17-roadmap.md) | Phases and work packages |
| 18 | [Deployment and rollback](18-deployment-rollback.md) | Shipping each phase safely |
| 19 | [Acceptance criteria](19-acceptance-criteria.md) | Done means this, per phase |
| 20 | [Baseline run](20-baseline-run.md) | The suite actually run (19 Nov 2026): green, plus dependency advisories worth a look |
| 21 | [Phase 0 verification](21-phase0-verification.md) | Node 24, the Hono advisories, and the **W0.4 spike** — which falsified the mechanism doc 9 proposed |

## The short version

The application is a well-built **single-tenant** system. It is single-tenant in a deeper way than a
missing `tenant_id` column:

1. **No row anywhere carries an owner.** All 39 tables ([3](03-database-schema.md)) are written and
   read as "the one client's data".
2. **Six tables are keyed by a natural key, not a row id** — `connections.key`, `budgets.platform`,
   `publishing_channels.channel`, `brand_kit` (a `CHECK (id = 1)` singleton), `billing_accounts`,
   `payments`. Under a shared-schema model these are the riskiest tables in the project, because the
   primary key itself has to change; under the recommended model they need no change at all, which
   is a large part of why it is recommended.
3. **Integration credentials are global.** One secret per integration, named
   `integration-<key>` (`packages/integrations/src/secrets.ts:124`). One Postiz account, one Google
   Ads account, one GA4 property for the whole installation.
4. **Tenant identity lives in environment variables**, not in the database: `GA4_PROPERTY_ID`,
   `GOOGLE_ADS_CUSTOMER_ID`, `SEARCH_CONSOLE_SITE`, `SEO_SITE_URL`, `BODH_EVENTS_SECRET`,
   `ALLOWED_EMAIL_DOMAINS` and others ([7](07-single-tenant-dependencies.md)).
5. **The product itself is Bodhlok-shaped.** The agents, skills and SEO page templates are about
   Vedic astrology software (`packages/agents/src/prompts.ts:6-21`). That is a product decision, not
   a code problem — see the decisions below.

The work is real but tractable. The measured surface: **285 database call sites** in 67 files,
**19 transaction call sites**, **54 raw-SQL sites**, **30 upserts**, **39 tables**, **17 global
unique constraints**, **6 natural primary keys**, **38 server actions**, **19 API routes**, **22
scheduled jobs**.

[9](09-target-architecture.md) compares the three isolation models against those numbers, and the
numbers point somewhere specific: **one Postgres schema per tenant, in one database, with a shared
`platform` schema for the control plane.** It is the only model that needs **zero** changes to the
39-table schema, the 17 unique constraints, the 6 primary keys, the 30 upserts and all 285 query
call sites — so five of the severe risks in [8 §8.1–8.2](08-risk-assessment.md#81-critical-risks)
(R1, R2, R5, R8 and R23) simply do not arise, at the cost of three of its own (R24, R25, R26), which
are named and mitigated. Bodhlok's current `public` schema becomes tenant #1 with nothing moved and no backfill over
live rows. A `tenant_id` column with Row-Level Security is the right answer instead **if you expect
more than roughly fifty tenants**, which is why the tenant-count question below blocks Phase 0.

Either way, one mechanism has to be proven first — putting the tenant onto the same pooled
connection as every query — and this audit ran no code, so
[9 §9.6](09-target-architecture.md#96-spike-status-six-of-eight-criteria-pass) specifies it
as a Phase 0 spike with eight explicit pass/fail criteria.

## What this audit could not see

- **The live database.** No production credentials were used and none were requested. Row counts, the
  applied migration list and any drift between the live schema and this repository are **unverified**.
  Git history shows this has happened before (`45f796f` "Merge the audit follow-up onto the live
  release", `b2400b2`), so assume drift until checked.
- **The deployed commit.** `growth.rechargestudio.com` is deployed from a VM by hand
  (`scripts/deploy-vm.sh:18`), so the live code is whatever was last pushed, not necessarily `main`.
- ~~**Test results.**~~ **Now done.** The suite was installed and run on 19 Nov 2026 and is
  **green**: 294 unit tests and 26 Playwright tests, nothing failing
  ([20](20-baseline-run.md)). CI's own log confirms the same 294. One smaller defect did turn up:
  **`pnpm test` silently ignores `DATABASE_URL`** (Turbo strips it), so pointed at any database other
  than the default port the 36 database tests skip while the suite still reports success. CI is
  unaffected, because the tests' hardcoded fallback happens to be CI's own database — but a
  two-tenant fixture will not be on that port, so it is worth the one-line fix in Phase 1.
- ~~**The `withTenant` mechanism**~~ **Now run** ([21 §21.3](21-phase0-verification.md#213-withtenant-does-not-exist-yet--and-the-design-on-paper-was-wrong)).
  It found that **no such mechanism exists in the code** (it was only ever a proposal), that the
  design doc 9 specified **does not work** on this stack, and that a different one — a connection
  pool **and database role** per tenant — passes six of eight criteria. Two contexts (`after()` and
  `/api/chat`'s async generator) lose the tenant and need explicit scopes. Doc 9 has been rewritten.
- **Still unverified: the live database** (W0.2, read-only, about an hour), **per-request tenant
  resolution in Next**, and a **connection pooler** that preserves a connection-level `search_path`.

## Decisions needed from you

These are product and commercial choices the code cannot answer. Phase 0 in
[17](17-roadmap.md) is blocked on 1, 2 and 3.

1. **How does a tenant reach the app?** Path (`/t/acme/...`), subdomain (`acme.growth…`), or custom
   domain? This is not cosmetic: Google OAuth has **no wildcard redirect URIs**, so per-tenant
   subdomains need one central callback host that redirects onward. See
   [13](13-tenant-isolation.md#133-addressing-and-oauth).
2. **Who are the tenants?** Other astrology brands, or any business? The agents, the five bundled
   skills, the Jyotish accuracy rules, the panchang feed and the programmatic SEO templates are all
   Bodhlok-specific. Generic tenants need those made per-tenant content, which is a product
   workstream of its own, not part of the isolation work.
3. **Which services are shared and which are per tenant?** Specifically: the Anthropic key and who
   pays for agent spend; whether Postiz is one shared server or one per tenant; whether each tenant
   brings its own GA4, Google Ads and Search Console (almost certainly yes) and its own CRM.
4. **How many tenants do you expect, and how soon?** Five pilot clients and fifty are different
   architectures: it decides whether database-per-tenant is viable
   ([9](09-target-architecture.md#92-the-comparison)).
5. **Does today's client stay on its own database?** Under the recommended model it does not need
   to: Bodhlok stays in the existing `public` schema of the existing database and new tenants get
   schemas beside it, which keeps per-tenant backup and restore working
   ([7](07-single-tenant-dependencies.md#711-tenant-blind-destructive-and-operational-tooling)). A
   separate database per client is still available for anyone who requires physical isolation, and
   costs one connection pool each. Either way Bodhlok's database does take two additive changes: the
   new `platform` schema, and the restricted application role
   ([14](14-data-migration.md#142-what-is-actually-created)).
6. **What support access may Super Admin have?** Reading a tenant's data, impersonating a tenant
   user, and both are different promises to make to a client. [10](10-super-admin.md) proposes
   time-boxed, audited impersonation that the tenant can see.
7. **Is "restore last night's backup" still an acceptable remedy?** With a shared database it
   restores every tenant at once. If each client needs independent recovery, that is an argument for
   separate databases, or for per-tenant logical exports built in Phase 1.

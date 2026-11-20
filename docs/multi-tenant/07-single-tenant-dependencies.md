# 7. Single-tenant dependency analysis

Everything in the application that assumes exactly one client. This is the measurement the model
choice in [9](09-target-architecture.md) rests on; each item names where it is and what it costs to
change.

**§7.1 and §7.2 state what a shared-schema (`tenant_id`) model would require.** Under the
recommended schema-per-tenant model the schema and the constraints are untouched, and the dependency
that remains is everything from §7.3 onwards — the entry points, the configuration, the secrets, the
caches, the files, the jobs and the brand. Those apply to **every** model.

## 7.1 No ownership column anywhere

All **39 tables** are read and written as "the client's data". There is no `tenant_id`,
`organisation_id`, `account_id` or equivalent, and no ownership check in any of the **285** database
call sites across **69** files, or the **54** raw-`sql` sites.

Six tables are keyed by a **natural key**, so in a shared-schema model the primary key itself has to
change — the riskiest class of schema change in this project ([3](03-database-schema.md#32-the-six-natural-key-tables)):
`connections.key`, `budgets.platform`, `publishing_channels.channel`,
`brand_kit` (`id integer` with `CHECK (id = 1)`), `billing_accounts.mp_account_id`,
`payments.invoice_id`.

## 7.2 Global uniqueness

**17 unique constraints** are global and must be re-keyed on `tenant_id`
([3](03-database-schema.md#33-global-uniqueness-that-breaks-with-two-tenants)). Two deserve calling
out:

- **`agent_runs_one_active_idx`** (`packages/db/src/schema.ts:78`) allows one queued-or-running run per agent name
  across the whole database. With two tenants, **tenant B's content agent cannot start while tenant
  A's is running**, and the worker returns `409 "The content agent is already running"`
  (`apps/worker/src/app.ts:380`). This is an availability bug that a single-tenant test suite cannot
  catch.
- **`users.email`** (`packages/db/src/schema.ts:25`) is globally unique, so one person cannot exist in two tenants.
  Whether that is wrong is a product decision, not a technical one — but it will come up the first
  time an agency manages two clients.

## 7.3 Entry points with no user

Six entry-point classes carry no session, so the tenant cannot come from `getCurrentUser()`:

| Entry point | Authenticated by | How a tenant could be resolved |
|---|---|---|
| `POST /api/events/bodh` | HMAC with `BODH_EVENTS_SECRET` (one global secret) | Per-tenant secret + per-tenant path or header; **the existing path must stay bound to tenant #1** |
| `POST /api/events/crm-billing` | HMAC with the stored webhook secret | Per-tenant secret; the secret identifies the tenant |
| `POST /api/events/crm-leads` | HMAC with the stored webhook secret | As above |
| `GET /api/feed/*` (4 routes) | Bearer `SEO_FEED_TOKEN` (one global token) | Per-tenant token; the token identifies the tenant |
| `GET /api/assets/[id]` | Signed-in user, **but no ownership check** (`apps/web/app/api/assets/[id]/route.ts:13`) | Must additionally check the asset's tenant — today any signed-in user can fetch any asset id |
| All 22 worker jobs | Shared `WORKER_TOKEN` | Each job must iterate tenants, or be scheduled per tenant |
| OAuth callbacks | OAuth state cookie | The state is sealed and signed; a `tid` can be added to it |

`/api/assets/[id]` is worth a second look even before multi-tenancy: it authenticates but does not
authorise. Once tenants exist, it becomes a cross-tenant read.

## 7.4 Tenant identity living in environment variables

Built from a grep of `process.env.*` across `apps`, `packages` and `scripts` — **70 distinct
variables read by the code**. The ones below are not deployment settings; they are **the client's
identity**, and each becomes per-tenant configuration.

| Variable | Read in | What it really is |
|---|---|---|
| `GA4_PROPERTY_ID`, `GA4_BQ_DATASET`, `GA4_BQ_PROJECT` | `apps/web/lib/ga4.ts:36`, `packages/integrations/src/ga4.ts` | The client's analytics property |
| `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`, `GOOGLE_ADS_CONVERSION_ACTIONS` | `packages/integrations/src/google-ads.ts:22` | The client's ad account and conversion actions |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | same | Arguably platform-level (one MCC), but tied to the account |
| `SEARCH_CONSOLE_SITE` | `apps/web/lib/integrations/search-console.ts:26` | The client's search property |
| `SEO_SITE_URL` | `packages/integrations/src/site-publisher.ts:20` | The client's website |
| `SEO_FEED_TOKEN` | the four `/api/feed/*` routes | The bearer token the client's website uses |
| `SEO_AUDIT_MAX_PAGES` | `packages/integrations/src/seo.ts:138` | The client's crawl allowance |
| `BODH_EVENTS_SECRET` | `apps/web/app/api/events/bodh/route.ts:13` | The shared secret with the client's product backend |
| `ALLOWED_EMAIL_DOMAINS` (and the legacy `ALLOWED_EMAIL_DOMAIN`) | `apps/web/lib/google.ts:23`, `apps/web/app/signin/page.tsx:22` | The client's staff Workspace domain |
| `ALERT_WEBHOOK_URL`, `ALERT_ALWAYS` | `packages/integrations/src/ops.ts:52` | Where the client's digest goes |
| `AI_MONTHLY_BUDGET_USD`, `AI_RUN_CAP_USD` | `packages/agents/src/cost.ts:95` | The client's AI spend allowance |
| `CREATIVE_MONTHLY_IMAGES`, `..._VIDEOS`, `..._PER_USER` | `packages/integrations/src/creative.ts:9-10` | The client's generation allowance |
| `POSTIZ_HOURLY_BUDGET` | `packages/integrations/src/publisher.ts:10` | The client's share of Postiz throughput |
| `ENABLE_NEW_AGENT_TIMERS` | `scripts/vm/install.sh:118` | Which agents the client runs |
| `SKILLS_DIR` | `packages/agents/src/skills.ts:50` | Extra agent skills for the client |
| `PRODUCT_NAME`, `COMPANY_NAME`, `CONTACT_EMAIL` | `apps/web/lib/legal.ts:6-8` | **Already env-driven white-labelling** — see below |
| `DEV_USER_EMAIL`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME` | `apps/web/lib/auth.ts:47`, `packages/db/src/migrate.ts:34` | The client's first users |
| `APP_URL` | 8 sites, incl. `apps/web/lib/google.ts:19`, `packages/integrations/src/validate.ts:48` | **The one origin the installation lives at** — see below |

That is **27 variables** that carry client identity. They move into a per-tenant settings store,
with the environment variable kept as the fallback for the default tenant — which is what preserves
today's behaviour exactly ([15](15-backward-compatibility.md)).

Genuinely platform-level and staying in the environment: `DATABASE_URL`, `DB_SOCKET_DIR`,
`DB_POOL_SIZE`, `AUTH_SECRET`, `NODE_ENV`, `PORT`/`WORKER_PORT`/`WORKER_HOST`/`WORKER_URL`/
`WORKER_TOKEN`/`WORKER_USE_ID_TOKEN`, `SECRETS_BACKEND`, `SECRETS_DIR`, `ALLOW_LOCAL_SECRETS`,
`GCP_PROJECT_ID`, `STORAGE_BACKEND`, `GCS_BUCKET`, `UPLOADS_DIR`, `ALLOW_LOCAL_STORAGE`,
`LOG_LEVEL`, `SERVICE_NAME`/`K_SERVICE` (the log's service label,
`packages/shared/src/log.ts:33`), `VERTEX_*`, the model names (`AGENT_MODEL`, `OPENAI_MODEL`,
`PERPLEXITY_MODEL`, `GEO_*_MODEL`), `META_GRAPH_VERSION`, `GOOGLE_ADS_API_VERSION`, the
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` staff sign-in app, the seed guards (`SEED_CONFIRM`,
`SEED_ALLOW_PRODUCTION`), `CI` and `E2E_BASE_URL`.

Two findings worth separating out:

**White-labelling already exists, partially.** `apps/web/lib/legal.ts:6-8` reads `PRODUCT_NAME`,
`COMPANY_NAME` and `CONTACT_EMAIL` with defaults of "Growth OS", "Recharge Studio" and a
Recharge Studio address, and the three public pages and their footer use them throughout
(`apps/web/app/(public)/`). So the *legal* surface is already parameterised — it just has one value
per installation instead of one per tenant. The *application* surface is not: the sidebar's
"BODH Growth / Bodhlok marketing" is hard-coded (`apps/web/components/app-shell.tsx:34-35`).

**`APP_URL` is the single-origin assumption, in one variable.** It is read in 8 places, and two of
them build OAuth redirect URIs from it (`apps/web/lib/google.ts:19`,
`packages/integrations/src/validate.ts:48`). Whatever URL model is chosen
([13](13-tenant-isolation.md)), this variable is where it lands, and
`packages/integrations/src/validate.ts:48` additionally falls back to the literal
`https://growth.rechargestudio.com`.

**Documented but not read by any code:** `META_LEADS_VERIFY_TOKEN`, `META_APP_SECRET` and
`GOOGLE_LEADS_WEBHOOK_KEY` appear in `.env.example` but in no source file. They belong to lead-form
webhooks that are not implemented. They need no tenancy work, and the `.env.example` entries are
stale.

## 7.5 One global credential per integration

`secretName(key) = "integration-" + key` (`packages/integrations/src/secrets.ts:124`) — see
[6](06-integrations.md#62-how-credentials-are-held). One Postiz account, one Google Ads grant, one
GA4 service account, one CMS key for the whole installation.

Related and more dangerous: **two in-process caches are keyed without a tenant**
(`packages/integrations/src/google-oauth.ts:90`, `packages/integrations/src/reddit.ts:60`). Left as they are, they would hand one tenant's access token
to another tenant's request. See [6](06-integrations.md#63-in-process-caches--a-real-cross-tenant-leak-risk).

## 7.6 Storage paths with no owner

`storagePathFor` produces `uploads|generated/<timestamp>-<random>-<name>`
(`packages/integrations/src/storage.ts:24`) — one flat namespace in one bucket. Existing paths are
stored in `assets.storage_path` and must keep resolving, so the fix is prefixing **new** paths
(`t/<tenant>/uploads/...`) and leaving old ones alone.

## 7.7 Jobs that assume one client

All 22 scheduled jobs are written as "do the thing for the client". They have no tenant parameter, so
each must either loop over tenants or be scheduled per tenant. Specific hazards:

- **Partial failure**: a loop that throws on tenant 3 leaves tenants 4..N unprocessed. Today a
  failure affects one client, which is also the only client. Per-tenant error isolation and
  per-tenant `pipeline_runs` rows are needed.
- **Fan-out**: `ops/alerts` verifies every credential nightly; with 20 tenants that is 20× the
  provider calls, within provider rate limits.
- **Fire-and-forget agent runs** (`apps/worker/src/app.ts:381`) start work that outlives the HTTP
  response: `void agents.runAgent(...)`. An `AsyncLocalStorage` context would technically survive
  that, but relying on it is fragile — the run also reconnects, retries and makes minute-long LLM
  calls. The tenant should be passed **explicitly** as an argument through `queueRun`, `runAgent`
  and every agent tool, as a deliberate policy rather than an ambient value.
- **Budget**: AI and creative caps are read from the environment, so every tenant would share one
  cap.

## 7.8 Shared outbound rate limits

Postiz's 30 create-posts/hour, the AI monthly budget, creative generation caps and provider API
quotas are all installation-wide ([6](06-integrations.md#65-outbound-rate-limits-and-quotas-that-become-shared-resources)).
Without per-tenant accounting, one tenant can consume another's capacity.

## 7.9 Hard-coded hosts and brand

- `https://growth.rechargestudio.com` appears in `packages/integrations/src/validate.ts:48` and in
  the CRM webhook instructions in `packages/shared/src/integrations.ts:113,119`.
- `bodhlok.com` appears in `packages/integrations/src/site-publisher.ts:20`,
  `packages/integrations/src/bodhlok-cms.ts:137`, `apps/web/lib/seo-feed.ts:26`,
  `app/(app)/calendar/[id]/editor.tsx:168`, `app/(app)/strategy/positioning-form.tsx:27`,
  `packages/shared/src/integrations.ts:106`.
- `agentic.rechargestudio.com` is the CRM default in `packages/integrations/src/crm.ts:25`.
- **50 non-test source files** mention Bodhlok, BODH or Asttrolok. Most are UI copy and prompts.

## 7.10 The product is Bodhlok-shaped

This is the deepest dependency and it is **not** a code problem — it is the product question in
[00](00-index.md#decisions-needed-from-you):

- **Agent prompts** name the client, its product, its audience and its parent company in prose
  (`packages/agents/src/prompts.ts:6-21`).
- **Five bundled skills** are Bodhlok-specific: `bodh-brand-voice`, `bodh-funnel-metrics`,
  `bodh-positioning`, `bodh-reel-formats`, `jyotish-accuracy`.
- **SEO page templates** are Vedic-astrology content types: `planet_house`, `nakshatra`, `yoga`,
  `lagna`, `panchang_city` (`packages/integrations/src/seo-catalog.ts:10`).
- **A panchang feed** (`/api/feed/panchang`) is an astrology-specific product feature.
- **The funnel's stages** are registration → activation ("first chart generated") → paid, which is
  this product's lifecycle (`packages/db/src/funnel.ts`, `conversion_events.type`).

If tenants are other astrology brands, almost all of this is reusable as-is with the brand kit
carrying the differences. If tenants are arbitrary businesses, then prompts, skills, SEO templates
and the funnel's stage names all become per-tenant content — a product workstream that is larger
than the isolation work and should be scoped separately.

## 7.11 Tenant-blind destructive and operational tooling

Four things today operate on *the whole database*, which in a shared-database model means **all
tenants at once**:

| Tool | What it does | Multi-tenant consequence |
|---|---|---|
| `apps/worker/src/seed.ts:51` | `TRUNCATE` across ~20 tables | Would wipe every tenant. The guard (`seed-guard.ts`) asks about the *database*, not a tenant |
| `scripts/vm/remove-sample-data.sql:19` | `TRUNCATE` 19 tables in one transaction | Same |
| `scripts/vm/backup.sh` | `pg_dump` of the whole database | **A single tenant cannot be restored on its own.** Restoring to recover tenant A would roll back every other tenant |
| `scripts/vm/predeploy-check.sql`, `postdeploy-check.sql` | Whole-database counts | Need to become per-tenant, or they hide a problem in one tenant behind healthy totals |

The backup point is the most important and the easiest to overlook: **"restore from last night's
backup" stops being an available remedy** the moment two clients share a database. Either accept
that (and say so in the client contract), add per-tenant logical exports, or keep tenants in
separate databases ([9](09-target-architecture.md)).

## 7.12 Natural-key lookups

Every place that reads or writes a row by its natural key needs a tenant predicate added. Measured
by counting non-test source files that query each table (excluding `schema.ts` and generated files):

| Table | Files querying it | The ones that matter most |
|---|---|---|
| `connections` | **22** | all four actions in `apps/web/app/(app)/connections/actions.ts`, `apps/web/lib/integrations/google-connection.ts`, `packages/integrations/src/google-oauth.ts`, `verify-connections.ts`, `ops.ts`, `crm.ts`, `site-publisher.ts`, `pipeline.ts`, `ads.ts`, `seo.ts`, `reddit.ts`, the four `/api/connect/*` routes, `packages/db/src/migrate.ts:21` |
| `brand_kit` | **8** | `packages/agents/src/prompts.ts` (`teamBrief`), `packages/agents/src/tools.ts`, `packages/integrations/src/creative.ts`, `publisher.ts`, `apps/web/lib/posts.ts`, `apps/web/app/(app)/creative/actions.ts`, `strategy/actions.ts`, `packages/db/src/migrate.ts:31` |
| `budgets` | **4** | `packages/guardrails/src/index.ts` and `packages/integrations/src/ads.ts` (read on **every** ad change), `apps/web/app/(app)/admin/actions.ts` (`setCaps`), `packages/db/src/migrate.ts:25` |
| `publishing_channels` | **4** | `packages/integrations/src/publisher.ts` (the channel map), `apps/web/app/(app)/publishing/actions.ts:55` (an upsert on the key itself) |
| `billing_accounts` | **1** | `packages/integrations/src/crm.ts` |
| `payments` | **1** | `packages/integrations/src/crm.ts` |

`connections` at 22 files is the widest-reaching table in the schema after the content tables, and
it is the one whose primary key has to change. That combination makes it the single table to scope
first and most carefully.

## 7.13 Caching: a small surface, and no shared-cache leak

Worth recording precisely, because caching is the usual cross-tenant leak in a Next.js app.

**No rendered page or server-side data cache exists:**

- **Every page under `app/(app)` sets `export const dynamic = "force-dynamic"`** — 22 of them,
  checked individually — as do `/api/events/bodh`, `/api/events/crm-leads` and `/api/feed/llms.txt`.
- There is **no** `unstable_cache`, no `"use cache"`, no `export const revalidate` and no
  `fetch(..., { cache: "force-cache" })` anywhere in `apps` or `packages`. `revalidatePath` is used
  only to *invalidate* after a mutation.

**Three responses do set `Cache-Control`, and all three are `private` or `no-store`:**

| Response | Header | File |
|---|---|---|
| `/api/chat` | `no-store` | `apps/web/app/api/chat/route.ts:44` |
| `/api/assets/[id]` | `private, max-age=3600` | `apps/web/app/api/assets/[id]/route.ts:27` |
| `/api/feed/*` | `private, max-age=300` (with `X-Robots-Tag: noindex`) | `apps/web/lib/seo-feed.ts:42` |

`private` means a browser may cache but a shared proxy or CDN may not, so none of the three can
serve one tenant's content to another. **That property is load-bearing once tenants exist and must
not be relaxed** — changing either of the `private` headers to `public`, or putting a CDN in front
without `Vary`, would turn a correct design into a cross-tenant leak. If per-tenant caching is added
later, the tenant must be part of every cache key.

## 7.14 Summary of effort

The first four rows are the cost of a **shared-schema (`tenant_id`)** model and are the measurement
that drives the model choice in [9](09-target-architecture.md). Under the recommended
**schema-per-tenant** model those four rows become zero, and the provisioning-DDL row replaces them.

| Area | Scale | Difficulty |
|---|---|---|
| Add `tenant_id` to 39 tables | 39 tables, mechanical | Low per table, long in total |
| Re-key 17 unique constraints | 17 indexes | Low, mechanical |
| Change 6 natural primary keys | 6 tables, small row counts | **Medium-high** (irreversible by app rollback) |
| Scope 285 query call sites | 67 files | **High in volume**, low per site |
| Per-tenant secrets and caches | ~4 files | Medium, **high consequence if wrong** |
| Tenant-aware entry points | 19 routes + 22 jobs | **High** — the webhook and feed design is the hard part |
| Entitlements | New subsystem | Medium |
| Super Admin | New application surface | Medium |
| De-branding the product | 50 files, 5 skills, 7 templates | **Product decision first** |
| *(schema per tenant instead)* provisioning DDL path + per-tenant migration bookkeeping | 2 files | Medium ([9 §9.5](09-target-architecture.md#95-per-tenant-migration-is-not-run-the-migrations-unedited)) |
| *(schema per tenant instead)* the one tenant-resolution mechanism | 1 helper + boundaries | **Medium, high consequence** — all risk concentrates here |

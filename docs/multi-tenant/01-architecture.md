# 1. Existing application architecture

Read from the code at the audit commit (`c9ee294`). No assumptions: every statement cites a file.

## 1.1 Shape

A pnpm + Turborepo monorepo (`pnpm-workspace.yaml`, `turbo.json`) with two deployable applications
and five shared packages.

```
apps/web      Next.js 16 App Router — all UI, all server actions, 19 API routes
apps/worker   Hono HTTP service — every scheduled job, agent runs, the sample-data seed
packages/db          Drizzle schema (39 tables), 14 SQL migrations, migrate + funnel rebuild
packages/shared      Roles, module access rules, integrations catalog, channels, logging
packages/guardrails   Ad spend caps, auto-allow rules, losing-ad rule, post and copy checks
packages/integrations 53 files: secrets, storage, attribution, every third-party client, pipelines
packages/agents       Claude agents: prompts, tools, run loop, cost budget, 5 bundled skills
```

Shared packages are consumed as TypeScript source through workspace imports — there is no build
step between them, so a change in `packages/db` is compiled into both apps at build time.

## 1.2 The web application

- **Next.js 16 App Router**, React Server Components. Rendering is server-side; pages query the
  database directly (`apps/web/app/(app)/page.tsx` and every other `page.tsx`).
- **Route groups**: `(app)` is the signed-in application, `(public)` is the three pages Google's
  OAuth verification reads signed out (home, privacy, terms), `signin` is the sign-in page, and
  `api/` holds the 19 route handlers.
- **Mutations are React server actions**, not API endpoints: 38 exported actions across 15
  `"use server"` files ([2](02-module-inventory.md#23-server-actions)). There is no REST or GraphQL
  surface for the UI — this matters for multi-tenancy, because the tenant must be derived
  server-side inside each action, never passed from the browser.
- **A proxy (middleware)** at `apps/web/proxy.ts` does an optimistic session-cookie check and
  redirects to `/signin`; the real check is each page calling `requireModule(...)`
  (`apps/web/lib/auth.ts:61`). The matcher excludes `signin`, the public pages, `api/auth`,
  `api/health`, `api/events`, `api/feed` and static files (`apps/web/proxy.ts:33`).
- **Layout** is `apps/web/components/app-shell.tsx`: it builds the sidebar from
  `modulesForRole(user.role)` and counts pending approvals itself (`apps/web/components/app-shell.tsx:12-24`).

## 1.3 The worker

`apps/worker/src/app.ts` is a Hono app with one authentication rule: a shared `WORKER_TOKEN`
compared with `timingSafeEqual` over SHA-256 digests, sent as `X-Worker-Token` or a bearer token
(`apps/worker/src/app.ts:144-148`). Every `/jobs*` route is behind it (`apps/worker/src/app.ts:149-150`). `/health` is open
(`apps/worker/src/app.ts:138`).

Routes, in registration order (the catch-all `/jobs/:agent` is deliberately last, `apps/worker/src/app.ts:343`):

| Route | Purpose | File |
|---|---|---|
| `POST /jobs/tracking/:job` | `forward-conversions`, `load-spend`, `load-ga4`, `rebuild-funnel`, `hourly`, `daily` | `apps/worker/src/app.ts:161` |
| `POST /jobs/publishing/run` | Hands approved posts to Postiz, reads results back | `apps/worker/src/app.ts:214` |
| `POST /jobs/creative/poll` | Polls Veo video jobs | `apps/worker/src/app.ts:223` |
| `POST /jobs/seo/:job` | `catalog`, `keywords`, `audit-start`, `audit-poll`, `geo` | `apps/worker/src/app.ts:239` |
| `POST /jobs/site/:job` | `publish`, `sync` — bodhlok.com CMS publishing | `apps/worker/src/app.ts:268` |
| `POST /jobs/ops/alerts` | Re-verifies every credential, then sends the failures digest | `apps/worker/src/app.ts:285` |
| `POST /jobs/crm/sync` | Billing reconcile, lead pull, funnel rebuild | `apps/worker/src/app.ts:306` |
| `POST /jobs/ads/sync` | Pulls campaigns, ad sets and ads from both platforms | `apps/worker/src/app.ts:330` |
| `POST /jobs/:agent` | Starts an agent run; `replan` is a special two-agent sequence | `apps/worker/src/app.ts:343` |

Agent runs are **fire-and-forget**: the route returns `202` with a run id and the work continues in
`void agents.runAgent(...)` (`apps/worker/src/app.ts:381`). This is important for isolation — see
[13](13-tenant-isolation.md#138-background-work).

## 1.4 Data layer

One Drizzle client over one `postgres-js` pool, created at module load from `DATABASE_URL`
(`packages/db/src/client.ts:5-18`). The pool is `DB_POOL_SIZE`, default 10
(`packages/db/src/client.ts:12`); the Cloud Run deployment sets it to 5 with at most 4 web and 2
worker instances (`infra/run.tf:21`, `infra/run.tf:216`, `infra/run.tf:61`), so at most ~30
connections to a Cloud SQL Postgres 16 instance with point-in-time recovery and 14 retained backups
(`infra/database.tf`). Those numbers are the budget any per-request connection reservation has to
fit inside. The pool is cached on `globalThis` outside production to survive
hot reloads (`packages/db/src/client.ts:10-16`). There is **no per-request context** anywhere in the data layer —
no async-local storage, no request-scoped client. Everything imports the same `db`.

Scale of the data layer, measured (excluding test files):

- **285** `db.select|insert|update|delete|execute|transaction` call sites across **69** files
- **19** `tx.*` call sites inside transactions
- **54** places using raw `sql` template literals or `.execute(...)`, in 16 files — notably
  `packages/db/src/funnel.ts`, `packages/integrations/src/pipeline.ts`,
  `packages/agents/src/tools.ts`, `packages/integrations/src/ads.ts`

The funnel is a derived table: `packages/db/src/funnel.ts` rebuilds `funnel_daily` from
`ad_spend_daily`, `web_sessions_daily`, `conversion_events` and `leads` for a date range.

## 1.5 Authentication

Two modes, decided by whether `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set
(`apps/web/lib/session.ts:12`):

- **Google sign-in**: OIDC with PKCE. The session is a **stateless HS256 JWT** in the
  `bodh_session` cookie, 7 days, carrying `sub` (user id), `email` and `sv`
  (`apps/web/lib/session.ts:36-44`). `sv` is compared with `users.session_version` on every request, so
  raising that column revokes outstanding cookies (`apps/web/lib/auth.ts:38`).
- **Dev mode**: with no Google client, every request runs as `DEV_USER_EMAIL` and a cookie can
  preview other roles (`apps/web/lib/auth.ts:45-57`). Hard-disabled in production with no override
  (`apps/web/lib/session.ts:20`), and a test pins that behaviour (`lib/auth.test.ts:17`).

Only addresses an admin has added can sign in. Addresses on `ALLOWED_EMAIL_DOMAINS` must come from
that Google Workspace (the `hd` claim must match); any other address must be a verified Google
account for exactly that address (`apps/web/lib/google.ts`, tested in `lib/auth.test.ts:30-64`).

## 1.6 Authorization

Static, code-defined, two-layer:

1. `packages/shared/src/modules.ts` lists 16 modules, each with the roles that may see it, and
   `canAccess(role, key)` decides.
2. Each page calls `requireModule("<key>")` (all 22 `page.tsx` files do — verified individually) and
   each server action re-checks before acting.

Approval authority is separate: `APPROVERS` in `packages/shared/src/modules.ts:67-74` maps each of
the six approval kinds to the roles that may decide it.

There are five roles (`packages/shared/src/roles.ts:1`), enforced in the database by a `CHECK`
constraint (`packages/db/src/schema.ts:33`). There is no row-level ownership check anywhere: any
role that can see a module can act on every row in it.

## 1.7 Secrets and files

- **Secrets**: the database stores only a *reference*; the value lives in the store. `local` writes
  `.secrets/<name>` at mode 0600; `gcp` uses Secret Manager, adding a version and destroying older
  ones on each save (`packages/integrations/src/secrets.ts:1-104`). Production refuses the local
  store unless `ALLOW_LOCAL_SECRETS=true` (`packages/integrations/src/secrets.ts:116`). **Secret names are
  `integration-<key>`** (`packages/integrations/src/secrets.ts:124`) — one per integration for the whole installation.
- **Files**: `local` writes `.uploads/`, `gcs` writes the `GCS_BUCKET` bucket. Paths are
  `uploads|generated/<timestamp>-<random>-<name>` (`packages/integrations/src/storage.ts:24`) — flat,
  with no owner in the path. Served through `GET /api/assets/[id]`, which requires a signed-in user
  (`apps/web/app/api/assets/[id]/route.ts:13`).

## 1.8 Agents

Claude agents (`packages/agents`) with a tool surface over the app's own database
(`src/tools.ts`, `src/tools-growth.ts`). Seven startable agents plus chat
(`packages/shared/src/modules.ts:84-92`). Spend is capped monthly and per run from
`AI_MONTHLY_BUDGET_USD` / `AI_RUN_CAP_USD` (`packages/agents/src/cost.ts`), and a run reserves
budget on `agent_runs.cost_usd` before it starts (`packages/db/src/schema.ts:72`).

Concurrency is enforced in the database: a partial unique index allows one queued-or-running run
per agent name, chat exempted (`packages/db/src/schema.ts:78`). **This index is global**, which becomes a
cross-tenant blocker — see [7](07-single-tenant-dependencies.md#72-global-uniqueness).

System prompts are Bodhlok-specific prose (`packages/agents/src/prompts.ts:6-21`), layered with five
bundled skills (`packages/agents/skills/*.md`) and the team's own positioning brief read from
`brand_kit.positioning` (`packages/agents/src/prompts.ts:29-44`).

## 1.9 Deployment

Two paths exist; **the live site uses the first**.

- **VM (live)**: `scripts/deploy-vm.sh` builds `linux/amd64` images locally, extracts the runnable
  files, uploads a release through a private GCS bucket, and runs `scripts/vm/install.sh` on the
  `rapido-demo` VM, whose host is `growth.rechargestudio.com` (`scripts/deploy-vm.sh:15-21`). Systemd runs
  `bodh-web`, `bodh-worker` and **23 timers** (22 worker jobs plus the nightly database backup).
  There is no CI gate on this path: it deploys the working tree, marking a dirty tree in the release
  name (`scripts/deploy-vm.sh:27`).
- **Cloud Run (built, Terraform in `infra/`)**: `.github/workflows/deploy.yml` builds both images,
  runs the `bodh-migrate` Cloud Run job, deploys `bodh-worker` then `bodh-web`, then smoke-tests
  `/api/health`. Scheduling moves to Cloud Scheduler (`infra/scheduler.tf`), and
  `pnpm check:schedules` asserts the VM timers and the Terraform jobs list the same jobs at the same
  times.

Migrations run before the app rolls out on both paths. `packages/db/src/migrate.ts` also seeds the
installation: a `connections` row per integration, ₹0 spend caps for both ad platforms, the single
`brand_kit` row, and the first admin from `BOOTSTRAP_ADMIN_EMAIL` when no admin exists
(`packages/db/src/migrate.ts:16-44`).

## 1.10 Operational discipline already in place

Worth stating plainly, because the transformation must not lower it:

- Nightly `pg_dump`, 14 kept, copied off the machine when `BACKUP_BUCKET` is set
  (`scripts/vm/backup.sh`).
- Read-only pre-deploy and post-deploy SQL checks for a risky migration
  (`scripts/vm/predeploy-check.sql`, `postdeploy-check.sql`, driven by `scripts/prod-check.sh`).
- A documented rollback: repoint `/opt/bodh/current` and restart (`docs/operations.md:82`).
- CI fails if the Drizzle schema and the committed migrations disagree
  (`.github/workflows/ci.yml`, "Migrations match the schema").
- A daily digest that re-verifies every stored credential with its provider before reporting
  (`apps/worker/src/app.ts:285`).

## 1.11 Infrastructure

`infra/` is Terraform for the Cloud Run path: Cloud Run services (`run.tf`), Cloud SQL
(`database.tf`), Secret Manager (`secrets.tf`), GCS (`storage.tf`), Cloud Scheduler
(`scheduler.tf`), Artifact Registry (`registry.tf`), IAM and Workload Identity for GitHub deploys
(`iam.tf`, `github.tf`), and a self-hosted Postiz VM (`postiz.tf`, `postiz-startup.sh.tftpl`).

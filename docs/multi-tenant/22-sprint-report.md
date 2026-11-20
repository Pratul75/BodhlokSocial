# Multi-tenant sprint — what is done, what is not

Branch `multi-tenant`. **Nothing is committed, pushed or deployed.** Production was not touched:
no production database, no DNS, no integration or configuration change. All work ran against the
isolated development database on host port 5434 (`bodh`), confirmed by `current_database()` before
every destructive step.

Three workspaces exist in that development database: **bodhlok** (schema `public`, 5 people, 26
calendar items), **acme** (schema `t_acme`, 2 people, 1 item) and **zenith** (schema `t_zenith`,
2 people), the last created through the Super Admin console during this sprint.

---

## DONE — built and verified

### 1. Tenant database isolation

One Postgres schema per tenant; tenant #1 keeps `public`. Each tenant has **its own database
role**, and the application connects as that role with `search_path` bound at connect time.

The role is the boundary, not the search path. `search_path` only scopes *unqualified* names, so a
query that writes `public.users` reaches another tenant whatever the search path says. What stops
it is a role that was never granted anything outside its own schema.

Tenant #1 now has a role too (`bodh_public_app`). Without one it connected as the database owner,
and the boundary held in only one direction: every other tenant sealed off from it, while it could
read all of them.

Verified, all nine directions across three tenants:

| connecting as | `public.users` | `t_acme.users` | `t_zenith.users` | unqualified |
|---|---|---|---|---|
| `bodh_public_app` | reads 5 | **refused 42501** | **refused 42501** | reads 5 |
| `bodh_t_acme_app` | **refused 42501** | reads 2 | **refused 42501** | reads 2 |
| `bodh_t_zenith_app` | **refused 42501** | **refused 42501** | reads 1 | reads 1 |

Cross-tenant `update` is refused in every direction too. A connection that forgets to set its
search path lands in an empty schema (`nothing_here`) and every query says the table does not
exist, rather than quietly finding someone else's.

Role names carry the database name (`bodh_public_app`, not `public_app`). Postgres roles live in
the cluster, not the database: the first naming collided with the test database's roles and the
test run silently changed the development app's password. The test suite now drops the roles it
creates.

### 2. Tenant resolution and sessions

Resolution order, first match wins: the `/t/<slug>/` prefix, then the host (when
`TENANT_HOST_SUFFIX` is set), then the tenant claim in the session cookie, then —
only while the single-tenant fallback is on — `DEFAULT_TENANT_SLUG`.

- A session claim that disagrees with the address is refused, not trusted.
- An unknown slug returns **404**, never tenant #1's data under another name.
- A suspended workspace sends people to `/signin?error=tenant_suspended`; the others are unaffected.
- The session cookie now carries `tid`, written at Google sign-in.
- Google sign-in resolves the workspace **before** reading any `users` table: the address decides,
  failing that the control plane's user directory says which workspaces hold that address. Someone
  in two workspaces must come in through one of their addresses.
- Sign-out bumps the session version in the person's own workspace, falling back to tenant #1 for
  cookies issued before `tid` existed.

`AsyncLocalStorage.enterWith()` binds the current execution context and does **not** carry back to
a caller. Every page, action and route therefore calls `enterTenantScope(...)` in its own frame
(45 files), and `getCurrentUser()` re-enters it in its own. A child server component renders in its
own context, so `AgentRunPanel` binds for itself.

### 3. Provisioning

`provisionTenant()` — from the console or `pnpm --filter @bodh/db provision` — creates the schema,
the role, the grants, the 39 tables from de-qualified DDL, the entitlement rows, the seed rows
(26 connections, ₹0 budgets, brand kit) and the first admin, and records the admin in the control
plane's user directory.

The committed migrations contain 18 `REFERENCES "public".…` clauses. Replayed into another schema
they would create 17 silent cross-tenant foreign keys. Provisioning strips `"public".` and then
**asserts** through `pg_constraint` that no foreign key leaves the schema; it refuses to activate
the tenant otherwise.

### 4. Super Admin console (`/platform`)

A separate principal: its own table, its own cookie, its own token audience. No tenant's `users`
table holds an operator, so a tenant admin can never become one. The first operator comes from the
required `PLATFORM_OWNER_EMAIL` environment variable — nothing is hardcoded, and a missing value
creates nothing and says so.

Verified in the browser: sign-in, the workspace list, creating **Zenith Dental** end to end
(own schema, own role, 39 tables), opening a workspace, and toggling a module off and on.
Every action is written to `platform.platform_audit`.

### 5. Entitlements — 16 modules, 20 features, 6 capacities

`effectiveAccess = the role allows this module AND the tenant has it`. A tenant with everything on
behaves exactly as the single-tenant application does; 15 tests pin today's 5 roles × 16 modules so
this cannot change existing behaviour silently.

**Empty means nothing, not everything.** A workspace whose provisioning failed after its row was
written has no entitlement rows; handing it the whole product is exactly the failure a paid plan
cannot have. "Unrestricted" is now an explicit flag, set only for the single-tenant fallback.

The feature keys are deliberately industry-neutral (`publishing.postiz`, `ads.write`,
`creative.image`, …) — nothing in them assumes an astrology brand.

### 6. Enforcement on the backend, not only in the UI

Entitlement checks are **synchronous** (`allowed(user, key)`, `featureOn(user, key)`), reading
entitlements loaded once per request onto the user. An async predicate inside `.some()` or a
ternary is always truthy, and a check that is always true is no check at all.

- **Pages**: `requireModule()` on all 19.
- **Server actions**: all 27 exports across 14 files, including the five that previously checked
  the role only (admin, connections, tracking, strategy, publishing, creative, approvals).
- **API routes**: chat, assets.
- **Feature gates at the package choke points**, so one gate covers the person, the agent and the
  scheduled job: `requestChange`, `applyChange`, `runPublisher`, `publishQueued`,
  `postCommunityReply`, `forwardToMeta`, `forwardToGoogle`, `syncKeywords`, `startSiteAudit`,
  `generationRefusal` (images and video), `queueRun` (every agent), chat.
- **Agent auto-apply**: where `ads.auto_apply` is off, an agent's allowed ad change goes to a
  person instead of being applied — it is not silently dropped.
- Refusing a page redirects to the first page that person *can* open, keeping the `/t/<slug>`
  prefix, and lands on `/no-access` when there is nothing — never a redirect loop.
- Creative monthly limits are per workspace, so one tenant cannot spend another's allowance.

Verified live: with Ads switched off for acme, `/t/acme/ads` redirected to `/t/acme/` and the
sidebar dropped it, while `/t/bodhlok/ads` rendered normally.

### 7. Tenant integrations and secrets

Secrets are named per tenant: `integration-<slug>-<key>`. Tenant #1 keeps the unprefixed names the
live installation already uses, so the secrets that exist today keep working untouched. The name
is derived from the bound tenant and **throws** without one.

Both process-level OAuth token caches are now keyed by tenant. The Google one was keyed by
integration alone — it would have handed one workspace's access token to the next workspace that
asked for `google_ads`.

### 8. Jobs and webhooks

The scheduler calls one URL, not one per workspace. A `/jobs/*` call that names no tenant now runs
**once per active workspace** and returns the results keyed by slug; one that names a tenant
(`?tenant=<slug>`) runs only for it. Nothing runs unbound. A *manual* run that names no workspace
is refused rather than fanned out — every web→worker call now carries the tenant.

An agent a workspace does not have returns 409, not a 500 the scheduler would retry.

The worker's health probe asks the control plane, as the web app's now does; a probe belongs to no
workspace.

Public endpoints resolve their own tenant: `/t/<slug>/api/events/crm-*` works per workspace
(those read a per-tenant secret), and the bare paths the outside world already points at stay with
tenant #1 so nothing has to be reconfigured.

### 9. Tests

**341 unit tests, 7 packages, all passing. 31 end-to-end tests, all passing.** Lint clean,
typecheck clean across 7 packages, schedules match 22 jobs.

New this sprint:
- `packages/db/src/tenancy.db.test.ts` — 18 isolation tests against a real Postgres in a database
  the suite creates and drops, including cross-tenant denial **in both directions**, the
  schema-qualified probe, the fail-closed empty search path, "connects as the tenant's own role,
  not the owner", "writes as the restricted role", and a capability switched off in one workspace
  being off only there.
- `packages/shared/src/entitlements.test.ts` — the fail-closed rule and the narrowing rule.
- `apps/web/e2e/tenants.spec.ts` — two tenants over HTTP: each Admin lists only its own people, the
  sidebar names the right workspace, content written in one never appears in the other, an unknown
  slug is a 404, and **one tenant's row id is not readable from the other tenant's address**.
- `apps/worker/src/app.test.ts` — the fan-out, naming one workspace, refusing an unknown one,
  refusing a suspended one, refusing an unaddressed manual run, and the disabled-agent 409.

Manual sweep, recorded: **57 page renders** (19 pages × 3 workspaces, twice) with
`DEFAULT_TENANT_SLUG` **unset** — zero server errors, zero "No tenant context". That sweep is how
three unbound paths were found and fixed (`getCurrentUser`, `AgentRunPanel`, sign-out).

---

## PARTIAL

| Item | State |
|---|---|
| Tenant Admin | People, roles and ad-spend caps are per workspace and work. A workspace **Settings** area for the other environment-based values does not exist; only the 6 capacity values are per tenant. |
| `/api/events/bodh` and `/api/feed/*` | Authenticated by one server-wide secret (`BODH_EVENTS_SECRET`, `SEO_FEED_TOKEN`). They serve **tenant #1 only** until each workspace has its own; `/t/<slug>/…` returns 404 for them. Deliberate: otherwise whoever holds that one secret reaches every workspace. |
| `DEFAULT_TENANT_SLUG` fallback | Still present and still fail-open: with it set, a query that escaped its binding resolves to tenant #1. Provisioning refuses to create a *new* tenant while it is set. It must be unset before a second workspace goes live. |

---

## NOT DONE

1. **Migrating existing tenant schemas.** Provisioning applies the DDL only to an empty schema. A
   new migration reaches `public` and nothing else — there is no per-tenant migration runner. This
   is the most important gap: the next schema change will leave every tenant except #1 behind.
2. Per-tenant secrets for the two shared-secret public endpoints.
3. Billing, plans and anything that charges money.
4. Impersonation. The `platform.impersonations` table exists; nothing writes to or reads it.
5. Per-tenant hostnames beyond the `TENANT_HOST_SUFFIX` resolver, which is written but unexercised.
6. **Phase 7** — per-tenant agent prompts, skills, SEO templates, branding and business
   configuration — as agreed. The architecture leaves room for it (entitlements are generic,
   `tenant_settings` exists, nothing in the feature keys assumes an industry), but none of it is
   built.

---

## NOT TESTED

- **Real Google sign-in.** No Google client is configured locally, so the whole suite runs in
  development sign-in mode. The callback's workspace resolution and the `tid` claim are written and
  typechecked but never executed against Google.
- **The worker against a real scheduler.** The fan-out is unit-tested with a mocked registry; no
  worker process was run against the three real workspaces.
- **GCP Secret Manager.** Only the local file store was exercised; the per-tenant names were not
  created in Secret Manager.
- **Deployment.** Nothing was built for or pushed to any environment.
- **Scale.** Three workspaces. Nothing was measured with many.

---

## Remaining risks

1. **The fallback is fail-open.** While `DEFAULT_TENANT_SLUG` is set, any code path that escapes
   its binding reads tenant #1 instead of throwing. The 57-render sweep with it unset is the only
   evidence that no such path remains, and it covers pages and API routes, not every server action.
2. **One pool per tenant.** `DB_TENANT_POOL_SIZE` (default 5) connections per active workspace,
   with no cap or eviction. A hundred workspaces is five hundred connections.
3. **Role passwords are stored in plain text** in `platform.tenants.db_role_secret`, readable by
   the owner connection. There is no rotation.
4. **A tenant's own DDL drifts** from `public` the moment a migration lands (see NOT DONE 1).
5. **Entitlements are cached for 30 seconds** (`ENTITLEMENT_CACHE_MS`). A capability switched off
   can still be used for up to that long. Capacities that gate spending read live and are exempt.
6. **The web and worker share one process-level registry cache** (10 seconds). A workspace
   suspended in the console keeps working for up to that long.

---

## Exact next steps, in order

1. **Write the per-tenant migration runner.** `migrate` should apply new migrations to `public`
   and then, de-qualified, to every tenant schema inside `forEachTenant`, re-running the
   `pg_constraint` assertion afterwards. Until this exists, do not land a schema change.
2. **Exercise Google sign-in** against a real client in a staging project: two workspaces, one
   address in both, and confirm `tid` is written and honoured.
3. **Give the two shared-secret endpoints per-tenant secrets**, then open `/t/<slug>/api/events/bodh`
   and `/t/<slug>/api/feed/*`.
4. **Run the worker against the three workspaces** and watch one scheduled job fan out.
5. **Unset `DEFAULT_TENANT_SLUG`** in the deployment configuration, and delete the fallback from
   `client.ts` once nothing depends on it.
6. **Cap the pool count** (LRU eviction of idle tenant pools).
7. **Tenant Settings** for the remaining environment-based values.
8. **Phase 7**, as its own milestone.

---

## The change itself

84 files changed, 1,093 insertions, 293 deletions, plus 20 new files. One dependency added:
`vitest` as a dev dependency of `packages/db`, at the version the workspace already uses, so that
package can run its own tests. No new runtime dependency.

Where the new code lives:

- `packages/db/src/client.ts` — pool per tenant, role per tenant, `withTenant` / `enterTenant` / `currentTenant`.
- `packages/db/src/tenancy.ts` — the registry, provisioning, roles and grants, the foreign-key assertion.
- `packages/db/src/platform.ts`, `packages/db/platform/001_platform.sql` — the control plane.
- `packages/db/src/entitlements-store.ts` — the shared feature gate.
- `packages/shared/src/entitlements.ts` — the one access rule.
- `apps/web/lib/tenant.ts`, `apps/web/lib/auth.ts`, `apps/web/proxy.ts` — resolution and binding.
- `apps/web/app/(platform)/` — the Super Admin console.
- `apps/worker/src/app.ts` — the per-tenant fan-out.

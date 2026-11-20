# 13. Tenant isolation architecture

How data, users, settings, secrets, files, background work and outbound capacity stay apart. This
document covers the parts [9](09-target-architecture.md) does not: everything outside the database.

## 13.1 Data

Covered in [9 §9.4](09-target-architecture.md#94-how-db-gets-its-tenant--the-mechanism-as-proven):
one schema per tenant holding today's 39 tables unchanged, **one connection pool per tenant** whose
`search_path` is fixed when the connection opens, each connecting as **that tenant's own database
role** granted only its own schema, and a default `search_path` pointing at an empty schema so a
missing tenant context **fails loudly instead of reading tenant #1**.

**The role is not optional.** `search_path` scopes unqualified names only; the spike showed a
tenant's pool reading `public.users` successfully when the query named the schema, and a
role granted only its own schema refusing it
([21 §21.3](21-phase0-verification.md#the-limit-of-search_path-it-is-not-isolation-on-its-own)).

Properties to assert in tests, not assume (all now have spike evidence):

1. A query outside `withTenant` throws.
2. 50 interleaved `withTenant` calls across two tenants never mix rows.
2b. A **schema-qualified** cross-tenant read is **denied by privileges**, not merely unused.
3. No code path builds a schema name from user input — tenant slugs are validated at provisioning
   (`^[a-z0-9-]{2,40}$`) and the schema name is read from `platform.tenants`, never interpolated
   from a request.

## 13.2 Users and sessions

- A tenant's users live in that tenant's schema. **This makes sign-in order-dependent**: the
  callback looks the user up by email with no tenant
  (`apps/web/app/api/auth/callback/google/route.ts:51-55`), so the tenant must be known *before*
  that query. Two workable sources, in order: the sealed OAuth state, which the sign-in start
  already creates and which carries `returnTo`
  (`apps/web/lib/session.ts:58-77`) — add `tid` resolved from the host or path at `/api/auth/google`;
  or, where the URL carries no tenant, an email-to-tenant directory in the `platform` schema
  (`platform.user_directory`: email → tenant), which is also what makes "this address belongs to two
  tenants, pick one" possible later. The directory duplicates one column, so it must be written by
  the same code path that creates a tenant user, and a test should assert the two never diverge.
- `users.email` stays globally unique **within the tenant's schema**, which means **one person can be a user of two tenants without any schema
  change** — a free win from the schema-per-tenant model, where Model A would have needed
  `users.email` re-keyed and a product decision
  ([3 §3.3](03-database-schema.md#33-global-uniqueness-that-breaks-with-two-tenants)).
- The session JWT gains a `tid` claim. The existing shape (`sub`, `email`, `sv`) and the
  `session_version` revocation mechanism are untouched
  (`apps/web/lib/session.ts:36-44`, `apps/web/lib/auth.ts:38`).
- **A missing `tid` resolves to the default tenant** so the 7-day cookies issued before the change
  keep working — and that fallback has a removal gate
  ([15](15-backward-compatibility.md#the-fallback-must-be-removed-before-tenant-2)).
- `tid` is cross-checked against the tenant implied by the request's host or path. A mismatch means
  sign in again, never "trust the cookie".
- Platform operators are a separate principal in a separate table with a separate JWT audience
  ([10 §10.1](10-super-admin.md#101-the-principle-that-shapes-everything-here)).

## 13.3 Addressing and OAuth

**This is the hardest external constraint, and it decides the URL model.**

Google OAuth clients accept **no wildcard redirect URIs**. Every redirect URI must be registered
literally. The application builds its redirect URIs from `APP_URL`
(`apps/web/lib/google.ts:19`, `packages/integrations/src/validate.ts:48`), and two are registered
today: `/api/auth/callback/google` and `/api/connect/google/callback`. Postiz and Reddit have their
own registered redirect URLs.

The three options:

| Model | URLs | OAuth consequence | Other consequences |
|---|---|---|---|
| **Path** | `growth.rechargestudio.com/t/acme/...` | **One host, one set of redirect URIs, nothing to register per tenant** | Every internal link and `revalidatePath` call gains a prefix; cookies are shared across tenants on one host, so `tid` cross-checking is essential |
| **Subdomain** | `acme.growth.rechargestudio.com` | Each tenant host must be registered with Google, or **all tenants use one central callback host** that completes the exchange and redirects onward with a signed state | Clean separation, per-tenant cookies; needs wildcard DNS and TLS; Next server actions compare `Origin` with `Host`, so a proxy must preserve `Host` ([4 §4.5](04-auth-permissions.md#45-security-properties-already-in-place-do-not-lose-these)) |
| **Custom domain** | `growth.acme.com` | Same as subdomain, plus per-domain certificates | Best for white-labelling; most operational work |

**Recommendation: path-based first (`/t/<slug>/`), with the host kept as an override.** It is the
only option that needs no new OAuth registration and no DNS or TLS work, so Phase 1 can ship
without touching the Google app at all — and the existing registered URIs keep working untouched.
Subdomains and custom domains can be layered on later via a central callback host, because the
tenant then comes from the host instead of the path and nothing else changes.

If you choose subdomains now, the central-callback pattern must be designed in Phase 0, because it
changes the sign-in flow: `/api/auth/callback/google` lands on the central host, reads the tenant
from the sealed OAuth state (which already carries `returnTo`,
`apps/web/lib/session.ts:58-77`), then issues the session on the tenant's host.

**Reserved paths**: `/super-admin`, `/api`, `/signin`, `/about`, `/privacy`, `/terms`, `/_next` must be
refused as tenant slugs.

## 13.4 Webhooks and feeds — the entry points with no user

Today three webhook URLs are registered inside systems you do not control, and four feed routes are
read by the client's website ([6 §6.4](06-integrations.md#64-webhook-urls-already-registered-with-third-parties)).

**The rule: the existing paths never change, and always mean tenant #1.**

| Entry point | New tenants | Tenant #1 |
|---|---|---|
| `/api/events/bodh` | `/api/events/bodh/<tenant-slug>`, with a per-tenant `BODH_EVENTS_SECRET` | Unchanged path, unchanged secret, resolves to tenant #1 |
| `/api/events/crm-billing`, `/api/events/crm-leads` | Per-tenant paths; **the webhook secret already identifies the tenant**, since it is stored per tenant in `connections`, so the secret alone can resolve it | Unchanged |
| `/api/feed/*` | Per-tenant bearer token; the token resolves the tenant | Unchanged, using the existing `SEO_FEED_TOKEN` |

Secret-based resolution is preferable to path-based where available, because it cannot be spoofed by
changing a URL: try each tenant's secret against the signature, accept the one that verifies. With
tens of tenants that is cheap; if it ever is not, add a tenant hint in the path and **still** verify
against that tenant's secret only.

Two things to get right:

- **Timing.** Trying N secrets must not leak which tenant matched; use constant-time comparison
  throughout, as the worker already does for its token (`apps/worker/src/app.ts:38`).
- **Unmatched deliveries.** A webhook that matches no tenant must be recorded (rate-limited) and
  rejected, not silently dropped — a rotated secret otherwise looks like silence.

`/api/assets/[id]` authenticates and checks **module** access — a role with none of
`creative`, `calendar`, `approvals` or `publishing` gets a 404
(`apps/web/app/api/assets/[id]/route.ts:12-14`) — but it does **not** check row ownership: any
signed-in user with one of those modules can fetch any asset id. Scoped by `withTenant` it becomes
correct by construction, because the asset row is only visible inside its own tenant's schema. Its
response carries `Cache-Control: private, max-age=3600` (`route.ts:27`), which is per-browser and
therefore not a shared-cache leak — but it must stay `private` once tenants exist.

## 13.5 Secrets

**There is a hard constraint on the naming scheme, in Terraform.** The web and worker service
accounts are granted secret access by an **IAM condition** limited to secrets whose resource name
starts with `projects/<number>/secrets/integration-` (`infra/iam.tf:17`, applied at
`infra/iam.tf:58` and `infra/iam.tf:69`). A name like `tenant-<id>-integration-<key>` would be
**denied at runtime** on the Cloud Run deployment.

So:

- Secret names become **`integration-<tenant>-<key>`** — keeping the `integration-` prefix the IAM
  condition requires. (Changing the Terraform condition instead would widen those service accounts'
  access to every secret in the project, including `app-auth-secret` and `app-database-url`. Do not
  do that.)
- **The default tenant keeps the legacy name** `integration-<key>`
  (`packages/integrations/src/secrets.ts:124`), so no live secret is renamed, re-created or
  re-versioned. This matters more than it looks: the GCP store destroys older versions on each save
  (`packages/integrations/src/secrets.ts:60-85`), so a botched rename is not recoverable.
- The store itself stays platform-level (one Secret Manager project, one `.secrets` directory).
  With 26 integrations per tenant, secret count grows as 26 × N — comfortable against Secret
  Manager's per-project limits at tens of tenants, but worth watching.
- Secret names are built from the tenant's validated slug or id, never from request input;
  `checkName` already refuses anything outside `[A-Za-z0-9_-]{1,255}`
  (`packages/integrations/src/secrets.ts:16-19`).
- The live VM deployment uses the local file store, not Secret Manager, so this constraint bites on
  the Cloud Run path — but the naming must satisfy both, since one codebase serves both.

## 13.6 In-process caches

The two real leak vectors in the codebase today
([6 §6.3](06-integrations.md#63-in-process-caches--a-real-cross-tenant-leak-risk)):

| Cache | Fix |
|---|---|
| `packages/integrations/src/google-oauth.ts:90` — `Map` keyed by integration name | Key by `(tenantId, integration)`; `forgetAccessToken` takes a tenant |
| `packages/integrations/src/reddit.ts:60` — a single token | Same |

Both must change **in the same commit** as per-tenant credentials. A test with two tenants must
assert two distinct tokens: this is a bug class that raises no error and produces no failing
assertion unless something explicitly looks for it — it just posts one client's content to
another client's account.

`packages/agents/src/skills.ts:42` (`installedCache`, keyed by directory) only matters if skills
become per tenant; if they do, the key needs the tenant.

## 13.7 Files

- New storage paths gain a tenant prefix: `t/<tenant>/uploads/...`, `t/<tenant>/generated/...`
  (`packages/integrations/src/storage.ts:24`).
- **Existing paths are not migrated.** `assets.storage_path` holds the absolute truth and those rows
  live in tenant #1's schema, so they keep resolving.
- One bucket is acceptable with the prefix. A tenant needing its own bucket becomes a per-tenant
  setting later.
- Signed URLs stay short-lived (15 minutes today).

## 13.8 Background work

| Piece | Isolation |
|---|---|
| **Job routes** | Unchanged names, paths and times, so `pnpm check:schedules` keeps passing. The job enumerates active tenants and runs `withTenant` per tenant |
| **Error isolation** | Per-tenant `try/catch`. One tenant's failure must not skip the rest ([8](08-risk-assessment.md), R6) |
| **Observability** | One `pipeline_runs` row per tenant per job, in that tenant's schema, plus an aggregate the worker returns |
| **Retries** | Per tenant. A whole-job 500 that makes the scheduler retry everything (`apps/worker/src/app.ts:208`) would re-run the tenants that already succeeded |
| **Agent concurrency** | Already per schema: `agent_runs_one_active_idx` (`packages/db/src/schema.ts:78`) becomes naturally per-tenant, so tenant B is **not** blocked by tenant A. In Model A this needed a re-keyed index ([7 §7.2](07-single-tenant-dependencies.md#72-global-uniqueness)) |
| **Detached runs** | The tenant is an explicit argument through `queueRun`, `runAgent` and every tool — explicit *because* the ambient context cannot be relied on past the response; many short `withTenant` scopes, never one spanning the run ([9 §9.4](09-target-architecture.md#94-how-db-gets-its-tenant--the-mechanism-as-proven)) |
| **Aggregate job status** | `scripts/vm/job.sh` treats any `2xx` as success, `409` as success (an agent already running is not a failure) and anything else as failure, with a 600-second curl timeout. A per-tenant loop must therefore return `2xx` when **every** tenant succeeded or was legitimately skipped, and non-`2xx` when any tenant failed — with the per-tenant detail in `pipeline_runs`, since the timer only sees one status code. Iterating many tenants must also stay inside the 600-second timeout, or the job needs splitting |
| **Fairness** | A per-tenant loop in slug order starves the last tenant when the job is slow. Rotate the starting offset, or run tenants concurrently with a small limit |

## 13.9 Outbound capacity

Per-tenant accounting, enforced at the point of spend
([12 §12.5](12-entitlements.md#125-the-feature-list)):

- **AI spend**: `agent_runs.cost_usd` is already per schema, so `spentThisMonthUsd`
  (`packages/agents/src/cost.ts:103`) becomes per-tenant for free. The *cap* comes from the
  tenant's capacity entitlement rather than `AI_MONTHLY_BUDGET_USD`.
- **Postiz**: `postiz_calls` is per schema, so the hourly ledger is per tenant automatically. If the
  Postiz **server** is shared, the platform still needs a global ceiling on top, or tenants will
  collectively exceed Postiz's 30/hour.
- **Creative generations**: `creative_jobs` is per schema; the cap comes from the entitlement.
- **Provider quotas** (DataForSEO, Google Ads, Meta) are shared when the account is shared. Stagger
  per-tenant job execution and record provider throttling per tenant so the cause is visible.

## 13.10 Observability and support

- Every log line carries the tenant id. `packages/shared/src/log.ts` is the one place to add it.
- Tenant-scoped actions write that tenant's `audit_log`; platform actions write `platform_audit`;
  an impersonated action writes **both** ([10 §10.5](10-super-admin.md#105-support-access-into-a-tenant)).
- The nightly digest (`apps/worker/src/app.ts:285-304`) reports per tenant, and the platform console
  shows the roll-up.

## 13.11 Isolation properties to prove, not assume

Each of these is an acceptance criterion in [19](19-acceptance-criteria.md):

1. A query without a tenant context throws.
2. Two tenants' agent runs start concurrently without blocking each other.
3. Tenant A's session cannot read tenant B's rows, assets, or secrets — asserted per module.
4. A tenant's webhook signed with tenant A's secret lands on tenant A, and a legacy unsigned-for-a-tenant
   payload lands on tenant #1.
5. Two tenants' Google tokens do not collide in the OAuth cache.
6. A job that throws for tenant 2 still processes tenants 3..N.
7. A disabled module stops the page, the action, the agent and the job.
8. A platform session is refused in the tenant app, and a tenant session in `/super-admin`.

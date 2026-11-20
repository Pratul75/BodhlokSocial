# 15. Backward compatibility strategy

What must keep working byte-for-byte, and the mechanism that guarantees each one. This is your
non-negotiable constraint turned into a checklist.

## 15.1 The governing rule

**At every commit, the live application is a one-tenant installation of a multi-tenant system, and
behaves exactly as it does today.** There is no intermediate state in which Bodhlok is "mid-
migration". Each phase in [17](17-roadmap.md) is shippable on its own and observable as a no-op.

## 15.2 Guaranteed unchanged

| What | Guaranteed by |
|---|---|
| All 39 tables, columns, constraints, indexes, and `brand_kit`'s singleton `CHECK` | The model changes no table ([9](09-target-architecture.md)) |
| All 14 migrations | Unreplayed and unedited |
| All 285 query call sites, 54 raw-SQL sites, 30 upserts | Unchanged; only the connection's `search_path` differs. The exception is the eight module-load constants in §15.3a |
| Bodhlok's data location | Stays in `public`, registered as tenant #1 ([14](14-data-migration.md)) |
| The five roles, `MODULES`, `APPROVERS`, `AGENT_MODULE` | Untouched; entitlements intersect, never replace ([12](12-entitlements.md)) |
| Every `requireModule` redirect behaviour | Same function, one extra condition that is always true for a fully-entitled tenant |
| All 43 guardrail tests and their logic | Untouched |
| The three approval re-checks (draft, approval, publish) and the ad-cap re-check at approval | Untouched (`apps/web/app/(app)/approvals/actions.ts:45-80`) |
| The 22 job names, paths and schedules | Unchanged, so `pnpm check:schedules` keeps passing |
| The three registered webhook URLs | Frozen; new tenants get new paths ([13 §13.4](13-tenant-isolation.md#134-webhooks-and-feeds--the-entry-points-with-no-user)) |
| The two registered Google OAuth redirect URIs, and Postiz's and Reddit's | Path-based tenancy needs no new registration ([13 §13.3](13-tenant-isolation.md#133-addressing-and-oauth)) |
| Existing secret names `integration-<key>` | The default tenant resolves to the legacy name ([13 §13.5](13-tenant-isolation.md#135-secrets)) |
| Existing storage paths in `assets.storage_path` | Only new paths get a tenant prefix |
| The deploy, backup, rollback and pre/post-deploy scripts | Extended, never replaced |
| Dev mode and its production ban | `DEV_USER_EMAIL` resolves inside the default tenant; `devAuthAllowed()` untouched (`apps/web/lib/session.ts:20`) |
| The public pages and their env-driven naming | `PRODUCT_NAME` etc. keep their current values as the default tenant's fallback |

## 15.3 Two different things called "fallback"

These must not be confused, because one is permanent and safe and the other is temporary and
fail-open.

**(a) Permanent legacy bindings — these stay forever.** A specific, named credential or URL is bound
to tenant #1 explicitly, in configuration:

| Binding | Means |
|---|---|
| `POST /api/events/bodh` with the legacy `BODH_EVENTS_SECRET` | → tenant #1 |
| The two CRM webhook paths with tenant #1's stored webhook secrets | → tenant #1 |
| `GET /api/feed/*` with the legacy `SEO_FEED_TOKEN` | → tenant #1 |
| Secret name `integration-<key>` | → tenant #1's secrets |
| Un-prefixed page URLs (`/calendar`, not `/t/bodhlok/calendar`) | → **resolved from the session's `tid`**, not assumed to be tenant #1 |

These are safe because each is an **explicit** mapping from a specific secret, token or signed-in
session to one tenant. Nothing is guessed.

**(b) The ambient default-tenant fallback — this is temporary and must be removed.** "If no tenant
can be resolved at all, use tenant #1." That is fail-open: any bug that loses the tenant reads
Bodhlok's data. §15.4 gives its removal gate.

**It is also load-bearing until every entry point establishes a tenant.** With the fallback removed
and no wrapping in place, **22 of 26** end-to-end tests fail
([21 §21.3](21-phase0-verification.md#how-much-of-the-application-needs-an-explicit-scope-measured)).
So the order is fixed: wrap the entry points first (W2.5), then remove the fallback — never the
reverse.

Note the last row of the table above: an un-prefixed page URL resolves the tenant from the **session
cookie**, so bookmarks keep working after (b) is removed. It is a legacy binding, not the ambient
fallback.

References elsewhere to "the legacy bindings" mean (a) in this section; "the fallback" on its own
always means (b).

## 15.3a Per-tenant lookups and their defaults

Every new per-tenant lookup falls back to today's source when the tenant has no value. This is a
*value* default, not a tenant default, so it is unaffected by removing (b):

| Lookup | Fallback |
|---|---|
| Tenant setting (27 of them) | → the environment variable it replaced |
| Capacity entitlement | → `AI_MONTHLY_BUDGET_USD`, `CREATIVE_MONTHLY_*`, `POSTIZ_HOURLY_BUDGET`, `SEO_AUDIT_MAX_PAGES` |
| Module / feature entitlement | → enabled (and provisioning writes the rows explicitly anyway, [12 §12.3](12-entitlements.md#123-storage)) |
| Secret name | → `integration-<key>` |
| Storage path | → the existing flat path, read from the row |
| Webhook / feed secret | → `BODH_EVENTS_SECRET`, `SEO_FEED_TOKEN` (a legacy binding, §15.3(a)) |

**Caveat: thirteen values are frozen at module load** as exported constants, six of them per-tenant
values (`packages/agents/src/cost.ts:95`, `packages/agents/src/run.ts:15`,
`packages/integrations/src/seo.ts:138`, `packages/integrations/src/publisher.ts:10`,
`packages/integrations/src/site-publisher.ts:20`, `packages/integrations/src/creative.ts:9-10`,
`apps/web/lib/legal.ts:6-8`). A constant evaluated once cannot fall back per tenant, so each must
become a function and its readers updated — the one place where "no call sites change" does not hold
([9 §9.4](09-target-architecture.md#94-how-db-gets-its-tenant--the-mechanism-as-proven)).

So on the day each phase ships, Bodhlok reads exactly the values it reads today, from exactly the
places it reads them now.

## 15.4 Sessions in flight

Session cookies last 7 days (`apps/web/lib/session.ts:36-44`). When `tid` is introduced, cookies
issued before the change carry no `tid`.

- A missing `tid` resolves to the default tenant, so **nobody is signed out by the deploy**.
- `verifySessionToken` already tolerates a missing `sv` by defaulting it to 0
  (`apps/web/lib/session.ts:51`), so this is the established pattern in the codebase, not a new one.
- `session_version` revocation is untouched.

### The fallback must be removed before tenant #2

**This is the one fail-open mechanism in the design, and it needs a gate.** While "no tenant context
means tenant #1" is true, any bug that loses the tenant silently reads Bodhlok's data.

The gate:

1. The fallback is permitted **only** while `platform.tenants` holds exactly one row.
2. Application start-up logs loudly whenever the fallback is active.
3. `provisionTenant` **refuses to create a second tenant** while the fallback is enabled; it must be
   switched off first, which is a configuration flag plus a deploy.
4. With the fallback off, a missing tenant is an error, and the only remaining compatibility need —
   old session cookies — is handled by the 7-day expiry: switch the fallback off at least 7 days
   after `tid` shipped, and no live session can lack it.
5. A test asserts that with the fallback off, a request with no resolvable tenant is refused.

This is an acceptance criterion for the phase that introduces tenant #2
([19](19-acceptance-criteria.md)).

## 15.5 API and contract compatibility

| Consumer | Contract | How it is preserved |
|---|---|---|
| The BODH product backend | `POST /api/events/bodh`, HMAC with a timestamp | Path, headers and secret unchanged; verified by the existing route tests (`apps/web/app/api/routes.test.ts`) |
| The Agentic CRM | Two signed webhooks | Unchanged; the stored per-tenant secret resolves tenant #1 |
| bodhlok.com | `GET /api/feed/*` with a bearer token | Unchanged; `SEO_FEED_TOKEN` keeps working |
| Google, Postiz, Reddit | Registered redirect URIs | Unchanged under path-based tenancy |
| Cloud Scheduler / systemd timers | 22 job paths and times | Unchanged, enforced by `pnpm check:schedules` |
| The worker | `X-Worker-Token` | Unchanged |

**Contract tests come first.** Before any tenancy code, add tests that post a legacy-shaped signed
payload to each of the three webhooks and assert it lands on tenant #1, and that a legacy bearer
token reads the feed. These tests are the definition of "not broken" for the parts of the system
other people depend on, and they are cheap: the existing `routes.test.ts` already has the harness
for exactly this.

## 15.6 Things that will visibly change, and why they are acceptable

Honesty matters more than claiming nothing changes:

| Change | Why it is acceptable |
|---|---|
| URLs gain a `/t/bodhlok` prefix, **if** path-based tenancy is adopted | Avoidable: un-prefixed paths resolve the tenant from the session's `tid` (§15.3(a)), so bookmarks keep working even after the ambient fallback is removed. Recommended |
| A per-tenant banner appears during support impersonation | Only when that feature is used, and only by design ([10 §10.5](10-super-admin.md#105-support-access-into-a-tenant)) |
| Admin gains a Settings area | Additive; the existing Admin screens are unchanged |
| Deploys take longer (migrations × tenants) | Operational, not functional ([14 §14.5](14-data-migration.md#145-migrations-after-this-point)) |
| Connection pool pressure rises with `withTenant` | Must be measured in the Phase 0 spike ([9 §9.5](09-target-architecture.md#96-spike-status-six-of-eight-criteria-pass)); `DB_POOL_SIZE` may need raising |

## 15.7 What would break compatibility, and is therefore refused

Written down so it is not proposed later under schedule pressure:

- Re-keying live secrets instead of resolving the legacy name.
- Changing any of the three registered webhook paths.
- Re-pointing `brand_kit` or `connections` by rewriting live rows.
- Replacing `MODULES`/`canAccess` with a data-driven permission system in the same phase as
  tenancy.
- Dropping the old unique or primary-key constraints in the same release that adds new ones (only
  relevant to Model A).
- Enabling the fail-closed database role before the Phase 0 spike passes, or before `migrate.ts`,
  `seed.ts` and `backup.sh` have their own owner connection
  ([14 §14.3a](14-data-migration.md#143a-the-restricted-role-needs-more-than-a-connection-string)).
- Running the seed or `remove-sample-data.sql` on a multi-tenant database before they are scoped.

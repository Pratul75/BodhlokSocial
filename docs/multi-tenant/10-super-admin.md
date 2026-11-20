# 10. Super Admin architecture

The centralised platform console you asked for: create and manage tenants, grant full or limited
access, switch modules and features on or off, manage tenant users, monitor everything, and reach
into a tenant for support — safely and visibly.

## 10.1 The principle that shapes everything here

**A Super Admin is not a sixth role.** Today `admin` is the most powerful role, and it is a
*client's* role: it manages that client's people and spend caps. Adding `super_admin` to `ROLES`
(`packages/shared/src/roles.ts:1`) would:

- require changing the `users_role_check` constraint (`packages/db/src/schema.ts:33`);
- make it appear in the Admin role dropdown, so a client's admin could grant it;
- make it appear in the dev-mode "Preview as" switcher;
- put a platform principal inside a tenant's own user table.

Instead: **platform operators live in the `platform` schema, with their own table, their own
session cookie and their own JWT audience.** A tenant's database never contains a platform
principal, and a tenant's `admin` can never escalate to one.

```
platform.platform_operators   id, email, name, role (owner | support | billing), active, session_version
platform.platform_sessions    (or stateless JWTs with audience "bodh-platform")
```

Reusing the existing session machinery is straightforward: `createSessionToken` already takes an
audience (`apps/web/lib/session.ts:36-44`), so a platform token is the same code with
`aud: "bodh-platform"`, and the existing test that a token of one audience cannot be used as
another (`apps/web/lib/auth.test.ts:81`) extends to cover it.

## 10.2 Where it lives

A new route group in the same Next.js application, on a reserved path:

```
apps/web/app/(platform)/            — requires a platform session, never a tenant session
  /super-admin                         Overview: every tenant, health, spend, alerts
  /super-admin/tenants                 List, create
  /super-admin/tenants/[id]            One tenant: settings, entitlements, users, connections, jobs
  /super-admin/tenants/[id]/audit      What this tenant's people and agents did
  /super-admin/operators               Platform operators
  /super-admin/audit                   Every platform action, including support access
  /super-admin/health                  Jobs, credentials, budgets across all tenants
```

Why the same application rather than a separate one: it shares `packages/db`, the entitlement
definitions and the integrations catalogue, so there is one source of truth. The separation that
matters is the **session and the schema**, not the process.

`apps/web/proxy.ts`'s matcher must be extended so `/super-admin` requires a platform session and a
tenant session is **never** accepted there (and vice versa).

## 10.3 Creating a tenant

This is the one new write path that must be exactly right. It reuses what already exists:
`packages/db/src/migrate.ts:16-44` is already an idempotent per-installation bootstrap. Lift its
body into `provisionTenant()` and have both callers use it.

```
provisionTenant({ slug, name, plan, firstAdminEmail }):
  1. platform.tenants row                        (status = provisioning)
  2. CREATE SCHEMA t_<slug>
  3. run the 14 migrations into that schema       (today's migrator, new search_path)
  4. one connections row per catalogue integration   (as migrate.ts:21 does)
  5. budgets rows for both ad platforms at ₹0        (as migrate.ts:25 does — spend stays blocked)
  6. brand_kit row 1                                 (as migrate.ts:31 does)
  7. entitlements: every module and feature ON       (your stated default)
  8. tenant_settings seeded from the plan's defaults
  9. the first tenant admin in t_<slug>.users        (as migrate.ts:34-42 does)
 10. status = active; write platform_audit
```

Steps 4–6 and 9 are **today's code**, not new code. Step 5 matters: a new tenant starts with ₹0 ad
spend caps, so a misconfigured tenant cannot spend money
([8](08-risk-assessment.md#85-what-makes-this-project-safer-than-it-looks)).

Provisioning must be **idempotent and resumable** — a failure at step 6 must be fixable by running
it again, which is why `status` exists. A failed provision leaves a `provisioning` tenant that the
console shows and offers to retry or remove.

## 10.4 What the console does

**Tenants**
- Create, rename, suspend, resume, archive, delete (delete = `DROP SCHEMA`, behind a typed
  confirmation and a hard requirement that a logical export was taken first).
- Suspend means: sign-in refused, scheduled jobs skip the tenant, data untouched.

**Access and entitlements** ([12](12-entitlements.md))
- Per tenant: every one of the 16 modules on or off; every named feature on or off; capacity limits
  (AI budget, creative generations, Postiz throughput).
- Change takes effect on the tenant's next request — no deploy, no restart.
- "Give full access" is the default for a new tenant, as you specified; "limited access" is the same
  screen with switches off.

**Tenant configuration** ([7 §7.4](07-single-tenant-dependencies.md#74-tenant-identity-living-in-environment-variables))
- The 27 per-tenant settings: GA4 property, Google Ads customer, Search Console site, site URL,
  feed token, allowed email domains, alert webhook, budgets, agent timers, product and company name.
- Secrets are **never** displayed, only replaced — matching how Connections works today.

**Tenant users**
- List the tenant's users and roles; add a first admin; deactivate (which raises
  `session_version` and invalidates their cookies, exactly as Admin does today).
- Day-to-day user management stays with the Tenant Admin ([11](11-tenant-admin.md)); Super Admin is
  there for bootstrap and for lockout recovery.

**Monitoring**
- Per tenant: failed jobs, failing connections, pending approvals, AI spend against budget, last
  agent run per agent, publishing failures.
- The nightly digest already computes most of this per installation
  (`apps/worker/src/app.ts:285-304`); multi-tenant it reports per tenant and the console shows the
  roll-up.

## 10.5 Support access into a tenant

This is a promise to your clients, so it is designed to be defensible rather than convenient. Three
levels, and **you choose which you offer** ([00](00-index.md), decision 6):

| Level | What it allows | Visible to the tenant |
|---|---|---|
| **Read-only inspection** | The console reads a tenant's rows to diagnose (approvals stuck, a failing connection) | Logged in `platform_audit`; shown in the tenant's own audit log |
| **Time-boxed impersonation** | Act as a named tenant user, for an expiring window | A banner in the tenant's app; every action attributed to `operator@… as user@…` |
| **No access** | Support works from logs and the tenant's own description only | n/a |

If impersonation is offered, the mechanics must be:

- **Granted per request, time-boxed** (an hour, say) and recorded in `platform.impersonations` with
  who, which tenant, which user, why, and when it expires.
- **A distinct session**, not a tenant session: the token carries both the operator and the
  impersonated user, so `audit_log.actor` records both. The existing `audit_log` has `actor` and
  `actor_type` (`packages/db/src/schema.ts:589-600`); add `on_behalf_of` rather than overloading
  `actor`.
- **Visible in the tenant's UI** while active — a banner in `app-shell.tsx`, the same place the
  "Sample data" badge already appears (`apps/web/components/app-shell.tsx:15-24`).
- **Never for an approval.** Approving a post, an ad change or a page is the client's decision and
  the whole product is built around that gate. An impersonated session must be **refused** by
  `decide` (`apps/web/app/(app)/approvals/actions.ts`) and by anything that spends money. This is
  the one hard rule in this document.
- **Optionally consented**: a tenant setting "support may impersonate" that the client controls.

## 10.6 Security requirements for the console

1. Platform sessions and tenant sessions are mutually exclusive, enforced in `proxy.ts` and in the
   page guards.
2. Platform operators authenticate with the same Google OIDC rules (verified email, domain check)
   plus a separate allow-list; MFA via Workspace policy.
3. **Every** platform action writes `platform_audit` — including reads of tenant data.
4. Destructive actions (delete tenant, drop schema, rotate a tenant's secret) require typed
   confirmation and are refused when an export does not exist.
5. The console's own queries are tenant-scoped through `withTenant` like everything else; a
   cross-tenant roll-up is N scoped queries, never an unscoped one.
6. No platform operator appears in any tenant's `users` table, ever.
7. `/super-admin` is excluded from the tenant URL space, so no tenant slug can shadow it.

## 10.7 What Super Admin deliberately cannot do

Worth writing down, because it is what makes the platform sellable:

- Approve anything on a tenant's behalf (§10.5).
- Raise a tenant's ad spend caps without that being an audited, tenant-visible configuration change.
- Read a tenant's integration secrets (they are write-only, as today).
- Sign in as a tenant user without the impersonation record and the tenant-visible banner.

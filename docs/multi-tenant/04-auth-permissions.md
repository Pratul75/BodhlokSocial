# 4. Authentication and permission analysis

## 4.1 How sign-in works today

Decided by whether a Google OAuth client is configured (`apps/web/lib/session.ts:12`):

**Google sign-in (production).** `/api/auth/google` seals a short-lived state cookie carrying the
CSRF state, PKCE verifier, nonce, purpose and return path (`apps/web/lib/session.ts:58-77`), redirects to
Google, and `/api/auth/callback/google` verifies the ID token and issues the session.

Admission rules, implemented in `apps/web/lib/google.ts` and pinned by 18 test cases in
`apps/web/lib/auth.test.ts`:

- the email must be **verified**;
- an address on `ALLOWED_EMAIL_DOMAINS` must carry a matching Google Workspace `hd` claim — a
  personal Google account made with a company address is refused (`apps/web/lib/auth.test.ts:53`);
- any other address (Gmail, a partner's company) is admitted only as a verified Google account for
  exactly that address (`apps/web/lib/auth.test.ts:40`);
- and in every case **the address must already exist as an active user**, added by an admin
  (`apps/web/lib/auth.ts:30-36`).

**Dev mode (local only).** With no Google client, every request runs as `DEV_USER_EMAIL` and the
`bodh_dev_role` cookie previews other roles (`apps/web/lib/auth.ts:45-57`). It is impossible in production:
`devAuthAllowed()` returns false whenever `NODE_ENV === "production"`, with no flag to re-enable it
(`apps/web/lib/session.ts:20`), and a test asserts an older flag cannot bring it back (`apps/web/lib/auth.test.ts:17`).

## 4.2 The session

A **stateless HS256 JWT** signed with `AUTH_SECRET` (minimum 32 characters, enforced at
`apps/web/lib/session.ts:25`), audience `bodh-session`, 7-day expiry, carrying:

```
sub   users.id
email the signed-in address
sv    users.session_version at the time of issue
```

Revocation works by comparison: every request re-reads the user and redirects to
`/signin?error=session_ended` when `row.sessionVersion !== claims.sv` (`apps/web/lib/auth.ts:38`). Sign-out and
removing access both raise that column.

**There is no tenant claim.** Adding one is unavoidable, and because cookies live 7 days, tokens
issued before the change must keep working — see
[15](15-backward-compatibility.md#154-sessions-in-flight).

## 4.3 Authorization

Two independent layers, both static and both in code:

**Module access.** `MODULES` in `packages/shared/src/modules.ts:38-55` pairs each of the 16 modules
with the roles allowed to open it. `canAccess(role, key)` is the only decision function. It is
applied:

- on every page, as `requireModule("<key>")`, which redirects rather than erroring
  (`apps/web/lib/auth.ts:61-67`);
- inside server actions, independently of the page;
- in the sidebar, via `modulesForRole(user.role)` (`apps/web/components/app-shell.tsx:18`);
- before starting an agent, through `AGENT_MODULE` (`packages/shared/src/modules.ts:84-92`), so starting the SEO agent
  needs SEO access whether it is started from its button or from chat.

**Approval authority.** `APPROVERS` (`packages/shared/src/modules.ts:67-74`) maps each approval kind to the roles that
may decide it, checked in `decide` (`apps/web/app/(app)/approvals/actions.ts:31`).

**Roles** are the five in `packages/shared/src/roles.ts:1`, constrained in the database
(`packages/db/src/schema.ts:33`): `admin`, `ads_manager`, `seo_manager`, `social_manager`, `sales`.

## 4.4 What the model does *not* have

Each of these is a gap the multi-tenant design has to fill, and each is also the reason the current
code is simple:

1. **No row-level ownership.** Any role with module access can act on every row in that module.
   There is no "my items" concept. Tenant scoping is therefore the *first* row-level rule the
   application has ever had.
2. **No dynamic permissions.** Access is compiled into the binary. Enabling a module for one client
   and not another cannot be expressed at all today — this is the whole of
   [12](12-entitlements.md).
3. **No concept of a platform operator.** `admin` is the most powerful role and is a *client* role:
   it manages people and spend caps for the one installation. A Super Admin is a new, higher
   principal that must not simply be a sixth entry in `ROLES` (a `CHECK` constraint and a role
   dropdown would then expose it to tenants).
4. **No per-user scoping of integrations.** Any admin can connect or disconnect any integration for
   the whole installation.

## 4.5 Security properties already in place (do not lose these)

- **CSRF**: Next.js protects server actions by comparing the request's `Origin` with its `Host`;
  `apps/web/next.config.ts` sets no `serverActions.allowedOrigins`, so the default applies. **This
  has a direct consequence for multi-host tenancy**: if tenants are served on their own hostnames
  behind a proxy that rewrites `Host`, server actions start failing. The one route without that
  protection (`/api/auth/signout`) checks `Origin` explicitly, with a documented reason for allowing
  a missing header (`apps/web/lib/session.ts:103-110`).
- **Open-redirect protection**: `safeReturnTo` refuses anything that is not a same-site relative
  path (`apps/web/lib/session.ts:114-117`), tested at `apps/web/lib/auth.test.ts:88-98`.
- **Token confusion**: the session and OAuth-state tokens use different `aud` values, and a test
  asserts a state token cannot be used as a session (`apps/web/lib/auth.test.ts:81`).
- **Timing-safe comparison** of the worker token, over SHA-256 digests (`apps/worker/src/app.ts:38`).
- **Production refuses weak configuration**: a short or placeholder `WORKER_TOKEN`
  (`apps/worker/src/app.ts:32`), a short `AUTH_SECRET` (`apps/web/lib/session.ts:25`), local secret files
  (`packages/integrations/src/secrets.ts:116`), local uploads (`storage.ts`), and dev sign-in (`apps/web/lib/session.ts:20`).
- **Seed guards**: the sample-data seed needs `SEED_CONFIRM=yes` and, in production,
  `SEED_ALLOW_PRODUCTION=yes` as well (`apps/worker/src/seed-guard.ts`, 4 test cases).

## 4.6 Changes multi-tenancy requires

| Area | Change | Risk |
|---|---|---|
| Session JWT | Add a `tid` claim | Low, if a missing `tid` resolves to the default tenant for the cookie's lifetime |
| `getCurrentUser` | Return `tenantId`; resolve it from the claim, the host or the path | **Medium** — the single most load-bearing function in the app |
| `users.email` | Unique per tenant instead of globally | **Not needed** under schema per tenant — each tenant's `users` table is its own, so the existing global unique already means "unique within the tenant". Only a shared-schema model forces this change, and with it the product decision |
| Sign-in | Resolve the tenant **before** the `users` lookup at `apps/web/app/api/auth/callback/google/route.ts:51-55`, from the sealed OAuth state or a platform-level email directory ([13 §13.2](13-tenant-isolation.md#132-users-and-sessions)) | Medium |
| `ALLOWED_EMAIL_DOMAINS` | Becomes per-tenant configuration | Low |
| Roles | Add a platform operator **outside** `ROLES` | Low if kept in a separate table |
| `canAccess` | Becomes `tenant entitlement ∩ role` | Medium — must gate pages, actions, agents *and* jobs |
| OAuth redirect URIs | Google permits no wildcards | **High** — constrains the URL model; see [13](13-tenant-isolation.md#133-addressing-and-oauth) |

The safest sequencing, developed in [17](17-roadmap.md): add the tenant column and resolve a single
default tenant *before* any entitlement work, so that at every intermediate commit the live
application is a one-tenant installation of a multi-tenant system and behaves exactly as it does now.

# 11. Tenant Admin architecture

What a client's own administrator gets. The short answer: **exactly what `admin` has today**, plus
the per-tenant settings that are environment variables now, minus nothing.

## 11.1 The guiding rule

Today's `admin` role is already a tenant administrator in everything but name. It manages the
installation's people, roles and ad spend caps (`apps/web/app/(app)/admin/`), and it alone can
change connections (`apps/web/app/(app)/connections/actions.ts:18`). Multi-tenant, the same role
does the same things — scoped to its own tenant and bounded by what Super Admin has enabled.

**No existing admin capability is taken away**, and no existing screen changes for a tenant whose
entitlements are all on. That is the backward-compatibility requirement in
[15](15-backward-compatibility.md) expressed as a UI rule.

## 11.2 What Tenant Admin can do

**Unchanged from today**

| Capability | Where it is now |
|---|---|
| Add a person by email with a role | `admin/actions.ts` `addUser` |
| Change someone's role | `addUser`'s sibling `setRole`, with the "never leave no admin" guard at `apps/web/app/(app)/admin/actions.ts:21` |
| Deactivate someone (kills their sessions) | `setActive`, via `users.session_version` |
| Set daily and monthly ad spend caps | `setCaps`, writing `budgets` |
| Connect, disconnect, sync and verify every integration | `connections/actions.ts`, all four actions |
| Approve anything their role may approve | `APPROVERS` in `packages/shared/src/modules.ts:67-74` |
| Run any agent, see every run and its step log | `lib/agent-actions.ts`, `/runs` |
| Edit the brand kit and the positioning brief | `creative/actions.ts` `saveBrandKit`, `strategy/actions.ts` `savePositioning` |

**New, because these are environment variables today**
([7 §7.4](07-single-tenant-dependencies.md#74-tenant-identity-living-in-environment-variables))

A new "Settings" area under Admin, holding the per-tenant values the client legitimately owns:

| Setting | Today |
|---|---|
| GA4 property id | `GA4_PROPERTY_ID` |
| Google Ads customer id, login customer id, conversion actions | `GOOGLE_ADS_*` |
| Search Console property | `SEARCH_CONSOLE_SITE` |
| Website address | `SEO_SITE_URL` |
| Page-feed token | `SEO_FEED_TOKEN` (shown once, rotatable) |
| Product-event secret | `BODH_EVENTS_SECRET` (shown once, rotatable) |
| Allowed sign-in domains | `ALLOWED_EMAIL_DOMAINS` |
| Alert webhook | `ALERT_WEBHOOK_URL`, `ALERT_ALWAYS` |
| Which agent timers run | `ENABLE_NEW_AGENT_TIMERS` |
| Product and company name shown on the public pages | `PRODUCT_NAME`, `COMPANY_NAME`, `CONTACT_EMAIL` |

Each setting falls back to the environment variable when the tenant has no value, which is how
tenant #1 keeps behaving identically on day one.

**Read-only for Tenant Admin, set by Super Admin** ([12](12-entitlements.md))

- Which modules and features the tenant has.
- Capacity limits: AI monthly budget, per-run cap, creative generations, Postiz throughput.
- The tenant's plan and status.

Showing these as read-only rather than hiding them is deliberate: the client can see what they have
and what they could ask for, and support conversations get shorter. Where a module is off, the
sidebar simply does not list it — the client is not shown doors they cannot open.

## 11.3 What Tenant Admin cannot do

- See or affect any other tenant, or know how many there are.
- Change its own entitlements, capacity limits or plan.
- Reach the `/super-admin` console (a tenant session is refused there, [10](10-super-admin.md#106-security-requirements-for-the-console)).
- Become a platform operator — the role does not exist in the tenant's user table at all.
- Exceed a capacity limit; the limit is enforced server-side, not hidden in the UI.

## 11.4 The roles inside a tenant

The five existing roles are unchanged (`packages/shared/src/roles.ts:1`): `admin`, `ads_manager`,
`seo_manager`, `social_manager`, `sales`. Module access is unchanged
(`packages/shared/src/modules.ts:38-55`). Approval authority is unchanged
(`packages/shared/src/modules.ts:67-74`).

The only change to authorization is that `canAccess` is intersected with the tenant's entitlements:

```
effective access = role allows the module  AND  tenant has the module enabled
```

so a tenant with all modules enabled behaves **exactly** as the application does today — the same
sidebar, the same redirects, the same 403-by-redirect behaviour from
`requireModule` (`apps/web/lib/auth.ts:61-67`). See [12](12-entitlements.md) for the mechanism.

## 11.5 Per-tenant custom roles — explicitly out of scope for now

It will be asked for. The recommendation is **not** to build it in this transformation:

- The five roles are woven into `MODULES`, `APPROVERS`, `AGENT_MODULE`, the `users_role_check`
  constraint (`packages/db/src/schema.ts:33`) and the dev-mode role switcher.
- Per-tenant role definitions turn two static lookups into a data-driven permission system, which
  multiplies the surface that must be re-tested.
- Module-level entitlements already deliver most of what "limited access" means in practice.

If it is needed later, the clean path is: keep the five roles as *templates*, and let a tenant
disable modules per role — a per-tenant override table layered on `MODULES`, not a replacement
for it.

## 11.6 First-run experience for a new tenant

Worth designing, because a new tenant starts with an empty database and the application assumes data
exists:

1. Super Admin provisions the tenant and names the first admin
   ([10 §10.3](10-super-admin.md#103-creating-a-tenant)).
2. That admin signs in; every module is enabled but nothing is connected. Each page must read
   sensibly with no rows — most already do (the pages handle "No plan yet", and the e2e test asserts
   several empty-state headings, `apps/web/e2e/smoke.spec.ts:5-19`), but this needs checking per
   page against a genuinely empty tenant, which is new: today's empty state has only ever been seen
   through the seeded sample data.
3. The admin writes the positioning brief and the brand kit — the agents read both
   (`packages/agents/src/prompts.ts:29-44`), and without them agent output will be generic.
4. The admin connects integrations in Connections.
5. Spend caps stay at ₹0 until the client raises them, as the runbook requires
   (`docs/operations.md:87`).

**Checking that every page renders for an empty tenant is a Phase 1 acceptance criterion**
([19](19-acceptance-criteria.md)), not an afterthought: it is the one behaviour the existing test
suite has never exercised.

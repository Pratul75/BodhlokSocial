# 12. Feature entitlement and dynamic access control

How Super Admin switches modules and features on or off per tenant, with no deploy, without
touching the existing role model, and without a tenant that has everything enabled behaving one bit
differently from today.

## 12.1 What exists to build on

Access today is static and lives in two lookups:

- `MODULES` (`packages/shared/src/modules.ts:38-55`) — 16 modules, each with the roles that may open
  it; decided by `canAccess(role, key)`.
- `APPROVERS` (`packages/shared/src/modules.ts:67-74`) — which roles decide each approval kind.

They are applied in four places: every page via `requireModule` (`apps/web/lib/auth.ts:61-67`),
inside server actions, in the sidebar via `modulesForRole`
(`apps/web/components/app-shell.tsx:18`), and before starting an agent via `AGENT_MODULE`
(`packages/shared/src/modules.ts:84-92`).

This is a good foundation: there is exactly **one** decision function to extend.

## 12.2 The model

```
effective(tenant, role, module) = canAccess(role, module) AND enabled(tenant, module)
```

Three kinds of entitlement, because "disable a feature" means three different things in practice:

| Kind | Granularity | Example | Enforced |
|---|---|---|---|
| **Module** | One of the 16 | Ads manager off for a client who does no paid media | Page, sidebar, actions, agents, jobs |
| **Feature** | A capability inside a module | "may publish to Postiz", "agents may apply ad changes automatically", "may publish to the website CMS" | At the action and the job |
| **Capacity** | A number | AI monthly budget, creative images/month, Postiz posts/hour | At the point of spend |

Capacity is listed as an entitlement deliberately: without it, a shared Postiz server or a shared
Anthropic key lets one tenant consume another's allowance
([7 §7.8](07-single-tenant-dependencies.md#78-shared-outbound-rate-limits)).

## 12.3 Storage

```
platform.entitlements
  tenant_id     references platform.tenants
  kind          'module' | 'feature' | 'capacity'
  key           module key, feature key, or capacity key
  enabled       boolean       (module and feature)
  value         integer/numeric (capacity)
  updated_by    platform operator
  updated_at
  PRIMARY KEY (tenant_id, kind, key)
```

**Default-on, recorded explicitly.** You asked that a new tenant receive the whole application by
default. Two ways to achieve that: assume "absent means enabled", or write a full set of rows at
provisioning. **Write the rows** ([10 §10.3](10-super-admin.md#103-creating-a-tenant), step 7):

- an absent row is then a bug, not an implicit grant;
- the console shows the real state rather than inferring it;
- adding a new module in a future release does not silently enable it for every existing tenant —
  the migration that adds it decides, visibly.

The one exception is a new module shipped *after* a tenant exists: provisioning backfills its row
to **on**, matching "every tenant receives the same existing application", and the backfill is part
of that release's migration.

## 12.4 Enforcement — all five surfaces, not just pages

The commonest way this goes wrong is gating the page and forgetting the action or the job
([8](08-risk-assessment.md), R14). One helper, used in all five places:

```
requireFeature(tenantId, key)   // throws / redirects
featureEnabled(tenantId, key)   // boolean, for the UI
```

| Surface | How | What a disabled module looks like |
|---|---|---|
| **Pages** | `requireModule` additionally checks the tenant entitlement | Redirect, exactly as a role refusal does today |
| **Sidebar** | `modulesForRole(role)` filtered by the tenant's enabled modules | The item is absent — no greyed-out doors |
| **Server actions** | Each of the 38 re-checks; never trust the page | An error result, in the shape each action already returns |
| **Agents** | `AGENT_MODULE` maps agent → module; the check happens in `queueRun`, so a timer cannot start a disabled tenant's agent | Run refused, reason recorded |
| **Scheduled jobs** | The per-tenant loop skips a tenant whose module is off, and records `skipped` in `pipeline_runs` | Visible as a skip, not a silent nothing |

The agent and job rows matter most: those paths have no user, so a UI-level check would not run at
all. A disabled module must stop the *work*, not just the view.

**A test must enumerate all five.** The repository already has the pattern for this kind of
assertion — `apps/web/lib/server-actions.test.ts` walks the file tree to prove a property about
every server action. The same technique can assert that every module page calls the guard and every
action re-checks.

## 12.5 The feature list

Derived from the actual capabilities in the code, not invented:

| Feature key | Controls | Enforced at |
|---|---|---|
| `publishing.postiz` | Handing approved posts to Postiz | `packages/integrations/src/publisher.ts`, `publishing/run` |
| `publishing.site_cms` | Publishing approved pages to the website CMS | `packages/integrations/src/site-publisher.ts`, `site/*` |
| `ads.auto_apply` | Whether guardrail-allowed agent changes apply without a person | `packages/guardrails`, `packages/integrations/src/ads.ts` |
| `ads.write` | Any write to an ad platform at all | `packages/integrations/src/ads.ts` |
| `creative.video` | Veo video generation (the expensive one) | `creative/actions.ts`, `creative/poll` |
| `creative.image` | Image, carousel and thumbnail generation | `creative/actions.ts` |
| `agents.<name>` | Each of the seven agents separately | `queueRun` |
| `chat` | Ask the agents | `/api/chat`, `chat/page.tsx` |
| `seo.geo_checks` | Weekly AI-visibility checks across four engines | `seo/geo` |
| `seo.keywords` | DataForSEO keyword and audit syncing | `seo/keywords`, `seo/audit-*` |
| `community.auto_post` | Posting approved replies to Reddit/YouTube vs. drafting only | `packages/integrations/src/community.ts` |
| `tracking.forwarding` | Server-side conversion uploads to Meta and Google | `tracking/forward-conversions` |
| `crm.sync` | The CRM billing and lead mirror | `crm/sync`, the two CRM webhooks |
| `feed.pages` | The public page feed | `/api/feed/*` |

| Capacity key | Replaces |
|---|---|
| `ai.monthly_budget_usd` | `AI_MONTHLY_BUDGET_USD` (`packages/agents/src/cost.ts:95`) |
| `ai.run_cap_usd` | `AI_RUN_CAP_USD` |
| `creative.monthly_images`, `creative.monthly_videos` | `CREATIVE_MONTHLY_*` (`packages/integrations/src/creative.ts:9-10`) |
| `publishing.postiz_hourly` | `POSTIZ_HOURLY_BUDGET` (`packages/integrations/src/publisher.ts:10`) |
| `seo.audit_max_pages` | `SEO_AUDIT_MAX_PAGES` (`packages/integrations/src/seo.ts:138`) |

Each falls back to its environment variable when the tenant has no row — so tenant #1 behaves
identically on the day entitlements ship.

## 12.6 Plans

Plans are presets over entitlements, not a separate mechanism: "Full" writes every module and
feature on with default capacities; "Essentials" writes a subset. Applying a plan **overwrites** the
tenant's rows and is audited. Per-tenant overrides on top of a plan stay possible, so you keep the
"customise whenever I want" behaviour you asked for.

## 12.7 Caching and propagation

Entitlements are read on essentially every request, so they want caching — and caching them is the
easiest way to leak one tenant's configuration into another's request.

Rules:

1. Cache per tenant, with the tenant id **in the key**, never in a bare module-level variable
   (the mistake already present in the OAuth token caches,
   [6 §6.3](06-integrations.md#63-in-process-caches--a-real-cross-tenant-leak-risk)).
2. Short TTL (30–60 seconds) so a Super Admin change takes effect without a deploy, which is what
   you asked for.
3. Invalidate on write from the console.
4. Never cache in a Next.js data cache or `unstable_cache` — the application currently uses no page
   or data caching at all ([7 §7.13](07-single-tenant-dependencies.md#713-caching-a-small-surface-and-no-shared-cache-leak)),
   and that property is worth keeping.
5. A capacity check that gates spending (AI budget, ad changes) must read the **live** value, not a
   cached one.

## 12.8 Degrading gracefully, not breaking

Turning a module off for a tenant that has been using it must not corrupt anything:

- **Existing rows stay.** Disabling SEO & GEO hides the module; it does not delete `seo_pages`.
- **Work in flight settles.** A running agent run finishes and records its result; the *next* one is
  refused.
- **Approvals already pending** for a now-disabled kind become visible-but-undecidable, with a clear
  reason, rather than vanishing — a pending `ad_change` that silently disappears is worse than one
  that explains itself.
- **Jobs skip and say so**, writing `skipped` to `pipeline_runs`, so the digest does not read as a
  failure.
- **Re-enabling restores everything**, because nothing was destroyed.

# 3. Database schema analysis

Postgres 16, Drizzle ORM. **39 tables**, **14 migrations** (`0000_init` … `0013_ga4_data_api`).
Schema source: `packages/db/src/schema.ts` (867 lines). Line numbers below are from that file.

**Not one table has an owner column.** Every row belongs to "the client" implicitly.

## 3.1 Every table

"Ownership" is this audit's judgement of who the row would belong to after the transformation:
**T** = tenant-owned, **P** = platform-level (shared), **T?** = tenant-owned but see the note.

The **Note** column describes what a **shared-schema (`tenant_id`)** model would require — "PK must
change", "must become unique per tenant" and so on. Under the recommended schema-per-tenant model
([9](09-target-architecture.md)) none of those changes is needed. The notes are kept because they
are the measurement the model choice rests on.

| # | Table | Line | Primary key | Unique constraints | Own | Note |
|---|---|---|---|---|---|---|
| 1 | `users` | 21 | `id` uuid | **`email` globally unique** | T | Must become unique per tenant, or one person cannot be in two tenants |
| 2 | `connections` | 37 | **`key` (natural)** | — | T | 26 rows, one per integration. PK must change |
| 3 | `agent_runs` | 57 | `id` | **partial unique on `agent`** | T | The partial index is a cross-tenant blocker |
| 4 | `approvals` | 84 | `id` | — | T | FKs to `calendar_items`, `agent_runs`, `users` |
| 5 | `assets` | 114 | `id` | — | T | FK to `creative_jobs`; `storage_path` has no tenant in it |
| 6 | `calendar_items` | 131 | `id` | — | T | The publishing core |
| 7 | `strategy_plans` | 165 | `id` | — | T | Several rows per month by design (superseded plans) |
| 8 | `campaigns` | 180 | `id` | `platform_campaign_id` | T | Legacy, superseded by `ad_entities` |
| 9 | `ad_entities` | 200 | `id` | `(platform, platform_id)` | T | Platform ids are unique per ad account, not globally |
| 10 | `ad_changes` | 228 | `id` | — | T | The guardrail audit trail |
| 11 | `experiments` | 256 | `id` | — | T | |
| 12 | `budgets` | 275 | **`platform` (natural)** | — | T | 2 rows. PK must change |
| 13 | `funnel_daily` | 286 | `id` | `(day, channel)` | T | Derived; rebuilt by `funnel.ts` |
| 14 | `keywords` | 305 | `id` | `keyword` | T | Two tenants cannot track the same keyword |
| 15 | `seo_pages` | 334 | `id` | `(template, slug)` | T | Two tenants cannot have the same slug |
| 16 | `seo_audits` | 375 | `id` | — | T | |
| 17 | `geo_questions` | 396 | `id` | **`question` unique** | T | Two tenants cannot ask the same question |
| 18 | `ai_visibility_checks` | 403 | `id` | — | T | |
| 19 | `community_items` | 425 | `id` | `(platform, external_id)` | T | Two tenants cannot both answer one Reddit post |
| 20 | `directory_listings` | 462 | `id` | **`url` unique** | T | Two tenants cannot both target one directory |
| 21 | `reports` | 486 | `id` | `(kind, period_start)` | T | One weekly report per period, globally |
| 22 | `leads` | 511 | `id` | `crm_lead_id` | T | CRM mirror; hashed contacts only |
| 23 | `billing_accounts` | 543 | **`mp_account_id` (natural)** | — | T | PK must change |
| 24 | `payments` | 554 | **`invoice_id` (natural)** | — | T | PK must change |
| 25 | `webhook_deliveries` | 574 | `id` | `(source, delivery_key)` | T | Written before any tenant is known |
| 26 | `audit_log` | 589 | `id` | — | T+P | Needs both tenant rows and platform rows |
| 27 | `conversion_events` | 609 | `id` | **`event_id` unique** | T | Written by the signed webhook, no user |
| 28 | `conversion_forwards` | 653 | `id` | `(event_id, destination)` | T | FK to `conversion_events.event_id` |
| 29 | `ad_spend_daily` | 672 | `id` | `(day, platform, ad_id)` | T | |
| 30 | `web_sessions_daily` | 691 | *(none)* | `(day, channel)` | T | No primary key today |
| 31 | `ga4_daily` | 710 | `(property_id, day, platform)` | — | T | `property_id` is a de facto tenant key |
| 32 | `ga4_daily_sources` | 729 | `(property_id, day, channel_group, source, medium)` | — | T | As above |
| 33 | `ga4_daily_pages` | 749 | `(property_id, day, page_path)` | — | T | As above |
| 34 | `ga4_period_totals` | 764 | `(property_id, range_days)` | — | T | As above |
| 35 | `pipeline_runs` | 783 | `id` | — | T+P | Per-tenant jobs and platform jobs both land here |
| 36 | `brand_kit` | 798 | **`id` with `CHECK (id = 1)`** | — | T | A hard singleton. The single most invasive change |
| 37 | `creative_jobs` | 827 | `id` | — | T | |
| 38 | `publishing_channels` | 846 | **`channel` (natural)** | — | T | 4 rows max. PK must change |
| 39 | `postiz_calls` | 857 | `id` | — | T | Rate-limit ledger; per-tenant only if Postiz is per-tenant |

17 foreign keys in total; all are intra-table-set (no cross-database references).

## 3.2 The six natural-key tables

> **Read §3.2, §3.3 and §3.6 as *"what a shared-schema (`tenant_id`) model would require"*.** They
> are the measurement that drives the model choice in [9](09-target-architecture.md), which
> recommends **schema per tenant** — under which none of these changes is needed, because each
> tenant gets its own copy of the table and the natural key is naturally unique within it. If you
> choose the shared-schema model instead (more than roughly fifty tenants), this is the work.

These are the highest-risk schema changes **in a shared-schema model**, because the primary key
itself must change, and every query that looks a row up by that key must gain a tenant predicate.

| Table | Today | After | Why risky |
|---|---|---|---|
| `connections` | `PRIMARY KEY (key)` | `(tenant_id, key)` | Every connect/disconnect/verify path keys on it; `secret_ref` values must stay valid |
| `budgets` | `PRIMARY KEY (platform)` | `(tenant_id, platform)` | The guardrails read it on every ad change |
| `publishing_channels` | `PRIMARY KEY (channel)` | `(tenant_id, channel)` | The publisher maps every post through it |
| `brand_kit` | `id integer PK DEFAULT 1` + `CHECK (id = 1)` | one row per tenant | The `CHECK` must be dropped; agents, creative and caption checks all read it |
| `billing_accounts` | `PRIMARY KEY (mp_account_id)` | `(tenant_id, mp_account_id)` | CRM ids are unique per CRM, not globally |
| `payments` | `PRIMARY KEY (invoice_id)` | `(tenant_id, invoice_id)` | As above |

A primary-key change in Postgres means dropping and recreating the constraint plus any dependent
foreign keys. On tables this small (2–26 rows) it is fast, but it is **not** reversible by simply
rolling back the application — see [18](18-deployment-rollback.md).

## 3.3 Global uniqueness that breaks with two tenants

**17 unique constraints** are global. Each would make one tenant's data collide with another's, or
let one tenant block another:

| Constraint | Line | What breaks |
|---|---|---|
| `agent_runs_one_active_idx` on `(agent)` where queued/running | 78 | **Tenant B's content agent cannot start while tenant A's is running.** Must become `(tenant_id, agent)` |
| `users.email` unique | 25 | One person cannot be a user of two tenants. Must become `(tenant_id, email)` |
| `keywords_keyword_idx` | 321 | Two tenants cannot track the same keyword |
| `seo_pages_template_slug_idx` | 368 | Two tenants cannot publish the same slug |
| `geo_questions.question` unique | 398 | Two tenants cannot ask an AI engine the same question |
| `directory_listings_url_uq` | 482 | Two tenants cannot target the same directory |
| `community_platform_external_uq` | 452 | Two tenants cannot answer the same Reddit thread |
| `reports_kind_period_uq` | 501 | Only one weekly report can exist per period |
| `conversion_events.event_id` unique | 613 | Two tenants' backends could send the same event id |
| `leads.crm_lead_id` unique | 515 | Two tenants on separate CRMs could share an id |
| `webhook_source_key_uq` | 586 | Two tenants' webhooks could share a delivery key |
| `funnel_day_channel_uq`, `sessions_day_channel_uq`, `spend_day_ad_uq`, `ad_entities_platform_id_uq`, `forward_event_dest_uq`, `campaigns.platform_campaign_id` | various | All day/channel or platform-id rollups collide |

**In a shared-schema model, all 17 need `tenant_id` prepended.** Under the recommended
schema-per-tenant model, **none** of them changes — each is already unique within its tenant's
schema, which is the correct semantics. Mechanically this is the same edit each time, which is good
news: it is repetitive, not clever. The ones that matter most for correctness are
`agent_runs_one_active_idx` (an availability bug, not a data bug) and `users.email` (a product
decision about whether one human can belong to two tenants).

(The rest of this section assumes the shared-schema model.) The four `ga4_*` tables already have
`property_id` in their primary key. Since a GA4 property belongs
to exactly one tenant, these tables are **already effectively partitioned** — the cheapest tables in
the schema to make multi-tenant.

## 3.4 Migration history

| Migration | What it did |
|---|---|
| `0000_init` | Core schema |
| `0001_tracking` | Conversion events, forwards, spend, sessions, funnel |
| `0002_campaign_platform_id` | Added `campaigns.platform_campaign_id` |
| `0003_publishing` | Postiz publishing, channels, call ledger |
| `0004_seo_geo` | SEO pages, audits, GEO questions, visibility checks |
| `0005_ads` | `ad_entities`, `ad_changes`, experiments |
| `0006_site_publishing` | Publishing pages to the website |
| `0007_cms_publishing` | Switched site publishing to the CMS |
| `0008_drop_site_pr_columns` | **Dropped** the pull-request columns |
| `0009_drop_old_leads` | **Dropped** the old leads table |
| `0010_crm_mirror` | `leads`, `billing_accounts`, `payments`, `webhook_deliveries` |
| `0011_positioning_and_run_steps` | Brand-kit positioning, `agent_runs.steps` |
| `0012_audit_additive` | Additive-only audit follow-up (CHECKs, indexes, FKs) |
| `0013_ga4_data_api` | The four `ga4_*` tables |

Two observations that matter:

- **`0012_audit_additive` is the model to copy.** It was deliberately additive, and shipped with
  read-only pre-deploy and post-deploy SQL checks (`scripts/vm/predeploy-check.sql`,
  `postdeploy-check.sql`). The tenancy migrations should follow exactly this pattern.
- **CI already guards drift**: the workflow runs `drizzle-kit generate` and fails if it produces a
  diff (`.github/workflows/ci.yml`). Any tenancy work must keep the schema and migrations in step,
  which means generated migrations get hand-edited for safety and then re-verified.

## 3.5 Bootstrap behaviour

`packages/db/src/migrate.ts` runs on every deploy and is **idempotent**:

1. applies migrations;
2. inserts a `connections` row per integration from the catalog (`packages/db/src/migrate.ts:21`);
3. inserts ₹0 spend caps for `google_ads` and `meta_ads` (`packages/db/src/migrate.ts:25`);
4. inserts `brand_kit` row 1 (`packages/db/src/migrate.ts:31`);
5. creates the first admin from `BOOTSTRAP_ADMIN_EMAIL`, only when no admin exists (`packages/db/src/migrate.ts:34-42`).

Steps 2–5 are exactly the work a **tenant-provisioning routine** will need to do per tenant. This is
reusable: lift it into a `provisionTenant(tenantId)` function and have `migrate.ts` call it for the
default tenant, which keeps today's behaviour byte-for-byte while giving Super Admin its create path.

## 3.6 Risks specific to the schema

Items 1–5 apply to a shared-schema (`tenant_id`) model. Items 6 and 7 apply to **both** models:
item 6 because the composite foreign key is a shared-schema concern, item 7 because upserts matter
wherever a unique index is re-keyed — and item 8, added below, applies only to schema per tenant.

1. **`brand_kit`'s `CHECK (id = 1)`** has been in place since `0000`, and the pre-deploy check
   counts rows other than `id = 1` as a blocker (`scripts/vm/predeploy-check.sql`). This audit did
   not read the live database, so the row count there is unverified — but the application only ever
   writes `id = 1`. Moving to one row per tenant means dropping a constraint the application has
   relied on from the beginning.
2. **`web_sessions_daily` has no primary key** (line 691) — only a unique index. Adding `tenant_id`
   to that index is straightforward, but the table should gain a primary key at the same time.
3. **`conversion_events.occurred_ist` is a generated column** (`packages/db/src/schema.ts:642`) used by an index the funnel
   query depends on. Generated columns cannot be altered in place; they must be dropped and
   recreated. **Do not touch this column** — adding `tenant_id` elsewhere in the table does not
   require it.
4. **`funnel_daily` is derived**, so it can be rebuilt rather than migrated. That makes it a safe
   first table to scope: get it wrong and you re-run `rebuild`.
5. **`audit_log` and `pipeline_runs` need both** tenant-scoped and platform-scoped rows, so
   `tenant_id` must be nullable there (null = platform), while being `NOT NULL` everywhere else.
6. **One foreign key points at a unique column, not a primary key.**
   `conversion_forwards.event_id` references `conversion_events.event_id`
   (`packages/db/src/schema.ts:653-659`). Re-keying that unique to `(tenant_id, event_id)` forces
   the foreign key to become composite as well, so these two tables must change in **one**
   migration, never separately.
7. **30 upserts depend on these constraints.** Every `onConflictDoNothing`/`onConflictDoUpdate`
   resolves against a specific unique index, and **at least 11** name their target explicitly (the
   count is from a single-line grep, so treat it as a floor):

   | File | Conflict target |
   |---|---|
   | `packages/agents/src/tools.ts` | `keywords.keyword` |
   | `packages/integrations/src/seo.ts` | `keywords.keyword`, and two more |
   | `packages/agents/src/tools-growth.ts` | `(community_items.platform, external_id)`, `directory_listings.url`, `(reports.kind, period_start)` |
   | `packages/integrations/src/pipeline.ts` | `conversion_events.event_id`, `(ga4_period_totals.property_id, range_days)`, two more |
   | `packages/integrations/src/ads.ts` | `(ad_entities.platform, platform_id)` |
   | `packages/integrations/src/crm.ts` | `payments.invoice_id`, and five more |
   | `apps/web/app/(app)/seo/actions.ts` | `geo_questions.question` |
   | `packages/db/src/migrate.ts` | `users.email`, and three more |
   | `apps/web/app/(app)/publishing/actions.ts` | `publishing_channels.channel` (upsert) |

   When a unique index is re-keyed, an upsert whose target no longer matches **fails at runtime**,
   not at compile time. Drizzle will not catch it, and nor will the type checker. Every one of the
   31 sites must be revisited in the same change as its constraint.

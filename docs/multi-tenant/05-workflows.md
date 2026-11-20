# 5. Existing workflow analysis

The business processes the application runs today, end to end, with the file that implements each
step. These are the behaviours a regression suite has to protect
([16](16-regression-testing.md)); each one also names where a tenant has to be carried.

## 5.1 Content: idea → published post

1. **Plan.** The Strategy agent writes the month's plan (pillars with shares, bets) and outlines the
   calendar, monthly on the 25th or on demand (`packages/agents/src/prompts.ts`, `strategy_plans`).
   A person approves the plan on `/strategy` (`approvePlan`).
2. **Draft.** The Content agent turns open ideas into drafts and fills gaps, daily at 06:00: idea,
   script, caption, creative brief, and whether a Jyotish expert must check it (`calendar_items`,
   status `idea` → `drafted`).
3. **Finish.** A person edits the item on `/calendar/[id]` (`saveItem`) and attaches media from
   Creative studio.
4. **Send for approval.** `sendForApproval` moves the item to `in_review` and creates an `approvals`
   row of kind `post`.
5. **Decide.** On `/approvals`, `decide` checks that the role may decide this kind, that the item is
   still `in_review`, and **re-runs the post checks on the body as edited in the approval form**
   (`apps/web/app/(app)/approvals/actions.ts:45-52`). Approving with an edited caption is allowed; approving a changed
   item is not — it needs a fresh request.
6. **Publish.** The publisher job (every 5 minutes) re-checks the approval and the post rules again,
   maps the channel through `publishing_channels`, uploads media, and creates the Postiz post, with
   the calendar item's id as the Postiz group (`packages/integrations/src/publisher.ts`).
7. **Confirm.** The same job reads results back and sets `published_url`, `published_at` or an
   `error` with `publish_attempts`.

Guards worth keeping in mind: the post rules run **three times** (draft, approval, publish), and
Postiz calls are rate-limited against `postiz_calls` to stay under its hourly limit.

**Tenant carried by:** the calendar item. Steps 6–7 run with no user, so the tenant must come from
the row, and Postiz credentials and channel mappings must be read per tenant.

## 5.2 Ads: agent proposal → applied change

1. `ads/sync` pulls campaigns, ad sets and ads hourly into `ad_entities`, so guardrails see current
   budgets.
2. The Ads agent reviews the last 14 days daily at 07:30 and proposes changes.
3. **Guardrails decide** (`packages/guardrails`, `packages/integrations/src/ads.ts`): within the
   auto-allow rules and the caps the change applies; otherwise it becomes an `approvals` row of kind
   `ad_change`. Every outcome is written to `ad_changes` with the guardrail's reason.
4. On approval, **the caps are re-checked with today's spend** before anything is applied; if they
   now block it, the approval is rejected with "Blocked at approval" and nothing is applied
   (`apps/web/app/(app)/approvals/actions.ts:64-80`).
5. Applied changes are written back to the platform and recorded with `applied_at`, or an error to
   retry (`retryChangeAction`).

At ₹0 caps every change except pausing is blocked — the deliberate state until the live integration
checks pass (`docs/operations.md:87`).

**Tenant carried by:** the ad account. Spend caps live in `budgets`, keyed by platform only today.

## 5.3 Tracking: event → funnel

1. The BODH backend posts signed batches to `/api/events/bodh` (HMAC over the body with a
   timestamp). Events are normalised and stored in `conversion_events` with hashed contacts.
2. Attribution assigns a channel (`packages/integrations/src/attribution.ts`); activation and paid
   events inherit the channel of the same user's registration.
3. `conversion_forwards` queues each event per destination; `forward-conversions` uploads to Meta
   CAPI and Google Ads every 5 minutes with retries.
4. Spend loads hourly into `ad_spend_daily`; GA4 loads daily into the four `ga4_*` tables and
   `web_sessions_daily`.
5. The CRM webhooks (`/api/events/crm-billing`, `/api/events/crm-leads`) write `payments`,
   `billing_accounts`, `leads` and `webhook_deliveries`; a nightly job reconciles them.
6. `rebuild` recomputes `funnel_daily` per day and channel from all of the above
   (`packages/db/src/funnel.ts`) — 7 days hourly, 35 days daily and after the CRM sync.
7. `scrub_client_data` removes IP and user-agent daily once the forwarding window has passed.

**Tenant carried by:** nothing today. All three webhooks are authenticated by a shared secret with
no tenant in the payload. This is the single hardest workflow to make multi-tenant
([7](07-single-tenant-dependencies.md#73-entry-points-with-no-user)).

## 5.4 SEO and GEO

1. `seo/catalog` adds planned programmatic pages (planet-in-house, nakshatra, yoga, lagna,
   panchang-city) as `seo_pages` rows with status `planned`.
2. `seo/keywords` syncs rankings weekly from DataForSEO; Search Console adds clicks and impressions.
3. `seo/audit-start` crawls the site weekly; `audit-poll` stores finished crawls into `seo_audits`.
4. The SEO agent drafts pages and blogs weekly (`write_page`, `write_blog`), set to `in_review`.
5. A person approves (kind `page` or `blog`), with the same "changed since it was sent" guard as
   posts (`apps/web/app/(app)/approvals/actions.ts:55-60`).
6. `site/publish` publishes approved pages to the bodhlok.com CMS and takes withdrawn ones down;
   `site/sync` reconciles hourly. `site_status` tracks `queued → live → remove_queued → removed`.
7. Separately, the public website can read `/api/feed/pages` and `/api/feed/panchang` with the
   `SEO_FEED_TOKEN` bearer token.
8. `seo/geo` asks four AI engines a list of questions weekly and records whether the brand was
   mentioned, with competitors and citations (`ai_visibility_checks`).

**Tenant carried by:** the page row. The feed routes and the CMS credential are installation-wide
today.

## 5.5 Community and mentions

1. The Community agent finds questions daily on Reddit and YouTube comments (Quora via web search)
   and saves them to `community_items`.
2. It drafts answers, which require a `reply` approval; the community guardrails enforce disclosure,
   no duplicate answers and no personal predictions.
3. Approved Reddit and YouTube replies are posted from the team's named account; Quora is posted by
   hand (`markPosted`).
4. The Mentions agent finds directories weekly into `directory_listings` and drafts listings
   (`listing` approvals); a person submits each one and marks it submitted.

## 5.6 Creative

1. A person generates an image, carousel, thumbnail or video on `/creative`; `creative_jobs` records
   the request, `assets` the result, with the brand kit applied (palette, logo stamp, image style).
2. Video is long-running: Veo returns an operation name and `creative/poll` checks it every minute.
3. Monthly caps limit images and videos team-wide, with optional per-person caps
   (`CREATIVE_MONTHLY_*`).
4. Assets are attached to calendar items and served through `/api/assets/[id]`.

## 5.7 Connections

1. An admin opens `/connections`, which lists all 26 catalog integrations with status.
2. **API-key integrations**: `saveKey` validates the fields, writes the value to the secret store as
   `integration-<key>`, and stores only the reference on the `connections` row.
3. **Google OAuth integrations** (YouTube, Google Ads, Search Console): `/api/connect/[key]/start`
   → Google → `/api/connect/google/callback` stores the grant. Growth OS's own Google app is used
   once saved, otherwise the staff sign-in app (`docs/google-verification.md`).
4. **Postiz and Reddit** have their own OAuth flows under `/api/connect/...`.
5. `syncNow` and `checkAllConnections` verify credentials with the provider; `ops/alerts` does the
   same nightly and reports failures in the digest.
6. `disconnect` revokes the grant at the provider where possible, deletes the secret, and resets the
   row.

## 5.8 Administration

- `/admin`: add a person by email with a role, change a role, deactivate (which raises
  `session_version` and kills their cookies), and set the ad spend caps.
- Sample data: the seed wipes users, connections and content and is refused without
  `SEED_CONFIRM=yes`. A "Sample data" badge shows while the seed's marker row exists
  (`apps/web/components/app-shell.tsx:15-24`); `remove-sample-data.sql` clears it and refuses to run twice.

## 5.9 Agent runs

Every agent run, from a timer, a Run button or chat, becomes an `agent_runs` row with a step log
(tool calls, searches, what it said), token counts and cost. Budget is reserved before the run and
replaced with the real cost at the end (`packages/agents/src/cost.ts`), and the database enforces one
active run per agent. `/runs` and `/runs/[id]` show them.

**Tenant carried by:** the run row, passed explicitly into the detached run. The global
one-active-run index must end up per tenant: under schema per tenant that happens by itself, under a
shared schema it must be re-keyed or tenants will block each other
([7 §7.2](07-single-tenant-dependencies.md#72-global-uniqueness)).

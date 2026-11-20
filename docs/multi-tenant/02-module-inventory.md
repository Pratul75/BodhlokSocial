# 2. Inventory of existing modules and functionality

Every module, page, server action, API route and scheduled job in the application today. This is the
list the transformation must leave working, item by item.

## 2.1 Modules

16 modules, defined in `packages/shared/src/modules.ts:38-55`. "Roles" is who may open it today.

| Module | Route | Group | Roles | What it does |
|---|---|---|---|---|
| Today | `/` | Overview | admin, ads_manager, seo_manager, social_manager | Funnel headline, latest report metrics, what needs attention |
| Strategy | `/strategy` | Plan | marketing roles | The month's plan (pillars, bets), the positioning brief, approve/re-plan |
| Content calendar | `/calendar` | Plan | admin, social_manager, seo_manager | Calendar of ideas → drafts → approved → published; per-item editor |
| Creative studio | `/creative` | Plan | admin, social_manager | Image/carousel/thumbnail/video generation, uploads, brand kit |
| Approvals | `/approvals` | Review | marketing roles | The one queue for all six approval kinds |
| Publishing | `/publishing` | Grow | admin, social_manager | Postiz channel mapping, publish results, retries |
| Ads manager | `/ads` | Grow | admin, ads_manager | Campaigns/ad sets/ads, changes with guardrail verdicts, experiments |
| SEO & GEO | `/seo`, `/seo/pages`, `/seo/pages/[id]`, `/seo/listings` | Grow | admin, seo_manager | Keywords, audits, AI visibility, programmatic pages, directory listings |
| Community | `/community` | Grow | admin, social_manager | Reddit/YouTube/Quora questions and approved answers |
| Leads | `/leads` | Grow | all five roles | The CRM lead mirror, counted per channel |
| Analytics | `/analytics`, `/analytics/reports/[id]` | Measure | marketing roles | GA4 traffic, funnel, agent reports |
| Tracking | `/tracking` | Measure | admin, ads_manager | Pipeline runs, webhook deliveries, event health, manual job runs |
| Ask the agents | `/chat` | Measure | marketing roles | Chat over the app's own data; can start agent runs |
| Agent runs | `/runs`, `/runs/[id]` | Measure | marketing roles | Every run with its step log |
| Connections | `/connections` | Settings | admin | All 26 integrations: connect, disconnect, sync, verify |
| Admin | `/admin` | Settings | admin | People and roles, ad spend caps |

Also outside the module list: `/signin`, and the three public pages `/about`, `/privacy`, `/terms`
(`apps/web/app/(public)/`), which Google's OAuth verification reads while signed out.

Every one of the 22 `page.tsx` files under `app/(app)` calls `requireModule("<key>")` as its first
act — checked individually, no exceptions.

## 2.2 Approval kinds

Six kinds, each decidable by specific roles (`packages/shared/src/modules.ts:67-74`), enforced in the
database by a `CHECK` (`packages/db/src/schema.ts:109`):

| Kind | Decided by | Produced by | Acting on approval |
|---|---|---|---|
| `post` | admin, social_manager | Content agent / a person | Publisher sends it to Postiz |
| `reply` | admin, social_manager | Community agent | Posted to Reddit/YouTube; Quora by hand |
| `ad_change` | admin, ads_manager | Ads agent / a person | Applied to Meta or Google Ads |
| `listing` | admin, seo_manager | Mentions agent | Submitted by hand |
| `blog`, `page` | admin, seo_manager | SEO agent | Published to the bodhlok.com CMS |

## 2.3 Server actions

38 exported actions in 15 `"use server"` files. Each was checked individually. **36 of 38 guard
before acting**, either by calling `getCurrentUser`/`requireModule` inline or through a local
helper in the same file:

- `admin()` — `apps/web/app/(app)/admin/actions.ts:14`, throws unless the role is `admin`
- `requireAdmin()` — `apps/web/app/(app)/connections/actions.ts:18`, same
- `socialUser()` — `apps/web/app/(app)/community/actions.ts:13`, returns null unless the role can
  access the Community module

The two that do not take a user:

- `setDevRole` (`apps/web/app/(app)/actions.ts:9`) guards itself instead: it returns immediately
  when Google sign-in is configured or when `NODE_ENV=production`, so it is inert in production.
- `nextMonthIst` (`apps/web/app/(app)/strategy/actions.ts:12`) is a pure date helper that exported
  from a `"use server"` file becomes a callable endpoint. It touches no database, secret or user
  data, so it leaks nothing — but it is a reminder that **every export from these files is a public
  endpoint**, which matters once tenant resolution has to happen in each one.

| File | Actions |
|---|---|
| `app/(app)/actions.ts` | `setDevRole` |
| `app/(app)/admin/actions.ts` | `setRole`, `addUser`, `setCaps`, `setActive` |
| `app/(app)/ads/actions.ts` | `syncAdsAction`, `pauseAdAction`, `retryChangeAction` |
| `app/(app)/approvals/actions.ts` | `decide` |
| `app/(app)/calendar/actions.ts` | `addIdea` |
| `app/(app)/calendar/[id]/actions.ts` | `saveItem`, `sendForApproval`, `unschedule`, `deleteItem` |
| `app/(app)/community/actions.ts` | `skipItem`, `retryPost`, `markPosted` |
| `app/(app)/connections/actions.ts` | `saveKey`, `disconnect`, `syncNow`, `checkAllConnections` |
| `app/(app)/creative/actions.ts` | `uploadAssets`, `generateCreative`, `checkVideos`, `saveBrandKit` |
| `app/(app)/publishing/actions.ts` | `retryPublish`, `mapChannel`, `runPublisherNow` |
| `app/(app)/seo/actions.ts` | `seoJobAction`, `addQuestion`, `toggleQuestion` |
| `app/(app)/seo/listings/actions.ts` | `markSubmitted`, `skipListing` |
| `app/(app)/strategy/actions.ts` | `nextMonthIst`, `approvePlan`, `savePositioning` |
| `app/(app)/tracking/actions.ts` | `runTrackingJob` |
| `lib/agent-actions.ts` | `runAgentAction` |

A test asserts these files export only async functions, because Next.js only catches that at runtime
(`apps/web/lib/server-actions.test.ts`).

## 2.4 API routes

19 route handlers. The authentication column is the whole security boundary for each one.

| Route | Method | Authentication | Notes |
|---|---|---|---|
| `/api/health` | GET | **none** | 200/503 on a database probe |
| `/api/auth/google` | GET | none (starts sign-in) | Sets the sealed OAuth state cookie |
| `/api/auth/callback/google` | GET | OAuth state + Google ID token | Issues the session cookie |
| `/api/auth/signout` | POST | session cookie + `Origin` check | Raises `session_version` |
| `/api/assets/[id]` | GET | signed-in user | Serves or redirects to the stored file |
| `/api/chat` | POST | signed-in user | Streams an agent chat turn |
| `/api/connect/[key]/start` | GET | signed-in user (admin) | Starts a Google connect grant |
| `/api/connect/google/callback` | GET | signed-in user + OAuth state | Stores the Google grant |
| `/api/connect/postiz/start`, `/callback` | GET | signed-in user | Postiz OAuth |
| `/api/connect/reddit/start`, `/callback` | GET | signed-in user | Reddit OAuth |
| `/api/events/bodh` | POST | **HMAC** over the body with `BODH_EVENTS_SECRET`, timestamped | Registration/activation/paid events |
| `/api/events/crm-billing` | POST | **HMAC** `x-mp-signature` with the stored webhook secret | Invoices |
| `/api/events/crm-leads` | POST | **HMAC** `x-webhook-signature` with the stored webhook secret | Leads |
| `/api/feed/pages`, `/api/feed/pages/[template]/[slug]`, `/api/feed/panchang`, `/api/feed/llms.txt` | GET | **bearer** `SEO_FEED_TOKEN`; off entirely when unset | The public website reads these |

The four `/api/events/*` and `/api/feed/*` entry points carry **no user and therefore no tenant** —
they are the hardest part of the transformation ([7](07-single-tenant-dependencies.md#73-entry-points-with-no-user)).

## 2.5 Scheduled jobs

22 worker-job timers plus the nightly backup (`scripts/vm/systemd/*.timer`), mirrored in
`infra/scheduler.tf`; `pnpm check:schedules` asserts both lists match.

Cadences below are the exact cron expressions from `infra/scheduler.tf:5-37` (India time), which
`pnpm check:schedules` holds equal to the VM timers.

| Job | Cron (IST) | What it does |
|---|---|---|
| `tracking/forward-conversions` | `*/5 * * * *` | Uploads conversions to Meta CAPI and Google Ads |
| `tracking/hourly` | `10 * * * *` | Meta + Google spend, then rebuilds 7 days of funnel |
| `tracking/daily` | `30 6 * * *` | GA4 load, rebuilds 35 days, scrubs client data |
| `publishing/run` | `*/5 * * * *` | Approved posts → Postiz, results back |
| `creative/poll` | `* * * * *` | Polls Veo video jobs |
| `seo/keywords` | `0 5 * * 1` | DataForSEO ranking sync |
| `seo/audit-start` | `0 2 * * 0` | Weekly site crawl |
| `seo/audit-poll` | `20 * * * *` | Stores finished crawls |
| `seo/geo` | `0 8 * * 1` | AI-visibility checks across four engines |
| `site/publish` | `*/30 * * * *` | Publishes approved pages to the CMS, removes withdrawn ones |
| `site/sync` | `0 * * * *` | Reconciles what is live with the CMS |
| `ads/sync` | `15 * * * *` | Campaign/ad-set/ad structure from both platforms |
| `crm/sync` | `30 2 * * *` | Billing reconcile, lead pull, funnel rebuild |
| `ops/alerts` | `0 9 * * *` | Re-verify every credential, send the failures digest |
| agents: `content` | `0 6 * * *` | Draft the week's posts |
| agents: `ads` | `30 7 * * *` | Review and adjust ads within guardrails |
| agents: `seo` | `0 7 * * 1` | Pages, blogs, keyword tracking |
| agents: `strategy` | `0 9 25 * *` | Next month's plan and calendar outline |
| agents: `community` | `0 8 * * *` | Find and draft community answers |
| agents: `mentions` | `0 5 * * 2` | Find and draft directory listings |
| agents: `analyst` | `0 9 * * 1` and `30 9 1 * *` | Weekly and monthly reports |
| db backup | nightly 02:00 | `pg_dump`, 14 kept, copied to `BACKUP_BUCKET` (`scripts/vm/backup.sh`) |

The Community, Mentions and Analyst timers are off unless listed in `ENABLE_NEW_AGENT_TIMERS`,
because they spend AI budget (`.env.example`).

## 2.6 Guardrails (business logic that must not weaken)

`packages/guardrails` — 43 test cases across three files, the densest tested logic in the
repository:

- **Spend caps**: daily and monthly caps per platform from the `budgets` table; at ₹0 every change
  except pausing is blocked (`docs/operations.md:87`).
- **Auto-allow rules**: which agent changes apply without a person, and which become approvals.
- **The losing-ad rule**: when an ad may be paused automatically.
- **Ad copy and positioning checks** on generated copy.
- **Post checks** (`posts.ts`, 16 cases): per-channel rules re-checked by the publisher at publish
  time, not only at approval.
- **Community checks** (`community.ts`, 8 cases): disclosure, no duplicate answers, no personal
  predictions.

The publisher deliberately re-checks the approval and the post rules immediately before publishing
(`README.md`, `packages/integrations/src/publisher.ts`) — a second gate that must survive.

## 2.7 Data-protection behaviour already implemented

- Leads are mirrored **without names or raw contact details**; email and phone are SHA-256 hashes
  (`packages/db/src/schema.ts:505-511`).
- `conversion_events` stores hashed contact fields; `scrub_client_data` runs daily to remove client
  IP and user-agent after their forwarding window (`apps/worker/src/app.ts:201`).
- GA4 tables hold aggregates only, with page paths stripped of query strings
  (`packages/db/src/schema.ts:702-705`).
- Webhook deliveries are stored with personal fields stripped (`packages/db/src/schema.ts:574`).

Any tenant-scoping work must preserve these; they are compliance behaviour, not incidental.

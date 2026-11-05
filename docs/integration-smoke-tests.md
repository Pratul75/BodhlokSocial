# Integration smoke tests

Every integration is coded against the provider's real API, and every network test in the repo stubs `fetch`. Nothing in CI proves a live account works. This page is the check that does: run each row once with real credentials, on the VM (or a staging copy of it), and record the result here. Until a row says **Pass**, treat that integration as not verified.

## Before you start

1. Sign in as an admin and open **Connections**.
2. Connect what you have. Saving a key now asks the provider first, so a card only turns green when the provider accepted it.
3. Press **Check all connections**. It asks every provider again with the stored credentials and marks anything refused as an error, with the provider's reason on the card.
4. Keep the ad caps at ₹0 in **Admin** until the Meta and Google rows below pass. At ₹0 the guardrails block everything except pausing.
5. Leave `AI_MONTHLY_BUDGET_USD` low (for example 20) while testing agents.

## What has to exist outside the app

| Needed | Owner | Unblocks |
|---|---|---|
| Anthropic API key with billing | Admin | Agents, chat, Claude in AI visibility |
| GCP service account with Vertex AI User, or `VERTEX_USE_ADC=true` on the VM | Admin | Creative studio, Gemini in AI visibility |
| Postiz account (Postiz Cloud with an active plan, or self-hosted) with a test Instagram account connected inside it | Social manager | Publishing |
| Google OAuth client with both redirect URIs (see `.env.example`) | Admin | Search Console, Google Ads |
| Search Console property verified for bodhlok.com | SEO manager | Keyword sync |
| DataForSEO login and password with credit | SEO manager | Keywords, site audit, agent research tools |
| GitHub fine-grained token on the site repo (Contents and Pull requests, read and write) and a test branch | Web team | Publishing pages to the website |
| GA4 linked to BigQuery; service account with BigQuery Data Viewer on the `analytics_` dataset | Analytics | Organic sessions in the funnel |
| Meta app review for `ads_management`; a system-user token; a Conversions API token for the dataset | Ads manager | Meta spend, ad changes, server-side events |
| Google Ads developer token (approved), customer id, conversion actions | Ads manager | Google spend, ad changes, click conversions |
| OpenAI and Perplexity keys | Admin | AI visibility on ChatGPT and Perplexity |
| BODH backend posting signed events to `/api/events/bodh` (see `docs/bodh-events.md`) | BODH team | Registrations and activations in the funnel |
| Meta Lead Ads webhook subscribed to the page; Google lead form webhook key | Ads manager | Leads |
| Reddit app (script or web) for the team account | Social manager | Community answers on Reddit |

### Where Postiz runs

Pick one and write it in `docs/deploy-vm.md`:

- **Postiz Cloud.** Nothing to host. The public API needs an active plan or trial. Use the OAuth sign-in card ("Postiz sign-in") or paste an API key.
- **Self-hosted.** `infra/postiz.tf` builds a small VM with the official compose stack when `postiz_domain` is set. Someone has to own its upgrades.

## The checks

Record date, who ran it, Pass or Fail, and where the evidence is (a run id, a URL, a screenshot).

| # | Integration | Do this | Pass when | Date | By | Result | Evidence |
|---|---|---|---|---|---|---|---|
| 1 | Anthropic | Strategy: **Run Strategy agent** with a short task | The run row says succeeded, a draft plan appears, Admin shows its cost | | | | |
| 2 | Vertex image | Creative studio: generate a thumbnail | The image is in the library with the title overlay | | | | |
| 3 | Vertex video | Creative studio: generate a 5-second clip | The job reaches succeeded within 10 minutes (the poll timer runs every minute) | | | | |
| 4 | Postiz | Map Instagram on Publishing, then approve a reel scheduled 15 minutes out on the test account | The item becomes published with a link to the post | | | | |
| 5 | Search Console | Connections: Sync now on Search Console | Keywords from Search Console appear on SEO & GEO | | | | |
| 6 | DataForSEO | SEO & GEO: Refresh keywords, then Start audit | Volumes fill in; an audit finishes within the hour | | | | |
| 7 | GitHub | Approve one SEO page, then **Open pull request now** | A pull request opens on the test branch; after merging, Check status marks it live | | | | |
| 8 | GA4 | Tracking: run the daily job (or wait for 06:30) | `web_sessions_daily` has rows for yesterday; Analytics shows organic sessions | | | | |
| 9 | Meta Marketing | Ads manager: Sync accounts, then Pause on a test ad | The ad list fills; the change log says applied; Ads Manager shows the ad paused | | | | |
| 10 | Meta Conversions API | Set a test event code, have BODH post one signed test registration, run Send queued conversions | The event shows in Events Manager → Test events; the forward says sent | | | | |
| 11 | Google Ads | Sync accounts; upload one click conversion for a real gclid | The ad list fills; the forward says sent with no rejection | | | | |
| 12 | AI visibility | SEO & GEO: Check now | Each engine with a key has a row per question and no error | | | | |
| 13 | BODH events | BODH team posts a signed batch to `/api/events/bodh` | The response says accepted; events show on Tracking; the funnel rebuilds | | | | |
| 14 | Meta lead forms | Send a test lead from Meta's Lead Ads Testing Tool | The lead appears on Leads within a minute, assigned to someone in Sales | | | | |
| 15 | Google lead forms | Send a test lead from the lead form's webhook settings | Same as above | | | | |
| 16 | Reddit | Community: approve a drafted answer | It's posted from the team account and the item says posted | | | | |

When a row fails, the card on Connections and the job row on Tracking (or the run row on the module page) carry the provider's message. Fix the account, then press **Check all connections** and run the row again.

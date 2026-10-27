# Agentic CRM: leads, billing and the funnel

The Agentic CRM (agentic.rechargestudio.com, repo `Pratul75/agentic-CRM`) owns people and
money: leads and the sales pipeline, and, through its Monetization API, Bodhlok's billing.
Growth OS does not keep a second copy to work from. It mirrors just enough to count leads,
payers and revenue per channel and ad, and links back to the CRM for everything else.

| Data | Owner | How Growth OS gets it |
|---|---|---|
| Where a visitor came from (UTMs, click IDs) | bodhlok.com | `registration` event, `docs/bodh-events.md` |
| Signup, first chart | Bodhlok backend | `registration`, `activation` events |
| Payments, renewals, refunds | CRM Monetization (project `bodhlok`) | billing webhook + invoice API, below |
| Leads (lead forms, web forms, WhatsApp) | CRM | lead webhook + nightly pull, below |
| Ad spend | Meta, Google | already loaded hourly |

The key that joins them is the **BODH user ID**: the `user_id` in BODH events, the
`externalRef` of the CRM billing account (`POST /api/mp/v1/accounts/link`), and `user_ref` here.

## Billing: `crm_billing`

**Receiver:** `POST https://growth.rechargestudio.com/api/events/crm-billing`, signed by the CRM
(`X-Mp-Signature: sha256=<hex HMAC of the body>`, `X-Mp-Id` is the event ID, so a retried
delivery is stored once).

The CRM's project webhooks carry `subscription.updated` (account, externalRef, plan, status) and
`invoice.paid` (account and subscription only, no amount). Refunds are not webhooked. So:

1. `subscription.updated` (and `entitlements.updated`) record which BODH user an account is.
2. Either event then reads that account's invoices from `GET /api/mp/v1/invoices?accountRef=<user>`
   and stores each paid invoice in `payments` (paise, GST separate). An `invoice.paid` for an
   account not yet linked waits until its subscription event arrives.
3. The user's first paid invoice becomes their `paid` conversion (`mp:inv:<invoice id>`): it takes
   the channel and ad of their registration and is queued for Meta, like the BODH events. It is
   skipped if the user already has a `paid` event, so once billing is connected the Bodhlok
   backend no longer needs to send `paid`.
4. Nightly at 02:30 IST every linked account is read again, which takes refunds and chargebacks
   out of revenue and catches missed deliveries.

**Set up, in the CRM** (a platform admin, Monetization → project `bodhlok` → Developers):
- Add a webhook endpoint: URL above, events `subscription.updated`, `invoice.paid`,
  `entitlements.updated` (or `*`). Copy the `whsec_…` secret; it is shown once.
- Create a project API key with scope `entitlements:read` (it reads invoices).
- In Growth OS, Connections → **Agentic CRM: billing**: paste both. **Sync now** re-reads every
  linked account.

Check that the `bodhlok` project has an owning organisation set in the CRM; without it the CRM
does not mirror signups as leads (it logs `lead sync SKIPPED`), which does not affect billing here.

## Leads: `crm_leads`

**Receiver:** `POST https://growth.rechargestudio.com/api/events/crm-leads`, signed by the CRM
(`X-Webhook-Signature: sha256=<hex HMAC of the body>`). These webhooks carry no event ID or
timestamp, so a hash of the body is the delivery key, and an update older than the stored lead
is ignored.

`lead.created`, `lead.updated`, `lead.stage_changed` and `lead.converted` are mirrored into `leads`
with the CRM's source label, status, stage, value, the Facebook Lead Ads campaign, ad set, ad and
form IDs, and SHA-256 hashes of email and phone. **No names or raw contact details are stored**;
the webhook log (`webhook_deliveries`) strips them too. Leads the CRM creates for product signups
(they carry `mpAccountId`) are kept as `kind = signup` and not counted as leads, since they are
registrations.

Channel: a lead with Facebook Lead Ads IDs is **Meta Ads**; otherwise any UTMs, then the CRM's
source label (Google lead form, Instagram, WhatsApp, referral, email…), else Other. Deletions
are not webhooked by the CRM, so a deleted lead stays counted until it is marked here.

**Set up, in the CRM** (an admin or manager, Settings → Webhooks):
- Add a webhook: URL above, events `lead.created`, `lead.updated`, `lead.stage_changed`,
  `lead.converted`. Copy the secret; it is shown once.
- Optional: an API key with `read:leads` for the nightly catch-up (`GET /api/v1/leads`, last 30
  days; it adds missed leads and updates status and value, never the ad IDs).
- In Growth OS, Connections → **Agentic CRM: leads**: paste them.

## Where it shows

- **Leads**: leads per channel and the latest leads, each with *Open in CRM*.
- **Analytics**: Leads and Revenue per channel and per ad, and revenue against ad spend.
  Revenue is net of GST, by the day it was paid, under the channel of the payer's
  registration (Direct when Growth OS has no registration for them).
- **Tracking**: the `crm_billing` and `crm_leads` runs of the nightly job.

Code: `packages/integrations/src/crm.ts`, the receivers in `apps/web/app/api/events/crm-*`, the
nightly job `POST /jobs/crm/sync` (timer `bodh-crm-sync`), tables `leads`, `billing_accounts`,
`payments`, `webhook_deliveries`.

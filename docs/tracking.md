# How tracking works

Every channel is judged on **cost per activated user**: ad spend divided by users who
registered and generated their first chart. This page explains where each number comes from.

| Number | Source | Refreshed |
|---|---|---|
| Registrations, first charts, paid | Events from the BODH backend ([bodh-events.md](bodh-events.md)) | As they happen |
| Ad spend and clicks | Meta Marketing API and Google Ads API, per ad per day | Hourly |
| Organic visits | GA4 BigQuery export, `session_start` events | Daily at 06:30 |
| Funnel by channel | Rebuilt from the three above | Hourly for 7 days, daily for 35 days |

## Attribution

Each registration is credited to one channel, from what was captured when the user first
landed. The rules, in order:

1. A referral code means **Referral codes**.
2. A Google click ID (`gclid`, `gbraid`, `wbraid`), or `utm_source=google|youtube` with a paid medium, means **Google Ads**.
3. A Meta source (`meta`, `facebook`, `instagram`) with a paid medium (`paid_social`, `cpc`, `paid`) means **Meta Ads**.
4. `utm_medium=email` means **Email**. WhatsApp links mean **WhatsApp**.
5. YouTube, Instagram, Facebook or LinkedIn as source or referrer means that channel, organic.
6. A search engine referrer or `utm_medium=organic` means **Search (organic)**.
7. Nothing at all means **Direct**. Anything else is **Other**.

The first chart and payment are credited to the same channel and ad as the registration.

## UTM rules for paid ads

Set these once per ad account so every registration can be matched to the exact ad.

**Meta Ads**, in each ad's URL parameters:

```
utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_content={{ad.id}}
```

**Google Ads**, as the account-level final URL suffix, with auto-tagging on:

```
utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={creative}
```

`utm_content` must be the platform's ad ID. That is how the **By ad** table on Analytics
joins spend to registrations.

**Organic posts and other links** we control: `utm_source` is the platform (`youtube`,
`instagram`, `linkedin`, `whatsapp`, `newsletter`), `utm_medium` is `social`, `email` or
`whatsapp`, and `utm_campaign` is a short name for the post or series.

## Conversions sent back to the platforms

Every event is also sent to **Meta Conversions API**, with hashed email and phone and the same
`event_id` as the pixel, so Meta can optimise for registrations and first charts. Events with a
Google click ID are uploaded to **Google Ads** as click conversions, with enhanced-conversion
identifiers.

If an account isn't connected yet, events wait in a queue: up to 7 days for Meta and 60 days for
Google, which are the platforms' own limits. The Tracking page shows the queue.

## Troubleshooting

| What you see | Likely cause |
|---|---|
| Many registrations under Direct | The landing page isn't storing UTM parameters until signup, or apps aren't sending the install referrer |
| Paid registrations not matched to an ad | `utm_content` is missing or isn't the ad ID |
| Spend is zero for a platform | Meta Marketing or Google Ads isn't connected, or its token expired. See Connections. |
| Organic visits are zero | `GA4_BQ_DATASET` isn't set, or the GA4 BigQuery link isn't on |
| Meta conversions failing | Check the Tracking page for the error. Usually an expired token or wrong dataset ID. |

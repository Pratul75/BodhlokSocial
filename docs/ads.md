# Ads

The Ads agent and the Ads manager page change Meta and Google Ads only through `requestChange()` in `packages/integrations/src/ads.ts`. It builds the guardrail's inputs from data, not from what the agent says, records the decision in `ad_changes` (the change log), then does one of three things:

| Decision | What happens |
|---|---|
| allow | Applied on the platform at once (`applyChange()`, the only code that writes to the platforms) |
| needs approval | An `ad_change` item in Approvals with the agent's reason and the guardrail's. Approving applies it; rejecting records it as rejected. |
| block | Recorded as blocked, with why |

## The rules (packages/guardrails)

- **Caps** are set by admins in Admin, per platform, daily and monthly (INR). Spend today and this month come from `ad_spend_daily` (loaded hourly). At either cap, everything except pausing is blocked. Caps of ₹0 block everything except pausing.
- **Auto-allowed:** pausing an ad the code counts as losing, and bid or target-CPA moves within ±20%. Budget decreases are also applied directly.
- **Losing** (`isLosingAd`): over the last 14 days the ad spent at least ₹1,500 and costs 1.5x per activation what the best ad in its ad set costs, or has no activations after spending 2x that. The best ad needs 3+ activations to count. The last running ad in an ad set always goes to Approvals.
- **Always approval:** budget increases, bigger bid moves, resuming an ad, new campaigns, and A/B tests (new public copy).
- **Blocked:** a budget or new campaign that would take the platform's running daily budgets over the daily cap; test copy with banned claims or over the platform's length limits; a second test in an ad set that has one.

New campaigns are approved as a plan; a person builds them in the platform and the next sync picks them up. Approved A/B tests are created automatically: Meta variants reuse the base ad's image and link with new primary text and headline (link ads only); Google variants are new responsive search ads with the base ad's final URL. When losing variants are paused and one is left running, the test is marked won or lost.

## Schedules (India time)

| Job | When |
|---|---|
| Spend and conversions (tracking) | hourly at :10 |
| Account sync (campaigns, ad sets, ads, budgets, bids) | hourly at :15 |
| Ads agent | daily 07:30 |

## Connecting

- **Meta:** Connections → Meta Marketing API: ad account ID and a system user token with `ads_management` (app review needed for that permission).
- **Google Ads:** once the developer token is approved, set `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID` (and `GOOGLE_ADS_LOGIN_CUSTOMER_ID` for a manager account) in `/opt/bodh/shared/bodh.env`, restart `bodh-web` and `bodh-worker`, then Connections → Google Ads API → Connect with the Google account that manages the ads account. The Google Ads API must be enabled in the Cloud project.

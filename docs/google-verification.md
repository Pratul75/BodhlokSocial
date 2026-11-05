# Growth OS's own Google app, and getting it verified

Growth OS connects YouTube, Google Ads and Search Console through Google OAuth. The staff sign-in app lives in the company's shared Google Cloud project (absolute-water-387410, branded "Bodhlok", used by other Recharge apps too). Google treats every account outside that project's Workspace as an outside user. Outside users, including any Gmail account, can't grant sensitive scopes to an app Google hasn't verified for them, so `bodhlok.official@gmail.com` gets a bare 403 after its passkey.

So Growth OS has a Google app of its own, in a project of its own, used only for connections. Staff sign-in (openid, email, profile; not sensitive) stays on the shared app.

| | Staff sign-in app | Growth OS connect app |
|---|---|---|
| Project | absolute-water-387410 (shared) | `growth-os-connect` (Growth OS only) |
| Used for | signing in to Growth OS | YouTube, Google Ads, Search Console connections |
| Where its keys live | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` on the server | the **Google sign-in app for connections** card in Connections |
| Outside accounts | sign in fine (no sensitive scopes) | up to 100 accounts past a warning until verified; any number after |

Each stored grant records the app that issued it (`client_id`), and only that app refreshes it, so connections made before the new app keep working until someone reconnects them.

## 1. Set up the project and app (once)

1. **Project**: `growth-os-connect`, under the rechargestudio.com organization. Enable YouTube Data API v3, Google Ads API and Google Search Console API.
2. **Google Auth Platform → Branding**
   - App name: **Growth OS** (must match `PRODUCT_NAME`, and the name on the public pages)
   - User support email and developer contact: the address in `CONTACT_EMAIL` (default kshitij@rechargestudio.com)
   - App logo: 120×120 PNG. Optional, but a logo sends branding through Google's brand review too.
   - Home page: `https://growth.rechargestudio.com/about`
   - Privacy policy: `https://growth.rechargestudio.com/privacy`
   - Terms of service: `https://growth.rechargestudio.com/terms`
   - Authorized domain: `rechargestudio.com`. It has to be verified in Google Search Console by an owner or editor of the project.
3. **Audience**: External, **In production**. Testing mode makes Google expire refresh tokens after 7 days, so every connection would need redoing weekly.
4. **Data access**: add exactly these scopes, nothing more:
   - `https://www.googleapis.com/auth/youtube.force-ssl`
   - `https://www.googleapis.com/auth/adwords`
   - `https://www.googleapis.com/auth/webmasters.readonly`
5. **Clients → Create client → Web application**, name "Growth OS web", authorized redirect URI `https://growth.rechargestudio.com/api/connect/google/callback`.
6. In Growth OS: **Connections → Google sign-in app for connections**. Paste the client ID and secret. The card asks Google whether they match before saving.
7. Reconnect YouTube, Search Console (and Google Ads once its developer token is in) so they move to the new app.

Until Google verifies the app, an outside account sees "Google hasn't verified this app". It clicks **Advanced**, then **Go to Growth OS (unsafe)**. Google allows 100 accounts this way over the app's life.

## 2. What Google's review needs

The public pages must be live, signed out, before submitting: they ship with this change at `/about`, `/privacy` and `/terms`.

### Scope justifications (paste into the Data access form)

**youtube.force-ssl**
> Growth OS shows a business's marketing team the comments on its own YouTube channel's videos, so viewers' questions can be answered in one place, and posts the replies a team member has reviewed and approved, as the channel (channels.list for its own channel, commentThreads.list and comments.insert). youtube.readonly can't post replies, and Growth OS doesn't upload, edit or delete videos.

**adwords**
> Growth OS reports what each of the business's own Google Ads campaigns, ad groups and ads spent and what it brought in, uploads the business's sign-ups as offline click conversions, and pauses ads or changes bids and budgets within limits the team sets, with larger changes waiting for a team member's approval. The Google Ads API has only this one scope.

**webmasters.readonly**
> Growth OS shows the team which search queries bring people to its own verified website, with clicks, impressions and average position, so it can plan pages. It only reads; it never changes Search Console settings.

### Demo video (unlisted YouTube link, 2 to 4 minutes)

Record in English, with the browser's address bar visible throughout:

1. Open `https://growth.rechargestudio.com/about`, scroll to the privacy policy link, open it.
2. Sign in to Growth OS. Go to **Connections**.
3. Press **Connect with Google** on YouTube comments. Show Google's consent screen with the app name **Growth OS** and the YouTube permission, in full. Approve.
4. Go to **Community**. Show a YouTube comment pulled in, draft a reply, approve it, and show the reply on YouTube.
5. Back in Connections, connect **Google Search Console** the same way, showing its consent screen. Open **SEO & GEO** and show the queries it read.
6. Connect **Google Ads**, showing its consent screen. Open **Ads** and show spend per campaign, and a pause or bid change waiting in **Approvals**.
7. In Connections, press **Disconnect** on one of them, and show it gone from myaccount.google.com/connections.

### Then

- Submit in **Verification Center**. Google writes to the developer contact; replies usually come within days, sometimes weeks. Answer from that mailbox.
- Changing the app name, logo, home page or scopes afterwards sends it back to review.

## 3. Separate approvals, also once for the whole product

- **Google Ads developer token**: apply in the Ads manager account (Tools → API Center). Basic access covers one business's accounts; Standard access is for managing many businesses' accounts. Set `GOOGLE_ADS_DEVELOPER_TOKEN` (and the customer IDs) on the server.
- **YouTube API quota and compliance audit**: the default 10,000 units a day covers a few channels (a reply costs 50 units). More channels need Google's YouTube API audit. YouTube's developer policies also require stored API data, such as comments, to be refreshed or deleted within 30 days; Growth OS doesn't do that yet and needs it before the audit.
- **Business Profile**: request API access from Google with this project's number, then add `business.manage` to the app (which needs verifying again) and switch the card on.

## Multi-team later

Verification is per app, not per customer: once verified, any team's Gmail or company account can connect. What still has to change in Growth OS itself is storage: connections are kept once for the whole install, and each team will need its own.

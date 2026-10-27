# SEO & GEO

## What runs when (India time)

| Job | When | What it does |
|---|---|---|
| Keyword sync | Monday 05:00 | DataForSEO: keywords BODH's site ranks for in Google India, with volume, difficulty, position and page. "Refresh keywords" on the SEO page also pulls clicks and positions from Search Console. |
| SEO agent | Monday 07:00, or **Run SEO agent** | Drafts the next 10 programmatic pages (highest search volume first) and a blog when a keyword deserves one. Every draft goes to Approvals. |
| AI visibility | Monday 08:00, or **Check now** | Asks ChatGPT, Gemini, Perplexity and Claude each question on the list, with web search on, and records whether the answer mentions Asttrolok/BODH and which competitors it names. |
| Site audit | Sunday 02:00 (results stored within the hour after the crawl ends) | DataForSEO On-Page crawl of up to 500 pages: on-page score and failing checks with example URLs. |

Connections needed: **DataForSEO** (API login, API password, site domain), **Search Console** (connect with the Google account that owns the property), and for AI visibility the **OpenAI** and **Perplexity** keys, **Vertex AI** for Gemini, and the Anthropic key for Claude. Engines without a key are skipped.

## Programmatic pages

The catalog (`packages/integrations/src/seo-catalog.ts`) has 200 pages: 108 planets in houses, 27 nakshatras, 12 lagnas, 28 yogas and 25 city Panchang pages. Each page has a meta description, a 40 to 70 word direct answer at the top, the body in Markdown, and 3 to 6 FAQs that become `FAQPage` schema. Pages with astrological claims are flagged for Jyotish review.

Statuses: **planned** → **in review** (in Approvals) → **live** (approved, in the feed). Rejecting a page sends it back as **changes asked** with the note, and the agent picks it up again.

City Panchang pages are computed, not written: `packages/integrations/src/panchang.ts` gives tithi, nakshatra, yoga, karana and vara at sunrise with end times, plus sunrise, sunset, Rahu Kaal, Yamaganda, Gulika and Abhijit, using the Lahiri ayanamsa. Checked against Drik Panchang for Delhi on 24 Oct 2026: every element matched to within a minute.

## Publishing to bodhlok.com

Approved pages become blog posts on bodhlok.com through the site's own CMS (the FastAPI backend
behind bodhlok.com, `/api/cms/*`; `CMS_ENABLED=true` on the `bodhlok-deploy` trigger). Growth OS
signs in with a Bodhlok account that is a CMS member with blog publishing, writes the page as a
post document (title, excerpt, the body as the CMS's rich-text JSON with an article block, SEO
fields with Article and FAQ schema, a cover from the site's own images, the site's category and
"Bodhlok" as author) and publishes it. The CMS renders the page in the site's template, runs its
own checks (title, 50–155 character description, one H1, social image, alt text) and serves it at
`https://bodhlok.com/blog/<slug>` at once: no build, no deploy.

| When | What |
|---|---|
| A page is approved | It is published to the CMS right after the approval is saved (`site-publish`) |
| Every 30 minutes, or **Publish waiting pages** on the SEO page | A sweep retries pages that failed (the CMS's error list is shown on the page) |
| Hourly, or **Check status** | What Growth OS thinks is live is compared with the CMS; a post taken down in the CMS panel shows as taken down here |
| A live page is sent back with changes | It is unpublished (the CMS answers 410 at the old address) |

Categories: comparison pages → "Choosing software"; module guides → the site's categories (KP
astrology, Jaimini, Ashtakavarga, Dasha periods, Muhurta, Consult) or "Chart methods"; study
guides → "Study guides". Missing categories and the "Bodhlok" author are created on first use.

Connection: **bodhlok.com CMS** in Connections, a **sign-in key**. Every Bodhlok sign-in,
including the CMS's own `POST /api/cms/token` since the Bodhlok team's 27 Oct change, needs a
browser reCAPTCHA, so a person verifies and Growth OS keeps the session: log in at bodhlok.com
as the Growth OS account in a private window, run `copy(localStorage.refresh_token)` in the
browser console there, paste it into the card, and close the window without logging out
(logging out only clears the browser; nothing is revoked). Growth OS trades the key at
`/api/auth/refresh` (no reCAPTCHA) for a 30-minute access token and a fresh 7-day key, stores
the fresh key, and does so every hour (`site-sync`), so it never runs out. If it does (the
server was off for a week, or the account's password changed), the card shows "The bodhlok.com
sign-in has run out" and the steps above verify again. The key is kept with the other
integration keys. Setup on the Bodhlok side, once: a Bodhlok account for Growth OS, the
`blog_publisher` preset on the site (CMS → Members), and `self_approval_allowed` on in the site's
settings (a platform admin), since approval already happened in Growth OS. "Sync now" on the
connection card checks the sign-in and the access.
The publisher is one module, `packages/integrations/src/site-publisher.ts`, on the client in
`bodhlok-cms.ts` (`markdownToRichText` turns the agents' Markdown into the CMS's format).

## The page feed (for BODH's web team)

Approved pages reach the website through a read-only feed. It needs the token shown to admins at the bottom of the SEO page (`SEO_FEED_TOKEN` on the server), sent as `Authorization: Bearer <token>`. Responses carry `X-Robots-Tag: noindex`, so this app never competes with the site in search.

| Endpoint | Returns |
|---|---|
| `GET /api/feed/pages` | Live pages: template, slug, suggested URL, title, description. `?full=1` adds the content. |
| `GET /api/feed/pages/<template>/<slug>` | One page: `title`, `description` (meta), `answer` (show at the top), `body_markdown`, `faq`, `json_ld` (put in a `<script type="application/ld+json">`), and for Panchang pages 7 days of `panchang`. |
| `GET /api/feed/panchang?city=delhi&date=YYYY-MM-DD` | One day's Panchang for a city; without `city`, the city list. Times are ISO UTC. |
| `GET /api/feed/llms.txt` | The site's llms.txt, built from live pages. Serve it at `https://<site>/llms.txt`. |

Suggested paths are in `apps/web/lib/seo-feed.ts` (`SITE_PATHS`); the site can use its own. `SEO_SITE_URL` overrides the site address (default: the DataForSEO domain).

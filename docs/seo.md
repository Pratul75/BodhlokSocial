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

## The page feed (for BODH's web team)

Approved pages reach the website through a read-only feed. It needs the token shown to admins at the bottom of the SEO page (`SEO_FEED_TOKEN` on the server), sent as `Authorization: Bearer <token>`. Responses carry `X-Robots-Tag: noindex`, so this app never competes with the site in search.

| Endpoint | Returns |
|---|---|
| `GET /api/feed/pages` | Live pages: template, slug, suggested URL, title, description. `?full=1` adds the content. |
| `GET /api/feed/pages/<template>/<slug>` | One page: `title`, `description` (meta), `answer` (show at the top), `body_markdown`, `faq`, `json_ld` (put in a `<script type="application/ld+json">`), and for Panchang pages 7 days of `panchang`. |
| `GET /api/feed/panchang?city=delhi&date=YYYY-MM-DD` | One day's Panchang for a city; without `city`, the city list. Times are ISO UTC. |
| `GET /api/feed/llms.txt` | The site's llms.txt, built from live pages. Serve it at `https://<site>/llms.txt`. |

Suggested paths are in `apps/web/lib/seo-feed.ts` (`SITE_PATHS`); the site can use its own. `SEO_SITE_URL` overrides the site address (default: the DataForSEO domain).

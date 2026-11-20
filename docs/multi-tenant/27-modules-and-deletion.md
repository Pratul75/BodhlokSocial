# Module entitlements, and deleting a workspace

Four things were reported: presets switching off more than expected, disabled modules still
reachable, no way to delete a workspace, and no actions on the workspace list. This is what was
wrong, what changed, and what was actually run.

---

## 1. Why Essentials switched off more than two modules

**Two separate causes, both real.**

### (a) The preset was internally contradictory

`ESSENTIALS_FEATURES` shipped with `creative.image` and `chat` switched **on**, while
`ESSENTIALS_MODULES` left the `creative` and `chat` **modules off**. A module off with its own
capability on is not a configuration — it is the page gone from the menu while an agent or a
scheduled job keeps using it.

Essentials now contains those two modules, and `presetContents()` filters features through
`FEATURE_MODULE` so the two lists cannot drift apart again. A test asserts every preset is
coherent.

| | Before | After |
| --- | --- | --- |
| Essentials modules | 9 of 16 | **11 of 16** |
| Off under Essentials | creative, ads, seo, community, leads, tracking, chat | **ads, seo, community, leads, tracking** |
| Contradictions | 2 | 0 |

### (b) The console was showing stale state

`setEntitlement` called `revalidatePath("/super-admin/tenants/<id>")` — a route that no longer
exists. The write landed in the database and the page did not refresh. Suspend/resume and the
Security tab had the same bug, pointing at the same dead route.

That dead route (`/super-admin/tenants/[id]`, an older duplicate of the workspace page) has been
removed, and all three now revalidate the pages people are actually looking at.

**This is visible in the audit log of the reported session:** `apply_access_preset essentials`
three times in seven seconds. Pressing it repeatedly is what a page that does not refresh looks
like.

### (c) A preset no longer applies without showing its work

A preset is a whole configuration, not an addition — defensible behaviour, indefensible as a
surprise. The buttons now **preview**:

> Applying Essentials to this workspace would:
> **Switch off 12:** SEO & GEO, Leads, Tracking, Publish approved pages to the website CMS,
> Generate video, Keyword and site-audit syncing, Weekly AI-visibility checks, Send conversions
> to the ad platforms, Mirror billing and leads from the CRM, Serve the public page feed, SEO
> agent, Analyst agent
> **Switch nothing on.** 24 already as the preset wants them.

Then Apply or Cancel. ([screenshot](console-screenshots/20-preset-preview.jpg))

### (d) Modules and features are now kept in step

- Switching a **module off** switches off the features that belong to it, and says how many.
- Switching the module back on does **not** switch them back on — that is a decision, and it
  stays with the person making it.
- A **feature cannot be switched on while its module is off**: the console refuses with
  *"Switch SEO & GEO on first — this belongs to it, and would do nothing on its own."*
- The Features tab greys such features and labels them *(SEO & GEO is off)*.

---

## 2. Disabled modules are now actually disabled

An audit of every page, action and route found the pages and the sidebar were already correct —
all 22 `(app)` pages call `requireModule`, and the sidebar filters on role **and** entitlement.
The holes were elsewhere.

| Hole | Was | Now |
| --- | --- | --- |
| **Approvals** | approving an ad change, a reply or a page only checked the `approvals` module, then made a live ad change / posted publicly / published to the CMS | each approval kind names the module it acts on (`APPROVAL_MODULE`), and that module must be on |
| **`/api/chat`** | the chat tools read funnel, ads, calendar, posts, keywords, audits and strategy with only the `chat` module | `readTools` is filtered by module; chat reads only what the workspace still has |
| **`/api/connect/*`** (6 routes) | `user.role !== "admin"` and nothing else — an admin could complete an OAuth grant with `connections` off | `allowed(user, "connections")` as well |
| **`/api/feed/*`** | a bearer token and nothing else; the `feed.pages` feature key was never read | needs the `seo` module **and** the feature; a stale token no longer outlives the module |
| **Agents and the worker** | gated on `AGENT_FEATURE` only, so a switched-off module kept running its agent on schedule | `tenantHasFeature` now requires the feature **and** its module — one change, every caller |
| **Today page** | hard-coded links to Approvals, Analytics, Calendar and Connections, with no check | hidden when the module is off |

`requireModuleApi()` was added for routes that must **refuse** rather than redirect: a 307 to
another module reads as success to whatever called it.

---

## 3. Deleting a workspace: archive, then purge

**Delete in the console means archive.** The workspace stops answering, everyone in it is signed
out, and **nothing is removed** — schema, roles and every row stay where they are. Confirming
requires typing the workspace's short name; the button stays disabled until it matches exactly.
([screenshot](console-screenshots/21-delete-confirm.jpg))

**Removing the data for good is a separate step**, on the workspace's own Settings tab, and it
is not reachable until the retention window has passed. Four guards live in `purgeTenant`, next
to the statements they guard rather than beside the button:

1. the workspace must already be archived
2. `purge_after` must have passed (30 days, `WORKSPACE_RETENTION_DAYS`)
3. the short name must be typed exactly
4. it must not be tenant #1, whose schema is `public` — dropping that is the installation

Until then the tab says what is kept and until when.
([screenshot](console-screenshots/22-archived-retention.jpg))

Both halves are written to the platform audit log (`archive_tenant`, `restore_tenant`,
`purge_tenant`).

---

## 4. Actions on every workspace

**View · Edit · Suspend/Resume · Delete** on every row, owner-only; everyone else gets View.
An archived row offers **View · Restore** instead. Tenant #1 never shows Delete.

---

## 5. What was actually run

### Automated

**424 tests pass**, `tsc --noEmit` clean, `eslint .` clean. New ones:

| File | Covers |
| --- | --- |
| `packages/shared/src/entitlement-coherence.test.ts` (9) | every feature maps to a real module; `featureUsable` needs both, for all 20 features; `featuresOfModule` |
| `app/(platform)/super-admin/access-presets.test.ts` (10) | every preset is coherent; `presetOf` recognises its own output; `presetChange` names exactly what would go off |
| `packages/db/src/archive.db.test.ts` (7, real Postgres) | each purge guard refuses on its own; archiving removes nothing; restore works; and a real purge drops the schema and both roles |

### In the browser, on the production build

**As a workspace user** (new-test):

| Check | Result |
| --- | --- |
| Switch off two modules | exactly 2 off in the database — `ads`, `community` |
| Their features | exactly 6, all theirs; nothing else touched |
| Sidebar | 16 → 14, missing exactly Ads manager and Community |
| `/ads` direct | redirected away; no ads page, no ads data in the response |
| `/api/connect/postiz/start` with `connections` off | **refused** — redirected with `error=admin_only` instead of starting the OAuth grant |

**As a platform owner** (console):

| Check | Result |
| --- | --- |
| Module toggle | page reflects it immediately, no reload — one press, not three |
| Two off, one at a time | only those two, after each press |
| Essentials preview | named all 12 things that would go off, by label |
| Apply Essentials | 11 on / 5 off, exactly as previewed and exactly `ESSENTIALS_MODULES` |
| Features tab | 8 features greyed with *(… is off)* |
| Switch on `agents.seo` with `seo` off | refused with the message, stayed Off |
| Workspace list | View · Edit · Suspend · Delete on every row; **no Delete on Bodhlok** (tenant #1) |
| Delete confirmation | disabled for `Acme`, for `zenith`, enabled only for `acme` |
| Delete | status `archived`, row offers View · Restore |
| After archiving | schema `t_acme`, both roles, 3 users and 1 calendar item all still present |
| Settings tab | "kept until 20/12/2026", **no purge button at all** |
| Restore | back to `active`, archive fields cleared, data intact |
| Suspend / Resume | both immediate |

### Left as found

`acme` and `zenith` are active with the module sets they had; `new-test` is back on Full. No
workspace was created or removed. Nothing was committed and production was not touched.

### Not covered

- A real purge was proved only in the isolated test database, never against the development one —
  by design: the retention window makes it unreachable, which is the point.
- The chat tool filtering is covered by the module check at the route and the tool map, not by a
  live chat run, which needs an Anthropic key.

---

## 6. Which outside accounts a workspace may connect

Every workspace used to see all 26 integrations on its Connections page, whatever it was paying
for. Now the Super Admin decides, per workspace.

### A third kind of entitlement

`platform.entitlements` already had `kind` — `module`, `feature`, `capacity`. **`integration`**
joins them (`packages/db/platform/006_integration_entitlements.sql` widens the check
constraint; no new table). It answers a different question from the other two: not *may they use
this part of the product* but *may they reach this company's API from here at all*.

**Console → Workspace → Integrations** now has a toggle per account, grouped as the Connections
page groups them, and each says which parts of the product it carries:

> Anthropic API · Strategy, Content calendar, Creative studio, Ask the agents, Agent runs
> Google Ads API · Ads manager, Tracking

Owner-only. Existing workspaces were backfilled with all 26, so nothing changed under anyone.

### A module with none of its accounts is hidden

`MODULE_INTEGRATIONS` maps each module to the accounts it works with, and `effectiveAccess` now
asks three things in order: the role allows the module, the workspace has the module, and — for
a module that needs outside accounts — the workspace has **at least one** of them.

**At least one, not all.** A workspace given Meta but not Google still has an Ads manager worth
opening; one given neither does not. Modules that need no account — Today, Approvals,
Connections, Admin — are never hidden this way.

Taking away the last account a module works with is allowed and says what it did:

> Meta Marketing API is now off. Ads manager is now hidden — no account left to work with.

It is written to the platform audit log the same way (`modulesNowHidden`).

### Enforced, not hidden

| Where | What happens |
| --- | --- |
| Workspace's Connections page | only the granted accounts are listed |
| `saveKey`, `disconnect`, `syncNow`, and the rest | refuse an account the workspace was not given |
| `/api/connect/[key]/start`, `/postiz/*`, `/reddit/*` | refuse before any OAuth begins |
| `/api/connect/google/callback` | checked **again** on the way back, so a grant started before the account was withdrawn cannot land a token |

So no credential can exist in a workspace for an account it was never given.

`syncNow` was also restructured while it was being guarded: it used to call `requireAdmin()`
inside its `try`, so a refusal was caught and written onto the connection card as a *sync
failure*. Permission is now settled before the try.

### Tested

`packages/shared/src/module-integrations.test.ts` — 9 tests: one account is enough; none hides
the module; the map names only real modules and real accounts; the module entitlement and the
role still come first; and an unrestricted workspace is unaffected. Plus two more in
`access-presets.test.ts`: Essentials gives no account to a module it leaves off, and every module
in Full keeps at least one.

**435 tests pass**, `tsc --noEmit` clean, `eslint .` clean.

In the browser, on the production build, against Zenith Dental:

| Step | Result |
| --- | --- |
| Console → Integrations | 26 toggles, each naming the modules it carries |
| Switch off Google Ads | fine — Meta still there, Ads manager stays |
| Switch off Meta as well | done, with *"Ads manager is now hidden — no account left to work with"* |
| Workspace sidebar | 16 → 15, missing exactly **Ads manager**. Tracking and Leads stay, each having other accounts |
| Workspace Connections page | Google Ads and Meta Marketing no longer listed; Anthropic and Vertex still are |
| `/ads` direct | redirected away |

Zenith was put back on Full afterwards.

---

## 7. "I switch one module off and two or three more things go"

Reported after the rest of this was done, and it turned out to be two separate things — one a
real bug, one a missing explanation.

### The bug: the Mentions agent was filed under the wrong module

Two maps said which module an agent belongs to, written out separately:

| | `AGENT_MODULE` | `FEATURE_MODULE` |
| --- | --- | --- |
| mentions | **seo** | **community** |

So switching off **Community** stopped the **Mentions agent**, which is the SEO module's. The
audit log of the reported session shows it happening:

```
module:community=false  →  featuresAlsoOff: community.auto_post, agents.community, agents.mentions
```

`FEATURE_MODULE` now **derives** the agents' entries from `AGENT_MODULE` instead of repeating
them, so the two cannot disagree again, and two tests hold the line: every agent's feature names
the same module the agent does, and everything `featuresOfModule(m)` returns really belongs to
`m`.

### The rest was the relationship being invisible

Switching off **SEO & GEO** switches off six features. That is intended — a capability whose
module is gone is a hole, as §1 says — but two of those six do not *look* like SEO:

- *"Publish approved pages to the website CMS"* — reads as Publishing; it publishes SEO pages
- *"Serve the public page feed"* — the feed serves SEO pages

So it looked like unrelated things were being switched off. Three changes:

1. **The Features tab is grouped by module.** Each group is headed by the module that owns it,
   and says *module is off* when it is. The relationship is now visible before anyone touches a
   switch — including the Mentions agent now sitting under SEO & GEO where it belongs.
   ([screenshot](console-screenshots/26-features-by-module.jpg))
2. **The module toggle names what went with it**, instead of counting:
   > SEO & GEO — *These went off with it: Publish approved SEO pages to the website CMS; Keyword
   > and site-audit syncing; Weekly AI-visibility checks; Serve the public page feed; SEO agent;
   > Mentions agent.*
   ([screenshot](console-screenshots/27-module-names-what-went.jpg))
3. `publishing.site_cms` is relabelled **"Publish approved SEO pages to the website CMS"**, so
   its name matches the module it is filed under.

The toggle also now shows the successful answer at all — it only ever rendered errors, so every
one of these explanations was being written and thrown away.

### Checked

In the console against Zenith Dental: switching off one module switched off **exactly one**
module (16 → 15), named its six features in the row, and left every other module alone. The
Features tab shows eleven module groups, with the Mentions agent under SEO & GEO and no longer
under Community.

**437 tests pass**, `tsc --noEmit` clean, `eslint .` clean. Zenith was put back on Full.

---

## 8. Auditing both maps against the code

Every feature was traced to the line that enforces it, and every account to the code that reads
it. Two kinds of problem came out.

### Two features switched nothing off

| Feature | Said | Did |
| --- | --- | --- |
| `seo.geo_checks` — "Weekly AI-visibility checks" | off | **ran anyway** |
| `crm.sync` — "Mirror billing and leads from the CRM" | off | **mirrored anyway** |

Neither key appeared anywhere outside its own definition: a switch in the console with nothing
on the other end. Both are now checked where the work starts —
`startVisibilityChecks()` in `packages/agents/src/geo.ts`, and both CRM receivers in
`packages/integrations/src/crm.ts`, before the delivery is even logged, so a workspace that is
not paying for it stores nothing.

The other eighteen were already enforced, each in the module the map claims:

| Feature | Enforced in | Module |
| --- | --- | --- |
| `publishing.postiz` | `publisher.ts` | Publishing |
| `publishing.site_cms` | `site-publisher.ts` (publishes `seoPages`) | SEO & GEO |
| `ads.write`, `ads.auto_apply` | `ads.ts` | Ads manager |
| `creative.image`, `creative.video` | `creative.ts` | Creative studio |
| `seo.keywords` | `seo.ts` | SEO & GEO |
| `community.auto_post` | `community.ts` | Community |
| `tracking.forwarding` | `pipeline.ts` | Tracking |
| `feed.pages` | `lib/seo-feed.ts` | SEO & GEO |
| `chat` | `api/chat/route.ts` | Ask the agents |
| `agents.*` | `run.ts`, via `AGENT_FEATURE` | derived from `AGENT_MODULE` |

### Three accounts belonged to no module

`openai` and `perplexity` are the engines the AI-visibility checks ask — SEO's work — and
`whatsapp`, `email` and `crm_billing` are read by the CRM and attribution code behind Leads. All
were unclaimed, which has two consequences: no module hides when they are withheld, and **every
preset grants them** whatever else it switches off, because `presetContents` treats an unclaimed
account as belonging to nobody. They are now claimed.

`google_app` genuinely belongs to no module — it is the OAuth client other Google connections go
through — so it is named in `UNCLAIMED_INTEGRATIONS` with that reason. A test now fails if any
account is neither claimed by a module nor named there, so adding an integration and forgetting
this map is no longer a silent mistake.

### Checked, per workspace

On the production build, with five accounts withheld from **Zenith Dental** — OpenAI, Perplexity,
LinkedIn, Quora, WhatsApp:

| Check | Result |
| --- | --- |
| Console, Zenith | *21 of 26 allowed* |
| Console, Acme Ltd | *26 of 26 allowed* — untouched by Zenith's |
| Zenith's Connections page | **21 cards**, and not one of the five withheld |
| Zenith's sidebar | still 16 — every module kept at least one account, which is the rule working, not failing |

Then Zenith was put back on Full.

**439 tests pass**, `tsc --noEmit` clean, `eslint .` clean. Two new tests hold the account map:
every account is claimed or named as infrastructure, and nothing is both.

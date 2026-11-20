# Going live: what changes for the installation that is already running

growth.rechargestudio.com runs today on Google sign-in alone, with one workspace — Bodhlok, in
the `public` schema. This is what this work does to it, what was checked, and the order to
deploy in.

---

## 1. Does Google sign-in still work? Yes, untouched

Nothing in the Google path changed. What changed is what the app asks **first**.

It used to ask *"is Google configured?"* before *"is this person signed in?"*. That had to be
turned around, because a workspace that signs in with passwords has no Google client at all and
would have been redirected to the sign-in page on every single page, forever. Now:

```
a valid session cookie  →  in, however it was obtained
no session, Google on   →  the sign-in page, which offers Google
```

For an installation with Google configured, the second line is exactly what happened before.

**Checked on a production build with a Google client configured:**

| | |
| --- | --- |
| `/api/auth/google` | 307 to `accounts.google.com/o/oauth2/v2/auth?client_id=…` — the live path, intact |
| Sign-in page | shows the password form, an **or**, and **Sign in with Google** |
| A session minted the way the Google callback mints one | opens the whole app |

### The sign-in page looks different

The password form is above Google now, with an "or" between them. The Google button itself is
unchanged. Nobody loses a way in; there is a second one.

---

## 2. Does Bodhlok have a problem? No — and one thing was fixed so it would not

**The risk, found before it shipped.** Integration entitlements are a new *kind* of row. Bodhlok
has module and feature rows from an earlier deploy, and would have had **no integration rows at
all**. The rule "a module needs at least one of its accounts" would then have read "this
workspace has no accounts" and hidden **twelve of sixteen modules** the moment it deployed —
Strategy, Content calendar, Creative studio, Publishing, Ads manager, SEO & GEO, Community,
Leads, Analytics, Tracking, Ask the agents, Agent runs.

Two changes stop that:

1. **Absence of a kind that did not exist is not a refusal.** A workspace with rows but none of a
   newly-added kind keeps everything of that kind until an operator decides otherwise. No rows
   **at all** still means nothing — that is a broken workspace, not an old one. Six tests in
   `packages/db/src/entitlements-store.test.ts` hold both halves.
2. **The deploy fills the rows in itself.** `pnpm db:migrate` now writes entitlement rows for
   anything added since each workspace was made, `on conflict do nothing` — so a switch an
   operator has already set is never overwritten.

**Verified:** running the real `pnpm db:migrate` against a database with seven workspaces left
every one of them exactly as it was, including a workspace with seven modules deliberately
switched off.

### Two things that will start being enforced

These are **behaviour changes on live**, because the switches existed and did nothing:

| Switch | Was | Will be |
| --- | --- | --- |
| *Weekly AI-visibility checks* (`seo.geo_checks`) | ran whatever the switch said | runs only when on |
| *Mirror billing and leads from the CRM* (`crm.sync`) | mirrored whatever the switch said | mirrors only when on |

Both are **on** for Bodhlok, so nothing stops. But check them before deploying — the preflight
below reports it.

---

## 3. Run this against production first

```
cd packages/db && pnpm exec tsx ../../scripts/preflight.ts
```

Read-only — every statement is a SELECT, it opens no transaction and writes nothing. It reports:

- whether the control plane and its newer columns are there
- which per-workspace migrations each workspace is missing
- whether a workspace has entitlement rows, and of which kinds
- **whether any module would disappear** the moment this ships
- any capability switched on whose module is off

It exits non-zero if it finds a problem. Against the development database it reported
`0 problems` across seven workspaces — and did catch a real oddity on a test workspace, two
features left on under modules that are off.

---

## 4. Deploy order

1. **Preflight** against production (above). Read the output.
2. **`pnpm db:migrate`** — control-plane SQL, then every workspace's migrations, then the
   entitlement backfill. Idempotent; safe to run twice.
3. **Deploy the application.**
4. Set **`PLATFORM_OWNER_EMAIL`** if it is not set, then give that owner a password
   ([25-console-access.md](25-console-access.md) §2) and sign in at **`/super-admin`**.

`/platform` keeps working — it answers with a 308 to `/super-admin`, carrying the `next`
parameter with it, so saved links and bookmarks survive.

### Migrations this adds

| | |
| --- | --- |
| Per workspace | `0014_user_passwords`, `0015_temporary_passwords`, `0016_user_phone` |
| Control plane | `002_operator_auth`, `003_operator_lockout`, `004_invite_tokens`, `005_tenant_archive`, `006_integration_entitlements` |

All additive: new columns and two new tables. Nothing is dropped, nothing is rewritten.

### Nothing new is required in the environment

`ALLOW_LOCAL_SECRETS` is for running a production build on a laptop; production sets
`SECRETS_BACKEND=gcp` and never reaches it. `WORKSPACE_RETENTION_DAYS` defaults to 30.

---

## 5. End to end, on a production build

### As a person who has never had a password — which is everyone on live today

A session was minted the way the Google callback mints one, for `seo@rechargestudio.com` in
tenant #1 (`password none`), and every page was opened:

| | |
| --- | --- |
| Rendered their own page | Today, Strategy, Content calendar, Approvals, SEO & GEO, Leads, Analytics, Ask the agents, Agent runs |
| Refused | Creative studio, Publishing, Ads manager, Community, Tracking, Connections, Admin |

That is exactly what an **seo_manager** may see. Repeated as `ads_manager`: Today, Ads manager
and Tracking rendered; SEO, Publishing and Admin were refused. Role access is unchanged.

### Public endpoints

| | |
| --- | --- |
| `/api/health` | 200 |
| `/api/feed/pages` with no token | 401 |
| `/api/feed/pages` with **tenant #1's own token** | 200 |
| `/api/feed/llms.txt` with it | 200 |
| `/api/feed/pages` with **another workspace's token** | 401 |
| `/api/events/bodh` unsigned | 401 |

The feed now also needs the SEO module and the page-feed feature, both of which Bodhlok has.

### The suite

**443 tests pass**, `tsc --noEmit` clean, `eslint .` clean, `next build` clean.

---

## 6. What is still worth knowing

- **The owner account on this laptop** (`owner@growth.local`) and the test operator are local
  only. Production needs its own `PLATFORM_OWNER_EMAIL`.
- **Impersonation is read-only at the database**, so an operator looking inside a workspace
  cannot change anything — including issuing a password link, which is owner-only anyway.
- **A platform operator who is not an owner** can still add a user to a workspace with their own
  address and sign in through Google. That predates this work and is not closed by it.
- **The entitlement cache is per process**, 30 seconds. On more than one instance a switch takes
  up to that long to reach them all. The console says so.

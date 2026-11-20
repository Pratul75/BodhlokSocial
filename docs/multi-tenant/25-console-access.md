# Getting into the Super Admin console locally

Everything below is for the development machine, against the isolated development database on
host port 5434. Nothing here touches production.

## Before you start

The server must be running on port 3200 and the database must be up:

```bash
docker start bodh-baseline-db
```

```bash
cd /home/recharge/BodhlokSocial/apps/web && TENANT_HOST_SUFFIX=localhost pnpm exec next dev --port 3200
```

It is running now. Check it with:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3200/super-admin/signin
```

---

## 1. The console's address

**http://127.0.0.1:3200/super-admin**

Signed out, that sends you to **http://127.0.0.1:3200/super-admin/signin**.

The console is a separate principal from the workspaces. A workspace sign-in does not work here,
and a workspace admin can never become an operator: operators live in their own table, with their
own cookie and their own token audience.

| Address | What it is |
| --- | --- |
| `/super-admin/signin` | Sign in (open) |
| `/super-admin/reset?token=…` | Set a password from a one-time link (open) |
| `/super-admin` | Overview |
| `/super-admin/workspaces` | Workspaces |
| `/super-admin/workspaces/<id>` | A workspace, with eight tabs |
| `/super-admin/operators` | Operators |
| `/super-admin/audit` | Audit log |

---

## 2. The first owner, and setting its password

The first owner is created by the deploy step from a **required** environment variable — never
guessed, and never created if the variable is missing:

```bash
grep PLATFORM_OWNER .env
```

```
PLATFORM_OWNER_EMAIL=owner@growth.local
PLATFORM_OWNER_NAME=Platform Owner
```

```bash
cd /home/recharge/BodhlokSocial && pnpm db:migrate
```

That prints `Platform owner present: owner@growth.local.` — or, with no variable set, warns that
nobody can sign in and creates nothing.

**That owner has no password yet.** Two ways to give it one:

**a. Through the console (what a real operator does).** Sign in with the address alone — which
works only in development, and only while the account has no password (step 3), then:

1. Go to `/super-admin/operators`.
2. On the owner's row, click **Issue password link**.
3. Copy the link that appears below the row. It is shown once and lasts an hour.
4. Open it, set a password of at least 12 characters with letters and a number.
5. You are signed out; sign in again with the new password.

**b. From the command line**, if you would rather not use the development door at all:

```bash
cd /home/recharge/BodhlokSocial/packages/db && pnpm exec tsx --env-file-if-exists=../../.env -e "import('@bodh/db').then(async (db)=>{const t=await db.ownerSql()\`select id from platform.platform_operators where email='owner@growth.local'\`;console.log('/super-admin/reset?token='+(await import('../../apps/web/lib/platform-auth.ts')).issueResetToken(t[0].id));process.exit(0)})"
```

The simpler route is (a); this one exists so you know the link is nothing but a row in the
database with a hashed token.

Once a password is set, that account can no longer sign in with its address alone — setting one
closes the weaker door behind it.

---

## 3. Signing in as the owner

Go to **http://127.0.0.1:3200/super-admin/signin** and enter:

- **Email** `owner@growth.local`
- **Password** — the one you set. **Leave it empty** while the account has none and you are on
  `next dev`; the page says so.

The development fallback exists only where `NODE_ENV` is not `production`. A built server
(`next build && next start`) sets it, so there the password is the only way in.

A wrong password and an unknown address give the same message — which of the two it was is not
something a sign-in page should tell anybody — and both are written to the audit log, the failure
with `result: bad_password`.

---

## 4. Issuing and using a password reset link

**There is no mail service in this application, so nothing is emailed.** An owner issues the link
and hands it over.

To issue one:

1. Sign in as an **owner** (support and billing operators cannot do this).
2. `/super-admin/operators` → the person's row → **Issue password link**.
3. The link appears under the row, once. Copy it then; it is not shown again.

To use one:

1. Open `http://127.0.0.1:3200/super-admin/reset?token=…`.
2. Type the new password twice. At least 12 characters, with letters and a number.
3. **Set password.**

What the link is, and what it is not:

- Good for **one hour** and **once**: using it clears the token.
- Only its SHA-256 is stored, so the database holds nothing that would open the account.
- Setting a password raises that operator's session version, so any console session opened with
  the old password stops working immediately.
- An expired or already-used link says so and offers the way back to sign in.

To take someone's access away, use **Remove access** on their row: it deactivates them, raises
their session version and ends any workspace they have open. The last owner cannot be removed,
and nobody can remove themselves.

---

## 5. Screenshots

In `docs/multi-tenant/console-screenshots/`, all taken just now on port 3200, signed in as
`owner@growth.local`:

| File | Page |
| --- | --- |
| `00-signin.jpg` | Sign in |
| `01-overview.jpg` | Overview |
| `02-workspaces.jpg` | Workspaces, with the owner-only New workspace card |
| `03-workspace-details.jpg` | A workspace: the Overview tab |
| `04-workspace-users.jpg` | Users |
| `05-workspace-features.jpg` | Features |
| `06-workspace-integrations.jpg` | Integrations |
| `07-workspace-usage.jpg` | Usage |
| `08-workspace-security.jpg` | Security |
| `09-operators.jpg` | Operators |
| `10-audit-log.jpg` | Audit log |
| `11-mobile-menu.jpg` | The menu at 375px (production build) |
| `12-set-password-link.jpg` | The page a one-time link opens |
| `13-tenant-admin-unchanged.jpg` | The Tenant Admin, untouched |

---

## 6. What was tested in a browser, and what was not

Every workflow below changed the development database and the change was read back from Postgres.
The distinction that matters is **how the button was pressed**, because this console's forms are
server actions: in the browser pane on `next dev`, Next's HMR websocket is blocked and Turbopack
does not hydrate, so a form still submits as a plain HTML POST — the work happens, but no
JavaScript ran. The production build hydrates normally.

### Driven in a real browser, with JavaScript running (production build)

| Workflow | What was observed |
| --- | --- |
| The mobile menu at 375px | The button toggled `aria-expanded` and the navigation appeared |
| Every console page loads | All twelve addresses returned 200 against the built server |

### Driven in a real browser, as plain form posts (`next dev`, no JavaScript)

These were clicked in the browser; the form submitted without hydration, which is how the console
behaves with JavaScript disabled.

| Workflow | What was observed |
| --- | --- |
| Operator signs in with an address | Session cookie issued; `operator_sign_in result: ok` |
| Sign-in with a **wrong** password | Refused with the shared message; `result: bad_password` audited |
| Sign-in with the **right** password | Signed in as Support; role shown in the top bar |
| Owner adds a support operator | Row in `platform.platform_operators`, role `support` |
| Owner issues a one-time password link | Link rendered once; only its hash stored |
| Operator sets a password from the link | `scrypt$16384$8…` stored, token cleared, `password_set_at` set |
| Add a person to a workspace | `priya@acme.test` written to `t_acme.users` **and** `platform.user_directory` |
| Apply Essentials | 9 of 16 modules, 5 of 20 features |
| Apply Full | Back to 16 and 20 |
| Set a workspace's monthly AI budget | Capacity row `40.00`; the Usage tab reads back "of $40 budget" |
| Start a read-only look inside a workspace | Row in `platform.impersonations`; the app showed that workspace under a banner |
| Stop the look | `ended_at` set; `end_impersonation` audited |
| Rotate a workspace's event secret and feed token | Values written under that workspace's own names |

### Checked by reading the rendered page, not by clicking

| Workflow | How |
| --- | --- |
| Workspace search, status filter and sort | Through the address (`?q=zen`, `?status=`, `?sort=`); the list narrowed and reordered |
| Audit filters | Through the address (`?action=operator_sign_in`); failures included |
| A support operator sees no owner-only controls | The create-workspace card and the rename and plan forms were absent from the page |
| The Security tab's role grants | Queried live from `information_schema.role_table_grants` and rendered: `bodh_t_acme_app` reads and writes, `bodh_t_acme_app_ro` read-only |
| An access preset reaches the product | `/t/acme/ads`, `/seo`, `/community` redirected while `/calendar` and `/publishing` rendered |
| Old links still work | `/super-admin/tenants/<id>` redirects to `/super-admin/workspaces/<id>` |

### Not tested

- **Typing in the search box and changing the filter dropdowns with JavaScript running.** Those
  are the only client-side-only interactions in the console. They were exercised through the
  address bar instead, which is the same code path the client component triggers.
- **The Tenant Admin on a built server.** It refuses to run without a Google client in
  production, by design, so it was checked on `next dev`.
- Anything that needs real Google sign-in, GCP Secret Manager, or a deployment.

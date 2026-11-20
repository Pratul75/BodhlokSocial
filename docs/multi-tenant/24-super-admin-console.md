# The Super Admin console

Branch `multi-tenant`. **Nothing committed, pushed or deployed.** The app runs on port 3200
against the isolated development database; four workspaces (bodhlok, acme, zenith, aceme).

**Gate: 372 unit tests across 7 packages, none skipped. Lint clean, typecheck clean, production
build succeeds.** Screenshots in `docs/multi-tenant/console-screenshots/`.

---

## What it is now

| Page | Address | What it does |
| --- | --- | --- |
| Sign in | `/super-admin/signin` | Email and password, with a development fallback |
| Set password | `/super-admin/reset?token=…` | Where a one-time link lands |
| Overview | `/super-admin` | The platform's numbers, read live from each workspace |
| Workspaces | `/super-admin/workspaces` | Search, filter, sort, create |
| Workspace | `/super-admin/workspaces/<id>` | Eight tabs, each its own address |
| Operators | `/super-admin/operators` | Add, remove, issue a password link; who is inside a workspace |
| Audit log | `/super-admin/audit` | Every platform action, filtered by who, what and which workspace |

Old `/super-admin/tenants/<id>` links still work: they redirect.

## 1. Sign-in

Operators now have **passwords**, hashed with scrypt (`scrypt$N$r$p$salt$key`, Node's own crypto,
no new dependency). The console used to accept any known operator address, which was only ever
safe because it refused to run outside development.

- A password works everywhere. An address alone works only where the tenant app's development
  sign-in works, and only for an operator who has no password yet — so setting one cannot leave
  the weaker door open behind it.
- A wrong password and an unknown address give the same answer, and both are recorded.
- No mail service exists here, so nothing is emailed. An owner issues a one-time link from
  Operators; it lasts an hour, is single-use, and only its SHA-256 is stored.
- Setting a password raises the operator's session version, so any console session opened with
  the old one stops at once.

## 2. Shell

A dark rail and a thin top bar, built the same way as the tenant app's — same radii, same rule
colour, same rotated diamond on the active row — so an operator moving between the two halves
does not have to relearn anything. Breadcrumbs on the left of the top bar, who is signed in and
Sign out on the right, and a badge when an operator has no password yet. Below 1024px the rail
collapses to a header with a menu button.

## 3. Overview

Every figure is read from the workspace it belongs to, through that workspace's **read-only
role** — the same binding an operator gets when they look inside one. Nothing is cached in the
control plane, so nothing can be stale or wrong in a way nobody notices.

Workspaces, people, agent runs and AI spend across the platform; operators, open looks and
today's platform actions; then "Needs a look" (suspended workspaces, approvals waiting, and any
workspace the console could not read), the busiest workspaces by AI spend, and recent activity.

## 4. Workspaces

Name, address and schema; status; people; modules on; approvals waiting; AI spend over 30 days;
last activity. Search by name, address or schema, filter by status, sort four ways — all kept in
the address bar, so a filtered list is a link that can be sent and the back button works.
Creating a workspace is owner-only.

## 5. The eight tabs

| Tab | What it shows and does |
| --- | --- |
| Overview | The workspace's numbers, what it may use, where it lives (schema, both roles, created, last activity), and what operators have done to it |
| Users | Its own `users` table: add somebody, change a role, remove or restore access. Warns when somebody is in the workspace but missing from the sign-in directory |
| Modules | The 16 sections, each a switch; the access level, with Apply Full and Apply Essentials |
| Features | The 20 capabilities, split into what the workspace may do and which agents it has |
| Integrations | Its connections and their status, plus the two public-endpoint credentials with their addresses |
| Usage | AI spent this month by agent, what was published, what is scheduled, and the six limits |
| Security | The schema and both database roles with their **real** grants, who has looked inside, and the workspace's own audit log |
| Settings | Name, plan, fixed address, and the ten accounts and addresses this workspace works with |

## 6. People

Adding somebody writes into the workspace's own `users` table **and** the control plane's sign-in
directory — the two places that have to agree for Google sign-in to find them. This product has
no passwords for workspace users, so there is nothing to email and the page says so rather than
pretending to send an invitation. Removing access raises their session version, signing them out
everywhere, and refuses to leave a workspace with no admin.

## 7. Access levels

- **Full** — every module and every feature.
- **Essentials** — the half of the product a workspace can run on without ad spend or agents
  acting on their own: no Ads manager, no Tracking, no ad writes, no auto-apply, no video, no
  automatic community posting.
- **Custom** — anything else. Switching one thing by hand makes a workspace Custom, and the page
  says so.

Six tests pin this, including that Essentials leaves out exactly the things that spend money or
act without a person, and that applying a preset produces a state the preset check recognises.

## 8. Operators, impersonation, audit

Operators: add an owner, support or billing operator; remove access, which also ends any look
they have open and stops their console session; issue a one-time password link. The last owner
cannot be removed, and nobody can remove themselves. Support and billing operators cannot create
workspaces, rename them, change plans, apply presets or issue password links — the pages hide
those controls and the actions refuse them.

The audit log filters by operator, action and workspace, and pages through the history. Reads are
in it as well as writes: "who looked at my data?" is the question it exists to answer.

## 9. Responsive

The rail collapses below 1024px into a header with a menu button; stat tiles stack; every table
scrolls horizontally inside its card rather than stretching the page. Checked at 375 × 812 and
1440 × 900.

---

## Workflows tested against the real backend

Each of these changed the development database, and the change was read back from Postgres.

| # | Workflow | Evidence |
| --- | --- | --- |
| 1 | Operator signs in with an address (development) | Session cookie issued; `operator_sign_in result: ok` in the audit log |
| 2 | Owner adds a support operator | Row in `platform.platform_operators`, role `support`; `save_operator` audited |
| 3 | Owner issues a one-time password link | Link shown once; only its hash stored |
| 4 | Operator sets a password from the link | `password_hash` begins `scrypt$16384$8`, `reset_token_hash` cleared, `password_set_at` set |
| 5 | Sign-in with the **wrong** password | Refused with one message for both failure kinds; `result: bad_password` audited |
| 6 | Sign-in with the right password | Signed in as Support; top bar shows the role; "No password set" badge gone |
| 7 | Support operator sees no owner-only controls | Create-workspace card and rename/plan forms absent |
| 8 | Add a person to a workspace | `priya@acme.test` in `t_acme.users` **and** `platform.user_directory`; `invite_user` audited |
| 9 | Apply Essentials to a workspace | 9/16 modules, 5/20 features; ads, seo, community, creative, chat, leads, tracking off |
| 10 | The preset is enforced in the product | `/t/acme/ads`, `/t/acme/seo`, `/t/acme/community` all redirect; `/t/acme/calendar` and `/t/acme/publishing` render |
| 11 | Apply Full | Back to 16/16 and 20/20 |
| 12 | Set a workspace's monthly AI budget | `platform.entitlements` capacity row `40.00`; the Usage tab reads back "of $40 budget" |
| 13 | Workspace search and filters | `?q=zen` returns Zenith alone; status and sort change the list |
| 14 | Audit filters | `?action=operator_sign_in` narrows to sign-ins, failures included |
| 15 | Security tab's role grants | Queried live from `information_schema.role_table_grants`: `bodh_t_acme_app` reads and writes, `bodh_t_acme_app_ro` read-only |
| 16 | Mobile menu | Opens and closes at 375px (verified on the production build) |
| 17 | Old links | `/super-admin/tenants/<id>` redirects to the new address |
| 18 | Tenant Admin unchanged | Renders with its own design, people, spend caps and workspace settings |

## Known limits

- **Client-side interactivity cannot be verified in `next dev` inside this browser pane**: the
  pane blocks Next's HMR websocket, and without it Turbopack's dev client does not hydrate — the
  tenant app's own sidebar button is dead there too. It was verified on the production build
  (`next build && next start`), where everything hydrates. Every form in the console is a server
  action, so the console works without JavaScript either way, which is how workflows 1–14 above
  were exercised.
- **No mail service.** Password links are handed over, not sent. Adding a workspace user emails
  nobody either; they sign in with Google.
- **Plans are a label.** Access is what the Modules and Features tabs set; the plan field is for
  your own records and nothing enforces it.
- **No workspace deletion** from the console. Suspending is there; deleting a schema is not
  something a button should do.
- **The Overview reads every workspace on each load.** Four workspaces is four short queries;
  this will need caching or a summary table well before a hundred.

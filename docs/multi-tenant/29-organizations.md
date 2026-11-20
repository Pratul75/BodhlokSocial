# Organizations: an agency, its own workspace, and its clients

**Status: built. All five phases are in the branch this document arrived on.**

What follows is the plan as it was agreed, kept as it was written so the reasoning can be
read against the result. Section 11 says what was actually built and where it differs.

This is what was agreed in conversation, written down so it can be argued with
before anything is built.

---

## 1. What is being asked for

Today the application has two levels: the platform, and workspaces. A third goes
in the middle.

```
Super Admin
└── Organization: Recharge Studio          (an agency / a customer)
      ├── Recharge Studio's own workspace  (the agency's own marketing)
      ├── Client ABC's workspace
      ├── Client XYZ's workspace
      └── Client PQR's workspace
```

- **Super Admin** creates an Organization for a customer.
- That customer signs in and gets **a complete workspace of its own** — exactly
  what exists today: every module, integrations, WhatsApp, automations, the
  chatbot, settings and users.
- The agency has its own clients, so it can create **more workspaces** inside
  its Organization.
- **Every workspace is independent**: its own schema, its own database role, its
  own users, integrations, credentials, automations and data.
- The Organization holds no data. It is a management layer that groups the
  agency's own workspace with its clients'.
- What the agency may see inside a client is decided by a **permission model**,
  not by assumption.

In this product's words: a **workspace is a client**, an **organization is the
agency**.

## 2. The one thing that must not be lost

Every workspace — the agency's own and each client's — keeps its own Postgres
schema and its own database role. That is not decoration: it is the reason one
workspace cannot read another's rows. The refusal comes from Postgres, not from
a `where` clause the application has to remember.

Nothing in this plan weakens that. The Organization layer sits **above** it, in
the control plane, and never becomes a thing data lives in.

## 3. What does not change

Worth stating plainly, because it is most of the system:

- Every existing workspace keeps its data, its people, its roles, its
  integrations and its settings. Nothing is migrated.
- Roles inside a workspace work exactly as they do now.
- The sign-in doors (Google, and email + password) stay as they are.
- `/super-admin` stays what it is. The boundary between a platform operator and
  a workspace user is not touched.
- The URL keeps no workspace name in it.

## 4. The structure, in the control plane

Two additions, both additive:

| What | Why |
| --- | --- |
| `platform.orgs` | One row per agency: name, slug, status, plan, created |
| `tenants.org_id` | Which agency a workspace belongs to |

Existing workspaces are given a default organization at migration time, and the
BODH workspace that is live today becomes **that organization's own workspace**.
No data moves; one column is filled in.

## 5. Who may see what

An agency's admin does **not** automatically get inside a client. Each client
carries an access level for that agency:

| Level | What the agency can do |
| --- | --- |
| **Full** | Work inside the client exactly as that client's own admin would |
| **Manage** | Only from outside: people, roles, modules, limits, spend. No content |
| **None** | The client exists as a name and a number, nothing more |

**How it is enforced.** Not with a flag the application has to check in every
place — that kind of rule opens quietly the first time somebody forgets it.
Instead:

- **Full** means the person genuinely has an active `users` row in that client's
  schema, with a role. Every existing mechanism then applies unchanged: the
  sidebar, the module checks, the audit log, the approval rules.
- **Manage** and **None** mean no such row exists. The database refuses, as it
  already does for everybody else.

So the permission model rides on the boundary that is already there, rather than
building a second one beside it.

Defaults and rules:

- When an agency creates a client itself, the default is **Full** — it made it.
- Super Admin can cap what an organization may grant itself.
- A change of level is written to the audit log and is visible on the client's
  own Admin page. The client should always be able to see who from the agency
  can reach them.
- A client's own admin cannot remove the agency's people, or the agency would be
  locked out of a workspace it is responsible for.

## 6. The sign-in page

Decided: **the organization is chosen on the sign-in page itself, from a list of
every organization, shown to everybody who opens the page.**

The page asks in this order:

1. Organization — a searchable dropdown, filled on load
2. Email
3. Password

The alternative was to fill the list from the address once it was typed, so that
a visitor only ever saw their own organization. That was put forward and not
taken: the list is to be visible from the start. The cost is recorded here so
nobody is surprised by it later — the names of every customer are on a public
page, and the list needs searching once it is long.

Four things keep that decision from costing more than it has to:

- **Only active organizations are listed.** Archived and suspended ones drop off
  by themselves.
- **The dropdown shows names and submits ids.** No slug, schema name or other
  internal identifier leaves with it.
- **Choosing the wrong organization gives the ordinary refusal.** "That email and
  password do not match an account here" — exactly what a wrong password gives.
  This matters more than it looks: a public list of organizations plus a reply
  that varied by organization would together answer "which agency is this person
  with?" for anybody who cared to ask. The reply does not vary.
- **The list is cached and served the same to everyone**, so it cannot be used to
  put load on the control plane.

### The organization must be enforced, not decorated

A field that is shown but not checked is worse than no field: it tells the
person something was verified when nothing was. So:

1. **An organization must be chosen.** The form does not submit without one.
2. **Both have to be true.** The password must match *and* the workspace it
   opens must belong to the chosen organization. Either one failing is a
   failure.
3. **A wrong organization gives the ordinary refusal** — never "you are not in
   that organization". With a public list of organizations, a reply that varied
   would answer "which agency is this person with?" for anybody who asked.
4. **The organization can only narrow, never widen.** The id posted by the form
   is not trusted: the server checks it names a real, active organization and
   then uses it to *shorten* the list of workspaces the password is checked
   against. A tampered id cannot open anything extra; at worst it opens nothing.
5. **What comes after inherits the same limit.** Somebody with workspaces in two
   organizations who signs in to one reaches only that one's workspaces, from
   the switcher.
6. **The session stores the workspace, and the organization is derived from it.**
   Nothing carries the posted organization forward, so there is no second copy
   of the truth to drift.

A consequence worth stating: **one session, one organization.** Somebody who
works for two agencies signs out and signs in again to move between them. That
is the straight reading of "nothing should mix up", and it is cheaper to keep
than to explain.

Google sign-in cannot ask first, because that flow leaves the page before any
identity is known. Those people come back to the workspace picker instead, with
the workspaces grouped by organization.

## 7. Switching between workspaces

A person who works in several workspaces gets a switcher in the **top corner of
the sidebar**, on the workspace name that is already there. No new furniture: the
name becomes the control. The list comes from the control plane's directory —
the workspaces that address can actually open.

It appears **only when there is more than one**. Somebody who belongs to a single
workspace sees exactly what they see today, with nothing to click.

What is inside follows the role in the workspace that is chosen, which is read
from that workspace's own `users` row. The same person can be a social media
manager in the agency's workspace — Creative studio and Publishing, no SEO — and
an SEO manager in a client, where SEO & GEO appears and those two go. The name
and role shown at the foot of the sidebar change with it.

**How a switch works:**

1. The switcher sends a **server action**, not a link. A link is a `GET`: a
   prefetch, a stray reload or an old tab could fire it. Changing workspace
   changes who you are for every later request, so it is a deliberate `POST`.
2. The server checks that this person has an **active `users` row** in the
   target workspace. No row, no switch.
3. A **new session cookie** is issued, carrying that workspace and that row.
4. Every later request is that workspace's, because the session says so. No part
   of the application has to remember that a switch happened — and anything that
   has to be remembered is the thing that eventually forgets.

The role is read fresh from the new workspace's own `users` row, so the same
person can be an admin in one client and a viewer in another, and the sidebar
changes accordingly. If their access is removed while they are inside, the next
request refuses.

### One workspace at a time — and the tab that goes stale

Decided: one session cookie, so **one workspace at a time**. Two clients cannot
be open in two tabs. Seeing two at once means a second browser profile.

This creates a real hazard that has to be closed in the same phase as the
switcher:

> Tab A is showing Client ABC's calendar. In Tab B you switch to Client XYZ.
> Tab A still *shows* ABC — but the cookie is now XYZ's. Pressing "add post" in
> Tab A would write to **XYZ**.

That is a data mix — not in the database, but between the screen and the
session, which is just as wrong for the person using it.

**The guard:** every page carries the workspace it was rendered for, and every
action compares that with the session before doing anything. If they disagree,
the action does not run and the page says it belongs to another workspace and
should be reloaded.

A guard of exactly this shape already exists: when the workspace used to be in
the address, the address and the cookie were compared and a mismatch was
refused. Taking the name out of the address left that guard with nothing to
compare. This replaces it.

## 8. The plan, in five phases

Each phase is shippable on its own and leaves the application working.

### Phase 1 — The organization relationship

`platform.orgs`, `tenants.org_id`, a default organization for everything that
exists today. The Super Admin console lists workspaces grouped by organization,
and asks which one a new workspace belongs to.

*Nobody's sign-in changes. Nothing breaks. Smallest phase.*

### Phase 2 — An organization gets its own workspace

Creating an organization creates its first workspace in the same step: a full
one, exactly like today's. The agency signs in and starts working in it.

*Reuses the provisioning that already creates workspaces.*

### Phase 3 — The switcher, with its guard

The switcher in the sidebar, the server action behind it, and the stale-tab
guard described above. The guard is not a separate piece of work: a switcher
without it is unfinished.

### Phase 4 — The `/org` console

The agency's own panel: my clients, create a client, its people and their roles,
its spend. A smaller `/super-admin`, scoped to one organization, built on the
same shape.

*Largest phase.*

### Phase 5 — Permissions and ceilings

The three access levels become settable, and Super Admin gives each organization
its ceiling: how many clients, which modules, how much budget. The token-use page
gains an organization total.

*Until this phase lands the default is **Full**, so phases 2–4 give an agency
full access to the clients it creates. If the levels are needed from day one,
this phase moves ahead of Phase 3 and the console arrives later.*

## 9. Still open

These can wait until Phase 4, but they are decisions, not details:

1. **Deleting an organization** — presumably archiving every workspace under it,
   with the retention rules that already exist. Who may do it, and what the
   client is told.
2. **One person in two organizations** — a freelancer working for two agencies.
   Possible, but the sign-in picker and the switcher must group by organization,
   or two companies' clients appear in one flat list.
3. **The ceilings themselves** — how many clients, which modules, how much
   budget, per plan.

## 10. What could go wrong

| Risk | Where it bites | What this plan does about it |
| --- | --- | --- |
| The live BODH workspace ends up with no organization | Deploy day | Phase 1 creates the default organization and fills `org_id` in the same migration |
| An agency quietly gains access to a client | Trust | Full access means a visible `users` row on the client's own Admin page, never a hidden flag |
| A stale tab writes to the wrong client | Every day, once switching exists | The page-to-session guard, shipped with the switcher |
| An organization outgrows what it was sold | Billing | Ceilings in Phase 5, enforced where the budget is already enforced |
| Two agencies' clients mixed in one list | A freelancer's sign-in | The chosen organization narrows the picker; one session, one organization |
| The organization field is shown but not checked | Sign-in | Enforced on the server: password *and* membership, with the ordinary refusal when either fails |

---

*Written before any code. The structure above was agreed in conversation on
20 November 2026; the phases are a proposal.*

---

## 11. What was built

All five phases. Where the result differs from the plan above, it is because building it
settled a question the plan had left open.

**Phase 1.** `platform.orgs`, `tenants.org_id`, and a migrate step that creates the first
organization and puts every existing workspace in it — named from `FIRST_ORG_NAME`, or after
the installation. The console lists workspaces grouped by agency and asks which one a new
workspace belongs to. Two rules the database enforces rather than the application: an
organization with workspaces cannot be deleted out from under them, and suspending an agency
leaves its clients' workspaces exactly as they were.

**Phase 2.** Creating an organization creates its own workspace in the same step, through the
same function that builds every other workspace. If the organization is made but the workspace
fails, that is reported as what it is rather than rolled back into "nothing happened".

**Phase 3.** The switcher in the corner of the sidebar, shown only to people with somewhere to
go, narrowed to the agency they are in. A switch is a server action that checks the person still
has an active row in the target and then issues a new session cookie.

And the guard. The session now also writes the workspace where the page can read it; every page
compares, and covers itself when they disagree. It checks on focus, on visibility, on pageshow
**and on a five-second timer** — the timer was added after the browser used for testing turned
out not to deliver the events at all, which is exactly the failure a guard must not have.

**Phase 4.** `platform.org_admins` and `/org`, the agency's own panel: its workspaces with
people, approvals waiting, tokens and spend, and a form that makes a client. An organization
admin is **not** a third principal — they sign in as everybody does, and this only says which
agency they run. Read on every request, so losing it takes effect on the next click.

**The sign-in page.** Built as section 6 describes: Organization, then email, then password,
with every active organization listed. It is enforced rather than decorated — the chosen
organization shortens the list of workspaces the password is checked against, and a wrong one
is refused with the same words a wrong password gets, so the page cannot be used to find out
who works where.

Building it removed a step. The "which workspace?" question after the password is gone: the
organization has been chosen already and the switcher moves between its workspaces in one
click, so asking twice was asking for nothing. The picker remains on the Google door, which
never sees the organization field.

**Phase 5.** Access levels and ceilings.

- `full` / `manage` / `none` per client, set by the platform. The level is recorded in
  `platform.org_access`, but what enforces it is accounts existing or not existing in the
  client's own `users` table — so the client sees on its own People page exactly who from the
  agency can reach it, and every existing permission check already understands the answer.
- `none` differs from `manage` only in the agency's panel, where the client is not listed.
  Neither reaches inside.
- An agency's ceiling: how many workspaces it may hold and how much AI it was sold. Empty means
  no ceiling, which is where every agency starts, so nothing that works today stops working.
  The workspace ceiling is checked before a client is built. The AI ceiling is checked where
  per-workspace budgets are set, because that is the only place one can be raised.

### What is not built yet

- **Module ceilings.** An agency's plan can cap workspaces and AI spend, not which modules its
  clients may be given. Each client's modules are still set per workspace by the platform.
- **A cross-workspace budget at run time.** The AI ceiling is enforced when budgets are handed
  out, not by summing live spend across an agency mid-run. A workspace still stops at its own
  budget, as it always has.
- **Open questions 1 and 2 in section 9** — deleting an organization, and grouping the sign-in
  picker for somebody who works for two agencies — are untouched. Neither can happen yet without
  a platform operator doing it deliberately.

**Phase 6.** The agency's panel stops being a smaller imitation of the console and becomes the
console, asked about one agency.

There is one implementation of the workspace pages — overview, People, Modules, Features,
Integrations, Usage, Security, Settings — and two principals in front of it. `requireWorkspaceAdmin`
decides which: a platform operator session wins; otherwise the signed-in person must run the
agency that workspace belongs to, and its access level must not be `none`. Anything else is
`notFound()`, never a refusal, because a refusal would confirm that another agency's client
exists. `/org/clients/[id]/…` re-exports those same pages, so a tab added to the console appears
in both panels or in neither; there is no second copy to forget.

The rail carries the same questions the console's does:

| Console | Agency |
| --- | --- |
| Overview | Overview — its own workspaces, approvals waiting, tokens, spend |
| Workspaces | My clients — the same table, the same filters, scoped |
| Token use | Token use — the same three windows |
| Operators | Who runs this agency |
| Audit log | Audit log — its workspaces, and the agency itself |

Two things are read before anything else, not after:

- **Which workspaces may be read.** `workspaceStatsFor` and `tokenUseByWorkspace` take the list
  rather than fetching it, so an agency's pages open only its own schemas. A client at `none` is
  absent from the tiles, the rail's badge, the trail and the usage table, not filtered out of
  them afterwards.
- **Who a change is attributed to.** Every workspace action takes the tenant id from the form,
  then asks `requireWorkspaceManager` whether this person may change *that* workspace, and
  writes the audit row against whoever they are. The UI hiding a button was never the guard.

Adding somebody to an agency now does the thing: they get an admin account in each client the
agency already fully reaches, and in none of the others — the same call from the platform console
and from the agency's own Team page, so neither door behaves differently. Taking somebody off
closes the panel and leaves their workspace accounts alone, which is the rule the console already
followed: running the agency and being somebody inside a workspace are two facts, and nothing
records which of them an account came from.

### What an agency still cannot do

These remain the platform's, and the agency's pages do not show the controls at all:

- **Suspend, restore or archive a workspace.** The status form is the platform owner's.
- **Set its own access level** into a client, or its own ceilings. An agency widening its own
  reach is the one thing the model cannot allow.
- **See the plumbing** — schema name, database role, secret rotation. An agency has no use for
  them and no way to act on them.

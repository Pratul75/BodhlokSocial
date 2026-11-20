# Workspace passwords — email and password sign-in for a workspace's own people

Until now every person in a workspace signed in with Google. That is fine for Bodhlok and wrong
for a product sold to other businesses: a new customer's admin would have had no way in that the
Super Admin could give them, because nobody — not even the platform owner — can set somebody's
Google password.

This adds the second door. It does not touch the first: Google sign-in works exactly as before,
and a workspace can use one, the other, or both.

---

## 1. How it works

A password lives on the workspace's own `users` row, inside the workspace's own schema, reached
through the workspace's own database role. It is as far from another workspace's passwords as the
rest of that workspace's data.

There is **no mail service in this application**, so nothing is emailed. An admin issues a
one-time link and hands it over; the person opens it and chooses their own password. The admin
never sees it.

| Step | Where | What is stored |
| --- | --- | --- |
| Admin clicks **Set up a password** | `/admin` (Tenant Admin) or the console's Users tab | SHA-256 of a 32-byte token, plus an expiry 72 hours out |
| Person opens the link | `/t/<slug>/set-password?token=…` | nothing yet |
| Person sets the password | same page | scrypt hash (`scrypt$N$r$p$salt$key`); the token is cleared; `session_version` goes up |
| Person signs in | `/t/<slug>/signin` | nothing; a signed session cookie is issued |

The hashing, the token format, the length rules and the lockout are the same code the platform
console uses for operators — [`apps/web/lib/passwords.ts`](../../apps/web/lib/passwords.ts) — so
neither principal can quietly end up weaker than the other.

### The rules that matter

- **One workspace.** The workspace comes from the address (`/t/<slug>/…`, or a workspace
  hostname), never from anything the person types. A password set in Zenith's workspace does not
  sign anyone in to Acme's, even with the same address.
- **No guessing.** If an address exists in more than one workspace and the address names none,
  sign-in refuses and says to come in through the workspace's own address. The same rule Google
  sign-in already follows.
- **One answer for every failure.** Unknown address, wrong workspace, wrong password — all give
  "That email and password do not match an account here." A sign-in page is not a place to learn
  which accounts exist.
- **Lockout.** Eight wrong passwords lock the account for 15 minutes. scrypt already makes each
  guess expensive; this makes the ninth free to refuse.
- **Changing a password ends old sessions.** `session_version` goes up, so a session opened before
  the change stops working everywhere, at once.
- **A link is single-use and expires.** 72 hours from the Tenant Admin and from the console. Only
  its hash is stored, so the database holds nothing that opens an account.

---

## 2. Using it — workspace admin

1. Sign in to the workspace and open **Admin**.
2. In **People**, on the person's row, under **Password**, click **Set up a password** (or
   **Reset password** if they already have one).
3. A one-time link appears with a **Copy** button. Copy it now — it is not shown again.
4. Send it to the person however you normally reach them.
5. They open it, choose a password, and are sent to the sign-in page to use it.

**Remove password** takes the password away again, signs that person out, and leaves Google as
their only way in.

## 3. Using it — platform owner

The console's **Workspace → Users** tab has the same two controls, and they are **owner-only**:
support and billing operators see only whether a password is set. Issuing a link into a customer's
workspace is a way in as one of their own admins, so it is the narrowest door the console has, and
every issue is written to the platform audit log against that workspace.

Impersonation cannot reach these actions: they require an operator session, and an impersonation
session is read-only at the database.

---

## 4. What changed outside the new files

- **`apps/web/proxy.ts`** — a valid session is now checked **before** asking whether Google is
  configured. Without this, a workspace that signs in only with passwords would have been
  redirected to the sign-in page on every single page, forever. `/signin` and `/set-password` are
  also open under a `/t/<slug>/` prefix, and a redirect to sign-in now keeps the workspace's
  address instead of dropping it.
- **`apps/web/lib/auth.ts`** — `getCurrentUser()` likewise honours a session first, and only then
  falls back to asking how sign-in is configured.
- **`apps/web/app/signin/page.tsx`** — shows the workspace's own name instead of "Bodhlok
  marketing", and the password form. Where Google is configured the password form comes first and
  the Google button sits below an "or" divider; the Google button itself is unchanged. Two error
  messages that `lib/auth.ts` already redirected to — `wrong_tenant` and `tenant_suspended` — had
  no wording on the page and now do.
- **`packages/db/migrations/0014_user_passwords.sql`** — six columns on `users`, applied to all
  four workspaces by the per-tenant migration runner.

Nothing in the Google sign-in path was changed.

---

## 5. What was tested, and how

Everything below was run against the local development database (`bodh-baseline-db`, host port
5434). Nothing was committed, deployed, or pointed at production.

### Automated — `apps/web/lib/user-passwords.db.test.ts` (8 tests, real Postgres, two real workspaces)

| Test | Proves |
| --- | --- |
| An invitation link is single-use and names the right person | the token round-trips and is spent |
| A link made in one workspace does not open the other | tokens do not cross workspaces |
| The password signs in to the workspace it was set in, and only that one | the isolation claim, with the same address in both |
| Refuses to guess when the address works in more than one workspace | `pick_workspace`, not a silent pick |
| The wrong password is refused, and enough wrong ones lock the account | lockout, and that the right password is refused while locked |
| Setting a password raises the session version | old sessions die |
| **A read-only binding cannot issue a link or clear a password** | the database refuses it, so an impersonating operator cannot let themselves in |
| Clearing a password leaves the person in place | Google-only, not access removed |

Full gate: **380 tests pass** across the workspace, `tsc --noEmit` clean, `eslint .` clean.

### In a real browser, against the **production build** (`next build && next start`) on `http://127.0.0.1:3200`

This matters: the earlier attempt on `next dev` could not prove anything about the proxy, because
in development with no Google client the proxy lets every request through. The runs below are on
the built bundle, with a real signed session cookie.

| Workflow | Result |
| --- | --- |
| `/t/zenith/admin` with no session | 307 to `/t/zenith/signin?next=%2Ft%2Fzenith%2Fadmin` — the workspace's address survives |
| `/admin` with no session | 307 to `/signin?next=%2Fadmin` |
| Open a one-time link at `/t/zenith/set-password?token=…` | names the workspace (Zenith Dental) and the person — [screenshot](password-screenshots/01-set-password.jpg) |
| Password under 12 characters | refused, "Use at least 12 characters." Token not spent |
| Two passwords that differ | refused, "The two passwords are not the same." Token not spent |
| Set a valid password | redirected to `/t/zenith/signin?set=1`, "Password set. Sign in with it." — [screenshot](password-screenshots/02-password-set-banner.jpg) |
| Sign in with the right password | landed on `/t/zenith`, signed in as that person inside Zenith Dental — [screenshot](password-screenshots/04-signed-in-zenith.jpg). This is the case that **failed before** the proxy fix |
| Visit `/t/acme/admin` holding the Zenith session | refused, `/signin?error=wrong_tenant` |
| Tenant Admin → **Set up a password** | one-time link appeared for the named person |
| The **Copy** button | clicked; the field held the full absolute URL `http://127.0.0.1:3200/t/zenith/set-password?token=…` and the button changed to "Copied" |

On the earlier `next dev` run, also in the browser: **Reset password** and **Remove password**
both worked, with `issue_password_reset` and `remove_password` written to Zenith's audit log —
[screenshot of the Password column](password-screenshots/03-admin-password-column.jpg). Those two
were not repeated on the production build.

Sign-in with a **wrong** password, and Zenith's credentials at **Acme's** address, were both
refused with the same message. Acme's audit log holds **zero** `sign_in` or `set_password` rows,
checked directly.

### The console's Workspace → Users controls, in a browser (owner session)

The platform owner password was set with your go-ahead, so this path is no longer untested. On
the same production build:

| Workflow | Result |
| --- | --- |
| `/super-admin/reset?token=…` → set the owner password | redirected to `/super-admin/signin?set=1`, "Password set. Sign in with it." |
| Sign in at `/super-admin/signin` as `owner@growth.local` | landed on the Overview; `set_operator_password` and `operator_sign_in` in the platform audit log |
| Workspaces → Zenith Dental → **Users** | a **Password** column, **Set up** on both rows — [screenshot](password-screenshots/05-console-users-password.jpg) |
| **Set up** on `admin@zenith.test` | one-time link for that person *in that workspace*, 72 hours, with a working **Copy** that flipped to "Copied"; the field held `http://127.0.0.1:3200/t/zenith/set-password?token=…` |
| Open that console-issued link in the app | set a password, redirected to `/t/zenith/signin?set=1` |
| Back in the console | the row now offers **Reset** and **Remove** instead of **Set up** |
| **Remove** | "admin@zenith.test is signed out and signs in with Google from now on"; both rows back to **Set up** |

Every one of those wrote to the platform audit log against Zenith: `issue_password_link`,
`clear_password`.

### Tested only through code, not in a browser

- **A non-owner operator's view of that column.** Support and billing should see plain text, not
  buttons, and the action refuses them server-side through the same `requireOwner()` the rest of
  the owner-only console actions use. Checking it would have meant changing the support
  operator's password, which was not asked for.
- **Signing in with a password while Google is also configured.** This machine has no Google
  client, so the "or" divider and the Google button were never on screen beside the password form.

### What this testing changed in the development database

Not nothing, and worth saying plainly:

- `t_zenith.users` — `admin@zenith.test` and `kshitij@rechargestudio.com` had passwords set and
  then cleared again, from the Tenant Admin page and from the console. Both are back to **no
  password, no pending link**. Their `session_version` went up each time, which ends any session
  they held; neither had one.
- `t_zenith.audit_log` and `platform.platform_audit` — rows for `set_password`, `sign_in`,
  `issue_password_reset`, `remove_password`, `issue_password_link`, `clear_password`. Audit rows
  are append-only by design and were left in place.
- `platform.platform_operators` — **`owner@growth.local` now has a password**, set with your
  go-ahead so the console could be opened. See §7: set your own before using it.
- No workspace was created, no user added or removed, no other workspace touched. Acme, Bodhlok
  and ace were read only.

### Known limits

- The console builds its link as `/t/<slug>/set-password?token=…` against the console's own
  origin. Right while workspaces live on paths of one host; a workspace given its own hostname
  would need the link built against that hostname.
- A workspace admin can issue a link for anybody active in their own workspace. That is the same
  reach they already have through **Remove access** and **Role**. They cannot remove their own
  password, for the same reason they cannot remove their own access.
- A platform **operator** (not owner) can still add a user to a workspace with their own address
  and sign in as them through Google. That predates this change; the owner-only rule on password
  links does not close it.

---

## 6. Trying it yourself

Zenith has no passwords set — it is back to Google-only, as it was. The server on port 3200 is the
**production build**, so sign-in behaves as it will in production.

1. Sign in to the console at `http://127.0.0.1:3200/super-admin/signin` (set your own owner password
   first — §7).
2. **Workspaces → Zenith Dental → Users → Set up**, then **Copy**.
3. Paste the link into the address bar, choose a password, and sign in with it at
   `http://127.0.0.1:3200/t/zenith/signin`.
4. From inside the workspace, **Admin → People** has the same controls for everyone else.

---

## 7. The owner account

`owner@growth.local` has a password I set in order to open the console. **Replace it with your
own.** A one-time link was handed over in the chat where this was reported; open it and choose a
password. If it has expired, sign in to the console and use **Operators → Issue password link** on
your own row, or follow [25-console-access.md](25-console-access.md) §2.

Setting a password raises that operator's session version, so any session opened with the password
I used stops working the moment you set yours. I signed out of the console when I finished.

---

## 8. Lockout on console accounts

The first version of this work gave workspace users a lockout and left console operators without
one, which had the asymmetry backwards: a console account reaches every workspace on the
installation, so it is the one that least deserves unlimited guesses.

`packages/db/platform/003_operator_lockout.sql` adds `failed_sign_ins` and `locked_until` to
`platform.platform_operators` — additive and idempotent, like the rest of that folder. The numbers
are the shared ones from `lib/passwords.ts`: **8 wrong passwords, 15 minutes**.

### How it behaves

- A locked account is refused **before** the password is checked at all, so a lock is cheap to
  enforce — that is half the point of having one.
- The lock is on the account, not the browser or the IP: somebody guessing from elsewhere is
  exactly who it is for.
- A right password clears the counter. Setting a new password clears it too, so **an owner's
  one-time link is always a way back in** — nobody can be locked out permanently.

### One deliberate difference from the workspace side

A workspace user who is locked out is told so (*"Too many wrong passwords. Try again in a few
minutes…"*). A console operator is **not**: the message stays the same neutral one as for a wrong
password or an unknown address.

The reason is enumeration. Saying "locked" confirms the address belongs to an operator, so eight
wrong guesses would become a way to find out who runs the platform. The sign-in page carries a
standing line instead —

> 8 wrong passwords stop an account answering for 15 minutes. Until then every attempt is
> refused, the right password included.

— which tells the person who is actually locked out what happened, without telling anybody else
who exists. The audit log still records exactly what happened: `bad_password`,
`bad_password_locked`, `locked`, `unknown`, `no_password`, `ok`.

### Tested

`apps/web/lib/platform-auth.db.test.ts` — 5 tests against a real Postgres:

| Test | Proves |
| --- | --- |
| A reset link is single-use, and setting a password raises the session version | the link mechanism |
| An expired link opens nothing | the expiry is enforced, not decorative |
| Locks after 8 wrong passwords, and refuses the right one while locked | the lock means something |
| The lock lifts when it expires, and a right password forgets the wrong ones | it is a delay, not a wall |
| Setting a new password clears a lock | an owner's link is always a way back in |

In the browser, on the production build, against `support@growth.local`: eight wrong passwords in
a row produced seven `bad_password` rows, one `bad_password_locked`, then `locked` on every
further attempt, with `failed_sign_ins = 8` and `locked_until` 15 minutes out — and the message on
screen never changed. The account was unlocked again afterwards; nothing was left locked.

Full gate after this change: **385 tests pass**, `tsc --noEmit` clean, `eslint .` clean.

---

## 9. The link comes with the workspace

Creating a workspace used to end at *"Created Zenith Dental: 212 tables, everything switched on."*
The first admin existed but had no way in, and the person who had just created the workspace had
to go to the Users tab and press **Set up** to finish the job they had started. That is the step
that gets forgotten.

**Workspaces → New workspace** now returns the first admin's one-time link with the result, with
the same **Copy** button as everywhere else:

> Created Zenith Dental: 212 tables, everything switched on. A one-time link for
> `admin@zenith.com` to set their password, good for 72 hours — copy it now; it isn't shown again.

If the link cannot be made for any reason, the workspace is still reported as created and the
message says to use the Users tab — creating a workspace does not fail because of a link.

Every issue is written to the platform audit log as `issue_password_link` against that workspace,
the same as from the Users tab.

`CopyLink` is now one shared component (`apps/web/components/copy-link.tsx`) used by all three
places that hand over a link: the create-workspace result, the console's Users tab, and the
workspace's own Admin page.

---

## 10. Temporary passwords, and the change that is not optional

A one-time link means a password nobody but its owner ever knows. It is the safer shape, and it
is not the shape most people expect when they buy software: they expect to be handed an address
and a password, and to be told to change it. That is what this adds. The link stays — it is now
what a **reset** uses, where nobody knows the old password anyway.

### Creating a workspace

**Workspaces → New workspace** has a **Their password** field with a **Generate** button beside
it. Generate makes a password worth typing into a chat message: no characters that argue about
which one they are (no `0`/`O`, no `1`/`l`/`I`), in three readable groups, always with a capital
and a digit. You can type your own instead — the same rule applies, at least 12 characters with
letters and a number, and it is checked **before** the workspace is built, so a bad password never
leaves a half-made workspace behind.

Leave the field empty and you get the one-time link instead, exactly as before. Both doors, your
choice per workspace.

### What the customer sees

1. They sign in at the workspace's address with the address and password you gave them.
2. They land on **Choose a new password**, told plainly: *"The password you signed in with was a
   temporary one. Choose your own to carry on — it is the only thing that will work after this."*
3. They choose one, and sign in with it.

**No session is issued for a temporary password.** The password buys exactly one thing: a
one-hour token for the page where it gets replaced. There is never a half-signed-in state holding
a password somebody else also knows.

### What makes it temporary

Two columns on the workspace's own `users` row
(`packages/db/migrations/0015_temporary_passwords.sql`, applied to all four workspaces):

| Column | Meaning |
| --- | --- |
| `must_change_password` | the password in this row is one somebody else chose |
| `password_expires_at` | it stops working then, **used or not** — 72 hours by default |

The expiry matters because this password travels through a chat message to get where it is going,
and a chat message is forever. Choosing a new password clears both columns and raises the session
version. The lockout applies to temporary passwords like any other: 8 wrong tries, 15 minutes.

### Tested

Two more tests in `apps/web/lib/user-passwords.db.test.ts` (10 in that file now):

| Test | Proves |
| --- | --- |
| A temporary password works once and demands to be replaced | `mustChange` is set, and replacing it clears it and kills the old one |
| A temporary password stops working when it expires, used or not | the expiry is real, and a link still rescues them |

**In a real browser, on the production build**, against Zenith:

| Step | Result |
| --- | --- |
| Sign in with the temporary password | sent straight to `/t/zenith/set-password?token=…`, **and `document.cookie` was empty** — no session — [screenshot](password-screenshots/07-forced-change.jpg) |
| Choose a new password | `/t/zenith/signin?set=1`, "Password set. Sign in with it." |
| Try the temporary password again | refused: "That email and password do not match an account here." |
| Sign in with the new password | straight into the workspace at `/t/zenith`, no second prompt |
| Database afterwards | `must_change_password = false`, `password_expires_at = null`, session version raised |

Audit trail in the workspace: `sign_in / password_change_required`, then `set_password / reset`.

Full gate: **387 tests pass**, `tsc --noEmit` clean, `eslint .` clean.

### Not yet done

- The **New workspace** form itself — the password field and the Generate button — has not been
  clicked in a browser. It typechecks and builds, and the server half of it is what the tests and
  the browser run above exercise, but the form is reached only from the console and that needs an
  owner session.
- A workspace admin still cannot hand out a temporary password to their own staff from
  **Admin → People**; they issue a link. The same is true of the console's Users tab. Only the
  first admin of a new workspace gets a chosen password today.

---

## 11. The create form, as it should have been

**Workspaces → New workspace** now asks for four things and nothing else:

| Field | |
| --- | --- |
| **Workspace name** | required |
| **First admin's email** | required |
| **Their mobile** | optional |
| **Their password** | optional, with **Generate** — empty gives the one-time link instead |

### The Address field is gone

It used to ask for a short name — `acme`, `zenith` — and call it the Address, because
`/t/<slug>/` was once how you reached a workspace. That was the wrong name for it and the wrong
reason to show it.

That short name is not an address. It is what the workspace is called **inside the machine**:

| Where it goes | How it looks |
| --- | --- |
| Postgres schema | `t_zenith_dental` |
| Database roles | `bodh_t_zenith_dental_app`, and the read-only twin |
| Secret names | `integration-zenith-dental-google_ads` |
| A subdomain, later | `zenith-dental.growth.rechargestudio.com` |

So it cannot be dropped — a schema needs a name. But nobody should be typing it, because **a
schema cannot be renamed afterwards**, and a field you type twice is a field you get wrong once.
This installation already carries both `acme` and `aceme`, which is that mistake, now permanent.

`slugCandidate()` works it out from the workspace's name: accents folded, punctuation dropped,
spaces to hyphens, a letter forced at the front, capped to what a schema will accept. A name with
nothing Latin in it falls back to `workspace`. `uniqueSlug()` then adds `-2`, `-3` if that name is
taken or reserved — two customers really can both be called Zenith Dental, and the second is not
a mistake to refuse. The result is shown in the success line, so you know what it became:

> Created Zenith Dental (zenith-dental): 212 tables, everything switched on.

### The mobile

`users.phone` (`packages/db/migrations/0016_user_phone.sql`, applied to all four workspaces).
Optional, stored as digits with a leading `+` if there was one — spaces, hyphens and brackets are
how people write numbers, not part of them. **Nothing signs in with it**; it is there so you can
reach the person you just handed a password to. It shows in the console's Users tab and in the
workspace's own Admin → People list.

### Tested

`packages/db/src/slug.test.ts` — 6 tests, including one that runs ten awkward names (Devanagari,
`3M`, `!!!`, 200 characters, `a-a-a-…`) through `slugCandidate` and asserts every result is
something `schemaForSlug` will accept. That is the property that matters: whatever is typed into
the name field, the schema it produces must be legal, because the alternative is a half-created
workspace.

Full gate: **393 tests pass**, `tsc --noEmit` clean, `eslint .` clean.

### Not browser-tested

The form itself, again — it is reachable only from the console, which needs an owner session.
Everything behind it (slug derivation, phone normalisation, temporary password, the forced
change) is covered by tests and, for the sign-in half, by the browser run in §10.

---

## 12. The bug the first real workspace found

Creating `hollowood` worked: the short name came out of the workspace name, the generated
password was set as temporary, and signing in with it did force a password change. Then the
set-password page said **"This link has been used already, or it has expired."** — about a link
that was neither.

The link was fine. The page could not tell whose it was.

`/set-password?token=…` at the bare address carries no workspace. The token's hash lives on a row
inside one workspace's schema, and the page had no way to know which schema to look in, so it
found nothing and said the only thing it could. The `/t/<slug>/set-password?token=…` form of the
same link worked, which is why the Users tab's link went through and the one from sign-in did not.

This was the gap named in §4 as "the set-password link must name the workspace". Taking `/t/` out
of the addresses is what made it bite.

### The fix: the token says where it came from

`platform.invite_tokens` (`packages/db/platform/004_invite_tokens.sql`) — a hash, a workspace id
and an expiry. Nothing else: no name, no address, nothing that opens an account.

| Step | Where |
| --- | --- |
| A link is issued | hash goes on the person's row **inside their workspace**, and a pointer goes in the control plane |
| The link is opened | the pointer says which workspace; the **real check** is still the hash on the row inside it |
| The link is spent | the row is cleared and the pointer deleted |

A forged pointer buys nothing — it only decides which workspace gets asked, and that workspace
still has to be holding a matching, unspent, unexpired hash. Expired pointers are swept whenever
a new one is written, so the table needs no job of its own.

The address still wins when it has a workspace in it, so `/t/<slug>/set-password` keeps working
for anyone holding an older link.

### Verified end to end, at the bare address

On the production build, with nothing but `127.0.0.1:3200` — no `/t/` anywhere:

| Step | Result |
| --- | --- |
| `/signin`, email + temporary password | sent to `/set-password?token=…` |
| That page | named the right workspace — **Zenith Dental** — and said why they were there |
| New password | `/signin?set=1`, "Password set. Sign in with it." |
| Sign in with it | landed on `/`, inside **Zenith Dental** — [screenshot](password-screenshots/08-root-signed-in.jpg) |

Two more tests in `apps/web/lib/user-passwords.db.test.ts` (12 there now): a link resolves to its
own workspace from the token alone, and stops resolving once spent — while the hash on the row
inside the workspace remains the thing that actually decides.

Full gate: **395 tests pass**, `tsc --noEmit` clean, `eslint .` clean.

---

## 13. The console moved to /super-admin

`/platform` was a developer's word for it. The console is the Super Admin, so that is where it
lives now:

| | |
| --- | --- |
| Console | `/super-admin` |
| Sign in | `/super-admin/signin` |
| One-time link | `/super-admin/reset?token=…` |
| Everything else | `/super-admin/workspaces`, `/super-admin/operators`, `/super-admin/audit`, … |

The route folder moved from `app/(platform)/platform` to `app/(platform)/super-admin`, and every
link, redirect and proxy check moved with it. Nothing in the database changed: the table is still
`platform.platform_operators`, the cookie is still `bodh_platform`. Those are names, not
addresses, and renaming them would be a migration for no gain.

### Old links keep working

The proxy answers anything under `/platform` with a **308 Permanent Redirect** to the same path
under `/super-admin`, and carries the `next` parameter across with it:

```
/platform                                  → /super-admin
/platform/workspaces                       → /super-admin/workspaces
/platform/signin?next=%2Fplatform%2Faudit  → /super-admin/signin?next=%2Fsuper-admin%2Faudit
```

That last one matters: the sign-in action only follows a `next` that already points inside the
console, so a bookmark saved before the rename would otherwise lose the page it was aimed at.
Checked in a browser — a bookmarked `/platform/operators` lands on the sign-in page with
`next=/super-admin/operators` waiting for it.

### Where the addresses now stand

| What | Address |
| --- | --- |
| A workspace's people | `/` — sign in with email and password, the workspace is worked out from the address |
| Setting a password | `/set-password?token=…` — the token says which workspace |
| The Super Admin | `/super-admin` |
| `/t/<slug>/…` | still works, never handed out |

Full gate after the move: **395 tests pass**, `tsc --noEmit` clean, `eslint .` clean.

---

## 14. Two things the real browser found

### Sign out answered "Sign out from the app itself."

`/api/auth/signout` checks that the POST came from this app, by comparing the browser's `Origin`
header against `APP_URL`. `APP_URL` is `http://localhost:3000`; the app was being used on
`http://127.0.0.1:3200`. One configured address cannot speak for every address the app answers
on — and it is about to answer on more of them, because a workspace with its own hostname would
have hit exactly this.

The check now compares `Origin` against **the host the browser actually asked for**, read from
the request's own `Host` (or `X-Forwarded-Host`) header, with `APP_URL` still accepted as well.
That is the ordinary CSRF check, and it is stronger than what was there: a page on another site
cannot make a browser send both of those pointing at us.

`req.url` is not usable for this. Next rewrites it to `localhost` before a route handler sees it
— which is why the first attempt at this fix still returned 403, and why the code now reads the
header instead. The helper is `requestOrigin()` in `lib/session.ts`.

Sign-out also lands on the sign-in page of the host you were on, rather than on `APP_URL`.
`appUrl()` itself is untouched: OAuth redirect URIs have to match what is registered with Google.

Six tests in `apps/web/lib/auth.test.ts`, including one for the host Next rewrites and one that
checks a page at `acme.growth.example.com` still cannot post to `zenith.growth.example.com`.
Confirmed in a browser: the Sign out button now ends on `/signin?signed_out=1`, on `127.0.0.1`.

### "Something went wrong" on Publishing, locally only

Not a bug. `secretStore()` refuses to read local secret files when `NODE_ENV=production` unless
`ALLOW_LOCAL_SECRETS=true`:

```ts
if (process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_SECRETS !== "true") {
  throw new Error("Set SECRETS_BACKEND=gcp in production. Local secret files are for development only.");
}
```

Live sets `SECRETS_BACKEND=gcp`, so it never reaches that line. Locally this session has been
running a **production build** (`next build && next start`, to get working hydration in the
browser pane), so `NODE_ENV=production` is set while secrets still live in `.secrets/` — and
every page that reads a credential throws. Publishing is simply the first one you opened;
Connections, Ads and the agents would do the same.

The guard is right and stays. To run a production build locally, pass the escape hatch it already
provides:

```
ALLOW_LOCAL_SECRETS=true pnpm exec next start --port 3200
```

`pnpm dev` never hits it. With the flag set, Publishing renders normally — *"Postiz isn't
connected, so approved posts wait here."* — which is the correct page for a workspace with no
Postiz credentials.

Full gate: **401 tests pass**, `tsc --noEmit` clean, `eslint .` clean.

---

## 15. One address, two workspaces

With one domain and no workspace in the URL, a sign-in page that meets an address belonging to
two workspaces has nothing to go on. It used to refuse and say *"sign in from your workspace's
own address"* — advice pointing at an address that no longer exists.

This is not hypothetical. `kshitij@rechargestudio.com` is already in **three** workspaces on this
installation, because the same person works across clients. That is the ordinary shape of an
agency, and forbidding it would mean a different email address per client.

### It was never a leak

The same address in two workspaces is **two separate accounts**, not one account seeing two
workspaces:

```
Bodhlok   public      585e4673-…   bodh_public_app
Acme      t_acme      ace72400-…   bodh_t_acme_app
Zenith    t_zenith    a4304a45-…   bodh_t_zenith_app
```

Separate rows in separate schemas, separate passwords, and each reached through its **own
database role**. A session carries one workspace id and binds to it; the role it opens has no
permission on any other schema, so a bug in application code still could not cross. Checked again
in the browser: holding a Zenith session, `/t/acme/admin` is refused with `wrong_tenant`.

### What now happens

| The password opens | What happens |
| --- | --- |
| one workspace | straight in — nothing is asked, which is every ordinary sign-in |
| more than one | a short list: *"You work in 2 workspaces. Which one are you opening?"* |
| none | the same refusal as always |

The list is built **after** the password has matched, and contains only the workspaces it opened.
An address in three workspaces with a password in two offers two — that exact case is what the
screenshot shows: Bodhlok has the address but no password, so it is not on the list. Typing an
unknown address still learns nothing.

Choosing does not mean typing the password again. The sign-in hands back a **five-minute signed
token** naming the workspaces that password opened; picking one sends the token back, and
`chooseWorkspace` refuses any workspace not named in it. The row is read again at that point, so
access removed in the meantime is caught. Nothing sensitive sits in the page, and a copied token
buys nothing the correct password had not already bought.

`checkPassword` now checks every workspace the address is in, capped at ten — each check is a
deliberately slow scrypt verification, and one sign-in attempt must not become a hundred.

### Tested

| | |
| --- | --- |
| Goes straight in when the password opens only one | the ordinary path stays one step |
| Offers a choice only when it really opens more than one | and the two accounts have different ids |
| Naming a workspace signs in to that one and asks nothing | the picker never appears where there is no choice |

In the browser, with `kshitij@rechargestudio.com` given the same password in Acme and Zenith and
none in Bodhlok: the picker offered **Acme Ltd** and **Zenith Dental**
([screenshot](password-screenshots/09-workspace-picker.jpg)), choosing Zenith landed inside Zenith
Dental as Kshitij, and that session was then refused at Acme's address.

Full gate: **402 tests pass**, `tsc --noEmit` clean, `eslint .` clean.

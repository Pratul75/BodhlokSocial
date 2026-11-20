"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { orgById, resolveTenant, tenantById, tenantBySlug, type TenantRef } from "@bodh/db";
import { and, eq } from "drizzle-orm";
import { auditLog, db, users, withTenant } from "@bodh/db";
import {
  cookieOptions,
  createSessionToken,
  safeReturnTo,
  SESSION_COOKIE,
  SESSION_DAYS,
  verifyChoiceToken,
  WORKSPACE_COOKIE,
  workspaceCookieOptions,
  type SignInDoor,
} from "@/lib/session";
import { passwordProblem } from "@/lib/passwords";
import type { WorkspaceChoice } from "@/lib/workspace-choice";
import { slugFromHost, slugFromPath } from "@/lib/tenant";
import type { SignInTarget } from "@/lib/user-passwords";
export type { WorkspaceChoice };
import {
  checkPassword,
  issueUserInvite,
  setUserPassword,
  spendInviteToken,
  tenantForInviteToken,
  userForInviteToken,
} from "@/lib/user-passwords";

export type PasswordSignInState =
  | { error: string }
  /** The password opened several workspaces; the token is five minutes' proof of that. */
  | { choose: WorkspaceChoice[]; token: string; next: string }
  | null;

/** The slug in the address, if the address names a workspace at all. */
async function slugFromAddress(): Promise<string | null> {
  const h = await headers();
  return h.get("x-tenant-slug") ?? slugFromPath(h.get("x-tenant-path") ?? "") ?? slugFromHost(h.get("host"));
}

/**
 * The workspace this request belongs to.
 *
 * An address that names a workspace means that workspace and no other. An address that names
 * none is the single-tenant installation, where `resolveTenant(null)` is the only answer — and
 * it is null once there is more than one workspace, so nothing here ever falls through to #1.
 */
async function tenantFromAddress(): Promise<TenantRef | null> {
  const slug = await slugFromAddress();
  return slug ? await tenantBySlug(slug) : await resolveTenant(null);
}

/**
 * Signs somebody in to their workspace with an email and a password.
 *
 * Google sign-in is untouched and still works; this is the other door. Which workspace they are
 * signing in to comes from the address when it names one, and otherwise from the control
 * plane's directory — never from anything they type.
 */
export async function signInWithPassword(_prev: PasswordSignInState, formData: FormData): Promise<PasswordSignInState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeReturnTo(String(formData.get("next") ?? "/"));

  // The organization is chosen on the page, and it is checked here rather than trusted. A field
  // that is shown but never checked is worse than no field: it tells somebody that something
  // was verified when nothing was.
  const orgId = String(formData.get("orgId") ?? "").trim();
  if (!orgId) return { error: "Choose your organization." };
  const org = await orgById(orgId);
  if (!org || org.status !== "active") {
    // Not "that organization is closed": the page must answer the same way whatever is wrong,
    // or the list of organizations plus an address becomes a way to find out who works where.
    return { error: "That email and password do not match an account here." };
  }

  const outcome = await checkPassword(email, password, await tenantFromAddress(), org.id);

  if (!outcome.ok) {
    if (outcome.reason === "locked") {
      return { error: "Too many wrong passwords. Try again in a few minutes, or ask an admin for a new link." };
    }
    if (outcome.reason === "expired") {
      return { error: "That temporary password has expired. Ask your admin for a new one." };
    }
    return { error: "That email and password do not match an account here." };
  }

  // The ordinary case: this address belongs to one workspace, and in they go.
  if ("target" in outcome) return finishSignIn(outcome.target, next);

  // The password opened more than one workspace in the chosen organization. There is no longer
  // a step here asking which: the organization has already been chosen on this page, and the
  // switcher in the corner moves between that organization's workspaces in one click. Asking
  // twice — once before the password and once after — is a question nobody needs answered
  // before they can start.
  //
  // The oldest is where they land, which for an agency is its own workspace: the one made with
  // the organization itself.
  return finishSignIn(outcome.choose[0]!, next);
}

export type ChooseWorkspaceState = { error: string } | null;

/**
 * Finishes a sign-in that paused for the person to pick a workspace.
 *
 * The token is the whole of the proof: it was signed minutes ago by a sign-in whose password
 * matched, and it names the workspaces that password opened. A workspace not in it is refused,
 * so this cannot become a way into anywhere the password did not already reach.
 */
export async function chooseWorkspace(_prev: ChooseWorkspaceState, formData: FormData): Promise<ChooseWorkspaceState> {
  const claims = await verifyChoiceToken(String(formData.get("token") ?? ""));
  if (!claims) return { error: "That took too long. Sign in again." };

  const tenantId = String(formData.get("tenantId") ?? "");
  const userId = claims.opened.find((o) => o.startsWith(`${tenantId}:`))?.split(":")[1];
  if (!userId) return { error: "Pick one of the workspaces listed." };

  const tenant = await tenantById(tenantId);
  if (!tenant || tenant.status !== "active") return { error: "That workspace is not active. Ask your admin." };

  // Read the row again rather than trusting anything carried in the token: access can have been
  // taken away, or the password changed, in the minutes since.
  const row = await withTenant(tenant, async () => {
    const [found] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.active, true)))
      .limit(1);
    return found ?? null;
  });
  if (!row || row.email !== claims.email) return { error: "That account is no longer available. Sign in again." };

  return finishSignIn(
    {
      tenant,
      user: { id: row.id, email: row.email, name: row.name, sessionVersion: row.sessionVersion },
      // Somebody who came through Google never typed a password here, so a temporary one waiting
      // in this workspace is not in their way: the Google door does not ask for one at all.
      mustChange: claims.door === "google" ? false : row.mustChangePassword,
    },
    safeReturnTo(String(formData.get("next") ?? "/")),
    claims.door,
  );
}

/**
 * The last few steps, shared by signing in and by picking a workspace afterwards: a temporary
 * password goes to the page where it is replaced, anything else gets a session.
 */
async function finishSignIn(target: SignInTarget, next: string, door: SignInDoor = "password"): Promise<{ error: string }> {
  const { tenant, user } = target;
  const slug = await slugFromAddress();
  const prefix = slug ? `/t/${slug}` : "";

  // A temporary password buys one thing: the page where they choose their own. No session is
  // issued here, so there is never a half-signed-in state holding somebody else's password.
  if (target.mustChange) {
    const invite = await issueUserInvite(tenant, user.id, 1);
    await withTenant(tenant, () =>
      db.insert(auditLog).values({
        actor: user.email,
        actorType: "user",
        action: "sign_in",
        target: "app",
        result: "password_change_required",
      }),
    );
    if (!invite) return { error: "Couldn't start the password change. Ask your admin for a new one." };
    redirect(`${prefix}/set-password?token=${invite.token}`);
  }
  // Land them back inside the workspace's own address, not the bare one: `/t/acme/ads`, not
  // `/ads`. Without this, signing in at a workspace address quietly leaves it.
  const to = prefix && !next.startsWith(prefix) ? `${prefix}${next === "/" ? "" : next}` : next;
  const jar = await cookies();
  jar.set(
    SESSION_COOKIE,
    await createSessionToken({ sub: user.id, email: user.email, sv: user.sessionVersion, tid: tenant.id }),
    cookieOptions(SESSION_DAYS * 86400),
  );
  // The same workspace, written where the page can read it, so a tab left open on another one
  // can notice. See WORKSPACE_COOKIE.
  jar.set(WORKSPACE_COOKIE, tenant.id, workspaceCookieOptions(SESSION_DAYS * 86400));
  // Written inside the workspace, where the rest of its audit log lives.
  await withTenant(tenant, () =>
    db.insert(auditLog).values({
      actor: user.email,
      actorType: "user",
      action: "sign_in",
      target: "app",
      result: door === "google" ? `signed in to ${tenant.slug}` : "password",
    }),
  );
  redirect(to);
}

export type SetPasswordState = { error: string } | null;

/** Sets a password from an invitation or reset link, then sends them to sign in with it. */
export async function setPasswordFromInvite(_prev: SetPasswordState, formData: FormData): Promise<SetPasswordState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const again = String(formData.get("confirm") ?? "");

  // The address if it names a workspace, otherwise the link itself.
  const slugHere = await slugFromAddress();
  const tenant = slugHere ? await tenantFromAddress() : ((await tenantForInviteToken(token)) ?? (await tenantFromAddress()));
  if (!tenant) return { error: "That link has been used already, or it has expired. Ask an admin for a new one." };
  if (tenant.status !== "active") return { error: "That workspace is not active. Ask your admin." };

  const target = await userForInviteToken(tenant, token);
  if (!target) return { error: "That link has been used already, or it has expired. Ask an admin for a new one." };
  if (password !== again) return { error: "The two passwords are not the same." };
  const problem = passwordProblem(password);
  if (problem) return { error: problem };

  await setUserPassword(tenant, target.userId, password);
  await spendInviteToken(token);
  await withTenant(tenant, () =>
    db.insert(auditLog).values({
      actor: target.email,
      actorType: "user",
      action: "set_password",
      target: target.email,
      result: target.isReset ? "reset" : "first",
    }),
  );
  // Any session opened before now is dead: the session version went up.
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(WORKSPACE_COOKIE);
  const slug = await slugFromAddress();
  redirect(`${slug ? `/t/${slug}` : ""}/signin?set=1`);
}

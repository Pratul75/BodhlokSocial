import "server-only";
import { and, eq, sql as dsql } from "drizzle-orm";
import {
  db,
  forgetInviteToken,
  rememberInviteToken,
  tenantForInviteHash,
  tenantsForEmail,
  users,
  withTenant,
  type TenantRef,
} from "@bodh/db";
import {
  hashPassword,
  LOCKOUT_AFTER,
  LOCKOUT_MINUTES,
  newToken,
  passwordMatches,
  tokenHash,
} from "./passwords";

/**
 * Passwords for the people who work inside a workspace.
 *
 * Google sign-in is still here and unchanged; this is a second way in for customers who do not
 * use Google, or do not want to. A password lives in the workspace's own `users` table, inside
 * its own schema, reached through its own database role — so one workspace's passwords are as
 * far from another's as the rest of its data.
 *
 * There is no mail service in this application. An admin issues a link and hands it over; only
 * the link's SHA-256 is stored.
 */

export interface SignInTarget {
  tenant: TenantRef;
  user: { id: string; email: string; name: string; sessionVersion: number };
  /** The password they just used was a temporary one. They choose their own before going in. */
  mustChange: boolean;
}

export type SignInOutcome =
  | { ok: true; target: SignInTarget }
  /** The password opened more than one workspace. Only they can say which one they meant. */
  | { ok: true; choose: SignInTarget[] }
  | { ok: false; reason: "no_match" | "locked" | "expired" };

/**
 * Which workspaces to look in for this address.
 *
 * An address the caller named takes precedence; otherwise the control plane's directory says
 * where this email can sign in. The same address in two workspaces is two separate accounts —
 * separate rows, separate passwords, separate database roles — so both get checked.
 */
async function candidates(email: string, tenantHint: TenantRef | null): Promise<TenantRef[]> {
  if (tenantHint) return [tenantHint];
  return await tenantsForEmail(email);
}

/**
 * Checks an email and password against a workspace.
 *
 * Everything that fails returns the same `no_match`: whether the address is unknown, the
 * workspace is wrong or the password is bad is not something a sign-in page should reveal.
 */
/**
 * How many workspaces one address is ever checked against.
 *
 * Each check costs a scrypt verification, which is deliberately slow, so an address spread
 * across a hundred workspaces must not turn one sign-in attempt into a hundred of them.
 */
const MAX_CANDIDATES = 10;

/** One workspace's answer, kept separate so the caller can tell a real match from a refusal. */
type OneResult =
  | { kind: "match"; target: SignInTarget }
  | { kind: "locked" }
  | { kind: "expired" }
  | { kind: "no" };

/** Checks the email and password inside one workspace, and counts the failure if it is one. */
async function checkOne(tenant: TenantRef, email: string, password: string): Promise<OneResult> {
  return withTenant(tenant, async () => {
    const [row] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, email), eq(users.active, true)))
      .limit(1);
    if (!row?.passwordHash) return { kind: "no" as const };

    if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) return { kind: "locked" as const };

    // A temporary password somebody else chose stops working whether or not it was used. It
    // travels through a chat message to get here, and a chat message is forever.
    if (row.passwordExpiresAt && row.passwordExpiresAt.getTime() <= Date.now()) return { kind: "expired" as const };

    if (!(await passwordMatches(password, row.passwordHash))) {
      // Count it, and stop answering for a while once they have been wrong often enough.
      const failed = row.failedSignIns + 1;
      await db
        .update(users)
        .set({
          failedSignIns: failed,
          lockedUntil: failed >= LOCKOUT_AFTER ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
        })
        .where(eq(users.id, row.id));
      return failed >= LOCKOUT_AFTER ? { kind: "locked" as const } : { kind: "no" as const };
    }

    if (row.failedSignIns > 0 || row.lockedUntil) {
      await db.update(users).set({ failedSignIns: 0, lockedUntil: null }).where(eq(users.id, row.id));
    }
    return {
      kind: "match" as const,
      target: {
        tenant,
        user: { id: row.id, email: row.email, name: row.name, sessionVersion: row.sessionVersion },
        mustChange: row.mustChangePassword,
      },
    };
  });
}

export async function checkPassword(
  emailRaw: string,
  password: string,
  tenantHint: TenantRef | null,
  orgId?: string | null,
): Promise<SignInOutcome> {
  const email = emailRaw.trim().toLowerCase();
  if (!email || !password) return { ok: false, reason: "no_match" };

  const where = (await candidates(email, tenantHint))
    .filter((t) => t.status === "active")
    // The organization chosen on the sign-in page can only ever SHORTEN this list. It is not
    // trusted for anything else: a wrong one opens nothing, and the refusal is the same one a
    // wrong password gets, so the page cannot be used to find out who belongs where.
    .filter((t) => !orgId || t.orgId === orgId)
    .slice(0, MAX_CANDIDATES);
  if (where.length === 0) return { ok: false, reason: "no_match" };

  const matches: SignInTarget[] = [];
  let locked = false;
  let expired = false;
  for (const tenant of where) {
    const result = await checkOne(tenant, email, password);
    if (result.kind === "match") matches.push(result.target);
    else if (result.kind === "locked") locked = true;
    else if (result.kind === "expired") expired = true;
  }

  // One workspace is the ordinary case and goes straight in. More than one means the password
  // really does open more than one account, and only they can say which they meant.
  if (matches.length === 1) return { ok: true, target: matches[0]! };
  if (matches.length > 1) return { ok: true, choose: matches };

  // Nothing matched. Say the most useful true thing: a lock and an expired temporary password
  // are both worth telling somebody about, because neither is fixed by trying harder.
  if (locked) return { ok: false, reason: "locked" };
  if (expired) return { ok: false, reason: "expired" };
  return { ok: false, reason: "no_match" };
}

/** True when this address could sign in with a password somewhere, for the page's own wording. */
export async function hasPasswordSomewhere(emailRaw: string): Promise<boolean> {
  const email = emailRaw.trim().toLowerCase();
  for (const tenant of await tenantsForEmail(email)) {
    const found = await withTenant(tenant, async () => {
      const [row] = await db.select({ h: users.passwordHash }).from(users).where(eq(users.email, email)).limit(1);
      return Boolean(row?.h);
    });
    if (found) return true;
  }
  return false;
}

export interface InviteLink {
  token: string;
  email: string;
  expiresAt: Date;
}

/**
 * Makes a link for somebody to set their own password. The same mechanism serves an invitation
 * and a reset — the difference is only how long it lasts and what the page calls it.
 *
 * It takes the caller's own tenant binding rather than an id, deliberately: an operator looking
 * inside a workspace holds a read-only ref, and re-resolving the id here would have handed them
 * a read-write one and quietly turned a look into a way in.
 */
export async function issueUserInvite(tenant: TenantRef, userId: string, hours = 72): Promise<InviteLink | null> {
  if (tenant.status !== "active") return null;
  const token = newToken();
  const hash = tokenHash(token);
  const expiresAt = new Date(Date.now() + hours * 3_600_000);
  const row = await withTenant(tenant, async () => {
    const [found] = await db
      .update(users)
      .set({ inviteTokenHash: hash, inviteExpiresAt: expiresAt })
      .where(and(eq(users.id, userId), eq(users.active, true)))
      .returning({ email: users.email });
    return found ?? null;
  });
  if (!row) return null;
  // So the page that opens this link knows which workspace to look in, without the workspace
  // having to be in the address.
  await rememberInviteToken(tenant.id, hash, expiresAt);
  return { token, email: row.email, expiresAt };
}

/**
 * The workspace a link belongs to, when the address does not say.
 *
 * This is a pointer, not a decision: whoever it points at still has to hold a matching, unspent,
 * unexpired hash on one of its own rows before anything happens.
 */
export async function tenantForInviteToken(token: string): Promise<TenantRef | null> {
  if (!token) return null;
  const tenant = await tenantForInviteHash(tokenHash(token));
  return tenant && tenant.status === "active" ? tenant : null;
}

/** Forgets a link in the control plane once it has been spent. */
export async function spendInviteToken(token: string): Promise<void> {
  if (token) await forgetInviteToken(tokenHash(token));
}

export interface InviteTarget {
  tenant: TenantRef;
  userId: string;
  email: string;
  name: string;
  /** False for an invitation, true when they already had a password and are replacing it. */
  isReset: boolean;
  /** True when they got here with a temporary password and have to replace it to go on. */
  mustChange: boolean;
}

/** Who a link belongs to, if it is still good. The workspace comes from the address it was opened at. */
export async function userForInviteToken(tenant: TenantRef, token: string): Promise<InviteTarget | null> {
  if (!token) return null;
  return withTenant(tenant, async () => {
    const [row] = await db
      .select()
      .from(users)
      .where(and(eq(users.inviteTokenHash, tokenHash(token)), eq(users.active, true)))
      .limit(1);
    if (!row?.inviteExpiresAt || row.inviteExpiresAt.getTime() <= Date.now()) return null;
    return {
      tenant,
      userId: row.id,
      email: row.email,
      name: row.name,
      isReset: Boolean(row.passwordHash),
      mustChange: row.mustChangePassword,
    };
  });
}

/**
 * Sets the password and spends the link.
 *
 * The session version goes up as well, so any session opened before the password changed stops
 * working — which is the point of changing it after somebody else may have seen it.
 */
export async function setUserPassword(
  tenant: TenantRef,
  userId: string,
  password: string,
  temporary?: { hours: number },
): Promise<void> {
  const hash = await hashPassword(password);
  await withTenant(tenant, () =>
    db
      .update(users)
      .set({
        passwordHash: hash,
        passwordSetAt: new Date(),
        inviteTokenHash: null,
        inviteExpiresAt: null,
        failedSignIns: 0,
        lockedUntil: null,
        mustChangePassword: Boolean(temporary),
        passwordExpiresAt: temporary ? new Date(Date.now() + temporary.hours * 3_600_000) : null,
        sessionVersion: dsql`${users.sessionVersion} + 1`,
      })
      .where(eq(users.id, userId)),
  );
}

/**
 * Gives the first admin of a new workspace a password their operator chose, to be handed over
 * with the address. It is temporary in both senses: it stops working after `hours`, and the
 * first thing it buys is the page where they replace it.
 */
export async function setTemporaryPassword(
  tenant: TenantRef,
  userId: string,
  password: string,
  hours = 72,
): Promise<void> {
  await setUserPassword(tenant, userId, password, { hours });
}

/**
 * Takes a password away, leaving Google as the only way in for that person. Takes the caller's
 * own binding, for the same reason as `issueUserInvite`.
 */
export async function clearUserPassword(tenant: TenantRef, userId: string): Promise<string | null> {
  return withTenant(tenant, async () => {
    const [row] = await db
      .update(users)
      .set({
        passwordHash: null,
        passwordSetAt: null,
        inviteTokenHash: null,
        inviteExpiresAt: null,
        failedSignIns: 0,
        lockedUntil: null,
        mustChangePassword: false,
        passwordExpiresAt: null,
        sessionVersion: dsql`${users.sessionVersion} + 1`,
      })
      .where(eq(users.id, userId))
      .returning({ email: users.email });
    return row?.email ?? null;
  });
}

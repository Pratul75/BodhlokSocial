import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ownerSql } from "@bodh/db";
import { devAuthAllowed, PLATFORM_COOKIE, verifyPlatformToken } from "./session";
import { hashPassword, LOCKOUT_AFTER, LOCKOUT_MINUTES, newToken, tokenHash } from "./passwords";

// The sign-in action reads these from here, beside the operator it is checking.
export { passwordMatches, passwordProblem } from "./passwords";

/**
 * Platform operators are a separate principal from tenant users: their own table in the
 * control plane, their own cookie, their own token audience. No tenant's `users` table ever
 * holds one, so a tenant admin can never become one.
 */
export interface Operator {
  id: string;
  email: string;
  name: string;
  role: "owner" | "support" | "billing";
  /** False until they have set one through a reset link. */
  hasPassword: boolean;
}

interface OperatorRow {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  session_version: number;
  password_hash: string | null;
  failed_sign_ins: number;
  locked_until: Date | null;
}

export async function findOperator(email: string): Promise<OperatorRow | null> {
  const rows = (await ownerSql()<OperatorRow[]>`
    select id, email, name, role, active, session_version, password_hash, failed_sign_ins, locked_until
    from platform.platform_operators
    where email = ${email.trim().toLowerCase()} and active = true
    limit 1`) as unknown as OperatorRow[];
  return rows[0] ?? null;
}

/** The signed-in operator, or null. Never falls back to a tenant session. */
export async function currentOperator(): Promise<Operator | null> {
  const jar = await cookies();
  const claims = await verifyPlatformToken(jar.get(PLATFORM_COOKIE)?.value);
  if (!claims) return null;
  const rows = (await ownerSql()<OperatorRow[]>`
    select id, email, name, role, active, session_version, password_hash, failed_sign_ins, locked_until
    from platform.platform_operators
    where id = ${claims.sub} and active = true
    limit 1`) as unknown as OperatorRow[];
  const row = rows[0];
  if (!row) return null;
  if (row.session_version !== claims.sv) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as Operator["role"],
    hasPassword: Boolean(row.password_hash),
  };
}

/** Use at the top of every console page. */
export async function requireOperator(): Promise<Operator> {
  const op = await currentOperator();
  if (!op) redirect("/super-admin/signin");
  return op;
}

/** Only an owner may create, suspend or delete a tenant. */
export async function requireOwner(): Promise<Operator> {
  const op = await requireOperator();
  if (op.role !== "owner") redirect("/super-admin?error=owner_only");
  return op;
}

/** Every platform action is recorded, including reads of a tenant's data. */
export async function platformAudit(entry: {
  actor: string;
  action: string;
  target: string;
  tenantId?: string | null;
  detail?: Record<string, string | number | boolean | null>;
}): Promise<void> {
  const sql = ownerSql();
  await sql`
    insert into platform.platform_audit (actor, action, target, tenant_id, detail)
    values (${entry.actor}, ${entry.action}, ${entry.target}, ${entry.tenantId ?? null}, ${
      entry.detail ? sql.json(entry.detail) : null
    })`;
}

/**
 * Whether an operator may sign in with nothing but an email address. That is a local
 * development convenience and never runs in production; a password works everywhere.
 */
export function operatorFormSignInAllowed(): boolean {
  return devAuthAllowed();
}

/* -------------------------------------------------------------------------- */
/* Passwords                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Operator passwords use the application's shared password code, the same as a workspace
 * user's. What is different here is only where the row lives: an operator is in the control
 * plane, a workspace user is inside their own workspace.
 *
 * There is no mail service in this application, so a password is never emailed. An owner issues
 * a one-time link, the console shows it once, and the owner passes it on.
 */

/** Issues a one-time link for an operator to set their password. Returns the token, once. */
export async function issueResetToken(operatorId: string, minutes = 60): Promise<string> {
  const token = newToken();
  await ownerSql()`
    update platform.platform_operators
    set reset_token_hash = ${tokenHash(token)},
        reset_expires_at = ${new Date(Date.now() + minutes * 60_000)}
    where id = ${operatorId}`;
  return token;
}

export interface ResetTarget {
  id: string;
  email: string;
  name: string;
}

/** The operator a reset link belongs to, if it is still good. */
export async function operatorForResetToken(token: string): Promise<ResetTarget | null> {
  if (!token) return null;
  const rows = (await ownerSql()<ResetTarget[]>`
    select id, email, name from platform.platform_operators
    where reset_token_hash = ${tokenHash(token)}
      and reset_expires_at is not null and reset_expires_at > now()
      and active = true
    limit 1`) as unknown as ResetTarget[];
  return rows[0] ?? null;
}

/**
 * Sets the password and spends the link. The session version goes up too, so any console session
 * opened with the old password stops working the moment the password changes.
 */
export async function setOperatorPassword(operatorId: string, password: string): Promise<void> {
  await ownerSql()`
    update platform.platform_operators
    set password_hash = ${await hashPassword(password)},
        password_set_at = now(),
        reset_token_hash = null,
        reset_expires_at = null,
        failed_sign_ins = 0,
        locked_until = null,
        session_version = session_version + 1
    where id = ${operatorId}`;
}

/**
 * Whether this account is refusing to answer for a while, after too many wrong passwords.
 *
 * The lock is on the account, not on the browser or the address: an attacker guessing from
 * somewhere else is exactly who it is for.
 */
export function operatorLocked(row: { locked_until: Date | null }): boolean {
  return Boolean(row.locked_until && row.locked_until.getTime() > Date.now());
}

/**
 * Counts one wrong password, and locks the account once there have been enough of them.
 * Returns true when this attempt was the one that locked it.
 */
export async function noteFailedOperatorSignIn(operatorId: string, failedSoFar: number): Promise<boolean> {
  const failed = failedSoFar + 1;
  const lock = failed >= LOCKOUT_AFTER;
  await ownerSql()`
    update platform.platform_operators
    set failed_sign_ins = ${failed},
        locked_until = ${lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null}
    where id = ${operatorId}`;
  return lock;
}

/** Forgets the wrong tries, after one that was right. */
export async function clearFailedOperatorSignIns(operatorId: string): Promise<void> {
  await ownerSql()`
    update platform.platform_operators
    set failed_sign_ins = 0, locked_until = null
    where id = ${operatorId} and (failed_sign_ins <> 0 or locked_until is not null)`;
}

/** Notes that this operator was here, for the console's own list. */
export async function touchOperator(operatorId: string): Promise<void> {
  await ownerSql()`update platform.platform_operators set last_seen_at = now() where id = ${operatorId}`;
}

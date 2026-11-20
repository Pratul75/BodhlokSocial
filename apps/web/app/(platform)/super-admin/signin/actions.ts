"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  clearFailedOperatorSignIns,
  findOperator,
  noteFailedOperatorSignIn,
  operatorForResetToken,
  operatorFormSignInAllowed,
  operatorLocked,
  passwordMatches,
  passwordProblem,
  platformAudit,
  setOperatorPassword,
  touchOperator,
} from "@/lib/platform-auth";
import { cookieOptions, createPlatformToken, PLATFORM_COOKIE } from "@/lib/session";

export type SignInState = { error: string } | null;

const SESSION_SECONDS = 60 * 60 * 12;

/**
 * Signs a platform operator in.
 *
 * A password works everywhere. An address on its own works only where the tenant app's own
 * development sign-in works — never in production — and only for an operator who has not been
 * given a password yet, so setting one cannot quietly leave the weaker door open.
 */
export async function signInOperator(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/super-admin");

  const row = await findOperator(email);
  // The same answer whether the address is unknown, the password is wrong, or the account is
  // locked. Saying "locked" would be kinder to whoever is locked out, and would also confirm
  // that the address is an operator's — eight wrong guesses would become a way to find out who
  // runs the platform. The page carries a standing line about the lock instead, which tells the
  // right person what happened without telling anybody else who exists.
  const refuse = async (why: string): Promise<SignInState> => {
    await platformAudit({ actor: email || "unknown", action: "operator_sign_in", target: "platform", detail: { result: why } });
    return { error: "That email and password do not match an active operator." };
  };

  if (!row) return refuse("unknown");
  // Already locked: refuse before spending any work on the password. The lock is on the account,
  // not the browser, because somebody guessing from elsewhere is exactly who it is for.
  if (operatorLocked(row)) return refuse("locked");

  if (row.password_hash) {
    if (!(await passwordMatches(password, row.password_hash))) {
      const nowLocked = await noteFailedOperatorSignIn(row.id, row.failed_sign_ins);
      return refuse(nowLocked ? "bad_password_locked" : "bad_password");
    }
  } else if (!operatorFormSignInAllowed()) {
    return refuse("no_password");
  }

  await clearFailedOperatorSignIns(row.id);
  const token = await createPlatformToken({ sub: row.id, email: row.email, sv: row.session_version, role: row.role });
  const jar = await cookies();
  jar.set(PLATFORM_COOKIE, token, cookieOptions(SESSION_SECONDS));
  await touchOperator(row.id);
  await platformAudit({ actor: row.email, action: "operator_sign_in", target: "platform", detail: { result: "ok" } });
  redirect(next.startsWith("/super-admin") && !next.startsWith("/super-admin/signin") ? next : "/super-admin");
}

export async function signOutOperator(): Promise<void> {
  const jar = await cookies();
  jar.delete(PLATFORM_COOKIE);
  redirect("/super-admin/signin");
}

export type ResetState = { ok: true } | { error: string } | null;

/** Sets a password from a one-time link, then sends them to sign in with it. */
export async function setPasswordFromToken(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const again = String(formData.get("confirm") ?? "");

  const target = await operatorForResetToken(token);
  if (!target) return { error: "That link has been used or has expired. Ask an owner for a new one." };
  if (password !== again) return { error: "The two passwords are not the same." };
  const problem = passwordProblem(password);
  if (problem) return { error: problem };

  await setOperatorPassword(target.id, password);
  await platformAudit({ actor: target.email, action: "set_operator_password", target: target.email });
  // Any session opened before now is dead: the session version went up.
  const jar = await cookies();
  jar.delete(PLATFORM_COOKIE);
  redirect("/super-admin/signin?set=1");
}

/**
 * Console passwords and the lockout, against a real Postgres.
 *
 * A console account reaches every workspace on the installation, so the thing worth proving is
 * that it stops answering after enough wrong guesses — and that the right password is refused
 * while it is locked, which is what makes the lock mean anything.
 *
 * Creates and drops its own database, so it never touches development data; skipped when
 * Postgres isn't reachable.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCKOUT_AFTER, LOCKOUT_MINUTES } from "./passwords";

const base = process.env.DATABASE_URL ?? "postgres://bodh:bodh@localhost:5433/bodh";
const dbName = `bodh_oppw_${Date.now()}`;
const admin = postgres(base, { max: 1, onnotice: () => {} });
const reachable = await admin`select 1`.then(() => true).catch(() => false);

describe.skipIf(!reachable)("console passwords", () => {
  let mod: typeof import("@bodh/db");
  let auth: typeof import("./platform-auth");
  let pw: typeof import("./passwords");
  let operatorId = "";

  const EMAIL = "owner@test.local";
  const PASSWORD = "console password 7";

  /** The row as the sign-in action sees it. */
  const row = async () => (await auth.findOperator(EMAIL))!;

  /** What the sign-in action does with a password, without the cookies and the redirect. */
  async function attempt(password: string): Promise<"ok" | "locked" | "bad"> {
    const r = await row();
    if (auth.operatorLocked(r)) return "locked";
    if (!(await pw.passwordMatches(password, r.password_hash))) {
      return (await auth.noteFailedOperatorSignIn(r.id, r.failed_sign_ins)) ? "locked" : "bad";
    }
    await auth.clearFailedOperatorSignIns(r.id);
    return "ok";
  }

  beforeAll(async () => {
    await admin.unsafe(`create database ${dbName}`);
    const url = new URL(base);
    url.pathname = `/${dbName}`;
    process.env.DATABASE_URL = url.toString();
    process.env.MIGRATE_DATABASE_URL = url.toString();
    process.env.PLATFORM_OWNER_EMAIL = EMAIL;

    mod = await import("@bodh/db");
    await mod.setupPlatform();
    const rows = (await mod.ownerSql()<{ id: string }[]>`
      insert into platform.platform_operators (email, name, role)
      values (${EMAIL}, 'Owner', 'owner')
      returning id`) as unknown as { id: string }[];
    operatorId = rows[0]!.id;

    auth = await import("./platform-auth");
    pw = await import("./passwords");
  }, 120_000);

  afterAll(async () => {
    await mod?.ownerSql?.().end({ timeout: 5 }).catch(() => undefined);
    await admin.unsafe(`drop database if exists ${dbName} with (force)`).catch(() => undefined);
    await admin.end();
  }, 60_000);

  it("a reset link is single-use, and setting a password raises the session version", async () => {
    const token = await auth.issueResetToken(operatorId, 60);
    const target = await auth.operatorForResetToken(token);
    expect(target?.email).toBe(EMAIL);

    const before = (await row()).session_version;
    await auth.setOperatorPassword(operatorId, PASSWORD);
    expect(await auth.operatorForResetToken(token)).toBeNull();
    expect((await row()).session_version).toBe(before + 1);
    expect(await attempt(PASSWORD)).toBe("ok");
  });

  it("an expired link opens nothing", async () => {
    const token = await auth.issueResetToken(operatorId, -1);
    expect(await auth.operatorForResetToken(token)).toBeNull();
  });

  it(`locks the account after ${LOCKOUT_AFTER} wrong passwords, and refuses the right one while locked`, async () => {
    for (let i = 1; i < LOCKOUT_AFTER; i++) {
      expect(await attempt("wrong password 1")).toBe("bad");
    }
    // The one that trips it.
    expect(await attempt("wrong password 1")).toBe("locked");
    expect(await attempt(PASSWORD)).toBe("locked");

    const r = await row();
    expect(r.failed_sign_ins).toBe(LOCKOUT_AFTER);
    const minutesLeft = (r.locked_until!.getTime() - Date.now()) / 60_000;
    expect(minutesLeft).toBeGreaterThan(LOCKOUT_MINUTES - 2);
    expect(minutesLeft).toBeLessThanOrEqual(LOCKOUT_MINUTES);
  });

  it("the lock lifts when it expires, and a right password forgets the wrong ones", async () => {
    await mod.ownerSql()`
      update platform.platform_operators set locked_until = now() - interval '1 minute' where id = ${operatorId}`;
    expect(await attempt(PASSWORD)).toBe("ok");
    const r = await row();
    expect(r.failed_sign_ins).toBe(0);
    expect(r.locked_until).toBeNull();
  });

  it("setting a new password clears a lock, so an owner's link is always a way back in", async () => {
    for (let i = 0; i < LOCKOUT_AFTER; i++) await attempt("wrong password 1");
    expect(await attempt(PASSWORD)).toBe("locked");

    const token = await auth.issueResetToken(operatorId, 60);
    expect(await auth.operatorForResetToken(token)).not.toBeNull();
    await auth.setOperatorPassword(operatorId, "a different password 3");

    const r = await row();
    expect(r.failed_sign_ins).toBe(0);
    expect(r.locked_until).toBeNull();
    expect(await attempt("a different password 3")).toBe("ok");
  });
});

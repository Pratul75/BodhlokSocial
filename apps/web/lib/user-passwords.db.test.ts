/**
 * Workspace passwords, against a real Postgres, with two real workspaces.
 *
 * The claim being tested is not "a password works" — it is that a password works in exactly one
 * workspace. Each workspace keeps its people in its own schema, reached through its own
 * database role, so the same address with the same password must open one and not the other.
 *
 * Creates and drops its own database, so it never touches development data; skipped when
 * Postgres isn't reachable.
 */
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const base = process.env.DATABASE_URL ?? "postgres://bodh:bodh@localhost:5433/bodh";
const dbName = `bodh_userpw_${Date.now()}`;
const admin = postgres(base, { max: 1, onnotice: () => {} });
const reachable = await admin`select 1`.then(() => true).catch(() => false);

describe.skipIf(!reachable)("workspace passwords", () => {
  let mod: typeof import("@bodh/db");
  let pw: typeof import("./user-passwords");
  let one: import("@bodh/db").TenantRef;
  let two: import("@bodh/db").TenantRef;
  let userOne = "";
  let userTwo = "";

  const SHARED = "same-person@example.com";
  const PASSWORD = "correct horse 7 battery";

  beforeAll(async () => {
    await admin.unsafe(`create database ${dbName}`);
    const url = new URL(base);
    url.pathname = `/${dbName}`;
    process.env.DATABASE_URL = url.toString();
    process.env.MIGRATE_DATABASE_URL = url.toString();
    delete process.env.DEFAULT_TENANT_SLUG;

    mod = await import("@bodh/db");
    await mod.setupPlatform();
    const bootstrap = await mod.migrateTenant(
      { id: "bootstrap", slug: "one", name: "One", dataSchema: "public", dbRole: null, status: "active" },
      undefined,
      "test",
    );
    expect(bootstrap.error).toBeUndefined();

    one = await mod.registerFirstTenant({ slug: "one", name: "One" });
    two = (await mod.provisionTenant({ slug: "two", name: "Two", adminEmail: "admin@two.test", actor: "test" })).tenant;

    // The same address, a person at both companies, in both workspaces.
    for (const [tenant, slot] of [
      [one, "one"],
      [two, "two"],
    ] as const) {
      const id = await mod.withTenant(tenant, async () => {
        const [row] = await mod.db
          .insert(mod.users)
          .values({ email: SHARED, name: "Same Person", role: "admin" })
          .returning({ id: mod.users.id });
        return row!.id;
      });
      await mod.noteUserInDirectory(tenant.id, SHARED, true);
      if (slot === "one") userOne = id;
      else userTwo = id;
    }

    pw = await import("./user-passwords");
  }, 180_000);

  afterAll(async () => {
    const roles = [one?.dbRole, two?.dbRole].filter((r): r is string => Boolean(r));
    await mod?.sql?.end?.({ timeout: 5 }).catch(() => undefined);
    await mod?.ownerSql?.().end({ timeout: 5 }).catch(() => undefined);
    await admin.unsafe(`drop database if exists ${dbName} with (force)`).catch(() => undefined);
    for (const role of roles) {
      await admin.unsafe(`drop role if exists "${role.replace(/"/g, '""')}"`).catch(() => undefined);
    }
    await admin.end();
  }, 60_000);

  it("an invitation link is single-use and names the right person", async () => {
    const invite = await pw.issueUserInvite(one, userOne, 1);
    expect(invite?.email).toBe(SHARED);

    const target = await pw.userForInviteToken(one, invite!.token);
    expect(target?.userId).toBe(userOne);
    expect(target?.isReset).toBe(false);

    await pw.setUserPassword(one, userOne, PASSWORD);
    // Spending it clears it: the same link a second time opens nothing.
    expect(await pw.userForInviteToken(one, invite!.token)).toBeNull();
  });

  it("a link made in one workspace does not open the other", async () => {
    const invite = await pw.issueUserInvite(two, userTwo, 1);
    expect(invite).not.toBeNull();
    expect(await pw.userForInviteToken(one, invite!.token)).toBeNull();
    expect(await pw.userForInviteToken(two, invite!.token)).not.toBeNull();
  });

  it("the password signs in to the workspace it was set in, and only that one", async () => {
    const yes = await pw.checkPassword(SHARED, PASSWORD, one);
    expect(yes.ok).toBe(true);
    if (yes.ok && "target" in yes) expect(yes.target.tenant.slug).toBe("one");

    // The same address and the same password, against the other workspace. There is a user row
    // there with this address; there is no password on it.
    const no = await pw.checkPassword(SHARED, PASSWORD, two);
    expect(no).toEqual({ ok: false, reason: "no_match" });
  });

  it("goes straight in when the password opens only one of the workspaces", async () => {
    // The address is in both; the password was set in `one` only. Nothing to ask about.
    const outcome = await pw.checkPassword(SHARED, PASSWORD, null);
    expect(outcome.ok).toBe(true);
    if (outcome.ok && "target" in outcome) expect(outcome.target.tenant.slug).toBe("one");
    else expect.fail("expected a single match");
  });

  it("offers a choice only when the password really opens more than one", async () => {
    // The same person reusing the same password in both workspaces: two separate accounts that
    // one password happens to open, so only they can say which one they meant.
    await pw.setUserPassword(two, userTwo, PASSWORD);

    const outcome = await pw.checkPassword(SHARED, PASSWORD, null);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !("choose" in outcome)) return expect.fail("expected a choice");
    expect(outcome.choose.map((c) => c.tenant.slug).sort()).toEqual(["one", "two"]);
    // Separate accounts: separate rows, even though the address and password match.
    expect(outcome.choose[0]!.user.id).not.toBe(outcome.choose[1]!.user.id);

    // Naming one workspace still signs in to that one and asks nothing.
    const direct = await pw.checkPassword(SHARED, PASSWORD, two);
    expect(direct.ok && "target" in direct).toBe(true);

    // Put `two` back, so the tests after this one see what they expect.
    await pw.clearUserPassword(two, userTwo);
  });

  it("the wrong password is refused, and enough wrong ones lock the account", async () => {
    expect(await pw.checkPassword(SHARED, "not the password 1", one)).toEqual({ ok: false, reason: "no_match" });

    for (let i = 1; i < 8; i++) await pw.checkPassword(SHARED, "not the password 1", one);
    // Locked now — and the right password is refused too, which is the point of a lockout.
    expect(await pw.checkPassword(SHARED, PASSWORD, one)).toEqual({ ok: false, reason: "locked" });

    // An admin issuing a new link and the person setting a password clears the lock.
    await pw.setUserPassword(one, userOne, PASSWORD);
    const after = await pw.checkPassword(SHARED, PASSWORD, one);
    expect(after.ok).toBe(true);
  });

  it("setting a password raises the session version, so older sessions die", async () => {
    const before = await mod.withTenant(one, async () => {
      const [row] = await mod.db.select().from(mod.users).where(eq(mod.users.id, userOne));
      return row!.sessionVersion;
    });
    await pw.setUserPassword(one, userOne, "another good password 9");
    const after = await mod.withTenant(one, async () => {
      const [row] = await mod.db.select().from(mod.users).where(eq(mod.users.id, userOne));
      return row!.sessionVersion;
    });
    expect(after).toBe(before + 1);
  });

  it("a link says which workspace it belongs to, so the bare address can open it", async () => {
    // This is what makes `/set-password?token=…` work with no workspace in the URL at all.
    const invite = await pw.issueUserInvite(two, userTwo, 1);
    const found = await pw.tenantForInviteToken(invite!.token);
    expect(found?.slug).toBe("two");

    // And it points nowhere once it has been spent.
    await pw.spendInviteToken(invite!.token);
    expect(await pw.tenantForInviteToken(invite!.token)).toBeNull();
    // The pointer is not the check: the row inside the workspace still holds the hash, and that
    // is what `userForInviteToken` goes on.
    expect(await pw.userForInviteToken(two, invite!.token)).not.toBeNull();
  });

  it("a token nobody issued points nowhere", async () => {
    expect(await pw.tenantForInviteToken("not-a-real-token")).toBeNull();
    expect(await pw.tenantForInviteToken("")).toBeNull();
  });

  it("a temporary password works once and demands to be replaced", async () => {
    await pw.setTemporaryPassword(two, userTwo, "handed over 2026", 72);
    const outcome = await pw.checkPassword(SHARED, "handed over 2026", two);
    expect(outcome.ok).toBe(true);
    if (outcome.ok && "target" in outcome) expect(outcome.target.mustChange).toBe(true);

    // Replacing it is what clears the demand; the new one is theirs.
    await pw.setUserPassword(two, userTwo, "now it is mine 4");
    const after = await pw.checkPassword(SHARED, "now it is mine 4", two);
    expect(after.ok).toBe(true);
    if (after.ok && "target" in after) expect(after.target.mustChange).toBe(false);
    expect(await pw.checkPassword(SHARED, "handed over 2026", two)).toEqual({ ok: false, reason: "no_match" });
  });

  it("a temporary password stops working when it expires, used or not", async () => {
    // Zero hours: already past by the time it is checked.
    await pw.setTemporaryPassword(two, userTwo, "never used 2026", 0);
    expect(await pw.checkPassword(SHARED, "never used 2026", two)).toEqual({ ok: false, reason: "expired" });
    // And the wrong password against an expired one is still just a refusal.
    expect(await pw.checkPassword(SHARED, "not even close 1", two)).toEqual({ ok: false, reason: "expired" });

    // A link still rescues them, and what they set through it has no expiry.
    const invite = await pw.issueUserInvite(two, userTwo, 1);
    const target = await pw.userForInviteToken(two, invite!.token);
    expect(target?.mustChange).toBe(true);
    await pw.setUserPassword(two, userTwo, "rescued by a link 5");
    const after = await pw.checkPassword(SHARED, "rescued by a link 5", two);
    expect(after.ok).toBe(true);
    if (after.ok && "target" in after) expect(after.target.mustChange).toBe(false);
  });

  it("a read-only binding cannot issue a link or clear a password", async () => {
    // This is what an operator looking inside a workspace holds. The database refuses the write,
    // which is the point: the boundary is the role, not a check in the page.
    const looking = { ...one, readOnly: true };
    await expect(pw.issueUserInvite(looking, userOne, 1)).rejects.toThrow();
    await expect(pw.clearUserPassword(looking, userOne)).rejects.toThrow();
    // And the password it could not clear still works.
    expect((await pw.checkPassword(SHARED, "another good password 9", one)).ok).toBe(true);
  });

  it("clearing a password leaves the person in place with no way in but Google", async () => {
    expect(await pw.clearUserPassword(one, userOne)).toBe(SHARED);
    expect(await pw.checkPassword(SHARED, "another good password 9", one)).toEqual({ ok: false, reason: "no_match" });
    const still = await mod.withTenant(one, async () => {
      const [row] = await mod.db.select().from(mod.users).where(eq(mod.users.id, userOne));
      return row!.active;
    });
    expect(still).toBe(true);
  });
});

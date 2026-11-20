/**
 * The paused sign-in: what the choice token is allowed to say, and what the page may show.
 *
 * Both doors end at the same question — a password that opened several workspaces, and a Google
 * identity that did — so the token is the only thing either one is trusted on. These tests are
 * about what it cannot do: name a workspace nobody opened, outlive its five minutes, or arrive
 * without saying which door it came through.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";

const TENANTS: Record<string, { id: string; name: string; status: string }> = {
  t1: { id: "t1", name: "Acme Ltd", status: "active" },
  t2: { id: "t2", name: "Zenith Dental", status: "active" },
  gone: { id: "gone", name: "Suspended Co", status: "suspended" },
};

vi.mock("@bodh/db", () => ({ tenantById: async (id: string) => TENANTS[id] ?? null }));

const SECRET = "test-secret-at-least-thirty-two-chars";

let session: typeof import("./session");
let choice: typeof import("./workspace-choice");

beforeAll(async () => {
  process.env.AUTH_SECRET = SECRET;
  session = await import("./session");
  choice = await import("./workspace-choice");
});

/** A token this build would never mint, to prove the verifier is what decides. */
async function handRolled(payload: Record<string, unknown>, seconds = 300): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${seconds}s`)
    .setAudience("bodh-workspace-choice")
    .sign(new TextEncoder().encode(SECRET));
}

describe("the choice token", () => {
  it("remembers which door it was earned at", async () => {
    for (const door of ["password", "google"] as const) {
      const token = await session.createChoiceToken({ email: "a@b.test", opened: ["t1:u1"], door });
      expect((await session.verifyChoiceToken(token))?.door).toBe(door);
    }
  });

  it("refuses one that does not say which door", async () => {
    expect(await session.verifyChoiceToken(await handRolled({ email: "a@b.test", opened: ["t1:u1"] }))).toBeNull();
  });

  it("refuses a door this build does not have", async () => {
    expect(
      await session.verifyChoiceToken(await handRolled({ email: "a@b.test", opened: ["t1:u1"], door: "sso" })),
    ).toBeNull();
  });

  it("refuses one signed with another secret", async () => {
    const other = await new SignJWT({ email: "a@b.test", opened: ["t1:u1"], door: "google" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .setAudience("bodh-workspace-choice")
      .sign(new TextEncoder().encode("a-completely-different-secret-value"));
    expect(await session.verifyChoiceToken(other)).toBeNull();
  });

  it("dies of old age", async () => {
    expect(await session.verifyChoiceToken(await handRolled({ email: "a@b.test", opened: ["t1:u1"], door: "google" }, -1))).toBeNull();
  });
});

describe("what the page may offer", () => {
  it("names every workspace the sign-in opened, in the token's order", async () => {
    const token = await session.createChoiceToken({ email: "a@b.test", opened: ["t2:u9", "t1:u4"], door: "google" });
    expect(await choice.choicesFromToken(token)).toEqual([
      { tenantId: "t2", name: "Zenith Dental" },
      { tenantId: "t1", name: "Acme Ltd" },
    ]);
  });

  it("drops a workspace that stopped being active while they were deciding", async () => {
    const token = await session.createChoiceToken({ email: "a@b.test", opened: ["t1:u4", "gone:u5"], door: "google" });
    expect(await choice.choicesFromToken(token)).toEqual([{ tenantId: "t1", name: "Acme Ltd" }]);
  });

  it("offers nothing at all without a valid token", async () => {
    expect(await choice.choicesFromToken(undefined)).toEqual([]);
    expect(await choice.choicesFromToken("not-a-token")).toEqual([]);
    // The one that matters: a token whose list was rewritten is not a list.
    expect(await choice.choicesFromToken(await handRolled({ email: "a@b.test", opened: ["t1:u1"] }))).toEqual([]);
  });
});

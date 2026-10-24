import { beforeAll, describe, expect, it } from "vitest";
import { checkIdentityClaims } from "./google";
import { createSessionToken, openOAuthState, safeReturnTo, sealOAuthState, verifySessionToken } from "./session";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123";
});

const domains = ["rechargestudio.com"];

describe("checkIdentityClaims", () => {
  it("accepts a verified Workspace account on an allowed domain", () => {
    const r = checkIdentityClaims({ email: "Kshitij@RechargeStudio.com", email_verified: true, hd: "rechargestudio.com", name: "K" }, domains);
    expect(r).toEqual({ ok: true, identity: { email: "kshitij@rechargestudio.com", name: "K", hd: "rechargestudio.com" } });
  });

  it("rejects unverified emails", () => {
    expect(checkIdentityClaims({ email: "a@rechargestudio.com", email_verified: false, hd: "rechargestudio.com" }, domains)).toEqual({ ok: false, reason: "unverified" });
  });

  it("rejects other domains", () => {
    expect(checkIdentityClaims({ email: "a@gmail.com", email_verified: true }, domains)).toEqual({ ok: false, reason: "domain" });
  });

  it("rejects a matching email without the Workspace hd claim", () => {
    expect(checkIdentityClaims({ email: "a@rechargestudio.com", email_verified: true }, domains)).toEqual({ ok: false, reason: "domain" });
  });

  it("rejects an hd that doesn't match the email domain", () => {
    expect(checkIdentityClaims({ email: "a@rechargestudio.com", email_verified: true, hd: "evil.com" }, ["rechargestudio.com", "evil.com"])).toEqual({ ok: false, reason: "domain" });
  });

  it("accepts any listed domain", () => {
    expect(checkIdentityClaims({ email: "a@asttrolok.com", email_verified: true, hd: "asttrolok.com" }, ["rechargestudio.com", "asttrolok.com"]).ok).toBe(true);
  });
});

describe("session tokens", () => {
  it("round-trips", async () => {
    const t = await createSessionToken({ sub: "u1", email: "a@rechargestudio.com" });
    expect(await verifySessionToken(t)).toEqual({ sub: "u1", email: "a@rechargestudio.com" });
  });

  it("rejects tampered tokens", async () => {
    const t = await createSessionToken({ sub: "u1", email: "a@rechargestudio.com" });
    const [h, p, s] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "admin", email: "x@rechargestudio.com", aud: "bodh-session", exp: 9999999999 })).toString("base64url");
    expect(await verifySessionToken(`${h}.${forged}.${s}`)).toBeNull();
    expect(await verifySessionToken(undefined)).toBeNull();
    expect(await verifySessionToken("garbage")).toBeNull();
  });

  it("does not accept an OAuth state token as a session", async () => {
    const state = await sealOAuthState({ state: "s", verifier: "v", nonce: "n", purpose: "signin", returnTo: "/" });
    expect(await verifySessionToken(state)).toBeNull();
    expect((await openOAuthState(state))?.state).toBe("s");
  });
});

describe("safeReturnTo", () => {
  it("keeps relative paths", () => {
    expect(safeReturnTo("/approvals?kind=post")).toBe("/approvals?kind=post");
  });
  it("drops other origins", () => {
    expect(safeReturnTo("https://evil.com")).toBe("/");
    expect(safeReturnTo("//evil.com")).toBe("/");
    expect(safeReturnTo("/\\evil.com")).toBe("/");
    expect(safeReturnTo(null)).toBe("/");
  });
});

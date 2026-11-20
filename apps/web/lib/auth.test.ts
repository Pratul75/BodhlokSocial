import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { checkIdentityClaims } from "./google";
import { createSessionToken, devAuthAllowed, openOAuthState, safeReturnTo, sameOrigin, sealOAuthState, verifySessionToken } from "./session";

describe("devAuthAllowed", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("allows dev sign-in only outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(devAuthAllowed()).toBe(true);
    vi.stubEnv("NODE_ENV", "test");
    expect(devAuthAllowed()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(devAuthAllowed()).toBe(false);
  });

  it("cannot be switched back on in production by the old ALLOW_DEV_AUTH flag", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_DEV_AUTH", "true");
    expect(devAuthAllowed()).toBe(false);
  });
});

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

  it("lets a verified address on another domain through (only an address an admin added gets in)", () => {
    expect(checkIdentityClaims({ email: "Partner@Gmail.com", email_verified: true, name: "P" }, domains)).toEqual({ ok: true, identity: { email: "partner@gmail.com", name: "P", hd: undefined } });
    expect(checkIdentityClaims({ email: "a@agency.in", email_verified: true, hd: "agency.in" }, domains).ok).toBe(true);
  });

  it("rejects an unverified address on another domain", () => {
    expect(checkIdentityClaims({ email: "a@gmail.com", email_verified: false }, domains)).toEqual({ ok: false, reason: "unverified" });
  });

  it("rejects another domain whose hd doesn't match", () => {
    expect(checkIdentityClaims({ email: "a@agency.in", email_verified: true, hd: "other.in" }, domains)).toEqual({ ok: false, reason: "domain" });
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
    const t = await createSessionToken({ sub: "u1", email: "a@rechargestudio.com", sv: 3 });
    expect(await verifySessionToken(t)).toEqual({ sub: "u1", email: "a@rechargestudio.com", sv: 3 });
  });

  it("rejects tampered tokens", async () => {
    const t = await createSessionToken({ sub: "u1", email: "a@rechargestudio.com", sv: 0 });
    const [h, , s] = t.split(".");
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

describe("sameOrigin", () => {
  // The Host header is what the browser asked for. Next rewrites `req.url` to localhost before
  // a route handler sees it, so these build the request the way the server really receives it.
  const req = (origin?: string, url = "https://growth.example.com/api/auth/signout", extra: Record<string, string> = {}) => {
    const host = new URL(url).host;
    const headers: Record<string, string> = { host, ...extra };
    if (origin) headers.origin = origin;
    return new Request(url, { method: "POST", headers });
  };

  it("accepts this app, and a request without an Origin header", () => {
    expect(sameOrigin(req("https://growth.example.com"), "https://growth.example.com")).toBe(true);
    expect(sameOrigin(req(), "https://growth.example.com")).toBe(true);
  });

  it("refuses another site and garbage", () => {
    expect(sameOrigin(req("https://evil.example"), "https://growth.example.com")).toBe(false);
    expect(sameOrigin(req("null"), "https://growth.example.com")).toBe(false);
  });

  it("accepts the host the request actually came in on, whatever APP_URL says", () => {
    // Development on a different port, and the workspace hostnames that are coming: one
    // configured address cannot speak for every address the app answers on.
    const local = "http://127.0.0.1:3200/api/auth/signout";
    expect(sameOrigin(req("http://127.0.0.1:3200", local), "http://localhost:3000")).toBe(true);

    const workspace = "https://zenith.growth.example.com/api/auth/signout";
    expect(sameOrigin(req("https://zenith.growth.example.com", workspace), "https://growth.example.com")).toBe(true);
  });

  it("still refuses one workspace's page posting at another's address", () => {
    const workspace = "https://zenith.growth.example.com/api/auth/signout";
    expect(sameOrigin(req("https://acme.growth.example.com", workspace), "https://growth.example.com")).toBe(false);
  });

  it("accepts APP_URL as well, for a host behind a proxy that rewrites it", () => {
    expect(sameOrigin(req("https://growth.example.com", "http://internal:8080/api/auth/signout"), "https://growth.example.com")).toBe(true);
  });

  it("follows the forwarded host and protocol when there is a proxy in front", () => {
    const behindProxy = req("https://zenith.growth.example.com", "http://internal:8080/api/auth/signout", {
      "x-forwarded-host": "zenith.growth.example.com",
      "x-forwarded-proto": "https",
    });
    expect(sameOrigin(behindProxy, "https://growth.example.com")).toBe(true);
  });

  it("ignores the url Next rewrote, and goes by the host the browser asked for", () => {
    // What actually happens on `next start`: req.url says localhost, the Host header does not.
    const asServed = new Request("http://localhost:3200/api/auth/signout", {
      method: "POST",
      headers: { host: "127.0.0.1:3200", origin: "http://127.0.0.1:3200" },
    });
    expect(sameOrigin(asServed, "http://localhost:3000")).toBe(true);
  });

  it("works with no extra origins given at all", () => {
    expect(sameOrigin(req("https://growth.example.com"))).toBe(true);
    expect(sameOrigin(req("https://evil.example"))).toBe(false);
  });
});

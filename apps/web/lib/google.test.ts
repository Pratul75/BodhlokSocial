import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { buildAuthUrl } = await import("./google");

beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = "client-id";
});

const base = { redirectUri: "https://growth.example.com/cb", scopes: ["https://www.googleapis.com/auth/youtube.force-ssl"], state: "s", verifier: "v".repeat(48) };

describe("buildAuthUrl", () => {
  it("lets the person choose the Google account when connecting an integration", async () => {
    const url = new URL(await buildAuthUrl({ ...base, offline: true }));
    expect(url.searchParams.get("prompt")).toBe("select_account consent");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.has("login_hint")).toBe(false);
    expect(url.searchParams.has("hd")).toBe(false);
  });

  it("still shows the chooser for signing in to Growth OS", async () => {
    const url = new URL(await buildAuthUrl({ ...base, scopes: ["openid", "email"], nonce: "n" }));
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.has("access_type")).toBe(false);
  });
});

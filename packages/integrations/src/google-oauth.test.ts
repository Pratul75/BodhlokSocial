import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updates: unknown[] = [];
vi.mock("@bodh/db", () => ({
  connections: { key: "key" },
  db: {
    update: () => ({
      set: (v: unknown) => ({
        where: () => {
          updates.push(v);
          return Promise.resolve();
        },
      }),
    }),
  },
}));
const grant = { refresh_token: "r1", scope: "s", connected_by: "a", connected_at: "t" };
const secrets: Record<string, unknown> = {};
vi.mock("./secrets", () => ({ readJsonSecret: vi.fn(async (key: string) => secrets[key] ?? null) }));

const { forgetAccessToken, googleAccessToken, googleClientForGrant, googleConnectClient, GoogleGrantRevokedError, refreshAccessToken, revokeGoogleGrant } =
  await import("./google-oauth");

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  updates.length = 0;
  forgetAccessToken();
  for (const k of Object.keys(secrets)) delete secrets[k];
  secrets.search_console = grant;
  secrets.google_ads = grant;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("refreshAccessToken", () => {
  it("turns invalid_grant into GoogleGrantRevokedError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(400, { error: "invalid_grant" })));
    await expect(refreshAccessToken("r1")).rejects.toBeInstanceOf(GoogleGrantRevokedError);
  });

  it("keeps other failures as plain errors with Google's code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(500, { error: "backend_error" })));
    await expect(refreshAccessToken("r1")).rejects.toThrow("Google token refresh failed (500: backend_error)");
  });
});

describe("googleAccessToken", () => {
  it("caches the access token until shortly before it expires", async () => {
    const f = vi.fn(async () => reply(200, { access_token: "a1", expires_in: 3600 }));
    vi.stubGlobal("fetch", f);
    expect(await googleAccessToken("search_console")).toBe("a1");
    expect(await googleAccessToken("search_console")).toBe("a1");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("marks the connection as an error when Google revoked the grant", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(400, { error: "invalid_grant" })));
    await expect(googleAccessToken("google_ads")).rejects.toMatchObject({ revoked: true, integration: "google_ads" });
    expect(updates).toEqual([expect.objectContaining({ status: "error", error: expect.stringMatching(/Reconnect it in Connections/) })]);
  });
});

describe("revokeGoogleGrant", () => {
  it("sends the refresh token in the POST body, never the URL", async () => {
    const f = vi.fn(async (_url: string | URL, _init?: RequestInit) => reply(200, {}));
    vi.stubGlobal("fetch", f);
    await revokeGoogleGrant("search_console");
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe("https://oauth2.googleapis.com/revoke");
    expect(String(init?.body)).toBe("token=r1");
  });
});

describe("the two Google apps", () => {
  const own = { client_id: "own.apps.googleusercontent.com", client_secret: "own-secret" };

  it("connects through Growth OS's own app once it's saved, otherwise the staff app", async () => {
    expect(await googleConnectClient()).toEqual({ client_id: "id", client_secret: "secret", own: false });
    secrets.google_app = own;
    expect(await googleConnectClient()).toEqual({ ...own, own: true });
  });

  it("refreshes each grant with the app that issued it", async () => {
    secrets.google_app = own;
    secrets.youtube = { ...grant, refresh_token: "r2", client_id: own.client_id };
    const f = vi.fn(async (_url: string | URL, _init?: RequestInit) => reply(200, { access_token: "a", expires_in: 3600 }));
    vi.stubGlobal("fetch", f);
    await googleAccessToken("search_console");
    await googleAccessToken("youtube");
    const bodies = f.mock.calls.map(([, init]) => new URLSearchParams(String(init?.body)));
    expect(bodies.map((b) => [b.get("refresh_token"), b.get("client_id"), b.get("client_secret")])).toEqual([
      ["r1", "id", "secret"],
      ["r2", own.client_id, "own-secret"],
    ]);
  });

  it("asks for a reconnect when the app that issued a grant is gone", async () => {
    await expect(googleClientForGrant({ client_id: "removed.apps.googleusercontent.com" })).rejects.toBeInstanceOf(GoogleGrantRevokedError);
    secrets.youtube = { ...grant, client_id: "removed.apps.googleusercontent.com" };
    vi.stubGlobal("fetch", vi.fn());
    await expect(googleAccessToken("youtube")).rejects.toMatchObject({ revoked: true, integration: "youtube" });
  });
});

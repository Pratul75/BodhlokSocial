import { afterEach, describe, expect, it, vi } from "vitest";
import { validateCredential } from "./validate";

type Reply = { status?: number; body: unknown };
function stubFetch(replies: Reply[] | ((url: string, init?: RequestInit) => Reply)) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const r = typeof replies === "function" ? replies(String(url), init) : replies.shift()!;
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("validateCredential", () => {
  it("passes integrations that have no check", async () => {
    expect(await validateCredential("postiz_app", "{}")).toEqual({ ok: true });
  });

  it("checks a Meta ad account with the token in a header, not the URL", async () => {
    const calls = stubFetch([{ body: { name: "Bodhlok ads", account_status: 1, currency: "INR", id: "act_1" } }]);
    const r = await validateCredential("meta_marketing", JSON.stringify({ ad_account_id: "1", access_token: "tok" }));
    expect(r).toEqual({ ok: true, label: "Bodhlok ads (INR)", warning: undefined });
    expect(calls[0]!.url).toContain("/act_1?fields=");
    expect(calls[0]!.url).not.toContain("tok");
    expect(new Headers(calls[0]!.init?.headers).get("authorization")).toBe("Bearer tok");
  });

  it("refuses a Meta token Graph rejects, with Meta's reason", async () => {
    stubFetch([{ status: 400, body: { error: { message: "Invalid OAuth access token." } } }]);
    const r = await validateCredential("meta_marketing", JSON.stringify({ ad_account_id: "act_1", access_token: "bad" }));
    expect(r).toEqual({ ok: false, error: "Meta refused the token for act_1: Invalid OAuth access token." });
  });

  it("warns when a CAPI test event code is set", async () => {
    stubFetch([{ body: { name: "Pixel" } }]);
    const r = await validateCredential("meta_capi", JSON.stringify({ pixel_id: "9", access_token: "t", test_event_code: "TEST1" }));
    expect(r.ok && r.warning).toMatch(/Test Events/);
  });

  it("checks DataForSEO with Basic auth and reports a low balance", async () => {
    const calls = stubFetch([{ body: { status_code: 20000, tasks: [{ result: [{ money: { balance: 0.5 } }] }] } }]);
    const r = await validateCredential("dataforseo", JSON.stringify({ login: "a@b.c", password: "p", target: "bodhlok.com" }));
    expect(r).toMatchObject({ ok: true, label: "bodhlok.com" });
    expect(r.ok && r.warning).toMatch(/\$0\.50/);
    expect(new Headers(calls[0]!.init?.headers).get("authorization")).toBe(`Basic ${Buffer.from("a@b.c:p").toString("base64")}`);
  });

  it("refuses a DataForSEO login the API rejects", async () => {
    stubFetch([{ status: 401, body: { status_code: 40100, status_message: "You are not authorized" } }]);
    const r = await validateCredential("dataforseo", JSON.stringify({ login: "a", password: "b", target: "c" }));
    expect(r).toEqual({ ok: false, error: "DataForSEO refused the login: You are not authorized" });
  });

  it("checks Postiz by listing channels", async () => {
    stubFetch([{ body: [{ id: "1" }, { id: "2" }] }]);
    const r = await validateCredential("postiz", JSON.stringify({ api_url: "https://p.example.com", api_key: "k" }));
    expect(r).toEqual({ ok: true, label: "2 channels in Postiz" });
  });

  it("refuses OpenAI and Perplexity keys the providers reject", async () => {
    stubFetch([{ status: 401, body: { error: { message: "Incorrect API key" } } }, { status: 401, body: {} }]);
    expect(await validateCredential("openai", "sk-bad")).toEqual({ ok: false, error: "OpenAI refused the key: Incorrect API key" });
    expect(await validateCredential("perplexity", "pplx-bad")).toEqual({ ok: false, error: "Perplexity refused the key (HTTP 401)." });
  });

  it("uses an extra check passed by the caller (the Anthropic key check lives with the SDK)", async () => {
    const r = await validateCredential("anthropic", "sk-ant", { anthropic: async () => ({ ok: false, error: "Anthropic rejected this key." }) });
    expect(r).toEqual({ ok: false, error: "Anthropic rejected this key." });
  });

  it("fails the save when the provider can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const r = await validateCredential("openai", "sk");
    expect(r).toEqual({ ok: false, error: "Couldn't check the credential: fetch failed" });
  });
});

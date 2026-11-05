import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHub, GitHubError } from "./github";

afterEach(() => vi.unstubAllGlobals());

function stub(handler: (method: string, url: string, body: unknown) => { status?: number; body?: unknown }) {
  const calls: { method: string; url: string; body: unknown; auth: string | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url: String(url), body, auth: new Headers(init?.headers).get("authorization") });
      const r = handler(method, String(url), body);
      return r.status === 204 ? new Response(null, { status: 204 }) : new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
    }),
  );
  return calls;
}

describe("GitHub client", () => {
  const gh = new GitHub({ token: "t0k", repo: "Pratul75/site" });

  it("refuses a repository that isn't owner/name", () => {
    expect(() => new GitHub({ token: "t", repo: "not a repo" })).toThrow(GitHubError);
  });

  it("creates a branch from the deploy branch, writes a file and opens a pull request", async () => {
    const calls = stub((method, url) => {
      if (url.endsWith("/git/ref/heads/bodhlok")) return { body: { object: { sha: "base123" } } };
      if (method === "POST" && url.endsWith("/git/refs")) return { status: 201, body: {} };
      if (method === "PUT" && url.includes("/contents/")) return { status: 201, body: {} };
      if (method === "POST" && url.endsWith("/pulls")) return { status: 201, body: { number: 7, html_url: "https://github.com/Pratul75/site/pull/7", state: "open", merged: false } };
      return { status: 404, body: { message: "Not Found" } };
    });
    const sha = await gh.branchSha("bodhlok");
    await gh.createBranch("growth-os/pages-1", sha);
    await gh.putFile("frontend/public/site/blog/a b.html", "growth-os/pages-1", "<h1>Hi</h1>", "blog: add a");
    const pr = await gh.createPull("growth-os/pages-1", "bodhlok", "Blog: a", "From Growth OS");
    expect(pr.number).toBe(7);
    expect(calls[1]).toMatchObject({ method: "POST", body: { ref: "refs/heads/growth-os/pages-1", sha: "base123" } });
    expect(calls[2]!.url).toBe("https://api.github.com/repos/Pratul75/site/contents/frontend/public/site/blog/a%20b.html");
    expect(Buffer.from((calls[2]!.body as { content: string }).content, "base64").toString()).toBe("<h1>Hi</h1>");
    expect(calls.every((c) => c.auth === "Bearer t0k")).toBe(true);
  });

  it("squash-merges and reports GitHub's errors with its message", async () => {
    stub((method, url) => (method === "PUT" && url.endsWith("/pulls/7/merge") ? { body: { merged: true } } : { status: 403, body: { message: "Resource not accessible by personal access token" } }));
    expect(await gh.mergePull(7, "Blog: a")).toBe(true);
    await expect(gh.getPull(7)).rejects.toThrow("GitHub 403: Resource not accessible by personal access token");
  });
});

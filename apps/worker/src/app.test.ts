import { describe, expect, it, vi } from "vitest";
import { createApp, PLACEHOLDER_TOKEN, tokenProblem, type WorkerDeps } from "./app";

const TOKEN = "t".repeat(40);
const ok = (detail: string) => ({ status: "succeeded" as const, detail, rows: 0 });

function fakeDeps(over: Partial<WorkerDeps["agents"]> = {}) {
  const calls: string[] = [];
  const job = (name: string, value: unknown = name) =>
    vi.fn(async () => {
      calls.push(name);
      return value;
    });
  const deps: WorkerDeps = {
    runJob: (async (name: string, fn: () => Promise<unknown>) => ({ job: name, ...((await fn()) as object) })) as unknown as WorkerDeps["runJob"],
    agents: {
      names: ["strategy", "content", "seo", "ads"],
      hasKey: async () => true,
      activeRun: vi.fn(async () => null),
      queueRun: vi.fn(async () => ({ id: "run-1", created: true })),
      runAgent: vi.fn(async () => ({ runId: "run-1", status: "succeeded" as const, summary: "", costUsd: 0 })),
      ...over,
    },
    jobs: {
      forwardToMeta: job("forwardToMeta", ok("meta")),
      forwardToGoogle: job("forwardToGoogle", ok("google")),
      loadMetaSpend: job("loadMetaSpend", ok("meta spend")),
      loadGoogleSpend: job("loadGoogleSpend", ok("google spend")),
      loadGa4Sessions: job("loadGa4Sessions", ok("ga4")),
      rebuild: job("rebuild", ok("rebuilt")),
      runPublisher: job("runPublisher", ok("published")),
      pollVideoJobs: job("pollVideoJobs", { checked: 0, finished: 0, failed: 0 }),
      ensurePageCatalog: job("ensurePageCatalog", 3),
      syncKeywords: job("syncKeywords", "synced"),
      startSiteAudit: job("startSiteAudit", "audit started"),
      pollSiteAudits: job("pollSiteAudits", "nothing finished"),
      startVisibilityChecks: job("startVisibilityChecks", "Started the AI-visibility checks."),
      publishQueued: job("publishQueued", "No approved pages waiting."),
      removeQueued: job("removeQueued", ""),
      syncSite: job("syncSite", "nothing to sync"),
      syncAdStructure: job("syncAdStructure", "2 ads"),
      scrubClientData: job("scrubClientData", ok("scrubbed")),
      verifyConnections: job("verifyConnections", [{ key: "anthropic", name: "Anthropic API", ok: false, detail: "rejected" }]),
      checkAnthropicKey: job("checkAnthropicKey", { ok: true, label: "x" }),
      buildDigest: job("buildDigest", { problems: 2, lines: ["a", "b"], text: "BODH Growth OS: 2 problems" }),
      sendDigest: job("sendDigest", "no_webhook"),
    } as unknown as WorkerDeps["jobs"],
    dbUp: async () => true,
  };
  return { deps, calls };
}

const post = (app: ReturnType<typeof createApp>, path: string, init: RequestInit = {}) =>
  app.request(path, { method: "POST", ...init, headers: { "x-worker-token": TOKEN, ...(init.headers ?? {}) } });

describe("tokenProblem", () => {
  it("requires a token", () => {
    expect(tokenProblem(undefined, "development")).toMatch(/not set/);
  });
  it("refuses the example placeholder and short tokens in production only", () => {
    expect(tokenProblem(PLACEHOLDER_TOKEN, "production")).toMatch(/placeholder/);
    expect(tokenProblem("short", "production")).toMatch(/24 characters/);
    expect(tokenProblem(PLACEHOLDER_TOKEN, "development")).toBeNull();
    expect(tokenProblem("x".repeat(64), "production")).toBeNull();
  });
});

describe("worker routes", () => {
  it("leaves /health open and reports the database", async () => {
    const { deps } = fakeDeps();
    const app = createApp(TOKEN, { ...deps, dbUp: async () => false });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, db: "down" });
  });

  it("rejects job calls without the right token, by header or bearer", async () => {
    const app = createApp(TOKEN, fakeDeps().deps);
    expect((await app.request("/jobs/tracking/hourly", { method: "POST" })).status).toBe(401);
    expect((await app.request("/jobs", { headers: { "x-worker-token": "wrong" } })).status).toBe(401);
    expect((await app.request("/jobs", { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(200);
  });

  it("no longer serves the old guardrail endpoint", async () => {
    const app = createApp(TOKEN, fakeDeps().deps);
    const res = await post(app, "/guardrails/ad-change", { body: "{}" });
    expect(res.status).toBe(404);
  });

  it("runs the hourly tracking steps in order and 404s unknown jobs", async () => {
    const { deps, calls } = fakeDeps();
    const app = createApp(TOKEN, deps);
    const res = await post(app, "/jobs/tracking/hourly?since=bad-date");
    expect(res.status).toBe(200);
    expect(calls).toEqual(["loadMetaSpend", "loadGoogleSpend", "rebuild"]);
    expect((await post(app, "/jobs/tracking/nope")).status).toBe(404);
    expect((await post(app, "/jobs/seo/nope")).status).toBe(404);
    expect((await post(app, "/jobs/site/nope")).status).toBe(404);
  });

  it("returns 500 with partial results when a tracking step fails", async () => {
    const { deps } = fakeDeps();
    deps.jobs.loadGoogleSpend = (async () => {
      throw new Error("Google token refresh failed (400)");
    }) as unknown as WorkerDeps["jobs"]["loadGoogleSpend"];
    const res = await post(createApp(TOKEN, deps), "/jobs/tracking/load-spend");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { results: unknown[]; error: string };
    expect(body.results).toHaveLength(1);
    expect(body.error).toMatch(/token refresh/);
  });

  it("dispatches SEO, site and ads jobs", async () => {
    const { deps, calls } = fakeDeps();
    const app = createApp(TOKEN, deps);
    expect(await (await post(app, "/jobs/seo/catalog")).json()).toEqual({ message: "Added 3 planned pages." });
    expect((await post(app, "/jobs/seo/geo")).status).toBe(202);
    expect((await post(app, "/jobs/site/publish")).status).toBe(200);
    expect((await post(app, "/jobs/ads/sync")).status).toBe(200);
    expect(calls).toEqual(["ensurePageCatalog", "startVisibilityChecks", "publishQueued", "removeQueued", "syncAdStructure"]);
  });

  it("runs the daily scrub with the daily tracking job", async () => {
    const { deps, calls } = fakeDeps();
    expect((await post(createApp(TOKEN, deps), "/jobs/tracking/daily")).status).toBe(200);
    expect(calls).toEqual(["loadGa4Sessions", "rebuild", "scrubClientData"]);
  });

  it("builds the ops digest after re-checking connections", async () => {
    const { deps, calls } = fakeDeps();
    const res = await post(createApp(TOKEN, deps), "/jobs/ops/alerts");
    expect(res.status).toBe(200);
    expect(calls).toEqual(["verifyConnections", "buildDigest", "sendDigest"]);
    expect(((await res.json()) as { detail: string }).detail).toMatch(/^2 problems; 1 of 1 connections failing; digest no webhook\./);
  });

  it("answers 409 when the AI-visibility checks are already running", async () => {
    const { deps } = fakeDeps();
    deps.jobs.startVisibilityChecks = (async () => "Already running: the checks started earlier are still going.") as WorkerDeps["jobs"]["startVisibilityChecks"];
    expect((await post(createApp(TOKEN, deps), "/jobs/seo/geo")).status).toBe(409);
  });
});

describe("POST /jobs/:agent", () => {
  it("404s agents that are not built instead of recording a run that never finishes", async () => {
    const { deps } = fakeDeps();
    const app = createApp(TOKEN, deps);
    const res = await post(app, "/jobs/publisher");
    expect(res.status).toBe(404);
    expect(deps.agents.queueRun).not.toHaveBeenCalled();
  });

  it("queues a run, starts it in the background and returns 202", async () => {
    const { deps } = fakeDeps();
    const res = await post(createApp(TOKEN, deps), "/jobs/content?trigger=manual", { body: JSON.stringify({ task: "three reels", requestedBy: "a@b.c" }) });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ runId: "run-1", status: "queued" });
    expect(deps.agents.queueRun).toHaveBeenCalledWith("content", "manual");
    expect(deps.agents.runAgent).toHaveBeenCalledWith("content", { trigger: "manual", task: "three reels", requestedBy: "a@b.c" }, "run-1");
  });

  it("answers 409 when a run is already going, including a race lost at insert time", async () => {
    const busy = fakeDeps({ activeRun: vi.fn(async () => "run-0") });
    expect((await post(createApp(TOKEN, busy.deps), "/jobs/ads")).status).toBe(409);

    const raced = fakeDeps({ queueRun: vi.fn(async () => ({ id: "run-0", created: false })) });
    const res = await post(createApp(TOKEN, raced.deps), "/jobs/ads");
    expect(res.status).toBe(409);
    expect(raced.deps.agents.runAgent).not.toHaveBeenCalled();
  });

  it("answers 409 without an Anthropic key", async () => {
    const { deps } = fakeDeps({ hasKey: async () => false });
    expect((await post(createApp(TOKEN, deps), "/jobs/seo")).status).toBe(409);
  });
});

import { describe, expect, it, vi } from "vitest";

/**
 * One tenant, so these assert what a route does rather than how many workspaces exist. The
 * fan-out over several tenants has its own test below.
 */
const TENANTS: { id: string; slug: string; name: string; dataSchema: string; dbRole: string | null; status: string }[] = [
  { id: "t1", slug: "first", name: "First", dataSchema: "public", dbRole: "bodh_public_app", status: "active" },
];
vi.mock("@bodh/db", () => ({
  agentRuns: { id: "id" },
  db: { select: () => ({ from: () => ({ limit: async () => [] }) }) },
  currentTenantOrNull: () => null,
  activeTenants: async () => TENANTS.filter((t) => t.status === "active"),
  tenantBySlug: async (slug: string) => TENANTS.find((t) => t.slug === slug) ?? null,
  withTenant: <T,>(_t: unknown, fn: () => T) => fn(),
}));

const { createApp, PLACEHOLDER_TOKEN, tokenProblem } = await import("./app");
type WorkerDeps = import("./app").WorkerDeps;

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
      enabled: vi.fn(async () => true),
      runAgent: vi.fn(async () => ({ runId: "run-1", status: "succeeded" as const, summary: "", costUsd: 0 })),
      replanTask: () => "Re-plan the month.",
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
      reconcileBilling: job("reconcileBilling", { accounts: 3, payments: 5, failed: 0, detail: "3 accounts, 5 payments" }),
      pullLeads: job("pullLeads", { added: 2, updated: 1, detail: "2 added, 1 updated" }),
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

describe("live 47ff99c routes carried into the merged worker", () => {
  it("CRM sync re-reads billing, pulls leads, then rebuilds the funnel", async () => {
    const { deps, calls } = fakeDeps();
    const res = await post(createApp(TOKEN, deps), "/jobs/crm/sync");
    expect(res.status).toBe(200);
    expect(calls).toEqual(["reconcileBilling", "pullLeads", "rebuild"]);
  });

  it("replan queues the Strategy agent with the re-plan flag and refuses while one is running", async () => {
    const runAgent = vi.fn(async () => ({ runId: "run-1", status: "failed" as const, summary: "", costUsd: 0 }));
    const { deps } = fakeDeps({ runAgent });
    const res = await post(createApp(TOKEN, deps), "/jobs/replan", { body: JSON.stringify({ requestedBy: "a@x" }) });
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 0));
    expect(runAgent).toHaveBeenCalledWith("strategy", expect.objectContaining({ trigger: "manual", replan: true, requestedBy: "a@x" }), "run-1");

    const busy = fakeDeps({ activeRun: vi.fn(async (a: string) => (a === "content" ? "run-9" : null)) });
    const r2 = await post(createApp(TOKEN, busy.deps), "/jobs/replan");
    expect(r2.status).toBe(409);
  });
});

describe("GA4 Data API backfill route", () => {
  it("loads the requested window and rebuilds the funnel for it", async () => {
    const loadGa4Sessions = vi.fn(async () => ({ status: "succeeded" as const, detail: "ok", rows: 1 }));
    const { deps, calls } = fakeDeps();
    deps.jobs.loadGa4Sessions = loadGa4Sessions as unknown as WorkerDeps["jobs"]["loadGa4Sessions"];
    const res = await post(createApp(TOKEN, deps), "/jobs/tracking/load-ga4?days=90&day=2026-11-04");
    expect(res.status).toBe(200);
    expect(loadGa4Sessions).toHaveBeenCalledWith("2026-11-04", { days: 90 });
    expect(calls).toContain("rebuild");
  });

  it("keeps the old single-day call without days, and refuses a bad window", async () => {
    const loadGa4Sessions = vi.fn(async () => ({ status: "skipped" as const, detail: "no export" }));
    const { deps, calls } = fakeDeps();
    deps.jobs.loadGa4Sessions = loadGa4Sessions as unknown as WorkerDeps["jobs"]["loadGa4Sessions"];
    const app = createApp(TOKEN, deps);
    expect((await post(app, "/jobs/tracking/load-ga4?day=2026-11-04")).status).toBe(200);
    expect(loadGa4Sessions).toHaveBeenCalledWith("2026-11-04", {});
    expect(calls).not.toContain("rebuild");
    for (const bad of ["0", "91", "7.5", "abc"]) expect((await post(app, `/jobs/tracking/load-ga4?days=${bad}`)).status).toBe(400);
  });
});


describe("one scheduler call, every workspace", () => {
  it("runs a job once per active tenant and reports each result", async () => {
    TENANTS.push({ id: "t2", slug: "second", name: "Second", dataSchema: "t_second", dbRole: "t_second_app", status: "active" });
    try {
      const { deps, calls } = fakeDeps();
      const res = await post(createApp(TOKEN, deps), "/jobs/publishing/run");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { tenants: Record<string, { status: number }> };
      expect(Object.keys(body.tenants).sort()).toEqual(["first", "second"]);
      expect(body.tenants.first!.status).toBe(200);
      expect(body.tenants.second!.status).toBe(200);
      // Once for each workspace, not once in total.
      expect(calls.filter((c) => c === "runPublisher")).toHaveLength(2);
    } finally {
      TENANTS.length = 1;
    }
  });

  it("runs only the named tenant when the caller names one", async () => {
    TENANTS.push({ id: "t2", slug: "second", name: "Second", dataSchema: "t_second", dbRole: "t_second_app", status: "active" });
    try {
      const { deps, calls } = fakeDeps();
      const res = await post(createApp(TOKEN, deps), "/jobs/publishing/run?tenant=second");
      expect(res.status).toBe(200);
      expect(calls.filter((c) => c === "runPublisher")).toHaveLength(1);
    } finally {
      TENANTS.length = 1;
    }
  });

  it("refuses a tenant that does not exist, rather than running for someone else", async () => {
    const { deps, calls } = fakeDeps();
    const res = await post(createApp(TOKEN, deps), "/jobs/publishing/run?tenant=nobody");
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("skips a suspended workspace", async () => {
    const { deps, calls } = fakeDeps();
    TENANTS.push({ id: "t3", slug: "paused", name: "Paused", dataSchema: "t_paused", dbRole: null, status: "suspended" });
    try {
      // activeTenants() is the registry's own filter; naming a suspended tenant is refused here.
      const res = await post(createApp(TOKEN, deps), "/jobs/publishing/run?tenant=paused");
      expect(res.status).toBe(409);
      expect(calls).toHaveLength(0);
    } finally {
      TENANTS.length = 1;
    }
  });
});

describe("a workspace that does not have an agent", () => {
  it("is told so, instead of a 500 the scheduler would retry", async () => {
    const { deps } = fakeDeps({ enabled: vi.fn(async () => false) });
    const res = await post(createApp(TOKEN, deps), "/jobs/strategy");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/not switched on/i);
    expect(deps.agents.queueRun).not.toHaveBeenCalled();
  });

  it("refuses a manual run that names no workspace once there is more than one", async () => {
    TENANTS.push({ id: "t2", slug: "second", name: "Second", dataSchema: "t_second", dbRole: "x", status: "active" });
    try {
      const { deps, calls } = fakeDeps();
      const res = await post(createApp(TOKEN, deps), "/jobs/publishing/run?trigger=manual");
      expect(res.status).toBe(400);
      expect(calls).toHaveLength(0);
    } finally {
      TENANTS.length = 1;
    }
  });
});

describe("one workspace failing does not stop the others", () => {
  it("runs every workspace and reports which one failed", async () => {
    TENANTS.push({ id: "t2", slug: "second", name: "Second", dataSchema: "t_second", dbRole: "x", status: "active" });
    TENANTS.push({ id: "t3", slug: "third", name: "Third", dataSchema: "t_third", dbRole: "y", status: "active" });
    try {
      const { deps, calls } = fakeDeps();
      let seen = 0;
      deps.jobs.runPublisher = (async () => {
        seen += 1;
        calls.push("runPublisher");
        if (seen === 2) throw new Error("second workspace is broken");
        return ok("published");
      }) as unknown as WorkerDeps["jobs"]["runPublisher"];

      const res = await post(createApp(TOKEN, deps), "/jobs/publishing/run");
      // 500 overall, because something did fail and the scheduler should see that.
      expect(res.status).toBe(500);
      const body = (await res.json()) as { tenants: Record<string, { status: number; body: { error?: string } }> };
      expect(Object.keys(body.tenants).sort()).toEqual(["first", "second", "third"]);
      expect(body.tenants.first!.status).toBe(200);
      expect(body.tenants.second!.status).toBe(500);
      expect(body.tenants.second!.body.error).toMatch(/second workspace is broken/);
      expect(body.tenants.third!.status).toBe(200);
      // The third ran even though the second threw: that is the isolation.
      expect(calls.filter((c) => c === "runPublisher")).toHaveLength(3);
    } finally {
      TENANTS.length = 1;
    }
  });
});

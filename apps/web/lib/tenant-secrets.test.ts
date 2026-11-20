import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The resolver behind the two public endpoints. What matters here is which workspace a value is
 * read for, and that only tenant #1 may fall back to the server-wide environment variable — the
 * variable that used to be the whole of this and reached every workspace at once.
 */
let tenant: { id: string; slug: string; name: string; dataSchema: string; dbRole: string | null; status: string } = {
  id: "t1",
  slug: "bodhlok",
  name: "Bodhlok",
  dataSchema: "public",
  dbRole: null,
  status: "active",
};
vi.mock("@bodh/db", () => ({ currentTenant: () => tenant }));

const store = new Map<string, string>();
vi.mock("@/lib/secrets", () => ({
  // The real naming rule, so the test proves the name carries the workspace.
  secretName: (key: string) =>
    tenant.dataSchema === "public" ? `integration-${key}` : `integration-${tenant.slug}-${key}`,
  secretStore: async () => ({
    get: async (name: string) => store.get(name) ?? null,
    put: async (name: string, value: string) => {
      store.set(name, value);
      return `local:${name}`;
    },
    remove: async (name: string) => {
      store.delete(name);
    },
  }),
}));

const { EVENTS_SECRET_KEY, FEED_TOKEN_KEY, clearTenantSecret, hasTenantSecret, rotateTenantSecret, tenantSecret } =
  await import("./tenant-secrets");

const asFirst = () => {
  tenant = { id: "t1", slug: "bodhlok", name: "Bodhlok", dataSchema: "public", dbRole: null, status: "active" };
};
const asSecond = () => {
  tenant = { id: "t2", slug: "acme", name: "Acme", dataSchema: "t_acme", dbRole: "r", status: "active" };
};

beforeEach(() => {
  store.clear();
  vi.unstubAllEnvs();
  asFirst();
});

describe("per-workspace public credentials", () => {
  it("stores each workspace's value under its own name", async () => {
    asFirst();
    const first = await rotateTenantSecret(FEED_TOKEN_KEY);
    asSecond();
    const second = await rotateTenantSecret(FEED_TOKEN_KEY);

    expect(first).not.toBe(second);
    expect([...store.keys()].sort()).toEqual(["integration-acme-page_feed", "integration-page_feed"]);

    // Each workspace reads its own, and never the other's.
    expect(await tenantSecret(FEED_TOKEN_KEY)).toBe(second);
    asFirst();
    expect(await tenantSecret(FEED_TOKEN_KEY)).toBe(first);
  });

  it("lets only tenant #1 fall back to the server-wide variable", async () => {
    vi.stubEnv("SEO_FEED_TOKEN", "from-the-environment");
    vi.stubEnv("BODH_EVENTS_SECRET", "events-from-the-environment");

    asFirst();
    expect(await tenantSecret(FEED_TOKEN_KEY)).toBe("from-the-environment");
    expect(await tenantSecret(EVENTS_SECRET_KEY)).toBe("events-from-the-environment");

    // The second workspace gets nothing from it: that variable is not its credential, and
    // answering with it is exactly how one secret came to open every workspace.
    asSecond();
    expect(await tenantSecret(FEED_TOKEN_KEY)).toBeNull();
    expect(await tenantSecret(EVENTS_SECRET_KEY)).toBeNull();
    expect(await hasTenantSecret(FEED_TOKEN_KEY)).toBe(false);
  });

  it("prefers a workspace's own value over the variable, even for tenant #1", async () => {
    vi.stubEnv("SEO_FEED_TOKEN", "from-the-environment");
    const own = await rotateTenantSecret(FEED_TOKEN_KEY);
    expect(await tenantSecret(FEED_TOKEN_KEY)).toBe(own);
    await clearTenantSecret(FEED_TOKEN_KEY);
    expect(await tenantSecret(FEED_TOKEN_KEY)).toBe("from-the-environment");
  });

  it("replaces the old value rather than adding another", async () => {
    asSecond();
    const first = await rotateTenantSecret(EVENTS_SECRET_KEY);
    const second = await rotateTenantSecret(EVENTS_SECRET_KEY);
    expect(second).not.toBe(first);
    expect(await tenantSecret(EVENTS_SECRET_KEY)).toBe(second);
    expect(store.size).toBe(1);
  });

  it("makes values long enough to be worth guarding", async () => {
    const value = await rotateTenantSecret(EVENTS_SECRET_KEY);
    expect(value.length).toBeGreaterThanOrEqual(40);
    expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

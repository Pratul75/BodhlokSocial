import { describe, expect, it } from "vitest";
import { seedRefusal, targetHost } from "./seed-guard";

describe("seedRefusal", () => {
  const base = { DEV_USER_EMAIL: "admin@rechargestudio.com" };

  it("refuses unless SEED_CONFIRM=yes", () => {
    expect(seedRefusal({ ...base })).toMatch(/SEED_CONFIRM=yes/);
    expect(seedRefusal({ ...base, SEED_CONFIRM: "true" })).toMatch(/SEED_CONFIRM=yes/);
    expect(seedRefusal({ ...base, SEED_CONFIRM: "yes" })).toBeNull();
  });

  it("refuses production unless SEED_ALLOW_PRODUCTION=yes as well", () => {
    expect(seedRefusal({ ...base, SEED_CONFIRM: "yes", NODE_ENV: "production" })).toMatch(/production/);
    expect(seedRefusal({ ...base, SEED_CONFIRM: "yes", NODE_ENV: "production", SEED_ALLOW_PRODUCTION: "yes" })).toBeNull();
  });

  it("needs an admin email", () => {
    expect(seedRefusal({ SEED_CONFIRM: "yes" })).toMatch(/DEV_USER_EMAIL/);
  });
});

describe("targetHost", () => {
  it("names the database without the password", () => {
    const t = targetHost("postgres://bodh:s3cret@db.internal:6543/bodh_growth");
    expect(t).toBe("db.internal:6543/bodh_growth");
    expect(t).not.toContain("s3cret");
  });
});

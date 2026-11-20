import { describe, expect, it } from "vitest";
import {
  ALL_ENABLED,
  capacity,
  effectiveAccess,
  FEATURE_KEYS,
  hasFeature,
  isUnrestricted,
  NOTHING_ENABLED,
  type Entitlements,
} from "./entitlements";
import { MODULES } from "./modules";
import { INTEGRATIONS } from "./integrations";

const ent = (modules: string[] = [], features: string[] = [], caps: [string, number | null][] = []): Entitlements => ({
  modules: new Set(modules),
  features: new Set(features),
  // These tests are about modules, features and capacities; accounts are all granted so they
  // never become the reason something is refused.
  integrations: new Set(INTEGRATIONS.map((i) => i.key)),
  capacities: new Map(caps),
});

describe("the fail-closed rule", () => {
  it("treats a tenant with nothing recorded as entitled to nothing", () => {
    // This is the whole point: a half-provisioned tenant must not get the product for free.
    expect(isUnrestricted(NOTHING_ENABLED)).toBe(false);
    for (const m of MODULES) expect(effectiveAccess("admin", m.key, NOTHING_ENABLED)).toBe(false);
    for (const f of FEATURE_KEYS) expect(hasFeature(NOTHING_ENABLED, f)).toBe(false);
  });

  it("only treats a tenant as unrestricted when that was said explicitly", () => {
    expect(isUnrestricted(ALL_ENABLED)).toBe(true);
    expect(isUnrestricted(ent())).toBe(false);
    expect(isUnrestricted(ent(["ads"]))).toBe(false);
  });

  it("gives an unrestricted tenant everything its roles allow", () => {
    for (const m of MODULES) {
      expect(effectiveAccess("admin", m.key, ALL_ENABLED)).toBe(m.roles.includes("admin"));
    }
    for (const f of FEATURE_KEYS) expect(hasFeature(ALL_ENABLED, f)).toBe(true);
  });
});

describe("effectiveAccess", () => {
  it("is the role's access narrowed by the tenant's, never widened", () => {
    const only = ent(["ads", "today", "admin"]);
    expect(effectiveAccess("admin", "ads", only)).toBe(true);
    // The tenant has it, but this role does not: the role still decides.
    expect(effectiveAccess("sales", "ads", only)).toBe(false);
    // The role has it, but the tenant does not.
    expect(effectiveAccess("admin", "seo", only)).toBe(false);
  });

  it("switching a module off takes it away from every role", () => {
    const off = ent(MODULES.filter((m) => m.key !== "ads").map((m) => m.key));
    for (const role of ["admin", "ads_manager", "seo_manager", "social_manager", "sales"] as const) {
      expect(effectiveAccess(role, "ads", off)).toBe(false);
    }
  });
});

describe("capacity", () => {
  it("prefers the tenant's number over the server's setting and the built-in default", () => {
    expect(capacity(ent([], [], [["creative.monthly_images", 12]]), "creative.monthly_images", {})).toBe(12);
    expect(capacity(ent(), "creative.monthly_images", { CREATIVE_MONTHLY_IMAGES: "40" })).toBe(40);
    expect(capacity(ent(), "creative.monthly_images", {})).toBe(300);
  });

  it("falls through a null, which means 'no number set for this tenant'", () => {
    expect(capacity(ent([], [], [["creative.monthly_videos", null]]), "creative.monthly_videos", {})).toBe(30);
  });
});

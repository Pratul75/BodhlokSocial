/**
 * Which outside accounts each module needs, and what happens when a workspace has none of them.
 *
 * The rule this protects: a module whose accounts were all withheld is a page that can only
 * ever be empty, so it is not shown — but **one** account is enough. A workspace given Meta and
 * not Google still has an Ads manager worth opening, and getting that wrong would quietly take
 * a paid section of the product away.
 */
import { describe, expect, it } from "vitest";
import { ALL_ENABLED, effectiveAccess, integrationAllowed, NOTHING_ENABLED, type Entitlements } from "./entitlements";
import { INTEGRATIONS } from "./integrations";
import { MODULE_INTEGRATIONS, MODULES, UNCLAIMED_INTEGRATIONS, type ModuleKey } from "./modules";

const everyIntegration = INTEGRATIONS.map((i) => i.key);
const everyModule = MODULES.map((m) => m.key);

const ent = (integrations: string[], modules: string[] = everyModule): Entitlements => ({
  modules: new Set(modules),
  features: new Set(),
  integrations: new Set(integrations),
  capacities: new Map(),
});

describe("MODULE_INTEGRATIONS", () => {
  it("names only accounts the product actually has", () => {
    for (const [module, keys] of Object.entries(MODULE_INTEGRATIONS)) {
      expect(everyModule, module).toContain(module as ModuleKey);
      for (const k of keys ?? []) expect(everyIntegration, `${module} -> ${k}`).toContain(k);
    }
  });

  it("every account belongs to a module, or is named as infrastructure", () => {
    // An account nobody claims is one no module hides for, and one every preset grants whatever
    // else it switches off. Adding an integration and forgetting this map is the easy mistake;
    // this is what makes it loud.
    const claimed = new Set(Object.values(MODULE_INTEGRATIONS).flat());
    const unclaimed = everyIntegration.filter((k) => !claimed.has(k) && !(k in UNCLAIMED_INTEGRATIONS));
    expect(unclaimed, `unclaimed accounts: ${unclaimed.join(", ")}`).toEqual([]);
  });

  it("the infrastructure list names nothing a module also claims", () => {
    const claimed = new Set(Object.values(MODULE_INTEGRATIONS).flat());
    for (const k of Object.keys(UNCLAIMED_INTEGRATIONS)) {
      expect(everyIntegration, k).toContain(k);
      expect(claimed.has(k), `${k} is both claimed and called infrastructure`).toBe(false);
    }
  });

  it("leaves the modules that need no outside account alone", () => {
    for (const m of ["today", "approvals", "connections", "admin"] as const) {
      expect(MODULE_INTEGRATIONS[m]).toBeUndefined();
    }
  });
});

describe("effectiveAccess with integrations", () => {
  it("one account is enough", () => {
    expect(effectiveAccess("admin", "ads", ent(["meta_marketing"]))).toBe(true);
    expect(effectiveAccess("admin", "ads", ent(["google_ads"]))).toBe(true);
    expect(effectiveAccess("admin", "ads", ent(["google_ads", "meta_marketing"]))).toBe(true);
  });

  it("none of them hides the module", () => {
    // Every account except the two the Ads manager works with.
    const without = everyIntegration.filter((k) => !["google_ads", "meta_marketing"].includes(k));
    expect(effectiveAccess("admin", "ads", ent(without))).toBe(false);
    // And the modules that need no account are untouched by it.
    expect(effectiveAccess("admin", "today", ent(without))).toBe(true);
    expect(effectiveAccess("admin", "admin", ent(without))).toBe(true);
  });

  it("holds for every module that names accounts", () => {
    for (const m of everyModule) {
      const needs = MODULE_INTEGRATIONS[m];
      if (!needs?.length) continue;
      const without = everyIntegration.filter((k) => !needs.includes(k));
      // Admin can reach everything by role, so role is never the reason here.
      if (!MODULES.find((d) => d.key === m)!.roles.includes("admin")) continue;
      expect(effectiveAccess("admin", m, ent(without)), `${m} with none of its accounts`).toBe(false);
      expect(effectiveAccess("admin", m, ent([needs[0]!])), `${m} with ${needs[0]}`).toBe(true);
    }
  });

  it("the module entitlement still comes first", () => {
    // Every account, but the module itself is off.
    expect(effectiveAccess("admin", "ads", ent(everyIntegration, everyModule.filter((m) => m !== "ads")))).toBe(false);
  });

  it("role still comes first of all", () => {
    // Sales may not open the Ads manager however much is granted.
    expect(effectiveAccess("sales", "ads", ent(everyIntegration))).toBe(false);
  });

  it("an unrestricted workspace has everything, an empty one nothing", () => {
    for (const m of everyModule) {
      expect(effectiveAccess("admin", m, ALL_ENABLED), m).toBe(true);
      expect(effectiveAccess("admin", m, NOTHING_ENABLED), m).toBe(false);
    }
  });
});

describe("integrationAllowed", () => {
  it("is the row, except for an unrestricted workspace", () => {
    expect(integrationAllowed(ent(["anthropic"]), "anthropic")).toBe(true);
    expect(integrationAllowed(ent(["anthropic"]), "google_ads")).toBe(false);
    expect(integrationAllowed(ALL_ENABLED, "google_ads")).toBe(true);
    expect(integrationAllowed(NOTHING_ENABLED, "google_ads")).toBe(false);
  });
});

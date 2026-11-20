/**
 * Modules and features have to agree with each other.
 *
 * A module that is off while one of its own capabilities is on is the shape every hole in this
 * area took: the page disappears from the menu, and an agent, a webhook or a scheduled job
 * carries on using it. These tests are about that one invariant, in both directions.
 */
import { describe, expect, it } from "vitest";
import {
  ALL_ENABLED,
  FEATURE_KEYS,
  FEATURE_MODULE,
  featuresOfModule,
  featureUsable,
  hasFeature,
  NOTHING_ENABLED,
  type Entitlements,
  type FeatureKey,
} from "./entitlements";
import { APPROVAL_KINDS, APPROVAL_MODULE, AGENT_MODULE, MODULES, type ModuleKey } from "./modules";
import { INTEGRATIONS } from "./integrations";

/** Everything connectable, so these tests are about modules and features, not accounts. */
const ALL_INTEGRATIONS = INTEGRATIONS.map((i) => i.key);

const ent = (modules: string[], features: string[], integrations: string[] = ALL_INTEGRATIONS): Entitlements => ({
  modules: new Set(modules),
  features: new Set(features),
  integrations: new Set(integrations),
  capacities: new Map(),
});

const moduleKeys = MODULES.map((m) => m.key);

describe("every key maps to a real module", () => {
  it("each feature belongs to a module the product has", () => {
    for (const f of FEATURE_KEYS) {
      expect(moduleKeys, `${f} -> ${FEATURE_MODULE[f]}`).toContain(FEATURE_MODULE[f]);
    }
  });

  it("every feature is accounted for exactly once", () => {
    const collected = moduleKeys.flatMap((m) => featuresOfModule(m));
    expect(collected.sort()).toEqual([...FEATURE_KEYS].sort());
  });

  it("an agent's feature and the agent itself name the same module", () => {
    // These were written out twice and drifted: the mentions agent belongs to SEO while the
    // feature map said Community, so switching Community off stopped an SEO agent. One of them
    // is now derived from the other; this is what keeps it that way.
    for (const [agent, module] of Object.entries(AGENT_MODULE)) {
      const feature = `agents.${agent}` as FeatureKey;
      expect(FEATURE_KEYS as readonly string[], feature).toContain(feature);
      expect(FEATURE_MODULE[feature], `${feature} vs AGENT_MODULE.${agent}`).toBe(module);
    }
  });

  it("switching a module off takes only its own features", () => {
    // What the console does when a module is switched off, checked against the map it reads.
    for (const m of moduleKeys) {
      for (const f of featuresOfModule(m)) {
        expect(FEATURE_MODULE[f], `${f} came back from featuresOfModule("${m}")`).toBe(m);
      }
    }
  });

  it("each kind of approval names a module it acts on", () => {
    for (const k of APPROVAL_KINDS) expect(moduleKeys).toContain(APPROVAL_MODULE[k]);
  });

  it("each agent names a module it works in", () => {
    for (const [agent, module] of Object.entries(AGENT_MODULE)) {
      expect(moduleKeys, `${agent} -> ${module}`).toContain(module as ModuleKey);
    }
  });
});

describe("featureUsable", () => {
  it("needs the feature and its module, not just the feature", () => {
    const featureOnly = ent([], ["ads.write"]);
    expect(hasFeature(featureOnly, "ads.write")).toBe(true);
    // The feature row says yes; the module says no. The answer is no.
    expect(featureUsable(featureOnly, "ads.write")).toBe(false);

    const both = ent(["ads"], ["ads.write"]);
    expect(featureUsable(both, "ads.write")).toBe(true);
  });

  it("the module alone is not enough either", () => {
    expect(featureUsable(ent(["ads"], []), "ads.write")).toBe(false);
  });

  it("holds for every feature there is", () => {
    for (const f of FEATURE_KEYS) {
      const withoutModule = ent(
        moduleKeys.filter((m) => m !== FEATURE_MODULE[f]),
        [...FEATURE_KEYS],
      );
      expect(featureUsable(withoutModule, f as FeatureKey), f).toBe(false);
    }
  });

  it("an unrestricted workspace has everything, and an empty one has nothing", () => {
    for (const f of FEATURE_KEYS) {
      expect(featureUsable(ALL_ENABLED, f as FeatureKey)).toBe(true);
      expect(featureUsable(NOTHING_ENABLED, f as FeatureKey)).toBe(false);
    }
  });
});

describe("featuresOfModule", () => {
  it("names what goes off when a module does", () => {
    expect(featuresOfModule("ads").sort()).toEqual(["ads.auto_apply", "ads.write", "agents.ads"].sort());
    expect(featuresOfModule("creative").sort()).toEqual(["creative.image", "creative.video"].sort());
    // Today has nothing of its own, and that is fine.
    expect(featuresOfModule("today")).toEqual([]);
  });
});

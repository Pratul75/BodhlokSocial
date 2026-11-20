/**
 * The presets, and what applying one would do.
 *
 * The complaint that led to these: two modules switched off by hand, Essentials applied, and
 * seven more went off. That is what a preset does — it is a whole configuration, not an
 * addition — but it had no business being a surprise, and the preset itself was incoherent:
 * it shipped `creative.image` and `chat` switched on with their modules switched off.
 */
import { describe, expect, it } from "vitest";
import { FEATURE_KEYS, FEATURE_MODULE, INTEGRATIONS, MODULE_INTEGRATIONS, MODULES } from "@bodh/shared";
import { ESSENTIALS_FEATURES, ESSENTIALS_MODULES, presetChange, presetContents, presetOf } from "./access-presets";

const moduleKeys = MODULES.map((m) => m.key);

describe("presetContents", () => {
  it("Full is everything", () => {
    const full = presetContents("full");
    expect(full.modules.sort()).toEqual([...moduleKeys].sort());
    expect(full.features.sort()).toEqual([...FEATURE_KEYS].sort());
  });

  it("Essentials is coherent: no feature of a module it leaves off", () => {
    const { modules, features } = presetContents("essentials");
    for (const f of features) {
      expect(modules, `${f} needs ${FEATURE_MODULE[f]}`).toContain(FEATURE_MODULE[f]);
    }
  });

  it("every preset is coherent, so this cannot drift again", () => {
    for (const p of ["full", "essentials"] as const) {
      const { modules, features } = presetContents(p);
      for (const f of features) expect(modules, `${p}: ${f}`).toContain(FEATURE_MODULE[f]);
    }
  });

  it("Essentials leaves out the parts that spend or reach outside on their own", () => {
    const { modules } = presetContents("essentials");
    for (const off of ["ads", "seo", "community", "leads", "tracking"]) {
      expect(modules).not.toContain(off);
    }
    // And keeps the ones a workspace actually runs on.
    for (const on of ["today", "calendar", "approvals", "publishing", "analytics", "admin"]) {
      expect(modules).toContain(on);
    }
  });

  it("Essentials gives no account to a module it leaves off", () => {
    const { modules, integrations } = presetContents("essentials");
    const claimed = new Set(Object.values(MODULE_INTEGRATIONS).flat());
    for (const k of integrations) {
      if (!claimed.has(k)) continue; // internal receivers belong to no module
      const owners = MODULES.map((m) => m.key).filter((m) => (MODULE_INTEGRATIONS[m] ?? []).includes(k));
      expect(owners.some((m) => modules.includes(m)), `${k} has no module in this preset`).toBe(true);
    }
  });

  it("every module that needs an account keeps at least one under Full", () => {
    const { modules, integrations } = presetContents("full");
    for (const m of modules) {
      const needs = MODULE_INTEGRATIONS[m];
      if (!needs?.length) continue;
      expect(needs.some((k) => integrations.includes(k)), m).toBe(true);
    }
  });

  it("the declared lists are a subset of what the product has", () => {
    for (const m of ESSENTIALS_MODULES) expect(moduleKeys).toContain(m);
    for (const f of ESSENTIALS_FEATURES) expect([...FEATURE_KEYS]).toContain(f);
  });
});

describe("presetOf", () => {
  it("recognises its own output", () => {
    for (const p of ["full", "essentials"] as const) {
      const { modules, features, integrations } = presetContents(p);
      expect(presetOf(new Set(modules), new Set(features), new Set(integrations))).toBe(p);
    }
  });

  it("anything else is custom", () => {
    const { modules, features, integrations } = presetContents("essentials");
    expect(presetOf(new Set(modules.slice(1)), new Set(features), new Set(integrations))).toBe("custom");
    // An account switched off by hand makes it custom too.
    expect(presetOf(new Set(modules), new Set(features), new Set(integrations.slice(1)))).toBe("custom");
  });
});

describe("presetChange", () => {
  it("names exactly what would go off — the thing nobody was told", () => {
    // A workspace on Full, about to be put on Essentials.
    const full = presetContents("full");
    const change = presetChange("essentials", new Set(full.modules), new Set(full.features), new Set(full.integrations));

    expect(change.turningOn).toEqual([]);
    // Five modules leave, and every feature belonging to them.
    expect(change.turningOff).toContain("Ads manager");
    expect(change.turningOff).toContain("SEO & GEO");
    expect(change.turningOff).toContain("Community");
    expect(change.turningOff).toContain("Leads");
    expect(change.turningOff).toContain("Tracking");
    expect(change.turningOff.length).toBeGreaterThan(5);
  });

  it("counts a workspace already on the preset as nothing to do", () => {
    const { modules, features, integrations } = presetContents("essentials");
    const change = presetChange("essentials", new Set(modules), new Set(features), new Set(integrations));
    expect(change.turningOn).toEqual([]);
    expect(change.turningOff).toEqual([]);
    expect(change.unchanged).toBe(MODULES.length + FEATURE_KEYS.length + INTEGRATIONS.length);
  });

  it("reports the two switched off by hand, not seven, when the preset wants them back", () => {
    // Exactly the reported case in reverse: Essentials, minus two more by hand, back to Full.
    const essentials = presetContents("essentials");
    const modules = new Set(essentials.modules.filter((m) => m !== "calendar" && m !== "analytics"));
    const change = presetChange("essentials", modules, new Set(essentials.features), new Set(essentials.integrations));
    expect(change.turningOn).toEqual(["Content calendar", "Analytics"]);
    expect(change.turningOff).toEqual([]);
  });
});

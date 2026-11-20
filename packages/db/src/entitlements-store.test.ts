/**
 * Reading entitlement rows — in particular, what absence means.
 *
 * This is the file that decides whether a workspace sees the product, so the interesting cases
 * are all about missing rows. Two different absences mean two different things, and getting
 * them the wrong way round either takes a live installation dark or hands a half-made workspace
 * everything.
 */
import { describe, expect, it } from "vitest";
import { INTEGRATIONS, MODULES, FEATURE_KEYS } from "@bodh/shared";
import { buildEntitlements } from "./entitlements-store";

const row = (kind: string, key: string, enabled = true, value: string | null = null) => ({ kind, key, enabled, value });

const everyModuleRow = MODULES.map((m) => row("module", m.key));
const everyFeatureRow = FEATURE_KEYS.map((f) => row("feature", f));
const everyIntegrationRow = INTEGRATIONS.map((i) => row("integration", i.key));

describe("buildEntitlements", () => {
  it("no rows at all means nothing — a broken workspace is not a free one", () => {
    const ent = buildEntitlements([]);
    expect(ent.modules.size).toBe(0);
    expect(ent.features.size).toBe(0);
    expect(ent.integrations.size).toBe(0);
    expect(ent.unrestricted).not.toBe(true);
  });

  it("reads what is there", () => {
    const ent = buildEntitlements([
      row("module", "ads"),
      row("module", "seo", false),
      row("feature", "ads.write"),
      row("integration", "google_ads"),
      row("integration", "meta_marketing", false),
      row("capacity", "ai.monthly_budget_usd", true, "150"),
    ]);
    expect([...ent.modules]).toEqual(["ads"]);
    expect([...ent.features]).toEqual(["ads.write"]);
    expect([...ent.integrations]).toEqual(["google_ads"]);
    expect(ent.capacities.get("ai.monthly_budget_usd")).toBe(150);
  });

  it("a workspace from before integrations existed keeps every account", () => {
    // What a live installation looks like the moment this deploys: modules and features were
    // provisioned long ago, integrations are a kind nobody has rows for yet. Reading that as
    // "no accounts" would hide every module that needs one.
    const ent = buildEntitlements([...everyModuleRow, ...everyFeatureRow]);
    expect(ent.integrations.size).toBe(INTEGRATIONS.length);
    for (const i of INTEGRATIONS) expect(ent.integrations.has(i.key), i.key).toBe(true);
    // And it is not a backdoor to everything else.
    expect(ent.unrestricted).not.toBe(true);
  });

  it("one integration row switched off is a decision, and stays one", () => {
    // The moment any integration row exists, absence of the others means refused — because now
    // somebody has been asked.
    const ent = buildEntitlements([...everyModuleRow, ...everyFeatureRow, row("integration", "google_ads", false)]);
    expect(ent.integrations.size).toBe(0);
  });

  it("a fully provisioned workspace reads back exactly what it was given", () => {
    const ent = buildEntitlements([...everyModuleRow, ...everyFeatureRow, ...everyIntegrationRow]);
    expect(ent.modules.size).toBe(MODULES.length);
    expect(ent.features.size).toBe(FEATURE_KEYS.length);
    expect(ent.integrations.size).toBe(INTEGRATIONS.length);
  });

  it("a capacity of null stays null, not zero", () => {
    const ent = buildEntitlements([row("module", "ads"), row("capacity", "ai.run_cap_usd", true, null)]);
    expect(ent.capacities.get("ai.run_cap_usd")).toBeNull();
  });
});

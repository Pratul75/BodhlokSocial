import {
  FEATURE_KEYS,
  FEATURE_LABELS,
  FEATURE_MODULE,
  INTEGRATIONS,
  MODULE_INTEGRATIONS,
  MODULES,
  type FeatureKey,
  type ModuleKey,
} from "@bodh/shared";

/**
 * Named sets of modules and features.
 *
 * Full is everything. Essentials is the shape of the product a workspace can run on without ad
 * spend and without the parts that reach outside on their own — no ads, no SEO publishing, no
 * community posting, no CRM mirroring. Custom is whatever an operator has switched on by hand,
 * which is most workspaces eventually.
 *
 * These live apart from the actions that apply them because a `"use server"` module may only
 * export async functions, and the console's pages need to *read* a preset to show which one a
 * workspace matches, and what applying one would change.
 */
export const ESSENTIALS_MODULES = [
  "today",
  "strategy",
  "calendar",
  "creative",
  "approvals",
  "publishing",
  "analytics",
  "chat",
  "runs",
  "connections",
  "admin",
] as const satisfies readonly ModuleKey[];

/**
 * What Essentials switches on inside those modules.
 *
 * Every one of these belongs to a module in the list above — `presetContents` enforces that, and
 * a test proves it. A feature whose module is off is not a setting, it is a hole: the page
 * disappears while an agent or a webhook carries on using it.
 */
export const ESSENTIALS_FEATURES = [
  "publishing.postiz",
  "creative.image",
  "chat",
  "agents.strategy",
  "agents.content",
] as const satisfies readonly FeatureKey[];

export type AccessPreset = "full" | "essentials" | "custom";

const sameSet = (have: ReadonlySet<string>, want: readonly string[]) =>
  have.size === want.length && want.every((k) => have.has(k));

/** Which preset a workspace's current switches match, or "custom". */
export function presetOf(
  modules: ReadonlySet<string>,
  features: ReadonlySet<string>,
  integrations: ReadonlySet<string>,
): AccessPreset {
  for (const name of ["full", "essentials"] as const) {
    const p = presetContents(name);
    if (sameSet(modules, p.modules) && sameSet(features, p.features) && sameSet(integrations, p.integrations)) {
      return name;
    }
  }
  return "custom";
}

/**
 * What a preset switches on.
 *
 * The features are filtered through the modules rather than simply listed, so the two lists
 * cannot drift apart: whatever anyone adds to `ESSENTIALS_FEATURES`, a feature of a module this
 * preset leaves off never ships switched on.
 */
export function presetContents(preset: "full" | "essentials"): {
  modules: ModuleKey[];
  features: FeatureKey[];
  integrations: string[];
} {
  const everyIntegration = INTEGRATIONS.map((i) => i.key);
  if (preset === "full") {
    return { modules: MODULES.map((m) => m.key), features: [...FEATURE_KEYS], integrations: everyIntegration };
  }
  const modules = [...ESSENTIALS_MODULES];
  // The accounts the modules in this preset actually work with, plus the ones no module claims
  // (the internal receivers). Giving a workspace an account for a module it does not have is
  // the same contradiction as a feature without its module.
  const claimed = new Set(Object.values(MODULE_INTEGRATIONS).flat());
  const wanted = new Set(modules.flatMap((m) => MODULE_INTEGRATIONS[m] ?? []));
  return {
    modules,
    features: ESSENTIALS_FEATURES.filter((f) => (modules as ModuleKey[]).includes(FEATURE_MODULE[f])),
    integrations: everyIntegration.filter((k) => wanted.has(k) || !claimed.has(k)),
  };
}

export interface PresetChange {
  turningOn: string[];
  turningOff: string[];
  unchanged: number;
}

/**
 * What applying a preset would do to this workspace, in the labels an operator reads.
 *
 * A preset is a whole configuration, not an addition: it sets every module and every feature,
 * so anything switched on by hand that the preset does not include goes off. That is defensible
 * behaviour and indefensible as a surprise, which is what this is for.
 */
export function presetChange(
  preset: "full" | "essentials",
  modules: ReadonlySet<string>,
  features: ReadonlySet<string>,
  integrations: ReadonlySet<string>,
): PresetChange {
  const want = presetContents(preset);
  const wantModules = new Set<string>(want.modules);
  const wantFeatures = new Set<string>(want.features);
  const wantIntegrations = new Set<string>(want.integrations);

  const turningOn: string[] = [];
  const turningOff: string[] = [];
  let unchanged = 0;

  for (const m of MODULES) {
    const now = modules.has(m.key);
    const next = wantModules.has(m.key);
    if (now === next) unchanged++;
    else (next ? turningOn : turningOff).push(m.label);
  }
  for (const f of FEATURE_KEYS) {
    const now = features.has(f);
    const next = wantFeatures.has(f);
    if (now === next) unchanged++;
    else (next ? turningOn : turningOff).push(FEATURE_LABELS[f]);
  }
  for (const i of INTEGRATIONS) {
    const now = integrations.has(i.key);
    const next = wantIntegrations.has(i.key);
    if (now === next) unchanged++;
    else (next ? turningOn : turningOff).push(i.name);
  }
  return { turningOn, turningOff, unchanged };
}

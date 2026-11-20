import "server-only";
import { entitlementsFor, featureAllowed, liveCapacity } from "@bodh/db";
import { capacity as capacityFrom, type CapacityKey, type Entitlements, type FeatureKey } from "@bodh/shared";

/** What the current tenant may use. */
export async function tenantEntitlements(tenantId: string): Promise<Entitlements> {
  return entitlementsFor(tenantId);
}

/** Whether a tenant has a feature. Used by actions and routes, not only by the UI. */
export async function featureEnabled(tenantId: string, key: FeatureKey): Promise<boolean> {
  return featureAllowed(await entitlementsFor(tenantId), key);
}

/** Throws when the tenant does not have the feature. Backend enforcement, not a UI hint. */
export async function requireFeature(tenantId: string, key: FeatureKey): Promise<void> {
  if (!(await featureEnabled(tenantId, key))) {
    throw new FeatureDisabled(key);
  }
}

/**
 * A capacity limit for this tenant. Reads live — never the cache — because these gate
 * spending, and a stale number here spends somebody's money.
 */
export async function tenantCapacity(tenantId: string, key: CapacityKey): Promise<number> {
  const live = await liveCapacity(tenantId, key);
  if (live !== null) return live;
  // Only the capacity fallbacks are wanted here; the empty sets say nothing about access.
  return capacityFrom({ modules: new Set(), features: new Set(), integrations: new Set(), capacities: new Map() }, key);
}

export class FeatureDisabled extends Error {
  constructor(public readonly feature: string) {
    super(`This is not switched on for your workspace.`);
    this.name = "FeatureDisabled";
  }
}

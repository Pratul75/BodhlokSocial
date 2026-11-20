/**
 * Reads what a tenant may use, from the control plane.
 *
 * Cached per tenant, with the tenant in the key — never in a bare module-level variable, which
 * is how one tenant's configuration leaks into another's request. The cache is short so a
 * Super Admin change takes effect without a deploy; anything that gates spending reads live.
 */
import {
  INTEGRATIONS,
  ALL_ENABLED,
  capacity,
  CAPACITY_KEYS,
  FEATURE_LABELS,
  hasFeature,
  isUnrestricted,
  NOTHING_ENABLED,
  type CapacityKey,
  type Entitlements,
  type FeatureKey,
  featureUsable,
  type ModuleKey,
  integrationAllowed,
} from "@bodh/shared";
import { currentTenant, ownerSql, SYNTHETIC_TENANT_ID } from "./client";

interface Row {
  kind: string;
  key: string;
  enabled: boolean;
  value: string | null;
}

const TTL_MS = Number(process.env.ENTITLEMENT_CACHE_MS ?? 30_000);
const cache = new Map<string, { at: number; value: Entitlements }>();

export function forgetEntitlements(tenantId?: string) {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

/** A tenant's entitlements, cached briefly. */
export async function entitlementsFor(tenantId: string): Promise<Entitlements> {
  // The DEFAULT_TENANT_SLUG fallback has no registry row: it is the single-tenant installation
  // running as it always did, with nothing switched off.
  if (tenantId === SYNTHETIC_TENANT_ID) return ALL_ENABLED;
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const rows = (await ownerSql()<Row[]>`
    select kind, key, enabled, value::text as value
    from platform.entitlements
    where tenant_id = ${tenantId}`) as unknown as Row[];

  const value = buildEntitlements(rows);
  cache.set(tenantId, { at: Date.now(), value });
  return value;
}

/** Reads a capacity without the cache, for anything that gates spending. */
export async function liveCapacity(tenantId: string, key: CapacityKey): Promise<number | null> {
  if (tenantId === SYNTHETIC_TENANT_ID) return null;
  const rows = (await ownerSql()<{ value: string | null }[]>`
    select value::text as value from platform.entitlements
    where tenant_id = ${tenantId} and kind = 'capacity' and key = ${key} and enabled = true`) as unknown as {
    value: string | null;
  }[];
  if (!rows.length) return null;
  const raw = rows[0]!.value;
  return raw === null ? null : Number(raw);
}

export function buildEntitlements(rows: Row[]): Entitlements {
  if (rows.length === 0) {
    // No rows means provisioning never finished, or someone deleted them. Refusing is the only
    // safe reading: the alternative is handing a half-made tenant the entire product. Every
    // tenant this code provisions gets explicit rows, so this is a broken state, not a legacy one.
    return NOTHING_ENABLED;
  }
  const modules = new Set<string>();
  const features = new Set<string>();
  const integrations = new Set<string>();
  const capacities = new Map<string, number | null>();
  let sawIntegrationRow = false;
  for (const r of rows) {
    if (r.kind === "module" && r.enabled) modules.add(r.key);
    else if (r.kind === "feature" && r.enabled) features.add(r.key);
    else if (r.kind === "integration") {
      sawIntegrationRow = true;
      if (r.enabled) integrations.add(r.key);
    } else if (r.kind === "capacity") capacities.set(r.key, r.value === null ? null : Number(r.value));
  }

  // A tenant with rows but none of a kind that did not exist when it was provisioned has not
  // been *refused* that kind — nobody was ever asked. Integrations arrived after workspaces
  // did, so a workspace from before them keeps every account until an operator decides
  // otherwise. Reading absence as refusal here would take twelve modules off a live
  // installation the moment this deployed, which is not a decision anyone made.
  //
  // This is narrow on purpose: no rows **at all** still means nothing, because that is a broken
  // tenant rather than an old one. It applies to a kind, not to a tenant.
  if (!sawIntegrationRow) {
    for (const k of INTEGRATIONS) integrations.add(k.key);
  }

  return { modules, features, integrations, capacities };
}

/** Module access, allowing for the unrestricted (pre-entitlement) case. */
export function moduleAllowed(ent: Entitlements, key: string): boolean {
  return isUnrestricted(ent) || ent.modules.has(key);
}

/** Feature access, allowing for the unrestricted case. */
export function featureAllowed(ent: Entitlements, key: FeatureKey): boolean {
  return hasFeature(ent, key);
}

export { CAPACITY_KEYS };

/**
 * The feature gate the whole product shares.
 *
 * It lives here, next to the tenant context, so that one call covers every way a capability can
 * be reached: a person pressing a button, an agent deciding to, or a scheduled job waking up.
 * Gating in the web action alone would leave the agent and the cron path wide open, which is
 * exactly what the Super Admin console promises is not the case.
 */
export async function currentEntitlements(): Promise<Entitlements> {
  return entitlementsFor(currentTenant().id);
}

/**
 * Whether this tenant has the capability — **and** the module it belongs to.
 *
 * Both, deliberately. A capability is part of a section of the product, so a module that is off
 * with one of its capabilities still on is not a configuration, it is the page gone from the
 * menu while the agent and the scheduled job carry on using it. Every caller of this — the
 * agents, the publisher, the ad writer, the site publisher — gets the module check for free.
 */
export async function tenantHasFeature(key: FeatureKey): Promise<boolean> {
  return featureUsable(await currentEntitlements(), key);
}

/** Whether this tenant has the module. The same question `allowed()` asks in the web layer. */
export async function tenantHasModule(key: ModuleKey): Promise<boolean> {
  return moduleAllowed(await currentEntitlements(), key);
}

/**
 * Whether this tenant may use an outside account at all.
 *
 * Asked wherever a credential is about to be read or written, so that a workspace which was
 * never given an integration cannot hold one — not through the console, not through OAuth, and
 * not through an agent that found a leftover secret.
 */
export async function tenantHasIntegration(key: string): Promise<boolean> {
  return integrationAllowed(await currentEntitlements(), key);
}

/** Refuses when this tenant does not have the capability. Throws: callers must not continue. */
export async function requireFeature(key: FeatureKey): Promise<void> {
  if (!(await tenantHasFeature(key))) throw new FeatureDisabled(key);
}

/** A capacity for this tenant, read live because these gate spending. */
export async function tenantCapacity(key: CapacityKey, env = process.env): Promise<number> {
  const tenant = currentTenant();
  const live = await liveCapacity(tenant.id, key);
  if (live !== null) return live;
  return capacity(await currentEntitlements(), key, env);
}

export class FeatureDisabled extends Error {
  constructor(public readonly feature: FeatureKey) {
    super(`${FEATURE_LABELS[feature]} is not switched on for this workspace.`);
    this.name = "FeatureDisabled";
  }
}

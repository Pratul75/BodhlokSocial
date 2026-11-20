import "server-only";
import { randomBytes } from "node:crypto";
import { currentTenant } from "@bodh/db";
import { secretName, secretStore } from "@/lib/secrets";

/**
 * The credentials a workspace's own public endpoints are guarded by.
 *
 * These two used to be single environment variables, which meant one secret for the whole
 * server: whoever held it could write events into, or read pages out of, every workspace on it.
 * They are now ordinary per-workspace secrets, stored under the workspace's own name in the same
 * place its Google and Meta credentials live, and resolved from the workspace the address named.
 *
 * Tenant #1 keeps the environment variable as a fallback, and only tenant #1: the live
 * installation's callers already hold that value, and nothing about them should have to change.
 * Every other workspace must have one generated before its endpoints answer at all.
 */
export const EVENTS_SECRET_KEY = "events_webhook";
export const FEED_TOKEN_KEY = "page_feed";

export type TenantSecretKey = typeof EVENTS_SECRET_KEY | typeof FEED_TOKEN_KEY;

const ENV_FALLBACK: Record<TenantSecretKey, string> = {
  [EVENTS_SECRET_KEY]: "BODH_EVENTS_SECRET",
  [FEED_TOKEN_KEY]: "SEO_FEED_TOKEN",
};

/** True for the workspace that was here before there were workspaces. */
const isFirstTenant = () => currentTenant().dataSchema === "public";

/** The stored value for the bound workspace, or tenant #1's environment fallback. */
export async function tenantSecret(key: TenantSecretKey): Promise<string | null> {
  const stored = (await (await secretStore()).get(secretName(key)))?.trim();
  if (stored) return stored;
  if (!isFirstTenant()) return null;
  return process.env[ENV_FALLBACK[key]]?.trim() || null;
}

/** Makes a new value for the bound workspace, replacing any it had. Returned once, to show once. */
export async function rotateTenantSecret(key: TenantSecretKey): Promise<string> {
  const value = randomBytes(32).toString("base64url");
  await (await secretStore()).put(secretName(key), value);
  return value;
}

/** Removes the workspace's own value; tenant #1 then falls back to the environment variable. */
export async function clearTenantSecret(key: TenantSecretKey): Promise<void> {
  await (await secretStore()).remove(secretName(key));
}

/** Whether the bound workspace has one, without handing the value to the caller. */
export async function hasTenantSecret(key: TenantSecretKey): Promise<boolean> {
  return (await tenantSecret(key)) !== null;
}

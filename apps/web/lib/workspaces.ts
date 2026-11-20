import "server-only";
import { tenantsForEmail, type TenantRef } from "@bodh/db";

/**
 * The workspaces this person may move to from where they are.
 *
 * Read from the control plane's directory — the addresses that can open a workspace — and
 * narrowed to the organization of the workspace they are in. One session, one organization:
 * somebody who works for two agencies signs out and back in to move between them, which is the
 * straight reading of "nothing should mix up" and cheaper to keep than to explain.
 *
 * Deliberately not exported from a `"use server"` file. Everything exported from one of those
 * is a public endpoint, and an endpoint that takes an address and answers "which workspaces can
 * this person open?" is a question nobody outside should be able to ask.
 */
export async function openableWorkspaces(email: string, from: TenantRef): Promise<TenantRef[]> {
  const all = await tenantsForEmail(email);
  return all.filter((t) => t.status === "active" && (t.orgId ?? null) === (from.orgId ?? null));
}

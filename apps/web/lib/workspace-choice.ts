import "server-only";
import { tenantById } from "@bodh/db";
import { verifyChoiceToken } from "./session";

/** A workspace somebody can pick, once a sign-in has opened more than one. */
export interface WorkspaceChoice {
  tenantId: string;
  name: string;
}

/**
 * The workspaces a paused sign-in may still choose between.
 *
 * The token is the whole of the list: it was signed minutes ago by a sign-in that had already
 * proved itself, and it names the workspaces that sign-in opened. Nothing here reads the
 * address or the directory, so this cannot offer a workspace the sign-in did not already reach.
 * Names are read now rather than carried in the token, so a renamed workspace reads correctly
 * and the token stays the only thing that has to be trusted.
 */
export async function choicesFromToken(token: string | undefined): Promise<WorkspaceChoice[]> {
  const claims = await verifyChoiceToken(token);
  if (!claims) return [];
  const out: WorkspaceChoice[] = [];
  for (const pair of claims.opened) {
    const tenant = await tenantById(pair.split(":")[0]!);
    // A workspace suspended or archived in the last five minutes drops off the list rather than
    // being offered and then refused.
    if (tenant && tenant.status === "active") out.push({ tenantId: tenant.id, name: tenant.name });
  }
  return out;
}

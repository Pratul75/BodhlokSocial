import "server-only";
import { redirect } from "next/navigation";
import { orgsRunBy, type OrgRef } from "@bodh/db";
import { enterTenantScope, getCurrentUser, type CurrentUser } from "./auth";

/**
 * Who may open the agency's own panel.
 *
 * Not a third kind of sign-in. An organization admin is an ordinary person with an ordinary
 * session; this only asks whether the control plane says they run the agency that the workspace
 * they are currently in belongs to. That second half matters: it keeps `/org` on the same rule
 * as everything else — one session, one agency — so somebody who runs two does not see both
 * at once and has to move deliberately between them.
 *
 * Read on every request rather than cached. Somebody who stops running an agency should stop on
 * their next click, not when something expires.
 */
export async function requireOrgAdmin(): Promise<{ user: CurrentUser; org: OrgRef }> {
  const user = enterTenantScope(await getCurrentUser());
  // An operator looking inside a workspace is not one of its people and is certainly not its
  // agency; a read-only look must not become a way into the agency's panel.
  if (user.impersonatedBy) redirect("/");
  const org = (await orgsRunBy(user.email)).find((o) => o.id === user.tenant.orgId);
  if (!org) redirect("/");
  return { user, org };
}

/** Whether to show the way in at all. Never the thing that decides access. */
export async function runsThisAgency(user: CurrentUser): Promise<OrgRef | null> {
  if (user.impersonatedBy) return null;
  return (await orgsRunBy(user.email)).find((o) => o.id === user.tenant.orgId) ?? null;
}

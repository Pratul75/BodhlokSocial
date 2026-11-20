"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auditLog, db, tenantById, users, withTenant } from "@bodh/db";
import { getCurrentUser } from "@/lib/auth";
import {
  cookieOptions,
  createSessionToken,
  SESSION_COOKIE,
  SESSION_DAYS,
  WORKSPACE_COOKIE,
  workspaceCookieOptions,
} from "@/lib/session";

export type SwitchResult = { error: string } | null;

/**
 * Moves this person to another workspace.
 *
 * A server action rather than a link on purpose. A link is a `GET`: a prefetch, a reload or an
 * old tab could fire it, and this changes who the person is for every request that follows.
 *
 * What makes it safe is not this function but what it produces — a new session cookie naming
 * the new workspace. Nothing afterwards has to remember that a switch happened, because every
 * request carries the answer; and anything that has to be remembered is the thing that
 * eventually forgets.
 */
export async function switchWorkspace(_prev: SwitchResult, formData: FormData): Promise<SwitchResult> {
  const user = await getCurrentUser();
  // An operator looking inside a workspace is bound through its read-only role and is not one
  // of its people. Letting that session walk into another workspace would turn a look into a
  // way in.
  if (user.impersonatedBy) return { error: "Close the look first; a session that is looking inside a workspace cannot move." };

  const targetId = String(formData.get("tenantId") ?? "").trim();
  if (targetId === user.tenant.id) redirect("/");

  const target = await tenantById(targetId);
  if (!target || target.status !== "active") return { error: "That workspace isn't available." };
  if ((target.orgId ?? null) !== (user.tenant.orgId ?? null)) {
    return { error: "That workspace belongs to another organization. Sign out and sign in to that one." };
  }

  // The row is the permission. Being listed in the directory is not the same as still having an
  // active account inside the workspace, and the row is what every later request is read from.
  const row = await withTenant(target, async () => {
    const [found] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, user.email), eq(users.active, true)))
      .limit(1);
    return found ?? null;
  });
  if (!row) return { error: "You don't have an account in that workspace any more." };

  const jar = await cookies();
  jar.set(
    SESSION_COOKIE,
    await createSessionToken({ sub: row.id, email: row.email, sv: row.sessionVersion, tid: target.id }),
    cookieOptions(SESSION_DAYS * 86400),
  );
  jar.set(WORKSPACE_COOKIE, target.id, workspaceCookieOptions(SESSION_DAYS * 86400));

  await withTenant(target, () =>
    db.insert(auditLog).values({
      actor: row.email,
      actorType: "user",
      action: "switch_workspace",
      target: "app",
      result: `from ${user.tenant.slug}`,
    }),
  );

  // Not back to the same path: the module that page belongs to may be off here, or this
  // person's role here may not reach it. Today is the one page everybody has.
  redirect("/");
}

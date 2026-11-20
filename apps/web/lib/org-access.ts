import "server-only";
import { and, eq } from "drizzle-orm";
import {
  db,
  listOrgAdmins,
  noteUserInDirectory,
  setAccessLevel,
  users,
  withTenant,
  type AccessLevel,
  type OrgRef,
  type TenantRef,
} from "@bodh/db";

export interface AccessChange {
  level: AccessLevel;
  /** How many of the agency's people gained or lost an account inside the client. */
  changed: number;
  message: string;
}

/**
 * Sets how far an agency reaches into one of its clients, and makes it true.
 *
 * The row that records the level is not what enforces it. `full` means the agency's people
 * have real accounts in that client's own `users` table; `manage` and `none` mean they do not.
 * That is the difference between a rule the application has to remember to check — which opens
 * quietly the first time somebody forgets — and a fact the database, the client's own People
 * page and every existing permission check can all see.
 *
 * `none` differs from `manage` only in the agency's panel, where the client is not listed at
 * all. Neither reaches inside.
 */
export async function applyAccessLevel(
  org: OrgRef,
  tenant: TenantRef,
  level: AccessLevel,
  actor: string,
): Promise<AccessChange> {
  const admins = await listOrgAdmins(org.id);
  let changed = 0;

  for (const admin of admins) {
    if (level === "full") {
      const existing = await withTenant(tenant, async () => {
        const [row] = await db.select().from(users).where(eq(users.email, admin.email)).limit(1);
        return row ?? null;
      });
      if (existing?.active) continue;
      if (existing) {
        await withTenant(tenant, () => db.update(users).set({ active: true }).where(eq(users.id, existing.id)));
      } else {
        await withTenant(tenant, () =>
          db
            .insert(users)
            .values({ email: admin.email, name: admin.email.split("@")[0]!, role: "admin" })
            .onConflictDoNothing(),
        );
      }
      await noteUserInDirectory(tenant.id, admin.email, true);
      changed++;
    } else {
      const [row] = await withTenant(tenant, () =>
        db
          .update(users)
          .set({ active: false })
          .where(and(eq(users.email, admin.email), eq(users.active, true)))
          .returning({ id: users.id }),
      );
      await noteUserInDirectory(tenant.id, admin.email, false);
      if (row) changed++;
    }
  }

  await setAccessLevel(org.id, tenant.id, level, actor);

  const who = `${changed} of ${org.name}'s ${admins.length} ${admins.length === 1 ? "person" : "people"}`;
  if (level === "full") {
    return { level, changed, message: `${org.name} works inside ${tenant.name} as its admin. ${who} gained an account there.` };
  }
  const tail = level === "none" ? ` ${tenant.name} is hidden from their panel.` : "";
  return {
    level,
    changed,
    message: `${org.name} can no longer open ${tenant.name}; it sees counts and totals only. ${who} lost their account there.${tail}`,
  };
}

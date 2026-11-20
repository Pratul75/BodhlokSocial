import "server-only";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, listOrgAdmins, noteUserInDirectory, provisionTenant, uniqueSlug, users, withTenant } from "@bodh/db";
import { issueUserInvite, setTemporaryPassword } from "@/lib/user-passwords";
import { platformAudit } from "@/lib/platform-auth";
import type { SecretResult } from "@/app/(platform)/super-admin/actions";

/** A temporary password is for one thing: the page where it is replaced. */
const TEMP_PASSWORD_HOURS = 72;

/**
 * Builds a workspace and lets its first admin in — the part `createTenant` and
 * `createOrganization` both need.
 *
 * One place on purpose: an agency's own workspace, a client made by Super Admin and a client
 * made by the agency itself are the same kind of thing, made the same way. The day they stop
 * being made the same way is the day one of them quietly misses a step.
 */
export async function buildWorkspace(opts: {
  org: { id: string; name: string };
  name: string;
  adminEmail: string;
  adminPhone: string | null;
  adminPassword: string;
  actor: string;
  // `SecretResult` allows null for a form that has not been submitted yet; this always answers.
}): Promise<Exclude<SecretResult, null>> {
  // Worked out, never typed: the short name is the schema name, and a schema cannot be renamed.
  const slug = await uniqueSlug(opts.name);
  try {
    const result = await provisionTenant({
      slug,
      name: opts.name,
      adminEmail: opts.adminEmail,
      orgId: opts.org.id,
      actor: opts.actor,
    });
    const made = `Created ${result.tenant.name} (${result.tenant.slug}) in ${opts.org.name}: ${result.tables} tables, everything switched on.`;
    revalidatePath("/super-admin");
    revalidatePath("/super-admin/orgs");
    revalidatePath("/super-admin/workspaces");

    // Everybody who runs this agency gets an account in its new workspace as well. An agency
    // that cannot open the client it just made would have to ask somebody else to let it in,
    // and the account is deliberately a visible row on that workspace's own People page rather
    // than an invisible rule: if the agency can reach a client, the client can see who.
    for (const admin of await listOrgAdmins(opts.org.id)) {
      if (admin.email === opts.adminEmail) continue;
      await withTenant(result.tenant, () =>
        db
          .insert(users)
          .values({ email: admin.email, name: admin.email.split("@")[0]!, role: "admin" })
          .onConflictDoNothing(),
      );
      await noteUserInDirectory(result.tenant.id, admin.email, true);
    }

    // The first admin, from inside the workspace that was just built for them.
    const [admin] = await withTenant(result.tenant, () =>
      db.select({ id: users.id }).from(users).where(eq(users.email, opts.adminEmail)).limit(1),
    );
    if (admin && opts.adminPhone) {
      await withTenant(result.tenant, () =>
        db.update(users).set({ phone: opts.adminPhone }).where(eq(users.id, admin.id)),
      );
    }
    if (!admin) return { ok: true, message: `${made} Set their password from the Users tab.` };

    // A password the operator chose: handed over with the address, and good for one thing —
    // the page where they replace it.
    if (opts.adminPassword) {
      await setTemporaryPassword(result.tenant, admin.id, opts.adminPassword, TEMP_PASSWORD_HOURS);
      await platformAudit({
        actor: opts.actor,
        action: "set_temporary_password",
        target: opts.adminEmail,
        tenantId: result.tenant.id,
      });
      return {
        ok: true,
        message: `${made} Give ${opts.adminEmail} the password you chose — they sign in with it and set their own. It stops working after ${TEMP_PASSWORD_HOURS} hours.`,
      };
    }

    const invite = await issueUserInvite(result.tenant, admin.id, 72);
    if (!invite) return { ok: true, message: `${made} Set their password from the Users tab.` };
    await platformAudit({
      actor: opts.actor,
      action: "issue_password_link",
      target: opts.adminEmail,
      tenantId: result.tenant.id,
    });
    return {
      ok: true,
      message: `${made} A one-time link for ${opts.adminEmail} to set their password, good for 72 hours — copy it now; it isn't shown again.`,
      value: `/set-password?token=${invite.token}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create that workspace." };
  }
}


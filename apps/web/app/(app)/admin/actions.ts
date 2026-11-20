"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { budgets, db, isTenantSettingKey, noteUserInDirectory, setTenantSetting, TENANT_SETTING_LABELS, users } from "@bodh/db";
import { isRole } from "@bodh/shared";
import { allowed, enterTenantScope, getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { inr } from "@/lib/format";
import { allowedDomains } from "@/lib/google";
import { tenantPrefix } from "@/lib/tenant";
import { clearUserPassword, issueUserInvite } from "@/lib/user-passwords";

export type AdminResult = { ok: true; message: string } | { ok: false; error: string } | null;
/** The same, for the actions that hand back something to copy once — a one-time link. */
export type AdminLinkResult = { ok: true; message: string; value?: string } | { ok: false; error: string } | null;

/** How long a password link lasts. Long enough to reach someone by hand, short enough to expire. */
const INVITE_HOURS = 72;

async function admin() {
  const u = await getCurrentUser();
  // Role and plan, not role alone: a workspace whose Admin module is off has no user management.
  if (!allowed(u, "admin")) throw new Error("Only admins can do this.");
  return u;
}

/** Admins left after taking `id` away from the role (or the app); never zero. */
async function wouldLeaveNoAdmin(id: string): Promise<boolean> {
  const admins = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.active, true)));
  return admins.length <= 1 && admins.some((a) => a.id === id);
}

export async function setRole(_prev: AdminResult, formData: FormData): Promise<AdminResult> {
  try {
    const u = enterTenantScope(await admin());
    const id = String(formData.get("id"));
    const role = formData.get("role");
    if (!isRole(role)) return { ok: false, error: "Pick a role." };
    if (id === u.id && role !== "admin") return { ok: false, error: "You can't change your own role. Ask another admin." };
    if (role !== "admin" && (await wouldLeaveNoAdmin(id))) return { ok: false, error: "That would leave no admin. Make someone else an admin first." };
    const [row] = await db.update(users).set({ role }).where(eq(users.id, id)).returning();
    if (!row) return { ok: false, error: "That person no longer exists." };
    await audit({ actor: u.email, actorType: "user", action: "set_role", target: row.email, result: role });
    revalidatePath("/admin");
    return { ok: true, message: "Role saved." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't change the role." };
  }
}

export async function addUser(_prev: AdminResult, formData: FormData): Promise<AdminResult> {
  try {
    const u = enterTenantScope(await admin());
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const name = String(formData.get("name") ?? "").trim();
    const role = formData.get("role");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That isn't an email address." };
    const company = (await allowedDomains()).includes(email.split("@")[1] ?? "");
    if (!name) return { ok: false, error: "Add the person's name." };
    if (!isRole(role)) return { ok: false, error: "Pick a role." };
    const existing = await db.select().from(users).where(eq(users.email, email));
    if (existing.length) return { ok: false, error: `${email} already has access.` };
    await db.insert(users).values({ email, name, role });
    // Sign-in reads the control plane to find which workspace an address belongs to, before any
    // tenant is bound, so a person added here has to appear there too.
    await noteUserInDirectory(u.tenant.id, email, true);
    await audit({ actor: u.email, actorType: "user", action: "add_user", target: email, result: role });
    revalidatePath("/admin");
    return {
      ok: true,
      message: company
        ? `${name} can now sign in.`
        : `${name} can now sign in with the Google account for ${email}. If that address isn't Gmail, they need a Google account made with it.`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't add the user." };
  }
}

export async function setCaps(_prev: AdminResult, formData: FormData): Promise<AdminResult> {
  try {
    const u = enterTenantScope(await admin());
    const platform = String(formData.get("platform"));
    const dailyCap = Number(formData.get("dailyCap"));
    const monthlyCap = Number(formData.get("monthlyCap"));
    if (!Number.isInteger(dailyCap) || dailyCap < 0) return { ok: false, error: "Daily cap must be a whole number of rupees." };
    if (!Number.isInteger(monthlyCap) || monthlyCap < dailyCap) return { ok: false, error: "Monthly cap must be at least the daily cap." };
    const [row] = await db
      .update(budgets)
      .set({ dailyCap, monthlyCap, updatedBy: u.email, updatedAt: new Date() })
      .where(eq(budgets.platform, platform))
      .returning();
    if (!row) return { ok: false, error: "Unknown platform." };
    await audit({ actor: u.email, actorType: "user", action: "set_budget_cap", target: platform, result: `daily ${inr(dailyCap)} / monthly ${inr(monthlyCap)}` });
    revalidatePath("/admin");
    revalidatePath("/ads");
    return { ok: true, message: "Caps saved. Agents can't change them." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save caps." };
  }
}

export async function setActive(_prev: AdminResult, formData: FormData): Promise<AdminResult> {
  try {
    const u = enterTenantScope(await admin());
    const id = String(formData.get("id"));
    const active = formData.get("active") === "true";
    if (id === u.id) return { ok: false, error: "You can't remove your own access." };
    if (!active && (await wouldLeaveNoAdmin(id))) return { ok: false, error: "That would leave no admin." };
    // Removing access also ends every session at once, not only at the next page load.
    const [row] = await db
      .update(users)
      .set(active ? { active } : { active, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, id))
      .returning();
    if (!row) return { ok: false, error: "That person no longer exists." };
    await noteUserInDirectory(u.tenant.id, row.email, active);
    await audit({ actor: u.email, actorType: "user", action: active ? "restore_access" : "remove_access", target: row.email, result: active ? "active" : "removed" });
    revalidatePath("/admin");
    return { ok: true, message: active ? "Access restored." : "Access removed. They are signed out on their next click." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't change access." };
  }
}

/**
 * Saves one of this workspace's own configuration values — its GA4 property, its Google Ads
 * account, its website, who may sign in. These were server-wide environment variables, which
 * is correct for one customer and wrong for several: every workspace would have measured the
 * first one's website and let the first one's staff in.
 */
export async function saveWorkspaceSetting(_prev: AdminResult, formData: FormData): Promise<AdminResult> {
  try {
    const u = enterTenantScope(await admin());
    const key = String(formData.get("key") ?? "");
    if (!isTenantSettingKey(key)) return { ok: false, error: "Unknown setting." };
    const raw = String(formData.get("value") ?? "").trim();
    if (raw.length > 500) return { ok: false, error: "That value is too long." };
    if (key === "google_ads.conversion_actions" && raw) {
      try {
        JSON.parse(raw);
      } catch {
        return { ok: false, error: 'Conversion actions must be JSON, like {"registration":"123"}.' };
      }
    }
    await setTenantSetting(u.tenant.id, key, raw || null, u.email);
    await audit({ actor: u.email, actorType: "user", action: "set_workspace_setting", target: key, result: raw ? "set" : "cleared" });
    revalidatePath("/admin");
    return { ok: true, message: raw ? `${TENANT_SETTING_LABELS[key]} saved.` : `${TENANT_SETTING_LABELS[key]} cleared.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save that setting." };
  }
}

/**
 * A one-time link for somebody to set their own password.
 *
 * Google sign-in needs nothing from an admin: the account already exists. A password does, and
 * there is no mail service here, so the admin is shown the link once and hands it over. Only
 * the link's hash is stored, and spending it raises that person's session version.
 */
export async function issueSignInLink(_prev: AdminLinkResult, formData: FormData): Promise<AdminLinkResult> {
  try {
    const u = enterTenantScope(await admin());
    const id = String(formData.get("id") ?? "");
    const [person] = await db.select().from(users).where(and(eq(users.id, id), eq(users.active, true)));
    if (!person) return { ok: false, error: "That person no longer has access." };

    const invite = await issueUserInvite(u.tenant, id, INVITE_HOURS);
    if (!invite) return { ok: false, error: "Couldn't make a link for that person." };

    await audit({
      actor: u.email,
      actorType: "user",
      action: person.passwordHash ? "issue_password_reset" : "issue_password_invite",
      target: person.email,
      result: `${INVITE_HOURS}h`,
    });
    revalidatePath("/admin");
    return {
      ok: true,
      message: `A one-time link for ${person.email}, good for ${INVITE_HOURS} hours. Copy it now; it isn't shown again.`,
      value: `${await tenantPrefix()}/set-password?token=${invite.token}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't make the link." };
  }
}

/** Takes a password away again, leaving Google as that person's only way in. */
export async function removeUserPassword(_prev: AdminResult, formData: FormData): Promise<AdminResult> {
  try {
    const u = enterTenantScope(await admin());
    const id = String(formData.get("id") ?? "");
    // In a workspace that signs in with passwords alone, removing your own is removing your own
    // way back in. The same reason you cannot take away your own access or your own admin role.
    if (id === u.id) return { ok: false, error: "You can't remove your own password. Ask another admin." };
    const email = await clearUserPassword(u.tenant, id);
    if (!email) return { ok: false, error: "That person no longer exists." };
    await audit({ actor: u.email, actorType: "user", action: "remove_password", target: email, result: "cleared" });
    revalidatePath("/admin");
    return { ok: true, message: "Password removed. They're signed out, and sign in with Google from now on." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't remove the password." };
  }
}

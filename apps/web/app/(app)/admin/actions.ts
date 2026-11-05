"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { budgets, db, users } from "@bodh/db";
import { isRole } from "@bodh/shared";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { inr } from "@/lib/format";
import { allowedDomains } from "@/lib/google";

export type AdminResult = { ok: true; message: string } | { ok: false; error: string } | null;

async function admin() {
  const u = await getCurrentUser();
  if (u.role !== "admin") throw new Error("Only admins can do this.");
  return u;
}

/** Admins left after taking `id` away from the role (or the app); never zero. */
async function wouldLeaveNoAdmin(id: string): Promise<boolean> {
  const admins = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.active, true)));
  return admins.length <= 1 && admins.some((a) => a.id === id);
}

export async function setRole(_prev: AdminResult, formData: FormData): Promise<AdminResult> {
  try {
    const u = await admin();
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
    const u = await admin();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const name = String(formData.get("name") ?? "").trim();
    const role = formData.get("role");
    const domains = allowedDomains();
    if (!domains.includes(email.split("@")[1] ?? "")) {
      return { ok: false, error: `Use an ${domains.map((d) => `@${d}`).join(" or ")} address. Only those domains can sign in.` };
    }
    if (!name) return { ok: false, error: "Add the person's name." };
    if (!isRole(role)) return { ok: false, error: "Pick a role." };
    const existing = await db.select().from(users).where(eq(users.email, email));
    if (existing.length) return { ok: false, error: `${email} already has access.` };
    await db.insert(users).values({ email, name, role });
    await audit({ actor: u.email, actorType: "user", action: "add_user", target: email, result: role });
    revalidatePath("/admin");
    return { ok: true, message: `${name} can now sign in.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't add the user." };
  }
}

export async function setCaps(_prev: AdminResult, formData: FormData): Promise<AdminResult> {
  try {
    const u = await admin();
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
    const u = await admin();
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
    await audit({ actor: u.email, actorType: "user", action: active ? "restore_access" : "remove_access", target: row.email, result: active ? "active" : "removed" });
    revalidatePath("/admin");
    return { ok: true, message: active ? "Access restored." : "Access removed. They are signed out on their next click." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't change access." };
  }
}

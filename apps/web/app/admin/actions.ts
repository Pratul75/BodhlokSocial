"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { budgets, db, users } from "@bodh/db";
import { isRole } from "@bodh/shared";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { inr } from "@/lib/format";

export type AdminResult = { ok: true; message: string } | { ok: false; error: string } | null;

async function admin() {
  const u = await getCurrentUser();
  if (u.role !== "admin") throw new Error("Only admins can do this.");
  return u;
}

export async function setRole(formData: FormData) {
  const u = await admin();
  const id = String(formData.get("id"));
  const role = formData.get("role");
  if (!isRole(role)) return;
  if (id === u.id && role !== "admin") return; // don't lock yourself out
  const [row] = await db.update(users).set({ role }).where(eq(users.id, id)).returning();
  if (row) await audit({ actor: u.email, actorType: "user", action: "set_role", target: row.email, result: role });
  revalidatePath("/admin");
}

export async function addUser(_prev: AdminResult, formData: FormData): Promise<AdminResult> {
  try {
    const u = await admin();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const name = String(formData.get("name") ?? "").trim();
    const role = formData.get("role");
    const domain = process.env.ALLOWED_EMAIL_DOMAIN ?? "rechargestudio.com";
    if (!email.endsWith(`@${domain}`)) return { ok: false, error: `Use an @${domain} address. Only that domain can sign in.` };
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

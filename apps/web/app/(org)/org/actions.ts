"use server";

import { revalidatePath } from "next/cache";
import { passwordProblem } from "@/lib/passwords";
import { addOrgAdmin, listOrgAdmins, removeOrgAdmin, roomForAnotherWorkspace } from "@bodh/db";
import { requireOrgAdmin } from "@/lib/org-auth";
import { buildWorkspace } from "@/lib/provision";
import { grantAgencyAdminAccounts } from "@/lib/org-access";
import { platformAudit } from "@/lib/platform-auth";
import type { SecretResult } from "@/app/(platform)/super-admin/actions";

/** A mobile number as it will be stored, or null when what was typed is not one. */
function normalisePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const cleaned = trimmed.replace(/[\s()-]/g, "");
  return /^\+?\d{6,15}$/.test(cleaned) ? cleaned : null;
}

/**
 * An agency makes a client of its own.
 *
 * The same path Super Admin's own form takes — one function builds every workspace — with one
 * thing settled before it starts: the agency the client is being made in is the one this person
 * runs, read from the control plane, never from the form. There is no field for it, so there is
 * nothing to tamper with.
 */
export async function createClientWorkspace(_prev: SecretResult, formData: FormData): Promise<SecretResult> {
  const { user, org } = await requireOrgAdmin();

  // The ceiling first, before anything is built: a workspace half-made and then refused is
  // worse than one that was never started.
  const room = await roomForAnotherWorkspace(org.id);
  if (!room.ok) return { ok: false, error: room.reason };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Give the client a name." };
  if (name.length > 80) return { ok: false, error: "That name is too long." };

  const adminEmail = String(formData.get("adminEmail") ?? "").trim().toLowerCase();
  const adminPhone = normalisePhone(String(formData.get("adminPhone") ?? ""));
  const adminPassword = String(formData.get("adminPassword") ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) return { ok: false, error: "That isn't an email address." };
  if (adminPhone === null) return { ok: false, error: "That mobile number doesn't look right. Digits, and a + if it has a country code." };
  if (adminPassword) {
    const problem = passwordProblem(adminPassword);
    if (problem) return { ok: false, error: problem };
  }

  const built = await buildWorkspace({
    org,
    name,
    adminEmail,
    adminPhone,
    adminPassword,
    actor: user.email,
  });
  revalidatePath("/org");
  revalidatePath("/org/clients");
  return built;
}

/**
 * The agency adds somebody who runs it.
 *
 * Super Admin can do this from the platform console; so can the agency, because who works at an
 * agency is not the platform's business. What it is not is a way to widen the agency's reach:
 * the new person gets an account in exactly the clients the agency already fully reaches, and
 * in none of the others.
 */
export async function addAgencyAdmin(_prev: SecretResult, formData: FormData): Promise<SecretResult> {
  const { user, org } = await requireOrgAdmin();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That isn't an email address." };

  const already = await listOrgAdmins(org.id);
  if (already.some((a) => a.email === email)) return { ok: false, error: `${email} already runs ${org.name}.` };

  await addOrgAdmin(org.id, email, user.email);
  const grant = await grantAgencyAdminAccounts(org, email);
  // Written after the accounts, and whatever happened to them: the trail has to show the
  // addition even when part of it did not land.
  await platformAudit({
    actor: user.email,
    action: "add_org_admin",
    target: org.slug,
    detail: { email, granted: grant.granted, failed: grant.failed.join(", ") || null },
  });
  revalidatePath("/org/team");
  revalidatePath("/org");
  revalidatePath("/org/audit");

  const where = `${grant.granted} ${grant.granted === 1 ? "workspace" : "workspaces"}`;
  const trouble = grant.failed.length ? ` ${grant.failed.join(", ")} could not be reached — try again once it is readable.` : "";
  return {
    ok: true,
    message: `${email} runs ${org.name}, with an admin account in ${where}.${trouble} If they have never signed in here before, send them a password link from that workspace's People tab.`,
  };
}

/**
 * The agency takes somebody off.
 *
 * Their accounts in the workspaces are left exactly as they are, which is the same rule the
 * platform console follows: they stop running the agency, they do not stop being whoever they
 * are inside a workspace. Those are two decisions, and taking both at once would hide one of
 * them — worse, it would guess, because nothing records whether an account exists because the
 * agency reached in or because that person simply works there.
 *
 * So the message says where they still have one, and every one of those workspaces has a People
 * tab in this panel.
 */
export async function removeAgencyAdmin(_prev: SecretResult, formData: FormData): Promise<SecretResult> {
  const { user, org } = await requireOrgAdmin();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (email === user.email.trim().toLowerCase()) return { ok: false, error: "You can't take yourself off the agency." };

  const already = await listOrgAdmins(org.id);
  if (!already.some((a) => a.email === email)) return { ok: false, error: `${email} doesn't run ${org.name}.` };
  if (already.length <= 1) return { ok: false, error: "Somebody has to run the agency." };

  await removeOrgAdmin(org.id, email);
  await platformAudit({ actor: user.email, action: "remove_org_admin", target: org.slug, detail: { email } });
  revalidatePath("/org/team");
  revalidatePath("/org");
  revalidatePath("/org/audit");
  return {
    ok: true,
    message: `${email} no longer runs ${org.name} and this panel is closed to them. Any account they hold inside a workspace is unchanged — take those away on that workspace's People tab.`,
  };
}

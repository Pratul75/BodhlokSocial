"use server";

import { revalidatePath } from "next/cache";
import { passwordProblem } from "@/lib/passwords";
import { requireOrgAdmin } from "@/lib/org-auth";
import { buildWorkspace } from "@/lib/provision";
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
  return built;
}

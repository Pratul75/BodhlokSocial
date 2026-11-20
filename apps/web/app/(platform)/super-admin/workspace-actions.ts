"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql as dsql } from "drizzle-orm";
import {
  db,
  entitlementsFor,
  forgetEntitlements,
  forgetTenantSettings,
  forgetTenants,
  isTenantSettingKey,
  noteUserInDirectory,
  orgById,
  orgLimits,
  ownerSql,
  setTenantSetting,
  tenantById,
  users,
  withTenant,
  workspacesOf,
  type TenantRef,
} from "@bodh/db";
import { CAPACITY_KEYS, capacity, FEATURE_KEYS, INTEGRATIONS, isRole, MODULES, type CapacityKey } from "@bodh/shared";
import { presetContents } from "./access-presets";
import { platformAudit, requireOperator, requireOwner } from "@/lib/platform-auth";
import { clearUserPassword, issueUserInvite } from "@/lib/user-passwords";

export type WorkspaceResult = { ok: true; message: string } | { ok: false; error: string } | null;
/** The same, for an action that hands back something to copy once. */
export type WorkspaceLinkResult = { ok: true; message: string; value?: string } | { ok: false; error: string } | null;

/** How long a password link lasts, in hours. */
const INVITE_HOURS = 72;

/** The workspace an action is about, bound read-write. Refuses anything not active. */
async function writable(tenantId: string): Promise<TenantRef> {
  const tenant = await tenantById(tenantId);
  if (!tenant) throw new Error("No such workspace.");
  if (tenant.status !== "active") throw new Error(`That workspace is ${tenant.status}.`);
  return tenant;
}

/* -------------------------------------------------------------------------- */
/* People                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Adds somebody to a workspace from the console.
 *
 * This is an invitation in the only sense this product has one: people sign in with Google, so
 * there is no password to set and nothing to send. Being in the workspace's `users` table and in
 * the control plane's directory is what lets them in.
 */
export async function inviteWorkspaceUser(_prev: WorkspaceResult, formData: FormData): Promise<WorkspaceResult> {
  const op = await requireOperator();
  const tenantId = String(formData.get("tenantId") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That isn't an email address." };
  if (!name) return { ok: false, error: "Add the person's name." };
  if (!isRole(role)) return { ok: false, error: "Pick a role." };

  try {
    const tenant = await writable(tenantId);
    const existing = await withTenant(tenant, () => db.select().from(users).where(eq(users.email, email)));
    if (existing.length) return { ok: false, error: `${email} is already in this workspace.` };
    await withTenant(tenant, () => db.insert(users).values({ email, name, role }));
    await noteUserInDirectory(tenantId, email, true);
    await platformAudit({ actor: op.email, action: "invite_user", target: email, tenantId, detail: { role } });
    revalidatePath(`/super-admin/workspaces/${tenantId}/users`);
    return { ok: true, message: `${name} can sign in to ${tenant.name} with the Google account for ${email}.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add that person." };
  }
}

/**
 * Issues a one-time link for somebody in a workspace to set their own password.
 *
 * Owner-only, and not something impersonation can reach: a link like this is a way into a
 * customer's workspace as one of their own admins, so it is the narrowest door the console has.
 * Every issue is written to the platform audit log against the workspace it was for.
 */
export async function issueWorkspacePasswordLink(
  _prev: WorkspaceLinkResult,
  formData: FormData,
): Promise<WorkspaceLinkResult> {
  const op = await requireOwner();
  const tenantId = String(formData.get("tenantId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  try {
    const tenant = await writable(tenantId);
    const invite = await issueUserInvite(tenant, userId, INVITE_HOURS);
    if (!invite) return { ok: false, error: "That person no longer has access to this workspace." };
    await platformAudit({ actor: op.email, action: "issue_password_link", target: invite.email, tenantId });
    revalidatePath(`/super-admin/workspaces/${tenantId}/users`);
    return {
      ok: true,
      message: `A one-time link for ${invite.email} in ${tenant.name}, good for ${INVITE_HOURS} hours. Copy it now; it isn't shown again.`,
      value: `/t/${tenant.slug}/set-password?token=${invite.token}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not make that link." };
  }
}

/** Takes somebody's password away again, leaving Google as their only way in. */
export async function clearWorkspacePassword(_prev: WorkspaceResult, formData: FormData): Promise<WorkspaceResult> {
  const op = await requireOwner();
  const tenantId = String(formData.get("tenantId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  try {
    const tenant = await writable(tenantId);
    const email = await clearUserPassword(tenant, userId);
    if (!email) return { ok: false, error: "That person no longer exists." };
    await platformAudit({ actor: op.email, action: "clear_password", target: email, tenantId });
    revalidatePath(`/super-admin/workspaces/${tenantId}/users`);
    return { ok: true, message: `${email} is signed out and signs in with Google from now on.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not remove that password." };
  }
}

/** Changes somebody's role inside a workspace. */
export async function setWorkspaceUserRole(_prev: WorkspaceResult, formData: FormData): Promise<WorkspaceResult> {
  const op = await requireOperator();
  const tenantId = String(formData.get("tenantId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!isRole(role)) return { ok: false, error: "Unknown role." };

  try {
    const tenant = await writable(tenantId);
    const [row] = await withTenant(tenant, () =>
      db.update(users).set({ role }).where(eq(users.id, userId)).returning({ email: users.email }),
    );
    if (!row) return { ok: false, error: "That person is no longer in this workspace." };
    await platformAudit({ actor: op.email, action: "set_user_role", target: row.email, tenantId, detail: { role } });
    revalidatePath(`/super-admin/workspaces/${tenantId}/users`);
    return { ok: true, message: `${row.email} is now ${role.replace(/_/g, " ")}.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not change that role." };
  }
}

/**
 * Turns somebody's access on or off. Removing it also raises their session version, so they are
 * signed out everywhere rather than on their next page load.
 */
export async function setWorkspaceUserActive(_prev: WorkspaceResult, formData: FormData): Promise<WorkspaceResult> {
  const op = await requireOperator();
  const tenantId = String(formData.get("tenantId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const active = String(formData.get("active") ?? "") === "true";

  try {
    const tenant = await writable(tenantId);
    const result = await withTenant(tenant, async () => {
      if (!active) {
        const admins = await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.role, "admin"), eq(users.active, true)));
        if (admins.length <= 1 && admins.some((a) => a.id === userId)) return null;
      }
      const [row] = await db
        .update(users)
        .set(active ? { active } : { active, sessionVersion: dsql`${users.sessionVersion} + 1` })
        .where(eq(users.id, userId))
        .returning({ email: users.email });
      return row ?? null;
    });
    if (!result) return { ok: false, error: "That would leave the workspace with no admin." };
    await noteUserInDirectory(tenantId, result.email, active);
    await platformAudit({
      actor: op.email,
      action: active ? "restore_user" : "remove_user",
      target: result.email,
      tenantId,
    });
    revalidatePath(`/super-admin/workspaces/${tenantId}/users`);
    return { ok: true, message: active ? `${result.email} can sign in again.` : `${result.email} is signed out and locked out.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not change that access." };
  }
}

/* -------------------------------------------------------------------------- */
/* Access presets                                                             */
/* -------------------------------------------------------------------------- */

export async function applyAccessPreset(_prev: WorkspaceResult, formData: FormData): Promise<WorkspaceResult> {
  const op = await requireOwner();
  const tenantId = String(formData.get("tenantId") ?? "");
  const preset = String(formData.get("preset") ?? "");
  if (preset !== "full" && preset !== "essentials") return { ok: false, error: "Pick Full or Essentials." };

  const { modules, features, integrations } = presetContents(preset);

  const sql = ownerSql();
  const rows: { kind: string; key: string; enabled: boolean }[] = [
    ...MODULES.map((m) => ({ kind: "module", key: m.key, enabled: modules.includes(m.key) })),
    ...FEATURE_KEYS.map((f) => ({ kind: "feature", key: f, enabled: features.includes(f) })),
    ...INTEGRATIONS.map((i) => ({ kind: "integration", key: i.key, enabled: integrations.includes(i.key) })),
  ];
  await sql.begin(async (tx) => {
    for (const r of rows) {
      await tx`
        insert into platform.entitlements (tenant_id, kind, key, enabled, updated_by)
        values (${tenantId}, ${r.kind}, ${r.key}, ${r.enabled}, ${op.email})
        on conflict (tenant_id, kind, key) do update
        set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now()`;
    }
  });
  forgetEntitlements(tenantId);
  await platformAudit({ actor: op.email, action: "apply_access_preset", target: preset, tenantId });
  revalidatePath(`/super-admin/workspaces/${tenantId}/modules`);
  revalidatePath(`/super-admin/workspaces/${tenantId}/features`);
  revalidatePath(`/super-admin/workspaces/${tenantId}/integrations`);
  return { ok: true, message: `${preset === "full" ? "Full" : "Essentials"} access applied.` };
}

/* -------------------------------------------------------------------------- */
/* Capacities and settings                                                    */
/* -------------------------------------------------------------------------- */

/** A number a workspace may not exceed: AI budget, images a month, audit pages. */

/**
 * Whether giving this workspace that monthly AI budget would put its agency over the total it
 * was sold. Returns the refusal, or null when there is room.
 *
 * Every other workspace is counted at what it may actually spend — the value set for it, or the
 * default it falls back to — because that is what it can spend, not what somebody meant to
 * allow.
 */
async function wouldExceedAgencyBudget(tenantId: string, proposed: number): Promise<string | null> {
  const tenant = await tenantById(tenantId);
  if (!tenant?.orgId) return null;
  const org = await orgById(tenant.orgId);
  if (!org) return null;
  const { monthlyBudgetUsd } = await orgLimits(org.id);
  if (monthlyBudgetUsd === null) return null;

  let others = 0;
  for (const t of await workspacesOf(org.id)) {
    if (t.id === tenantId) continue;
    others += capacity(await entitlementsFor(t.id), "ai.monthly_budget_usd");
  }
  const total = others + proposed;
  if (total <= monthlyBudgetUsd) return null;
  const left = Math.max(0, monthlyBudgetUsd - others);
  return `${org.name} was sold $${monthlyBudgetUsd} of AI a month and its other workspaces already account for $${others}. This one can have at most $${left}.`;
}

export async function setCapacity(_prev: WorkspaceResult, formData: FormData): Promise<WorkspaceResult> {
  const op = await requireOperator();
  const tenantId = String(formData.get("tenantId") ?? "");
  const key = String(formData.get("key") ?? "") as CapacityKey;
  const raw = String(formData.get("value") ?? "").trim();
  if (!(CAPACITY_KEYS as readonly string[]).includes(key)) return { ok: false, error: "Unknown limit." };

  const sql = ownerSql();
  if (raw === "") {
    await sql`delete from platform.entitlements where tenant_id = ${tenantId} and kind = 'capacity' and key = ${key}`;
  } else {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return { ok: false, error: "Use a number of zero or more." };
    // An agency's AI budget is what it was sold; the sum of what its workspaces may spend has
    // to fit inside it. Checked here because this is the only place a per-workspace budget is
    // set, and a ceiling checked anywhere else is a ceiling with a way round it.
    if (key === "ai.monthly_budget_usd") {
      const over = await wouldExceedAgencyBudget(tenantId, value);
      if (over) return { ok: false, error: over };
    }
    // The column is numeric: the value goes in as a number, not as JSON.
    await sql`
      insert into platform.entitlements (tenant_id, kind, key, enabled, value, updated_by)
      values (${tenantId}, 'capacity', ${key}, true, ${value}, ${op.email})
      on conflict (tenant_id, kind, key) do update
      set value = excluded.value, enabled = true, updated_by = excluded.updated_by, updated_at = now()`;
  }
  forgetEntitlements(tenantId);
  await platformAudit({ actor: op.email, action: "set_capacity", target: `${key}=${raw || "default"}`, tenantId });
  revalidatePath(`/super-admin/workspaces/${tenantId}/usage`);
  return { ok: true, message: raw === "" ? "Back to the default." : "Saved." };
}

/** One of the workspace's own configuration values, set from the console rather than by its admin. */
export async function setWorkspaceSetting(_prev: WorkspaceResult, formData: FormData): Promise<WorkspaceResult> {
  const op = await requireOperator();
  const tenantId = String(formData.get("tenantId") ?? "");
  const key = String(formData.get("key") ?? "");
  const value = String(formData.get("value") ?? "").trim();
  if (!isTenantSettingKey(key)) return { ok: false, error: "Unknown setting." };
  if (value.length > 500) return { ok: false, error: "That value is too long." };
  if (key === "google_ads.conversion_actions" && value) {
    try {
      JSON.parse(value);
    } catch {
      return { ok: false, error: 'Conversion actions must be JSON, like {"registration":"123"}.' };
    }
  }
  await setTenantSetting(tenantId, key, value || null, op.email);
  forgetTenantSettings(tenantId);
  await platformAudit({ actor: op.email, action: "set_workspace_setting", target: key, tenantId });
  revalidatePath(`/super-admin/workspaces/${tenantId}/settings`);
  return { ok: true, message: value ? "Saved." : "Cleared." };
}

/** Renames a workspace. The address and the schema never change: they are what everything keys on. */
export async function renameWorkspace(_prev: WorkspaceResult, formData: FormData): Promise<WorkspaceResult> {
  const op = await requireOwner();
  const tenantId = String(formData.get("tenantId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 80) return { ok: false, error: "Give it a name of two to eighty characters." };
  await ownerSql()`update platform.tenants set name = ${name}, updated_at = now() where id = ${tenantId}`;
  forgetTenants();
  await platformAudit({ actor: op.email, action: "rename_workspace", target: name, tenantId });
  revalidatePath(`/super-admin/workspaces/${tenantId}`);
  return { ok: true, message: "Renamed." };
}

/** The plan a workspace is on. A label for the people running the platform; nothing enforces it. */
export async function setWorkspacePlan(_prev: WorkspaceResult, formData: FormData): Promise<WorkspaceResult> {
  const op = await requireOwner();
  const tenantId = String(formData.get("tenantId") ?? "");
  const plan = String(formData.get("plan") ?? "").trim().toLowerCase();
  if (!["full", "essentials", "trial", "custom"].includes(plan)) return { ok: false, error: "Unknown plan." };
  await ownerSql()`update platform.tenants set plan = ${plan}, updated_at = now() where id = ${tenantId}`;
  forgetTenants();
  await platformAudit({ actor: op.email, action: "set_plan", target: plan, tenantId });
  revalidatePath(`/super-admin/workspaces/${tenantId}/settings`);
  return { ok: true, message: `Plan set to ${plan}.` };
}

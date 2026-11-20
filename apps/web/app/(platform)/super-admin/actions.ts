"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import {
  archiveTenant,
  db,
  entitlementsFor,
  forgetEntitlements,
  forgetTenants,
  moduleAllowed,
  ownerSql,
  provisionTenant,
  purgeTenant,
  restoreTenant,
  RETENTION_DAYS,
  tenantById,
  uniqueSlug,
  users,
  withTenant,
} from "@bodh/db";
import {
  FEATURE_KEYS,
  FEATURE_LABELS,
  FEATURE_MODULE,
  featuresOfModule,
  INTEGRATIONS,
  MODULE_INTEGRATIONS,
  MODULES,
  type FeatureKey,
  type ModuleKey,
} from "@bodh/shared";
import { issueResetToken, platformAudit, requireOperator, requireOwner } from "@/lib/platform-auth";
import { issueUserInvite, setTemporaryPassword } from "@/lib/user-passwords";
import { passwordProblem } from "@/lib/passwords";
import { EVENTS_SECRET_KEY, FEED_TOKEN_KEY, rotateTenantSecret } from "@/lib/tenant-secrets";
import { cookieOptions, createImpersonationToken, IMPERSONATION_COOKIE, verifyImpersonationToken } from "@/lib/session";

export type PlatformResult = { ok: true; message: string } | { ok: false; error: string } | null;

/** How long a password somebody else chose stays usable, used or not. */
const TEMP_PASSWORD_HOURS = 72;

/**
 * A mobile number as it will be stored: digits, with a leading `+` if there was one. Spaces,
 * hyphens and brackets are how people write numbers, not part of them. Empty stays empty —
 * the field is optional — and anything that is not a number at all returns null, which the
 * caller turns into a complaint rather than storing.
 */
function normalisePhone(raw: string): string | "" | null {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const plus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  if (/[^0-9+\s()\-.]/.test(trimmed)) return null;
  return plus ? `+${digits}` : digits;
}

/**
 * Creates a tenant: schema, role, tables, seed rows, entitlements and the first admin — and the
 * one-time link that admin needs to set their password.
 *
 * The link belongs here rather than only on the Users tab because this is the moment it is
 * wanted: a workspace that has just been created is a customer waiting to be let in. Making
 * somebody navigate to another tab to finish the job they just started is how the last step
 * gets forgotten.
 */
export async function createTenant(_prev: SecretResult, formData: FormData): Promise<SecretResult> {
  const op = await requireOwner();
  const name = String(formData.get("name") ?? "").trim();
  const adminEmail = String(formData.get("adminEmail") ?? "").trim().toLowerCase();
  const adminPassword = String(formData.get("adminPassword") ?? "");
  const adminPhone = normalisePhone(String(formData.get("adminPhone") ?? ""));

  if (!name) return { ok: false, error: "Give the workspace a name." };
  if (name.length > 80) return { ok: false, error: "That name is too long." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) return { ok: false, error: "That isn't an email address." };
  if (adminPhone === null) return { ok: false, error: "That mobile number doesn't look right. Digits, and a + if it has a country code." };
  // Worked out, never typed: the short name is the schema name, and a schema cannot be renamed.
  const slug = await uniqueSlug(name);
  // Checked before anything is built, so a bad password does not leave a half-made workspace.
  if (adminPassword) {
    const problem = passwordProblem(adminPassword);
    if (problem) return { ok: false, error: problem };
  }

  try {
    const result = await provisionTenant({ slug, name, adminEmail, actor: op.email });
    const made = `Created ${result.tenant.name} (${result.tenant.slug}): ${result.tables} tables, everything switched on.`;
    revalidatePath("/super-admin");

    // The first admin, from inside the workspace that was just built for them.
    const [admin] = await withTenant(result.tenant, () =>
      db.select({ id: users.id }).from(users).where(eq(users.email, adminEmail)).limit(1),
    );
    if (admin && adminPhone) {
      await withTenant(result.tenant, () => db.update(users).set({ phone: adminPhone }).where(eq(users.id, admin.id)));
    }
    if (!admin) return { ok: true, message: `${made} Set their password from the Users tab.` };

    // A password the operator chose: handed over with the address, and good for one thing —
    // the page where they replace it.
    if (adminPassword) {
      await setTemporaryPassword(result.tenant, admin.id, adminPassword, TEMP_PASSWORD_HOURS);
      await platformAudit({
        actor: op.email,
        action: "set_temporary_password",
        target: adminEmail,
        tenantId: result.tenant.id,
      });
      return {
        ok: true,
        message: `${made} Give ${adminEmail} the password you chose — they sign in with it at the workspace's address and set their own. It stops working after ${TEMP_PASSWORD_HOURS} hours.`,
      };
    }

    const invite = await issueUserInvite(result.tenant, admin.id, 72);
    if (!invite) return { ok: true, message: `${made} Set their password from the Users tab.` };
    await platformAudit({
      actor: op.email,
      action: "issue_password_link",
      target: adminEmail,
      tenantId: result.tenant.id,
    });
    return {
      ok: true,
      message: `${made} A one-time link for ${adminEmail} to set their password, good for 72 hours — copy it now; it isn't shown again.`,
      value: `/t/${result.tenant.slug}/set-password?token=${invite.token}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create that workspace." };
  }
}

/**
 * Archives a workspace — what the console calls Delete.
 *
 * Nothing is removed. The workspace stops answering, every session in it dies, and its schema
 * stays exactly where it is for the retention window. The irreversible half is `purgeWorkspace`
 * below, which will not run until that window has passed.
 */
export async function archiveWorkspace(_prev: PlatformResult, formData: FormData): Promise<PlatformResult> {
  const op = await requireOwner();
  const id = String(formData.get("id") ?? "");
  const typed = String(formData.get("confirmSlug") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;

  const tenant = await tenantById(id);
  if (!tenant) return { ok: false, error: "No such workspace." };
  if (tenant.dataSchema === "public") return { ok: false, error: "The first workspace cannot be archived." };
  if (typed !== tenant.slug) return { ok: false, error: `Type ${tenant.slug} exactly to confirm.` };

  const archived = await archiveTenant(id, op.email, reason);
  if (!archived) return { ok: false, error: "That workspace is already archived." };
  forgetEntitlements(id);
  await platformAudit({
    actor: op.email,
    action: "archive_tenant",
    target: tenant.slug,
    tenantId: id,
    detail: reason ? { reason } : undefined,
  });
  revalidatePath("/super-admin");
  revalidatePath("/super-admin/workspaces");
  revalidatePath(`/super-admin/workspaces/${id}`, "layout");
  return {
    ok: true,
    message: `${tenant.name} is archived. Nothing was deleted — it can be restored, and it is kept for ${RETENTION_DAYS} days.`,
  };
}

/** Brings an archived workspace back. There is nothing to restore: nothing was removed. */
export async function restoreWorkspace(_prev: PlatformResult, formData: FormData): Promise<PlatformResult> {
  const op = await requireOwner();
  const id = String(formData.get("id") ?? "");
  const back = await restoreTenant(id);
  if (!back) return { ok: false, error: "That workspace is not archived." };
  forgetEntitlements(id);
  await platformAudit({ actor: op.email, action: "restore_tenant", target: back.slug, tenantId: id });
  revalidatePath("/super-admin");
  revalidatePath("/super-admin/workspaces");
  revalidatePath(`/super-admin/workspaces/${id}`, "layout");
  return { ok: true, message: `${back.name} is back.` };
}

/**
 * Removes an archived workspace for good: its schema, its roles and its control-plane rows.
 *
 * Every guard lives in `purgeTenant`, next to the statements it is guarding, rather than here
 * where a second caller could skip it. This refuses unless the workspace is archived, the
 * retention window has passed, the short name was typed exactly, and it is not tenant #1.
 */
export async function purgeWorkspace(_prev: PlatformResult, formData: FormData): Promise<PlatformResult> {
  const op = await requireOwner();
  const id = String(formData.get("id") ?? "");
  const typed = String(formData.get("confirmSlug") ?? "");

  const tenant = await tenantById(id);
  if (!tenant) return { ok: false, error: "No such workspace." };
  try {
    const result = await purgeTenant(id, typed, op.email);
    await platformAudit({
      actor: op.email,
      action: "purge_tenant",
      target: tenant.slug,
      detail: { schema: result.schema, roles: result.roles.join(", ") },
    });
    revalidatePath("/super-admin");
    revalidatePath("/super-admin/workspaces");
    return { ok: true, message: `${tenant.name} is gone: schema ${result.schema} and its roles were dropped.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not purge that workspace." };
  }
}

/** Suspends or resumes a tenant. Suspended means nobody signs in and jobs skip it; data is untouched. */
export async function setTenantStatus(_prev: PlatformResult, formData: FormData): Promise<PlatformResult> {
  const op = await requireOwner();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!["active", "suspended"].includes(status)) return { ok: false, error: "Unknown status." };

  await ownerSql()`update platform.tenants set status = ${status}, updated_at = now() where id = ${id}`;
  forgetTenants();
  await platformAudit({ actor: op.email, action: "set_tenant_status", target: status, tenantId: id });
  revalidatePath("/super-admin");
  revalidatePath("/super-admin/workspaces");
  revalidatePath(`/super-admin/workspaces/${id}`, "layout");
  return { ok: true, message: status === "suspended" ? "Workspace suspended." : "Workspace resumed." };
}

/** Switches a module or feature on or off for one tenant. Takes effect without a deploy. */
export async function setEntitlement(_prev: PlatformResult, formData: FormData): Promise<PlatformResult> {
  const op = await requireOperator();
  const tenantId = String(formData.get("tenantId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const key = String(formData.get("key") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";
  if (!["module", "feature", "integration"].includes(kind)) return { ok: false, error: "Unknown entitlement kind." };
  if (kind === "module" && !MODULES.some((m) => m.key === key)) return { ok: false, error: "Unknown module." };
  if (kind === "feature" && !(FEATURE_KEYS as readonly string[]).includes(key)) return { ok: false, error: "Unknown feature." };
  if (kind === "integration" && !INTEGRATIONS.some((i) => i.key === key)) return { ok: false, error: "Unknown integration." };

  // A feature cannot be switched on while its own module is off. That combination is not a
  // setting anybody wants — it reads as "this capability is on" while the page is gone and
  // `featureUsable` refuses it everywhere — so the console says no instead of storing it.
  if (kind === "feature" && enabled) {
    const needs = FEATURE_MODULE[key as FeatureKey];
    const ent = await entitlementsFor(tenantId);
    if (!moduleAllowed(ent, needs)) {
      const label = MODULES.find((m) => m.key === needs)?.label ?? needs;
      return { ok: false, error: `Switch ${label} on first — this belongs to it, and would do nothing on its own.` };
    }
  }

  // Taking away the last account a module works with hides that module: a page that can only
  // ever be empty is not worth a place in the sidebar. That is the intended behaviour, so it
  // happens — and the answer names what went with it, because a menu item disappearing without
  // explanation is how an operator loses an afternoon.
  let alsoHidden: string[] = [];
  if (kind === "integration" && !enabled) {
    const ent = await entitlementsFor(tenantId);
    alsoHidden = MODULES.filter((m) => {
      const needs = MODULE_INTEGRATIONS[m.key];
      if (!needs?.length || !needs.includes(key) || !ent.modules.has(m.key)) return false;
      return !needs.some((k) => k !== key && ent.integrations.has(k));
    }).map((m) => m.label);
  }

  // Switching a module off takes its own features with it. A module that is off while one of
  // its capabilities is on is not a setting — it is the page gone from the menu while an agent
  // or a webhook carries on using it. Switching the module back on does NOT switch the features
  // back on: that is a decision, and it stays with the person making it.
  const alsoOff =
    kind === "module" && !enabled ? featuresOfModule(key as ModuleKey) : [];

  const rows = [
    { kind, key, enabled },
    ...alsoOff.map((f) => ({ kind: "feature", key: f as string, enabled: false })),
  ];
  const sql = ownerSql();
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
  const detail: Record<string, string> = {};
  if (alsoOff.length) detail.featuresAlsoOff = alsoOff.join(", ");
  if (alsoHidden.length) detail.modulesNowHidden = alsoHidden.join(", ");
  await platformAudit({
    actor: op.email,
    action: "set_entitlement",
    target: `${kind}:${key}=${enabled}`,
    tenantId,
    detail: Object.keys(detail).length ? detail : undefined,
  });
  revalidatePath(`/super-admin/workspaces/${tenantId}/modules`);
  revalidatePath(`/super-admin/workspaces/${tenantId}/features`);
  revalidatePath(`/super-admin/workspaces/${tenantId}/integrations`);
  revalidatePath("/super-admin/workspaces");
  // Naming them, not counting them: "5 features went off" is what made this look like a bug.
  const also = alsoOff.length
    ? ` These went off with it: ${alsoOff.map((f) => FEATURE_LABELS[f as FeatureKey]).join("; ")}.`
    : "";
  const hidden = alsoHidden.length
    ? ` ${alsoHidden.join(" and ")} ${alsoHidden.length === 1 ? "is" : "are"} now hidden — no account left to work with.`
    : "";
  return { ok: true, message: `${key} is now ${enabled ? "on" : "off"}.${also}${hidden}` };
}

export type SecretResult = { ok: true; message: string; value?: string } | { ok: false; error: string } | null;

/**
 * Makes a workspace its own event secret or page-feed token.
 *
 * These guard addresses the outside world calls, so they belong to the workspace, not to the
 * server: one value for everyone would mean whoever holds it reaches every workspace. The value
 * is shown once, here, and then only ever compared against.
 */
export async function rotatePublicSecret(_prev: SecretResult, formData: FormData): Promise<SecretResult> {
  const op = await requireOwner();
  const tenantId = String(formData.get("tenantId") ?? "");
  const key = String(formData.get("key") ?? "");
  if (key !== EVENTS_SECRET_KEY && key !== FEED_TOKEN_KEY) return { ok: false, error: "Unknown credential." };

  const tenant = await tenantById(tenantId);
  if (!tenant) return { ok: false, error: "No such workspace." };
  try {
    const value = await withTenant(tenant, () => rotateTenantSecret(key));
    await platformAudit({
      actor: op.email,
      action: "rotate_public_secret",
      target: key,
      tenantId,
      detail: { workspace: tenant.slug },
    });
    revalidatePath(`/super-admin/workspaces/${tenantId}/security`);
    return { ok: true, message: "New value, shown once. Copy it now.", value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not write the credential." };
  }
}

export type OperatorResult = { ok: true; message: string } | { ok: false; error: string } | null;

/**
 * Starts a time-limited look inside a workspace.
 *
 * It is recorded before it begins and it ends by itself. What it cannot do is not a matter of
 * remembering to check: the workspace is bound through its read-only database role, so an
 * approval, a budget change or any other write is refused by Postgres.
 */
export async function startImpersonation(_prev: OperatorResult, formData: FormData): Promise<OperatorResult> {
  const op = await requireOperator();
  const tenantId = String(formData.get("tenantId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const minutes = Math.min(240, Math.max(5, Number(formData.get("minutes") ?? 30)));
  if (reason.length < 8) return { ok: false, error: "Say why you need to look, in a few words." };

  const tenant = await tenantById(tenantId);
  if (!tenant) return { ok: false, error: "No such workspace." };
  if (tenant.status !== "active") return { ok: false, error: `That workspace is ${tenant.status}.` };
  if (!tenant.dbRole) return { ok: false, error: "That workspace has no database role, so it cannot be opened read-only." };

  // Act as one of the workspace's own admins, so what is on screen is what they see.
  const person = await withTenant({ ...tenant, readOnly: true }, async () => {
    const rows = await db.select().from(users).where(and(eq(users.active, true), eq(users.role, "admin"))).limit(1);
    return rows[0] ?? (await db.select().from(users).where(eq(users.active, true)).limit(1))[0];
  });
  if (!person) return { ok: false, error: "That workspace has nobody to look as." };

  const sql = ownerSql();
  const expiresAt = new Date(Date.now() + minutes * 60_000);
  const rows = (await sql<{ id: string }[]>`
    insert into platform.impersonations (operator_id, tenant_id, user_id, user_email, reason, expires_at)
    values (${op.id}, ${tenantId}, ${person.id}, ${person.email}, ${reason}, ${expiresAt})
    returning id`) as unknown as { id: string }[];
  const id = rows[0]!.id;

  // The row is written first because the token needs its id. If anything after it fails, the
  // row is closed again: an open record with no session is a lie about who is looking.
  let token: string;
  try {
    token = await createImpersonationToken(
      { sub: id, operatorEmail: op.email, tenantId, userId: person.id, userEmail: person.email },
      minutes * 60,
    );
  } catch (e) {
    await sql`update platform.impersonations set ended_at = now() where id = ${id}`;
    return { ok: false, error: e instanceof Error ? e.message : "Could not start." };
  }
  const jar = await cookies();
  jar.set(IMPERSONATION_COOKIE, token, cookieOptions(minutes * 60));
  await platformAudit({
    actor: op.email,
    action: "start_impersonation",
    target: person.email,
    tenantId,
    detail: { reason, minutes, workspace: tenant.slug },
  });
  return { ok: true, message: `Looking inside ${tenant.name} as ${person.email} for ${minutes} minutes, read-only.` };
}

/** Ends it now, rather than waiting for it to expire. */
export async function stopImpersonation(_prev: OperatorResult, _formData: FormData): Promise<OperatorResult> {
  const jar = await cookies();
  const claims = await verifyImpersonationToken(jar.get(IMPERSONATION_COOKIE)?.value);
  jar.delete(IMPERSONATION_COOKIE);
  if (claims) {
    await ownerSql()`update platform.impersonations set ended_at = now() where id = ${claims.sub} and ended_at is null`;
    await platformAudit({
      actor: claims.operatorEmail,
      action: "end_impersonation",
      target: claims.userEmail,
      tenantId: claims.tenantId,
    });
  }
  revalidatePath("/super-admin");
  return { ok: true, message: "Stopped." };
}

/** Adds or re-activates a platform operator. Owners only. */
export async function saveOperator(_prev: OperatorResult, formData: FormData): Promise<OperatorResult> {
  const op = await requireOwner();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim() || email.split("@")[0]!;
  const role = String(formData.get("role") ?? "support");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That isn't an email address." };
  if (!["owner", "support", "billing"].includes(role)) return { ok: false, error: "Unknown role." };

  await ownerSql()`
    insert into platform.platform_operators (email, name, role, active)
    values (${email}, ${name}, ${role}, true)
    on conflict (email) do update set name = excluded.name, role = excluded.role, active = true`;
  await platformAudit({ actor: op.email, action: "save_operator", target: email, detail: { role } });
  revalidatePath("/super-admin/operators");
  return { ok: true, message: `${email} can sign in to the console as ${role}.` };
}

/** Takes an operator's access away, and ends any look they have open. Never the last owner. */
export async function deactivateOperator(_prev: OperatorResult, formData: FormData): Promise<OperatorResult> {
  const op = await requireOwner();
  const id = String(formData.get("id") ?? "");
  if (id === op.id) return { ok: false, error: "You can't remove your own access." };
  const sql = ownerSql();
  const owners = (await sql<{ n: string }[]>`
    select count(*)::text as n from platform.platform_operators where role = 'owner' and active = true`) as unknown as {
    n: string;
  }[];
  const target = (await sql<{ email: string; role: string }[]>`
    select email, role from platform.platform_operators where id = ${id}`) as unknown as { email: string; role: string }[];
  if (!target[0]) return { ok: false, error: "No such operator." };
  if (target[0].role === "owner" && Number(owners[0]!.n) <= 1) return { ok: false, error: "That would leave no owner." };

  // Their session version goes up, so any console session they hold stops working at once.
  await sql`
    update platform.platform_operators
    set active = false, session_version = session_version + 1 where id = ${id}`;
  await sql`update platform.impersonations set ended_at = now() where operator_id = ${id} and ended_at is null`;
  await platformAudit({ actor: op.email, action: "deactivate_operator", target: target[0].email });
  revalidatePath("/super-admin/operators");
  return { ok: true, message: `${target[0].email} can no longer sign in.` };
}

/**
 * Issues a one-time link for an operator to set their password.
 *
 * There is no mail service here, so the link is shown to the owner once and handed over. It is
 * single-use and expires within the hour; only its hash is stored.
 */
export async function issueOperatorResetLink(_prev: SecretResult, formData: FormData): Promise<SecretResult> {
  const op = await requireOwner();
  const id = String(formData.get("id") ?? "");
  const rows = (await ownerSql()<{ email: string }[]>`
    select email from platform.platform_operators where id = ${id} and active = true`) as unknown as { email: string }[];
  if (!rows[0]) return { ok: false, error: "No such active operator." };

  const token = await issueResetToken(id, 60);
  await platformAudit({ actor: op.email, action: "issue_reset_link", target: rows[0].email });
  revalidatePath("/super-admin/operators");
  return {
    ok: true,
    message: `A one-time link for ${rows[0].email}, good for an hour. Copy it now; it is not shown again.`,
    value: `/super-admin/reset?token=${token}`,
  };
}

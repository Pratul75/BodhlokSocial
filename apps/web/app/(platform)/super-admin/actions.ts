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
  accessLevel,
  addOrgAdmin,
  createOrg,
  isAccessLevel,
  setOrgLimits,
  workspacesOf,
  orgById,
  removeOrgAdmin,
  renameOrg,
  setOrgStatus,
  purgeTenant,
  restoreTenant,
  RETENTION_DAYS,
  tenantById,
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
import { buildWorkspace } from "@/lib/provision";
import { applyAccessLevel, grantAgencyAdminAccounts } from "@/lib/org-access";
import { passwordProblem } from "@/lib/passwords";
import { EVENTS_SECRET_KEY, FEED_TOKEN_KEY, rotateTenantSecret } from "@/lib/tenant-secrets";
import { cookieOptions, createImpersonationToken, IMPERSONATION_COOKIE, verifyImpersonationToken } from "@/lib/session";

export type PlatformResult = { ok: true; message: string } | { ok: false; error: string } | null;

/** How long a password somebody else chose stays usable, used or not. */

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
/** What a form says about the person who will be let in first. */
function readFirstAdmin(formData: FormData): { email: string; phone: string | null; password: string } | string {
  const email = String(formData.get("adminEmail") ?? "").trim().toLowerCase();
  const phone = normalisePhone(String(formData.get("adminPhone") ?? ""));
  const password = String(formData.get("adminPassword") ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "That isn't an email address.";
  if (phone === null) return "That mobile number doesn't look right. Digits, and a + if it has a country code.";
  // Checked before anything is built, so a bad password does not leave a half-made workspace.
  if (password) {
    const problem = passwordProblem(password);
    if (problem) return problem;
  }
  return { email, phone, password };
}

export async function createTenant(_prev: SecretResult, formData: FormData): Promise<SecretResult> {
  const op = await requireOwner();
  const name = String(formData.get("name") ?? "").trim();
  const orgId = String(formData.get("orgId") ?? "").trim();

  if (!name) return { ok: false, error: "Give the workspace a name." };
  if (name.length > 80) return { ok: false, error: "That name is too long." };
  // Checked here rather than trusted from the form: a workspace that belongs to no agency, or
  // to one that was archived while this page was open, is a workspace nobody is responsible for.
  const org = await orgById(orgId);
  if (!org) return { ok: false, error: "Choose the organization this workspace belongs to." };
  if (org.status !== "active") return { ok: false, error: `${org.name} is ${org.status}. Pick an active organization.` };

  const admin = readFirstAdmin(formData);
  if (typeof admin === "string") return { ok: false, error: admin };

  return buildWorkspace({
    org,
    name,
    adminEmail: admin.email,
    adminPhone: admin.phone,
    adminPassword: admin.password,
    actor: op.email,
  });
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

/* -------------------------------------------------------------------------- */
/* Organizations                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Creates an agency.
 *
 * Nothing is provisioned, because an organization holds no data: no schema, no database role,
 * no tables. It is a row that says which workspaces belong together. The workspaces come after,
 * each one still built the way every workspace has always been built.
 */
export async function createOrganization(_prev: SecretResult, formData: FormData): Promise<SecretResult> {
  const op = await requireOwner();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Give the organization a name." };
  if (name.length > 80) return { ok: false, error: "That name is too long." };

  const admin = readFirstAdmin(formData);
  if (typeof admin === "string") return { ok: false, error: admin };

  let org: Awaited<ReturnType<typeof createOrg>>;
  try {
    org = await createOrg({ name });
    await platformAudit({ actor: op.email, action: "create_org", target: org.slug, detail: { name: org.name } });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create the organization." };
  }

  // An agency is also a customer: it does its own marketing. So it gets a workspace of its own
  // in the same step — a complete one, built exactly the way a client's is. Waiting to be told
  // "now make yourself a workspace" is a step somebody has to be taught, and the agency has
  // nothing at all until they are.
  const built = await buildWorkspace({
    org,
    name,
    adminEmail: admin.email,
    adminPhone: admin.phone,
    adminPassword: admin.password,
    actor: op.email,
  });
  revalidatePath("/super-admin/orgs");

  // The organization exists either way. A workspace that failed to build is reported as what it
  // is, rather than rolled back into "nothing happened" — the agency is there, and somebody has
  // to be told the rest did not finish.
  if (!built.ok) {
    return {
      ok: false,
      error: `${org.name} was created, but its own workspace was not: ${built.error} Make it from Workspaces.`,
    };
  }
  return { ...built, message: `${org.name} created, with its own workspace. ${built.message}` };
}

export async function renameOrganization(_prev: SecretResult, formData: FormData): Promise<SecretResult> {
  const op = await requireOwner();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Give the organization a name." };
  const org = await orgById(id);
  if (!org) return { ok: false, error: "That organization no longer exists." };
  await renameOrg(org.id, name);
  await platformAudit({ actor: op.email, action: "rename_org", target: org.slug, detail: { name } });
  revalidatePath("/super-admin/orgs");
  revalidatePath("/super-admin/workspaces");
  return { ok: true, message: `Renamed to ${name}.` };
}

/**
 * Suspends or reopens an agency.
 *
 * Deliberately does **not** touch its workspaces. Each workspace has its own status, its own
 * people and its own customers; closing the agency's account is not the same decision as
 * closing theirs, and making one mean the other would take that decision away from a person.
 * A suspended organization stops being offered at sign-in and can take no new workspaces.
 */
export async function setOrganizationStatus(_prev: SecretResult, formData: FormData): Promise<SecretResult> {
  const op = await requireOwner();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (status !== "active" && status !== "suspended") return { ok: false, error: "Unknown status." };
  const org = await orgById(id);
  if (!org) return { ok: false, error: "That organization no longer exists." };
  await setOrgStatus(org.id, status);
  await platformAudit({ actor: op.email, action: "set_org_status", target: org.slug, detail: { status } });
  revalidatePath("/super-admin/orgs");
  revalidatePath("/super-admin/workspaces");
  return {
    ok: true,
    message: status === "suspended" ? `${org.name} is suspended. Its workspaces are untouched.` : `${org.name} is active again.`,
  };
}

/**
 * Appoints somebody to run an agency.
 *
 * It grants nothing by itself: they still sign in the ordinary way, and inside a workspace they
 * are whatever their row there says they are. What it opens is `/org` — the agency's own panel,
 * where they can see their clients and make new ones.
 */
export async function addOrganizationAdmin(_prev: SecretResult, formData: FormData): Promise<SecretResult> {
  const op = await requireOwner();
  const id = String(formData.get("id") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That isn't an email address." };
  const org = await orgById(id);
  if (!org) return { ok: false, error: "That organization no longer exists." };

  await addOrgAdmin(org.id, email, op.email);
  // The same grant the agency's own panel does. Adding somebody to an agency and leaving them
  // without an account in its clients is the gap, not the safeguard: the panel would open on
  // workspaces they cannot enter, and nothing would say why.
  const grant = await grantAgencyAdminAccounts(org, email);
  await platformAudit({
    actor: op.email,
    action: "add_org_admin",
    target: org.slug,
    detail: { email, granted: grant.granted, failed: grant.failed.join(", ") || null },
  });
  revalidatePath("/super-admin/orgs");
  const trouble = grant.failed.length ? ` ${grant.failed.join(", ")} could not be reached.` : "";
  return {
    ok: true,
    message: `${email} runs ${org.name}, with an admin account in ${grant.granted} of its workspaces.${trouble} /org is now open to them.`,
  };
}

export async function removeOrganizationAdmin(_prev: SecretResult, formData: FormData): Promise<SecretResult> {
  const op = await requireOwner();
  const id = String(formData.get("id") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const org = await orgById(id);
  if (!org) return { ok: false, error: "That organization no longer exists." };

  await removeOrgAdmin(org.id, email);
  await platformAudit({ actor: op.email, action: "remove_org_admin", target: org.slug, detail: { email } });
  revalidatePath("/super-admin/orgs");
  // Their workspace accounts are untouched on purpose: they stop running the agency, they do not
  // stop being whoever they are inside the workspaces they belong to. Those are separate
  // decisions and taking both at once would make one of them invisible.
  return { ok: true, message: `${email} no longer runs ${org.name}. Their workspace accounts are unchanged.` };
}

/**
 * How far an agency reaches into one of its clients.
 *
 * Changing it does the thing, not just records it: `full` gives the agency's people accounts
 * inside that client, the other two take them away. Both are visible on the client's own People
 * page, which is the point — if an agency can reach a client, the client can see who.
 */
export async function setClientAccess(_prev: SecretResult, formData: FormData): Promise<SecretResult> {
  const op = await requireOwner();
  const tenantId = String(formData.get("tenantId") ?? "");
  const level = String(formData.get("level") ?? "");
  if (!isAccessLevel(level)) return { ok: false, error: "Unknown access level." };

  const tenant = await tenantById(tenantId);
  if (!tenant) return { ok: false, error: "That workspace no longer exists." };
  if (!tenant.orgId) return { ok: false, error: "That workspace has no organization yet." };
  const org = await orgById(tenant.orgId);
  if (!org) return { ok: false, error: "That organization no longer exists." };
  if ((await accessLevel(org.id, tenant.id)) === level) return { ok: true, message: "No change." };

  const change = await applyAccessLevel(org, tenant, level, op.email);
  await platformAudit({
    actor: op.email,
    action: "set_org_access",
    target: tenant.slug,
    tenantId: tenant.id,
    detail: { org: org.slug, level, accounts: change.changed },
  });
  revalidatePath("/super-admin/orgs");
  revalidatePath(`/super-admin/workspaces/${tenant.id}`);
  return { ok: true, message: change.message };
}

/**
 * What an agency was sold: how many workspaces, and how much AI spend a month.
 *
 * Set by the platform and nowhere else. A ceiling somebody can raise themselves is not a
 * ceiling. Leaving a field empty means no ceiling, which is what every agency has until one is
 * set — so nothing that works today stops working when this arrives.
 */
export async function setOrganizationLimits(_prev: SecretResult, formData: FormData): Promise<SecretResult> {
  const op = await requireOwner();
  const id = String(formData.get("id") ?? "");
  const org = await orgById(id);
  if (!org) return { ok: false, error: "That organization no longer exists." };

  const number = (key: string): number | null | undefined => {
    const raw = String(formData.get(key) ?? "").trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const maxWorkspaces = number("maxWorkspaces");
  const monthlyBudgetUsd = number("monthlyBudgetUsd");
  if (maxWorkspaces === undefined) return { ok: false, error: "Workspaces must be a number, or empty for no ceiling." };
  if (monthlyBudgetUsd === undefined) return { ok: false, error: "The budget must be a number, or empty for no ceiling." };

  const held = (await workspacesOf(org.id)).length;
  if (maxWorkspaces !== null && maxWorkspaces < held) {
    // Refused rather than applied: a ceiling below what is already there would not take a
    // workspace away, it would only make every later number a lie.
    return { ok: false, error: `${org.name} already holds ${held} workspaces. Set the ceiling to ${held} or more.` };
  }

  await setOrgLimits(org.id, { maxWorkspaces, monthlyBudgetUsd });
  await platformAudit({
    actor: op.email,
    action: "set_org_limits",
    target: org.slug,
    detail: { maxWorkspaces: maxWorkspaces ?? "none", monthlyBudgetUsd: monthlyBudgetUsd ?? "none" },
  });
  revalidatePath("/super-admin/orgs");
  const ws = maxWorkspaces === null ? "no workspace ceiling" : `up to ${maxWorkspaces} workspaces`;
  const ai = monthlyBudgetUsd === null ? "no AI budget ceiling" : `$${monthlyBudgetUsd} AI a month`;
  return { ok: true, message: `${org.name}: ${ws}, ${ai}.` };
}

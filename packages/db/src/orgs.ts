/**
 * Organizations: the agency a workspace belongs to.
 *
 * An organization holds no data. It has no schema and no database role, and nothing is ever
 * bound to it — that is the whole point. A workspace is where data lives and where the
 * database draws its line; an organization only says which workspaces belong together.
 *
 * Kept apart from `tenancy.ts` for the same reason it is kept apart in the database: the
 * moment the two are one thing, every rule has to start asking which kind of thing it is
 * holding, and the first rule that forgets to ask is a bug nobody can see.
 */
import { ownerSql, type TenantRef } from "./client";
import { slugCandidate } from "./platform";

export interface OrgRef {
  id: string;
  slug: string;
  name: string;
  /** active | suspended | archived. Only an active organization is offered at sign-in. */
  status: string;
  plan: string;
}

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan: string;
}

const toOrg = (r: OrgRow): OrgRef => ({ id: r.id, slug: r.slug, name: r.name, status: r.status, plan: r.plan });

const COLUMNS = "id, slug, name, status, plan";

/** Every organization, oldest first, so the list does not reshuffle as names are edited. */
export async function listOrgs(): Promise<OrgRef[]> {
  const rows = (await ownerSql().unsafe(`select ${COLUMNS} from platform.orgs order by created_at`)) as unknown as OrgRow[];
  return rows.map(toOrg);
}

/**
 * The organizations a sign-in page may offer.
 *
 * Only active ones: a suspended or archived agency is closed, and offering it would mean
 * refusing the person after they had typed a password.
 */
export async function activeOrgs(): Promise<OrgRef[]> {
  return (await listOrgs()).filter((o) => o.status === "active");
}

export async function orgById(id: string): Promise<OrgRef | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = (await ownerSql()<OrgRow[]>`
    select id, slug, name, status, plan from platform.orgs where id = ${id}`) as unknown as OrgRow[];
  return rows[0] ? toOrg(rows[0]) : null;
}

export async function orgBySlug(slug: string): Promise<OrgRef | null> {
  const rows = (await ownerSql()<OrgRow[]>`
    select id, slug, name, status, plan from platform.orgs where slug = ${slug.trim().toLowerCase()}`) as unknown as OrgRow[];
  return rows[0] ? toOrg(rows[0]) : null;
}

/**
 * A short name for an organization that nothing else is using.
 *
 * Unlike a workspace slug this never becomes a schema or a role name, so it is only ever a
 * label — but two agencies sharing one short name is still a support call waiting to happen.
 */
export async function uniqueOrgSlug(name: string): Promise<string> {
  const base = slugCandidate(name);
  for (let n = 0; n < 200; n++) {
    const slug = n === 0 ? base : `${base}-${n + 1}`.slice(0, 40);
    if (!(await orgBySlug(slug))) return slug;
  }
  throw new Error(`Could not find a free short name for "${name}".`);
}

export interface NewOrg {
  name: string;
  /** Worked out from the name when it is left out. */
  slug?: string;
  plan?: string;
}

/** Creates an organization. Nothing is provisioned: there is nothing to provision. */
export async function createOrg(input: NewOrg): Promise<OrgRef> {
  const name = input.name.trim();
  if (!name) throw new Error("An organization needs a name.");
  const slug = (input.slug ?? (await uniqueOrgSlug(name))).trim().toLowerCase();
  const rows = (await ownerSql()<OrgRow[]>`
    insert into platform.orgs (slug, name, plan)
    values (${slug}, ${name}, ${input.plan ?? "full"})
    returning id, slug, name, status, plan`) as unknown as OrgRow[];
  return toOrg(rows[0]!);
}

export async function renameOrg(id: string, name: string): Promise<void> {
  await ownerSql()`update platform.orgs set name = ${name.trim()}, updated_at = now() where id = ${id}`;
}

export async function setOrgStatus(id: string, status: string): Promise<void> {
  await ownerSql()`update platform.orgs set status = ${status}, updated_at = now() where id = ${id}`;
}

/** Puts a workspace in an organization. */
export async function setTenantOrg(tenantId: string, orgId: string): Promise<void> {
  await ownerSql()`update platform.tenants set org_id = ${orgId}, updated_at = now() where id = ${tenantId}`;
}

/** How many workspaces each organization holds, for the console's lists. */
export async function workspaceCounts(): Promise<Map<string, number>> {
  const rows = (await ownerSql()<{ org_id: string; n: string }[]>`
    select org_id, count(*)::text as n from platform.tenants where org_id is not null group by org_id`) as unknown as {
    org_id: string;
    n: string;
  }[];
  return new Map(rows.map((r) => [r.org_id, Number(r.n)]));
}

/**
 * The organization every existing workspace belongs to, created if it is not there yet.
 *
 * An installation that predates organizations has workspaces and no agency to hold them. This
 * is the one that holds them: named from `FIRST_ORG_NAME` when the deployment says so, and
 * otherwise after the installation itself, so nobody's company name is written into the code.
 */
export async function ensureFirstOrg(fallbackName: string): Promise<OrgRef> {
  const name = process.env.FIRST_ORG_NAME?.trim() || fallbackName.trim() || "Organization";
  const slug = process.env.FIRST_ORG_SLUG?.trim().toLowerCase() || slugCandidate(name);
  const existing = await orgBySlug(slug);
  if (existing) return existing;
  // Another deploy may be doing exactly this at the same moment; the unique index decides.
  const rows = (await ownerSql()<OrgRow[]>`
    insert into platform.orgs (slug, name)
    values (${slug}, ${name})
    on conflict (slug) do update set name = platform.orgs.name
    returning id, slug, name, status, plan`) as unknown as OrgRow[];
  return toOrg(rows[0]!);
}

/**
 * Gives every workspace without an organization to the first one.
 *
 * Run on each deploy. It fills a column and moves nothing: no schema, no row of customer data
 * and no role is touched, so a workspace that was working before is working after.
 */
export async function backfillOrgs(fallbackName: string): Promise<{ org: OrgRef; placed: number }> {
  const org = await ensureFirstOrg(fallbackName);
  const rows = (await ownerSql()<{ id: string }[]>`
    update platform.tenants set org_id = ${org.id}, updated_at = now()
    where org_id is null
    returning id`) as unknown as { id: string }[];
  return { org, placed: rows.length };
}

/* -------------------------------------------------------------------------- */
/* Who runs an agency                                                         */
/* -------------------------------------------------------------------------- */

export interface OrgAdmin {
  email: string;
  addedBy: string;
  createdAt: Date;
}

/** The people who run this agency. */
export async function listOrgAdmins(orgId: string): Promise<OrgAdmin[]> {
  const rows = (await ownerSql()<{ email: string; added_by: string; created_at: Date }[]>`
    select email, added_by, created_at from platform.org_admins
    where org_id = ${orgId} order by created_at`) as unknown as {
    email: string;
    added_by: string;
    created_at: Date;
  }[];
  return rows.map((r) => ({ email: r.email, addedBy: r.added_by, createdAt: new Date(r.created_at) }));
}

/**
 * The agencies this address runs.
 *
 * Asked on every `/org` page load, so it is one indexed read and nothing is cached: an agency
 * admin who is removed should stop being one on their next click, not when something expires.
 */
export async function orgsRunBy(email: string): Promise<OrgRef[]> {
  const rows = (await ownerSql()<OrgRow[]>`
    select o.id, o.slug, o.name, o.status, o.plan
    from platform.org_admins a
    join platform.orgs o on o.id = a.org_id
    where a.email = ${email.trim().toLowerCase()} and o.status = 'active'
    order by o.created_at`) as unknown as OrgRow[];
  return rows.map(toOrg);
}

/** Whether this address runs this agency. */
export async function runsOrg(email: string, orgId: string | null | undefined): Promise<boolean> {
  if (!orgId) return false;
  return (await orgsRunBy(email)).some((o) => o.id === orgId);
}

export async function addOrgAdmin(orgId: string, email: string, addedBy: string): Promise<void> {
  await ownerSql()`
    insert into platform.org_admins (org_id, email, added_by)
    values (${orgId}, ${email.trim().toLowerCase()}, ${addedBy})
    on conflict (org_id, email) do nothing`;
}

export async function removeOrgAdmin(orgId: string, email: string): Promise<void> {
  await ownerSql()`
    delete from platform.org_admins where org_id = ${orgId} and email = ${email.trim().toLowerCase()}`;
}

/** The workspaces in one agency, oldest first — its own and its clients'. */
export async function workspacesOf(orgId: string): Promise<TenantRef[]> {
  const { listTenants } = await import("./tenancy");
  return (await listTenants()).filter((t) => t.orgId === orgId);
}

/* -------------------------------------------------------------------------- */
/* Ceilings, and how far into a client the agency reaches                     */
/* -------------------------------------------------------------------------- */

/** How far into one client an agency reaches. */
export const ACCESS_LEVELS = ["full", "manage", "none"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];
export const isAccessLevel = (v: string): v is AccessLevel => (ACCESS_LEVELS as readonly string[]).includes(v);

export interface OrgLimits {
  /** How many workspaces this agency may hold, its own included. Null means no ceiling. */
  maxWorkspaces: number | null;
  /** What it was sold in AI spend a month, across all of its workspaces. Null means no ceiling. */
  monthlyBudgetUsd: number | null;
}

export async function orgLimits(orgId: string): Promise<OrgLimits> {
  const rows = (await ownerSql()<{ max_workspaces: number | null; monthly_budget_usd: string | null }[]>`
    select max_workspaces, monthly_budget_usd from platform.orgs where id = ${orgId}`) as unknown as {
    max_workspaces: number | null;
    monthly_budget_usd: string | null;
  }[];
  const r = rows[0];
  return {
    maxWorkspaces: r?.max_workspaces ?? null,
    monthlyBudgetUsd: r?.monthly_budget_usd === null || r?.monthly_budget_usd === undefined ? null : Number(r.monthly_budget_usd),
  };
}

export async function setOrgLimits(orgId: string, limits: OrgLimits): Promise<void> {
  await ownerSql()`
    update platform.orgs
    set max_workspaces = ${limits.maxWorkspaces},
        monthly_budget_usd = ${limits.monthlyBudgetUsd === null ? null : String(limits.monthlyBudgetUsd)},
        updated_at = now()
    where id = ${orgId}`;
}

/**
 * Whether this agency may take another workspace.
 *
 * Counted from the registry rather than remembered anywhere, so it cannot drift. Its own
 * workspace counts: the ceiling is how many workspaces the agency holds, not how many clients
 * it has, because every one of them costs the same to run.
 */
export async function roomForAnotherWorkspace(orgId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { maxWorkspaces } = await orgLimits(orgId);
  if (maxWorkspaces === null) return { ok: true };
  const held = (await workspacesOf(orgId)).length;
  if (held < maxWorkspaces) return { ok: true };
  return {
    ok: false,
    reason: `This agency is allowed ${maxWorkspaces} workspace${maxWorkspaces === 1 ? "" : "s"} and already has ${held}. Ask the platform to raise it.`,
  };
}

/** How far into each of its workspaces this agency reaches. Anything unset is `full`. */
export async function accessLevels(orgId: string): Promise<Map<string, AccessLevel>> {
  const rows = (await ownerSql()<{ tenant_id: string; level: string }[]>`
    select tenant_id, level from platform.org_access where org_id = ${orgId}`) as unknown as {
    tenant_id: string;
    level: string;
  }[];
  return new Map(rows.filter((r) => isAccessLevel(r.level)).map((r) => [r.tenant_id, r.level as AccessLevel]));
}

export async function accessLevel(orgId: string, tenantId: string): Promise<AccessLevel> {
  return (await accessLevels(orgId)).get(tenantId) ?? "full";
}

export async function setAccessLevel(orgId: string, tenantId: string, level: AccessLevel, setBy: string): Promise<void> {
  await ownerSql()`
    insert into platform.org_access (org_id, tenant_id, level, set_by)
    values (${orgId}, ${tenantId}, ${level}, ${setBy})
    on conflict (org_id, tenant_id) do update set level = excluded.level, set_by = excluded.set_by, updated_at = now()`;
}

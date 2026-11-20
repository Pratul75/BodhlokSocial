import "server-only";
import { notFound } from "next/navigation";
import { accessLevel, orgsRunBy, ownerSql, tenantById, type OrgRef, type TenantRef } from "@bodh/db";
import { currentOperator, type Operator } from "./platform-auth";
import { getCurrentUser } from "./auth";

/**
 * Who is looking at a workspace's administration, and what they may do with it.
 *
 * There are two kinds of person with business here and they share one set of pages. A platform
 * operator runs the installation; an agency runs the clients it made. Giving the agency its own
 * copy of these pages would mean the day somebody adds a field to one, the other quietly lacks
 * it — so there is one implementation and this says who is in front of it.
 */
export interface WorkspaceViewer {
  kind: "operator" | "agency";
  email: string;
  /**
   * May change what the workspace is: its people, modules, features, integrations, limits and
   * settings. An agency running the client, and a platform owner. Support and billing operators
   * look without touching, as they always have.
   */
  canManage: boolean;
  /** Platform-only: suspending, archiving and purging a workspace. */
  canSuspend: boolean;
  /** Platform-only: the plumbing — schema name, database role, the control plane's own rows. */
  isPlatform: boolean;
  /** Where this viewer's workspace pages live, so links and tabs land back where they started. */
  base: string;
  /** The console session, when that is who this is. The console shell needs the whole of it. */
  operator?: Operator;
  org?: OrgRef;
  /** For an agency: the workspace they are signed in to, which is where "back" goes. */
  workspaceName?: string;
}

export interface WorkspaceAdminContext {
  viewer: WorkspaceViewer;
  tenant: TenantRef;
  plan: string;
  createdAt: Date;
}

/**
 * The workspace this page is about and who is looking at it, or a 404.
 *
 * An agency asking for a workspace outside its own is **not found**, not refused: a refusal
 * would confirm that somebody else's client exists, which is an answer the agency should not be
 * able to get by trying an id.
 */
export async function requireWorkspaceAdmin(id: string): Promise<WorkspaceAdminContext> {
  const tenant = await tenantById(id);
  if (!tenant) notFound();

  const rows = (await ownerSql()<{ plan: string; created_at: Date }[]>`
    select plan, created_at from platform.tenants where id = ${id}`) as unknown as {
    plan: string;
    created_at: Date;
  }[];
  const row = rows[0];
  if (!row) notFound();

  const operator = await currentOperator();
  if (operator) {
    return {
      viewer: {
        kind: "operator",
        email: operator.email,
        canManage: operator.role === "owner",
        canSuspend: operator.role === "owner",
        isPlatform: true,
        base: "/super-admin/workspaces",
        operator,
      },
      tenant,
      plan: row.plan,
      createdAt: row.created_at,
    };
  }

  // No console session. The other person with business here is the agency that holds this
  // workspace — signed in the ordinary way, and checked against the control plane every time.
  const user = await getCurrentUser();
  if (user.impersonatedBy) notFound();
  const org = (await orgsRunBy(user.email)).find((o) => o.id === tenant.orgId);
  if (!org) notFound();
  // `none` means this client is not the agency's business at all; `manage` is enough to run it
  // from outside, which is what these pages do.
  if ((await accessLevel(org.id, tenant.id)) === "none") notFound();

  return {
    viewer: {
      kind: "agency",
      email: user.email,
      canManage: true,
      canSuspend: false,
      isPlatform: false,
      base: "/org/clients",
      org,
      workspaceName: user.tenant.name,
    },
    tenant,
    plan: row.plan,
    createdAt: row.created_at,
  };
}

/**
 * The same question for an action rather than a page: may this person change this workspace?
 *
 * Actions are reached without a page in front of them, so each one asks again. `canManage` is
 * the whole answer — a support operator and an agency with no business here both fail it.
 */
export async function requireWorkspaceManager(tenantId: string): Promise<WorkspaceAdminContext | null> {
  const ctx = await requireWorkspaceAdmin(tenantId).catch(() => null);
  if (!ctx || !ctx.viewer.canManage) return null;
  return ctx;
}

import "server-only";
import { notFound } from "next/navigation";
import { ownerSql, tenantById, type TenantRef } from "@bodh/db";

export interface WorkspaceRow {
  tenant: TenantRef;
  plan: string;
  createdAt: Date;
}

/** The workspace a console page is about, or a 404. Shared by the tab layout and every tab. */
export async function loadWorkspace(id: string): Promise<WorkspaceRow> {
  const tenant = await tenantById(id);
  if (!tenant) notFound();
  const rows = (await ownerSql()<{ plan: string; created_at: Date }[]>`
    select plan, created_at from platform.tenants where id = ${id}`) as unknown as {
    plan: string;
    created_at: Date;
  }[];
  const row = rows[0];
  if (!row) notFound();
  return { tenant, plan: row.plan, createdAt: row.created_at };
}

export const TABS = [
  { slug: "", label: "Overview" },
  { slug: "users", label: "Users" },
  { slug: "modules", label: "Modules" },
  { slug: "features", label: "Features" },
  { slug: "integrations", label: "Integrations" },
  { slug: "usage", label: "Usage" },
  { slug: "security", label: "Security" },
  { slug: "settings", label: "Settings" },
] as const;

export const tabHref = (id: string, slug: string) => `/super-admin/workspaces/${id}${slug ? `/${slug}` : ""}`;

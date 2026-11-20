import type { ReactNode } from "react";
import { requireOperator } from "@/lib/platform-auth";
import { ConsoleShell } from "../../shell";
import { WorkspacePill } from "../../ui";
import { TabBar } from "../../nav";
import { StatusForm } from "../../forms";
import { loadWorkspace, TABS, tabHref } from "./workspace";

export const dynamic = "force-dynamic";

/**
 * The frame every workspace tab shares: who it is, whether it is running, and the tabs. Each tab
 * is its own address, so a link to a workspace's Integrations is a link somebody can send.
 */
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const op = await requireOperator();
  const { id } = await params;
  const { tenant, plan } = await loadWorkspace(id);

  return (
    <ConsoleShell
      operator={op}
      title={tenant.name}
      crumbs={[{ label: "Workspaces", href: "/super-admin/workspaces" }, { label: tenant.name }]}
      description={
        <span className="font-mono text-sm">
          /t/{tenant.slug} · schema {tenant.dataSchema} · role {tenant.dbRole ?? "shared"} · plan {plan}
        </span>
      }
      actions={
        <div className="flex items-center gap-3">
          <WorkspacePill status={tenant.status} />
          {op.role === "owner" && <StatusForm id={tenant.id} status={tenant.status} />}
        </div>
      }
    >
      <TabBar tabs={TABS.map((t) => ({ href: tabHref(id, t.slug), label: t.label }))} />
      <div className="pt-6">{children}</div>
    </ConsoleShell>
  );
}

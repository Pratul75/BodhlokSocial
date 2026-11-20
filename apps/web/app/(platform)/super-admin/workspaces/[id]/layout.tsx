import type { ReactNode } from "react";
import { requireWorkspaceAdmin } from "@/lib/workspace-admin";
import { ConsoleShell } from "../../shell";
import { WorkspacePill } from "../../ui";
import { TabBar } from "../../nav";
import { StatusForm } from "../../forms";
import { TABS, tabHref } from "./workspace";
import { AgencyWorkspaceFrame } from "./agency-frame";

export const dynamic = "force-dynamic";

/**
 * The frame every workspace tab shares: who it is, whether it is running, and the tabs. Each tab
 * is its own address, so a link to a workspace's Integrations is a link somebody can send.
 *
 * Two people reach these pages — a platform operator and the agency that holds the workspace —
 * and they get the same tabs inside a different frame. The operator keeps the console around
 * them; the agency stays in the app, where the rest of their day is.
 */
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { viewer, tenant, plan } = await requireWorkspaceAdmin(id);
  const tabs = TABS.map((t) => ({ href: tabHref(id, t.slug, viewer.base), label: t.label }));

  if (viewer.kind === "agency") {
    return (
      <AgencyWorkspaceFrame id={tenant.id} name={tenant.name} status={tenant.status} org={viewer.org?.name ?? ""} tabs={tabs}>
        {children}
      </AgencyWorkspaceFrame>
    );
  }

  return (
    <ConsoleShell
      operator={viewer.operator!}
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
          {viewer.canSuspend && <StatusForm id={tenant.id} status={tenant.status} />}
        </div>
      }
    >
      <TabBar tabs={tabs} />
      <div className="pt-6">{children}</div>
    </ConsoleShell>
  );
}

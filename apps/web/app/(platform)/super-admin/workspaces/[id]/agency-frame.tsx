import type { ReactNode } from "react";
import { WorkspacePill } from "../../ui";
import { TabBar } from "../../nav";
import { SwitchIntoClient } from "@/components/switch-into-client";
import { AgencyShell } from "@/app/(org)/org/shell";

/**
 * The same workspace tabs the platform console shows, inside the agency's own frame.
 *
 * No plumbing in the heading: an agency has no use for a schema name or a database role, and
 * showing them would only invite questions nobody there can answer.
 */
export function AgencyWorkspaceFrame({
  id,
  name,
  status,
  org,
  workspaceName,
  email,
  clients,
  tabs,
  children,
}: {
  id: string;
  name: string;
  status: string;
  org: string;
  workspaceName: string;
  email: string;
  clients: number;
  tabs: { href: string; label: string }[];
  children: ReactNode;
}) {
  return (
    <AgencyShell
      orgName={org}
      workspaceName={workspaceName}
      email={email}
      clients={clients}
      title={name}
      crumbs={[{ label: "My clients", href: "/org/clients" }, { label: name }]}
      actions={
        <div className="flex items-center gap-3">
          <WorkspacePill status={status} />
          <SwitchIntoClient tenantId={id} name={name} />
        </div>
      }
    >
      <TabBar tabs={tabs} />
      <div className="pt-6">{children}</div>
    </AgencyShell>
  );
}

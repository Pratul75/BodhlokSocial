import { WorkspaceGuard } from "@/components/workspace-guard";
import { requireOrgAdmin } from "@/lib/org-auth";

/**
 * The agency's own panel sits outside the workspace shell on purpose: it is about the agency,
 * not about the workspace somebody happens to be in. The workspace guard comes along anyway —
 * this page was rendered for one workspace's session, and switching elsewhere makes it stale
 * exactly as it would any other page.
 */
export default async function OrgLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireOrgAdmin();
  return (
    <div className="min-h-dvh bg-paper">
      <WorkspaceGuard tenantId={user.tenant.id} tenantName={user.tenant.name} />
      {children}
    </div>
  );
}

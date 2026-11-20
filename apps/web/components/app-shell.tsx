import { count, eq } from "drizzle-orm";
import { approvals, auditLog, db } from "@bodh/db";
import { modulesForRole, ROLE_LABELS, ROLES } from "@bodh/shared";
import { allowed, enterTenantScope, getCurrentUser } from "@/lib/auth";
import { PRODUCT_NAME } from "@/lib/legal";
import { setDevRole } from "@/app/(app)/actions";
import { LogOut } from "lucide-react";
import { runsThisAgency } from "@/lib/org-auth";
import { openableWorkspaces } from "@/lib/workspaces";
import { KundliMark } from "./kundli-mark";
import { WorkspaceGuard } from "./workspace-guard";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { SidebarNav } from "./sidebar-nav";
import { RoleSelect } from "./role-select";
import { StopImpersonationForm } from "@/app/(platform)/super-admin/forms";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = enterTenantScope(await getCurrentUser());
  const [[pending], [seeded]] = await Promise.all([
    db.select({ n: count() }).from(approvals).where(eq(approvals.status, "pending")),
    // The seed leaves this row; removing the sample data deletes it. No env flag to forget.
    db.select({ n: count() }).from(auditLog).where(eq(auditLog.action, "seed_sample_data")),
  ]);
  // The sidebar shows what the role allows, narrowed by what this tenant is entitled to.
  // A module that is off is absent, rather than shown and refused.
  const nav = modulesForRole(user.role)
    .filter((m) => allowed(user, m.key))
    .map((m) => ({
      href: m.href,
      label: m.label,
      group: m.group,
      badge: m.key === "approvals" && pending && pending.n > 0 ? pending.n : undefined,
    }));
  const demo = (seeded?.n ?? 0) > 0;
  // Only somebody with more than one workspace in this agency gets a switcher; for everyone
  // else the corner stays exactly what it was. An operator looking inside a workspace is not
  // one of its people and has nowhere to switch to.
  const openable = user.impersonatedBy ? [] : await openableWorkspaces(user.email, user.tenant);
  // The agency's own panel, shown only to whoever runs this agency. Showing the way in is not
  // what grants it: /org asks the control plane again on every request.
  const agency = await runsThisAgency(user);
  if (agency) nav.push({ href: "/org", label: "My clients", group: "Settings", badge: undefined });

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <WorkspaceGuard tenantId={user.tenant.id} tenantName={user.tenant.name} />
      <aside className="bg-night text-white lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="shrink-0 text-turmeric">
            <KundliMark />
          </span>
          {openable.length > 1 ? (
            <div className="min-w-0 flex-1">
              <WorkspaceSwitcher
                current={{ id: user.tenant.id, name: user.tenant.name }}
                options={openable.map((w) => ({ id: w.id, name: w.name }))}
                product={PRODUCT_NAME}
              />
            </div>
          ) : (
            <div className="min-w-0 leading-tight">
              <div className="truncate font-display text-[17px] font-semibold tracking-tight">{user.tenant.name}</div>
              <div className="text-[11px] text-night-3">{PRODUCT_NAME}</div>
            </div>
          )}
        </div>
        <SidebarNav items={nav} />
        <div className="hidden items-center justify-between gap-2 border-t border-white/10 px-5 py-4 text-xs text-night-3 lg:flex">
          <div className="min-w-0">
            <div className="truncate font-medium text-white">{user.name}</div>
            <div>{ROLE_LABELS[user.role]}</div>
          </div>
          {!user.devMode && (
            <form action="/api/auth/signout" method="post">
              <button className="rounded-md p-1.5 hover:bg-night-2 hover:text-white" aria-label="Sign out" title="Sign out">
                <LogOut size={16} />
              </button>
            </form>
          )}
        </div>
      </aside>

      <div className="min-w-0">
        {user.impersonatedBy && (
          // Nobody should be able to forget whose data this is, or that it cannot be changed.
          <div className="flex flex-wrap items-center justify-between gap-3 bg-critical px-4 py-2 text-sm text-white sm:px-8">
            <span>
              {user.impersonatedBy} is looking inside <strong>{user.tenant.name}</strong> as {user.email}. Read-only:
              nothing here can be approved, changed or spent.
            </span>
            <StopImpersonationForm />
          </div>
        )}
        <header className={`flex flex-wrap items-center justify-end gap-3 border-b border-rule bg-card/70 px-4 py-2.5 backdrop-blur sm:px-8 ${!demo && !user.devMode ? "lg:hidden" : ""}`}>
          {demo && (
            <span className="rounded-full bg-turmeric-soft px-2.5 py-0.5 text-xs font-medium text-turmeric-ink">
              Sample data
            </span>
          )}
          {!user.devMode && (
            <form action="/api/auth/signout" method="post" className="lg:hidden">
              <button className="text-xs text-muted hover:text-ink">Sign out</button>
            </form>
          )}
          {user.devMode && (
            <RoleSelect
              action={setDevRole}
              value={user.role}
              options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
            />
          )}
        </header>
        <main className="mx-auto max-w-[1240px] px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}

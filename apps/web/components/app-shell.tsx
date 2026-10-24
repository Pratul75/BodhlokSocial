import { count, eq } from "drizzle-orm";
import { approvals, db } from "@bodh/db";
import { modulesForRole, ROLE_LABELS, ROLES } from "@bodh/shared";
import { getCurrentUser } from "@/lib/auth";
import { setDevRole } from "@/app/actions";
import { KundliMark } from "./kundli-mark";
import { SidebarNav } from "./sidebar-nav";
import { RoleSelect } from "./role-select";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const [pending] = await db.select({ n: count() }).from(approvals).where(eq(approvals.status, "pending"));
  const nav = modulesForRole(user.role).map((m) => ({
    href: m.href,
    label: m.label,
    group: m.group,
    badge: m.key === "approvals" && pending && pending.n > 0 ? pending.n : undefined,
  }));
  const demo = process.env.DEMO_DATA === "true";

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="bg-night text-white lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="text-turmeric">
            <KundliMark />
          </span>
          <div className="leading-tight">
            <div className="font-display text-[17px] font-semibold tracking-tight">BODH Growth</div>
            <div className="text-[11px] text-night-3">Asttrolok marketing</div>
          </div>
        </div>
        <SidebarNav items={nav} />
        <div className="hidden border-t border-white/10 px-5 py-4 text-xs text-night-3 lg:block">
          <div className="font-medium text-white">{user.name}</div>
          <div>{ROLE_LABELS[user.role]}</div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-end gap-3 border-b border-rule bg-card/70 px-4 py-2.5 backdrop-blur sm:px-8">
          {demo && (
            <span className="rounded-full bg-turmeric-soft px-2.5 py-0.5 text-xs font-medium text-turmeric-ink">
              Sample data
            </span>
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

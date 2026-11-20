"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { signOutOperator } from "./signin/actions";

interface Item {
  href: string;
  label: string;
  group: string;
  badge?: number;
  /** Matches only this exact path; otherwise a prefix match marks the section active. */
  exact?: boolean;
}

/**
 * The console's rail. Built the same way as the tenant app's, down to the rotated diamond on the
 * active row, so the two feel like one product rather than two that happen to share a database.
 */
export function ConsoleNav({ workspaces, operators }: { workspaces: number; operators: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const items: Item[] = [
    { href: "/super-admin", label: "Overview", group: "Platform", exact: true },
    { href: "/super-admin/workspaces", label: "Workspaces", group: "Platform", badge: workspaces },
    { href: "/super-admin/operators", label: "Operators", group: "People", badge: operators },
    { href: "/super-admin/audit", label: "Audit log", group: "People" },
  ];
  const groups = [...new Set(items.map((i) => i.group))];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="absolute top-5 right-4 rounded-md p-1.5 text-night-3 hover:bg-night-2 hover:text-white lg:hidden"
        aria-expanded={open}
        aria-label={open ? "Close menu" : "Open menu"}
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>
      <nav className={`${open ? "block" : "hidden"} px-3 pb-4 lg:block`} aria-label="Console sections">
        {groups.map((group) => (
          <div key={group} className="mb-3">
            <div className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-night-3 uppercase">{group}</div>
            <ul>
              {items
                .filter((i) => i.group === group)
                .map((item) => {
                  const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors ${
                          active ? "bg-night-2 text-white" : "text-white/75 hover:bg-night-2/60 hover:text-white"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={`h-1.5 w-1.5 rotate-45 ${active ? "bg-turmeric" : "bg-transparent"}`}
                            aria-hidden="true"
                          />
                          {item.label}
                        </span>
                        {item.badge !== undefined && (
                          <span className="rounded-full bg-night-2 px-1.5 text-[11px] font-semibold text-white tabular">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}

/** Who is signed in, and the way out. */
export function OperatorMenu({ email, role, hasPassword }: { email: string; role: string; hasPassword: boolean }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      {!hasPassword && (
        <Link
          href="/super-admin/operators"
          className="rounded-full bg-turmeric-soft px-2.5 py-0.5 text-xs font-medium text-turmeric-ink"
        >
          No password set
        </Link>
      )}
      <span className="hidden text-muted sm:inline">
        {email} · <span className="capitalize">{role}</span>
      </span>
      <form action={signOutOperator}>
        <button
          className="flex items-center gap-1.5 rounded-lg border border-rule px-2.5 py-1.5 text-xs font-medium hover:bg-paper"
          title="Sign out"
        >
          <LogOut size={14} />
          Sign out
        </button>
      </form>
    </div>
  );
}

/**
 * The tabs inside a workspace. Real links, so each tab is an address somebody can send; the
 * current one is found from the path rather than passed down, which keeps the server layout
 * from having to know which child it is rendering.
 */
export function TabBar({ tabs }: { tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace sections" className="-mb-px flex gap-1 overflow-x-auto border-b border-rule">
      {tabs.map((t) => {
        const on = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
              on ? "border-night text-ink" : "border-transparent text-muted hover:border-rule hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

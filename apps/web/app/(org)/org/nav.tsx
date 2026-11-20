"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";

/**
 * The agency's rail, built the same way the platform console's is — down to the rotated diamond
 * on the active row — because the two are one product and somebody moving between them should
 * not have to relearn anything.
 */
export function AgencyNav({ clients }: { clients: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // The console's rail, asked about one agency. Same groups, same order: Super Admin's
  // Workspaces are this agency's clients, and everything it can see about a workspace the
  // agency can see about its own.
  const items = [
    { href: "/org", label: "Overview", group: "Agency", badge: undefined as number | undefined, exact: true },
    { href: "/org/clients", label: "My clients", group: "Agency", badge: clients, exact: false },
    { href: "/org/usage", label: "Token use", group: "Agency", badge: undefined as number | undefined, exact: false },
    { href: "/org/team", label: "Who runs this agency", group: "People", badge: undefined as number | undefined, exact: false },
    { href: "/org/audit", label: "Audit log", group: "People", badge: undefined as number | undefined, exact: false },
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
      <nav className={`${open ? "block" : "hidden"} px-3 pb-4 lg:block`} aria-label="Agency sections">
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

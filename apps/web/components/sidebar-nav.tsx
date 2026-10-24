"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";

interface Item {
  href: string;
  label: string;
  group: string;
  badge?: number;
}

export function SidebarNav({ items }: { items: Item[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
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
      <nav className={`${open ? "block" : "hidden"} px-3 pb-4 lg:block`} aria-label="Modules">
        {groups.map((group) => (
          <div key={group} className="mb-3">
            {group !== "Overview" && (
              <div className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-night-3 uppercase">{group}</div>
            )}
            <ul>
              {items
                .filter((i) => i.group === group)
                .map((item) => {
                  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
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
                          <span className="rounded-full bg-turmeric px-1.5 text-[11px] font-semibold text-night tabular">
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

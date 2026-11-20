"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { switchWorkspace, type SwitchResult } from "@/app/(app)/switch-workspace";

export interface SwitchableWorkspace {
  id: string;
  name: string;
}

/**
 * The workspace name in the corner, turned into the way out of it.
 *
 * Only rendered when there is more than one to go to — somebody who belongs to a single
 * workspace sees exactly what they saw before, with nothing to click.
 *
 * Each choice submits a form rather than following a link. A link is a `GET`: a prefetch, a
 * reload or an old tab could fire it, and this changes which workspace every later request
 * belongs to.
 */
export function WorkspaceSwitcher({
  current,
  options,
  product,
}: {
  current: SwitchableWorkspace;
  options: SwitchableWorkspace[];
  product: string;
}) {
  const [state, action, pending] = useActionState<SwitchResult, FormData>(switchWorkspace, null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={pending}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-night-2 disabled:opacity-60"
      >
        <span className="min-w-0 leading-tight">
          <span className="block truncate font-display text-[17px] font-semibold tracking-tight">{current.name}</span>
          <span className="block text-[11px] text-night-3">{pending ? "Switching…" : product}</span>
        </span>
        <ChevronsUpDown size={14} className="ml-auto shrink-0 text-night-3" aria-hidden="true" />
      </button>

      {open && !pending && (
        <div role="menu" className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-white/10 bg-night-2 py-1 shadow-xl">
          {options.map((w) => (
            <form key={w.id} action={action}>
              <input type="hidden" name="tenantId" value={w.id} />
              {/*
                Deliberately no onClick that closes the menu. The menu is conditionally
                rendered, so closing it here unmounts this very form and the submission is
                cancelled before it leaves the browser — the button appears to do nothing. The
                switch redirects on its own; until it does, the trigger says "Switching…".
              */}
              <button
                type="submit"
                role="menuitem"
                disabled={pending}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white/85 hover:bg-white/10 disabled:opacity-60"
              >
                <span className="w-3.5 shrink-0">
                  {w.id === current.id && <Check size={14} aria-hidden="true" />}
                </span>
                <span className="truncate">{w.name}</span>
              </button>
            </form>
          ))}
        </div>
      )}

      {state?.error && (
        <p role="alert" className="mt-1 px-2 text-[11px] text-turmeric">
          {state.error}
        </p>
      )}
    </div>
  );
}

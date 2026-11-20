"use client";

import { useActionState } from "react";
import { switchWorkspace, type SwitchResult } from "@/app/(app)/switch-workspace";

/** Walks into a client the agency has an account in — the switcher, as a button. */
export function SwitchIntoClient({ tenantId, name }: { tenantId: string; name: string }) {
  const [state, action, pending] = useActionState<SwitchResult, FormData>(switchWorkspace, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="tenantId" value={tenantId} />
      <button
        disabled={pending}
        className="rounded-lg bg-night px-3 py-2 text-sm font-medium text-white hover:bg-night-2 disabled:opacity-60"
      >
        {pending ? "Opening…" : `Open ${name}`}
      </button>
      {state?.error && (
        <span role="alert" className="text-xs text-sindoor">
          {state.error}
        </span>
      )}
    </form>
  );
}

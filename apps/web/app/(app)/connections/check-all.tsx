"use client";

import { useActionState } from "react";
import { ShieldCheck } from "lucide-react";
import { checkAllConnections, type ConnResult } from "./actions";
import { btn } from "@/components/ui";

/** Re-checks every stored credential with its provider; each card then shows what the provider said. */
export function CheckAllConnections() {
  const [state, action, pending] = useActionState<ConnResult, FormData>(checkAllConnections, null);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <button className={btn.secondary} disabled={pending}>
        <ShieldCheck size={15} /> {pending ? "Checking with each provider…" : "Check all connections"}
      </button>
      {state && (
        <p className={`max-w-md text-right text-xs ${state.ok ? "text-leaf" : "text-sindoor"}`} role={state.ok ? "status" : "alert"}>
          {state.ok ? state.message : state.error}
        </p>
      )}
    </form>
  );
}

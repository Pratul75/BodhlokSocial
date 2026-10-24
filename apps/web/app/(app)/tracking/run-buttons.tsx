"use client";

import { useActionState } from "react";
import { RefreshCw, Send } from "lucide-react";
import { runTrackingJob, type RunResult } from "./actions";
import { btn } from "@/components/ui";

export function RunButtons() {
  const [state, action, pending] = useActionState<RunResult, FormData>(runTrackingJob, null);
  return (
    <div>
      <form action={action} className="flex flex-wrap gap-2">
        <button name="job" value="rebuild" className={btn.secondary} disabled={pending}>
          <RefreshCw size={15} className={pending ? "animate-spin" : ""} /> Rebuild funnel
        </button>
        <button name="job" value="forward" className={btn.secondary} disabled={pending}>
          <Send size={15} /> Send queued conversions
        </button>
      </form>
      {state && (
        <p className={`mt-2 max-w-md text-xs ${state.ok ? "text-leaf" : "text-sindoor"}`} role={state.ok ? "status" : "alert"}>
          {state.ok ? state.message : state.error}
        </p>
      )}
    </div>
  );
}

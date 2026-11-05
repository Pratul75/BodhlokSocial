"use client";

import { useActionState } from "react";
import { Check } from "lucide-react";
import { btn } from "@/components/ui";
import { approvePlan, type PlanState } from "./actions";

export function ApprovePlanButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<PlanState, FormData>(approvePlan, null);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <button className={btn.approve} disabled={pending}>
        <Check size={16} /> {pending ? "Approving…" : "Approve plan"}
      </button>
      {state && <p className={`text-xs ${state.ok ? "text-leaf" : "text-sindoor"}`} role={state.ok ? "status" : "alert"}>{state.ok ? state.message : state.error}</p>}
    </form>
  );
}

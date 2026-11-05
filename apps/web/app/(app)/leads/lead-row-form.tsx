"use client";

import { useActionState } from "react";
import { updateLead, type LeadState } from "./actions";

const STATUSES = ["new", "contacted", "qualified", "won", "lost"] as const;

export function LeadRowForm({
  id,
  status,
  assignedTo,
  people,
}: {
  id: string;
  status: string;
  assignedTo: string | null;
  people: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<LeadState, FormData>(updateLead, null);
  const sel = "rounded-md border border-rule bg-card px-2 py-1 text-sm disabled:opacity-60";
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-nowrap gap-2">
        <select name="assignedTo" defaultValue={assignedTo ?? ""} className={sel} aria-label="Assigned to" disabled={pending} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
          <option value="">Unassigned</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select name="status" defaultValue={status} className={sel} aria-label="Status" disabled={pending} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      </div>
      {pending && <span className="text-xs text-muted">Saving…</span>}
      {!pending && state && (
        <span className={`text-xs ${state.ok ? "text-leaf" : "text-sindoor"}`} role={state.ok ? "status" : "alert"}>{state.ok ? state.message : state.error}</span>
      )}
    </form>
  );
}

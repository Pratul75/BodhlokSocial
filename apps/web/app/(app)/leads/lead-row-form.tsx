"use client";

import { updateLead } from "./actions";

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
  const sel = "rounded-md border border-rule bg-card px-2 py-1 text-sm";
  return (
    <form action={updateLead} className="flex flex-nowrap gap-2">
      <input type="hidden" name="id" value={id} />
      <select name="assignedTo" defaultValue={assignedTo ?? ""} className={sel} aria-label="Assigned to" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        <option value="">Unassigned</option>
        {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <select name="status" defaultValue={status} className={sel} aria-label="Status" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {["new", "contacted", "qualified", "won", "lost"].map((s) => (
          <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
        ))}
      </select>
    </form>
  );
}

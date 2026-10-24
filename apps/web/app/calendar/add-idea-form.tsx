"use client";

import { useActionState, useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { addIdea, type AddResult } from "./actions";
import { btn, inputClass } from "@/components/ui";

export function AddIdeaForm({
  channels,
  formats,
  defaultDate,
}: {
  channels: { value: string; label: string }[];
  formats: { value: string; label: string }[];
  defaultDate: string;
}) {
  const [state, action, pending] = useActionState<AddResult, FormData>(addIdea, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={action} className="grid gap-3 px-5 py-4 sm:grid-cols-2 md:grid-cols-[repeat(4,minmax(0,1fr))_auto] md:items-end">
      <label className="text-sm sm:col-span-2 md:col-span-5">
        <span className="mb-1 block text-xs text-muted">Idea</span>
        <input name="idea" className={inputClass} placeholder="e.g. Rahu in the 10th house, myths vs texts" required />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted">Channel</span>
        <select name="channel" className={inputClass} defaultValue="instagram">
          {channels.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted">Format</span>
        <select name="format" className={inputClass} defaultValue="reel">
          {formats.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted">Date</span>
        <input type="date" name="date" className={inputClass} defaultValue={defaultDate} required />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted">Time</span>
        <input type="time" name="time" className={inputClass} defaultValue="18:30" required />
      </label>
      <button className={btn.primary} disabled={pending}>
        <Plus size={16} /> Add idea
      </button>
      {state && !state.ok && <p className="text-sm text-sindoor sm:col-span-2 md:col-span-5" role="alert">{state.error}</p>}
      {state?.ok && <p className="text-sm text-leaf sm:col-span-2 md:col-span-5" role="status">Added to the calendar.</p>}
    </form>
  );
}

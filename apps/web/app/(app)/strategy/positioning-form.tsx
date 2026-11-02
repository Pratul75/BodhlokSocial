"use client";

import { useActionState } from "react";
import { RefreshCw, Save } from "lucide-react";
import { savePositioning, type PositioningResult } from "./actions";
import { btn, inputClass } from "@/components/ui";

export function PositioningForm({ positioning, sources, updatedLabel, canEdit, busy }: { positioning: string; sources: string; updatedLabel: string | null; canEdit: boolean; busy: boolean }) {
  const [state, action, pending] = useActionState<PositioningResult, FormData>(savePositioning, null);
  const label = "mb-1 block text-xs text-muted";
  return (
    <form action={action} className="space-y-4 px-5 py-4">
      <fieldset disabled={!canEdit || pending} className="space-y-4">
        <label className="block text-sm">
          <span className={label}>The brief, in your words: who Bodhlok is for, what it claims, what this month is about, what never appears. Paste the launch document or the website's wording here (up to 12,000 characters).</span>
          <textarea
            name="positioning"
            defaultValue={positioning}
            rows={12}
            maxLength={12000}
            className={`${inputClass} leading-relaxed`}
            placeholder={"Bodhlok is professional Vedic astrology software for practising astrologers, serious students, teachers and institutes…\n\nThis month: the launch film. Every post shows the real desk on a sample chart…"}
          />
        </label>
        <label className="block text-sm">
          <span className={label}>Pages the agents should read for the current positioning, one https address per line (bodhlok.com pages, the launch page)</span>
          <textarea name="sources" defaultValue={sources} rows={3} className={`${inputClass} font-mono text-[13px]`} placeholder={"https://bodhlok.com\nhttps://bodhlok.com/for-astrologers"} />
        </label>
      </fieldset>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button name="intent" value="save" className={btn.secondary} disabled={pending}>
            <Save size={15} /> {pending ? "Saving…" : "Save brief"}
          </button>
          <button name="intent" value="replan" className={btn.primary} disabled={pending || busy} title={busy ? "An agent is running; wait for it to finish" : undefined}>
            <RefreshCw size={15} className={pending ? "animate-spin" : ""} /> {pending ? "Starting…" : "Save and re-plan this month"}
          </button>
          {updatedLabel && <span className="text-xs text-muted">Last saved {updatedLabel}</span>}
        </div>
      ) : (
        <p className="text-xs text-muted">Admins and social media managers edit the brief.{updatedLabel ? ` Last saved ${updatedLabel}.` : ""}</p>
      )}
      {state?.ok === false && <p className="text-sm text-sindoor" role="alert">{state.error}</p>}
      {state?.ok && <p className="text-sm text-leaf" role="status">{state.message}</p>}
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { Play } from "lucide-react";
import { mapChannel, runPublisherNow, type PubResult } from "./actions";
import { btn } from "@/components/ui";

function Note({ state }: { state: PubResult }) {
  if (!state) return null;
  return <p className={`mt-1 text-xs ${state.ok ? "text-leaf" : "text-sindoor"}`} role={state.ok ? "status" : "alert"}>{state.ok ? state.message : state.error}</p>;
}

export function ChannelSelect({
  channel,
  label,
  current,
  options,
  canEdit,
}: {
  channel: string;
  label: string;
  current: string;
  options: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<PubResult, FormData>(mapChannel, null);
  return (
    <form action={action}>
      <input type="hidden" name="channel" value={channel} />
      <label className="flex flex-wrap items-center gap-3 text-sm">
        <span className="w-24 font-medium">{label}</span>
        <select
          name="integrationId"
          defaultValue={current}
          disabled={!canEdit || pending}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="min-w-[220px] rounded-md border border-rule bg-card px-2 py-1.5 text-sm"
        >
          <option value="">Not published</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>
      <Note state={state} />
    </form>
  );
}

export function RunPublisherButton() {
  const [state, action, pending] = useActionState<PubResult, FormData>(runPublisherNow, null);
  return (
    <form action={action}>
      <button className={btn.secondary} disabled={pending}><Play size={14} /> {pending ? "Running…" : "Run publisher now"}</button>
      <Note state={state} />
    </form>
  );
}

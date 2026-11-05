"use client";

import { useActionState, useState } from "react";
import { btn, inputClass } from "@/components/ui";
import { addQuestion, toggleQuestion, type JobState } from "./actions";

const Note = ({ state }: { state: JobState }) =>
  state.error ? <p className="text-xs text-sindoor" role="alert">{state.error}</p> : state.message ? <p className="text-xs text-leaf" role="status">{state.message}</p> : null;

export function ToggleQuestion({ id, active }: { id: string; active: boolean }) {
  const [state, action, pending] = useActionState<JobState, FormData>(toggleQuestion, {});
  return (
    <form action={action} className="flex flex-col items-end">
      <input type="hidden" name="id" value={id} />
      <button className="text-xs text-dusk hover:underline" disabled={pending}>{pending ? "…" : active ? "Stop asking" : "Ask again"}</button>
      {state.error && <Note state={state} />}
    </form>
  );
}

export function AddQuestion() {
  const [state, action, pending] = useActionState<JobState, FormData>(addQuestion, {});
  return (
    <form action={action} className="mt-3 space-y-1">
      <div className="flex gap-2">
        <label htmlFor="geo-q" className="sr-only">New question</label>
        <input id="geo-q" name="question" className={inputClass} placeholder="A question your customers ask an AI assistant" minLength={10} maxLength={200} required />
        <button className={btn.secondary} disabled={pending}>{pending ? "Adding…" : "Add"}</button>
      </div>
      <Note state={state} />
    </form>
  );
}

/** The feed token, hidden until an admin chooses to show or copy it. */
export function FeedToken({ token }: { token: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input id="feed-token" readOnly value={shown ? token : "•".repeat(Math.min(token.length, 32))} className={`${inputClass} max-w-md font-mono`} aria-label="Feed token" />
      <button type="button" className={btn.ghost} onClick={() => setShown((s) => !s)}>{shown ? "Hide" : "Show"}</button>
      <button
        type="button"
        className={btn.secondary}
        onClick={async () => {
          await navigator.clipboard.writeText(token).catch(() => undefined);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

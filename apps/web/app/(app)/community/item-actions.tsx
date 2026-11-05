"use client";

import { useActionState } from "react";
import type { JobState } from "@/app/(app)/seo/actions";
import { btn, inputClass } from "@/components/ui";
import { markPosted, retryPost, skipItem } from "./actions";

function Result({ state }: { state: JobState }) {
  if (state.error) return <p className="text-xs text-sindoor" role="alert">{state.error}</p>;
  if (state.message) return <p className="text-xs text-leaf" role="status">{state.message}</p>;
  return null;
}

export function SkipButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<JobState, FormData>(skipItem, {});
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm("Skip this question? The agent won't answer it.")) e.preventDefault();
      }}
      className="flex flex-col items-start gap-1"
    >
      <input type="hidden" name="id" value={id} />
      <button className={`${btn.ghost} px-2 py-1 text-xs`} disabled={pending}>{pending ? "Skipping…" : "Skip"}</button>
      <Result state={state} />
    </form>
  );
}

export function RetryButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<JobState, FormData>(retryPost, {});
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="id" value={id} />
      <button className={`${btn.secondary} px-2 py-1 text-xs`} disabled={pending}>{pending ? "Posting…" : "Try posting again"}</button>
      <Result state={state} />
    </form>
  );
}

export function MarkPostedForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<JobState, FormData>(markPosted, {});
  return (
    <form action={action} className="mt-2 flex flex-col gap-1.5">
      <input type="hidden" name="id" value={id} />
      <label className="text-xs text-muted" htmlFor={`posted-${id}`}>Posted it on Quora? Paste the link to the answer.</label>
      <div className="flex gap-1.5">
        <input id={`posted-${id}`} name="url" type="url" required placeholder="https://www.quora.com/…" className={`${inputClass} py-1 text-xs`} />
        <button className={`${btn.secondary} px-2 py-1 text-xs`} disabled={pending}>{pending ? "Saving…" : "Mark posted"}</button>
      </div>
      <Result state={state} />
    </form>
  );
}

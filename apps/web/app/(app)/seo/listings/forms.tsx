"use client";

import { useActionState } from "react";
import type { JobState } from "@/app/(app)/seo/actions";
import { btn, inputClass } from "@/components/ui";
import { markSubmitted, skipListing } from "./actions";

const Result = ({ state }: { state: JobState }) =>
  state.error ? <p className="text-xs text-sindoor" role="alert">{state.error}</p> : state.message ? <p className="text-xs text-leaf" role="status">{state.message}</p> : null;

export function SubmittedForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<JobState, FormData>(markSubmitted, {});
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <div className="flex gap-1.5">
        <input name="url" type="url" required aria-label="Link to the live listing" placeholder="Link to the live listing" className={`${inputClass} py-1 text-xs`} />
        <button className={`${btn.secondary} px-2 py-1 text-xs`} disabled={pending}>{pending ? "Saving…" : "Submitted"}</button>
      </div>
      <Result state={state} />
    </form>
  );
}

export function SkipListingButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<JobState, FormData>(skipListing, {});
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm("Stop tracking this directory?")) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button className={`${btn.ghost} px-2 py-1 text-xs`} disabled={pending}>{pending ? "…" : "Skip"}</button>
      <Result state={state} />
    </form>
  );
}

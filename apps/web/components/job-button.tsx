"use client";

import { useActionState } from "react";
import type { JobState } from "@/app/(app)/seo/actions";
import { btn } from "./ui";

/** A button that runs a server job and shows its one-line result. */
export function JobButton({
  action,
  job,
  label,
  pendingLabel = "Working…",
  variant = "secondary",
  fields = {},
}: {
  action: (prev: JobState, formData: FormData) => Promise<JobState>;
  job: string;
  label: string;
  pendingLabel?: string;
  variant?: keyof typeof btn;
  /** Extra hidden inputs sent with the job. */
  fields?: Record<string, string>;
}) {
  const [state, run, pending] = useActionState<JobState, FormData>(action, {});
  return (
    <form action={run} className="flex flex-col items-start gap-1">
      <input type="hidden" name="job" value={job} />
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button className={btn[variant]} disabled={pending}>{pending ? pendingLabel : label}</button>
      {state.error && <p className="max-w-xs text-xs text-sindoor">{state.error}</p>}
      {state.message && !state.error && <p className="max-w-xs text-xs text-muted">{state.message}</p>}
    </form>
  );
}

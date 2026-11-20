"use client";

import { useActionState } from "react";
import {
  chooseWorkspace,
  setPasswordFromInvite,
  signInWithPassword,
  type ChooseWorkspaceState,
  type PasswordSignInState,
  type SetPasswordState,
} from "./actions";
import type { WorkspaceChoice } from "@/lib/workspace-choice";

const field =
  "w-full rounded-lg border border-rule bg-card px-3 py-2.5 text-sm text-ink placeholder:text-muted/70 focus:border-dusk focus:outline-none";
const primary =
  "w-full rounded-lg bg-night px-3 py-2.5 text-sm font-medium text-white hover:bg-night-2 disabled:opacity-60";

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-lg bg-sindoor-soft px-3 py-2 text-sm text-sindoor">
      {children}
    </p>
  );
}

/** Email and password, for people whose workspace does not sign in with Google. */
export function PasswordSignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<PasswordSignInState, FormData>(signInWithPassword, null);

  // The password opened more than one account. That is rare — it means the same address was
  // added to more than one workspace — so it is asked only then, never as a step everybody pays.
  if (state && "choose" in state) {
    return <WorkspacePicker choices={state.choose} token={state.token} next={state.next} />;
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Email</span>
        <input name="email" type="email" required autoComplete="username" className={field} placeholder="you@example.com" />
      </label>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Password</span>
        <input name="password" type="password" required autoComplete="current-password" className={field} />
      </label>
      {state?.error && <Problem>{state.error}</Problem>}
      <button disabled={pending} className={primary}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

/**
 * Which workspace they meant, asked only once a sign-in has already opened several.
 *
 * Both doors end here: the password form renders it with the state it got back, and a Google
 * sign-in arrives at /signin?choose=<token> and has the page render it. The token carries the
 * proof either way, so this component holds nothing but the question.
 */
export function WorkspacePicker({ choices, token, next }: { choices: WorkspaceChoice[]; token: string; next: string }) {
  const [state, action, pending] = useActionState<ChooseWorkspaceState, FormData>(chooseWorkspace, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="next" value={next} />
      <p className="text-sm text-muted">
        {choices.length === 1
          ? "One workspace is still open to you. Continue to it?"
          : `You work in ${choices.length} workspaces. Which one are you opening?`}
      </p>
      <div className="space-y-2">
        {choices.map((c) => (
          <button
            key={c.tenantId}
            name="tenantId"
            value={c.tenantId}
            disabled={pending}
            className="flex w-full items-center justify-between rounded-lg border border-rule bg-card px-3 py-2.5 text-left text-sm font-medium hover:bg-paper disabled:opacity-60"
          >
            {c.name}
            <span aria-hidden="true" className="text-muted">&rarr;</span>
          </button>
        ))}
      </div>
      {state?.error && <Problem>{state.error}</Problem>}
      <p className="text-xs text-muted">
        Each one is a separate account. Signing in to one shows only that workspace.
      </p>
    </form>
  );
}

/** Where an invitation or a reset link lands. */
export function SetPasswordForm({ token, name, isReset }: { token: string; name: string; isReset: boolean }) {
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(setPasswordFromInvite, null);
  return (
    <form action={action} className="mt-6 space-y-3">
      <input type="hidden" name="token" value={token} />
      <p className="text-sm text-muted">
        {isReset ? "Choosing a new password for" : "Setting the password for"} {name}.
      </p>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">New password</span>
        <input name="password" type="password" required autoComplete="new-password" className={field} />
      </label>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Again</span>
        <input name="confirm" type="password" required autoComplete="new-password" className={field} />
      </label>
      <p className="text-xs text-muted">At least 12 characters, with letters and a number.</p>
      {state?.error && <Problem>{state.error}</Problem>}
      <button disabled={pending} className={primary}>
        {pending ? "Saving…" : isReset ? "Change password" : "Set password"}
      </button>
    </form>
  );
}

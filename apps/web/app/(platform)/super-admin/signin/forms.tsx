"use client";

import { useActionState } from "react";
import { setPasswordFromToken, signInOperator, type ResetState, type SignInState } from "./actions";

const field =
  "w-full rounded-lg border border-rule bg-card px-3 py-2.5 text-sm text-ink placeholder:text-muted/70 focus:border-dusk focus:outline-none";
const primary =
  "w-full rounded-lg bg-night px-3 py-2.5 text-sm font-medium text-white hover:bg-night-2 disabled:opacity-60";

export function SignInForm({ next, devHint }: { next: string; devHint: boolean }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signInOperator, null);
  return (
    <form action={action} className="mt-6 space-y-3">
      <input type="hidden" name="next" value={next} />
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Email</span>
        <input name="email" type="email" required autoComplete="username" className={field} placeholder="you@example.com" />
      </label>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          className={field}
          placeholder={devHint ? "Leave empty in development" : "Your password"}
        />
      </label>
      {state?.error && (
        <p role="alert" className="rounded-lg bg-sindoor-soft px-3 py-2 text-sm text-sindoor">
          {state.error}
        </p>
      )}
      <button disabled={pending} className={primary}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export function SetPasswordForm({ token, name }: { token: string; name: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(setPasswordFromToken, null);
  return (
    <form action={action} className="mt-6 space-y-3">
      <input type="hidden" name="token" value={token} />
      <p className="text-sm text-muted">Setting a password for {name}.</p>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">New password</span>
        <input name="password" type="password" required autoComplete="new-password" className={field} />
      </label>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Again</span>
        <input name="confirm" type="password" required autoComplete="new-password" className={field} />
      </label>
      <p className="text-xs text-muted">At least 12 characters, with letters and a number.</p>
      {state && "error" in state && (
        <p role="alert" className="rounded-lg bg-sindoor-soft px-3 py-2 text-sm text-sindoor">
          {state.error}
        </p>
      )}
      <button disabled={pending} className={primary}>
        {pending ? "Saving…" : "Set password"}
      </button>
    </form>
  );
}

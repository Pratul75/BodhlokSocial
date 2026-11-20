"use client";

import { useActionState } from "react";
import {
  addUser,
  issueSignInLink,
  removeUserPassword,
  saveWorkspaceSetting,
  setActive,
  setCaps,
  setRole,
  type AdminLinkResult,
  type AdminResult,
} from "./actions";
import { btn, inputClass } from "@/components/ui";
import { CopyLink } from "@/components/copy-link";

export function RoleForm({ id, role, roles, self }: { id: string; role: string; roles: { value: string; label: string }[]; self: boolean }) {
  const [state, action, pending] = useActionState<AdminResult, FormData>(setRole, null);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <select
        name="role"
        defaultValue={role}
        disabled={self || pending}
        aria-label="Role"
        title={self ? "You can't change your own role" : undefined}
        className="rounded-md border border-rule bg-card px-2 py-1 text-sm disabled:opacity-60"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
      <Inline state={state} pending={pending} />
    </form>
  );
}

function Inline({ state, pending }: { state: AdminResult; pending: boolean }) {
  if (pending) return <span className="text-xs text-muted">Saving…</span>;
  if (!state) return null;
  return <span className={`text-xs ${state.ok ? "text-leaf" : "text-sindoor"}`} role={state.ok ? "status" : "alert"}>{state.ok ? state.message : state.error}</span>;
}

function Message({ state }: { state: AdminResult }) {
  if (!state) return null;
  return <p className={`text-sm ${state.ok ? "text-leaf" : "text-sindoor"}`} role={state.ok ? "status" : "alert"}>{state.ok ? state.message : state.error}</p>;
}

export function AddUserForm({ roles, domain }: { roles: { value: string; label: string }[]; domain: string }) {
  const [state, action, pending] = useActionState<AdminResult, FormData>(addUser, null);
  return (
    <form action={action} className="grid gap-2 px-5 py-4 sm:grid-cols-[1fr_1fr_170px_auto] sm:items-end">
      <label className="text-sm"><span className="mb-1 block text-xs text-muted">Name</span><input name="name" className={inputClass} required /></label>
      <label className="text-sm"><span className="mb-1 block text-xs text-muted">Email</span><input name="email" type="email" className={inputClass} placeholder={`name@${domain}`} required /></label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted">Role</span>
        <select name="role" className={inputClass} defaultValue="social_manager">
          {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </label>
      <button className={btn.primary} disabled={pending}>Add person</button>
      <div className="sm:col-span-4"><Message state={state} /></div>
    </form>
  );
}

export function CapsForm({ platform, label, dailyCap, monthlyCap }: { platform: string; label: string; dailyCap: number; monthlyCap: number }) {
  const [state, action, pending] = useActionState<AdminResult, FormData>(setCaps, null);
  return (
    <form action={action} className="grid gap-2 px-5 py-3 sm:grid-cols-[140px_1fr_1fr_auto] sm:items-end">
      <input type="hidden" name="platform" value={platform} />
      <div className="text-sm font-medium sm:pb-2">{label}</div>
      <label className="text-sm"><span className="mb-1 block text-xs text-muted">Daily cap (₹)</span><input name="dailyCap" type="number" min={0} step={100} defaultValue={dailyCap} className={`${inputClass} font-mono`} /></label>
      <label className="text-sm"><span className="mb-1 block text-xs text-muted">Monthly cap (₹)</span><input name="monthlyCap" type="number" min={0} step={1000} defaultValue={monthlyCap} className={`${inputClass} font-mono`} /></label>
      <button className={btn.secondary} disabled={pending}>Save caps</button>
      <div className="sm:col-span-4"><Message state={state} /></div>
    </form>
  );
}

export function AccessForm({ id, name, active, self }: { id: string; name: string; active: boolean; self: boolean }) {
  const [state, action, pending] = useActionState<AdminResult, FormData>(setActive, null);
  if (self) return null;
  return (
    <form
      action={action}
      className="flex flex-col items-start gap-1"
      onSubmit={(e) => {
        if (active && !window.confirm(`Remove ${name}'s access? They are signed out and can't sign in until an admin restores it.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <button className={active ? "text-xs text-sindoor hover:underline" : "text-xs text-leaf hover:underline"} disabled={pending}>
        {active ? "Remove access" : "Restore access"}
      </button>
      <Inline state={state} pending={pending} />
    </form>
  );
}

/** One of this workspace's own configuration values. */
export function WorkspaceSettingForm({
  settingKey,
  label,
  value,
  hint,
  inherited,
}: {
  settingKey: string;
  label: string;
  value: string;
  hint?: string;
  inherited: boolean;
}) {
  const [state, action, pending] = useActionState<AdminResult, FormData>(saveWorkspaceSetting, null);
  return (
    <form action={action} className="grid gap-2 px-5 py-3 sm:grid-cols-[200px_1fr_auto] sm:items-end">
      <input type="hidden" name="key" value={settingKey} />
      <div className="text-sm font-medium sm:pb-2">
        {label}
        {inherited && <span className="ml-2 text-xs text-muted">from the server</span>}
      </div>
      <label className="text-sm">
        {hint && <span className="mb-1 block text-xs text-muted">{hint}</span>}
        <input name="value" defaultValue={value} className={`${inputClass} font-mono`} />
      </label>
      <button className={btn.secondary} disabled={pending}>
        Save
      </button>
      <div className="sm:col-span-3">
        <Message state={state} />
      </div>
    </form>
  );
}

/**
 * The password half of someone's access.
 *
 * Everyone can sign in with Google. This is for the people who can't or won't: an admin makes a
 * one-time link, hands it over, and they choose their own password — the admin never sees it.
 */
export function PasswordForm({ id, name, email, hasPassword, self }: { id: string; name: string; email: string; hasPassword: boolean; self: boolean }) {
  const [link, issue, issuing] = useActionState<AdminLinkResult, FormData>(issueSignInLink, null);
  const [cleared, clear, clearing] = useActionState<AdminResult, FormData>(removeUserPassword, null);
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <form action={issue}>
          <input type="hidden" name="id" value={id} />
          <button className="text-xs text-dusk hover:underline" disabled={issuing}>
            {issuing ? "Making a link…" : hasPassword ? "Reset password" : "Set up a password"}
          </button>
        </form>
        {hasPassword && !self && (
          <form
            action={clear}
            onSubmit={(e) => {
              if (!window.confirm(`Remove ${name}'s password? They're signed out, and sign in with Google after that.`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="id" value={id} />
            <button className="text-xs text-sindoor hover:underline" disabled={clearing}>Remove password</button>
          </form>
        )}
      </div>
      {link?.ok && link.value && (
        <CopyLink href={link.value} note={link.message} label={`One-time password link for ${email}`} />
      )}
      {link && !link.ok && <span className="text-xs text-sindoor" role="alert">{link.error}</span>}
      <Inline state={cleared} pending={clearing} />
    </div>
  );
}

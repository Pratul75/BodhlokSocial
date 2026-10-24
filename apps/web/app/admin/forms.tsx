"use client";

import { useActionState } from "react";
import { addUser, setCaps, setRole, type AdminResult } from "./actions";
import { btn, inputClass } from "@/components/ui";

export function RoleForm({ id, role, roles, self }: { id: string; role: string; roles: { value: string; label: string }[]; self: boolean }) {
  return (
    <form action={setRole}>
      <input type="hidden" name="id" value={id} />
      <select
        name="role"
        defaultValue={role}
        disabled={self}
        aria-label="Role"
        title={self ? "You can't change your own role" : undefined}
        className="rounded-md border border-rule bg-card px-2 py-1 text-sm disabled:opacity-60"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
    </form>
  );
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

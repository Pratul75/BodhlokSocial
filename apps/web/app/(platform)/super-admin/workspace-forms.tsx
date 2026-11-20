"use client";

import { useActionState, useState } from "react";
import {
  applyAccessPreset,
  clearWorkspacePassword,
  inviteWorkspaceUser,
  issueWorkspacePasswordLink,
  renameWorkspace,
  setCapacity,
  setWorkspacePlan,
  setWorkspaceSetting,
  setWorkspaceUserActive,
  setWorkspaceUserRole,
  type WorkspaceLinkResult,
  type WorkspaceResult,
} from "./workspace-actions";
import type { PresetChange } from "./access-presets";
import { CopyLink } from "@/components/copy-link";

const field =
  "w-full rounded-lg border border-rule bg-card px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-dusk focus:outline-none";
const secondary = "rounded-lg border border-rule bg-card px-3 py-2 text-sm font-medium hover:bg-paper disabled:opacity-60";
const primary = "rounded-lg bg-night px-3 py-2 text-sm font-medium text-white hover:bg-night-2 disabled:opacity-60";

function Note({ state }: { state: WorkspaceResult }) {
  if (!state) return null;
  return state.ok ? (
    <p className="text-sm text-leaf">{state.message}</p>
  ) : (
    <p role="alert" className="text-sm text-sindoor">
      {state.error}
    </p>
  );
}

export function InviteUserForm({ tenantId, roles }: { tenantId: string; roles: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState<WorkspaceResult, FormData>(inviteWorkspaceUser, null);
  return (
    <form action={action} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_1fr_160px_auto] sm:items-end">
      <input type="hidden" name="tenantId" value={tenantId} />
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Name</span>
        <input name="name" required className={field} placeholder="Their name" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Email</span>
        <input name="email" type="email" required className={field} placeholder="someone@example.com" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Role</span>
        <select name="role" defaultValue="social_manager" className={field}>
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <button disabled={pending} className={primary}>
        {pending ? "Adding…" : "Add person"}
      </button>
      <div className="sm:col-span-4">
        <Note state={state} />
      </div>
    </form>
  );
}

export function UserRoleForm({
  tenantId,
  userId,
  role,
  roles,
}: {
  tenantId: string;
  userId: string;
  role: string;
  roles: { value: string; label: string }[];
}) {
  const [state, action, pending] = useActionState<WorkspaceResult, FormData>(setWorkspaceUserRole, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="userId" value={userId} />
      <select name="role" defaultValue={role} className={`${field} w-auto py-1.5`} disabled={pending}>
        {roles.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <button disabled={pending} className="text-xs text-dusk hover:underline disabled:opacity-60">
        {pending ? "…" : "Save"}
      </button>
      {state && !state.ok && <span className="text-xs text-sindoor">{state.error}</span>}
    </form>
  );
}

export function UserAccessForm({
  tenantId,
  userId,
  email,
  active,
}: {
  tenantId: string;
  userId: string;
  email: string;
  active: boolean;
}) {
  const [state, action, pending] = useActionState<WorkspaceResult, FormData>(setWorkspaceUserActive, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (active && !window.confirm(`Remove ${email}'s access? They are signed out everywhere.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="active" value={String(!active)} />
      <button disabled={pending} className={`text-xs hover:underline disabled:opacity-60 ${active ? "text-sindoor" : "text-dusk"}`}>
        {pending ? "…" : active ? "Remove access" : "Restore access"}
      </button>
      {state && !state.ok && <span className="ml-2 text-xs text-sindoor">{state.error}</span>}
    </form>
  );
}

export function AccessPresetForm({
  tenantId,
  current,
  changes,
}: {
  tenantId: string;
  current: string;
  /** What each preset would do to this workspace right now, worked out on the server. */
  changes: Record<"full" | "essentials", PresetChange>;
}) {
  const [state, action, pending] = useActionState<WorkspaceResult, FormData>(applyAccessPreset, null);
  const [show, setShow] = useState<"full" | "essentials" | null>(null);
  const change = show ? changes[show] : null;

  return (
    <div className="px-5 py-4">
      <p className="text-sm text-muted">
        Currently <span className="font-medium text-ink capitalize">{current}</span>. A preset is a
        whole configuration, not an addition — it sets every module and every feature, so anything
        switched on by hand that it does not include goes off.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(["full", "essentials"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setShow(show === p ? null : p)}
            disabled={pending || current === p}
            className={secondary}
          >
            {current === p ? `${p === "full" ? "Full" : "Essentials"} (current)` : `Preview ${p === "full" ? "Full" : "Essentials"}`}
          </button>
        ))}
        <span className="text-xs text-muted">Switching anything by hand makes it Custom.</span>
      </div>

      {show && change && (
        <form action={action} className="mt-3 rounded-lg border border-rule bg-paper px-4 py-3">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="preset" value={show} />
          <p className="text-sm font-medium">
            Applying {show === "full" ? "Full" : "Essentials"} to this workspace would:
          </p>

          {change.turningOff.length > 0 ? (
            <p className="mt-2 text-sm">
              <span className="font-medium text-critical">Switch off {change.turningOff.length}:</span>{" "}
              <span className="text-muted">{change.turningOff.join(", ")}</span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted">Switch nothing off.</p>
          )}

          {change.turningOn.length > 0 ? (
            <p className="mt-1 text-sm">
              <span className="font-medium text-leaf">Switch on {change.turningOn.length}:</span>{" "}
              <span className="text-muted">{change.turningOn.join(", ")}</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">Switch nothing on.</p>
          )}

          <p className="mt-1 text-xs text-muted">{change.unchanged} already as the preset wants them.</p>

          <div className="mt-3 flex items-center gap-2">
            <button disabled={pending} className={primary}>
              {pending ? "Applying…" : `Apply ${show === "full" ? "Full" : "Essentials"}`}
            </button>
            <button type="button" onClick={() => setShow(null)} className={secondary}>
              Cancel
            </button>
          </div>
          <div className="mt-2">
            <Note state={state} />
          </div>
        </form>
      )}

      {!show && (
        <div className="mt-2">
          <Note state={state} />
        </div>
      )}
    </div>
  );
}

export function CapacityForm({
  tenantId,
  capacityKey,
  label,
  value,
  fallback,
  hint,
}: {
  tenantId: string;
  capacityKey: string;
  label: string;
  value: string;
  fallback: string;
  hint?: string;
}) {
  const [state, action, pending] = useActionState<WorkspaceResult, FormData>(setCapacity, null);
  return (
    <form action={action} className="grid gap-2 border-b border-rule/60 px-5 py-3 last:border-0 sm:grid-cols-[260px_1fr_auto] sm:items-center">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="key" value={capacityKey} />
      <div className="text-sm font-medium">
        {label}
        {hint && <p className="mt-0.5 text-xs font-normal text-muted">{hint}</p>}
      </div>
      <input
        name="value"
        defaultValue={value}
        placeholder={`default ${fallback}`}
        inputMode="decimal"
        className={`${field} font-mono`}
      />
      <button disabled={pending} className={secondary}>
        {pending ? "…" : "Save"}
      </button>
      <div className="sm:col-span-3">
        <Note state={state} />
      </div>
    </form>
  );
}

export function WorkspaceSettingForm({
  tenantId,
  settingKey,
  label,
  value,
  hint,
  inherited,
}: {
  tenantId: string;
  settingKey: string;
  label: string;
  value: string;
  hint?: string;
  inherited: boolean;
}) {
  const [state, action, pending] = useActionState<WorkspaceResult, FormData>(setWorkspaceSetting, null);
  return (
    <form action={action} className="grid gap-2 border-b border-rule/60 px-5 py-3 last:border-0 sm:grid-cols-[260px_1fr_auto] sm:items-center">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="key" value={settingKey} />
      <div className="text-sm font-medium">
        {label}
        {inherited && <span className="ml-2 text-xs font-normal text-muted">from the server</span>}
        {hint && <p className="mt-0.5 text-xs font-normal text-muted">{hint}</p>}
      </div>
      <input name="value" defaultValue={value} className={`${field} font-mono`} />
      <button disabled={pending} className={secondary}>
        {pending ? "…" : "Save"}
      </button>
      <div className="sm:col-span-3">
        <Note state={state} />
      </div>
    </form>
  );
}

export function RenameWorkspaceForm({ tenantId, name }: { tenantId: string; name: string }) {
  const [state, action, pending] = useActionState<WorkspaceResult, FormData>(renameWorkspace, null);
  return (
    <form action={action} className="grid gap-2 border-b border-rule/60 px-5 py-3 sm:grid-cols-[260px_1fr_auto] sm:items-center">
      <input type="hidden" name="tenantId" value={tenantId} />
      <div className="text-sm font-medium">
        Name
        <p className="mt-0.5 text-xs font-normal text-muted">Shown in this workspace&apos;s own sidebar.</p>
      </div>
      <input name="name" defaultValue={name} className={field} />
      <button disabled={pending} className={secondary}>
        {pending ? "…" : "Save"}
      </button>
      <div className="sm:col-span-3">
        <Note state={state} />
      </div>
    </form>
  );
}

export function PlanForm({ tenantId, plan }: { tenantId: string; plan: string }) {
  const [state, action, pending] = useActionState<WorkspaceResult, FormData>(setWorkspacePlan, null);
  return (
    <form action={action} className="grid gap-2 border-b border-rule/60 px-5 py-3 sm:grid-cols-[260px_1fr_auto] sm:items-center">
      <input type="hidden" name="tenantId" value={tenantId} />
      <div className="text-sm font-medium">
        Plan
        <p className="mt-0.5 text-xs font-normal text-muted">A label for your own records. Access is set on the Modules tab.</p>
      </div>
      <select name="plan" defaultValue={plan} className={field}>
        <option value="trial">Trial</option>
        <option value="essentials">Essentials</option>
        <option value="full">Full</option>
        <option value="custom">Custom</option>
      </select>
      <button disabled={pending} className={secondary}>
        {pending ? "…" : "Save"}
      </button>
      <div className="sm:col-span-3">
        <Note state={state} />
      </div>
    </form>
  );
}

/**
 * The password half of somebody's access, from the console.
 *
 * Owner-only on the server as well as here: the button being hidden is a courtesy, the check in
 * the action is the rule.
 */
export function WorkspacePasswordForm({
  tenantId,
  userId,
  email,
  hasPassword,
  isOwner,
}: {
  tenantId: string;
  userId: string;
  email: string;
  hasPassword: boolean;
  isOwner: boolean;
}) {
  const [link, issue, issuing] = useActionState<WorkspaceLinkResult, FormData>(issueWorkspacePasswordLink, null);
  const [cleared, clear, clearing] = useActionState<WorkspaceResult, FormData>(clearWorkspacePassword, null);
  if (!isOwner) {
    return <span className="text-xs text-muted">{hasPassword ? "set" : "Google only"}</span>;
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        <form action={issue}>
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="userId" value={userId} />
          <button disabled={issuing} className="text-xs text-dusk hover:underline disabled:opacity-60">
            {issuing ? "…" : hasPassword ? "Reset" : "Set up"}
          </button>
        </form>
        {hasPassword && (
          <form
            action={clear}
            onSubmit={(e) => {
              if (!window.confirm(`Remove ${email}'s password? They are signed out, and sign in with Google after that.`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="tenantId" value={tenantId} />
            <input type="hidden" name="userId" value={userId} />
            <button disabled={clearing} className="text-xs text-sindoor hover:underline disabled:opacity-60">Remove</button>
          </form>
        )}
      </div>
      {link?.ok && link.value && (
        <CopyLink href={link.value} note={link.message} label={`One-time password link for ${email}`} />
      )}
      {link && !link.ok && <p className="text-xs text-sindoor">{link.error}</p>}
      {cleared && <p className={`text-xs ${cleared.ok ? "text-leaf" : "text-sindoor"}`}>{cleared.ok ? cleared.message : cleared.error}</p>}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  createTenant,
  deactivateOperator,
  issueOperatorResetLink,
  rotatePublicSecret,
  saveOperator,
  setEntitlement,
  setTenantStatus,
  startImpersonation,
  stopImpersonation,
  type OperatorResult,
  type PlatformResult,
  type SecretResult,
  archiveWorkspace,
  purgeWorkspace,
  restoreWorkspace,
} from "./actions";

import { CopyLink } from "@/components/copy-link";

const input = "w-full rounded-lg border border-rule bg-canvas px-3 py-2 text-sm";

/**
 * A password worth typing into a chat message: no characters that argue about which one they
 * are, and grouped so a person can read it aloud without losing their place.
 */
function generatePassword(): string {
  const letters = "abcdefghijkmnpqrstuvwxyz";
  const caps = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const pool = letters + caps + digits;
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map((n, i) => (i === 4 ? caps : i === 9 ? digits : pool)[n % (i === 4 ? caps.length : i === 9 ? digits.length : pool.length)]!);
  return `${chars.slice(0, 5).join("")}-${chars.slice(5, 10).join("")}-${chars.slice(10).join("")}`;
}

export function CreateTenantForm() {
  const [state, action, pending] = useActionState<SecretResult, FormData>(createTenant, null);
  const [password, setPassword] = useState("");
  return (
    <form action={action} className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="block text-sm sm:col-span-2">
        <span className="mb-1 block font-medium">Workspace name</span>
        <input name="name" required maxLength={80} className={input} placeholder="Acme Ltd" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">First admin&rsquo;s email</span>
        <input name="adminEmail" type="email" required className={input} placeholder="admin@acme.com" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">
          Their mobile <span className="font-normal text-muted">— optional</span>
        </span>
        <input name="adminPhone" type="tel" autoComplete="off" className={input} placeholder="+91 98765 43210" />
      </label>

      <div className="sm:col-span-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">
            Their password <span className="font-normal text-muted">— optional</span>
          </span>
          <div className="flex items-center gap-2">
            <input
              name="adminPassword"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className={`${input} font-mono`}
              placeholder="Leave empty for a one-time link instead"
            />
            <button
              type="button"
              onClick={() => setPassword(generatePassword())}
              className="shrink-0 rounded-lg border border-rule px-3 py-2 text-sm font-medium hover:bg-paper"
            >
              Generate
            </button>
          </div>
        </label>
        <p className="mt-1 text-xs text-muted">
          Hand this over with their email. They sign in with it once and have to choose their own
          before they can go anywhere — it stops working after 72 hours either way. At least 12
          characters, with letters and a number.
        </p>
      </div>

      <div className="sm:col-span-2">
        <button disabled={pending} className="rounded-lg bg-night px-3 py-2 text-sm font-medium text-white hover:bg-night-2 disabled:opacity-60">
          {pending ? "Creating…" : "Create workspace"}
        </button>
        {state && !state.ok && <span className="ml-3 text-sm text-critical">{state.error}</span>}
        {state?.ok && !state.value && <span className="ml-3 text-sm text-muted">{state.message}</span>}
      </div>
      {state?.ok && state.value && (
        <div className="sm:col-span-2">
          <CopyLink href={state.value} note={state.message} label="One-time password link for the first admin" />
        </div>
      )}
    </form>
  );
}

export function StatusForm({ id, status, compact }: { id: string; status: string; compact?: boolean }) {
  const [state, action, pending] = useActionState<PlatformResult, FormData>(setTenantStatus, null);
  const next = status === "suspended" ? "active" : "suspended";
  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={next} />
      <button
        disabled={pending}
        className={
          compact
            ? "rounded-lg border border-rule px-2.5 py-1 text-xs font-medium hover:bg-card disabled:opacity-60"
            : "rounded-lg border border-rule px-3 py-1.5 text-sm hover:bg-card disabled:opacity-60"
        }
      >
        {next === "suspended" ? "Suspend" : "Resume"}
      </button>
      {state && !compact && (
        <span className={`text-sm ${state.ok ? "text-muted" : "text-critical"}`}>{state.ok ? state.message : state.error}</span>
      )}
    </form>
  );
}

export function EntitlementToggle({
  tenantId,
  kind,
  entKey,
  label,
  enabled,
  inertBecause,
  note,
}: {
  tenantId: string;
  kind: "module" | "feature" | "integration";
  entKey: string;
  label: string;
  enabled: boolean;
  /** Set when this cannot do anything — a feature whose module is off. */
  inertBecause?: string;
  /** Which parts of the product this carries, so switching it off is not a guess. */
  note?: string;
}) {
  const [state, action, pending] = useActionState<PlatformResult, FormData>(setEntitlement, null);
  return (
    <form action={action} className="flex items-center justify-between gap-3 border-b border-rule/60 py-2">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="key" value={entKey} />
      <input type="hidden" name="enabled" value={String(!enabled)} />
      <span className={`text-sm ${inertBecause ? "text-muted" : ""}`}>
        {label}
        {inertBecause && <span className="ml-2 text-xs text-muted">({inertBecause})</span>}
        {note && <span className="ml-2 text-xs text-muted">· {note}</span>}
        {/* The answer carries what else changed — which features went with a module, which
            module a withdrawn account just hid. Showing only errors threw that away. */}
        {state && !state.ok && <span className="mt-0.5 block text-xs text-critical">{state.error}</span>}
        {state?.ok && state.message.includes(":") && (
          <span className="mt-0.5 block text-xs text-muted">{state.message.slice(state.message.indexOf(".") + 1).trim()}</span>
        )}
      </span>
      <button
        disabled={pending}
        className={`rounded-full px-3 py-1 text-xs font-medium ${enabled ? "bg-night text-white" : "border border-rule text-muted"} disabled:opacity-60`}
      >
        {pending ? "…" : enabled ? "On" : "Off"}
      </button>
    </form>
  );
}

/** Makes a workspace its own event secret or feed token, and shows it once. */
export function PublicSecretForm({
  tenantId,
  secretKey,
  label,
  present,
}: {
  tenantId: string;
  secretKey: string;
  label: string;
  present: boolean;
}) {
  const [state, action, pending] = useActionState<SecretResult, FormData>(rotatePublicSecret, null);
  return (
    <form action={action} className="border-b border-rule/60 py-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="key" value={secretKey} />
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">
          {label}
          <span className="ml-2 text-xs text-muted">{present ? "set" : "not set — the endpoint refuses"}</span>
        </span>
        <button
          disabled={pending}
          className="rounded-full border border-rule px-3 py-1 text-xs font-medium disabled:opacity-60"
        >
          {pending ? "…" : present ? "Replace" : "Create"}
        </button>
      </div>
      {state?.ok && state.value && (
        <p className="mt-2 rounded-lg bg-paper px-3 py-2 text-xs">
          <span className="text-muted">{state.message}</span>
          <br />
          <code className="font-mono break-all">{state.value}</code>
        </p>
      )}
      {state && !state.ok && <p className="mt-2 text-xs text-critical">{state.error}</p>}
    </form>
  );
}

/** Starts a time-limited, read-only look inside a workspace. */
export function ImpersonateForm({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const [state, action, pending] = useActionState<OperatorResult, FormData>(startImpersonation, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_120px_auto] sm:items-end">
      <input type="hidden" name="tenantId" value={tenantId} />
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Why you need to look</span>
        <input name="reason" required minLength={8} className={input} placeholder={`Checking a support ticket for ${tenantName}`} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">For</span>
        <select name="minutes" defaultValue="30" className={input}>
          <option value="15">15 minutes</option>
          <option value="30">30 minutes</option>
          <option value="60">1 hour</option>
        </select>
      </label>
      <button disabled={pending} className="rounded-lg border border-rule px-3 py-2 text-sm font-medium disabled:opacity-60">
        {pending ? "…" : "Look inside"}
      </button>
      <div className="sm:col-span-3">
        {state?.ok && <span className="text-sm text-muted">{state.message}</span>}
        {state && !state.ok && <span className="text-sm text-critical">{state.error}</span>}
      </div>
    </form>
  );
}

/** Ends the look that is open, from inside the workspace or from the console. */
export function StopImpersonationForm({ label = "Stop looking" }: { label?: string }) {
  const [, action, pending] = useActionState<OperatorResult, FormData>(stopImpersonation, null);
  return (
    <form action={action}>
      <button disabled={pending} className="rounded-lg bg-white/15 px-3 py-1 text-xs font-medium text-white hover:bg-white/25 disabled:opacity-60">
        {pending ? "…" : label}
      </button>
    </form>
  );
}

export function OperatorForm() {
  const [state, action, pending] = useActionState<OperatorResult, FormData>(saveOperator, null);
  return (
    <form action={action} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_140px_auto] sm:items-end">
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Email</span>
        <input name="email" type="email" required className={input} placeholder="someone@example.com" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Name</span>
        <input name="name" className={input} placeholder="Their name" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Role</span>
        <select name="role" defaultValue="support" className={input}>
          <option value="owner">Owner</option>
          <option value="support">Support</option>
          <option value="billing">Billing</option>
        </select>
      </label>
      <button disabled={pending} className="rounded-lg bg-night px-3 py-2 text-sm font-medium text-white hover:bg-night-2 disabled:opacity-60">
        {pending ? "…" : "Save"}
      </button>
      <div className="sm:col-span-4">
        {state?.ok && <span className="text-sm text-muted">{state.message}</span>}
        {state && !state.ok && <span className="text-sm text-critical">{state.error}</span>}
      </div>
    </form>
  );
}

export function DeactivateOperatorForm({ id, email }: { id: string; email: string }) {
  const [state, action, pending] = useActionState<OperatorResult, FormData>(deactivateOperator, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Remove ${email}'s access to the console?`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button disabled={pending} className="text-xs text-critical hover:underline disabled:opacity-60">
        {pending ? "…" : "Remove access"}
      </button>
      {state && !state.ok && <span className="ml-2 text-xs text-critical">{state.error}</span>}
    </form>
  );
}

/** Gives an owner a one-time link to hand to an operator who needs a password. */
export function ResetLinkForm({ id, email }: { id: string; email: string }) {
  const [state, action, pending] = useActionState<SecretResult, FormData>(issueOperatorResetLink, null);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button disabled={pending} className="text-xs text-dusk hover:underline disabled:opacity-60">
        {pending ? "…" : "Issue password link"}
      </button>
      {state?.ok && state.value && (
        <p className="mt-2 rounded-lg bg-paper px-3 py-2 text-xs">
          <span className="text-muted">{state.message}</span>
          <br />
          <code className="font-mono break-all">{state.value}</code>
        </p>
      )}
      {state && !state.ok && <span className="ml-2 text-xs text-critical">{state.error}</span>}
      <span className="sr-only">for {email}</span>
    </form>
  );
}

/**
 * The actions on a workspace row: look, change, suspend, delete.
 *
 * Deleting is two steps that cannot be collapsed into one. This is the first: archive, which
 * takes the workspace out of service and removes nothing. The second — purging the schema —
 * lives on the workspace's own Settings tab, behind a retention window, and is not reachable
 * from a list where the wrong row is one mis-click away.
 */
export function WorkspaceRowActions({
  id,
  slug,
  name,
  status,
  isFirst,
}: {
  id: string;
  slug: string;
  name: string;
  status: string;
  /** Tenant #1, whose schema is the installation. It is never archived. */
  isFirst: boolean;
}) {
  const [archiveState, archive, archiving] = useActionState<PlatformResult, FormData>(archiveWorkspace, null);
  const [restoreState, restore, restoring] = useActionState<PlatformResult, FormData>(restoreWorkspace, null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");

  const link = "rounded-lg border border-rule px-2.5 py-1 text-xs font-medium hover:bg-card";
  const state = archiveState ?? restoreState;

  if (status === "archived") {
    return (
      <div className="flex flex-col items-end gap-1">
        <form action={restore} className="flex items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <Link href={`/super-admin/workspaces/${id}`} className={link}>
            View
          </Link>
          <button disabled={restoring} className={link}>
            {restoring ? "…" : "Restore"}
          </button>
        </form>
        {state && <span className={`text-xs ${state.ok ? "text-muted" : "text-critical"}`}>{state.ok ? state.message : state.error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Link href={`/super-admin/workspaces/${id}`} className={link}>
          View
        </Link>
        <Link href={`/super-admin/workspaces/${id}/settings`} className={link}>
          Edit
        </Link>
        <StatusForm id={id} status={status} compact />
        {!isFirst && (
          <button type="button" onClick={() => setConfirming(!confirming)} className={`${link} text-critical`}>
            Delete
          </button>
        )}
      </div>

      {confirming && (
        <form action={archive} className="mt-1 w-[300px] rounded-lg border border-critical/40 bg-paper px-3 py-2 text-left">
          <input type="hidden" name="id" value={id} />
          <p className="text-xs">
            <span className="font-medium">Delete {name}?</span> It stops answering at once and everyone in it is signed
            out. <span className="font-medium">Nothing is deleted today</span> — its data is kept, and you can restore
            it. Removing the data for good is a separate step on its Settings tab, and not for another 30 days.
          </p>
          <label className="mt-2 block text-xs">
            <span className="text-muted">
              Type <span className="font-mono font-medium text-ink">{slug}</span> to confirm
            </span>
            <input
              name="confirmSlug"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded border border-rule bg-card px-2 py-1 font-mono text-xs"
            />
          </label>
          <input name="reason" placeholder="Why (optional)" className="mt-1 w-full rounded border border-rule bg-card px-2 py-1 text-xs" />
          <div className="mt-2 flex items-center gap-2">
            <button
              disabled={archiving || typed.trim() !== slug}
              className="rounded-lg bg-critical px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {archiving ? "Deleting…" : "Delete workspace"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={link}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {state && <span className={`text-xs ${state.ok ? "text-muted" : "text-critical"}`}>{state.ok ? state.message : state.error}</span>}
    </div>
  );
}

/**
 * Removing an archived workspace's data for good.
 *
 * The second half of Delete, kept away from the list: it lives on the workspace's own page,
 * behind the retention window, and it says plainly what is about to be dropped. Everything it
 * refuses is refused again in `purgeTenant`, next to the statements themselves.
 */
export function PurgeWorkspaceForm({
  id,
  slug,
  name,
  schema,
  purgeAfter,
  archivedBy,
  archivedAt,
  reason,
}: {
  id: string;
  slug: string;
  name: string;
  schema: string;
  purgeAfter: string | null;
  archivedBy: string | null;
  archivedAt: string | null;
  reason: string | null;
}) {
  const [state, action, pending] = useActionState<PlatformResult, FormData>(purgeWorkspace, null);
  const [typed, setTyped] = useState("");
  const ready = purgeAfter !== null && new Date(purgeAfter).getTime() <= Date.now();

  return (
    <div className="px-5 py-4">
      <p className="text-sm text-muted">
        Archived{archivedAt ? ` on ${new Date(archivedAt).toLocaleDateString()}` : ""}
        {archivedBy ? ` by ${archivedBy}` : ""}
        {reason ? ` — ${reason}` : ""}. Nothing has been removed: schema{" "}
        <span className="font-mono text-ink">{schema}</span> and every row in it are still here, and{" "}
        <span className="font-medium text-ink">Restore</span> on the Workspaces list brings it back.
      </p>

      {!ready ? (
        <p className="mt-3 rounded-lg bg-paper px-3 py-2 text-sm">
          Its data is kept until{" "}
          <span className="font-medium">{purgeAfter ? new Date(purgeAfter).toLocaleDateString() : "later"}</span>. It
          cannot be removed before then — the wait is the protection.
        </p>
      ) : (
        <form action={action} className="mt-3 rounded-lg border border-critical/40 bg-paper px-3 py-3">
          <p className="text-sm">
            <span className="font-medium text-critical">Remove {name}&rsquo;s data for good.</span> This drops the
            schema <span className="font-mono">{schema}</span> with every table and row in it, both of its database
            roles, and its control-plane records. There is no undoing it and there is no backup here.
          </p>
          <input type="hidden" name="id" value={id} />
          <label className="mt-2 block text-xs">
            <span className="text-muted">
              Type <span className="font-mono font-medium text-ink">{slug}</span> to confirm
            </span>
            <input
              name="confirmSlug"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full max-w-xs rounded border border-rule bg-card px-2 py-1 font-mono text-xs"
            />
          </label>
          <button
            disabled={pending || typed.trim() !== slug}
            className="mt-2 rounded-lg bg-critical px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {pending ? "Removing…" : "Remove the data for good"}
          </button>
        </form>
      )}

      {state && (
        <p className={`mt-2 text-sm ${state.ok ? "text-muted" : "text-critical"}`}>{state.ok ? state.message : state.error}</p>
      )}
    </div>
  );
}

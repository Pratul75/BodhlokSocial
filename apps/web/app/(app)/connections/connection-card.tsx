"use client";

import { useActionState, useState } from "react";
import { KeyRound, Link2, RefreshCw, Unplug } from "lucide-react";
import { saveKey, disconnect, syncNow, type ConnResult } from "./actions";
import { btn, inputClass, Pill, StatusPill } from "@/components/ui";

export interface ConnectionView {
  key: string;
  name: string;
  usedFor: string;
  method: "oauth" | "api_key" | "service_account" | "internal" | "none";
  prerequisite?: string;
  status: string;
  accountLabel: string | null;
  updatedLabel: string | null;
  syncedLabel: string | null;
  error: string | null;
  /** Google OAuth flow is switched on for this integration. */
  oauthEnabled: boolean;
  /** A key or OAuth grant is stored for this integration. */
  hasCredential: boolean;
  /** The app has a Google OAuth client configured. */
  oauthClientReady: boolean;
}

const METHOD_LABEL = {
  oauth: "Sign in with the platform",
  api_key: "API key",
  service_account: "Service account JSON",
  internal: "Internal API",
  none: "No API",
};

export function ConnectionCard({ c }: { c: ConnectionView }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ConnResult, FormData>(saveKey, null);
  const [syncState, syncAction, syncing] = useActionState<ConnResult, FormData>(syncNow, null);
  // A failed sync keeps the stored credential, so the card still offers Sync and Disconnect.
  const connected = c.status === "connected" || (c.status === "error" && c.hasCredential);

  return (
    <article className="flex flex-col rounded-xl border border-rule bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-[15px] font-semibold tracking-tight">{c.name}</h3>
          <p className="mt-0.5 text-sm text-muted">{c.usedFor}</p>
        </div>
        <StatusPill status={c.status} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted">
        <span>{METHOD_LABEL[c.method]}</span>
        {c.prerequisite && !connected && <Pill tone="turmeric">Needs {c.prerequisite}</Pill>}
      </div>
      {connected && (
        <p className="mt-2 text-xs text-muted">
          {c.accountLabel ? `${c.accountLabel} · ` : ""}Connected {c.updatedLabel}
          {c.syncedLabel && ` · synced ${c.syncedLabel}`}
        </p>
      )}
      {c.error && <p className="mt-2 text-xs text-sindoor" role="alert">{c.error}</p>}

      <div className="mt-auto pt-4">
        {connected ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {c.oauthEnabled && (
                <form action={syncAction}>
                  <input type="hidden" name="key" value={c.key} />
                  <button className={btn.secondary} disabled={syncing}>
                    <RefreshCw size={15} className={syncing ? "animate-spin" : ""} /> {syncing ? "Syncing…" : "Sync now"}
                  </button>
                </form>
              )}
              <form action={disconnect}>
                <input type="hidden" name="key" value={c.key} />
                <button className={btn.ghost}>
                  <Unplug size={15} /> Disconnect
                </button>
              </form>
            </div>
            {syncState && (
              <p className={`text-xs ${syncState.ok ? "text-leaf" : "text-sindoor"}`} role={syncState.ok ? "status" : "alert"}>
                {syncState.ok ? syncState.message : syncState.error}
              </p>
            )}
          </div>
        ) : c.method === "api_key" || c.method === "service_account" ? (
          open ? (
            <form action={action} className="space-y-2">
              <input type="hidden" name="key" value={c.key} />
              {c.method === "api_key" ? (
                <input name="value" type="password" autoComplete="off" className={inputClass} placeholder="Paste the API key" required autoFocus />
              ) : (
                <textarea name="value" rows={4} className={`${inputClass} font-mono text-xs`} placeholder='{"type": "service_account", ...}' required autoFocus />
              )}
              <input name="label" className={inputClass} placeholder="Account name (optional)" />
              {state && !state.ok && <p className="text-sm text-sindoor" role="alert">{state.error}</p>}
              <div className="flex gap-2">
                <button className={btn.primary} disabled={pending}>Save and connect</button>
                <button type="button" className={btn.ghost} onClick={() => setOpen(false)}>Cancel</button>
              </div>
              <p className="text-xs text-muted">Stored in the secrets store, never in the database.</p>
            </form>
          ) : (
            <button className={btn.secondary} onClick={() => setOpen(true)}>
              <KeyRound size={15} /> {c.method === "api_key" ? "Add API key" : "Add service account"}
            </button>
          )
        ) : c.method === "oauth" && c.oauthEnabled && c.oauthClientReady ? (
          <a href={`/api/connect/${c.key}/start`} className={btn.primary}>
            <Link2 size={15} /> Connect with Google
          </a>
        ) : c.method === "oauth" ? (
          <div>
            <button className={btn.secondary} disabled>
              <Link2 size={15} /> Connect
            </button>
            <p className="mt-1.5 text-xs text-muted">
              {c.oauthEnabled
                ? "Needs the Google OAuth client. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."
                : c.prerequisite
                  ? `Switched on once the ${c.prerequisite} comes through.`
                  : "Connect flow not built yet."}
            </p>
          </div>
        ) : c.method === "none" ? (
          <p className="text-xs text-muted">Quora has no public API. Agents draft answers and a person posts them.</p>
        ) : (
          <p className="text-xs text-muted">Connects through the BODH backend's event API.</p>
        )}
      </div>
    </article>
  );
}

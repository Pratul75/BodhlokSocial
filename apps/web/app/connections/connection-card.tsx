"use client";

import { useActionState, useState } from "react";
import { KeyRound, Link2, Unplug } from "lucide-react";
import { saveKey, disconnect, type ConnResult } from "./actions";
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
  const connected = c.status === "connected";

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
        </p>
      )}

      <div className="mt-auto pt-4">
        {connected ? (
          <form action={disconnect}>
            <input type="hidden" name="key" value={c.key} />
            <button className={btn.ghost}>
              <Unplug size={15} /> Disconnect
            </button>
          </form>
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
        ) : c.method === "oauth" ? (
          <div>
            <button className={btn.secondary} disabled title="OAuth apps are registered in Phase 1">
              <Link2 size={15} /> Connect
            </button>
            <p className="mt-1.5 text-xs text-muted">Available once the OAuth app for this platform is registered.</p>
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

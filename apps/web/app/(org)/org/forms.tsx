"use client";

import { useActionState, useState } from "react";
import { CopyLink } from "@/components/copy-link";
import { createClientWorkspace } from "./actions";
import type { SecretResult } from "@/app/(platform)/super-admin/actions";

const input = "w-full rounded-lg border border-rule bg-card px-3 py-2 text-sm";

/** A readable password: no characters that argue about which one they are. */
function generatePassword(): string {
  const pool = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  const made = [...bytes].map((b) => pool[b % pool.length]).join("");
  return `${made.slice(0, 5)}-${made.slice(5, 10)}-${made.slice(10)}`;
}

/** The agency makes a client of its own. The agency itself is never a field here. */
export function NewClientForm() {
  const [state, action, pending] = useActionState<SecretResult, FormData>(createClientWorkspace, null);
  const [password, setPassword] = useState("");
  return (
    <form action={action} className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Client name</span>
        <input name="name" required maxLength={80} className={input} placeholder="Client ABC" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Their first admin&rsquo;s email</span>
        <input name="adminEmail" type="email" required className={input} placeholder="admin@clientabc.com" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">
          Their mobile <span className="font-normal text-muted">— optional</span>
        </span>
        <input name="adminPhone" type="tel" autoComplete="off" className={input} placeholder="+91 98765 43210" />
      </label>
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
      <div className="sm:col-span-2">
        <button disabled={pending} className="rounded-lg bg-night px-3 py-2 text-sm font-medium text-white hover:bg-night-2 disabled:opacity-60">
          {pending ? "Building…" : "Create client"}
        </button>
      </div>
      {state && (
        <p role={state.ok ? "status" : "alert"} className={`sm:col-span-2 text-sm ${state.ok ? "text-leaf" : "text-sindoor"}`}>
          {state.ok ? state.message : state.error}
        </p>
      )}
      {state?.ok && state.value && (
        <div className="sm:col-span-2">
          <CopyLink href={state.value} note={state.message} label="One-time password link for their first admin" />
        </div>
      )}
    </form>
  );
}

"use client";

import { useActionState, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { decide, type DecideResult } from "./actions";
import { btn, inputClass, Pill } from "@/components/ui";
import { AssetThumb, type ThumbAsset } from "@/components/asset-thumb";

export interface ApprovalView {
  id: string;
  kind: string;
  kindLabel: string;
  channelLabel: string;
  agent: string;
  title: string;
  body: string;
  reason: string;
  createdLabel: string;
  flags: string[];
  copyIssues: { match: string; why: string }[];
  canDecide: boolean;
  /** Calendar posts: media in posting order, the schedule, and rule checks. */
  assets?: ThumbAsset[];
  scheduledLabel?: string;
  calendarItemId?: string | null;
  checkErrors?: string[];
  checkWarnings?: string[];
}

export function ApprovalCard({ item }: { item: ApprovalView }) {
  const [mode, setMode] = useState<"view" | "edit" | "reject">("view");
  const [state, action, pending] = useActionState<DecideResult | null, FormData>(decide, null);

  if (state?.ok) return null;

  return (
    <article className="rounded-xl border border-rule bg-card" aria-labelledby={`t-${item.id}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-5 py-2.5 text-xs text-muted">
        <Pill tone="dusk">{item.kindLabel}</Pill>
        <span>{item.channelLabel}</span>
        <span aria-hidden="true">·</span>
        <span>Drafted by the {item.agent} agent {item.createdLabel}</span>
        {item.flags.map((f) => (
          <Pill key={f} tone="turmeric">{f}</Pill>
        ))}
      </div>

      <form action={action} className="px-5 py-4">
        <input type="hidden" name="id" value={item.id} />
        <h3 id={`t-${item.id}`} className="font-display text-[17px] leading-snug font-semibold tracking-tight">
          {item.title}
        </h3>

        {mode === "edit" ? (
          <textarea
            name="body"
            defaultValue={item.body}
            rows={Math.min(14, item.body.split("\n").length + 2)}
            className={`${inputClass} mt-3 font-mono text-[13px] leading-relaxed`}
            aria-label="Edit draft"
          />
        ) : (
          <p className="mt-2.5 text-sm leading-relaxed whitespace-pre-wrap text-ink/90">{item.body}</p>
        )}

        {item.assets && item.assets.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {item.assets.map((a, i) => (
              <div key={a.id} className="w-24 shrink-0">
                <AssetThumb a={a} className="aspect-[4/5] rounded-lg" />
                <div className="mt-0.5 truncate text-[10px] text-muted">{i + 1}. {a.name}</div>
              </div>
            ))}
          </div>
        )}
        {item.scheduledLabel && (
          <p className="mt-2 text-xs text-muted">
            Goes out {item.scheduledLabel}.{" "}
            {item.calendarItemId && <a href={`/calendar/${item.calendarItemId}`} className="text-dusk hover:underline">Open in calendar</a>}
          </p>
        )}
        {item.checkErrors && item.checkErrors.length > 0 && (
          <div className="mt-3 rounded-lg bg-sindoor-soft px-3 py-2 text-sm text-sindoor" role="note">
            {item.checkErrors.map((e) => <p key={e}>{e}</p>)}
          </div>
        )}
        {item.checkWarnings && item.checkWarnings.length > 0 && (
          <div className="mt-3 rounded-lg bg-turmeric-soft px-3 py-2 text-sm text-turmeric-ink" role="note">
            {item.checkWarnings.map((w) => <p key={w}>{w}</p>)}
          </div>
        )}

        <p className="mt-3 rounded-lg bg-paper px-3 py-2 text-sm text-muted">
          <span className="font-medium text-ink">Why: </span>
          {item.reason}
        </p>

        {item.copyIssues.length > 0 && (
          <div className="mt-3 rounded-lg bg-sindoor-soft px-3 py-2 text-sm text-sindoor" role="note">
            <span className="font-medium">Ad rules: </span>
            {item.copyIssues.map((c) => `"${c.match}" (${c.why.toLowerCase()})`).join(", ")}. Google and Meta reject these.
          </div>
        )}

        {mode === "reject" && (
          <div className="mt-3">
            <label htmlFor={`note-${item.id}`} className="text-sm font-medium">
              What should the agent change?
            </label>
            <textarea id={`note-${item.id}`} name="note" rows={2} className={`${inputClass} mt-1`} required autoFocus />
          </div>
        )}

        {state && !state.ok && (
          <p className="mt-3 text-sm text-sindoor" role="alert">
            {state.error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!item.canDecide ? (
            <p className="text-sm text-muted">Your role can view this item but not decide on it.</p>
          ) : mode === "view" ? (
            <>
              <button name="decision" value="approve" className={btn.approve} disabled={pending}>
                <Check size={16} /> Approve
              </button>
              <button type="button" className={btn.secondary} onClick={() => setMode("edit")} disabled={pending}>
                <Pencil size={15} /> Edit
              </button>
              <button type="button" className={btn.danger} onClick={() => setMode("reject")} disabled={pending}>
                <X size={16} /> Reject
              </button>
            </>
          ) : mode === "edit" ? (
            <>
              <button name="decision" value="approve" className={btn.approve} disabled={pending}>
                <Check size={16} /> Save and approve
              </button>
              <button type="button" className={btn.ghost} onClick={() => setMode("view")} disabled={pending}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button name="decision" value="reject" className={btn.danger} disabled={pending}>
                <X size={16} /> Reject and send back
              </button>
              <button type="button" className={btn.ghost} onClick={() => setMode("view")} disabled={pending}>
                Cancel
              </button>
            </>
          )}
        </div>
      </form>
    </article>
  );
}

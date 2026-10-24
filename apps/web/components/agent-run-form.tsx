"use client";

import { useActionState } from "react";
import { Sparkles } from "lucide-react";
import { runAgentAction, type RunState } from "@/lib/agent-actions";
import { btn, inputClass } from "./ui";

export function AgentRunForm({ agent, label, placeholder, disabled }: { agent: "strategy" | "content" | "seo" | "ads"; label: string; placeholder: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState<RunState, FormData>(runAgentAction, {});
  return (
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <input type="hidden" name="agent" value={agent} />
      <div className="flex-1">
        <label htmlFor={`task-${agent}`} className="sr-only">Instructions for this run</label>
        <input id={`task-${agent}`} name="task" className={inputClass} placeholder={placeholder} maxLength={2000} disabled={disabled || pending} autoComplete="off" />
        {state.error && <p className="mt-1.5 text-xs text-sindoor">{state.error}</p>}
        {state.started && !state.error && <p className="mt-1.5 text-xs text-muted">Started. This takes a few minutes; refresh to see the result.</p>}
      </div>
      <button className={btn.primary} disabled={disabled || pending}>
        <Sparkles size={15} /> {pending ? "Starting…" : label}
      </button>
    </form>
  );
}

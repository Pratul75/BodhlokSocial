"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { btn, inputClass } from "./ui";

interface Turn {
  role: "user" | "assistant";
  text: string;
  activity?: string[];
  error?: string;
}

/** Bold, inline code and bullet lists: enough for the agent's short answers. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : part.startsWith("`") && part.endsWith("`") ? (
      <code key={i} className="rounded bg-paper px-1 font-mono text-[0.85em]">{part.slice(1, -1)}</code>
    ) : (
      part
    ),
  );
}

function Markdown({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*([-*]|\d+\.)\s/.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*]|\d+\.)\s/, ""))}</li>)}
            </ul>
          );
        }
        const h = b.match(/^#{1,4}\s+(.*)$/);
        if (h && lines.length === 1) return <p key={i} className="font-semibold">{inline(h[1]!)}</p>;
        return <p key={i} className="whitespace-pre-wrap">{inline(b)}</p>;
      })}
    </div>
  );
}

export function ChatPanel({ examples }: { examples: string[] }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const update = (fn: (t: Turn) => Turn) =>
    setTurns((all) => [...all.slice(0, -1), fn(all.at(-1)!)]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const history = [...turns.filter((t) => !t.error).map(({ role, text }) => ({ role, text })), { role: "user" as const, text: q }];
    setTurns((all) => [...all, { role: "user", text: q }, { role: "assistant", text: "", activity: [] }]);
    setDraft("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history }) });
      if (!res.ok || !res.body) throw new Error(res.status === 403 ? "You don't have access to chat." : "The chat service didn't answer.");
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const ev = JSON.parse(line) as { type: string; text?: string; name?: string; message?: string };
          if (ev.type === "text") update((t) => ({ ...t, text: t.text + ev.text }));
          else if (ev.type === "tool") update((t) => ({ ...t, activity: [...(t.activity ?? []), ev.name!] }));
          else if (ev.type === "error") update((t) => ({ ...t, error: ev.message }));
        }
        endRef.current?.scrollIntoView({ block: "end" });
      }
    } catch (e) {
      update((t) => ({ ...t, error: e instanceof Error ? e.message : "Something went wrong." }));
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(draft);
  };

  return (
    <div className="flex min-h-[460px] flex-col">
      <div className="flex-1 space-y-4 px-5 py-5" aria-live="polite">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-10 text-center">
            <p className="font-display text-lg font-semibold">Ask anything about BODH&apos;s marketing</p>
            <p className="mt-1 max-w-md text-sm text-muted">Answers come from the funnel, ads, calendar and plan in this app. Chat reads; it doesn&apos;t change anything.</p>
            <div className="mt-6 flex max-w-xl flex-wrap justify-center gap-2">
              {examples.map((e) => (
                <button key={e} type="button" onClick={() => void ask(e)} className="rounded-full bg-paper px-3 py-1.5 text-sm text-muted ring-1 ring-rule hover:text-ink">
                  {e}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((t, i) =>
            t.role === "user" ? (
              <div key={i} className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-night px-4 py-2.5 text-sm text-white">{t.text}</div>
            ) : (
              <div key={i} className="max-w-[90%] text-sm leading-relaxed text-ink">
                {t.activity && t.activity.length > 0 && (
                  <p className="mb-1.5 text-xs text-muted">{[...new Set(t.activity)].join(" · ")}</p>
                )}
                {t.text ? <Markdown text={t.text} /> : busy && i === turns.length - 1 && !t.error ? <p className="text-muted">Thinking…</p> : null}
                {t.error && <p className="mt-1 text-sindoor">{t.error}</p>}
              </div>
            ),
          )
        )}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t border-rule p-4">
        <label htmlFor="ask" className="sr-only">Your question</label>
        <input id="ask" className={inputClass} placeholder="Ask about results, posts or the plan" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} autoComplete="off" />
        <button className={btn.primary} disabled={busy || !draft.trim()}>{busy ? "Answering…" : "Ask"}</button>
      </form>
    </div>
  );
}

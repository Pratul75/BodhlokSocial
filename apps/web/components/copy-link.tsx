"use client";

import { useState } from "react";

/**
 * A link that is shown once.
 *
 * Password links are handed over, not emailed — there is no mail service here — so the person
 * doing the handing over has to get 43 characters of token out of the screen and into a message.
 * Reading it off is not a thing to ask of anybody, so the button puts it on the clipboard and
 * the field stays selectable for when the clipboard is refused.
 *
 * It renders the absolute URL, because a relative one pasted into a chat window is useless.
 */
export function CopyLink({ href, note, label }: { href: string; note: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const full = typeof window === "undefined" ? href : new URL(href, window.location.origin).toString();
  return (
    <div className="mt-1 w-full rounded-md bg-paper px-2 py-1.5">
      <p className="text-[11px] text-muted">{note}</p>
      <div className="mt-1 flex items-center gap-2">
        <input
          readOnly
          value={full}
          aria-label={label}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-ink outline-none"
        />
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(full);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
          className="shrink-0 rounded border border-rule px-1.5 py-0.5 text-[11px] font-medium hover:bg-card"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1 text-xs text-muted">{label}</div>
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 rounded-lg bg-paper px-3 py-2 font-mono text-[12px] break-all text-ink ring-1 ring-rule">{value}</code>
        <button
          type="button"
          className="rounded-md p-2 text-muted hover:bg-paper hover:text-ink"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={15} className="text-leaf" /> : <Copy size={15} />}
        </button>
      </div>
    </div>
  );
}

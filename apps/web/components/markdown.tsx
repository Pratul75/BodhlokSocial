import type { ReactNode } from "react";

/** Bold, inline code and links. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="rounded bg-paper px-1 font-mono text-[0.85em]">{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const safe = /^(https?:|\/|#)/.test(link[2]!) ? link[2] : undefined;
      return safe ? <a key={i} href={safe} className="text-dusk underline" rel="noreferrer">{link[1]}</a> : link[1];
    }
    return part;
  });
}

/** Enough Markdown for agent answers and page drafts: headings, lists, paragraphs, bold, links. */
export function Markdown({ text, className = "space-y-2" }: { text: string; className?: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-*]\s/.test(l))) {
          return <ul key={i} className="list-disc space-y-1 pl-5">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*]\s/, ""))}</li>)}</ul>;
        }
        if (lines.every((l) => /^\s*\d+\.\s/.test(l))) {
          return <ol key={i} className="list-decimal space-y-1 pl-5">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*\d+\.\s/, ""))}</li>)}</ol>;
        }
        const h = lines[0]!.match(/^(#{1,4})\s+(.*)$/);
        if (h) {
          const rest = lines.slice(1).join("\n");
          const cls = h[1]!.length <= 2 ? "font-display text-lg font-semibold mt-4" : "font-semibold mt-3";
          return (
            <div key={i}>
              <p className={cls}>{inline(h[2]!)}</p>
              {rest && <p className="mt-1 whitespace-pre-wrap">{inline(rest)}</p>}
            </div>
          );
        }
        return <p key={i} className="whitespace-pre-wrap">{inline(b)}</p>;
      })}
    </div>
  );
}

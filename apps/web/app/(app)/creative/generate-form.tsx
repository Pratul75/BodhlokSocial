"use client";

import { useActionState, useState } from "react";
import { Sparkles } from "lucide-react";
import { generateCreative, type GenerateResult } from "./actions";
import { btn, inputClass } from "@/components/ui";

const KINDS = [
  { value: "image", label: "Image", sub: "1 to 4 variations" },
  { value: "carousel", label: "Carousel", sub: "2 to 6 matching slides" },
  { value: "thumbnail", label: "YouTube thumbnail", sub: "1280×720 with your title" },
  { value: "video", label: "Video", sub: "Veo, 4 to 8 seconds" },
] as const;

export function GenerateForm({ disabled, reason }: { disabled: boolean; reason?: string }) {
  const [state, action, pending] = useActionState<GenerateResult, FormData>(generateCreative, null);
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("image");
  const label = "mb-1 block text-xs text-muted";

  return (
    <form action={action} className="space-y-4 px-5 py-4">
      <fieldset disabled={disabled || pending} className="space-y-4">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="What to make">
          {KINDS.map((k) => (
            <label
              key={k.value}
              className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${kind === k.value ? "border-dusk bg-dusk-soft" : "border-rule hover:bg-paper"}`}
            >
              <input type="radio" name="kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} className="sr-only" />
              <span className="flex items-center gap-1.5 font-medium"><Sparkles size={13} /> {k.label}</span>
              <span className="text-xs text-muted">{k.sub}</span>
            </label>
          ))}
        </div>

        <label className="block text-sm">
          <span className={label}>Describe it</span>
          <textarea
            name="prompt"
            rows={4}
            required
            minLength={10}
            maxLength={2000}
            className={inputClass}
            placeholder={kind === "video" ? "Slow push-in on an astrologer's desk at dusk: brass yantra, open notebook of degree calculations, a phone showing a Kundli chart." : "An astrologer's desk at dusk, an open notebook full of degree calculations beside a phone showing a finished Kundli chart."}
          />
        </label>

        {kind === "thumbnail" && (
          <label className="block text-sm">
            <span className={label}>Title on the thumbnail</span>
            <input name="title" maxLength={60} required className={inputClass} placeholder="Saturn in the 7th house" />
          </label>
        )}

        <div className="flex flex-wrap gap-4">
          {(kind === "image" || kind === "carousel") && (
            <label className="block w-36 text-sm">
              <span className={label}>Shape</span>
              <select name="aspect" defaultValue="4:5" className={inputClass}>
                <option value="4:5">4:5 feed</option>
                <option value="1:1">1:1 square</option>
                <option value="9:16">9:16 story</option>
                <option value="16:9">16:9 wide</option>
              </select>
            </label>
          )}
          {kind === "image" && (
            <label className="block w-28 text-sm">
              <span className={label}>Variations</span>
              <select name="count" defaultValue="2" className={inputClass}>
                {[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}
              </select>
            </label>
          )}
          {kind === "carousel" && (
            <label className="block w-28 text-sm">
              <span className={label}>Slides</span>
              <select name="slides" defaultValue="4" className={inputClass}>
                {[2, 3, 4, 5, 6].map((n) => <option key={n}>{n}</option>)}
              </select>
            </label>
          )}
          {kind === "video" && (
            <>
              <label className="block w-36 text-sm">
                <span className={label}>Shape</span>
                <select name="videoAspect" defaultValue="9:16" className={inputClass}>
                  <option value="9:16">9:16 reel or short</option>
                  <option value="16:9">16:9 wide</option>
                </select>
              </label>
              <label className="block w-28 text-sm">
                <span className={label}>Length</span>
                <select name="duration" defaultValue="8" className={inputClass}>
                  <option value="4">4 s</option>
                  <option value="6">6 s</option>
                  <option value="8">8 s</option>
                </select>
              </label>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input type="checkbox" name="audio" defaultChecked /> With sound
              </label>
            </>
          )}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button className={btn.primary} disabled={disabled || pending}>
          <Sparkles size={15} /> {pending ? (kind === "video" ? "Starting…" : "Generating, about 20 seconds…") : "Generate"}
        </button>
        {disabled && reason && <span className="text-xs text-muted">{reason}</span>}
      </div>
      {state && (
        <p className={`text-sm ${state.ok ? "text-leaf" : "text-sindoor"}`} role={state.ok ? "status" : "alert"}>
          {state.ok ? state.message : state.error}
        </p>
      )}
    </form>
  );
}

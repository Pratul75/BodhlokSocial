"use client";

import { useActionState, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, X } from "lucide-react";
import { saveItem, type ItemResult } from "./actions";
import { AssetThumb, type ThumbAsset } from "@/components/asset-thumb";
import { btn, inputClass } from "@/components/ui";

const CAPTION_LIMITS: Record<string, number> = { instagram: 2200, facebook: 63206, linkedin: 3000, youtube: 5000 };

export interface EditorItem {
  id: string;
  idea: string;
  title: string | null;
  script: string | null;
  caption: string | null;
  channel: string;
  format: string;
  date: string;
  time: string;
  assetIds: string[];
  settings: Record<string, unknown>;
  locked: boolean;
}

export function ItemEditor({
  item,
  library,
  channels,
  formats,
}: {
  item: EditorItem;
  library: ThumbAsset[];
  channels: { value: string; label: string }[];
  formats: { value: string; label: string }[];
}) {
  const [state, action, pending] = useActionState<ItemResult, FormData>(saveItem, null);
  const [channel, setChannel] = useState(item.channel);
  const [caption, setCaption] = useState(item.caption ?? "");
  const [selected, setSelected] = useState<string[]>(item.assetIds);
  const byId = useMemo(() => new Map(library.map((a) => [a.id, a])), [library]);
  const limit = CAPTION_LIMITS[channel];
  const hashtags = caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.length ?? 0;

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const move = (i: number, d: -1 | 1) =>
    setSelected((s) => {
      const n = [...s];
      const j = i + d;
      if (j < 0 || j >= n.length) return s;
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });

  const label = "mb-1 block text-xs text-muted";
  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="id" value={item.id} />
      {selected.map((id) => (
        <input key={id} type="hidden" name="assetIds" value={id} />
      ))}
      <fieldset disabled={item.locked || pending} className="space-y-6">
        <label className="block text-sm">
          <span className={label}>Idea</span>
          <input name="idea" defaultValue={item.idea} className={inputClass} required minLength={5} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">
            <span className={label}>Channel</span>
            <select name="channel" value={channel} onChange={(e) => setChannel(e.target.value)} className={inputClass}>
              {channels.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className={label}>Format</span>
            <select name="format" defaultValue={item.format} className={inputClass}>
              {formats.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className={label}>Date</span>
            <input type="date" name="date" defaultValue={item.date} className={inputClass} required />
          </label>
          <label className="text-sm">
            <span className={label}>Time (India)</span>
            <input type="time" name="time" defaultValue={item.time} className={inputClass} required />
          </label>
        </div>

        <label className="block text-sm">
          <span className={label}>Title {channel === "youtube" ? "(required on YouTube, 2–100 characters)" : "(YouTube and blogs; also used on thumbnails)"}</span>
          <input name="title" defaultValue={item.title ?? ""} className={inputClass} maxLength={150} />
        </label>

        <div className="grid gap-4 lg:grid-cols-2">
          <label className="block text-sm">
            <span className={label}>Script or brief (for the shoot or the video agent; not posted)</span>
            <textarea name="script" defaultValue={item.script ?? ""} rows={9} className={`${inputClass} font-mono text-[13px] leading-relaxed`} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 flex justify-between text-xs text-muted">
              <span>{channel === "youtube" ? "Description" : "Caption"}</span>
              <span className={`font-mono tabular ${limit && caption.length > limit ? "text-sindoor" : ""}`}>
                {caption.length}{limit ? ` / ${limit}` : ""} · {hashtags} hashtag{hashtags === 1 ? "" : "s"}
              </span>
            </span>
            <textarea name="caption" value={caption} onChange={(e) => setCaption(e.target.value)} rows={9} className={`${inputClass} leading-relaxed`} />
          </label>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <label className="block text-sm">
            <span className={label}>Creative brief (what the image or video should show)</span>
            <textarea name="setting_creative_brief" defaultValue={String(item.settings.creative_brief ?? "")} rows={3} className={`${inputClass} leading-relaxed`} />
          </label>
          <label className="flex items-start gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="setting_needs_jyotish_review" defaultChecked={item.settings.needs_jyotish_review === true} className="mt-0.5" />
            <span>
              Needs Jyotish review
              <span className="block text-xs text-muted">Tick when the post names a transit date, makes sign-by-sign predictions or explains a yoga, dosha or remedy.</span>
            </span>
          </label>
        </div>

        {(channel === "instagram" || channel === "facebook") && (
          <label className="block max-w-xs text-sm">
            <span className={label}>Post as</span>
            <select name="setting_post_type" defaultValue={String(item.settings.post_type ?? "post")} className={inputClass}>
              <option value="post">Feed post or reel</option>
              <option value="story">Story (24 hours)</option>
            </select>
          </label>
        )}
        {channel === "youtube" && (
          <div className="flex flex-wrap gap-4">
            <label className="block w-48 text-sm">
              <span className={label}>Visibility</span>
              <select name="setting_visibility" defaultValue={String(item.settings.visibility ?? "public")} className={inputClass}>
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </select>
            </label>
            <label className="block w-48 text-sm">
              <span className={label}>Made for kids</span>
              <select name="setting_made_for_kids" defaultValue={String(item.settings.made_for_kids ?? "no")} className={inputClass}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </label>
          </div>
        )}

        <div>
          <div className="mb-2 text-xs text-muted">Media, in posting order ({selected.length} chosen)</div>
          {selected.length > 0 && (
            <ol className="mb-4 flex flex-wrap gap-3">
              {selected.map((id, i) => {
                const a = byId.get(id);
                if (!a) return null;
                return (
                  <li key={id} className="w-28">
                    <AssetThumb a={a} className="aspect-[4/5] rounded-lg ring-2 ring-turmeric" />
                    <div className="mt-1 flex items-center justify-between text-[11px]">
                      <span className="font-mono">{i + 1}</span>
                      <span className="flex gap-0.5">
                        <button type="button" onClick={() => move(i, -1)} className="rounded p-0.5 hover:bg-paper" aria-label={`Move ${a.name} earlier`}><ArrowUp size={12} /></button>
                        <button type="button" onClick={() => move(i, 1)} className="rounded p-0.5 hover:bg-paper" aria-label={`Move ${a.name} later`}><ArrowDown size={12} /></button>
                        <button type="button" onClick={() => toggle(id)} className="rounded p-0.5 hover:bg-paper" aria-label={`Remove ${a.name}`}><X size={12} /></button>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <details className="rounded-lg border border-rule">
            <summary className="cursor-pointer px-3 py-2 text-sm text-dusk">Choose from the library ({library.length})</summary>
            <div className="grid grid-cols-3 gap-2 p-3 sm:grid-cols-5 lg:grid-cols-8">
              {library.map((a) => {
                const on = selected.includes(a.id);
                return (
                  <button
                    type="button"
                    key={a.id}
                    onClick={() => toggle(a.id)}
                    aria-pressed={on}
                    className={`relative overflow-hidden rounded-lg text-left ring-2 ${on ? "ring-turmeric" : "ring-transparent hover:ring-rule"}`}
                    title={a.name}
                  >
                    <AssetThumb a={a} className="aspect-square" />
                    {on && <span className="absolute top-1 left-1 rounded-full bg-turmeric p-0.5 text-night"><Check size={11} /></span>}
                    <span className="block truncate px-1 py-0.5 text-[10px] text-muted">{a.name}</span>
                  </button>
                );
              })}
            </div>
          </details>
        </div>
      </fieldset>

      {!item.locked && (
        <div className="flex flex-wrap items-center gap-3">
          <button className={btn.primary} disabled={pending}>{pending ? "Saving…" : "Save"}</button>
          {state && (
            <p className={`text-sm ${state.ok ? "text-leaf" : "text-sindoor"}`} role={state.ok ? "status" : "alert"}>
              {state.ok ? state.message : state.error}
            </p>
          )}
        </div>
      )}
    </form>
  );
}

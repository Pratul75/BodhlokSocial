"use client";

import { useActionState } from "react";
import { saveBrandKit, type BrandResult } from "./actions";
import { btn, inputClass } from "@/components/ui";

export interface BrandKitView {
  palette: string;
  imageStyle: string;
  voice: string;
  banned: string;
  hashtags: string;
  logoAssetId: string;
  stampLogo: boolean;
  logos: { id: string; name: string }[];
  canEdit: boolean;
}

export function BrandKitForm({ kit }: { kit: BrandKitView }) {
  const [state, action, pending] = useActionState<BrandResult, FormData>(saveBrandKit, null);
  const label = "mb-1 block text-xs text-muted";
  return (
    <form action={action} className="space-y-4 px-5 py-4">
      <fieldset disabled={!kit.canEdit || pending} className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm">
          <span className={label}>Palette, one colour per line: Name #RRGGBB</span>
          <textarea name="palette" defaultValue={kit.palette} rows={4} className={`${inputClass} font-mono text-[13px]`} placeholder={"Night indigo #191C3A\nTurmeric #E0A21B"} />
        </label>
        <label className="block text-sm">
          <span className={label}>Image style, added to every image prompt</span>
          <textarea name="imageStyle" defaultValue={kit.imageStyle} rows={4} className={inputClass} placeholder="Warm, editorial photography. Indigo night tones with brass and turmeric highlights. Real Indian homes and study rooms, not fantasy." />
        </label>
        <label className="block text-sm">
          <span className={label}>Caption voice, for the Content agent</span>
          <textarea name="voice" defaultValue={kit.voice} rows={4} className={inputClass} placeholder="Plain Hinglish where it fits. Respectful of the tradition, precise about the maths. Never fear-based." />
        </label>
        <label className="block text-sm">
          <span className={label}>Banned phrases, one per line. Posts containing them can't be approved.</span>
          <textarea name="banned" defaultValue={kit.banned} rows={4} className={inputClass} placeholder={"best astrologer in india\nchange your destiny"} />
        </label>
        <label className="block text-sm">
          <span className={label}>Default hashtags</span>
          <input name="hashtags" defaultValue={kit.hashtags} className={inputClass} placeholder="#vedicastrology #kundli #bodh" />
        </label>
        <div className="space-y-2 text-sm">
          <label className="block">
            <span className={label}>Logo, from the library</span>
            <select name="logoAssetId" defaultValue={kit.logoAssetId} className={inputClass}>
              <option value="">No logo</option>
              {kit.logos.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="stampLogo" defaultChecked={kit.stampLogo} /> Stamp the logo on generated images
          </label>
        </div>
      </fieldset>
      {kit.canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button className={btn.secondary} disabled={pending}>{pending ? "Saving…" : "Save brand kit"}</button>
          {state && <p className={`text-sm ${state.ok ? "text-leaf" : "text-sindoor"}`} role={state.ok ? "status" : "alert"}>{state.ok ? state.message : state.error}</p>}
        </div>
      ) : (
        <p className="text-xs text-muted">Admins and social media managers can change the brand kit.</p>
      )}
    </form>
  );
}

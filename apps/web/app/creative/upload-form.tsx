"use client";

import { useActionState } from "react";
import { Upload } from "lucide-react";
import { uploadAssets, type UploadResult } from "./actions";
import { btn } from "@/components/ui";

export function UploadForm() {
  const [state, action, pending] = useActionState<UploadResult, FormData>(uploadAssets, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3 px-5 py-4">
      <label className="flex-1 cursor-pointer rounded-lg border border-dashed border-rule bg-paper px-4 py-3 text-sm text-muted hover:border-dusk">
        <span className="font-medium text-ink">Choose files</span> · JPG, PNG, WebP, MP4 or MOV, up to 200 MB each
        <input type="file" name="files" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" className="mt-2 block w-full text-xs" />
      </label>
      <button className={btn.primary} disabled={pending}>
        <Upload size={16} /> {pending ? "Uploading…" : "Upload"}
      </button>
      {state && <p className={`w-full text-sm ${state.ok ? "text-leaf" : "text-sindoor"}`} role={state.ok ? "status" : "alert"}>{state.ok ? state.message : state.error}</p>}
    </form>
  );
}

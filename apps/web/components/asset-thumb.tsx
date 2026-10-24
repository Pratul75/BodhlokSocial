import { Film, ImageIcon } from "lucide-react";

export interface ThumbAsset {
  id: string;
  name: string;
  type: string;
  storagePath: string;
  width: number | null;
  height: number | null;
}

/** Shows the stored file when there is one; sample assets without files show their shape. */
export function AssetThumb({ a, className = "" }: { a: ThumbAsset; className?: string }) {
  const stored = a.storagePath.startsWith("uploads/") || a.storagePath.startsWith("generated/");
  return (
    <div className={`relative flex items-center justify-center overflow-hidden bg-dusk-soft ${className}`}>
      {stored && a.type === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/assets/${a.id}`} alt={a.name} className="h-full w-full object-cover" loading="lazy" />
      ) : stored && a.type === "video" ? (
        <video src={`/api/assets/${a.id}`} className="h-full w-full object-cover" muted preload="metadata" />
      ) : (
        <div className="flex flex-col items-center gap-1 text-dusk/60">
          {a.type === "video" ? <Film size={22} /> : <ImageIcon size={22} />}
          {a.width && a.height && <span className="font-mono text-[10px]">{a.width}×{a.height}</span>}
        </div>
      )}
      {a.type === "video" && stored && (
        <span className="absolute right-1 bottom-1 rounded bg-night/80 px-1 text-[10px] text-white">Video</span>
      )}
    </div>
  );
}

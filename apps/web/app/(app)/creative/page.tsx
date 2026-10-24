import { desc, eq } from "drizzle-orm";
import { Film, ImageIcon, Sparkles } from "lucide-react";
import { assets, connections, db } from "@bodh/db";
import { requireModule } from "@/lib/auth";
import { ago } from "@/lib/format";
import { Card, CardHeader, PageHeader, Pill, btn } from "@/components/ui";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Creative studio" };

const SOURCE: Record<string, string> = { upload: "Uploaded", imagen: "Imagen", veo: "Veo" };
const GENERATORS = [
  { label: "Image", sub: "Imagen, with the brand kit" },
  { label: "Thumbnail", sub: "YouTube 1280×720" },
  { label: "Carousel", sub: "Up to 10 slides" },
  { label: "Video", sub: "Veo, 8 seconds" },
];

export default async function CreativePage() {
  await requireModule("creative");
  const [rows, [vertex]] = await Promise.all([
    db.select().from(assets).orderBy(desc(assets.createdAt)),
    db.select().from(connections).where(eq(connections.key, "vertex")),
  ]);
  const vertexReady = vertex?.status === "connected";
  const now = new Date();

  return (
    <>
      <PageHeader title="Creative studio" description="Upload your own images and videos, or generate them. The brand kit is applied to everything generated." />

      <div className="mb-6 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader title="Upload" />
          <UploadForm />
        </Card>
        <Card>
          <CardHeader title="Generate" sub={vertexReady ? "Uses Vertex AI" : "Connect Vertex AI in Connections to generate"} />
          <div className="grid grid-cols-2 gap-2 px-5 py-4">
            {GENERATORS.map((g) => (
              <button key={g.label} className={`${btn.secondary} flex-col items-start py-2.5 text-left`} disabled={!vertexReady}>
                <span className="flex items-center gap-1.5"><Sparkles size={14} /> {g.label}</span>
                <span className="text-xs font-normal text-muted">{g.sub}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">Library</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {rows.map((a) => {
          const local = a.storagePath.startsWith("uploads/");
          const ratio = a.width && a.height ? `${a.width} / ${a.height}` : "1 / 1";
          return (
            <figure key={a.id} className="overflow-hidden rounded-xl border border-rule bg-card">
              <div className="relative flex items-center justify-center overflow-hidden bg-dusk-soft" style={{ aspectRatio: "4 / 5" }}>
                {local && a.type === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/assets/${a.id}`} alt={a.name} className="h-full w-full object-cover" />
                ) : local && a.type === "video" ? (
                  <video src={`/api/assets/${a.id}`} className="h-full w-full object-cover" muted controls preload="metadata" />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-dusk/60" style={{ aspectRatio: ratio, maxHeight: "80%", maxWidth: "80%" }}>
                    {a.type === "video" ? <Film size={28} /> : <ImageIcon size={28} />}
                    <span className="font-mono text-[11px]">{a.width && a.height ? `${a.width}×${a.height}` : ""}</span>
                  </div>
                )}
              </div>
              <figcaption className="px-3 py-2">
                <div className="truncate text-xs font-medium" title={a.name}>{a.name}</div>
                <div className="mt-1 flex items-center justify-between gap-1 text-[11px] text-muted">
                  <Pill>{SOURCE[a.source] ?? a.source}</Pill>
                  <span>{ago(a.createdAt, now)}</span>
                </div>
              </figcaption>
            </figure>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted">Sample assets show a placeholder because they have no stored file.</p>
    </>
  );
}

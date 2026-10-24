import { desc, eq } from "drizzle-orm";
import { RefreshCw } from "lucide-react";
import { assets, connections, creativeJobs, db } from "@bodh/db";
import { loadBrand, MONTHLY_LIMITS, monthlyUsage } from "@bodh/integrations/creative";
import { requireModule } from "@/lib/auth";
import { vertexConfiguredByRuntime } from "@/lib/creative";
import { ago, num } from "@/lib/format";
import { AssetThumb } from "@/components/asset-thumb";
import { Meter } from "@/components/charts";
import { Card, CardHeader, PageHeader, Pill, StatusPill, btn } from "@/components/ui";
import { checkVideos } from "./actions";
import { BrandKitForm } from "./brand-kit-form";
import { GenerateForm } from "./generate-form";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Creative studio" };

const SOURCE: Record<string, string> = { upload: "Uploaded", imagen: "Imagen", gemini: "Generated", veo: "Veo" };
const KIND: Record<string, string> = { image: "Image", carousel: "Carousel", thumbnail: "Thumbnail", video: "Video" };

export default async function CreativePage() {
  const user = await requireModule("creative");
  const [rows, [vertex], jobs, usage, brand] = await Promise.all([
    db.select().from(assets).orderBy(desc(assets.createdAt)).limit(120),
    db.select().from(connections).where(eq(connections.key, "vertex")),
    db.select().from(creativeJobs).orderBy(desc(creativeJobs.createdAt)).limit(8),
    monthlyUsage(),
    loadBrand(),
  ]);
  const vertexReady = vertex?.status === "connected" || vertexConfiguredByRuntime();
  const now = new Date();
  const running = jobs.some((j) => j.status === "running");

  return (
    <>
      <PageHeader title="Creative studio" description="Upload images and videos, or generate them with the brand kit applied. Everything lands in the library, ready to attach to calendar posts." />

      <div className="mb-6 grid gap-6 lg:grid-cols-[1.2fr_1fr] [&>*]:min-w-0">
        <Card>
          <CardHeader title="Generate" sub={vertexReady ? "Gemini for images, Veo for video, through Vertex AI" : undefined} />
          <GenerateForm disabled={!vertexReady} reason="Connect Vertex AI in Connections to generate." />
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Upload" />
            <UploadForm />
          </Card>
          <Card className="p-5">
            <div className="mb-3 text-xs font-medium text-muted">This month</div>
            <div className="space-y-3 text-sm">
              <div>
                <div className="mb-1 flex justify-between"><span>Images</span><span className="font-mono tabular">{num(usage.images)} of {num(MONTHLY_LIMITS.images)}</span></div>
                <Meter value={usage.images} max={MONTHLY_LIMITS.images} />
              </div>
              <div>
                <div className="mb-1 flex justify-between"><span>Videos</span><span className="font-mono tabular">{num(usage.videos)} of {num(MONTHLY_LIMITS.videos)}</span></div>
                <Meter value={usage.videos} max={MONTHLY_LIMITS.videos} />
              </div>
            </div>
          </Card>
        </div>
      </div>

      {jobs.length > 0 && (
        <Card className="mb-6">
          <CardHeader
            title="Recent generations"
            aside={
              running ? (
                <form action={checkVideos}>
                  <button className={btn.ghost}><RefreshCw size={14} /> Check videos now</button>
                </form>
              ) : undefined
            }
          />
          <ul className="divide-y divide-rule">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Pill tone="dusk">{KIND[j.kind] ?? j.kind}</Pill>
                    <span className="truncate">{j.prompt}</span>
                  </div>
                  {j.error && <p className="mt-1 text-xs text-sindoor">{j.error}</p>}
                  {j.status === "running" && j.kind === "video" && <p className="mt-1 text-xs text-muted">Usually ready in one to three minutes. The worker checks every minute.</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusPill status={j.status} />
                  <span className="text-xs text-muted">{ago(j.createdAt, now)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">Library</h2>
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {rows.map((a) => (
          <figure key={a.id} className="overflow-hidden rounded-xl border border-rule bg-card">
            <AssetThumb a={a} className="aspect-[4/5]" />
            <figcaption className="px-3 py-2">
              <div className="truncate text-xs font-medium" title={a.prompt ?? a.name}>{a.name}</div>
              <div className="mt-1 flex items-center justify-between gap-1 text-[11px] text-muted">
                <Pill>{SOURCE[a.source] ?? a.source}</Pill>
                <span>{ago(a.createdAt, now)}</span>
              </div>
            </figcaption>
          </figure>
        ))}
      </div>

      <Card>
        <CardHeader title="Brand kit" sub="Applied to every generated image, and checked on every caption before approval" />
        <BrandKitForm
          kit={{
            palette: brand.palette.map((c) => `${c.name} ${c.hex}`).join("\n"),
            imageStyle: brand.imageStyle,
            voice: brand.voice,
            banned: brand.bannedPhrases.join("\n"),
            hashtags: brand.defaultHashtags.join(" "),
            logoAssetId: brand.logoAssetId ?? "",
            stampLogo: brand.stampLogo,
            logos: rows.filter((r) => r.type === "image").map((r) => ({ id: r.id, name: r.name })),
            canEdit: user.role === "admin" || user.role === "social_manager",
          }}
        />
      </Card>
    </>
  );
}

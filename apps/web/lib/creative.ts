import "server-only";
import { eq } from "drizzle-orm";
import { assets, creativeJobs, db } from "@bodh/db";
import { assetBytes, loadBrand, MONTHLY_LIMITS, monthlyUsage, vertexKey } from "@bodh/integrations/creative";
import { imageSize, saveFile, storagePathFor } from "@bodh/integrations/storage";
import { brandPrompt, generateImage, vertexAuth, type CreativeKind, type ImageAspect } from "@bodh/integrations/vertex";
import { compose } from "./compose";

export interface ImageJobInput {
  kind: Exclude<CreativeKind, "video">;
  prompt: string;
  aspectRatio: ImageAspect;
  count: number; // images for "image", slides for "carousel", 1 for "thumbnail"
  title?: string | null;
}

async function inBatches<T>(n: number, size: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < n; i += size) out.push(...(await Promise.all(Array.from({ length: Math.min(size, n - i) }, (_, k) => fn(i + k)))));
  return out;
}

/** Generates, applies the brand kit, stores the results as assets. Returns the job and asset IDs. */
export async function runImageJob(input: ImageJobInput, requestedBy: string) {
  const n = input.kind === "thumbnail" ? 1 : input.count;
  const usage = await monthlyUsage();
  if (usage.images + n > MONTHLY_LIMITS.images) {
    throw new Error(`This would pass this month's limit of ${MONTHLY_LIMITS.images} images (${usage.images} used).`);
  }
  const brand = await loadBrand();
  const aspect: ImageAspect = input.kind === "thumbnail" ? "16:9" : input.aspectRatio;
  const [job] = await db
    .insert(creativeJobs)
    .values({ kind: input.kind, prompt: input.prompt, params: { aspectRatio: aspect, count: n, title: input.title ?? null }, status: "running", requestedBy })
    .returning();

  try {
    const auth = await vertexAuth(await vertexKey());
    const logo = brand.stampLogo && brand.logoAssetId ? (await assetBytes([brand.logoAssetId]))[0] : undefined;
    const logoData = logo?.bytes ? { bytes: logo.bytes, mimeType: logo.asset.contentType ?? "image/png" } : null;
    const accent = brand.palette[0]?.hex;

    const made = await inBatches(n, 3, async (i) => {
      const prompt = brandPrompt(input.prompt, brand, input.kind, input.kind === "carousel" ? { slide: i + 1, slides: n } : {});
      const img = await generateImage(auth, prompt, aspect);
      const dims = imageSize(img.bytes) ?? { width: 1024, height: 1024 };
      const needsCompose = input.kind === "thumbnail" || Boolean(logoData);
      const out = needsCompose
        ? await compose({
            image: { ...img, ...dims },
            size: input.kind === "thumbnail" ? { width: 1280, height: 720 } : dims,
            title: input.kind === "thumbnail" ? input.title : null,
            logo: logoData,
            accent,
          })
        : img.bytes;
      const mime = needsCompose ? "image/png" : img.mimeType;
      const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
      const slug = input.prompt.slice(0, 32).replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "image";
      const name = `${slug}${n > 1 ? `-${i + 1}` : ""}.${ext}`;
      const path = storagePathFor("generated", name);
      await saveFile(path, out, mime);
      const size = imageSize(out) ?? dims;
      const [a] = await db
        .insert(assets)
        .values({ name, type: "image", source: "gemini", storagePath: path, contentType: mime, sizeBytes: out.length, width: size.width, height: size.height, prompt: input.prompt, jobId: job!.id, createdBy: requestedBy })
        .returning({ id: assets.id });
      return a!.id;
    });

    await db.update(creativeJobs).set({ status: "succeeded", assetIds: made, finishedAt: new Date() }).where(eq(creativeJobs.id, job!.id));
    return { jobId: job!.id, assetIds: made };
  } catch (e) {
    await db
      .update(creativeJobs)
      .set({ status: "failed", error: e instanceof Error ? e.message : String(e), finishedAt: new Date() })
      .where(eq(creativeJobs.id, job!.id));
    throw e;
  }
}

/** Vertex is usable when its service account is connected, or the runtime identity has access (Cloud Run). */
export function vertexConfiguredByRuntime() {
  return process.env.VERTEX_USE_ADC === "true";
}

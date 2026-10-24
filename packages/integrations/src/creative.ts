import { and, eq, inArray, sql } from "drizzle-orm";
import { assets, brandKit, creativeJobs, db } from "@bodh/db";
import { readJsonSecret } from "./secrets";
import { pathFromGcsUri, readFileBytes, saveFile, storagePathFor } from "./storage";
import { brandPrompt, pollVideo, startVideo, vertexAuth, type ServiceAccountKey, type VideoOptions } from "./vertex";

/** Monthly limits across the team; image counts each generated image, video each clip. */
export const MONTHLY_LIMITS = {
  images: Number(process.env.CREATIVE_MONTHLY_IMAGES ?? 300),
  videos: Number(process.env.CREATIVE_MONTHLY_VIDEOS ?? 30),
};

export async function monthlyUsage(): Promise<{ images: number; videos: number }> {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const rows = (await db.execute(sql`
    SELECT
      coalesce(sum(CASE WHEN kind = 'video' THEN 0 ELSE greatest(jsonb_array_length(asset_ids), coalesce((params->>'count')::int, 1)) END) FILTER (WHERE status <> 'failed'), 0)::int AS images,
      count(*) FILTER (WHERE kind = 'video' AND status <> 'failed')::int AS videos
    FROM creative_jobs WHERE created_at >= ${start.toISOString()}::timestamptz`)) as unknown as { images: number; videos: number }[];
  return rows[0] ?? { images: 0, videos: 0 };
}

export async function loadBrand() {
  const [kit] = await db.select().from(brandKit).limit(1);
  return kit ?? { palette: [], imageStyle: "", voice: "", bannedPhrases: [], defaultHashtags: [], stampLogo: false, logoAssetId: null };
}

export const vertexKey = () => readJsonSecret<ServiceAccountKey>("vertex");

/** Queue a Veo clip. The worker polls it; finished videos land in the asset library. */
export async function startVideoJob(prompt: string, opts: Omit<VideoOptions, "storageUri">, requestedBy: string) {
  const usage = await monthlyUsage();
  if (usage.videos >= MONTHLY_LIMITS.videos) throw new Error(`This month's limit of ${MONTHLY_LIMITS.videos} videos is reached.`);
  const brand = await loadBrand();
  const fullPrompt = brandPrompt(prompt, brand, "video");
  const [job] = await db
    .insert(creativeJobs)
    .values({ kind: "video", prompt, params: { ...opts, fullPrompt }, status: "running", requestedBy })
    .returning();
  try {
    const auth = await vertexAuth(await vertexKey());
    // Inline result: an 8-second 720p clip is a few MB, and the worker stores it.
    const operationName = await startVideo(auth, fullPrompt, { ...opts, storageUri: null });
    await db.update(creativeJobs).set({ operationName }).where(eq(creativeJobs.id, job!.id));
    return job!.id;
  } catch (e) {
    await db
      .update(creativeJobs)
      .set({ status: "failed", error: e instanceof Error ? e.message : String(e), finishedAt: new Date() })
      .where(eq(creativeJobs.id, job!.id));
    throw e;
  }
}

/** Check running video jobs once. Called by the worker every minute and by "Check now". */
export async function pollVideoJobs(): Promise<{ checked: number; finished: number; failed: number }> {
  const running = await db
    .select()
    .from(creativeJobs)
    .where(and(eq(creativeJobs.kind, "video"), eq(creativeJobs.status, "running")));
  if (running.length === 0) return { checked: 0, finished: 0, failed: 0 };
  const auth = await vertexAuth(await vertexKey());
  let finished = 0;
  let failed = 0;
  for (const job of running) {
    const fail = async (error: string) => {
      failed++;
      await db.update(creativeJobs).set({ status: "failed", error, finishedAt: new Date() }).where(eq(creativeJobs.id, job.id));
    };
    if (!job.operationName) {
      if (Date.now() - job.createdAt.getTime() > 10 * 60_000) await fail("The video request never started.");
      continue;
    }
    if (Date.now() - job.createdAt.getTime() > 60 * 60_000) {
      await fail("Gave up after an hour without a result.");
      continue;
    }
    const r = await pollVideo(auth, job.operationName);
    if (!r.done) continue;
    if (!r.ok) {
      await fail(r.error);
      continue;
    }
    let path = r.video.gcsUri ? pathFromGcsUri(r.video.gcsUri) : null;
    let size: number | null = null;
    if (!path && r.video.bytes) {
      path = storagePathFor("generated", `video-${job.id}.mp4`);
      await saveFile(path, r.video.bytes, r.video.mimeType);
      size = r.video.bytes.length;
    }
    if (!path) {
      await fail(r.video.gcsUri ? `Vertex wrote the video outside our bucket: ${r.video.gcsUri}` : "No video data came back.");
      continue;
    }
    const opts = job.params as { aspectRatio?: string };
    const [w, h] = opts.aspectRatio === "16:9" ? [1280, 720] : [720, 1280];
    const [asset] = await db
      .insert(assets)
      .values({
        name: `${job.prompt.slice(0, 40).replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "video"}.mp4`,
        type: "video",
        source: "veo",
        storagePath: path,
        contentType: r.video.mimeType,
        sizeBytes: size,
        width: w,
        height: h,
        prompt: job.prompt,
        jobId: job.id,
        createdBy: job.requestedBy,
      })
      .returning({ id: assets.id });
    await db.update(creativeJobs).set({ status: "succeeded", assetIds: [asset!.id], finishedAt: new Date() }).where(eq(creativeJobs.id, job.id));
    finished++;
  }
  return { checked: running.length, finished, failed };
}

export async function assetBytes(ids: string[]) {
  if (!ids.length) return [];
  const rows = await db.select().from(assets).where(inArray(assets.id, ids));
  return Promise.all(rows.map(async (a) => ({ asset: a, bytes: await readFileBytes(a.storagePath) })));
}



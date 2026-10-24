"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { assets, brandKit, db } from "@bodh/db";
import { canAccess } from "@bodh/shared";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { saveUpload, imageSize } from "@/lib/storage";
import { runImageJob } from "@/lib/creative";
import { pollVideoJobs, startVideoJob } from "@bodh/integrations/creative";
import { IMAGE_ASPECTS, type ImageAspect } from "@bodh/integrations/vertex";

const MAX_BYTES = 200 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"];

export type UploadResult = { ok: true; message: string } | { ok: false; error: string } | null;

export async function uploadAssets(_prev: UploadResult, formData: FormData): Promise<UploadResult> {
  const user = await getCurrentUser();
  if (!canAccess(user.role, "creative")) return { ok: false, error: "Your role can't upload creative." };
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { ok: false, error: "Choose at least one JPG, PNG or MP4." };

  for (const f of files) {
    if (!ALLOWED.includes(f.type)) return { ok: false, error: `${f.name} is not a JPG, PNG, WebP, MP4 or MOV file.` };
    if (f.size > MAX_BYTES) return { ok: false, error: `${f.name} is over 200 MB.` };
  }
  for (const f of files) {
    const buf = await f.arrayBuffer();
    const path = await saveUpload(f.name, buf, f.type);
    const dims = f.type.startsWith("image") ? imageSize(Buffer.from(buf)) : null;
    await db.insert(assets).values({
      name: f.name,
      type: f.type.startsWith("video") ? "video" : "image",
      source: "upload",
      storagePath: path,
      contentType: f.type,
      sizeBytes: f.size,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      createdBy: user.email,
    });
  }
  await audit({ actor: user.email, actorType: "user", action: "upload_assets", target: `${files.length} file(s)`, result: "stored" });
  revalidatePath("/creative");
  return { ok: true, message: `Uploaded ${files.length} file${files.length === 1 ? "" : "s"}.` };
}

export type GenerateResult = { ok: true; message: string } | { ok: false; error: string } | null;

export async function generateCreative(_prev: GenerateResult, formData: FormData): Promise<GenerateResult> {
  const user = await getCurrentUser();
  if (!canAccess(user.role, "creative")) return { ok: false, error: "Your role can't generate creative." };
  const kind = String(formData.get("kind"));
  const prompt = String(formData.get("prompt") ?? "").trim();
  if (prompt.length < 10) return { ok: false, error: "Describe what you want in at least a sentence." };
  if (prompt.length > 2000) return { ok: false, error: "Keep the description under 2,000 characters." };
  try {
    if (kind === "video") {
      const aspectRatio = formData.get("videoAspect") === "16:9" ? "16:9" : "9:16";
      const d = Number(formData.get("duration"));
      const durationSeconds = d === 4 || d === 6 ? d : 8;
      await startVideoJob(prompt, { aspectRatio, durationSeconds, generateAudio: formData.get("audio") === "on" }, user.email);
      await audit({ actor: user.email, actorType: "user", action: "generate_video", target: prompt.slice(0, 80), result: "started" });
      revalidatePath("/creative");
      return { ok: true, message: "Video started. It takes one to three minutes and appears in the library when ready." };
    }
    if (!["image", "carousel", "thumbnail"].includes(kind)) return { ok: false, error: "Pick what to make." };
    const aspect = String(formData.get("aspect")) as ImageAspect;
    const count = kind === "carousel" ? Math.min(6, Math.max(2, Number(formData.get("slides")) || 3)) : Math.min(4, Math.max(1, Number(formData.get("count")) || 1));
    const title = String(formData.get("title") ?? "").trim() || null;
    if (kind === "thumbnail" && !title) return { ok: false, error: "Add the title to put on the thumbnail." };
    if (kind === "thumbnail" && title && title.length > 60) return { ok: false, error: "Keep thumbnail titles under 60 characters." };
    const r = await runImageJob(
      { kind: kind as "image" | "carousel" | "thumbnail", prompt, aspectRatio: (IMAGE_ASPECTS as readonly string[]).includes(aspect) ? aspect : "1:1", count, title },
      user.email,
    );
    await audit({ actor: user.email, actorType: "user", action: `generate_${kind}`, target: prompt.slice(0, 80), result: `${r.assetIds.length} asset(s)` });
    revalidatePath("/creative");
    return { ok: true, message: `Made ${r.assetIds.length} ${kind === "carousel" ? "slides" : r.assetIds.length === 1 ? "image" : "images"}. They're at the top of the library.` };
  } catch (e) {
    revalidatePath("/creative");
    return { ok: false, error: e instanceof Error ? e.message : "Generation failed." };
  }
}

export async function checkVideos(): Promise<void> {
  const user = await getCurrentUser();
  if (!canAccess(user.role, "creative")) return;
  try {
    await pollVideoJobs();
  } catch {
    // The job rows keep their status; errors show on the next poll.
  }
  revalidatePath("/creative");
}

export type BrandResult = { ok: true; message: string } | { ok: false; error: string } | null;

export async function saveBrandKit(_prev: BrandResult, formData: FormData): Promise<BrandResult> {
  const user = await getCurrentUser();
  if (user.role !== "admin" && user.role !== "social_manager") return { ok: false, error: "Only admins and social media managers can change the brand kit." };
  const lines = (k: string) => String(formData.get(k) ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const palette: { name: string; hex: string }[] = [];
  for (const l of lines("palette")) {
    const m = l.match(/^(.*?)\s*(#[0-9a-fA-F]{6})$/);
    if (!m) return { ok: false, error: `"${l}" isn't "Name #RRGGBB".` };
    palette.push({ name: m[1]!.trim() || m[2]!, hex: m[2]!.toUpperCase() });
  }
  const logo = String(formData.get("logoAssetId") ?? "") || null;
  if (logo) {
    const [a] = await db.select({ type: assets.type }).from(assets).where(eq(assets.id, logo)).limit(1);
    if (a?.type !== "image") return { ok: false, error: "The logo must be an image from the library." };
  }
  const hashtags = lines("hashtags").flatMap((l) => l.split(/\s+/)).map((h) => (h.startsWith("#") ? h : `#${h}`));
  await db
    .insert(brandKit)
    .values({ id: 1 })
    .onConflictDoNothing();
  await db
    .update(brandKit)
    .set({
      palette,
      logoAssetId: logo,
      imageStyle: String(formData.get("imageStyle") ?? "").trim(),
      voice: String(formData.get("voice") ?? "").trim(),
      bannedPhrases: lines("banned"),
      defaultHashtags: hashtags,
      stampLogo: formData.get("stampLogo") === "on",
      updatedBy: user.email,
      updatedAt: new Date(),
    })
    .where(eq(brandKit.id, 1));
  await audit({ actor: user.email, actorType: "user", action: "update_brand_kit", target: "brand kit", result: "saved" });
  revalidatePath("/creative");
  return { ok: true, message: "Brand kit saved. New generations and caption checks use it." };
}

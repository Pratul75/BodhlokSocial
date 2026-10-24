"use server";

import { revalidatePath } from "next/cache";
import { assets, db } from "@bodh/db";
import { canAccess } from "@bodh/shared";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { saveUpload } from "@/lib/storage";

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
    const path = await saveUpload(f.name, await f.arrayBuffer());
    await db.insert(assets).values({ name: f.name, type: f.type.startsWith("video") ? "video" : "image", source: "upload", storagePath: path });
  }
  await audit({ actor: user.email, actorType: "user", action: "upload_assets", target: `${files.length} file(s)`, result: "stored" });
  revalidatePath("/creative");
  return { ok: true, message: `Uploaded ${files.length} file${files.length === 1 ? "" : "s"}.` };
}

import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

/**
 * Where uploaded images and videos live. `storagePath` in the assets table is the
 * same ("uploads/<file>") for both backends.
 * - local: <repo>/.uploads (gitignored). Development only.
 * - gcs:   the Cloud Storage bucket in GCS_BUCKET. Files are served through short-lived signed URLs.
 */
const DIR = resolve(process.cwd(), "../../.uploads");
const useGcs = () => process.env.STORAGE_BACKEND === "gcs";

async function bucket() {
  const name = process.env.GCS_BUCKET;
  if (!name) throw new Error("GCS_BUCKET must be set when STORAGE_BACKEND=gcs.");
  const { Storage } = await import("@google-cloud/storage");
  return new Storage().bucket(name);
}

export function uploadPath(name: string): string {
  return `uploads/${Date.now()}-${basename(name).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
}

export async function saveUpload(name: string, data: ArrayBuffer, contentType: string): Promise<string> {
  const path = uploadPath(name);
  if (useGcs()) {
    await (await bucket()).file(path).save(Buffer.from(data), { contentType, resumable: false });
    return path;
  }
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_AUTH !== "true") {
    throw new Error("Set STORAGE_BACKEND=gcs in production. Local uploads are lost when Cloud Run restarts.");
  }
  await mkdir(DIR, { recursive: true });
  await writeFile(join(DIR, basename(path)), Buffer.from(data));
  return path;
}

/** Local backend only: the file's bytes. */
export async function readUpload(storagePath: string): Promise<Buffer | null> {
  if (!storagePath.startsWith("uploads/")) return null;
  try {
    return await readFile(join(DIR, basename(storagePath)));
  } catch {
    return null;
  }
}

/** GCS backend only: a 15-minute signed URL for the file. */
export async function signedUrl(storagePath: string): Promise<string | null> {
  if (!useGcs() || !storagePath.startsWith("uploads/")) return null;
  const file = (await bucket()).file(storagePath);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [url] = await file.getSignedUrl({ version: "v4", action: "read", expires: Date.now() + 15 * 60 * 1000 });
  return url;
}

export const usesSignedUrls = useGcs;

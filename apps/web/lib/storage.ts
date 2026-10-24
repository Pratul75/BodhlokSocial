import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, basename } from "node:path";

/** Local stand-in for Cloud Storage. Files land in <repo>/.uploads (gitignored). */
const DIR = resolve(process.cwd(), "../../.uploads");

export async function saveUpload(name: string, data: ArrayBuffer): Promise<string> {
  await mkdir(DIR, { recursive: true });
  const safe = `${Date.now()}-${basename(name).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await writeFile(join(DIR, safe), Buffer.from(data));
  return `uploads/${safe}`;
}

export async function readUpload(storagePath: string): Promise<Buffer | null> {
  if (!storagePath.startsWith("uploads/")) return null;
  try {
    return await readFile(join(DIR, basename(storagePath)));
  } catch {
    return null;
  }
}

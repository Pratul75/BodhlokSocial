import { mkdir, readFile, writeFile } from "node:fs/promises";
import { currentTenant } from "@bodh/db";
import { basename, dirname, join, resolve } from "node:path";

/**
 * Where images and videos live. New paths look like "<workspace>/uploads/<file>" or
 * "<workspace>/generated/<file>"; paths written before workspaces existed have no first
 * segment and are still read exactly as they were stored.
 * - local: <repo>/.uploads (gitignored). Development only.
 * - gcs:   the bucket in GCS_BUCKET. Served through short-lived signed URLs.
 *
 * What keeps one workspace's files from another is the `assets` table, which lives inside the
 * workspace: a path is only ever reached through a row only that workspace can read. The folder
 * per workspace is for the people who look at the bucket — so that whose file this is can be
 * seen without opening the database — and so a restore or an export can be done one at a time.
 */
const PREFIXES = ["uploads/", "generated/"];
const SEGMENT = /^[a-z_][a-z0-9_]{0,62}$/;
// turbopackIgnore keeps Next's file tracer from pulling the whole repo into the server bundle.
const LOCAL_DIR = process.env.UPLOADS_DIR ?? resolve(/* turbopackIgnore: true */ process.cwd(), "../../.uploads");

export const usesGcs = () => process.env.STORAGE_BACKEND === "gcs";
const validPath = (p: string) => {
  if (p.includes("..")) return false;
  if (PREFIXES.some((x) => p.startsWith(x))) return true; // written before workspaces existed
  const [first, ...rest] = p.split("/");
  return Boolean(first && SEGMENT.test(first) && PREFIXES.some((x) => rest.join("/").startsWith(x)));
};

async function bucket() {
  const name = process.env.GCS_BUCKET;
  if (!name) throw new Error("GCS_BUCKET must be set when STORAGE_BACKEND=gcs.");
  const { Storage } = await import("@google-cloud/storage");
  return new Storage().bucket(name);
}

export function storagePathFor(prefix: "uploads" | "generated", name: string): string {
  const file = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${basename(name).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  return `${currentTenant().dataSchema}/${prefix}/${file}`;
}

/** The gs:// URI a Vertex job can write to directly, or null on the local backend. */
export function gcsUriFor(path: string): string | null {
  return usesGcs() && process.env.GCS_BUCKET ? `gs://${process.env.GCS_BUCKET}/${path}` : null;
}

export async function saveFile(path: string, data: Buffer | Uint8Array, contentType: string): Promise<void> {
  if (!validPath(path)) throw new Error(`Invalid storage path: ${path}`);
  if (usesGcs()) {
    await (await bucket()).file(path).save(Buffer.from(data), { contentType, resumable: false });
    return;
  }
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_STORAGE !== "true") {
    throw new Error("Set STORAGE_BACKEND=gcs in production. Local files are lost when Cloud Run restarts.");
  }
  // The local backend mirrors the bucket's layout, folder per workspace and all, so that what
  // development exercises is what production does.
  const full = join(LOCAL_DIR, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, data);
}

export async function readFileBytes(path: string): Promise<Buffer | null> {
  if (!validPath(path)) return null;
  try {
    if (usesGcs()) {
      const [buf] = await (await bucket()).file(path).download();
      return buf;
    }
    try {
      return await readFile(join(LOCAL_DIR, path));
    } catch {
      // Written before workspaces had folders, when everything was flat.
      return await readFile(join(LOCAL_DIR, basename(path)));
    }
  } catch {
    return null;
  }
}

/** Path inside the bucket for a gs:// URI in our bucket, or null. */
export function pathFromGcsUri(uri: string): string | null {
  const b = process.env.GCS_BUCKET;
  if (!b || !uri.startsWith(`gs://${b}/`)) return null;
  const p = uri.slice(`gs://${b}/`.length);
  return validPath(p) ? p : null;
}

export async function signedUrl(path: string, minutes = 15): Promise<string | null> {
  if (!usesGcs() || !validPath(path)) return null;
  const file = (await bucket()).file(path);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [url] = await file.getSignedUrl({ version: "v4", action: "read", expires: Date.now() + minutes * 60_000 });
  return url;
}

/** Width and height from a PNG, JPEG or WebP header, without decoding the image. */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1]!;
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

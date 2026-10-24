import { eq } from "drizzle-orm";
import { assets, db } from "@bodh/db";
import { getCurrentUser } from "@/lib/auth";
import { readUpload, signedUrl, usesSignedUrls } from "@/lib/storage";

const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime" };

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await getCurrentUser();
  const { id } = await params;
  const [a] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  if (!a) return new Response("Not found", { status: 404 });
  if (usesSignedUrls()) {
    const url = await signedUrl(a.storagePath);
    return url ? Response.redirect(url, 302) : new Response("File not found in storage", { status: 404 });
  }
  const file = await readUpload(a.storagePath);
  if (!file) return new Response("File not stored locally", { status: 404 });
  const ext = a.name.split(".").pop()?.toLowerCase() ?? "";
  return new Response(new Uint8Array(file), {
    headers: { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": "private, max-age=3600" },
  });
}

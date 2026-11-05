import { eq } from "drizzle-orm";
import { assets, db } from "@bodh/db";
import { canAccess } from "@bodh/shared";
import { getCurrentUser } from "@/lib/auth";
import { readFileBytes, signedUrl, usesSignedUrls } from "@/lib/storage";

const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime" };

/** Modules that show uploaded or generated media; a role without any of them gets no files. */
const MEDIA_MODULES = ["creative", "calendar", "approvals", "publishing"] as const;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!MEDIA_MODULES.some((m) => canAccess(user.role, m))) return new Response("Not found", { status: 404 });
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return new Response("Not found", { status: 404 });
  const [a] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  if (!a) return new Response("Not found", { status: 404 });
  if (usesSignedUrls()) {
    const url = await signedUrl(a.storagePath);
    return url ? Response.redirect(url, 302) : new Response("File not found in storage", { status: 404 });
  }
  const file = await readFileBytes(a.storagePath);
  if (!file) return new Response("File not stored locally", { status: 404 });
  const ext = a.name.split(".").pop()?.toLowerCase() ?? "";
  return new Response(new Uint8Array(file), {
    headers: { "Content-Type": a.contentType ?? TYPES[ext] ?? "application/octet-stream", "Cache-Control": "private, max-age=3600" },
  });
}

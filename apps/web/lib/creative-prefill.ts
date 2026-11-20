import "server-only";
import { eq } from "drizzle-orm";
import { calendarItems, db } from "@bodh/db";

/**
 * What the Creative studio should already know when it is opened from a calendar post.
 *
 * The three lead lines, the brief and the shape all exist on the item already. Asking somebody
 * to type them a second time is how the image ends up saying something slightly different from
 * the post it belongs to.
 */
export interface CreativePrefill {
  itemId: string;
  idea: string;
  kind: "image" | "carousel" | "thumbnail" | "video";
  aspect: string;
  prompt: string;
  title: string;
  subhead: string;
  cta: string;
  /** True once the post is published: its creative is already out, so nothing should attach. */
  locked: boolean;
}

/** The kind of creative a format asks for, and the shape it is usually made in. */
export function shapeFor(channel: string, format: string): { kind: CreativePrefill["kind"]; aspect: string } {
  if (format === "carousel") return { kind: "carousel", aspect: "4:5" };
  if (format === "long_video" || (channel === "youtube" && format !== "short")) return { kind: "thumbnail", aspect: "16:9" };
  if (format === "reel" || format === "short") return { kind: "video", aspect: "9:16" };
  return { kind: "image", aspect: channel === "linkedin" ? "1:1" : "4:5" };
}

export async function creativePrefill(itemId: string | undefined): Promise<CreativePrefill | null> {
  if (!itemId || !/^[0-9a-f-]{36}$/.test(itemId)) return null;
  const [item] = await db.select().from(calendarItems).where(eq(calendarItems.id, itemId)).limit(1);
  if (!item) return null;

  const brief = typeof item.settings.creative_brief === "string" ? item.settings.creative_brief.trim() : "";
  const { kind, aspect } = shapeFor(item.channel, item.format);
  return {
    itemId: item.id,
    idea: item.idea,
    kind,
    aspect,
    // The brief is what the image should show. Without one the idea is a poor substitute, but a
    // poor substitute somebody can edit beats an empty box.
    prompt: brief || item.idea,
    // The heading is what goes on the creative; the title is the YouTube/blog one, which is the
    // right fallback for a thumbnail and harmless anywhere else.
    title: item.heading ?? item.title ?? "",
    subhead: item.subhead ?? "",
    cta: item.cta ?? "",
    locked: item.status === "published",
  };
}

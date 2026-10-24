import "server-only";
import { inArray } from "drizzle-orm";
import { assets, brandKit, calendarItems, db } from "@bodh/db";
import { checkPost, type PostCheck } from "@bodh/guardrails/posts";

type Item = typeof calendarItems.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;

export async function itemAssets(item: Pick<Item, "assetIds">): Promise<AssetRow[]> {
  if (item.assetIds.length === 0) return [];
  const rows = await db.select().from(assets).where(inArray(assets.id, item.assetIds));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return item.assetIds.map((id) => byId.get(id)).filter((a): a is AssetRow => Boolean(a));
}

export async function bannedPhrases(): Promise<string[]> {
  const [kit] = await db.select({ bannedPhrases: brandKit.bannedPhrases }).from(brandKit).limit(1);
  return kit?.bannedPhrases ?? [];
}

export async function checkItem(item: Item, list?: AssetRow[]): Promise<PostCheck> {
  const a = list ?? (await itemAssets(item));
  return checkPost({
    channel: item.channel,
    format: item.format,
    caption: item.caption,
    title: item.title,
    assets: a.map((x) => ({ type: x.type as "image" | "video" })),
    settings: item.settings,
    bannedPhrases: await bannedPhrases(),
  });
}

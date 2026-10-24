import { lintAdCopy } from "./index";

/**
 * Rules a post must pass before it can be sent for approval, and again before it is
 * published. Errors block; warnings are shown to the approver.
 */
export type PublishChannel = "instagram" | "facebook" | "linkedin" | "youtube";
export const PUBLISH_CHANNELS: readonly PublishChannel[] = ["instagram", "facebook", "linkedin", "youtube"];

export const isPublishChannel = (c: string): c is PublishChannel => (PUBLISH_CHANNELS as readonly string[]).includes(c);

export interface PostDraft {
  channel: string;
  format: string; // reel | short | long_video | image | carousel | post | blog
  caption: string | null;
  title: string | null;
  assets: { type: "image" | "video" }[];
  settings?: Record<string, unknown>;
  bannedPhrases?: string[];
}

export interface PostCheck {
  errors: string[];
  warnings: string[];
}

const LIMITS: Record<PublishChannel, { caption: number; name: string }> = {
  instagram: { caption: 2200, name: "Instagram" },
  facebook: { caption: 63206, name: "Facebook" },
  linkedin: { caption: 3000, name: "LinkedIn" },
  youtube: { caption: 5000, name: "YouTube" },
};

export function checkPost(p: PostDraft): PostCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const caption = (p.caption ?? "").trim();
  const images = p.assets.filter((a) => a.type === "image").length;
  const videos = p.assets.filter((a) => a.type === "video").length;

  if (!isPublishChannel(p.channel)) {
    errors.push("This channel isn't published through Postiz. Blogs go out through the website.");
    return { errors, warnings };
  }
  const limit = LIMITS[p.channel];

  if (!caption && p.channel !== "youtube") errors.push("Write a caption.");
  if (caption.length > limit.caption) errors.push(`Caption is ${caption.length} characters; ${limit.name} allows ${limit.caption}.`);

  const hashtags = caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.length ?? 0;
  if (p.channel === "instagram" && hashtags > 30) errors.push(`Instagram allows 30 hashtags; this caption has ${hashtags}.`);
  else if (hashtags > 10) warnings.push(`${hashtags} hashtags. Three to five usually perform better.`);

  switch (p.channel) {
    case "instagram":
      if (images + videos === 0) errors.push("Instagram posts need an image or a video.");
      if ((p.format === "reel" || p.format === "short") && videos !== 1) errors.push("A reel needs exactly one video.");
      if (p.format === "carousel" && (images + videos < 2 || images + videos > 10)) errors.push("A carousel needs 2 to 10 images or videos.");
      if (p.format === "image" && images !== 1) warnings.push("An image post usually has exactly one image.");
      break;
    case "youtube": {
      const title = (p.title ?? "").trim();
      if (videos !== 1) errors.push("YouTube needs exactly one video.");
      if (title.length < 2 || title.length > 100) errors.push("YouTube needs a title of 2 to 100 characters.");
      if (images > 1) warnings.push("Only one image is used, as the thumbnail.");
      break;
    }
    case "linkedin":
      if (videos > 1) errors.push("LinkedIn allows one video per post.");
      if (images > 9) errors.push("LinkedIn allows up to 9 images per post.");
      break;
    case "facebook":
      if (p.settings?.post_type === "story" && images + videos === 0) errors.push("A Facebook story needs an image or a video.");
      break;
  }

  for (const issue of lintAdCopy(`${p.title ?? ""}\n${caption}`)) {
    errors.push(`"${issue.match}": ${issue.why.toLowerCase()} aren't allowed.`);
  }
  for (const phrase of p.bannedPhrases ?? []) {
    const f = phrase.trim();
    if (f && caption.toLowerCase().includes(f.toLowerCase())) errors.push(`"${f}" is on the brand kit's banned list.`);
  }
  if (/\bhttps?:\/\//.test(caption) && p.channel === "instagram") warnings.push("Links in Instagram captions aren't clickable. Use the bio link.");
  return { errors, warnings };
}

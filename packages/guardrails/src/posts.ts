import { lintAdCopy, lintPositioning } from "./index";

/**
 * Rules a post must pass before it can be sent for approval, and again before it is
 * published. Errors block; warnings are shown to the approver.
 */
export type PublishChannel = "instagram" | "facebook" | "linkedin" | "youtube" | "gbp";
export const PUBLISH_CHANNELS: readonly PublishChannel[] = ["instagram", "facebook", "linkedin", "youtube", "gbp"];

export const isPublishChannel = (c: string): c is PublishChannel => (PUBLISH_CHANNELS as readonly string[]).includes(c);

export interface PostDraft {
  channel: string;
  format: string; // reel | short | long_video | image | carousel | post | blog
  caption: string | null;
  title: string | null;
  /** The three lines the post leads with. Copy like any other, so they are checked like it. */
  heading?: string | null;
  subhead?: string | null;
  cta?: string | null;
  assets: { type: "image" | "video" }[];
  settings?: Record<string, unknown>;
  bannedPhrases?: string[];
}

export interface PostCheck {
  errors: string[];
  warnings: string[];
}

/**
 * How long the three lead lines may be before they stop doing their job.
 *
 * No platform refuses a long heading; these are the lengths past which a heading is no longer
 * read in one glance, a subheading has become a paragraph, or a call to action no longer fits
 * on a button. They are warnings, never blocks — the team may know better for one post.
 */
export const LEAD_LIMITS = { heading: 120, subhead: 200, cta: 80 } as const;

const LIMITS: Record<PublishChannel, { caption: number; name: string }> = {
  instagram: { caption: 2200, name: "Instagram" },
  facebook: { caption: 63206, name: "Facebook" },
  linkedin: { caption: 3000, name: "LinkedIn" },
  youtube: { caption: 5000, name: "YouTube" },
  gbp: { caption: 1500, name: "Google Business Profile" },
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
    case "gbp": {
      // Business Profile updates (through Postiz's Google My Business channel) carry photos, not video.
      if (videos > 0) errors.push("Google Business Profile posts take photos, not video. Remove the video or post it on YouTube.");
      if (images === 0) warnings.push("Business Profile posts without a photo get far less attention. Add one.");
      if (images > 1) warnings.push("Business Profile shows one photo per update; the first is used.");
      const url = String(p.settings?.cta_url ?? "").trim();
      if (p.settings?.cta_type && p.settings.cta_type !== "NONE" && !/^https:\/\/\S+$/.test(url)) errors.push("The button needs a link starting with https://.");
      if (/(?:\+91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/.test(caption)) warnings.push("Google often rejects Business Profile posts with a phone number in the text. Use the button instead.");
      break;
    }
  }

  // The heading, subhead and call to action are shown to the same people as the caption, and a
  // creative can print them on the image, so every rule the caption answers to applies to them
  // too. Checking only the caption would leave the most prominent line on the post unchecked.
  const heading = (p.heading ?? "").trim();
  const subhead = (p.subhead ?? "").trim();
  const cta = (p.cta ?? "").trim();
  const allCopy = [p.title ?? "", heading, subhead, cta, caption].join("\n");

  if (heading.length > LEAD_LIMITS.heading) warnings.push(`The heading is ${heading.length} characters. Under ${LEAD_LIMITS.heading} is read in one glance.`);
  if (subhead.length > LEAD_LIMITS.subhead) warnings.push(`The subheading is ${subhead.length} characters. Under ${LEAD_LIMITS.subhead} still reads as one line.`);
  if (cta.length > LEAD_LIMITS.cta) warnings.push(`The call to action is ${cta.length} characters. Under ${LEAD_LIMITS.cta} fits on a button.`);
  if (heading && subhead && heading.toLowerCase() === subhead.toLowerCase()) {
    warnings.push("The heading and the subheading say the same thing; the subheading should earn the rest of the post.");
  }

  for (const issue of lintAdCopy(allCopy)) {
    errors.push(`"${issue.match}": ${issue.why.toLowerCase()} aren't allowed.`);
  }
  for (const issue of lintPositioning(allCopy)) {
    (issue.level === "error" ? errors : warnings).push(`"${issue.match}": ${issue.why.toLowerCase()}.`);
  }
  for (const phrase of p.bannedPhrases ?? []) {
    const f = phrase.trim();
    if (f && allCopy.toLowerCase().includes(f.toLowerCase())) errors.push(`"${f}" is on the brand kit's banned list.`);
  }
  if (/\bhttps?:\/\//.test(caption) && p.channel === "instagram") warnings.push("Links in Instagram captions aren't clickable. Use the bio link.");
  return { errors, warnings };
}

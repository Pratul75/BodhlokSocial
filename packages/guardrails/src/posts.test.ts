import { describe, expect, it } from "vitest";
import { checkPost } from "./posts";

const img = { type: "image" as const };
const vid = { type: "video" as const };

describe("checkPost", () => {
  it("passes a normal Instagram reel", () => {
    expect(checkPost({ channel: "instagram", format: "reel", caption: "Your first chart in 4 seconds. #astrology #kundli", title: null, assets: [vid] })).toEqual({ errors: [], warnings: [] });
  });

  it("requires media on Instagram and one video for reels", () => {
    expect(checkPost({ channel: "instagram", format: "reel", caption: "x", title: null, assets: [] }).errors).toEqual([
      "Instagram posts need an image or a video.",
      "A reel needs exactly one video.",
    ]);
  });

  it("limits carousels to 2–10 items", () => {
    expect(checkPost({ channel: "instagram", format: "carousel", caption: "x", title: null, assets: [img] }).errors).toContain("A carousel needs 2 to 10 images or videos.");
    expect(checkPost({ channel: "instagram", format: "carousel", caption: "x", title: null, assets: [img, img] }).errors).toEqual([]);
  });

  it("enforces caption length and the 30-hashtag cap", () => {
    expect(checkPost({ channel: "instagram", format: "image", caption: "a".repeat(2201), title: null, assets: [img] }).errors[0]).toMatch(/2201 characters/);
    const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ");
    expect(checkPost({ channel: "instagram", format: "image", caption: tags, title: null, assets: [img] }).errors).toContain("Instagram allows 30 hashtags; this caption has 31.");
  });

  it("requires a video and a title on YouTube, but not a caption", () => {
    expect(checkPost({ channel: "youtube", format: "short", caption: "", title: "", assets: [] }).errors).toEqual([
      "YouTube needs exactly one video.",
      "YouTube needs a title of 2 to 100 characters.",
    ]);
    expect(checkPost({ channel: "youtube", format: "short", caption: "", title: "Moon in Rohini", assets: [vid] }).errors).toEqual([]);
  });

  it("blocks ad-rule claims and brand banned phrases", () => {
    const r = checkPost({ channel: "facebook", format: "post", caption: "Guaranteed results. Best astrologer in India!", title: null, assets: [], bannedPhrases: ["best astrologer in india"] });
    expect(r.errors).toEqual(['"Guaranteed": guaranteed outcomes aren\'t allowed.', '"best astrologer in india" is on the brand kit\'s banned list.']);
  });

  it("refuses channels Postiz doesn't publish", () => {
    expect(checkPost({ channel: "seo", format: "blog", caption: "x", title: "t", assets: [] }).errors[0]).toMatch(/isn't published through Postiz/);
  });

  it("warns about links on Instagram and heavy hashtag use", () => {
    const r = checkPost({ channel: "instagram", format: "image", caption: `See https://asttrolok.com ${Array.from({ length: 12 }, (_, i) => `#t${i}`).join(" ")}`, title: null, assets: [img] });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(2);
  });
});

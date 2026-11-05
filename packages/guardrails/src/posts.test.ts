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

  it("checks Business Profile updates: photos only, 1,500 characters, a working button link", () => {
    const base = { channel: "gbp", format: "post", caption: "The Bodhlok desk is open to astrologers in Indore.", title: null, assets: [img] };
    expect(checkPost(base)).toEqual({ errors: [], warnings: [] });
    expect(checkPost({ ...base, assets: [vid] }).errors[0]).toMatch(/photos, not video/);
    expect(checkPost({ ...base, assets: [] }).warnings[0]).toMatch(/without a photo/);
    expect(checkPost({ ...base, caption: "x".repeat(1501) }).errors[0]).toMatch(/allows 1500/);
    expect(checkPost({ ...base, settings: { cta_type: "LEARN_MORE", cta_url: "" } }).errors[0]).toMatch(/needs a link/);
    expect(checkPost({ ...base, settings: { cta_type: "LEARN_MORE", cta_url: "https://www.bodhlok.com" } }).errors).toEqual([]);
    expect(checkPost({ ...base, caption: "Call 98260 12345 for a demo" }).warnings.join(" ")).toMatch(/phone number/);
    expect(checkPost({ ...base, caption: "Workshop on 2026-11-05" }).warnings).toEqual([]);
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

describe("positioning checks", () => {
  const base = { channel: "linkedin" as const, format: "post", title: null, assets: [], bannedPhrases: [] };
  it("blocks consumer address, AI-replaces claims and undisclaimed health claims", () => {
    const r = checkPost({ ...base, caption: "Get your free kundli and see what the stars say about your love life. Our AI astrologer predicts your future." });
    expect(r.errors).toEqual(expect.arrayContaining([expect.stringContaining("free kundli"), expect.stringContaining("AI astrologer")]));
    expect(r.errors.some((e) => /horoscope reader/.test(e))).toBe(true);
    expect(checkPost({ ...base, caption: "Muhurta for conception on the desk: Tarabala, Chandrabala and the running dasha." }).errors.some((e) => /not medical advice/i.test(e))).toBe(true);
    expect(checkPost({ ...base, caption: "Muhurta for conception on the desk. Astrological guidance only. Not medical advice." }).errors).toEqual([]);
  });
  it("lets practitioner copy through and only warns on tone", () => {
    const r = checkPost({ ...base, caption: "Open your client's D9 beside D1 and check the 7th lord's dignity before you time the muhurta. Try it on a sample chart in Bodhlok. Some call this cosmic energy; we call it Shadbala." });
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => /mystical tone/i.test(w))).toBe(true);
  });
});

describe("post rules not covered above", () => {
  const base = { channel: "linkedin" as const, format: "post" as const, caption: "How the desk reads a dasha, step by step, on a sample chart.", title: null, assets: [] as { type: "image" | "video" }[], bannedPhrases: [] as string[] };

  it("limits LinkedIn to one video and nine images", () => {
    expect(checkPost({ ...base, assets: [{ type: "video" }, { type: "video" }] }).errors.length).toBeGreaterThan(0);
    expect(checkPost({ ...base, assets: Array.from({ length: 10 }, () => ({ type: "image" as const })) }).errors.length).toBeGreaterThan(0);
    expect(checkPost({ ...base, assets: [{ type: "image" }] }).errors).toEqual([]);
  });

  it("needs a YouTube title of 100 characters or fewer", () => {
    const yt = { ...base, channel: "youtube" as const, format: "short" as const, assets: [{ type: "video" as const }] };
    expect(checkPost({ ...yt, title: "x".repeat(101) }).errors.join(" ")).toMatch(/title/i);
    expect(checkPost({ ...yt, title: "Reading a dasha on a sample chart" }).errors).toEqual([]);
  });
});

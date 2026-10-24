import { describe, expect, it } from "vitest";
import { attribute } from "./attribution";

describe("attribute", () => {
  it.each([
    [{ referralCode: "GURU-ALOK" , gclid: "x" }, "referral"],
    [{ gclid: "abc" }, "google_ads"],
    [{ wbraid: "abc" }, "google_ads"],
    [{ utmSource: "google", utmMedium: "cpc" }, "google_ads"],
    [{ utmSource: "youtube", utmMedium: "video" }, "google_ads"],
    [{ utmSource: "meta", utmMedium: "paid_social", fbclid: "f" }, "meta_ads"],
    [{ utmSource: "Instagram", utmMedium: "Paid_Social" }, "meta_ads"],
    [{ fbclid: "f", utmMedium: "paid" }, "meta_ads"],
    [{ fbclid: "f" }, "facebook"],
    [{ referrer: "https://l.instagram.com/" }, "instagram"],
    [{ utmSource: "instagram", utmMedium: "social" }, "instagram"],
    [{ referrer: "https://www.youtube.com/watch?v=1" }, "youtube"],
    [{ utmSource: "youtube", utmMedium: "social" }, "youtube"],
    [{ referrer: "https://www.linkedin.com/feed" }, "linkedin"],
    [{ utmMedium: "email", utmSource: "newsletter" }, "email"],
    [{ referrer: "wa.me" }, "whatsapp"],
    [{ referrer: "https://www.google.co.in/" }, "seo"],
    [{ referrer: "https://duckduckgo.com/" }, "seo"],
    [{ utmSource: "bing", utmMedium: "organic" }, "seo"],
    [{}, "direct"],
    [{ referrer: "https://some-blog.example/" }, "other"],
    [{ utmSource: "astro-forum", utmMedium: "referral" }, "referral"],
  ])("%j → %s", (touch, channel) => {
    expect(attribute(touch)).toBe(channel);
  });

  it("does not mistake a lookalike domain for a search engine", () => {
    expect(attribute({ referrer: "https://notgoogle.example.com/" })).toBe("other");
  });
});

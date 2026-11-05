import { describe, expect, it } from "vitest";
import { checkCommunityReply, checkListing } from "./community";

const helpful =
  "Drishti in Parashari works from the sign, so Mars aspects the 4th, 7th and 8th from itself. If a tool shows something different, check whether it is using Jaimini rashi drishti instead.";

describe("checkCommunityReply", () => {
  it("passes a helpful answer that doesn't name the product", () => {
    expect(checkCommunityReply(helpful, "reddit")).toEqual({ errors: [], warnings: [] });
  });

  it("requires a disclosure whenever Bodhlok is named", () => {
    const r = checkCommunityReply(`${helpful} Bodhlok shows both side by side.`, "reddit");
    expect(r.errors.join(" ")).toMatch(/Disclosure: I work on Bodhlok/);
    expect(checkCommunityReply(`${helpful} Disclosure: I work on Bodhlok, which shows both side by side.`, "reddit").errors).toEqual([]);
    expect(checkCommunityReply(`${helpful} (I'm on the Bodhlok team.) It shows both.`, "youtube").errors).toEqual([]);
  });

  it("refuses answers that pose as a customer", () => {
    const r = checkCommunityReply(`As a happy user, I can say Bodhlok is great. Disclosure: I work on Bodhlok. ${helpful}`, "reddit");
    expect(r.errors.join(" ")).toMatch(/testimonial/);
  });

  it("refuses guaranteed predictions and AI-replaces-the-astrologer claims", () => {
    expect(checkCommunityReply(`${helpful} This guarantees a marriage by next year.`, "quora").errors.length).toBeGreaterThan(0);
    expect(checkCommunityReply(`${helpful} An AI astrologer can read it for you.`, "reddit").errors.join(" ")).toMatch(/never replaces/);
  });

  it("only warns on 'your chart' when answering someone, and on salesy or link-heavy text", () => {
    const r = checkCommunityReply(`${helpful} In your birth chart, look at the 7th lord. DM me for a discount code. https://a.com https://b.com https://c.com`, "reddit");
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/horoscope reader/);
    expect(r.warnings.join(" ")).toMatch(/sales pitch/);
    expect(r.warnings.join(" ")).toMatch(/3 links/);
  });

  it("enforces length", () => {
    expect(checkCommunityReply("Try it.", "reddit").errors[0]).toMatch(/Too short/);
    expect(checkCommunityReply("a".repeat(10_001), "youtube").errors.join(" ")).toMatch(/limit/);
  });
});

describe("checkListing", () => {
  const ok = { title: "Bodhlok", tagline: "A Vedic astrology desk in the browser for practising astrologers", description: "Charts, dashas, transits and KP in one browser desk, with client notes and an AI consult that cites its rules. Free desk to start." };

  it("passes a plain, factual listing", () => {
    expect(checkListing(ok)).toEqual({ errors: [], warnings: [] });
  });

  it("refuses superlatives and guarantees", () => {
    expect(checkListing({ ...ok, tagline: "The #1 astrology software" }).errors.join(" ")).toMatch(/Superlatives/);
    expect(checkListing({ ...ok, description: `${ok.description} Guaranteed accurate predictions.` }).errors.length).toBeGreaterThan(0);
  });
});

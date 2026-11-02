import { describe, expect, it } from "vitest";
import { pageText } from "./tools";
import { replanTask } from "./prompts";

describe("pageText", () => {
  it("keeps the words and the structure of a page, drops scripts, styles and tags", () => {
    const html = `<html><head><title>Bodhlok</title><style>.x{color:red}</style><script>alert(1)</script></head>
      <body><nav><a href="/">Home</a></nav><h1>Professional Astrology. Reimagined.</h1>
      <p>For practising astrologers &amp; serious students.</p><!-- hidden -->
      <ul><li>D1 with Bhava Chalit</li><li>KP with 249 sub-lords</li></ul>
      <h2>How the AI works</h2><p>Calculation first,<br>rules second.</p></body></html>`;
    const text = pageText(html);
    expect(text).toContain("# Professional Astrology. Reimagined.");
    expect(text).toContain("For practising astrologers & serious students.");
    expect(text).toContain("D1 with Bhava Chalit\n");
    expect(text).toContain("## How the AI works");
    expect(text).not.toMatch(/alert|color:red|hidden|<[a-z]/);
  });

  it("cuts long pages and says so", () => {
    const text = pageText(`<p>${"word ".repeat(10_000)}</p>`, 500);
    expect(text.length).toBeLessThan(560);
    expect(text).toMatch(/\[cut at 500 characters\]$/);
  });
});

describe("replanTask", () => {
  it("names the month, the brief, the website and the replace rule", () => {
    const t = replanTask(new Date("2026-11-02T04:00:00Z"));
    expect(t).toContain("2026-11");
    expect(t).toContain("get_brand_kit");
    expect(t).toContain("read_website");
    expect(t).toContain("replace_remaining");
    expect(t).toMatch(/approved one steps aside/);
  });
});

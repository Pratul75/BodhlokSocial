import { describe, expect, it } from "vitest";
import { categoryFor, coverFor, faqMarkdown, postFields, trimTo, type PageForSite } from "./site-publisher";

const page: PageForSite = {
  slug: "bodhlok-vs-jhora",
  template: "compare",
  params: { competitor: "JHora" },
  title: "Bodhlok vs JHora: which desk for daily practice? | Bodhlok",
  keyword: "jhora alternative",
  description: "JHora is free and deep; Bodhlok is a professional desk with consult tools. Here is how the two compare for an astrologer who sees clients every day, feature by feature, with the trade-offs spelled out.",
  answer: "JHora remains the deepest free calculator. Bodhlok adds the consult layer: notes, client history, and timing tools on the same chart.",
  body: "## Calculations\n\nBoth agree on positions.\n\n## Consult tools\n\nBodhlok has them.",
  faq: [{ q: "Is JHora free?", a: "Yes, JHora is free software for Windows." }],
};

describe("categoryFor", () => {
  it("maps templates and modules to the site's categories", () => {
    expect(categoryFor({ template: "compare", params: {} })).toBe("Choosing software");
    expect(categoryFor({ template: "guide", params: { module: "KP" } })).toBe("KP astrology");
    expect(categoryFor({ template: "guide", params: { module: "Transits" } })).toBe("Ashtakavarga");
    expect(categoryFor({ template: "guide", params: { module: "Unknown" } })).toBe("Chart methods");
    expect(categoryFor({ template: "planet_house", params: {} })).toBe("Study guides");
    expect(coverFor("Choosing software")).toBe("/site/img/desk-consult-panel.webp");
    expect(coverFor("Chart methods")).toBe("/site/img/signature-zodiac-study.jpg");
  });
});

describe("trimTo", () => {
  it("cuts at a word within the limit and drops trailing punctuation", () => {
    const out = trimTo("one two three, four five six seven eight nine ten", 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out).toBe("one two three, four");
    expect(trimTo("  short   text ", 155)).toBe("short text");
  });
});

describe("postFields", () => {
  const fields = postFields(page, "Choosing software");

  it("builds the CMS document: article block, SEO within the CMS's limits, FAQ as headings and schema", () => {
    expect(fields.title).toBe("Bodhlok vs JHora: which desk for daily practice?");
    expect(fields.excerpt).toBe(page.answer);
    const seo = fields.seo as Record<string, unknown>;
    expect(String(seo.description).length).toBeLessThanOrEqual(155);
    expect(String(seo.description)).toMatch(/^JHora is free and deep/);
    expect(seo.schema_type).toBe("Article");
    expect(seo.focus_keyword).toBe("jhora alternative");
    expect(seo.og_image).toBe("https://bodhlok.com/site/img/desk-consult-panel.webp");
    expect((seo.extra_jsonld as { "@type": string }[])[0]!["@type"]).toBe("FAQPage");

    const main = fields.content.regions.main as { type: string; body: { content: { type: string; attrs?: Record<string, unknown> }[] }; cover: { src: string; alt: string }; try_link: { href: string } }[];
    expect(main).toHaveLength(1);
    expect(main[0]!.type).toBe("blog_article");
    expect(main[0]!.cover).toEqual({ src: "/site/img/desk-consult-panel.webp", alt: "Bodhlok astrology software chart preview" });
    expect(main[0]!.try_link.href).toBe("/login");
    const headings = main[0]!.body.content.filter((n) => n.type === "heading");
    expect(headings.map((h) => h.attrs!.id)).toEqual(["calculations", "consult-tools", "frequently-asked-questions", "is-jhora-free"]);
    expect(headings.map((h) => h.attrs!.level)).toEqual([2, 2, 2, 3]);
  });

  it("falls back to the answer for the description and leaves the FAQ out when empty", () => {
    const f = postFields({ ...page, description: null, faq: [], keyword: null }, "Chart methods");
    expect((f.seo as Record<string, unknown>).description).toBe(trimTo(page.answer!, 155));
    expect(f.seo).not.toHaveProperty("extra_jsonld");
    expect(f.seo).not.toHaveProperty("focus_keyword");
    expect(faqMarkdown([])).toBe("");
  });
});

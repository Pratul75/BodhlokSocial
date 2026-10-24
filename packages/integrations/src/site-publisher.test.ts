import { describe, expect, it } from "vitest";
import { addToIndex, categoryFor, postsOnIndex, removeFromIndex, renderBody, renderPost, slugsIn, withSlugs } from "./site-publisher";

// Shaped like the site's files on the bodhlok branch, trimmed.
const TEMPLATE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="../bodhlok/site.css">
<title>KP Astrology: How 249 Sub-Lords Are Computed | Bodhlok</title>
<meta name="description" content="old">
<link rel="canonical" href="https://bodhlok.com/blog/kp-astrology-249-sub-lords">
<script type="application/ld+json">{"old":true}</script>
<link rel="stylesheet" href="../bodhlok/enquiry.css"></head><body class="page-blog"><header>HEADER</header>
<main id="main"><section class="blog-detail-hero">OLD</section></main><footer class="site-foot">FOOTER</footer></body></html>`;

const INDEX = `<main id="main"><section class="blog-categories wrap"><button class="blog-category-tile" data-group="systems"><span class="category-count">3 articles</span><span><b>Chart systems</b></span></button><button class="blog-category-tile" data-group="timing"><span class="category-count">1 article</span></button><button class="blog-category-tile" data-category="Consult"><span class="category-count">1 article</span></button></section><section class="blog-content wrap"><aside class="blog-sidebar"><div class="blog-side-panel"><h3>Categories</h3><button class="category-filter active" data-category="all" aria-pressed="true">All articles <span>5</span></button><button class="category-filter" data-category="KP astrology" aria-pressed="false">KP astrology<span>1</span></button><button class="category-filter" data-category="Muhurta" aria-pressed="false">Muhurta<span>1</span></button></div><div class="blog-side-panel"><h3>Recent articles</h3><a class="recent-post" href="/blog/a"><img src="../img/a.jpg" alt="" width="64" height="64"><span><b>A</b><small>14 Oct 2026</small></span></a><a class="recent-post" href="/blog/b"><img src="../img/b.jpg" alt="" width="64" height="64"><span><b>B</b><small>13 Oct 2026</small></span></a><a class="recent-post" href="/blog/c"><img src="../img/c.jpg" alt="" width="64" height="64"><span><b>C</b><small>12 Oct 2026</small></span></a></div></aside><div><div class="blog-posts"><article class="blog-post-card" data-post-category="KP astrology" data-title="A"><a class="blog-post-cover" href="/blog/a"><img src="../img/a.jpg" alt="" loading="lazy" width="600" height="380"><span class="pill">KP astrology</span></a><div class="blog-post-body"><h2><a href="/blog/a">A</a></h2><p>About A.</p></div></article></div><p id="blog-empty" hidden>None</p></div></section></main>`;

const PY = `_PAGES = {"/blog": "blog/index.html"}

#: The published blog posts.
_BLOG_SLUGS = frozenset({
    "a",
    "kp-astrology-249-sub-lords",
})


def _render(rel: str):
    pass`;

const page = {
  slug: "bodhlok-vs-jagannatha-hora",
  template: "compare",
  params: { angle: "x" },
  title: "Bodhlok vs Jagannatha Hora: browser desk or Windows classic",
  description: "JHora is free and Windows-only; Bodhlok runs in the browser with client notes.",
  answer: "Jagannatha Hora is free Windows software with a very wide calculation range. Bodhlok is a browser desk.",
  body: "## What JHora does well\n\nIt is **free** and deep.\n\n- Jaimini depth\n- Configurability\n\n## Where Bodhlok differs\n\nRuns in a browser. <script>alert(1)</script>",
  faq: [{ q: "Is JHora free?", a: "Yes, for Windows." }],
};

describe("site publisher rendering", () => {
  it("renders Markdown with numbered sections and no raw HTML", () => {
    const r = renderBody(page.body);
    expect(r.sections).toEqual([{ id: "section-1", title: "What JHora does well" }, { id: "section-2", title: "Where Bodhlok differs" }]);
    expect(r.html).toContain('<h2 id="section-1">What JHora does well</h2>');
    expect(r.html).toContain("<strong>free</strong>");
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
  });

  it("fills the site's template: header and footer untouched, head and main replaced", () => {
    const html = renderPost(TEMPLATE, page, { category: "Choosing software", date: "2026-10-25", related: [{ href: "/blog/a", title: "A", category: "KP astrology", img: "../img/a.jpg" }] });
    expect(html).toContain("<header>HEADER</header>");
    expect(html).toContain('<footer class="site-foot">FOOTER</footer>');
    expect(html).toContain("<title>Bodhlok vs Jagannatha Hora: browser desk or Windows classic | Bodhlok</title>");
    expect(html).toContain('<link rel="canonical" href="https://bodhlok.com/blog/bodhlok-vs-jagannatha-hora">');
    expect(html).not.toContain("kp-astrology-249-sub-lords");
    expect(html).not.toContain('{"old":true}');
    expect(html).toContain('<h1>Bodhlok vs Jagannatha Hora: browser desk or Windows classic</h1>');
    expect(html).toContain("<small>Published on</small><b>25 Oct 2026</b>");
    expect(html).toContain('<p class="lede">Jagannatha Hora is free Windows software');
    expect(html).toContain('<h2 id="faq">Frequently asked questions</h2>');
    expect(html).toContain('<a href="#section-2">Where Bodhlok differs</a><a href="#faq">');
    expect(html).toContain("Keep reading");
    expect(html).toContain('<link rel="stylesheet" href="../bodhlok/enquiry.css"></head>');
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1]!) as { "@graph": { "@type": string }[] };
    expect(ld["@graph"].map((g) => g["@type"])).toEqual(["Organization", "WebSite", "WebPage", "BreadcrumbList", "Article", "FAQPage"]);
  });

  it("maps templates and modules to the site's categories", () => {
    expect(categoryFor({ template: "compare", params: {} })).toBe("Choosing software");
    expect(categoryFor({ template: "guide", params: { module: "KP" } })).toBe("KP astrology");
    expect(categoryFor({ template: "guide", params: { module: "Prashna" } })).toBe("Chart methods");
    expect(categoryFor({ template: "nakshatra", params: {} })).toBe("Study guides");
  });
});

describe("blog index and slug list", () => {
  it("adds a card, counts, a new category button and a recent post, keeping three", () => {
    const out = addToIndex(INDEX, { slug: "bodhlok-vs-jagannatha-hora", title: "Bodhlok vs JHora", excerpt: "Short.", category: "Choosing software", date: "2026-10-25" });
    expect(out).toContain('<div class="blog-posts"><article class="blog-post-card" data-post-category="Choosing software"');
    expect(out).toContain("All articles <span>6</span>");
    expect(out).toContain('data-category="Choosing software" aria-pressed="false">Choosing software<span>1</span>');
    expect((out.match(/class="recent-post"/g) ?? []).length).toBe(3);
    expect(out).toContain('<h3>Recent articles</h3><a class="recent-post" href="/blog/bodhlok-vs-jagannatha-hora">');
    expect(out).not.toContain('href="/blog/c"');
    expect(out).toContain('data-group="systems"><span class="category-count">3 articles</span>'); // unchanged, not in a tile
  });

  it("bumps an existing category and its tile, and removes cleanly", () => {
    const out = addToIndex(INDEX, { slug: "muhurta-workflow", title: "Muhurta", excerpt: "x", category: "Muhurta", date: "2026-10-25" });
    expect(out).toContain('data-category="Muhurta" aria-pressed="false">Muhurta<span>2</span>');
    expect(out).toContain('data-group="timing"><span class="category-count">2 articles</span>');
    const back = removeFromIndex(out, "muhurta-workflow");
    expect(back).toContain("All articles <span>5</span>");
    expect(back).toContain('data-category="Muhurta" aria-pressed="false">Muhurta<span>1</span>');
    expect(back).toContain('data-group="timing"><span class="category-count">1 article</span>');
    expect(back).not.toContain("muhurta-workflow");
    expect(addToIndex(out, { slug: "muhurta-workflow", title: "Muhurta", excerpt: "x", category: "Muhurta", date: "2026-10-25" })).toBe(out);
  });

  it("lists existing posts for Keep reading", () => {
    expect(postsOnIndex(INDEX)).toEqual([{ category: "KP astrology", title: "A", href: "/blog/a", img: "../img/a.jpg" }]);
  });

  it("edits the slug allow-list in place, sorted", () => {
    expect(slugsIn(PY)).toEqual(["a", "kp-astrology-249-sub-lords"]);
    const out = withSlugs(PY, [...slugsIn(PY), "bodhlok-vs-jagannatha-hora"]);
    expect(out).toContain('_BLOG_SLUGS = frozenset({\n    "a",\n    "bodhlok-vs-jagannatha-hora",\n    "kp-astrology-249-sub-lords",\n})');
    expect(out).toContain("def _render(rel: str):");
    expect(slugsIn(withSlugs(out, ["a"]))).toEqual(["a"]);
  });
});

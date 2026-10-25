import { describe, expect, it, vi } from "vitest";
import { allows, BodhlokCms, CmsError, markdownToRichText, plain, slugifyId } from "./bodhlok-cms";

type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[]; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] };

// What backend/app/cms/richtext.py accepts.
const NODE_ATTRS: Record<string, string[]> = {
  doc: [], paragraph: ["textAlign"], heading: ["level", "id", "textAlign"], bulletList: [], orderedList: ["start"], listItem: [], blockquote: [],
  codeBlock: ["language"], horizontalRule: [], hardBreak: [], text: [], image: ["src", "alt", "title", "width", "height", "mediaId"],
  table: [], tableRow: [], tableCell: ["colspan", "rowspan", "colwidth"], tableHeader: ["colspan", "rowspan", "colwidth"], callout: ["tone"], embed: ["src", "title"],
};
const MARKS = ["bold", "italic", "link", "code", "underline", "strike", "textStyle", "highlight"];

function check(node: Node, path = "doc") {
  expect(NODE_ATTRS, `${path}: unknown node ${node.type}`).toHaveProperty(node.type);
  for (const k of Object.keys(node.attrs ?? {})) expect(NODE_ATTRS[node.type], `${path}: ${node.type}.${k}`).toContain(k);
  if (node.type === "heading") {
    expect([2, 3, 4]).toContain(node.attrs?.level);
    expect(String(node.attrs?.id)).toMatch(/^[a-z][a-z0-9-]{0,79}$/);
  }
  if (node.type === "text") {
    expect(typeof node.text).toBe("string");
    for (const m of node.marks ?? []) expect(MARKS).toContain(m.type);
  }
  node.content?.forEach((c, i) => check(c, `${path}.${node.type}[${i}]`));
}

describe("markdownToRichText", () => {
  it("produces only nodes, attributes and marks the CMS accepts", () => {
    const md = `# Top heading\n\nSome *em* and **strong** with \`code\`, a [link](https://bodhlok.com/product), a [bad link](javascript:alert(1)) and ![img](x.png) plus \\* escaped.\n\n- one\n- two\n  - nested\n\n3. third\n4. fourth\n\n> quoted\n\n| Planet | House |\n|---|---|\n| Sun | 1 |\n\n\`\`\`py\nprint(1)\n\`\`\`\n\n---\n\nLine one  \nLine two <b>bold html</b>\n\n##### Deep heading`;
    const doc = markdownToRichText(md) as Node;
    check(doc);
    const types = doc.content!.map((n) => n.type);
    expect(types).toEqual(["heading", "paragraph", "bulletList", "orderedList", "blockquote", "table", "codeBlock", "horizontalRule", "paragraph", "heading"]);
    expect(doc.content![0]!.attrs).toEqual({ level: 2, id: "top-heading" });
    expect(doc.content![9]!.attrs).toEqual({ level: 4, id: "deep-heading" });
    expect(doc.content![3]!.attrs).toEqual({ start: 3 });
    const para = doc.content![1]!;
    expect(para.content!.find((n) => n.text === "strong")!.marks).toEqual([{ type: "bold" }]);
    expect(para.content!.find((n) => n.text === "link")!.marks).toEqual([{ type: "link", attrs: { href: "https://bodhlok.com/product" } }]);
    expect(para.content!.find((n) => n.text === "bad link")!.marks).toBeUndefined();
    expect(plain(para.content!)).toContain("img plus * escaped.");
    const nested = doc.content![2]!.content![1]!;
    expect(nested.content!.map((n) => n.type)).toEqual(["paragraph", "bulletList"]);
    expect(doc.content![8]!.content!.some((n) => n.type === "hardBreak")).toBe(true);
    expect(plain(doc.content![8]!.content!)).toBe("Line one Line two bold html");
  });

  it("keeps heading ids unique and away from reserved ones", () => {
    const doc = markdownToRichText("## Steps\n\n## Steps\n\n## FAQ", { reservedIds: ["faq"] }) as Node;
    expect(doc.content!.map((n) => n.attrs!.id)).toEqual(["steps", "steps-2", "faq-2"]);
  });

  it("never returns an empty document", () => {
    expect((markdownToRichText("") as Node).content).toEqual([{ type: "paragraph", content: [] }]);
  });

  it("makes ids that start with a letter", () => {
    expect(slugifyId("249 sub-lords")).toBe("s-249-sub-lords");
    expect(slugifyId("Dasha: timing")).toBe("dasha-timing");
  });
});

describe("allows", () => {
  it("ranks levels like permissions.py", () => {
    expect(allows({ blog: "publish" }, "blog:publish")).toBe(true);
    expect(allows({ blog: "edit" }, "blog:publish")).toBe(false);
    expect(allows({ blog: "publish" }, "blog:view")).toBe(true);
    expect(allows({}, "blog:view")).toBe(false);
    expect(allows(undefined, "blog:view")).toBe(false);
  });
});

function fakeFetch(handlers: Record<string, (init: RequestInit, n: number) => Response | Promise<Response>>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const key = Object.keys(handlers).find((k) => url.endsWith(k));
    if (!key) return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404 });
    return handlers[key]!(init ?? {}, calls.filter((c) => c.url.endsWith(key)).length);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("BodhlokCms", () => {
  it("signs in with a form post, sends the bearer token, and signs in again after a 401", async () => {
    let token = "t1";
    const { fetchImpl, calls } = fakeFetch({
      "/api/cms/token": () => json({ access_token: token, token_type: "bearer" }),
      "/api/cms/me": (init, n) => {
        const auth = (init.headers as Record<string, string>).authorization;
        if (n === 2 && auth === "Bearer t1") {
          token = "t2";
          return json({ detail: "Could not validate credentials" }, 401);
        }
        return json({ user: { id: 1, email: "growth@bodhlok.com" }, site: { key: "bodhlok", name: "Bodhlok" }, features: { blog: "publish" }, is_platform_admin: false });
      },
    });
    const cms = new BodhlokCms({ email: "Growth@bodhlok.com ", password: "pw", site_url: "https://bodhlok.com/" }, fetchImpl);
    await cms.me();
    expect(calls[0]!.url).toBe("https://bodhlok.com/api/cms/token");
    expect(String(calls[0]!.init.body)).toBe("username=growth%40bodhlok.com&password=pw");
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe("Bearer t1");
    await cms.me(); // the token was revoked: 401, sign in again, retry once
    expect(calls.map((c) => c.url.split("/api/cms")[1])).toEqual(["/token", "/me", "/me", "/token", "/me"]);
    expect((calls[4]!.init.headers as Record<string, string>).authorization).toBe("Bearer t2");
  });

  it("surfaces the CMS's own error list", async () => {
    const { fetchImpl } = fakeFetch({
      "/api/cms/token": () => json({ access_token: "t" }),
      "/documents/7/publish": () => json({ detail: { message: "the document cannot be published", errors: ["SEO title is required", "no Open Graph image resolves"] } }, 422),
    });
    const cms = new BodhlokCms({ email: "a@b.c", password: "x" }, fetchImpl);
    const err = await cms.action(7, "publish").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CmsError);
    expect((err as CmsError).status).toBe(422);
    expect((err as CmsError).detail).toBe("the document cannot be published: SEO title is required; no Open Graph image resolves");
  });

  it("explains a missing automation sign-in", async () => {
    const { fetchImpl } = fakeFetch({});
    const cms = new BodhlokCms({ email: "a@b.c", password: "x" }, fetchImpl);
    await expect(cms.me()).rejects.toThrow(/no CMS sign-in for automation/);
  });

  it("finds a post by its slug among search results", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "/api/cms/token": () => json({ access_token: "t" }),
      "/api/cms/documents?kind=post&q=kp-astrology&per_page=50": () => json({ items: [{ id: 1, slug: "blog/kp-astrology-249-sub-lords" }, { id: 2, slug: "blog/kp-astrology" }] }),
    });
    const cms = new BodhlokCms({ email: "a@b.c", password: "x" }, fetchImpl);
    expect((await cms.findPost("kp-astrology"))?.id).toBe(2);
    expect(await cms.findPost("kp-astrology").then(() => calls.length)).toBe(3);
  });
});

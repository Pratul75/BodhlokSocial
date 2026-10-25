/**
 * Bodhlok's own CMS: the FastAPI backend behind bodhlok.com, `/api/cms/*`. Growth OS signs in
 * with a Bodhlok account that holds blog publishing on the site and writes posts as documents:
 * create (or save a new draft), then publish. The CMS renders the page in the site's template,
 * runs its own SEO checks and serves it at /blog/<slug>.
 *
 * Sign-in is `POST /api/cms/token`, the automation sign-in (the ordinary login needs a browser
 * reCAPTCHA). Access tokens last 30 minutes; the client signs in again when one expires.
 * The rich-text format is the CMS's constrained ProseMirror JSON (backend/app/cms/richtext.py):
 * `markdownToRichText` turns the agents' Markdown into it.
 */
import { marked, type Token, type Tokens } from "marked";

export interface CmsCredentials {
  email: string;
  password: string;
  site_url?: string;
}

export class CmsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: string[] = [],
  ) {
    super(message);
    this.name = "CmsError";
  }
  /** The message with the CMS's own list of problems, for a status note. */
  get detail(): string {
    return this.errors.length ? `${this.message}: ${this.errors.join("; ")}` : this.message;
  }
}

export interface CmsDocument {
  id: number;
  kind: string;
  slug: string;
  path: string;
  status: string;
  live: boolean;
  title: string;
  published_at: string | null;
  draft_revision_id: number | null;
  published_revision_id: number | null;
}

export interface CmsMe {
  user: { id: number; email: string; full_name: string | null };
  site: { key: string; name: string };
  features: Record<string, string>;
  is_platform_admin: boolean;
}

export interface CmsTaxonomy {
  id: number;
  slug: string;
  name: string;
}

export interface CmsAuthor {
  id: number;
  slug: string;
  display_name: string;
  is_organization: boolean;
}

/** The fields a post shares between create and save-draft. */
export interface PostFields {
  title: string;
  content: { regions: Record<string, unknown[]>; meta: Record<string, unknown> };
  seo: Record<string, unknown>;
  excerpt?: string | null;
  primary_category_id?: number;
  author_id?: number;
}

const LEVEL_RANK: Record<string, number> = { view: 1, edit: 2, publish: 3, manage: 3 };

/** Whether a member's feature map allows "blog:publish" and the like (permissions.py `allows`). */
export function allows(features: Record<string, string> | undefined, spec: string): boolean {
  const [feature, level] = spec.split(":");
  const held = features?.[feature!];
  return !!held && (LEVEL_RANK[held] ?? 0) >= (LEVEL_RANK[level!] ?? 99);
}

async function readError(res: Response): Promise<{ message: string; errors: string[] }> {
  const text = await res.text();
  try {
    const json = JSON.parse(text) as { detail?: unknown };
    const d = json.detail ?? json;
    if (typeof d === "string") return { message: d, errors: [] };
    if (Array.isArray(d)) return { message: d.map((x) => (x && typeof x === "object" && "msg" in x ? String((x as { msg: unknown }).msg) : JSON.stringify(x))).join("; "), errors: [] };
    if (d && typeof d === "object") {
      const o = d as { message?: unknown; msg?: unknown; errors?: unknown };
      return { message: String(o.message ?? o.msg ?? text.slice(0, 300)), errors: Array.isArray(o.errors) ? o.errors.map(String) : [] };
    }
  } catch {
    /* not JSON */
  }
  return { message: text.slice(0, 300) || `HTTP ${res.status}`, errors: [] };
}

export class BodhlokCms {
  private token: string | null = null;
  private tokenAt = 0;

  constructor(
    private readonly creds: CmsCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** The site's origin, no trailing slash. */
  get site(): string {
    return (this.creds.site_url?.trim() || "https://bodhlok.com").replace(/\/$/, "");
  }

  async signIn(): Promise<void> {
    const body = new URLSearchParams({ username: this.creds.email.trim().toLowerCase(), password: this.creds.password });
    const res = await this.fetchImpl(`${this.site}/api/cms/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const { message } = await readError(res);
      throw new CmsError(res.status === 404 ? "The site has no CMS sign-in for automation yet (POST /api/cms/token answered 404)." : `The CMS refused the sign-in: ${message}`, res.status);
    }
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) throw new CmsError("The CMS sign-in returned no token.", 502);
    this.token = json.access_token;
    this.tokenAt = Date.now();
  }

  private async request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
    if (!this.token || Date.now() - this.tokenAt > 25 * 60_000) await this.signIn();
    const res = await this.fetchImpl(`${this.site}/api/cms${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 401 && retry) {
      this.token = null;
      return this.request<T>(method, path, body, false);
    }
    if (!res.ok) {
      const { message, errors } = await readError(res);
      throw new CmsError(message, res.status, errors);
    }
    return (await res.json()) as T;
  }

  me(): Promise<CmsMe> {
    return this.request("GET", "/me");
  }

  async categories(): Promise<CmsTaxonomy[]> {
    return (await this.request<{ items: CmsTaxonomy[] }>("GET", "/categories")).items;
  }

  createCategory(name: string): Promise<CmsTaxonomy> {
    return this.request("POST", "/categories", { name });
  }

  async authors(): Promise<CmsAuthor[]> {
    return (await this.request<{ items: CmsAuthor[] }>("GET", "/authors")).items;
  }

  createAuthor(display_name: string, is_organization = true): Promise<CmsAuthor> {
    return this.request("POST", "/authors", { display_name, is_organization });
  }

  /** The post with this slug, if the site has one (any status). */
  async findPost(slug: string): Promise<CmsDocument | null> {
    const { items } = await this.request<{ items: CmsDocument[] }>("GET", `/documents?kind=post&q=${encodeURIComponent(slug)}&per_page=50`);
    return items.find((d) => d.slug === `blog/${slug}`) ?? null;
  }

  getDocument(id: number): Promise<CmsDocument> {
    return this.request("GET", `/documents/${id}`);
  }

  createPost(slug: string, fields: PostFields): Promise<CmsDocument> {
    return this.request("POST", "/documents", { kind: "post", slug, template: "post", ...fields });
  }

  saveDraft(id: number, fields: PostFields & { change_note?: string }): Promise<CmsDocument> {
    return this.request("PUT", `/documents/${id}/draft`, fields);
  }

  /** submit | approve | publish | unpublish | archive … */
  action(id: number, action: string, body?: Record<string, unknown>): Promise<CmsDocument> {
    return this.request("POST", `/documents/${id}/${action}`, body ?? {});
  }
}

/* ---------- Markdown → the CMS's rich text ---------- */

type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[]; text?: string; marks?: Mark[] };
type Mark = { type: string; attrs?: Record<string, unknown> };

const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;

export interface RichTextOptions {
  /** Heading ids must be unique on the page; pass ids already used (e.g. "faq"). */
  reservedIds?: string[];
}

export function slugifyId(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return /^[a-z]/.test(s) ? s : `s-${s}`.replace(/-$/, "");
}

/** The agents' Markdown as the CMS's ProseMirror document. Headings become H2–H4 (H1 is the title). */
export function markdownToRichText(markdown: string, opts: RichTextOptions = {}): Node {
  const used = new Set(opts.reservedIds ?? []);
  const tokens = marked.lexer(markdown ?? "", { gfm: true });
  const content = blocks(tokens, used);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph", content: [] }] };
}

function blocks(tokens: Token[], used: Set<string>): Node[] {
  const out: Node[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "heading": {
        const level = Math.min(4, Math.max(2, (t as Tokens.Heading).depth));
        const inline = inlines((t as Tokens.Heading).tokens ?? []);
        let id = slugifyId(plain(inline)) || "section";
        for (let n = 2; used.has(id); n++) id = `${slugifyId(plain(inline)) || "section"}-${n}`;
        used.add(id);
        out.push({ type: "heading", attrs: { level, id }, content: inline });
        break;
      }
      case "paragraph": {
        const inline = inlines((t as Tokens.Paragraph).tokens ?? []);
        if (inline.length) out.push({ type: "paragraph", content: inline });
        break;
      }
      case "text": {
        // A list item's text: inline tokens when marked parsed them, else the raw text.
        const tt = t as Tokens.Text;
        const inline = tt.tokens ? inlines(tt.tokens) : textNodes(tt.text, []);
        if (inline.length) out.push({ type: "paragraph", content: inline });
        break;
      }
      case "list": {
        const list = t as Tokens.List;
        const items = list.items.map((item) => {
          const inner = blocks(item.tokens, used);
          return { type: "listItem", content: inner.length ? inner : [{ type: "paragraph", content: [] }] };
        });
        if (list.ordered) {
          const start = Number(list.start);
          out.push({ type: "orderedList", ...(start && start !== 1 ? { attrs: { start } } : {}), content: items });
        } else {
          out.push({ type: "bulletList", content: items });
        }
        break;
      }
      case "blockquote": {
        const inner = blocks((t as Tokens.Blockquote).tokens, used);
        if (inner.length) out.push({ type: "blockquote", content: inner });
        break;
      }
      case "code": {
        const c = t as Tokens.Code;
        out.push({ type: "codeBlock", ...(c.lang ? { attrs: { language: c.lang } } : {}), content: c.text ? [{ type: "text", text: c.text }] : [] });
        break;
      }
      case "hr":
        out.push({ type: "horizontalRule" });
        break;
      case "table": {
        const tb = t as Tokens.Table;
        const cell = (kind: "tableHeader" | "tableCell", c: Tokens.TableCell): Node => ({ type: kind, content: [{ type: "paragraph", content: inlines(c.tokens) }] });
        const rows: Node[] = [{ type: "tableRow", content: tb.header.map((c) => cell("tableHeader", c)) }];
        for (const r of tb.rows) rows.push({ type: "tableRow", content: r.map((c) => cell("tableCell", c)) });
        out.push({ type: "table", content: rows });
        break;
      }
      case "html": {
        const text = (t as Tokens.HTML).text.replace(/<[^>]*>/g, "").trim();
        if (text) out.push({ type: "paragraph", content: [{ type: "text", text }] });
        break;
      }
      case "space":
        break;
      default: {
        const raw = "text" in t && typeof t.text === "string" ? t.text.trim() : "";
        if (raw) out.push({ type: "paragraph", content: [{ type: "text", text: raw }] });
      }
    }
  }
  return out;
}

function inlines(tokens: Token[], marks: Mark[] = []): Node[] {
  const out: Node[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "text":
      case "escape":
        out.push(...textNodes((t as Tokens.Text).text, marks));
        break;
      case "strong":
        out.push(...inlines((t as Tokens.Strong).tokens, withMark(marks, { type: "bold" })));
        break;
      case "em":
        out.push(...inlines((t as Tokens.Em).tokens, withMark(marks, { type: "italic" })));
        break;
      case "del":
        out.push(...inlines((t as Tokens.Del).tokens, withMark(marks, { type: "strike" })));
        break;
      case "codespan":
        out.push(...textNodes((t as Tokens.Codespan).text, withMark(marks, { type: "code" })));
        break;
      case "link": {
        const l = t as Tokens.Link;
        const href = l.href.trim();
        out.push(...inlines(l.tokens, SAFE_HREF.test(href) ? withMark(marks, { type: "link", attrs: { href } }) : marks));
        break;
      }
      case "image":
        out.push(...textNodes((t as Tokens.Image).text, marks));
        break;
      case "br":
        out.push({ type: "hardBreak" });
        break;
      case "html":
        out.push(...textNodes((t as Tokens.HTML).text.replace(/<[^>]*>/g, ""), marks));
        break;
      default:
        if ("tokens" in t && Array.isArray(t.tokens)) out.push(...inlines(t.tokens, marks));
        else if ("text" in t && typeof t.text === "string") out.push(...textNodes(t.text, marks));
    }
  }
  return out;
}

function textNodes(text: string, marks: Mark[]): Node[] {
  const clean = text.replace(/\r/g, "");
  if (!clean) return [];
  // A line break inside a paragraph is a soft break: a space.
  const parts = clean.split("\n");
  const nodes: Node[] = [];
  parts.forEach((p, i) => {
    const s = i === 0 ? p : ` ${p}`;
    if (s) nodes.push({ type: "text", text: s, ...(marks.length ? { marks } : {}) });
  });
  return nodes;
}

const withMark = (marks: Mark[], mark: Mark): Mark[] => (marks.some((m) => m.type === mark.type) ? marks : [...marks, mark]);

/** The text of inline nodes, for heading ids and lengths. */
export function plain(nodes: Node[]): string {
  return nodes.map((n) => (n.type === "text" ? n.text ?? "" : n.type === "hardBreak" ? " " : plain(n.content ?? []))).join("");
}

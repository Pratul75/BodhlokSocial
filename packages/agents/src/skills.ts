import { readdir, readFile, stat } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import { BUNDLED_SKILLS } from "./skills.generated";

export interface Skill {
  name: string;
  description: string;
  body: string;
  /** Folder holding the skill's other markdown files, for installed skills. */
  dir?: string;
}

/** A front-matter value, including folded (>) or indented continuation lines. */
function frontValue(front: string, key: string): string {
  const lines = front.split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (i < 0) return "";
  const parts = [lines[i]!.slice(key.length + 1).trim().replace(/^[>|][-+]?$/, "")];
  for (const l of lines.slice(i + 1)) {
    if (!/^\s+\S/.test(l)) break;
    parts.push(l.trim());
  }
  return parts.join(" ").trim().replace(/^["']|["']$/g, "");
}

function parse(name: string, text: string, dir?: string): Skill {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const front = m?.[1] ?? "";
  return {
    name: front.match(/^name:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim() ?? name,
    description: frontValue(front, "description"),
    body: (m?.[2] ?? text).trim(),
    dir,
  };
}

/** BODH's own skills: always in the system prompt. */
export function bundledSkills(): Skill[] {
  return BUNDLED_SKILLS.map((s) => parse(s.name, s.text));
}

let installedCache: { dir: string; skills: Skill[] } | null = null;

/**
 * Skills installed on the server in SKILLS_DIR: a folder per skill holding SKILL.md (and
 * its reference files), or a plain *.md file. Agents see the name and description and read
 * the rest with the read_skill tool. One named like a bundled skill is ignored.
 */
export async function installedSkills(): Promise<Skill[]> {
  const dir = process.env.SKILLS_DIR;
  if (!dir) return [];
  if (installedCache?.dir === dir) return installedCache.skills;
  const bundled = new Set(BUNDLED_SKILLS.map((s) => s.name));
  const out: Skill[] = [];
  for (const entry of (await readdir(dir).catch(() => [] as string[])).sort()) {
    const path = join(dir, entry);
    const isDir = (await stat(path).catch(() => null))?.isDirectory();
    const file = isDir ? join(path, "SKILL.md") : entry.endsWith(".md") ? path : null;
    if (!file) continue;
    const text = await readFile(file, "utf8").catch(() => null);
    if (!text) continue;
    const s = parse(entry.replace(/\.md$/, ""), text, isDir ? path : undefined);
    if (!bundled.has(s.name)) out.push(s);
  }
  installedCache = { dir, skills: out };
  return out;
}

export function skillsPrompt(bundled: Skill[], installed: Skill[] = []): string {
  const inline = bundled.map((s) => `<skill name="${s.name}" description="${s.description}">\n${s.body}\n</skill>`).join("\n\n");
  if (!installed.length) return inline;
  const list = installed.map((s) => `- ${s.name}: ${s.description.slice(0, 280)}`).join("\n");
  return `${inline}

<available_skills>
More skills you can read with read_skill when a task calls for one (copywriting, SEO, schema, blogs, GEO, hooks). They were written for other setups: ignore steps that need tools, files or scripts you don't have, and BODH's own skills above win where they disagree.
${list}
</available_skills>`;
}

const MAX_SKILL_CHARS = 40_000;

/** A skill's SKILL.md, or one of its other markdown files. */
export async function readSkill(name: string, file?: string): Promise<string> {
  const bundled = bundledSkills().find((s) => s.name === name);
  if (bundled) return file ? "Bundled skills have no other files." : bundled.body;
  const s = (await installedSkills()).find((x) => x.name === name);
  if (!s) return `No skill named "${name}".`;
  if (!file) {
    const others = s.dir ? (await listMarkdown(s.dir)).filter((f) => f !== "SKILL.md") : [];
    const more = others.length ? `\n\n[Other files in this skill, readable with read_skill and file: ${others.join(", ")}]` : "";
    return s.body.slice(0, MAX_SKILL_CHARS) + more;
  }
  if (!s.dir) return "This skill has no other files.";
  const rel = normalize(file).replace(/^(\.\.(\/|\\|$))+/, "");
  const path = join(s.dir, rel);
  if (!path.startsWith(s.dir + sep) || !rel.endsWith(".md")) return "Only markdown files inside the skill can be read.";
  return ((await readFile(path, "utf8").catch(() => null)) ?? `No file ${rel} in ${name}.`).slice(0, MAX_SKILL_CHARS);
}

async function listMarkdown(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(join(dir, prefix), { withFileTypes: true }).catch(() => [])) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listMarkdown(dir, rel)));
    else if (e.name.endsWith(".md")) out.push(rel);
  }
  return out.slice(0, 60);
}

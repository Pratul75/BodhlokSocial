import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { BUNDLED_SKILLS } from "./skills.generated";

export interface Skill {
  name: string;
  description: string;
  body: string;
}

function parse(name: string, text: string): Skill {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const front = m?.[1] ?? "";
  return {
    name: front.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? name,
    description: front.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "",
    body: (m?.[2] ?? text).trim(),
  };
}

/**
 * BODH's own skills, plus any *.md files in SKILLS_DIR (one skill per file, same
 * front matter). A skill in SKILLS_DIR with the same name replaces the bundled one.
 */
export async function loadSkills(): Promise<Skill[]> {
  const byName = new Map(BUNDLED_SKILLS.map((s) => [s.name, parse(s.name, s.text)] as const));
  const dir = process.env.SKILLS_DIR;
  if (dir) {
    for (const f of (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".md")).sort()) {
      const s = parse(f.replace(/\.md$/, ""), await readFile(join(dir, f), "utf8"));
      byName.set(s.name, s);
    }
  }
  return [...byName.values()];
}

export function skillsPrompt(skills: Skill[]): string {
  return skills.map((s) => `<skill name="${s.name}" description="${s.description}">\n${s.body}\n</skill>`).join("\n\n");
}

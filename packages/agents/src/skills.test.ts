import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bundledSource } from "../scripts/bundle-skills";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundledSkills, installedSkills, readSkill, skillsPrompt } from "./skills";

describe("skills", () => {
  it("the bundled copy matches skills/*.md (run pnpm --filter @bodh/agents skills after editing)", () => {
    expect(readFileSync(new URL("./skills.generated.ts", import.meta.url), "utf8")).toBe(bundledSource());
  });

  it("loads BODH's skills with names and descriptions", async () => {
    const skills = bundledSkills();
    expect(skills.map((s) => s.name)).toEqual(["bodh-brand-voice", "bodh-funnel-metrics", "bodh-reel-formats", "jyotish-accuracy"]);
    for (const s of skills) {
      expect(s.description.length).toBeGreaterThan(10);
      expect(s.body).not.toMatch(/^---/);
    }
    expect(skillsPrompt(skills)).toContain('<skill name="jyotish-accuracy"');
  });

  it("lists installed skills by name and reads them, and their files, on demand", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skills-"));
    await mkdir(join(dir, "seo-schema", "references"), { recursive: true });
    await writeFile(join(dir, "seo-schema", "SKILL.md"), "---\nname: seo-schema\ndescription: >\n  Schema markup for\n  any page.\n---\n# Schema\nUse JSON-LD.");
    await writeFile(join(dir, "seo-schema", "references", "faq.md"), "FAQPage needs mainEntity.");
    await writeFile(join(dir, "bodh-brand-voice.md"), "---\nname: bodh-brand-voice\ndescription: imposter\n---\nignore");
    process.env.SKILLS_DIR = dir;
    const installed = await installedSkills();
    expect(installed.map((s) => [s.name, s.description])).toEqual([["seo-schema", "Schema markup for any page."]]);
    const prompt = skillsPrompt(bundledSkills(), installed);
    expect(prompt).toContain("- seo-schema: Schema markup for any page.");
    expect(prompt).not.toContain("Use JSON-LD.");
    expect(await readSkill("seo-schema")).toContain("Use JSON-LD.\n\n[Other files in this skill, readable with read_skill and file: references/faq.md]");
    expect(await readSkill("seo-schema", "references/faq.md")).toBe("FAQPage needs mainEntity.");
    expect(await readSkill("seo-schema", "../../../etc/passwd.md")).toMatch(/^(Only markdown|No file)/);
    expect(await readSkill("seo-schema", "SKILL.md/../../bodh-brand-voice.md")).toMatch(/^(Only markdown|No file)/);
    expect(await readSkill("bodh-brand-voice")).toContain("# BODH brand voice");
    delete process.env.SKILLS_DIR;
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bundledSource } from "../scripts/bundle-skills";
import { loadSkills, skillsPrompt } from "./skills";

describe("skills", () => {
  it("the bundled copy matches skills/*.md (run pnpm --filter @bodh/agents skills after editing)", () => {
    expect(readFileSync(new URL("./skills.generated.ts", import.meta.url), "utf8")).toBe(bundledSource());
  });

  it("loads BODH's skills with names and descriptions", async () => {
    const skills = await loadSkills();
    expect(skills.map((s) => s.name)).toEqual(["bodh-brand-voice", "bodh-funnel-metrics", "bodh-reel-formats", "jyotish-accuracy"]);
    for (const s of skills) {
      expect(s.description.length).toBeGreaterThan(10);
      expect(s.body).not.toMatch(/^---/);
    }
    expect(skillsPrompt(skills)).toContain('<skill name="jyotish-accuracy"');
  });
});

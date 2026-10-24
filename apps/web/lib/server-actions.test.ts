import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Next.js rejects a "use server" file that exports anything but async functions, at runtime only. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !f.includes(".test.") ? [p] : [];
  });
}

describe("server action files", () => {
  it("export only async functions (and types)", () => {
    const root = join(import.meta.dirname, "..");
    const bad = [...files(join(root, "app")), ...files(join(root, "lib"))]
      .filter((f) => /^["']use server["']/.test(readFileSync(f, "utf8").trimStart()))
      .flatMap((f) => readFileSync(f, "utf8").split("\n").filter((l) => /^export (const|let|var|class|enum|function |default (?!async))/.test(l)).map((l) => `${f}: ${l}`));
    expect(bad).toEqual([]);
  });
});

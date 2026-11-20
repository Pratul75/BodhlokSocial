/**
 * The short name a workspace gets from its own name.
 *
 * It ends up as a Postgres schema and two role names, and neither can be renamed afterwards, so
 * what matters here is that nothing it produces is ever rejected by `schemaForSlug` — whatever
 * somebody types into the name field.
 */
import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS, schemaForSlug, slugCandidate } from "./platform";

describe("slugCandidate", () => {
  it("turns an ordinary name into the obvious thing", () => {
    expect(slugCandidate("Acme Ltd")).toBe("acme-ltd");
    expect(slugCandidate("Zenith Dental")).toBe("zenith-dental");
    expect(slugCandidate("BODH")).toBe("bodh");
  });

  it("drops punctuation and accents rather than schema names that need quoting", () => {
    expect(slugCandidate("Müller & Sons, Pvt. Ltd.")).toBe("muller-sons-pvt-ltd");
    expect(slugCandidate("  spaced   out  ")).toBe("spaced-out");
    expect(slugCandidate("a---b")).toBe("a-b");
  });

  it("starts with a letter, whatever the name started with", () => {
    expect(slugCandidate("3M")).toBe("w-3m");
    expect(slugCandidate("24x7 Care")).toBe("w-24x7-care");
  });

  it("falls back when the name leaves nothing to build from", () => {
    expect(slugCandidate("आस्ट्रोलोक")).toBe("workspace");
    expect(slugCandidate("!!!")).toBe("workspace");
    expect(slugCandidate("")).toBe("workspace");
  });

  it("never produces a name a schema would refuse", () => {
    const names = [
      "Acme Ltd",
      "3M",
      "आस्ट्रोलोक",
      "!!!",
      "x",
      "Müller & Sons",
      "A".repeat(200),
      "---",
      "a-".repeat(60),
      "Zenith Dental Pvt Ltd Hyderabad Branch Number Fourteen",
    ];
    for (const n of names) {
      const slug = slugCandidate(n);
      expect(/^[a-z][a-z0-9-]{1,38}$/.test(slug), `${n} -> ${slug}`).toBe(true);
      // Reserved names are the caller's job to avoid; everything else must build a schema.
      if (!RESERVED_SLUGS.has(slug)) expect(() => schemaForSlug(slug)).not.toThrow();
    }
  });

  it("is stable: the same name gives the same short name", () => {
    expect(slugCandidate("Acme Ltd")).toBe(slugCandidate("Acme Ltd"));
  });
});

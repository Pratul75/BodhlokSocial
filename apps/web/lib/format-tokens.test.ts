/**
 * What a token count looks like in the console.
 *
 * The page it feeds exists so an operator can tell at a glance which workspace is using the
 * most, so the only thing that really matters here is that two different counts never read as
 * the same number, and that nothing ever renders as "NaN" in front of a customer.
 */
import { describe, expect, it } from "vitest";
import { exactTokens, shortTokens } from "./format-tokens";

describe("shortTokens", () => {
  it("is exact while the number is still readable", () => {
    expect(shortTokens(0)).toBe("0");
    expect(shortTokens(7)).toBe("7");
    expect(shortTokens(9_999)).toBe("9,999");
  });

  it("switches to thousands and then millions", () => {
    expect(shortTokens(10_000)).toBe("10k");
    expect(shortTokens(164_320)).toBe("164k");
    expect(shortTokens(999_499)).toBe("999k");
    expect(shortTokens(1_432_908)).toBe("1.4M");
    expect(shortTokens(9_900_000)).toBe("9.9M");
    expect(shortTokens(12_400_000)).toBe("12M");
  });

  it("never shows NaN, a negative, or a fraction of a token", () => {
    expect(shortTokens(Number.NaN)).toBe("0");
    expect(shortTokens(Number.POSITIVE_INFINITY)).toBe("0");
    expect(shortTokens(-5)).toBe("0");
    expect(shortTokens(1234.6)).toBe("1,235");
  });

  it("keeps workspaces an order of magnitude apart distinguishable", () => {
    const counts = [900, 9_000, 90_000, 900_000, 9_000_000];
    expect(new Set(counts.map(shortTokens)).size).toBe(counts.length);
  });

  it("gives the exact figure for the tooltip", () => {
    expect(exactTokens(1_432_908)).toBe("14,32,908 tokens");
    expect(exactTokens(Number.NaN)).toBe("0 tokens");
  });
});

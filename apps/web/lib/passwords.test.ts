import { describe, expect, it } from "vitest";

const { hashPassword, passwordMatches, passwordProblem } = await import("./passwords");

/**
 * Passwords, shared by platform operators and workspace users. What matters is that a stored value is useless on its own, that a wrong
 * password is refused, and that a weak one is refused before it is ever stored.
 */
describe("operator passwords", () => {
  it("stores a salted hash, never the password", async () => {
    const stored = await hashPassword("a-good-enough-password-1");
    expect(stored).not.toContain("a-good-enough-password-1");
    expect(stored.startsWith("scrypt$")).toBe(true);
    // Six parts: the scheme, its three parameters, the salt and the key.
    expect(stored.split("$")).toHaveLength(6);
  });

  it("gives two people with the same password different stored values", async () => {
    const a = await hashPassword("the-same-password-12");
    const b = await hashPassword("the-same-password-12");
    expect(a).not.toBe(b);
    expect(await passwordMatches("the-same-password-12", a)).toBe(true);
    expect(await passwordMatches("the-same-password-12", b)).toBe(true);
  });

  it("accepts the right password and refuses everything else", async () => {
    const stored = await hashPassword("correct-horse-battery-9");
    expect(await passwordMatches("correct-horse-battery-9", stored)).toBe(true);
    expect(await passwordMatches("correct-horse-battery-8", stored)).toBe(false);
    expect(await passwordMatches("", stored)).toBe(false);
    expect(await passwordMatches("correct-horse-battery-9", null)).toBe(false);
  });

  it("refuses a stored value it does not understand, rather than throwing", async () => {
    expect(await passwordMatches("anything", "not-a-hash")).toBe(false);
    expect(await passwordMatches("anything", "scrypt$x$y$z$salt$key")).toBe(false);
    expect(await passwordMatches("anything", "plain$1$1$1$salt$key")).toBe(false);
  });

  it("says why a password is not good enough", () => {
    expect(passwordProblem("short")).toMatch(/12 characters/);
    expect(passwordProblem("alllettersnonumbers")).toMatch(/number/);
    expect(passwordProblem("12345678901234")).toMatch(/letters/);
    expect(passwordProblem("a-good-password-1")).toBeNull();
    expect(passwordProblem("x".repeat(201))).toMatch(/too long/);
  });
});

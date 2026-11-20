import "server-only";
import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Passwords, for both of the application's principals: the people who run the platform, and the
 * people who work inside a workspace. One implementation, so neither can quietly end up weaker
 * than the other.
 *
 * scrypt from Node's own crypto — no new dependency — with the parameters written into the
 * stored value, so they can be raised later without invalidating what is already stored.
 */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/** scrypt with its options, as a promise. `promisify` drops the four-argument form. */
const scryptAsync = (password: string, salt: string, keylen: number, opts: ScryptOptions): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const key = await scryptAsync(password, salt, SCRYPT.keylen, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt, key.toString("base64url")].join("$");
}

export async function passwordMatches(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, expected] = parts as [string, string, string, string, string, string];
  try {
    const want = Buffer.from(expected, "base64url");
    const key = await scryptAsync(password, salt, want.length, { N: Number(n), r: Number(r), p: Number(p) });
    // Hash both sides to a fixed width first: timingSafeEqual throws on a length mismatch, and
    // the length of a stored hash is not a secret worth leaking through an exception.
    return timingSafeEqual(createHash("sha256").update(key).digest(), createHash("sha256").update(want).digest());
  } catch {
    return false;
  }
}

/** What a password must be, in the words shown to whoever is setting it. */
export function passwordProblem(password: string): string | null {
  if (password.length < 12) return "Use at least 12 characters.";
  if (password.length > 200) return "That is too long.";
  if (!/[a-z]/i.test(password) || !/[0-9]/.test(password)) return "Use letters and at least one number.";
  return null;
}

/** A link's token. Only its hash is ever stored, so the database holds nothing that opens an account. */
export const newToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * How long somebody is locked out after repeated wrong passwords.
 *
 * Counting failures per account is the cheapest thing that turns an online guessing attack from
 * "leave it running" into "give up": scrypt already makes each guess expensive, and this makes
 * the tenth one free to refuse.
 */
export const LOCKOUT_AFTER = 8;
export const LOCKOUT_MINUTES = 15;

/**
 * Checks for answers posted in communities (Reddit, YouTube comments, Quora) and for directory
 * listings. Build plan section 7: no fake accounts, reviews or undisclosed promotion. An answer that
 * names the product must say the writer works on it, in plain words, every time.
 */
import { lintAdCopy, lintPositioning } from "./index";

export type CommunityPlatform = "reddit" | "youtube" | "quora";

export interface ReplyCheck {
  errors: string[];
  warnings: string[];
}

const BRAND = /\b(bodhlok|bodh|asttrolok)\b/i;
/** Plain disclosures, e.g. "I work on Bodhlok", "I'm on the Bodhlok team", "Disclosure: ...". */
export const DISCLOSURE = /\b(disclosure|full disclosure|i work (on|at|for)|i'?m (on|part of) the (\w+ )?team|we (make|build|built)|i (help )?(build|make)|our team (makes|builds))\b/i;
const LIMITS: Record<CommunityPlatform, number> = { reddit: 10_000, youtube: 10_000, quora: 20_000 };
const SALESY = /\b(dm me|use (my )?code|limited (time )?offer|sign up now|click (the )?link|link in (my )?bio|discount code)\b/i;
const FAKE_PEER = /\b(as a (happy|long[- ]time) (user|customer)|i('ve| have) been using (it|bodhlok) for)\b/i;

/** Rules every community answer must pass before it can go to a person for approval. */
export function checkCommunityReply(text: string, platform: CommunityPlatform): ReplyCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const body = text.trim();
  if (body.length < 40) errors.push("Too short to be a helpful answer (40 characters at least).");
  if (body.length > LIMITS[platform]) errors.push(`Longer than ${platform}'s limit of ${LIMITS[platform]} characters.`);
  if (BRAND.test(body) && !DISCLOSURE.test(body)) {
    errors.push('Names Bodhlok without saying who is writing. Add a plain disclosure, e.g. "Disclosure: I work on Bodhlok."');
  }
  if (FAKE_PEER.test(body)) errors.push("Reads like a customer testimonial. The team account must never pose as a user.");
  for (const i of lintAdCopy(body, "page")) errors.push(`${i.why}: "${i.match}"`);
  for (const i of lintPositioning(body)) {
    // Answering someone's own question, "your chart" is natural; it's the marketing voice that must avoid it.
    const level = i.why.startsWith("Speaks to a horoscope reader") ? "warning" : i.level;
    (level === "error" ? errors : warnings).push(`${i.why}: "${i.match}"`);
  }
  const links = body.match(/https?:\/\/\S+/g) ?? [];
  if (links.length > 2) warnings.push(`${links.length} links. Communities treat link-heavy answers as spam; one is plenty.`);
  if (SALESY.test(body)) warnings.push("Sounds like a sales pitch. Answer the question; mention the product only where it genuinely helps.");
  if (platform === "reddit" && !/\n/.test(body) && body.length > 600) warnings.push("One long paragraph. Break it up for Reddit.");
  return { errors, warnings };
}

export interface ListingDraft {
  title: string;
  tagline: string;
  description: string;
}

/** A directory listing describes the product honestly; the same claim and positioning rules apply. */
export function checkListing(d: ListingDraft): ReplyCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const all = `${d.title}\n${d.tagline}\n${d.description}`;
  if (d.description.trim().length < 80) errors.push("The description is too short to be useful (80 characters at least).");
  if (d.tagline.length > 120) errors.push("The tagline is over 120 characters.");
  for (const i of lintAdCopy(all, "ad")) errors.push(`${i.why}: "${i.match}"`);
  for (const i of lintPositioning(all)) (i.level === "error" ? errors : warnings).push(`${i.why}: "${i.match}"`);
  if (/(^|[^\w])#1\b|\b(number one|best in (india|the world)|world'?s best)\b/i.test(all)) errors.push("Superlatives a directory reader can't check. Say what the software does.");
  return { errors, warnings };
}

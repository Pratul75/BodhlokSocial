/**
 * Guardrails enforced in code, not in prompts. Agents call these before any
 * write; a "needs_approval" result means the action goes to the approval queue.
 */

export type Decision =
  | { outcome: "allow"; reason: string }
  | { outcome: "needs_approval"; reason: string }
  | { outcome: "block"; reason: string };

export interface SpendCaps {
  /** Daily cap in INR for the platform. */
  dailyCap: number;
  /** Monthly cap in INR for the platform. */
  monthlyCap: number;
}

export interface SpendState {
  spentToday: number;
  spentThisMonth: number;
  /** Sum of the daily budgets of everything running on the platform. */
  committedDaily?: number;
}

export type AdChange =
  | { type: "pause_ad"; adId: string; isLosing: boolean; lastActiveInAdSet?: boolean }
  | { type: "bid_change"; adSetId: string; currentBid: number; newBid: number }
  | { type: "budget_change"; adSetId: string; currentDaily: number; newDaily: number }
  | { type: "new_campaign"; name: string; dailyBudget: number }
  | { type: "resume_ad"; adId: string }
  /** A new ad variant in an existing ad set: new public copy, no new budget. */
  | { type: "ab_test"; adSetId: string; variants: number };

/** Largest bid move the agent may make on its own, as a fraction. */
export const AUTO_BID_LIMIT = 0.2;

export function checkAdChange(change: AdChange, caps: SpendCaps, spend: SpendState): Decision {
  if (spend.spentToday >= caps.dailyCap) {
    if (change.type === "pause_ad") {
      return { outcome: "allow", reason: "Pausing is always allowed, even at the daily cap." };
    }
    return { outcome: "block", reason: `Daily cap of ₹${caps.dailyCap} reached.` };
  }
  if (spend.spentThisMonth >= caps.monthlyCap) {
    if (change.type === "pause_ad") {
      return { outcome: "allow", reason: "Pausing is always allowed, even at the monthly cap." };
    }
    return { outcome: "block", reason: `Monthly cap of ₹${caps.monthlyCap} reached.` };
  }

  switch (change.type) {
    case "pause_ad":
      if (change.lastActiveInAdSet) return { outcome: "needs_approval", reason: "It's the last active ad in its ad set, so pausing it stops the ad set." };
      return change.isLosing
        ? { outcome: "allow", reason: "Pausing a losing ad is on the auto-allow list." }
        : { outcome: "needs_approval", reason: "Pausing an ad that is not losing needs a person." };

    case "bid_change": {
      if (change.currentBid <= 0) {
        return { outcome: "needs_approval", reason: "No current bid to compare against." };
      }
      const move = Math.abs(change.newBid - change.currentBid) / change.currentBid;
      return move <= AUTO_BID_LIMIT + 1e-9
        ? { outcome: "allow", reason: `Bid moves ${(move * 100).toFixed(0)}%, within ±20%.` }
        : { outcome: "needs_approval", reason: `Bid moves ${(move * 100).toFixed(0)}%, over the ±20% limit.` };
    }

    case "budget_change":
      if (change.newDaily > caps.dailyCap) {
        return { outcome: "block", reason: `New daily budget exceeds the ₹${caps.dailyCap} cap.` };
      }
      if (spend.committedDaily !== undefined && change.newDaily > change.currentDaily) {
        const total = spend.committedDaily - change.currentDaily + change.newDaily;
        if (total > caps.dailyCap) return { outcome: "block", reason: `Daily budgets would total ₹${Math.round(total)}, over the ₹${caps.dailyCap} daily cap.` };
      }
      return change.newDaily > change.currentDaily
        ? { outcome: "needs_approval", reason: "Budget increases always need approval." }
        : { outcome: "allow", reason: "Budget decreases are allowed." };

    case "new_campaign":
      if (change.dailyBudget > caps.dailyCap) {
        return { outcome: "block", reason: `Campaign budget exceeds the ₹${caps.dailyCap} daily cap.` };
      }
      if (spend.committedDaily !== undefined && spend.committedDaily + change.dailyBudget > caps.dailyCap) {
        return { outcome: "block", reason: `Daily budgets would total ₹${Math.round(spend.committedDaily + change.dailyBudget)}, over the ₹${caps.dailyCap} daily cap.` };
      }
      return { outcome: "needs_approval", reason: "New campaigns always need approval." };

    case "resume_ad":
      return { outcome: "needs_approval", reason: "Resuming spend needs a person." };

    case "ab_test":
      if (change.variants < 1 || change.variants > MAX_TEST_VARIANTS) return { outcome: "block", reason: `A test adds 1 to ${MAX_TEST_VARIANTS} variants.` };
      return { outcome: "needs_approval", reason: "New ad copy goes public, so a person approves it first." };
  }
}

export const MAX_TEST_VARIANTS = 3;

export interface AdStats {
  adId: string;
  spend: number;
  activations: number;
}

/** When an ad counts as losing. Code decides this from the data; an agent's word is not enough. */
export const LOSING_RULES = {
  /** Spend before an ad can be judged, in INR. */
  minSpend: 1500,
  /** A peer needs this many activations to be a benchmark. */
  minPeerActivations: 3,
  /** Losing when its cost per activation is this many times the best peer's. */
  cpaRatio: 1.5,
  /** With no activations at all, losing once spend passes this many times the best peer's CPA. */
  zeroActivationSpendRatio: 2,
};

/**
 * Compares an ad with the other ads in its ad set over the same period. The benchmark is the
 * cheapest peer with enough activations, so an ad set without a proven ad never auto-pauses.
 */
export function isLosingAd(ad: AdStats, peers: AdStats[], rules = LOSING_RULES): { losing: boolean; reason: string } {
  if (ad.spend < rules.minSpend) return { losing: false, reason: `Spent ₹${Math.round(ad.spend)}, under the ₹${rules.minSpend} needed to judge it.` };
  const proven = peers.filter((p) => p.adId !== ad.adId && p.activations >= rules.minPeerActivations);
  if (!proven.length) return { losing: false, reason: "No other ad in the ad set has enough activations to compare against." };
  const best = proven.reduce((a, b) => (a.spend / a.activations <= b.spend / b.activations ? a : b));
  const bestCpa = best.spend / best.activations;
  if (ad.activations === 0) {
    return ad.spend >= rules.zeroActivationSpendRatio * bestCpa
      ? { losing: true, reason: `₹${Math.round(ad.spend)} spent with no activations; the best ad pays ₹${Math.round(bestCpa)} per activation.` }
      : { losing: false, reason: `No activations yet, but spend is under ${rules.zeroActivationSpendRatio}x the best ad's ₹${Math.round(bestCpa)} per activation.` };
  }
  const cpa = ad.spend / ad.activations;
  return cpa >= rules.cpaRatio * bestCpa
    ? { losing: true, reason: `₹${Math.round(cpa)} per activation against ₹${Math.round(bestCpa)} for the best ad in the ad set.` }
    : { losing: false, reason: `₹${Math.round(cpa)} per activation is within ${rules.cpaRatio}x the best ad's ₹${Math.round(bestCpa)}.` };
}

/** Phrases Google and Meta reject in astrology ads, plus claims BODH never makes. */
// "No guarantee", "can't guarantee" and the like are disclaimers, not claims.
const NOT = String.raw`(?<!\b(?:no|not|never|without|cannot|can't|don't|doesn't|won't|isn't|aren't)\s+(?:a\s+|any\s+|be\s+|is\s+)?)`;
const BANNED_CLAIMS: { pattern: RegExp; why: string; adsOnly?: boolean }[] = [
  { pattern: new RegExp(`${NOT}\\bguarantee(d|s)?\\b`, "i"), why: "Guaranteed outcomes" },
  { pattern: /\b100\s?%\s*(accurate|sure|certain)\b/i, why: "Absolute accuracy claims" },
  { pattern: new RegExp(`${NOT}\\b(cure|cures|cured)\\b`, "i"), why: "Health promises" },
  // Educational pages may talk about healing traditions; ads may not.
  { pattern: /\b(heal|heals|healing)\b/i, why: "Health promises", adsOnly: true },
  { pattern: /\b(get rich|become rich|lottery|jackpot|double your money)\b/i, why: "Financial promises" },
  { pattern: /\bwill (definitely|surely) (happen|come true)\b/i, why: "Guaranteed predictions" },
];

export interface CopyIssue {
  match: string;
  why: string;
}

/** Claims Google, Meta and BODH don't allow. `pages` relaxes the ads-only rules for educational pages. */
export function lintAdCopy(text: string, kind: "ad" | "page" = "ad"): CopyIssue[] {
  const issues: CopyIssue[] = [];
  for (const { pattern, why, adsOnly } of BANNED_CLAIMS) {
    if (adsOnly && kind === "page") continue;
    const m = text.match(pattern);
    if (m) issues.push({ match: m[0], why });
  }
  return issues;
}

/** Nothing goes public without approval for the first 60 days after launch. */
export function requiresPublishApproval(launchDate: Date, now: Date, channelAutoApprove: boolean): boolean {
  const days = (now.getTime() - launchDate.getTime()) / 86_400_000;
  if (days < 60) return true;
  return !channelAutoApprove;
}

/* ---------- positioning (from the launch film) ---------- */

export interface PositioningIssue extends CopyIssue {
  level: "error" | "warning";
}

const NOT_MEDICAL = /\bnot (medical|healthcare|health) advice\b|\bastrological guidance only\b/i;

/**
 * Bodhlok speaks to astrologers, students and institutes, never to the public wanting a
 * prediction; the AI assists the astrologer; the planning modules are not medical advice;
 * the tone is calm and professional. Errors block a post; warnings go to the approver.
 */
const POSITIONING: { pattern: RegExp; why: string; level: "error" | "warning" }[] = [
  { pattern: /\byour (own )?(kundli|kundali|janam ?kundli|birth ?chart|horoscope|future|destiny|love life|lucky (number|colou?r|day)|rashi|moon sign|sun sign|zodiac|stars)\b/i, why: "Speaks to a horoscope reader, not an astrologer", level: "error" },
  { pattern: /\b(free|instant|online) (kundli|kundali|horoscope|prediction)s?\b/i, why: "Consumer kundli offer; Bodhlok's offer is the free desk", level: "error" },
  { pattern: /\bwhat (the|your) (stars|planets) (say|hold|have in store)\b|\bpredictions? for you\b|\b(daily|weekly|monthly) horoscope\b/i, why: "Predictions for the reader", level: "error" },
  { pattern: /\bai astrologers?\b|\b(no|without an?) astrologer (needed|required)\b|\bai (predicts|reads your|replaces)\b|\breplaces? (the|an|your) astrologer\b|\bastrologer[- ]free\b/i, why: "The AI assists the astrologer; it never replaces one", level: "error" },
  { pattern: /\b(fertility|conception|contracepti\w+|pregnan\w+|infertil\w+|diagnos\w+|cure|treatment|medical)\b/i, why: "Health or fertility claim without the line \"Astrological guidance only. Not medical advice.\"", level: "error" },
  { pattern: /\b(mystical|magical|cosmic energ(y|ies)|the universe (has|is|wants)|manifest(ing|ation)?|crystal ball|psychic|miracle|secrets? of the universe)\b/i, why: "Mystical tone; Bodhlok is calm and professional", level: "warning" },
  { pattern: /\byou won'?t believe\b|\bshocking\b|\bmind[- ]blowing\b/i, why: "Clickbait", level: "warning" },
];

export function lintPositioning(text: string): PositioningIssue[] {
  const issues: PositioningIssue[] = [];
  const disclaimed = NOT_MEDICAL.test(text);
  for (const { pattern, why, level } of POSITIONING) {
    const m = text.match(pattern);
    if (!m) continue;
    if (why.startsWith("Health") && disclaimed) continue;
    issues.push({ match: m[0], why, level });
  }
  return issues;
}

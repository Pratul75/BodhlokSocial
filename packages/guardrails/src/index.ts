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
}

export type AdChange =
  | { type: "pause_ad"; adId: string; isLosing: boolean }
  | { type: "bid_change"; adSetId: string; currentBid: number; newBid: number }
  | { type: "budget_change"; adSetId: string; currentDaily: number; newDaily: number }
  | { type: "new_campaign"; name: string; dailyBudget: number }
  | { type: "resume_ad"; adId: string };

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
      return change.newDaily > change.currentDaily
        ? { outcome: "needs_approval", reason: "Budget increases always need approval." }
        : { outcome: "allow", reason: "Budget decreases are allowed." };

    case "new_campaign":
      if (change.dailyBudget > caps.dailyCap) {
        return { outcome: "block", reason: `Campaign budget exceeds the ₹${caps.dailyCap} daily cap.` };
      }
      return { outcome: "needs_approval", reason: "New campaigns always need approval." };

    case "resume_ad":
      return { outcome: "needs_approval", reason: "Resuming spend needs a person." };
  }
}

/** Phrases Google and Meta reject in astrology ads, plus claims BODH never makes. */
const BANNED_CLAIMS: { pattern: RegExp; why: string }[] = [
  { pattern: /\bguarantee(d|s)?\b/i, why: "Guaranteed outcomes" },
  { pattern: /\b100\s?%\s*(accurate|sure|certain)\b/i, why: "Absolute accuracy claims" },
  { pattern: /\b(cure|heal|healing)\b/i, why: "Health promises" },
  { pattern: /\b(get rich|become rich|lottery|jackpot|double your money)\b/i, why: "Financial promises" },
  { pattern: /\bwill (definitely|surely) (happen|come true)\b/i, why: "Guaranteed predictions" },
];

export interface CopyIssue {
  match: string;
  why: string;
}

export function lintAdCopy(text: string): CopyIssue[] {
  const issues: CopyIssue[] = [];
  for (const { pattern, why } of BANNED_CLAIMS) {
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

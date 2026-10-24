import { describe, expect, it } from "vitest";
import { checkAdChange, lintAdCopy, requiresPublishApproval } from "./index";

const caps = { dailyCap: 5000, monthlyCap: 120000 };
const fresh = { spentToday: 1000, spentThisMonth: 20000 };

describe("checkAdChange", () => {
  it("auto-allows pausing a losing ad", () => {
    expect(checkAdChange({ type: "pause_ad", adId: "a", isLosing: true }, caps, fresh).outcome).toBe("allow");
  });

  it("allows pausing even at the daily cap", () => {
    const capped = { spentToday: 5000, spentThisMonth: 20000 };
    expect(checkAdChange({ type: "pause_ad", adId: "a", isLosing: false }, caps, capped).outcome).toBe("allow");
  });

  it("allows bid moves within 20%", () => {
    expect(checkAdChange({ type: "bid_change", adSetId: "s", currentBid: 10, newBid: 12 }, caps, fresh).outcome).toBe("allow");
    expect(checkAdChange({ type: "bid_change", adSetId: "s", currentBid: 10, newBid: 8 }, caps, fresh).outcome).toBe("allow");
  });

  it("sends bid moves over 20% to approval", () => {
    expect(checkAdChange({ type: "bid_change", adSetId: "s", currentBid: 10, newBid: 12.5 }, caps, fresh).outcome).toBe(
      "needs_approval",
    );
  });

  it("sends every budget increase to approval", () => {
    expect(
      checkAdChange({ type: "budget_change", adSetId: "s", currentDaily: 1000, newDaily: 1100 }, caps, fresh).outcome,
    ).toBe("needs_approval");
  });

  it("blocks budgets over the daily cap", () => {
    expect(
      checkAdChange({ type: "budget_change", adSetId: "s", currentDaily: 1000, newDaily: 6000 }, caps, fresh).outcome,
    ).toBe("block");
    expect(checkAdChange({ type: "new_campaign", name: "x", dailyBudget: 9000 }, caps, fresh).outcome).toBe("block");
  });

  it("blocks new spend once the monthly cap is reached", () => {
    const monthCapped = { spentToday: 0, spentThisMonth: 120000 };
    expect(checkAdChange({ type: "resume_ad", adId: "a" }, caps, monthCapped).outcome).toBe("block");
  });
});

describe("lintAdCopy", () => {
  it("flags guaranteed predictions and health or money promises", () => {
    expect(lintAdCopy("Guaranteed results, 100% accurate predictions").length).toBe(2);
    expect(lintAdCopy("Heal your career and get rich")).toHaveLength(2);
  });

  it("passes plain product copy", () => {
    expect(lintAdCopy("Generate a Kundli in seconds with correct Drishti.")).toEqual([]);
  });
});

describe("requiresPublishApproval", () => {
  const launch = new Date("2026-11-01");
  it("always requires approval in the first 60 days", () => {
    expect(requiresPublishApproval(launch, new Date("2026-12-15"), true)).toBe(true);
  });
  it("follows the channel flag after 60 days", () => {
    expect(requiresPublishApproval(launch, new Date("2027-01-15"), true)).toBe(false);
    expect(requiresPublishApproval(launch, new Date("2027-01-15"), false)).toBe(true);
  });
});

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

describe("losing ads and committed budgets", () => {
  const caps = { dailyCap: 5000, monthlyCap: 100000 };
  it("judges an ad against the best proven peer in its ad set", async () => {
    const { isLosingAd } = await import("./index");
    const peers = [{ adId: "a", spend: 3000, activations: 10 }, { adId: "b", spend: 2000, activations: 2 }];
    expect(isLosingAd({ adId: "x", spend: 1000, activations: 0 }, peers).losing).toBe(false); // under min spend
    expect(isLosingAd({ adId: "x", spend: 1600, activations: 0 }, peers)).toMatchObject({ losing: true }); // 1600 >= 2 x 300
    expect(isLosingAd({ adId: "x", spend: 4000, activations: 8 }, peers)).toMatchObject({ losing: true }); // 500 >= 1.5 x 300
    expect(isLosingAd({ adId: "x", spend: 3000, activations: 8 }, peers).losing).toBe(false); // 375 < 450
    expect(isLosingAd({ adId: "x", spend: 9000, activations: 0 }, [{ adId: "b", spend: 2000, activations: 2 }]).losing).toBe(false); // no proven peer
  });

  it("never auto-pauses the last active ad, and checks budgets against everything running", async () => {
    const { checkAdChange } = await import("./index");
    const spend = { spentToday: 100, spentThisMonth: 1000, committedDaily: 4000 };
    expect(checkAdChange({ type: "pause_ad", adId: "x", isLosing: true, lastActiveInAdSet: true }, caps, spend).outcome).toBe("needs_approval");
    expect(checkAdChange({ type: "budget_change", adSetId: "s", currentDaily: 1000, newDaily: 2100 }, caps, spend)).toMatchObject({ outcome: "block" }); // 4000 - 1000 + 2100 > 5000
    expect(checkAdChange({ type: "budget_change", adSetId: "s", currentDaily: 1000, newDaily: 1500 }, caps, spend).outcome).toBe("needs_approval");
    expect(checkAdChange({ type: "new_campaign", name: "n", dailyBudget: 1500 }, caps, spend).outcome).toBe("block");
    expect(checkAdChange({ type: "ab_test", adSetId: "s", variants: 2 }, caps, spend).outcome).toBe("needs_approval");
    expect(checkAdChange({ type: "ab_test", adSetId: "s", variants: 2 }, { dailyCap: 0, monthlyCap: 0 }, spend).outcome).toBe("block");
  });
});

describe("copy lint disclaimers", () => {
  it("allows disclaimers and lets pages discuss healing traditions", async () => {
    const { lintAdCopy } = await import("./index");
    expect(lintAdCopy("There's no guarantee, and astrology can't guarantee outcomes.")).toEqual([]);
    expect(lintAdCopy("Results are not guaranteed.")).toEqual([]);
    expect(lintAdCopy("Guaranteed marriage in 30 days").map((i) => i.why)).toEqual(["Guaranteed outcomes"]);
    expect(lintAdCopy("Remedies cure your doshas").map((i) => i.why)).toEqual(["Health promises"]);
    expect(lintAdCopy("Gemstones are not a cure.")).toEqual([]);
    expect(lintAdCopy("Ayurveda and healing traditions", "page")).toEqual([]);
    expect(lintAdCopy("A healing reading", "ad").map((i) => i.why)).toEqual(["Health promises"]);
  });
});

import { SearchMoonPhase } from "astronomy-engine";
import { describe, expect, it } from "vitest";
import { CITIES, istTime, lahiriAyanamsa, nakshatraIndex, nextChange, panchang, positions, tithiIndex } from "./panchang";

const delhi = CITIES.find((c) => c.slug === "delhi")!;

describe("panchang", () => {
  it("uses the Lahiri ayanamsa (about 24°13' in 2026)", () => {
    expect(lahiriAyanamsa(new Date("2026-01-01T00:00:00Z"))).toBeCloseTo(24.22, 1);
  });

  it("Makar Sankranti 2026: the Sun enters sidereal Capricorn on 14 January", () => {
    const before = positions(new Date("2026-01-14T00:00:00Z")).sunSidereal; // 05:30 IST
    const after = positions(new Date("2026-01-15T00:00:00Z")).sunSidereal;
    expect(before).toBeLessThan(270);
    expect(after).toBeGreaterThan(270);
  });

  it("Purnima ends exactly at the full moon", () => {
    const full = SearchMoonPhase(180, new Date("2026-01-01T00:00:00Z"), 40)!.date;
    const end = nextChange(new Date(full.getTime() - 6 * 3_600_000), tithiIndex)!;
    expect(Math.abs(end.getTime() - full.getTime())).toBeLessThan(60_000);
    expect(tithiIndex(positions(new Date(full.getTime() - 60_000)))).toBe(14);
  });

  it("gives Delhi's Panchang with sensible times", () => {
    const p = panchang("2026-10-24", delhi);
    expect(p.vara).toBe("Shanivara (Saturday)");
    expect(istTime(p.sunrise)).toMatch(/^06:[2-3]\d$/);
    expect(istTime(p.sunset)).toMatch(/^17:[3-5]\d$/);
    // Saturday: Rahu Kaal is the third eighth of the day, about 09:00 to 10:30.
    expect(istTime(p.rahuKaal.start)).toMatch(/^09:/);
    expect(new Date(p.tithi.endsAt!).getTime()).toBeGreaterThan(new Date(p.sunrise).getTime());
    expect(p.nakshatra.name).toBeTruthy();
    expect(new Date(p.nakshatra.endsAt!).getTime() - new Date(p.sunrise).getTime()).toBeLessThan(28 * 3_600_000);
  });

  it("each nakshatra spans 13°20' of the Moon's sidereal path", () => {
    const t = new Date("2026-03-01T00:00:00Z");
    const n = nakshatraIndex(positions(t));
    const end = nextChange(t, nakshatraIndex)!;
    expect(positions(end).moonSidereal).toBeCloseTo(((n + 1) * 360) / 27 % 360, 1);
  });
});

import { describe, expect, it } from "vitest";
import { LEVELS, levelIndex, rollTier, shotClock } from "./levels";

describe("Lucky Drop levels", () => {
  it("every level's odds add to 100 and the clock only gets faster", () => {
    for (const level of LEVELS) expect(level.odds.reduce((a, b) => a + b, 0)).toBe(100);
    for (let i = 1; i < LEVELS.length; i++) {
      expect(LEVELS[i]!.score).toBeGreaterThan(LEVELS[i - 1]!.score);
      expect(LEVELS[i]!.shot).toBeLessThan(LEVELS[i - 1]!.shot);
    }
  });

  it("starts with only 1/2/4 at the classic 65/25/10", () => {
    expect([0, 0.6499, 0.65, 0.8999, 0.9, 0.9999].map((n) => rollTier(n, 0))).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it("adds 8s, then 16s, as the score climbs", () => {
    expect(rollTier(0.99, 1_999)).toBe(2);
    expect(rollTier(0.99, 2_000)).toBe(3);
    expect(rollTier(0.99, 6_000)).toBe(4);
    const sixteens = (score: number) => Array.from({ length: 1000 }, (_, i) => rollTier(i / 1000, score)).filter((t) => t === 4).length;
    expect(sixteens(30_000)).toBeGreaterThan(sixteens(6_000));
  });

  it("shrinks the shot clock with score", () => {
    expect(shotClock(0)).toBe(8);
    expect(shotClock(50_000)).toBe(3);
    expect(levelIndex(15_000)).toBe(3);
  });
});

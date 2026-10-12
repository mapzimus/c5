import { describe, expect, it } from "vitest";
import {
  BANK_EVERY,
  GAP_MIN,
  GAP_OVERDRIVE,
  GAP_START,
  MATCH_SECONDS,
  MULT_MAX,
  MULT_STEP,
  OVERDRIVE_AT,
  SPEED_MAX,
  SPEED_OVERDRIVE,
  SPEED_START,
  UNDERDOG_GAP,
  bankAim,
  botSloppiness,
  botWantsBank,
  clearance,
  compareLanes,
  flapClearsCeiling,
  flapThreshold,
  gain,
  inBankHalf,
  isBankGate,
  isSkim,
  multFor,
  multPips,
  nextGapY,
  paceAt,
  safeBand,
  speedScale,
  stormTarget,
  underdogIndex,
} from "./logic";

describe("Sky Dash pacing", () => {
  it("ramps speed and tightens gaps, then jumps into overdrive", () => {
    const start = paceAt(0);
    expect(start.speed).toBe(SPEED_START);
    expect(start.gap).toBe(GAP_START);
    expect(start.overdrive).toBe(false);
    const mid = paceAt(OVERDRIVE_AT / 2);
    expect(mid.speed).toBeGreaterThan(SPEED_START);
    expect(mid.speed).toBeLessThan(SPEED_MAX);
    expect(mid.gap).toBeLessThan(GAP_START);
    const edge = paceAt(OVERDRIVE_AT);
    expect(edge.overdrive).toBe(true);
    expect(edge.speed).toBeCloseTo(SPEED_MAX, 5);
    const deep = paceAt(MATCH_SECONDS);
    expect(deep.speed).toBe(SPEED_OVERDRIVE);
    expect(deep.gap).toBe(GAP_OVERDRIVE);
    expect(GAP_OVERDRIVE).toBeLessThan(GAP_MIN);
  });
});

describe("run multiplier", () => {
  it("rises every MULT_STEP gates, caps at MULT_MAX, and the underdog gets +1", () => {
    expect(multFor(0)).toBe(1);
    expect(multFor(MULT_STEP - 1)).toBe(1);
    expect(multFor(MULT_STEP)).toBe(2);
    expect(multFor(MULT_STEP * 10)).toBe(MULT_MAX);
    expect(multFor(0, true)).toBe(2);
    expect(multFor(MULT_STEP * 10, true)).toBe(MULT_MAX + 1);
  });

  it("shows pip progress toward the next level and fills once capped", () => {
    expect(multPips(0)).toBe(0);
    expect(multPips(1)).toBe(1);
    expect(multPips(MULT_STEP)).toBe(0);
    expect(multPips((MULT_MAX - 1) * MULT_STEP)).toBe(MULT_STEP);
  });

  it("doubles gains in overdrive", () => {
    expect(gain(1, 3, false)).toBe(3);
    expect(gain(1, 3, true)).toBe(6);
    expect(gain(2, 1, false)).toBe(2);
  });
});

describe("gates", () => {
  it("marks every BANK_EVERY-th gate as a split gate", () => {
    expect(isBankGate(0)).toBe(false);
    expect(isBankGate(1)).toBe(false);
    expect(isBankGate(BANK_EVERY)).toBe(true);
    expect(isBankGate(BANK_EVERY * 2)).toBe(true);
    expect(isBankGate(BANK_EVERY + 1)).toBe(false);
  });

  it("measures clearance to the nearest gap edge", () => {
    expect(clearance(400, 400, 100)).toBe(34);
    expect(clearance(370, 400, 100)).toBe(4);
    expect(clearance(360, 400, 100)).toBeLessThan(0);
    expect(isSkim(4)).toBe(true);
    expect(isSkim(20)).toBe(false);
    expect(isSkim(-1)).toBe(false);
  });

  it("knows which half of a split gate the jet crossed", () => {
    expect(inBankHalf(380, 400, "top")).toBe(true);
    expect(inBankHalf(420, 400, "top")).toBe(false);
    expect(inBankHalf(420, 400, "bottom")).toBe(true);
    expect(inBankHalf(380, 400, "bottom")).toBe(false);
  });
});

describe("underdog and ranking", () => {
  it("picks the lone last place only when they trail by the gap", () => {
    expect(underdogIndex([0, 0])).toBe(-1);
    expect(underdogIndex([30, 5])).toBe(1);
    expect(underdogIndex([30, 30 - UNDERDOG_GAP + 1])).toBe(-1);
    expect(underdogIndex([40, 2, 2])).toBe(-1);
    expect(underdogIndex([40, 9, 2, 20])).toBe(2);
    expect(underdogIndex([7])).toBe(-1);
  });

  it("ranks by banked score, then lives, then unbanked run", () => {
    const a = { score: 20, lives: 1, run: 0 };
    const b = { score: 20, lives: 2, run: 0 };
    const c = { score: 30, lives: 0, run: 0 };
    const d = { score: 20, lives: 2, run: 9 };
    expect([a, b, c, d].sort(compareLanes)).toEqual([c, d, b, a]);
  });
});

describe("bots", () => {
  it("keeps a flap-only bot inside a safe band of the gap", () => {
    const { lo, hi } = safeBand(400, 180);
    expect(lo).toBe(391);
    expect(hi).toBe(460);
    const tight = safeBand(400, 100);
    expect(tight.lo).toBeLessThanOrEqual(tight.hi);
  });

  it("keeps the next gap reachable from the previous one", () => {
    expect(nextGapY(400, 1, 200, 600, 0)).toBe(250);
    expect(nextGapY(400, 1, 200, 600, 1)).toBe(600);
    expect(nextGapY(400, 1, 200, 600, 0.5)).toBe(425);
    expect(speedScale(640)).toBe(1);
    expect(speedScale(320)).toBe(0.72);
    expect(speedScale(426)).toBe(0.72);
    expect(speedScale(500)).toBeCloseTo(500 / 640, 5);
    expect(nextGapY(100, 1, 200, 600, 0.5)).toBe(270);
    expect(flapClearsCeiling(200, 64)).toBe(true);
    expect(flapClearsCeiling(130, 64)).toBe(false);
    expect(flapThreshold(10)).toBe(-40);
    expect(flapThreshold(200)).toBeLessThan(flapThreshold(60));
  });

  it("aims at the gold half to bank and the other half to ride", () => {
    expect(bankAim(400, 160, "top", true)).toBeLessThan(400);
    expect(bankAim(400, 160, "top", false)).toBeGreaterThan(400);
    expect(bankAim(400, 160, "bottom", true)).toBeGreaterThan(400);
    expect(bankAim(400, 160, "bottom", false)).toBeLessThan(400);
  });

  it("banks when nervous, when maxed, or when the clock is nearly out", () => {
    expect(botWantsBank(0, 1, 0, 1)).toBe(false);
    expect(botWantsBank(5, 1, 0.9, 60)).toBe(false);
    expect(botWantsBank(5, 1, 0.9, 5)).toBe(true);
    expect(botWantsBank(5, MULT_MAX, 0.9, 60)).toBe(true);
    expect(botWantsBank(10, 2, 0, 60)).toBe(true);
    expect(botWantsBank(10, 2, 1, 60)).toBe(false);
  });

  it("gets sloppier with speed and storms the leader most of the time", () => {
    expect(botSloppiness(SPEED_START)).toBeLessThan(botSloppiness(SPEED_OVERDRIVE));
    expect(botSloppiness(SPEED_OVERDRIVE)).toBeLessThan(0.2);
    expect(stormTarget([5, 40, 12], [0, 2], 0.1)).toBe(2);
    expect(stormTarget([5, 40, 12], [0, 2], 0.61)).toBe(0);
    expect(stormTarget([5, 40, 12], [0, 2], 0.99)).toBe(2);
    expect(stormTarget([5, 40, 12], [], 0.1)).toBe(-1);
  });
});

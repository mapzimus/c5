import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { ropeSkip } from "./rope-skip";
import {
  AIR_TIME,
  ASSIST_POINTS,
  BOT_LEAD,
  CLEAR_POINTS,
  KNOCK_POINTS,
  MAX_OMEGA,
  MIN_OMEGA,
  OVERDRIVE_FLOOR,
  OVERDRIVE_SECONDS,
  STREAK_EVERY,
  SURVIVE_BONUS,
  WHIP_BOOST,
  WHIP_MAX_OMEGA,
  WHIP_SECONDS,
  WHIP_TOTAL,
  angleDelta,
  botBailThreshold,
  botShouldWhip,
  botWantsBail,
  clampOmega,
  clearPoints,
  crossedBottom,
  effectiveOmega,
  hasSafetyNet,
  isClear,
  isCloseCall,
  isOverdrive,
  isStreakMilestone,
  jumpHeight,
  knockVelocity,
  nextBotSegment,
  omegaFloor,
  spinnerOrder,
  surviveReward,
  sweepOutcome,
  timeToBottom,
  whipPhase,
} from "./logic";

describe("rope riot logic", () => {
  it("clamps rope speed so it never stops", () => {
    expect(clampOmega(0)).toBe(MIN_OMEGA);
    expect(clampOmega(100)).toBe(MAX_OMEGA);
    expect(clampOmega(-5)).toBe(5);
  });

  it("detects the rope passing the bottom", () => {
    expect(crossedBottom(3, 3.2)).toBe(true);
    expect(crossedBottom(0, 3)).toBe(false);
    expect(crossedBottom(3.2, 9.3)).toBe(false);
    expect(crossedBottom(9.3, 9.5)).toBe(true);
  });

  it("time to bottom", () => {
    expect(timeToBottom(0, Math.PI)).toBeCloseTo(1);
    expect(timeToBottom(Math.PI, Math.PI)).toBeCloseTo(2);
  });

  it("jump arc clears only mid-air", () => {
    expect(jumpHeight(null)).toBe(0);
    expect(jumpHeight(AIR_TIME / 2)).toBeCloseTo(1);
    expect(isClear(null)).toBe(false);
    expect(isClear(0.005)).toBe(false);
    expect(isClear(BOT_LEAD)).toBe(true);
    expect(isClear(AIR_TIME)).toBe(false);
  });

  it("wraps angle deltas", () => {
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6);
  });

  it("each player spins once (twice in a duel); solo faces the CPU", () => {
    expect(spinnerOrder(1)).toEqual([-1]);
    expect(spinnerOrder(2)).toEqual([0, 1, 0, 1]);
    expect(spinnerOrder(3)).toEqual([0, 1, 2]);
    expect(spinnerOrder(4)).toEqual([0, 1, 2, 3]);
  });

  it("bot segments stay within speed limits and get burstier when pots are juicy", () => {
    const rng = new Rng(3);
    let calm = 0;
    let greedy = 0;
    for (let i = 0; i < 400; i++) {
      const s = nextBotSegment(() => rng.next(), 0);
      expect(s.omega).toBeGreaterThanOrEqual(MIN_OMEGA);
      expect(s.omega).toBeLessThanOrEqual(MAX_OMEGA);
      expect(s.duration).toBeGreaterThan(0);
      if (s.kind === "burst") calm++;
      if (nextBotSegment(() => rng.next(), 1).kind === "burst") greedy++;
    }
    expect(greedy).toBeGreaterThan(calm);
  });

  it("close call is a clear by a hair", () => {
    expect(isCloseCall(null)).toBe(false);
    expect(isCloseCall(AIR_TIME / 2)).toBe(false);
    const t = AIR_TIME * 0.07;
    expect(isClear(t)).toBe(true);
    expect(isCloseCall(t)).toBe(true);
  });

  it("faster rope launches harder", () => {
    const slow = knockVelocity(MIN_OMEGA, () => 0.5);
    const fast = knockVelocity(MAX_OMEGA, () => 0.5);
    expect(fast.vx).toBeGreaterThan(slow.vx);
    expect(fast.vy).toBeLessThan(slow.vy);
  });

  it("streak milestones every STREAK_EVERY clears", () => {
    expect(isStreakMilestone(0)).toBe(false);
    expect(isStreakMilestone(STREAK_EVERY - 1)).toBe(false);
    expect(isStreakMilestone(STREAK_EVERY)).toBe(true);
    expect(isStreakMilestone(STREAK_EVERY * 2)).toBe(true);
  });
});

describe("rope riot pot, overdrive and ghosts", () => {
  it("overdrive doubles clears and raises the rope's floor", () => {
    expect(isOverdrive(OVERDRIVE_SECONDS + 0.1)).toBe(false);
    expect(isOverdrive(OVERDRIVE_SECONDS)).toBe(true);
    expect(clearPoints(10)).toBe(CLEAR_POINTS);
    expect(clearPoints(2)).toBe(CLEAR_POINTS * 2);
    expect(omegaFloor(false)).toBe(MIN_OMEGA);
    expect(omegaFloor(true)).toBe(OVERDRIVE_FLOOR);
    expect(effectiveOmega(MIN_OMEGA, true, 0, 0)).toBe(OVERDRIVE_FLOOR);
  });

  it("a whip grabs the rope down to its floor, then snaps it past the spinner's ceiling", () => {
    expect(whipPhase(0)).toBeNull();
    expect(whipPhase(WHIP_TOTAL)).toBe("grab");
    expect(whipPhase(WHIP_SECONDS)).toBe("snap");
    expect(effectiveOmega(7, false, 1, 0)).toBe(MIN_OMEGA);
    expect(effectiveOmega(7, true, 1, 2)).toBe(OVERDRIVE_FLOOR);
    expect(effectiveOmega(4, false, 0, 1)).toBeCloseTo(4 + WHIP_BOOST);
    expect(effectiveOmega(MAX_OMEGA, false, 0, 1)).toBeGreaterThan(MAX_OMEGA);
    expect(effectiveOmega(MAX_OMEGA, false, 0, 3)).toBe(WHIP_MAX_OMEGA);
  });

  it("a sweep knocks out and hands the pot to the spinner", () => {
    const o = sweepOutcome(7, false);
    expect(o.out).toBe(true);
    expect(o.kept).toBe(0);
    expect(o.spinnerGain).toBe(KNOCK_POINTS + 7);
    expect(sweepOutcome(0, false).spinnerGain).toBe(KNOCK_POINTS);
  });

  it("a safety net turns the first sweep into a stumble that halves the pot", () => {
    const o = sweepOutcome(7, true);
    expect(o.out).toBe(false);
    expect(o.kept).toBe(3);
    expect(o.stolen).toBe(4);
    expect(o.spinnerGain).toBe(4);
  });

  it("surviving banks the pot plus a bonus", () => {
    expect(surviveReward(0)).toBe(SURVIVE_BONUS);
    expect(surviveReward(9)).toBe(9 + SURVIVE_BONUS);
  });

  it("only the trailing seat gets a safety net, never in round one", () => {
    expect(hasSafetyNet([0, 0, 0], 0, 0)).toBe(false);
    expect(hasSafetyNet([5, 5, 5], 1, 1)).toBe(false);
    expect(hasSafetyNet([5, 2, 9], 1, 1)).toBe(true);
    expect(hasSafetyNet([5, 2, 9], 0, 1)).toBe(false);
    expect(hasSafetyNet([2, 2, 9], 0, 2)).toBe(true);
    expect(hasSafetyNet([2, 2, 9], 1, 2)).toBe(true);
    expect(hasSafetyNet([4], 0, 3)).toBe(false);
  });

  it("bots bank once their nerve runs out, more reluctantly in overdrive", () => {
    const rng = new Rng(5);
    for (let i = 0; i < 50; i++) {
      const t = botBailThreshold(() => rng.next());
      expect(t).toBeGreaterThanOrEqual(6);
      expect(t).toBeLessThanOrEqual(13);
    }
    expect(botWantsBail(0, 6, false, () => 0)).toBe(false);
    expect(botWantsBail(5, 6, false, () => 0)).toBe(false);
    expect(botWantsBail(6, 6, false, () => 0)).toBe(true);
    expect(botWantsBail(6, 6, true, () => 0)).toBe(false);
    expect(botWantsBail(10, 6, true, () => 0)).toBe(true);
    expect(botWantsBail(10, 6, false, () => 0.99)).toBe(false);
  });

  it("bot ghosts whip only on the rope's approach with someone grounded", () => {
    expect(botShouldWhip(0.4, 1, () => 0)).toBe(true);
    expect(botShouldWhip(0.4, 0, () => 0)).toBe(false);
    expect(botShouldWhip(0.2, 2, () => 0)).toBe(false);
    expect(botShouldWhip(1.5, 2, () => 0)).toBe(false);
    expect(botShouldWhip(0.4, 1, () => 0.9)).toBe(false);
  });

  it("assist points are a real reward", () => {
    expect(ASSIST_POINTS).toBeGreaterThan(0);
  });
});

describe("rope riot game", () => {
  const makeCtx = (count: number, seed: number) => ({
    width: 1280, height: 720, rng: new Rng(seed), minTap: 44,
    players: Array.from({ length: count }, (_, slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
    canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    input: { justPressed: () => false },
    sfx: new Proxy({}, { get: () => vi.fn() }),
  }) as never;

  it("an all-bot table plays every round to the end within the party window", () => {
    const game = ropeSkip.create(makeCtx(3, 11));
    let frames = 0;
    for (; frames < 60 * 150 && !game.isFinished(); frames++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    const seconds = frames / 60;
    expect(seconds).toBeGreaterThan(3 * 5);
    expect(seconds).toBeLessThan(100);
    const total = game.getScores().reduce((a, s) => a + s.score, 0);
    // Every round ends with pots banked, stolen or survived: points always flow.
    expect(total).toBeGreaterThan(0);
    game.destroy();
  });

  it("a four-seat table finishes in under 100 seconds and hands out stats", () => {
    const game = ropeSkip.create(makeCtx(4, 7));
    let frames = 0;
    for (; frames < 60 * 150 && !game.isFinished(); frames++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    expect(frames / 60).toBeLessThan(100);
    const stats = game.getStats?.() ?? [];
    expect(stats.some((s) => s.label === "Biggest pot banked")).toBe(true);
    expect(stats.some((s) => s.label === "Knockouts as spinner")).toBe(true);
    game.destroy();
  });

  it("solo play is one round against the CPU spinner", () => {
    const game = ropeSkip.create(makeCtx(1, 2));
    let frames = 0;
    for (; frames < 60 * 60 && !game.isFinished(); frames++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    expect(frames / 60).toBeLessThan(30);
    game.destroy();
  });
});

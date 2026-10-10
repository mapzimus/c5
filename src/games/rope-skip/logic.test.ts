import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { ropeSkip } from "./rope-skip";
import {
  AIR_TIME,
  BOT_LEAD,
  MAX_OMEGA,
  MIN_OMEGA,
  angleDelta,
  clampOmega,
  crossedBottom,
  isClear,
  jumpHeight,
  nextBotSegment,
  scoreRound,
  spinnerOrder,
  timeToBottom,
} from "./logic";

describe("rope skip logic", () => {
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

  it("each player spins once; solo faces the CPU", () => {
    expect(spinnerOrder(1)).toEqual([-1]);
    expect(spinnerOrder(3)).toEqual([0, 1, 2]);
  });

  it("scores survivors and spinner knockouts", () => {
    expect(scoreRound(4, 1, [true, false, false, true])).toEqual([0, 2, 1, 0]);
    expect(scoreRound(1, -1, [false])).toEqual([1]);
  });

  it("bot segments stay within speed limits", () => {
    const rng = new Rng(3);
    for (let i = 0; i < 200; i++) {
      const s = nextBotSegment(() => rng.next());
      expect(s.omega).toBeGreaterThanOrEqual(MIN_OMEGA);
      expect(s.omega).toBeLessThanOrEqual(MAX_OMEGA);
      expect(s.duration).toBeGreaterThan(0);
    }
  });
});

describe("rope skip game", () => {
  it("an all-bot table plays every round to the end", () => {
    const ctx = {
      width: 1280, height: 720, rng: new Rng(11), minTap: 44,
      players: [0, 1, 2].map((slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
      canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      input: { justPressed: () => false },
      sfx: new Proxy({}, { get: () => vi.fn() }),
    } as never;
    const game = ropeSkip.create(ctx);
    let frames = 0;
    for (; frames < 60 * 120 && !game.isFinished(); frames++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    expect(frames / 60).toBeGreaterThan(3 * 15);
    const total = game.getScores().reduce((a, s) => a + s.score, 0);
    // Each round hands out exactly one point per jumper (survive or knockout).
    expect(total).toBe(3 * 2);
    game.destroy();
  });
});

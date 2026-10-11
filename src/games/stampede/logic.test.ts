import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { stampede } from "./stampede";
import {
  arrivalTime, BIG_AFTER_S, BOT_CRACK_PANIC, botDecide, crackLimit, difficulty, isNearMiss, LANES, matchWinners,
  NEAR_BONUS, NEAR_S, NEAR_STREAK_CAP, nearMissBonus, occupiedLanes, planWave, riderBotAim, ROUND_S, roundOver,
  STAMPEDE_AFTER_S, STAMPEDE_GAP_S, underdogs,
} from "./logic";

describe("stampede logic", () => {
  it("gets faster, denser and fatter over the round", () => {
    const a = difficulty(0);
    const b = difficulty(ROUND_S / 2);
    const c = difficulty(ROUND_S);
    expect(b.speed).toBeGreaterThan(a.speed);
    expect(c.speed).toBeGreaterThan(b.speed);
    expect(b.interval).toBeLessThan(a.interval);
    expect(c.interval).toBeLessThan(b.interval);
    expect(a.maxCount).toBe(1);
    expect(c.maxCount).toBe(LANES - 1);
    expect(difficulty(99).speed).toBe(c.speed);
  });

  it("thin ice gives way sooner as the round goes on", () => {
    expect(crackLimit(0)).toBeGreaterThan(crackLimit(ROUND_S / 2));
    expect(crackLimit(ROUND_S / 2)).toBeGreaterThan(crackLimit(ROUND_S));
    expect(crackLimit(ROUND_S)).toBeGreaterThan(1.5);
    expect(crackLimit(99)).toBe(crackLimit(ROUND_S));
  });

  it("every wave leaves at least one lane safe and never overlaps itself", () => {
    const rng = new Rng(5);
    for (const t of [0, 3, 7, 11, 15, 20, 24]) {
      for (let i = 0; i < 150; i++) {
        const wave = planWave(t, rng, -Infinity);
        if (wave.stampede) continue;
        const taken = new Set<number>();
        for (const c of wave.critters) {
          if (t < BIG_AFTER_S) expect(c.big).toBe(false);
          for (const l of occupiedLanes(c)) {
            expect(l).toBeGreaterThanOrEqual(0);
            expect(l).toBeLessThan(LANES);
            expect(taken.has(l)).toBe(false);
            taken.add(l);
          }
        }
        expect(wave.critters.length).toBeGreaterThan(0);
        expect(taken.size).toBeLessThan(LANES);
      }
    }
  });

  it("big critters show up after the big threshold", () => {
    const rng = new Rng(8);
    let bigs = 0;
    for (let i = 0; i < 200; i++) bigs += planWave(BIG_AFTER_S + 2, rng, 0).critters.filter((c) => c.big).length;
    expect(bigs).toBeGreaterThan(0);
  });

  it("stampede fills every lane but one, only after the threshold, with a gap between", () => {
    const rng = new Rng(2);
    const wall = planWave(STAMPEDE_AFTER_S + 1, rng, -Infinity);
    expect(wall.stampede).toBe(true);
    expect(wall.critters.length).toBe(LANES - 1);
    expect(new Set(wall.critters.map((c) => c.lane)).size).toBe(LANES - 1);
    expect(wall.critters.every((c) => !c.big)).toBe(true);
    expect(planWave(STAMPEDE_AFTER_S + 1, rng, STAMPEDE_AFTER_S).stampede).toBe(false);
    expect(planWave(STAMPEDE_AFTER_S + 1 + STAMPEDE_GAP_S, rng, STAMPEDE_AFTER_S + 1).stampede).toBe(true);
    expect(planWave(STAMPEDE_AFTER_S - 1, rng, -Infinity).stampede).toBe(false);
  });

  it("computes arrival time in the player's lane only", () => {
    const obs = [{ x: 1000, rx: 50, lanes: [2] }, { x: 100, rx: 50, lanes: [1] }];
    expect(arrivalTime(obs, 2, 200, 30, 360)).toBeCloseTo(2);
    expect(arrivalTime(obs, 3, 200, 30, 360)).toBe(Infinity);
    // The lane-1 critter already went past.
    expect(arrivalTime(obs, 1, 200, 30, 360)).toBe(Infinity);
    expect(arrivalTime([{ x: 210, rx: 50, lanes: [0] }], 0, 200, 30, 360)).toBe(0);
  });

  it("a hop just before impact is a CLOSE call, and the streak bonus is capped", () => {
    const speed = 400;
    const justInTime = [{ x: 200 + 30 + 50 + speed * NEAR_S * 0.5, rx: 50, lanes: [2] }];
    const early = [{ x: 200 + 30 + 50 + speed * NEAR_S * 3, rx: 50, lanes: [2] }];
    expect(isNearMiss(justInTime, 2, 200, 30, speed)).toBe(true);
    expect(isNearMiss(early, 2, 200, 30, speed)).toBe(false);
    expect(isNearMiss(justInTime, 3, 200, 30, speed)).toBe(false);
    expect(nearMissBonus(1)).toBe(NEAR_BONUS);
    expect(nearMissBonus(3)).toBe(NEAR_BONUS * 3);
    expect(nearMissBonus(NEAR_STREAK_CAP + 5)).toBe(NEAR_BONUS * NEAR_STREAK_CAP);
    expect(nearMissBonus(0)).toBe(NEAR_BONUS);
  });

  it("bots hop to the safer neighbour when a critter is close", () => {
    const rng = new Rng(4);
    const far = [{ x: 1200, rx: 50, lanes: [2] }];
    expect(botDecide(2, far, 200, 30, 360, 0.8, rng, 0)).toBeNull();
    const near = [{ x: 420, rx: 50, lanes: [2] }, { x: 500, rx: 50, lanes: [1] }];
    expect(botDecide(2, near, 200, 30, 360, 0.8, rng, 0)).toBe(3);
    const nearTop = [{ x: 420, rx: 50, lanes: [0] }, { x: 380, rx: 50, lanes: [1] }];
    // Only one neighbour, and it's worse than staying.
    expect(botDecide(0, nearTop, 200, 30, 360, 0.8, rng, 0)).toBeNull();
    const choice = botDecide(2, near, 200, 30, 360, 0.8, rng, 1);
    expect(choice === 1 || choice === 3).toBe(true);
  });

  it("bots leave cracking ice for the neighbour hit latest, even with nothing coming", () => {
    const rng = new Rng(9);
    const nothing: { x: number; rx: number; lanes: number[] }[] = [];
    expect(botDecide(2, nothing, 200, 30, 360, 0.8, rng, 0, BOT_CRACK_PANIC - 0.1)).toBeNull();
    const panic = botDecide(2, nothing, 200, 30, 360, 0.8, rng, 0, BOT_CRACK_PANIC);
    expect(panic === 1 || panic === 3).toBe(true);
    const upBad = [{ x: 400, rx: 50, lanes: [1] }, { x: 900, rx: 50, lanes: [3] }];
    expect(botDecide(2, upBad, 200, 30, 360, 0.8, rng, 0, 1)).toBe(3);
    expect(botDecide(0, [{ x: 300, rx: 50, lanes: [1] }], 200, 30, 360, 0.8, rng, 0, 1)).toBe(1);
  });

  it("rider bots hunt the leader among those still standing", () => {
    const rng = new Rng(3);
    expect(riderBotAim([], rng)).toBeNull();
    const targets = [{ lane: 0, score: 4 }, { lane: 3, score: 20 }, { lane: 4, score: 9 }];
    expect(riderBotAim(targets, rng, 0)).toBe(3);
    for (let i = 0; i < 50; i++) expect([0, 3, 4]).toContain(riderBotAim(targets, rng, 1));
  });

  it("gives the underdog shield to whoever trails, never when level", () => {
    expect(underdogs([10, 25, 18])).toEqual([0]);
    expect(underdogs([10, 25, 10])).toEqual([0, 2]);
    expect(underdogs([12, 12])).toEqual([]);
    expect(underdogs([12.4, 12.9])).toEqual([]);
    expect(underdogs([5])).toEqual([]);
  });

  it("a round runs until the clock or until everyone is off the ice", () => {
    const one = [{ alive: true }, { alive: false }, { alive: false }];
    expect(roundOver(one, false)).toBe(false);
    expect(roundOver(one, true)).toBe(true);
    expect(roundOver([{ alive: false }, { alive: false }], false)).toBe(true);
  });

  it("the highest total wins the match, ties share", () => {
    expect(matchWinners([30, 41, 12])).toEqual([1]);
    expect(matchWinners([41, 41, 12])).toEqual([0, 1]);
  });
});

describe("stampede game", () => {
  function play(n: number, seed: number) {
    const ctx = {
      width: 1280, height: 720, rng: new Rng(seed), minTap: 44,
      players: Array.from({ length: n }, (_, slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
      canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      input: { justPressed: () => false },
      sfx: new Proxy({}, { get: () => vi.fn() }),
    } as never;
    const game = stampede.create(ctx);
    let frames = 0;
    for (; frames < 60 * 300 && !game.isFinished(); frames++) game.update(1 / 60);
    return { game, seconds: frames / 60 };
  }

  it("an all-bot table plays to the end inside the party window", () => {
    for (const [n, seed] of [[2, 11], [4, 23]] as const) {
      const { game, seconds } = play(n, seed);
      expect(game.isFinished()).toBe(true);
      expect(seconds).toBeGreaterThan(30);
      expect(seconds).toBeLessThan(100);
      const scores = game.getScores();
      expect(scores.length).toBe(n);
      expect(scores.every((s) => s.score > 0)).toBe(true);
      expect(game.getStats?.().every((s) => s.label === "Close calls")).toBe(true);
      game.destroy();
    }
  });
});

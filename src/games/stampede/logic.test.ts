import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { stampede } from "./stampede";
import {
  arrivalTime, BIG_AFTER_S, botDecide, difficulty, LANES, matchOver, occupiedLanes, planWave,
  roundOver, roundWinners, STAMPEDE_AFTER_S, STAMPEDE_GAP_S,
} from "./logic";

describe("stampede logic", () => {
  it("gets faster, denser and fatter over the round", () => {
    const a = difficulty(0);
    const b = difficulty(20);
    const c = difficulty(45);
    expect(b.speed).toBeGreaterThan(a.speed);
    expect(c.speed).toBeGreaterThan(b.speed);
    expect(b.interval).toBeLessThan(a.interval);
    expect(c.interval).toBeLessThan(b.interval);
    expect(a.maxCount).toBe(1);
    expect(c.maxCount).toBe(LANES - 1);
    expect(difficulty(99).speed).toBe(c.speed);
  });

  it("every wave leaves at least one lane safe and never overlaps itself", () => {
    const rng = new Rng(5);
    for (const t of [0, 5, 12, 19, 25, 40, 44]) {
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

  it("big critters show up after 20s", () => {
    const rng = new Rng(8);
    let bigs = 0;
    for (let i = 0; i < 200; i++) bigs += planWave(25, rng, 0).critters.filter((c) => c.big).length;
    expect(bigs).toBeGreaterThan(0);
  });

  it("stampede fills every lane but one, and only after 30s with a gap between", () => {
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

  it("round ends with the last one standing, at time-out, or when everyone falls", () => {
    const standing = [{ alive: true, fellAt: null }, { alive: false, fellAt: 3 }, { alive: false, fellAt: 7 }];
    expect(roundOver(standing, false)).toBe(true);
    expect(roundWinners(standing, false)).toEqual([0]);
    const two = [{ alive: true, fellAt: null }, { alive: true, fellAt: null }, { alive: false, fellAt: 7 }];
    expect(roundOver(two, false)).toBe(false);
    expect(roundWinners(two, false)).toEqual([]);
    expect(roundWinners(two, true)).toEqual([0, 1]);
    const allOut = [{ alive: false, fellAt: 9 }, { alive: false, fellAt: 12 }, { alive: false, fellAt: 12 }];
    expect(roundOver(allOut, false)).toBe(true);
    expect(roundWinners(allOut, false)).toEqual([1, 2]);
  });

  it("match ends at 2 wins or 5 rounds", () => {
    expect(matchOver([1, 1], 2)).toBe(false);
    expect(matchOver([2, 0], 2)).toBe(true);
    expect(matchOver([1, 1, 1, 1], 5)).toBe(true);
  });
});

describe("stampede game", () => {
  it("an all-bot table plays to the end", () => {
    const ctx = {
      width: 1280, height: 720, rng: new Rng(11), minTap: 44,
      players: [0, 1, 2, 3].map((slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
      canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      input: { justPressed: () => false },
      sfx: new Proxy({}, { get: () => vi.fn() }),
    } as never;
    const game = stampede.create(ctx);
    for (let f = 0; f < 60 * 300 && !game.isFinished(); f++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    const scores = game.getScores();
    expect(scores.some((s) => s.score > 0)).toBe(true);
    expect(Math.max(...scores.map((s) => s.score))).toBeLessThanOrEqual(2);
    expect(game.getStats?.().every((s) => s.label === "Longest survival")).toBe(true);
    game.destroy();
  });
});

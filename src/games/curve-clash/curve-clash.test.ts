import { afterEach, describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import type { GameContext } from "../../core/types";
import { curveClash } from "./curve-clash";
import { ROUNDS } from "./curve-clash-logic";

function context(n: number, seed: number): GameContext {
  return {
    width: 1280,
    height: 720,
    minTap: 60,
    rng: new Rng(seed),
    players: Array.from({ length: n }, (_, slot) => ({
      id: `p${slot}`,
      name: `P${slot}`,
      color: "#3EE0FF",
      kind: "bot",
      slot,
    })),
    canvas: {
      style: {},
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    },
    input: { axis: () => ({ x: 0, y: 0 }) },
    sfx: new Proxy({}, { get: () => vi.fn() }),
  } as unknown as GameContext;
}

describe("curve clash match", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("bots play three rounds to a winner, claiming loops and trapping or haunting rivals", () => {
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => null }),
    });
    vi.stubGlobal("localStorage", undefined);
    let claimed = 0;
    let kills = 0;
    for (const [n, seed] of [
      [2, 1],
      [4, 2],
      [3, 5],
      [4, 9],
    ] as const) {
      const game = curveClash.create(context(n, seed));
      let frames = 0;
      for (; frames < 60 * 60 * 4 && !game.isFinished(); frames++) game.update(1 / 60);
      expect(game.isFinished()).toBe(true);
      // Three rounds plus countdowns and breaks: a party-length match.
      expect(frames / 60).toBeGreaterThan(20);
      expect(frames / 60).toBeLessThan(150);
      const stats = game.getStats?.() ?? [];
      const wins = stats.filter((s) => s.label === "Rounds won").map((s) => Number(s.value));
      expect(wins.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(ROUNDS);
      expect(Math.max(...wins)).toBeGreaterThanOrEqual(1);
      const scores = game.getScores();
      expect(Math.max(...scores.map((s) => s.score))).toBeGreaterThan(0);
      claimed += stats
        .filter((s) => s.label === "Claimed")
        .reduce((a, s) => a + Number.parseInt(s.value, 10), 0);
      kills += stats.filter((s) => s.label === "Kills").reduce((a, s) => a + Number(s.value), 0);
      game.destroy();
    }
    expect(claimed).toBeGreaterThan(0);
    expect(kills).toBeGreaterThan(0);
  }, 60_000);
});

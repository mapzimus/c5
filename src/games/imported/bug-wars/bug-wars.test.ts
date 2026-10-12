import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../../core/rng";
import type { GameContext } from "../../../core/types";
import { bugWars } from "./bug-wars";

function context(count: number, seed: number): GameContext {
  return {
    width: 1280,
    height: 720,
    rng: new Rng(seed),
    minTap: 44,
    players: Array.from({ length: count }, (_, slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
    canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(), getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) },
    input: { consumeClick: () => null, justPressed: () => false, hover: null },
    sfx: new Proxy({}, { get: () => vi.fn() }),
  } as unknown as GameContext;
}

/** Steps a bot-only match to the finish and returns the simulated seconds it took. */
function play(count: number, seed: number): { seconds: number; game: ReturnType<typeof bugWars.create> } {
  const game = bugWars.create(context(count, seed));
  let frames = 0;
  while (!game.isFinished() && frames < 60 * 400) {
    game.update(1 / 60);
    frames += 1;
  }
  expect(game.isFinished()).toBe(true);
  return { seconds: frames / 60, game };
}

describe("Bug Wars party pacing", () => {
  it("a bot table of any size finishes inside the party window", () => {
    for (const count of [2, 3, 4]) {
      const times: number[] = [];
      for (const seed of [3, 11, 29, 47, 101]) times.push(play(count, seed).seconds);
      const mean = times.reduce((a, b) => a + b, 0) / times.length;
      expect(mean, `${count} players: ${times.map((t) => t.toFixed(0)).join(", ")}s`).toBeGreaterThan(35);
      expect(mean, `${count} players: ${times.map((t) => t.toFixed(0)).join(", ")}s`).toBeLessThan(105);
      expect(Math.max(...times)).toBeLessThan(130);
    }
  }, 60_000);

  it("a wiped-out seat comes back as a ghost and stomps", () => {
    const game = bugWars.create(context(4, 5));
    const state = game as unknown as { board: { tiles: { owner: number; bugs: number }[] }; stomps: number[]; eliminatedRound: number[] };
    // Strip seat 3 down to a single lone bug so the bots finish it off early.
    let kept = false;
    for (const tile of state.board.tiles) {
      if (tile.owner !== 3) continue;
      if (!kept) {
        tile.bugs = 1;
        kept = true;
      } else {
        tile.owner = 0;
        tile.bugs = 2;
      }
    }
    let frames = 0;
    while (!game.isFinished() && frames < 60 * 400) {
      game.update(1 / 60);
      frames += 1;
    }
    expect(game.isFinished()).toBe(true);
    expect(state.eliminatedRound[3]).toBeGreaterThanOrEqual(1);
    expect(state.stomps[3]).toBeGreaterThanOrEqual(1);
    expect(game.getStats?.().some((s) => s.playerId === "p3" && s.label === "Ghost stomps")).toBe(true);
    expect(game.getScores()[3]!.score).toBe(0);
    game.destroy();
  }, 30_000);

  it("reports scores for every seat and stats for whoever fought", () => {
    const { game } = play(4, 7);
    const scores = game.getScores();
    expect(scores).toHaveLength(4);
    expect(scores.reduce((sum, s) => sum + s.score, 0)).toBeGreaterThan(0);
    const stats = game.getStats?.() ?? [];
    expect(stats.some((s) => s.label === "Attacks")).toBe(true);
    game.destroy();
  }, 30_000);
});

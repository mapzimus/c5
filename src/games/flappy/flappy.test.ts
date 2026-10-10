import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import type { GameContext } from "../../core/types";
import { flappyRace } from "./flappy";

function context(kinds: ("human" | "bot")[], seed = 7): GameContext {
  return {
    width: 1280, height: 720, rng: new Rng(seed), minTap: 44,
    players: kinds.map((kind, slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind, slot })),
    canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) },
    input: { consumeClick: () => null, justPressed: () => false },
    sfx: new Proxy({}, { get: () => vi.fn() }),
  } as unknown as GameContext;
}

function run(game: { update(dt: number): void; isFinished(): boolean }, seconds: number): number {
  let frames = 0;
  for (; frames < seconds * 60 && !game.isFinished(); frames++) game.update(1 / 60);
  return frames / 60;
}

describe("Sky Dash", () => {
  it("keeps its id and new name", () => {
    expect(flappyRace.id).toBe("flappy-race");
    expect(flappyRace.name).toBe("Sky Dash");
  });

  it("ends quickly when an idle human falls", () => {
    const game = flappyRace.create(context(["human", "human"]));
    expect(run(game, 10)).toBeLessThan(5);
    expect(game.isFinished()).toBe(true);
    game.destroy();
  });

  it("bots fly, collect coins, and the race eventually finishes", () => {
    const game = flappyRace.create(context(["bot", "bot", "bot", "bot"]));
    const t = run(game, 600);
    expect(game.isFinished()).toBe(true);
    expect(t).toBeGreaterThan(5);
    const stats = game.getStats?.() ?? [];
    const gates = stats.filter((s) => s.label === "Gates cleared").map((s) => Number(s.value));
    const coins = stats.filter((s) => s.label === "Coins").map((s) => Number(s.value));
    expect(Math.max(...gates)).toBeGreaterThan(3);
    expect(Math.max(...coins)).toBeGreaterThan(0);
    const scores = game.getScores().map((s) => s.score);
    expect(new Set(scores).size).toBe(4);
    game.destroy();
  }, 60_000);

  it("shield absorbs one hit, ghost passes through gates", () => {
    const game = flappyRace.create(context(["human", "human"]));
    const state = game as any;
    const lane = state.lanes[0];
    const jetX = lane.x + lane.width * 0.3;
    lane.shield = true;
    lane.pipes.push({ x: jetX - 10, gapY: 100, gapH: 10, scored: false, minClear: Infinity, touched: false });
    lane.bird.y = 400;
    lane.bird.vy = 0;
    game.update(1 / 60);
    expect(lane.alive).toBe(true);
    expect(lane.shield).toBe(false);

    lane.grace = 0;
    lane.ghost = 2;
    lane.bird.y = 400;
    lane.bird.vy = -100;
    game.update(1 / 60);
    expect(lane.alive).toBe(true);

    lane.ghost = 0;
    lane.bird.y = 400;
    lane.bird.vy = -100;
    game.update(1 / 60);
    expect(lane.alive).toBe(false);
    game.destroy();
  });

  it("rewards a skim past a gate edge", () => {
    const game = flappyRace.create(context(["human", "human"]));
    const state = game as any;
    const lane = state.lanes[0];
    const jetX = lane.x + lane.width * 0.3;
    lane.pipeTimer = 99;
    lane.pipes.push({ x: jetX - 16 - 52 + 1, gapY: 400, gapH: 100, scored: false, minClear: 3, touched: false });
    lane.bird.y = 400;
    lane.bird.vy = -50;
    game.update(1 / 60);
    expect(lane.gates).toBe(1);
    expect(lane.skims).toBe(1);
    expect(lane.score).toBe(4);
    game.destroy();
  });
});

import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import type { GameContext } from "../../core/types";
import { flappyRace } from "./flappy";
import { LIVES, MATCH_SECONDS, STORM_COOLDOWN, STORM_HIT_POINTS, SURVIVOR_BONUS } from "./logic";

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

function gateAt(jetX: number, extra: Record<string, unknown> = {}) {
  return {
    x: jetX - 16 - 52 + 1, gapY: 400, gapH: 100, scored: false, minClear: 50, touched: false,
    bank: null, passY: null, ...extra,
  };
}

describe("Sky Dash", () => {
  it("keeps its id and name", () => {
    expect(flappyRace.id).toBe("flappy-race");
    expect(flappyRace.name).toBe("Sky Dash");
  });

  it("idle humans burn through their lives and the match ends", () => {
    const game = flappyRace.create(context(["human", "human"]));
    expect(run(game, 30)).toBeLessThan(14);
    expect(game.isFinished()).toBe(true);
    game.destroy();
  });

  it("bots fly a full match inside the party window and bank points", () => {
    for (const [kinds, seed] of [[4, 7], [4, 21], [2, 3], [2, 99]] as const) {
      const game = flappyRace.create(context(Array(kinds).fill("bot"), seed));
      const t = run(game, 200);
      expect(game.isFinished()).toBe(true);
      expect(t).toBeGreaterThan(40);
      expect(t).toBeLessThan(100);
      const stats = game.getStats?.() ?? [];
      const gates = stats.filter((s) => s.label === "Gates cleared").map((s) => Number(s.value));
      expect(Math.max(...gates)).toBeGreaterThan(10);
      const scores = game.getScores().map((s) => s.score);
      expect(Math.max(...scores)).toBeGreaterThan(10);
      game.destroy();
    }
  }, 60_000);

  it("shield absorbs one hit, ghost passes through gates, a bare hit costs a life and the run", () => {
    const game = flappyRace.create(context(["human", "human"]));
    const state = game as any;
    const lane = state.lanes[0];
    const jetX = lane.x + lane.width * 0.3;
    lane.shield = true;
    lane.pipes.push(gateAt(jetX, { x: jetX - 10, gapY: 100, gapH: 10, minClear: Infinity }));
    lane.bird.y = 400;
    lane.bird.vy = 0;
    game.update(1 / 60);
    expect(lane.state).toBe("flying");
    expect(lane.shield).toBe(false);

    lane.grace = 0;
    lane.ghost = 2;
    lane.bird.y = 400;
    lane.bird.vy = -100;
    game.update(1 / 60);
    expect(lane.state).toBe("flying");

    lane.ghost = 0;
    lane.run = 12;
    lane.streak = 7;
    lane.bird.y = 400;
    lane.bird.vy = -100;
    game.update(1 / 60);
    expect(lane.state).toBe("respawning");
    expect(lane.lives).toBe(LIVES - 1);
    expect(lane.run).toBe(0);
    expect(lane.streak).toBe(0);
    game.destroy();
  });

  it("rewards a skim with a multiplier jump and bonus run", () => {
    const game = flappyRace.create(context(["human", "human"]));
    const state = game as any;
    const lane = state.lanes[0];
    const jetX = lane.x + lane.width * 0.3;
    lane.pipeTimer = 99;
    lane.pipes.push(gateAt(jetX, { minClear: 3 }));
    lane.bird.y = 400;
    lane.bird.vy = -50;
    game.update(1 / 60);
    expect(lane.gates).toBe(1);
    expect(lane.skims).toBe(1);
    // Streak jumps to x2, so the gate pays 2 and the skim pays 3 * 2.
    expect(lane.run).toBe(8);
    expect(lane.score).toBe(0);
    game.destroy();
  });

  it("banks the run only through the gold half of a split gate", () => {
    const game = flappyRace.create(context(["human", "human"]));
    const state = game as any;
    const lane = state.lanes[0];
    const jetX = lane.x + lane.width * 0.3;
    lane.pipeTimer = 99;
    lane.run = 10;
    lane.pipes.push(gateAt(jetX, { bank: "top", passY: 380 }));
    lane.bird.y = 400;
    lane.bird.vy = -50;
    game.update(1 / 60);
    expect(lane.score).toBe(11);
    expect(lane.run).toBe(0);
    expect(lane.bestBank).toBe(11);

    lane.pipes = [gateAt(jetX, { bank: "top", passY: 420 })];
    lane.bird.y = 400;
    lane.bird.vy = -50;
    game.update(1 / 60);
    expect(lane.score).toBe(11);
    expect(lane.run).toBe(1);
    game.destroy();
  });

  it("an out player becomes a storm cloud whose thunderhead brings a rival down", () => {
    const game = flappyRace.create(context(["human", "human", "human"]));
    const state = game as any;
    const [cloud, target] = state.lanes;
    cloud.lives = 1;
    cloud.run = 7;
    cloud.bird.y = 5000;
    game.update(1 / 60);
    expect(cloud.state).toBe("out");
    expect(cloud.lives).toBe(0);
    expect(cloud.run).toBe(0);
    expect(state.finished).toBe(false);

    cloud.stormCooldown = 0;
    expect(state.storm(cloud, target)).toBe(true);
    expect(cloud.stormCooldown).toBe(STORM_COOLDOWN);
    expect(target.hazards).toHaveLength(1);
    expect(state.storm(cloud, target)).toBe(false);

    const jetX = target.x + target.width * 0.3;
    target.hazards[0].x = jetX;
    target.hazards[0].y = target.bird.y;
    target.bird.vy = 0;
    game.update(1 / 60);
    expect(target.state).toBe("respawning");
    expect(target.lives).toBe(LIVES - 1);
    expect(cloud.score).toBe(STORM_HIT_POINTS);
    expect(cloud.stormHits).toBe(1);
    expect(state.stormButtons(cloud)).toHaveLength(2);
    game.destroy();
  });

  it("ends early when only one jet has lives left and banks the survivor's run", () => {
    const game = flappyRace.create(context(["human", "human"]));
    const state = game as any;
    const [a, b] = state.lanes;
    a.lives = 1;
    b.run = 9;
    a.bird.y = 5000;
    game.update(1 / 60);
    expect(state.finished).toBe(true);
    expect(b.score).toBe(9 + SURVIVOR_BONUS);
    expect(b.run).toBe(0);
    expect(game.getScores()[0]!.playerId).toBe("p1");
    game.destroy();
  });

  it("drops unbanked runs at the whistle", () => {
    const game = flappyRace.create(context(["bot", "bot"]));
    const state = game as any;
    state.time = MATCH_SECONDS - 0.001;
    const [a, b] = state.lanes;
    a.score = 20;
    a.run = 50;
    b.score = 25;
    game.update(1 / 60);
    expect(state.finished).toBe(true);
    expect(a.run).toBe(0);
    expect(game.getScores().map((s) => s.playerId)).toEqual(["p1", "p0"]);
    game.destroy();
  });
});

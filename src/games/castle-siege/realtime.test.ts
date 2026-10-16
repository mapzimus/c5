import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import type { GameContext } from "../../core/types";
import { CastleSiege } from "./castle-siege";
import { REALTIME_SUDDEN_DEATH_S, TURN_CLOCK_S, realtimeAmmo } from "./rules";
import { SiegeWorld } from "./world";

function botTable(seed: number, kinds: ("bot" | "human")[]): GameContext {
  const canvas = {
    style: { touchAction: "" },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    setPointerCapture: vi.fn(),
  };
  return {
    canvas, width: 1280, height: 720,
    players: kinds.map((kind, i) => ({ id: `p${i}`, name: `P${i}`, color: "#fff", kind, slot: i })),
    rng: new Rng(seed),
    input: {},
    sfx: { go: vi.fn(), tick: vi.fn(), collect: vi.fn(), hit: vi.fn(), miss: vi.fn(), win: vi.fn(), streak: vi.fn(), unlock: vi.fn(), whoosh: vi.fn(), countdown: vi.fn() },
    minTap: 44,
  } as unknown as GameContext;
}

interface Peek {
  phase: string;
  turn: string;
  round: number;
  decree: string;
  shots: [number, number];
  world: { gust: [number, number] };
  teams: { breath: number; blownOff: number }[];
}

describe("turn-based siege match", () => {
  it("bots pick ammo, defenders blow at shots, decrees arrive from round 2, and the match ends", { timeout: 60000 }, () => {
    const game = new CastleSiege(botTable(7, ["bot", "bot"]));
    const g = game as unknown as Peek;
    let blew = false;
    let picked = false;
    const decrees = new Set<string>();
    let frames = 0;
    while (!game.isFinished() && frames < 60 * 240) {
      game.update(1 / 60);
      if (g.world.gust[0]! > 0 || g.world.gust[1]! > 0) blew = true;
      if (g.phase === "siege" && g.turn === "aim") picked = true;
      decrees.add(g.decree);
      frames += 1;
    }
    expect(game.isFinished()).toBe(true);
    expect(frames / 60).toBeLessThan(130);
    expect(blew).toBe(true);
    expect(picked).toBe(true);
    expect(decrees.has("none")).toBe(true);
    expect(decrees.size).toBeGreaterThan(1);
    expect(g.teams.every((t) => t.breath <= 1 && t.breath >= 0)).toBe(true);
  });

  it("fires for a human who dawdles past the turn clock", { timeout: 60000 }, () => {
    const game = new CastleSiege(botTable(3, ["human", "bot"]));
    const g = game as unknown as Peek;
    let frames = 0;
    // Build runs out on its own (the king is auto-placed), then it's the human's pick.
    while (!(g.phase === "siege" && g.turn === "pick") && frames < 60 * 40) {
      game.update(1 / 60);
      frames += 1;
    }
    expect(g.turn).toBe("pick");
    for (let i = 0; i < Math.ceil(TURN_CLOCK_S * 60) + 5; i += 1) game.update(1 / 60);
    expect(g.turn).toBe("flight");
    expect(g.shots[0]).toBe(1);
    game.destroy();
  });
});

describe("real-time siege rules", () => {
  it("rolls normal ammo until sudden death, then only bombs", () => {
    const rng = new Rng(4);
    const early = new Set(Array.from({ length: 300 }, () => realtimeAmmo(rng, 0)));
    expect(early.size).toBeGreaterThan(2);
    const late = new Set(Array.from({ length: 50 }, () => realtimeAmmo(rng, REALTIME_SUDDEN_DEATH_S)));
    expect([...late]).toEqual(["bomb"]);
  });

  it("retires finished balls one at a time", () => {
    const world = new SiegeWorld(new Rng(1));
    world.fire(0, "ball", 20, -5);
    world.fire(1, "ball", -20, -5);
    expect(world.balls).toHaveLength(2);
    world.balls[0]!.body.position.x = -500; // first one flew off-screen
    world.pruneBalls();
    expect(world.balls).toHaveLength(1);
    world.balls[0]!.age = 99;
    world.pruneBalls();
    expect(world.balls).toHaveLength(0);
  });
});

describe("real-time siege match", () => {
  it("two bot teams fire at will and finish a match", { timeout: 60000 }, () => {
    const canvas = {
      style: { touchAction: "" },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
      setPointerCapture: vi.fn(),
    };
    const ctx = {
      canvas, width: 1280, height: 720,
      players: [0, 1].map((i) => ({ id: `p${i}`, name: `P${i}`, color: "#fff", kind: "bot", slot: i })),
      rng: new Rng(11),
      input: {},
      sfx: { go: vi.fn(), tick: vi.fn(), collect: vi.fn(), hit: vi.fn(), miss: vi.fn(), win: vi.fn(), streak: vi.fn(), unlock: vi.fn() },
    } as unknown as GameContext;
    const game = new CastleSiege(ctx, true);
    const shots = { both: false };
    let frames = 0;
    while (!game.isFinished() && frames < 60 * 60 * 6) {
      game.update(1 / 60);
      const rt = (game as unknown as { rt: { reload: number[] } }).rt;
      if (rt.reload[0]! > 0 && rt.reload[1]! > 0) shots.both = true;
      frames += 1;
    }
    expect(shots.both).toBe(true);
    expect(game.isFinished()).toBe(true);
    const scores = game.getScores();
    expect(scores.some((s) => s.score > 0)).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import type { GameContext } from "../../core/types";
import { CastleSiege } from "./castle-siege";
import { REALTIME_SUDDEN_DEATH_S, realtimeAmmo } from "./rules";
import { SiegeWorld } from "./world";

describe("real-time siege rules", () => {
  it("rolls normal ammo until sudden death, then only bombs", () => {
    const rng = new Rng(4);
    const early = new Set(Array.from({ length: 300 }, () => realtimeAmmo(rng, 0)));
    expect(early.size).toBeGreaterThan(2);
    const late = new Set(Array.from({ length: 50 }, () => realtimeAmmo(rng, REALTIME_SUDDEN_DEATH_S)));
    expect([...late]).toEqual(["bomb"]);
  });

  it("retires finished balls one at a time", () => {
    const world = new SiegeWorld();
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
  it("two bot teams fire at will and finish a match", () => {
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

import { describe, it, expect } from "vitest";
import { botChooseShot } from "../bot";
import { World, type WorldEvents } from "../world";
import type { MatchPlayer } from "../types";

function noopEvents(): WorldEvents {
  return {
    onHit: () => {},
    onFall: () => {},
    onBumperHit: () => {},
    onWallHit: () => {},
    onPowerUp: () => {},
    onExplode: () => {},
  };
}

function seededRandom(seed = 42): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

function makePlayers(n: number): MatchPlayer[] {
  const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    name: `P${i + 1}`,
    color: "#fff",
    light: "#fff",
    wins: 0,
    kos: 0,
    ownGoals: 0,
    ready: false,
    dir: dirs[i] ?? { x: 0, y: -1 },
    perks: [],
    kind: "human" as const,
    slot: i,
  }));
}

describe("Bot AI", () => {
  it("produces a valid shot with direction and power", () => {
    const rng = seededRandom(100);
    const world = new World(rng, noopEvents());
    world.buildArena("rink", 1.1, 0.75);
    const players = makePlayers(2);
    world.spawnDiscs(players, 1);

    const disc = world.discs[0]!;
    const shot = botChooseShot(world, disc, players, "normal", rng);

    expect(shot).not.toBeNull();
    expect(shot!.power).toBeGreaterThan(0);
    expect(shot!.power).toBeLessThanOrEqual(1.5);
    expect(Math.hypot(shot!.dx, shot!.dy)).toBeGreaterThan(0);
  });

  it("returns null when only one alive disc", () => {
    const rng = seededRandom(200);
    const world = new World(rng, noopEvents());
    world.buildArena("rink", 1.1, 0.75);
    const players = makePlayers(2);
    world.spawnDiscs(players, 1);

    // kill all but one disc
    for (const d of world.discs) {
      if (d.owner !== 0) d.dead = true;
    }

    const disc = world.discs.find((d) => !d.dead)!;
    const shot = botChooseShot(world, disc, players, "easy", rng);
    expect(shot).toBeNull();
  });

  it("produces different results for different difficulty levels", () => {
    const players = makePlayers(2);
    const shots: Record<string, { dx: number; dy: number; power: number } | null> = {};

    for (const diff of ["easy", "normal", "hard"] as const) {
      const rng = seededRandom(300);
      const world = new World(rng, noopEvents());
      world.buildArena("rink", 1.1, 0.75);
      world.spawnDiscs(players, 1);
      const disc = world.discs[0]!;
      shots[diff] = botChooseShot(world, disc, players, diff, rng);
    }

    // At minimum, all should produce valid shots
    expect(shots.easy).not.toBeNull();
    expect(shots.normal).not.toBeNull();
    expect(shots.hard).not.toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { World, type WorldEvents } from "../world";
import type { FallEvent, HitEvent, MatchPlayer } from "../types";

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

describe("World physics", () => {
  it("produces deterministic results from the same seed", () => {
    const results: number[][] = [];
    for (let run = 0; run < 2; run++) {
      const rng = seededRandom(123);
      const world = new World(rng, noopEvents());
      world.buildArena("rink", 1.1, 0.75);
      const players = makePlayers(2);
      world.spawnDiscs(players, 1);

      const d = world.discs[0]!;
      d.vx = 2;
      d.vy = 0.5;
      d.inst = 0;

      for (let i = 0; i < 500; i++) world.step(1 / 180);
      results.push(world.discs.map((dd) => Math.round(dd.x * 1000)));
    }
    expect(results[0]).toEqual(results[1]);
  });

  it("detects edge falls via SDF", () => {
    const falls: FallEvent[] = [];
    const events = noopEvents();
    events.onFall = (e) => falls.push(e);

    const rng = seededRandom(99);
    const world = new World(rng, events);
    world.buildArena("slab", 1.1, 0.75);
    const players = makePlayers(2);
    world.spawnDiscs(players, 1);

    const d = world.discs[0]!;
    d.x = 1.2;
    d.spawnT = 1;

    world.step(1 / 180);
    expect(falls.length).toBeGreaterThan(0);
    expect(d.falling).toBe(true);
  });

  it("settles discs after drag slows them", () => {
    const rng = seededRandom(77);
    const world = new World(rng, noopEvents());
    world.buildArena("rink", 1.1, 0.75);
    const players = makePlayers(2);
    world.spawnDiscs(players, 1);

    const d = world.discs[0]!;
    d.vx = 0.5;
    d.vy = 0;

    for (let i = 0; i < 2000; i++) world.step(1 / 180);

    expect(world.settled()).toBe(true);
    expect(d.vx).toBe(0);
    expect(d.vy).toBe(0);
  });

  it("handles disc-disc collisions", () => {
    const hits: HitEvent[] = [];
    const events = noopEvents();
    events.onHit = (e) => hits.push(e);

    const rng = seededRandom(55);
    const world = new World(rng, events);
    world.buildArena("rink", 1.1, 0.75);
    const players = makePlayers(2);

    world.makeDisc(0, -0.2, 0, players[0]!);
    world.makeDisc(1, 0.2, 0, players[1]!);

    const [a, b] = world.discs;
    a!.spawnT = 1;
    b!.spawnT = 1;
    a!.vx = 3;

    for (let i = 0; i < 200; i++) world.step(1 / 180);

    expect(hits.length).toBeGreaterThan(0);
  });

  it("stopDistance returns a positive value", () => {
    const rng = seededRandom(1);
    const world = new World(rng, noopEvents());
    world.buildArena("rink", 1.1, 0.75);
    expect(world.stopDistance(4)).toBeGreaterThan(0);
    expect(world.stopDistance(0)).toBe(0);
  });
});

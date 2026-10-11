import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { sumoRings } from "./sumo-rings";
import {
  applySteer, BALL_R, BAR_HALF_W, botSteer, collidePair, HAZARDS, inRect, integrate, makeBall, matchOver, MAX_ROUNDS,
  outside, padZones, planHazards, spinnerCollide, startPositions, stick, STICK_MAX,
} from "./logic";

describe("sumo rings logic", () => {
  it("stick gives a unit direction and clamped force", () => {
    expect(stick(100, 100, 100, 100).force).toBe(0);
    const half = stick(100, 100, 100 + STICK_MAX / 2, 100);
    expect(half.force).toBeCloseTo(0.5);
    expect(half.dir.x).toBeCloseTo(1);
    expect(half.dir.y).toBeCloseTo(0);
    const far = stick(0, 0, 0, 1000);
    expect(far.force).toBe(1);
    expect(far.dir.y).toBeCloseTo(1);
  });

  it("steering accelerates, friction slows, speed is capped", () => {
    const b = makeBall(0, 0);
    for (let i = 0; i < 300; i++) {
      applySteer(b, { x: 1, y: 0 }, 1, 1 / 60);
      integrate(b, 1 / 60);
    }
    expect(b.vx).toBeGreaterThan(300);
    expect(b.x).toBeGreaterThan(0);
    const top = b.vx;
    for (let i = 0; i < 120; i++) integrate(b, 1 / 60);
    expect(b.vx).toBeLessThan(top * 0.05);
    // Ice keeps nearly all the speed.
    const ice = makeBall(0, 0);
    ice.vx = 400;
    integrate(ice, 1, 0.93);
    expect(ice.vx).toBeCloseTo(372);
  });

  it("collisions separate the pair and conserve momentum", () => {
    const a = makeBall(0, 0);
    const b = makeBall(60, 0);
    a.vx = 300;
    b.vx = -100;
    const before = a.mass * a.vx + b.mass * b.vx;
    const j = collidePair(a, b, 1);
    expect(j).toBeGreaterThan(0);
    expect(b.x - a.x).toBeGreaterThanOrEqual(2 * BALL_R - 1e-6);
    expect(a.mass * a.vx + b.mass * b.vx).toBeCloseTo(before);
    // Equal masses, fully elastic: velocities swap.
    expect(a.vx).toBeCloseTo(-100);
    expect(b.vx).toBeCloseTo(300);
    // Separating pairs and dead balls don't bounce.
    expect(collidePair(a, b, 1)).toBe(0);
    const c = makeBall(0, 0);
    const d = makeBall(10, 0);
    d.alive = false;
    expect(collidePair(c, d)).toBe(0);
    expect(c.x).toBe(0);
  });

  it("heavier balls shove lighter ones harder", () => {
    const heavy = makeBall(0, 0, 60);
    const light = makeBall(90, 0, 40);
    heavy.vx = 200;
    collidePair(heavy, light, 1);
    expect(light.vx).toBeGreaterThan(200);
    expect(heavy.vx).toBeGreaterThan(0);
  });

  it("the spinner knocks balls off the bar", () => {
    const b = makeBall(100, 5);
    b.vx = 0;
    b.vy = 0;
    expect(spinnerCollide(b, 0, 0, 0, 200)).toBe(true);
    expect(b.y).toBeGreaterThan(BAR_HALF_W);
    expect(b.vy).toBeGreaterThan(300);
    const miss = makeBall(100, 200);
    expect(spinnerCollide(miss, 0, 0, 0, 200)).toBe(false);
    expect(miss.y).toBe(200);
  });

  it("a ball is out once its centre leaves the ring", () => {
    const b = makeBall(0, 0);
    expect(outside(b, 0, 0, 100)).toBe(false);
    b.x = 99;
    expect(outside(b, 0, 0, 100)).toBe(false);
    b.x = 101;
    expect(outside(b, 0, 0, 100)).toBe(true);
  });

  it("start spots sit inside the ring and apart", () => {
    for (const n of [2, 3, 4]) {
      const spots = startPositions(n, 640, 360, 300);
      expect(spots).toHaveLength(n);
      for (const p of spots) expect(Math.hypot(p.x - 640, p.y - 360)).toBeLessThan(300 - BALL_R);
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          expect(Math.hypot(spots[i]!.x - spots[j]!.x, spots[i]!.y - spots[j]!.y)).toBeGreaterThan(2 * BALL_R);
        }
      }
    }
  });

  it("pads: bottom halves for two, corners for four, never overlapping", () => {
    const two = padZones(2, 1280, 720);
    expect(two[0]).toEqual({ x: 0, y: 360, w: 640, h: 360 });
    expect(two[1]).toEqual({ x: 640, y: 360, w: 640, h: 360 });
    const four = padZones(4, 1280, 720);
    expect(four[3]).toEqual({ x: 640, y: 360, w: 640, h: 360 });
    expect(inRect({ x: 10, y: 10 }, four[0]!)).toBe(true);
    expect(inRect({ x: 10, y: 10 }, four[1]!)).toBe(false);
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const a = four[i]!;
        expect(inRect({ x: a.x + a.w / 2, y: a.y + a.h / 2 }, four[j]!)).toBe(false);
      }
    }
  });

  it("bots chase near the centre and retreat near the edge", () => {
    const rng = new Rng(5);
    const me = makeBall(0, 0);
    const foe = makeBall(150, 0);
    let sumX = 0;
    for (let i = 0; i < 40; i++) sumX += botSteer(me, [me, foe], 0, 0, 300, rng).x;
    expect(sumX / 40).toBeGreaterThan(0.5);
    const edge = makeBall(280, 0);
    sumX = 0;
    for (let i = 0; i < 40; i++) sumX += botSteer(edge, [edge, foe], 0, 0, 300, rng).x;
    expect(sumX / 40).toBeLessThan(-0.5);
  });

  it("match ends at 2 wins or 5 rounds; hazards cycle without repeats", () => {
    expect(matchOver([1, 1, 0], 2)).toBe(false);
    expect(matchOver([2, 0], 2)).toBe(true);
    expect(matchOver([1, 1, 1, 1], MAX_ROUNDS)).toBe(true);
    const plan = planHazards(new Rng(2));
    expect(plan).toHaveLength(MAX_ROUNDS);
    expect(new Set(plan.slice(0, 3)).size).toBe(HAZARDS.length);
  });
});

describe("sumo rings game", () => {
  function makeCtx(n: number, seed: number) {
    return {
      width: 1280, height: 720, rng: new Rng(seed), minTap: 44,
      players: Array.from({ length: n }, (_, slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
      canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(), setPointerCapture: vi.fn() },
      input: { justPressed: () => false },
      sfx: new Proxy({}, { get: () => vi.fn() }),
    } as never;
  }

  it("an all-bot table plays to the end with a winner", () => {
    for (const [n, seed] of [[2, 11], [3, 7], [4, 23]] as const) {
      const game = sumoRings.create(makeCtx(n, seed));
      for (let f = 0; f < 60 * 400 && !game.isFinished(); f++) game.update(1 / 60);
      expect(game.isFinished()).toBe(true);
      const scores = game.getScores();
      expect(scores).toHaveLength(n);
      expect(Math.max(...scores.map((s) => s.score))).toBeGreaterThan(0);
      expect(Math.max(...scores.map((s) => s.score))).toBeLessThanOrEqual(2);
      game.destroy();
    }
  });
});

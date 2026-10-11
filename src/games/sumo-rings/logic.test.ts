import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { sumoRings } from "./sumo-rings";
import {
  angleDelta, applySteer, applyTilt, BALL_R, BAR_HALF_W, botSlamAim, botSteer, collidePair, computeTilt, FINAL_MULT,
  ghostTarget, HAZARDS, inRect, integrate, isTap, makeBall, matchOver, MAX_ROUNDS, MAX_SPEED, outside, padZones, planHazards,
  roundMultiplier, SLAM_BRAKE, SLAM_MASS, SLAM_RECHARGE_S, SLAM_S, SLAM_SPEED, spinnerCollide, startPositions, startSlam, stick,
  STICK_MAX, TAP_MAX_PX, TAP_MAX_S, tickSlam, TILT_ACCEL, turnToward, underdogs,
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

  it("a short still press is a tap, a drag or a hold is not", () => {
    expect(isTap(0.1, 3)).toBe(true);
    expect(isTap(TAP_MAX_S + 0.1, 3)).toBe(false);
    expect(isTap(0.1, TAP_MAX_PX + 5)).toBe(false);
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

  it("a slam needs a full charge, bursts past the speed cap, adds mass, then recharges", () => {
    const b = makeBall(0, 0);
    expect(b.slam).toBe(1);
    expect(startSlam(b, { x: 0, y: 0 })).toBe(false);
    expect(startSlam(b, { x: 2, y: 0 })).toBe(true);
    expect(b.vx).toBeCloseTo(SLAM_SPEED);
    expect(b.mass).toBeCloseTo(BALL_R * BALL_R * SLAM_MASS);
    expect(b.slam).toBe(0);
    expect(startSlam(b, { x: 1, y: 0 })).toBe(false);
    // While slamming the cap is lifted; afterwards it clamps back and the mass drops.
    integrate(b, 1 / 120);
    expect(b.vx).toBeGreaterThan(600);
    tickSlam(b, SLAM_S);
    expect(b.slamming).toBe(0);
    expect(b.mass).toBe(BALL_R * BALL_R);
    integrate(b, 1 / 120);
    expect(b.vx).toBeLessThanOrEqual(MAX_SPEED);
    expect(b.vx).toBeLessThanOrEqual(SLAM_SPEED * SLAM_BRAKE);
    tickSlam(b, SLAM_RECHARGE_S / 2);
    expect(b.slam).toBeCloseTo(0.5);
    tickSlam(b, SLAM_RECHARGE_S);
    expect(b.slam).toBe(1);
    const dead = makeBall(0, 0);
    dead.alive = false;
    expect(startSlam(dead, { x: 1, y: 0 })).toBe(false);
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

  it("the ring tips toward the weight: opposite weights cancel, a crowd tips it, rim riders weigh in", () => {
    const flat = computeTilt([{ x: 100, y: 0, w: 1 }, { x: -100, y: 0, w: 1 }], 0, 0, 100, 2);
    expect(flat.x).toBeCloseTo(0);
    expect(flat.y).toBeCloseTo(0);
    const crowd = computeTilt([{ x: 60, y: 0, w: 1 }, { x: 60, y: 0, w: 1 }], 0, 0, 100, 2);
    expect(crowd.x).toBeCloseTo(0.6);
    expect(crowd.y).toBeCloseTo(0);
    // Capped at a unit vector.
    const heavy = computeTilt([{ x: 0, y: 100, w: 5 }, { x: 0, y: 100, w: 5 }], 0, 0, 100, 2);
    expect(Math.hypot(heavy.x, heavy.y)).toBeCloseTo(1);
    expect(heavy.y).toBeCloseTo(1);
    // More seats, same crowd: a gentler lean.
    const four = computeTilt([{ x: 60, y: 0, w: 1 }, { x: 60, y: 0, w: 1 }], 0, 0, 100, 4);
    expect(four.x).toBeCloseTo(0.3);
    // Sliding downhill.
    const b = makeBall(0, 0);
    applyTilt(b, { x: 0, y: 0.5 }, 0.1);
    expect(b.vy).toBeCloseTo(TILT_ACCEL * 0.05);
    expect(b.vx).toBe(0);
    b.alive = false;
    applyTilt(b, { x: 1, y: 0 }, 1);
    expect(b.vx).toBe(0);
  });

  it("rim riders turn the short way round at a capped rate", () => {
    expect(angleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
    expect(turnToward(0, 1, 2, 0.1)).toBeCloseTo(0.2);
    expect(turnToward(0, 0.1, 2, 1)).toBeCloseTo(0.1);
    expect(turnToward(0, -3, 2, 0.1)).toBeCloseTo(-0.2);
    // Ghosts sit under the points leader.
    const a = makeBall(100, 0);
    const b = makeBall(0, -100);
    expect(ghostTarget([a, b], [1, 3], 0, 0)).toBeCloseTo(-Math.PI / 2);
    expect(ghostTarget([a, b], [2, 2], 0, 0)).toBeCloseTo(0); // level points, same distance: first seat
    b.alive = false;
    expect(ghostTarget([a, b], [0, 9], 0, 0)).toBeCloseTo(0);
    a.alive = false;
    expect(ghostTarget([a, b], [0, 9], 0, 0)).toBeNull();
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

  it("bots chase near the centre, retreat near the edge, and lean uphill", () => {
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
    // Tilted downhill toward +y while sitting near the edge: steer uphill (-y).
    let sumY = 0;
    for (let i = 0; i < 40; i++) sumY += botSteer(edge, [edge, foe], 0, 0, 300, rng, 0.7, { x: 0, y: 1 }).y;
    expect(sumY / 40).toBeLessThan(-0.5);
  });

  it("bots slam only at a lined-up target from a safe spot, unless reckless", () => {
    const me = makeBall(0, 0);
    const foe = makeBall(150, 10);
    const aim = botSlamAim(me, [me, foe], { x: 1, y: 0 }, 0, 0, 300);
    expect(aim).not.toBeNull();
    expect(aim!.x).toBeGreaterThan(0.9);
    expect(botSlamAim(me, [me, foe], { x: -1, y: 0 }, 0, 0, 300)).toBeNull();
    me.slam = 0.5;
    expect(botSlamAim(me, [me, foe], { x: 1, y: 0 }, 0, 0, 300)).toBeNull();
    me.slam = 1;
    // Near the edge the slam would land in the void: only a reckless bot fires.
    const edge = makeBall(200, 0);
    const prey = makeBall(290, 0);
    expect(botSlamAim(edge, [edge, prey], { x: 1, y: 0 }, 0, 0, 300)).toBeNull();
    expect(botSlamAim(edge, [edge, prey], { x: 1, y: 0 }, 0, 0, 300, true)).not.toBeNull();
    // Same spot, aiming back across the ring: safe.
    const inward = makeBall(0, 0);
    expect(botSlamAim(edge, [edge, inward], { x: -1, y: 0 }, 0, 0, 300)).not.toBeNull();
  });

  it("four rounds, double points in the final, underdogs get the heavy ball", () => {
    expect(MAX_ROUNDS).toBe(4);
    expect(matchOver(3)).toBe(false);
    expect(matchOver(4)).toBe(true);
    expect(roundMultiplier(0)).toBe(1);
    expect(roundMultiplier(MAX_ROUNDS - 1)).toBe(FINAL_MULT);
    expect(underdogs([3, 1, 1, 5])).toEqual([1, 2]);
    expect(underdogs([2, 2])).toEqual([]);
    expect(underdogs([])).toEqual([]);
  });

  it("round 1 is plain, later rounds roll every hazard once", () => {
    const plan = planHazards(new Rng(2));
    expect(plan).toHaveLength(MAX_ROUNDS);
    expect(plan[0]).toBe("none");
    expect(new Set(plan.slice(1)).size).toBe(HAZARDS.length);
    for (const h of plan.slice(1)) expect(HAZARDS).toContain(h);
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

  it("an all-bot table plays four rounds to the end with a winner in under 100s", () => {
    for (const [n, seed] of [[2, 11], [3, 7], [4, 23], [4, 99]] as const) {
      const game = sumoRings.create(makeCtx(n, seed));
      let frames = 0;
      for (; frames < 60 * 400 && !game.isFinished(); frames++) game.update(1 / 60);
      expect(game.isFinished()).toBe(true);
      expect(frames / 60).toBeLessThan(100);
      const scores = game.getScores();
      expect(scores).toHaveLength(n);
      expect(Math.max(...scores.map((s) => s.score))).toBeGreaterThan(0);
      const stats = game.getStats!();
      expect(stats.filter((s) => s.label === "Bump-offs")).toHaveLength(n);
      game.destroy();
    }
  });
});

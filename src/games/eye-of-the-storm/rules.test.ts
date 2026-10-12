import { describe, expect, it } from "vitest";
import { Rng } from "../../core/rng";
import { PUCK_RADIUS, applyBlast, isResting, previewPath, stepWorld, type Puck, type World } from "./physics";
import {
  BOLT_MARGIN,
  BOLT_MIN_DRAG,
  BOLT_POWER,
  BOLT_RADIUS,
  CELL_RADIUS,
  HEAVY_LAUNCH,
  HEAVY_MASS,
  HEAVY_RADIUS,
  MAX_LAUNCH_SPEED,
  MAX_PULL,
  NEAR_MISS_PX,
  PAD_RADIUS,
  RINGS,
  TAP_MAX_S,
  boltTargetFromDrag,
  botAimAround,
  botBoltTarget,
  botPickShot,
  botRelease,
  isNearMiss,
  isTap,
  launchVelocity,
  padPositions,
  placeCell,
  ringPoints,
  scatterPegs,
  scoreBoard,
  streakLabel,
  touchesCell,
  underdogs,
} from "./rules";

const W = 1280;
const H = 720;
const center = { x: W / 2, y: H / 2 };

function puck(owner: string, x: number, y: number, vx = 0, vy = 0, mass = 1): Puck {
  return { id: Math.random(), owner, x, y, vx, vy, r: mass > 1 ? HEAVY_RADIUS : PUCK_RADIUS, mass };
}

function world(pucks: Puck[], spin = 0): World {
  return { width: W, height: H, pucks, pegs: [], swirl: { ...center, radius: 300, spin } };
}

function settle(w: World, rng?: Rng): void {
  for (let i = 0; i < 60 * 10 && !w.pucks.every(isResting); i += 1) {
    stepWorld(w, 1 / 60, rng ? () => rng.float(-1, 1) : undefined);
  }
}

describe("eye of the storm rules", () => {
  it("scores the best ring a puck sits in", () => {
    expect(ringPoints(center.x, center.y, center)).toBe(10);
    expect(ringPoints(center.x + RINGS[1].radius - 1, center.y, center)).toBe(5);
    expect(ringPoints(center.x, center.y + RINGS[2].radius - 1, center)).toBe(2);
    expect(ringPoints(0, 0, center)).toBe(0);
  });

  it("totals every owner, including players with nothing on the board", () => {
    const scores = scoreBoard([puck("a", center.x, center.y), puck("a", center.x + 60, center.y)], ["a", "b"], center);
    expect(scores.get("a")).toBe(15);
    expect(scores.get("b")).toBe(0);
  });

  it("fires opposite the pull, caps power and launches heavy pucks a little slower", () => {
    const pad = { x: 100, y: 100 };
    expect(launchVelocity(pad, { x: 95, y: 100 })).toBeNull();
    const v = launchVelocity(pad, { x: 100 - MAX_PULL * 3, y: 100 })!;
    expect(v.vx).toBeCloseTo(MAX_LAUNCH_SPEED);
    expect(v.vy).toBeCloseTo(0);
    const heavy = launchVelocity(pad, { x: 100 - MAX_PULL * 3, y: 100 }, HEAVY_LAUNCH)!;
    expect(heavy.vx).toBeCloseTo(MAX_LAUNCH_SPEED * HEAVY_LAUNCH);
  });

  it("a full pull from any corner pad stays on the screen", () => {
    for (const pad of padPositions(W, H)) {
      // Pull straight away from the centre: the finger ends up MAX_PULL further into the corner.
      const a = Math.atan2(pad.y - center.y, pad.x - center.x);
      const finger = { x: pad.x + Math.cos(a) * MAX_PULL, y: pad.y + Math.sin(a) * MAX_PULL };
      expect(finger.x).toBeGreaterThan(10);
      expect(finger.x).toBeLessThan(W - 10);
      expect(finger.y).toBeGreaterThan(10);
      expect(finger.y).toBeLessThan(H - 10);
    }
  });

  it("tells a tap from a short drag", () => {
    expect(isTap({ x: 0, y: 0 }, { x: 4, y: 3 }, 0.1)).toBe(true);
    expect(isTap({ x: 0, y: 0 }, { x: 4, y: 3 }, TAP_MAX_S + 0.1)).toBe(false);
    expect(isTap({ x: 0, y: 0 }, { x: 40, y: 0 }, 0.1)).toBe(false);
  });

  it("keeps pegs away from pads and the bullseye", () => {
    const pads = padPositions(W, H);
    for (let seed = 1; seed < 30; seed += 1) {
      for (const peg of scatterPegs(new Rng(seed), W, H, pads)) {
        expect(Math.hypot(peg.x - center.x, peg.y - center.y)).toBeGreaterThan(RINGS[0].radius);
        for (const pad of pads) expect(Math.hypot(peg.x - pad.x, peg.y - pad.y)).toBeGreaterThan(PAD_RADIUS);
      }
    }
  });

  it("a calm bot shot from any corner usually lands on the target", () => {
    const pads = padPositions(W, H);
    let scored = 0;
    let shots = 0;
    const rng = new Rng(7);
    for (const pad of pads) {
      for (let i = 0; i < 10; i += 1) {
        const v = launchVelocity(pad, botRelease(rng, pad, center))!;
        const w = world([puck("bot", pad.x, pad.y, v.vx, v.vy)]);
        settle(w);
        shots += 1;
        if (ringPoints(w.pucks[0]!.x, w.pucks[0]!.y, center) > 0) scored += 1;
      }
    }
    expect(scored / shots).toBeGreaterThan(0.5);
  });

  it("bots steer around a peg parked in their lane", () => {
    const pad = padPositions(W, H)[0]!;
    // A peg a third of the way down the straight line from the pad to the bullseye.
    const peg = { x: pad.x + (center.x - pad.x) * 0.33, y: pad.y + (center.y - pad.y) * 0.33, r: 20 };
    const w: World = { ...world([]), pegs: [peg] };
    let blind = 0;
    let looking = 0;
    const rng = new Rng(5);
    for (let i = 0; i < 40; i += 1) {
      const naive = launchVelocity(pad, botRelease(rng, pad, center))!;
      const aimed = launchVelocity(pad, botAimAround(rng, w, pad, center, center))!;
      if (!previewPath(w, puck("b", pad.x, pad.y, naive.vx, naive.vy), 4).uncertain) blind += 1;
      if (!previewPath(w, puck("b", pad.x, pad.y, aimed.vx, aimed.vy), 4).uncertain) looking += 1;
    }
    expect(looking).toBeGreaterThan(blind);
    expect(looking).toBeGreaterThanOrEqual(30);
  });

  it("bots go heavy at a rival in the eye and otherwise aim light at the centre", () => {
    const rng = new Rng(3);
    const rival = puck("b", center.x + 10, center.y);
    let heavyShots = 0;
    for (let i = 0; i < 40; i += 1) {
      const shot = botPickShot(rng, [rival], "a", center, 2, null);
      if (shot.heavy) {
        heavyShots += 1;
        expect(Math.hypot(shot.target.x - rival.x, shot.target.y - rival.y)).toBeLessThan(1);
      }
    }
    expect(heavyShots).toBeGreaterThan(20);
    expect(botPickShot(rng, [rival], "a", center, 0, null)).toEqual({ target: center, heavy: false });
    expect(botPickShot(rng, [], "a", center, 2, null).target).toEqual(center);
  });

  it("flags a near miss just outside the bullseye", () => {
    expect(isNearMiss(center.x + RINGS[0].radius + NEAR_MISS_PX - 1, center.y, center)).toBe(true);
    expect(isNearMiss(center.x + RINGS[0].radius - 1, center.y, center)).toBe(false);
    expect(isNearMiss(center.x + RINGS[0].radius + NEAR_MISS_PX + 1, center.y, center)).toBe(false);
  });

  it("names bullseye streaks", () => {
    expect(streakLabel(1)).toBe("");
    expect(streakLabel(2)).toBe("DOUBLE BULLSEYE");
    expect(streakLabel(3)).toBe("HAT-TRICK!");
    expect(streakLabel(5)).toBe("ON FIRE x5");
  });

  it("gives the trailing seats an underdog puck, never when everyone is level", () => {
    const bank = new Map([["a", 12], ["b", 3], ["c", 3]]);
    expect(underdogs(bank, ["a", "b", "c"])).toEqual(["b", "c"]);
    expect(underdogs(new Map([["a", 5], ["b", 5]]), ["a", "b"])).toEqual([]);
    expect(underdogs(new Map(), ["a", "b"])).toEqual([]);
  });
});

describe("eye of the storm physics", () => {
  it("pucks slow to a stop and stay inside the walls", () => {
    const w = world([puck("a", 200, 200, 1500, 900)]);
    settle(w);
    const p = w.pucks[0]!;
    expect(isResting(p)).toBe(true);
    expect(p.x).toBeGreaterThanOrEqual(p.r);
    expect(p.x).toBeLessThanOrEqual(W - p.r);
    expect(p.y).toBeGreaterThanOrEqual(p.r);
    expect(p.y).toBeLessThanOrEqual(H - p.r);
  });

  it("a head-on hit knocks the target puck away", () => {
    const target = puck("b", 640, 360);
    const w = world([puck("a", 400, 360, 900, 0), target]);
    settle(w);
    expect(target.x).toBeGreaterThan(700);
  });

  it("a heavy puck bowls a light one further and keeps rolling", () => {
    const lightTarget = puck("b", 640, 360);
    const lightShooter = puck("a", 400, 360, 450, 0);
    const lw = world([lightShooter, lightTarget]);
    settle(lw);
    const heavyTarget = puck("b", 640, 360);
    const heavyShooter = puck("a", 400, 360, 450, 0, HEAVY_MASS);
    const hw = world([heavyShooter, heavyTarget]);
    settle(hw);
    expect(heavyTarget.x).toBeGreaterThan(lightTarget.x);
    expect(heavyShooter.x).toBeGreaterThan(lightShooter.x);
  });

  it("the swirl bends a shot the way it spins, and a heavy puck less", () => {
    const cw = world([puck("a", 340, 300, 700, 0)], 2);
    const ccw = world([puck("a", 340, 300, 700, 0)], -2);
    const heavy = world([puck("a", 340, 300, 700, 0, HEAVY_MASS)], 2);
    settle(cw);
    settle(ccw);
    settle(heavy);
    expect(cw.pucks[0]!.y).toBeGreaterThan(ccw.pucks[0]!.y);
    expect(heavy.pucks[0]!.y).toBeLessThan(cw.pucks[0]!.y);
    expect(heavy.pucks[0]!.y).toBeGreaterThan(300);
  });

  it("lightning shoves pucks out of the eye, heavy ones less, and leaves far ones alone", () => {
    const light = puck("a", center.x + 20, center.y);
    const heavy = puck("a", center.x, center.y - 20, 0, 0, HEAVY_MASS);
    const far = puck("b", center.x + 400, center.y);
    const w = world([light, heavy, far]);
    const hit = applyBlast(w, center.x, center.y, BOLT_RADIUS, BOLT_POWER, () => 0.3);
    expect(hit).toHaveLength(2);
    expect(far.vx).toBe(0);
    expect(Math.hypot(light.vx, light.vy)).toBeGreaterThan(Math.hypot(heavy.vx, heavy.vy));
    settle(w);
    expect(ringPoints(light.x, light.y, center)).toBeLessThan(10);
    expect(Math.hypot(light.x - center.x, light.y - center.y)).toBeGreaterThan(60);
    expect(Math.hypot(light.x - center.x, light.y - center.y)).toBeLessThan(260);
  });

  it("a puck sitting exactly on the strike point still gets shoved somewhere", () => {
    const p = puck("a", center.x, center.y);
    applyBlast(world([p]), center.x, center.y, BOLT_RADIUS, BOLT_POWER, () => 0.5);
    expect(Math.hypot(p.vx, p.vy)).toBeGreaterThan(100);
  });

  it("the preview follows the real flight when nothing is in the way, and stops at pegs", () => {
    const start = puck("a", 150, 150, 900, 500);
    const w = world([{ ...start }], 1.5);
    const preview = previewPath(w, start, 4);
    expect(preview.uncertain).toBe(false);
    settle(w);
    const end = preview.points[preview.points.length - 1]!;
    expect(Math.hypot(end.x - w.pucks[0]!.x, end.y - w.pucks[0]!.y)).toBeLessThan(8);

    const pegged: World = { ...world([]), pegs: [{ x: 400, y: 300, r: 20 }] };
    const blocked = previewPath(pegged, puck("a", 150, 150, 900, 540), 4);
    expect(blocked.uncertain).toBe(true);
    const last = blocked.points[blocked.points.length - 1]!;
    expect(Math.hypot(last.x - 400, last.y - 300)).toBeLessThan(60);
  });
});

describe("eye of the storm extras", () => {
  it("places storm cells off the bullseye and away from pads and pegs", () => {
    const pads = padPositions(W, H);
    for (let seed = 1; seed < 30; seed += 1) {
      const rng = new Rng(seed);
      const pegs = scatterPegs(rng, W, H, pads);
      const cell = placeCell(rng, W, H, pads, pegs)!;
      expect(cell).not.toBeNull();
      expect(Math.hypot(cell.x - center.x, cell.y - center.y)).toBeGreaterThanOrEqual(RINGS[1].radius);
      for (const pad of pads) expect(Math.hypot(cell.x - pad.x, cell.y - pad.y)).toBeGreaterThan(PAD_RADIUS);
      for (const peg of pegs) expect(Math.hypot(cell.x - peg.x, cell.y - peg.y)).toBeGreaterThan(peg.r + CELL_RADIUS);
    }
  });

  it("detects a puck passing through a cell", () => {
    expect(touchesCell({ x: 100, y: 100 }, { x: 100 + CELL_RADIUS + PUCK_RADIUS - 1, y: 100, r: PUCK_RADIUS })).toBe(true);
    expect(touchesCell({ x: 100, y: 100 }, { x: 100 + CELL_RADIUS + PUCK_RADIUS + 1, y: 100, r: PUCK_RADIUS })).toBe(false);
  });

  it("reports which pucks collided so knockouts can be credited", () => {
    const shooter = puck("a", 590, 360, 900, 0);
    const target = puck("b", 620, 360);
    const events = stepWorld(world([shooter, target]), 1 / 60);
    expect(events.contacts).toHaveLength(1);
    expect(new Set([events.contacts[0]!.a.owner, events.contacts[0]!.b.owner])).toEqual(new Set(["a", "b"]));
  });

  it("a human bolt lands where the finger let go, on the board, after a real drag", () => {
    const pad = { x: 150, y: 150 };
    expect(boltTargetFromDrag(pad, { x: 150 + BOLT_MIN_DRAG - 1, y: 150 }, W, H)).toBeNull();
    expect(boltTargetFromDrag(pad, { x: 640, y: 360 }, W, H)).toEqual({ x: 640, y: 360 });
    expect(boltTargetFromDrag(pad, { x: -50, y: 900 }, W, H)).toEqual({ x: BOLT_MARGIN, y: H - BOLT_MARGIN });
  });

  it("bots zap the rival puck worth the most and spare their own", () => {
    const rng = new Rng(11);
    const rivalEye = puck("b", center.x, center.y);
    const rivalOuter = puck("b", center.x + 150, center.y);
    const target = botBoltTarget(rng, [rivalEye, rivalOuter], "a", center, 0)!;
    expect(target).toEqual({ x: rivalEye.x, y: rivalEye.y });
    // Own puck next to the rival in the eye: a bolt there would cost points, so pick the outer one.
    const mine = puck("a", center.x + 30, center.y);
    const safe = botBoltTarget(rng, [rivalEye, rivalOuter, mine], "a", center, 0)!;
    expect(safe).toEqual({ x: rivalOuter.x, y: rivalOuter.y });
    // Nothing worth zapping: hold the bolt.
    expect(botBoltTarget(rng, [puck("b", 100, 100)], "a", center)).toBeNull();
  });
});

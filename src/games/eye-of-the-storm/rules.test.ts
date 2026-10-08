import { describe, expect, it } from "vitest";
import { Rng } from "../../core/rng";
import { PUCK_RADIUS, isResting, stepWorld, type Puck, type World } from "./physics";
import {
  MAX_LAUNCH_SPEED,
  MAX_PULL,
  CELL_RADIUS,
  PAD_RADIUS,
  RINGS,
  botRelease,
  launchVelocity,
  padPositions,
  placeCell,
  ringPoints,
  scatterPegs,
  scoreBoard,
  touchesCell,
} from "./rules";

const W = 1280;
const H = 720;
const center = { x: W / 2, y: H / 2 };

function puck(owner: string, x: number, y: number, vx = 0, vy = 0): Puck {
  return { id: Math.random(), owner, x, y, vx, vy, r: PUCK_RADIUS };
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

  it("fires opposite the pull and caps power", () => {
    const pad = { x: 100, y: 100 };
    expect(launchVelocity(pad, { x: 95, y: 100 })).toBeNull();
    const v = launchVelocity(pad, { x: 100 - MAX_PULL * 3, y: 100 })!;
    expect(v.vx).toBeCloseTo(MAX_LAUNCH_SPEED);
    expect(v.vy).toBeCloseTo(0);
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

  it("the swirl bends a shot the way it spins", () => {
    const cw = world([puck("a", 340, 300, 700, 0)], 2);
    const ccw = world([puck("a", 340, 300, 700, 0)], -2);
    settle(cw);
    settle(ccw);
    expect(cw.pucks[0]!.y).toBeGreaterThan(ccw.pucks[0]!.y);
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
});

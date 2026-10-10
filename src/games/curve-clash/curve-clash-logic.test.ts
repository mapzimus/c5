import { describe, expect, it } from "vitest";
import { Rng } from "../../core/rng";
import {
  SHRINK_START,
  TrailGrid,
  arenaInset,
  botSteer,
  findPickupSpot,
  matchWinner,
  pickSpawns,
  rayFree,
  skimDistance,
  skimPoints,
  wrapAngle,
  wrapPoint,
} from "./curve-clash-logic";

describe("curve clash logic", () => {
  it("walls and other trails block, own recent trail does not", () => {
    const g = new TrailGrid(100, 100);
    expect(g.blocked(-1, 50, 0, 0, 0.2)).toBe(true);
    expect(g.blocked(50, 50, 0, 0, 0.2)).toBe(false);
    g.paint(50, 50, 2.5, 1, 1);
    expect(g.blocked(50, 50, 0, 1, 0.2)).toBe(true);
    expect(g.blocked(50, 50, 1, 1.1, 0.2)).toBe(false);
    expect(g.blocked(50, 50, 1, 2, 0.2)).toBe(true);
    g.clear();
    expect(g.blocked(50, 50, 0, 1, 0.2)).toBe(false);
  });

  it("raycast stops at a wall of trail", () => {
    const g = new TrailGrid(200, 200);
    for (let y = 0; y < 200; y += 2) g.paint(120, y, 2.5, 1, 0);
    const d = rayFree(g, 20, 100, 0, 180, 0, 5, 0.2);
    expect(d).toBeGreaterThan(90);
    expect(d).toBeLessThan(105);
  });

  it("bot turns away from a wall ahead and goes straight in open space", () => {
    const g = new TrailGrid(800, 800);
    expect(botSteer(g, 400, 400, 0, 0, 0, 0.2)).toBe(0);
    // Heading right toward the right wall, near the bottom: turn left (up).
    expect(botSteer(g, 700, 760, 0, 0, 0, 0.2)).toBe(-1);
  });

  it("spawns stay inside the margin and are spread out", () => {
    const rng = new Rng(7);
    for (let k = 0; k < 20; k++) {
      const s = pickSpawns(4, 1280, 720, () => rng.next());
      for (const p of s) {
        expect(p.x).toBeGreaterThanOrEqual(140);
        expect(p.x).toBeLessThanOrEqual(1140);
        expect(p.y).toBeGreaterThanOrEqual(140);
        expect(p.y).toBeLessThanOrEqual(580);
      }
    }
  });

  it("match winner reaches the target", () => {
    expect(matchWinner([1, 2], 3)).toBe(-1);
    expect(matchWinner([1, 3], 3)).toBe(1);
  });

  it("shrinking walls block rays and positions inside the old arena", () => {
    const g = new TrailGrid(400, 400);
    expect(g.blocked(20, 200, 0, 0, 0.2)).toBe(false);
    g.inset = 50;
    expect(g.blocked(20, 200, 0, 0, 0.2)).toBe(true);
    expect(g.blocked(200, 200, 0, 0, 0.2)).toBe(false);
    expect(rayFree(g, 200, 200, 0, 300, 0, 0, 0.2)).toBeLessThanOrEqual(152);
    // A wall is not a trail.
    expect(g.trailAt(20, 200, 0, 0, 0.2)).toBe(false);
  });

  it("arena starts shrinking late and stops at a small box", () => {
    expect(arenaInset(0, 1280, 720)).toBe(0);
    expect(arenaInset(SHRINK_START, 1280, 720)).toBe(0);
    expect(arenaInset(SHRINK_START + 2, 1280, 720)).toBeGreaterThan(0);
    const max = arenaInset(10_000, 1280, 720);
    expect(max).toBe(720 / 2 - 90);
    expect(720 - max * 2).toBeGreaterThanOrEqual(150);
  });

  it("portal walls wrap points to the opposite side of the (shrunk) arena", () => {
    expect(wrapPoint(-3, 50, 100, 100)).toEqual({ x: 97, y: 50 });
    expect(wrapPoint(50, 104, 100, 100)).toEqual({ x: 50, y: 4 });
    const p = wrapPoint(91, 50, 100, 100, 10);
    expect(p.x).toBeCloseTo(11);
    expect(p.y).toBe(50);
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
  });

  it("pickups spawn on clear ground away from heads", () => {
    const rng = new Rng(3);
    const g = new TrailGrid(400, 400);
    // Fill the left half with trail.
    for (let x = 0; x < 200; x += 3) for (let y = 0; y < 400; y += 3) g.paint(x, y, 2.5, 1, 0);
    for (let k = 0; k < 30; k++) {
      const spot = findPickupSpot(g, () => rng.next(), [{ x: 300, y: 200 }]);
      expect(spot).not.toBeNull();
      expect(spot!.x).toBeGreaterThan(200);
      expect(Math.hypot(spot!.x - 300, spot!.y - 200)).toBeGreaterThanOrEqual(90);
    }
    // Nowhere fits once the walls have closed past the margin.
    g.inset = 180;
    expect(findPickupSpot(g, () => rng.next(), [])).toBeNull();
  });

  it("near miss sees a line just beside the head, not one far away or a wall", () => {
    const g = new TrailGrid(200, 200);
    // Horizontal line at y = 108; head at y = 100 heading right.
    for (let x = 0; x < 200; x += 2) g.paint(x, 108, 2.5, 1, 0);
    const d = skimDistance(g, 100, 100, 0, 0, 5, 0.2);
    expect(d).toBeLessThanOrEqual(7);
    expect(skimPoints(d)).toBe(3);
    expect(skimDistance(g, 100, 70, 0, 0, 5, 0.2)).toBe(Infinity);
    expect(skimPoints(Infinity)).toBe(0);
    // Hugging the wall is not a skim.
    expect(skimDistance(new TrailGrid(200, 200), 100, 3, 0, 0, 0, 0.2)).toBe(Infinity);
    // Own fresh trail does not count.
    const own = new TrailGrid(200, 200);
    for (let x = 0; x < 200; x += 2) own.paint(x, 108, 2.5, 0, 5);
    expect(skimDistance(own, 100, 100, 0, 0, 5.05, 0.2)).toBe(Infinity);
  });

  it("bot heads for a pickup when the way is clear, but not through a line", () => {
    const g = new TrailGrid(800, 800);
    expect(botSteer(g, 400, 400, 0, 0, 0, 0.2, 170, { x: 450, y: 520 })).toBe(1);
    expect(botSteer(g, 400, 400, 0, 0, 0, 0.2, 170, { x: 450, y: 280 })).toBe(-1);
    expect(botSteer(g, 400, 400, 0, 0, 0, 0.2, 170, { x: 600, y: 400 })).toBe(0);
    // A line across the path right below: don't dive at the pickup behind it.
    for (let x = 300; x < 560; x += 2) g.paint(x, 430, 2.5, 1, 0);
    expect(botSteer(g, 400, 400, 0, 0, 0, 0.2, 170, { x: 450, y: 520 })).not.toBe(1);
  });
});

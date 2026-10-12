import { describe, expect, it } from "vitest";
import { Rng } from "../../core/rng";
import {
  EMPTY,
  INK_BASE,
  INK_SECS,
  ROUNDS,
  SHRINK_START,
  SHRINK_START_FINAL,
  TERRITORY_BASE,
  TrailGrid,
  arenaInset,
  botCurl,
  botSteer,
  claimPercent,
  findPickupSpot,
  loopStart,
  matchWinner,
  pickSpawns,
  pointInPolygon,
  polygonArea,
  rayFree,
  roundMultiplier,
  skimDistance,
  skimPoints,
  wraithSteer,
  wrapAngle,
  wrapPoint,
} from "./curve-clash-logic";

describe("curve clash logic", () => {
  it("walls and rival trails block; your own line never does", () => {
    const g = new TrailGrid(100, 100);
    expect(g.blocked(-1, 50, 0, 0)).toBe(true);
    expect(g.blocked(50, 50, 0, 0)).toBe(false);
    g.paint(50, 50, 2.5, 1, 1);
    expect(g.blocked(50, 50, 0, 1)).toBe(true);
    expect(g.blocked(50, 50, 1, 1.1)).toBe(false);
    expect(g.blocked(50, 50, 1, 2)).toBe(false);
    expect(g.hazardAt(50, 50, 0, 2)).toBe(1);
    g.clear();
    expect(g.blocked(50, 50, 0, 1)).toBe(false);
  });

  it("own older line is a loop trigger, the bit right behind the head is not", () => {
    const g = new TrailGrid(100, 100);
    g.paint(50, 50, 2.5, 0, 1);
    expect(g.ownTrailAt(50, 50, 0, 1.05, 0.2)).toBe(false);
    expect(g.ownTrailAt(50, 50, 0, 2, 0.2)).toBe(true);
    expect(g.ownTrailAt(50, 50, 1, 2, 0.2)).toBe(false);
  });

  it("claimed ground kills rivals, not its owner; it overrides lines and rival ground", () => {
    const g = new TrailGrid(100, 100);
    g.paint(50, 50, 2.5, 1, 0);
    const square = [
      { x: 20, y: 20 },
      { x: 80, y: 20 },
      { x: 80, y: 80 },
      { x: 20, y: 80 },
    ];
    const cells = g.fillPolygon(square, TERRITORY_BASE);
    expect(cells).toBeGreaterThan(150);
    expect(cells).toBeLessThan(260);
    expect(g.cellAt(50, 50)).toBe(TERRITORY_BASE);
    expect(g.blocked(50, 50, 0, 5)).toBe(false);
    expect(g.blocked(50, 50, 1, 5)).toBe(true);
    expect(g.hazardAt(50, 50, 1, 5)).toBe(TERRITORY_BASE);
    // Painting over ground does nothing; a later claim steals it.
    g.paint(50, 50, 2.5, 1, 6);
    expect(g.cellAt(50, 50)).toBe(TERRITORY_BASE);
    g.fillPolygon(square, TERRITORY_BASE + 1);
    expect(g.cellAt(50, 50)).toBe(TERRITORY_BASE + 1);
    expect(g.blocked(50, 50, 0, 7)).toBe(true);
    // WIPE removes lines but keeps ground.
    g.paint(10, 10, 2.5, 0, 8);
    g.clearTrails();
    expect(g.cellAt(10, 10)).toBe(EMPTY);
    expect(g.cellAt(50, 50)).toBe(TERRITORY_BASE + 1);
  });

  it("wraith ink kills while fresh, then fades and can be painted over", () => {
    const g = new TrailGrid(100, 100);
    g.paint(50, 50, 2.5, INK_BASE + 2, 10);
    expect(g.hazardAt(50, 50, 0, 10.5)).toBe(INK_BASE + 2);
    expect(g.hazardAt(50, 50, 2, 10.5)).toBe(INK_BASE + 2);
    expect(g.hazardAt(50, 50, 0, 10 + INK_SECS + 0.1)).toBe(EMPTY);
    expect(g.areaFree(50, 50, 4, 10 + INK_SECS + 0.1)).toBe(true);
    g.paint(50, 50, 2.5, 1, 10 + INK_SECS + 0.1);
    expect(g.cellAt(50, 50)).toBe(1);
  });

  it("polygon helpers: area, containment and where a loop closes", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(polygonArea(square)).toBe(100);
    expect(pointInPolygon(square, 5, 5)).toBe(true);
    expect(pointInPolygon(square, 15, 5)).toBe(false);
    // A path that goes out, around and comes back to touch its 5th point.
    const path: { x: number; y: number }[] = [];
    for (let i = 0; i <= 20; i++) path.push({ x: i * 3, y: 0 });
    for (let i = 1; i <= 20; i++) path.push({ x: 60, y: i * 3 });
    for (let i = 1; i <= 20; i++) path.push({ x: 60 - i * 3, y: 60 });
    for (let i = 1; i <= 19; i++) path.push({ x: 0, y: 60 - i * 3 });
    const head = { x: 0, y: 1 };
    const start = loopStart(path, head, 34, 12);
    expect(start).toBe(0);
    // Nothing older within reach: no loop.
    expect(loopStart(path.slice(0, 10), { x: 27, y: 0 }, 34, 12)).toBe(-1);
    expect(claimPercent(576, 57600)).toBe(1);
    expect(claimPercent(5760, 57600)).toBe(10);
    expect(claimPercent(1, 57600)).toBe(1);
    expect(roundMultiplier(1)).toBe(1);
    expect(roundMultiplier(ROUNDS)).toBe(2);
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

  it("bot curls into a loop only while that side is open", () => {
    const g = new TrailGrid(800, 800);
    expect(botCurl(g, 400, 400, 0, 0, 0, 1, 0)).toBe(1);
    expect(botCurl(g, 400, 400, 0, 0, 0, 1, -1)).toBe(-1);
    for (let x = 300; x < 560; x += 2) g.paint(x, 430, 2.5, 1, 0);
    expect(botCurl(g, 400, 400, 0, 0, 0, 1, 0)).toBe(0);
    expect(botCurl(g, 400, 400, 0, 0, 0, -1, 0)).toBe(-1);
  });

  it("wraith heads for where its target will be", () => {
    const target = { x: 500, y: 400, angle: Math.PI / 2 };
    // Target is to the right and moving down: aim below it.
    expect(wraithSteer(400, 400, 0, target, 200, 0.75)).toBe(1);
    expect(wraithSteer(400, 400, 0, { ...target, angle: -Math.PI / 2 }, 200, 0.75)).toBe(-1);
    expect(wraithSteer(400, 400, 0, { x: 600, y: 400, angle: 0 }, 200, 0.75)).toBe(0);
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

  it("match winner has the most points, rounds won break ties", () => {
    expect(matchWinner([120, 95], [1, 2])).toBe(0);
    expect(matchWinner([100, 100], [1, 2])).toBe(1);
    expect(matchWinner([100, 100, 100], [1, 1, 1])).toBe(0);
  });

  it("shrinking walls block rays and positions inside the old arena", () => {
    const g = new TrailGrid(400, 400);
    expect(g.blocked(20, 200, 0, 0)).toBe(false);
    g.inset = 50;
    expect(g.blocked(20, 200, 0, 0)).toBe(true);
    expect(g.blocked(200, 200, 0, 0)).toBe(false);
    expect(rayFree(g, 200, 200, 0, 300, 0, 0, 0.2)).toBeLessThanOrEqual(152);
    // A wall is not a trail.
    expect(g.trailAt(20, 200, 0, 0)).toBe(false);
  });

  it("arena starts shrinking late (early in the final) and stops at a small box", () => {
    expect(arenaInset(0, 1280, 720)).toBe(0);
    expect(arenaInset(SHRINK_START, 1280, 720)).toBe(0);
    expect(arenaInset(SHRINK_START + 2, 1280, 720)).toBeGreaterThan(0);
    expect(arenaInset(SHRINK_START_FINAL + 2, 1280, 720, SHRINK_START_FINAL)).toBeGreaterThan(0);
    expect(arenaInset(SHRINK_START_FINAL + 2, 1280, 720)).toBe(0);
    const max = arenaInset(10_000, 1280, 720);
    expect(max).toBe(720 / 2 - 90);
    expect(720 - max * 2).toBeGreaterThanOrEqual(150);
    // The squeeze is fully closed well inside a 45 s round.
    expect(arenaInset(42, 1280, 720)).toBe(max);
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

  it("pickups spawn on clear ground away from heads and claimed ground", () => {
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
    g.fillPolygon(
      [
        { x: 200, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 400 },
        { x: 200, y: 400 },
      ],
      TERRITORY_BASE,
    );
    expect(findPickupSpot(g, () => rng.next(), [])).toBeNull();
    // Nowhere fits once the walls have closed past the margin.
    g.clear();
    g.inset = 180;
    expect(findPickupSpot(g, () => rng.next(), [])).toBeNull();
  });

  it("near miss sees a rival line just beside the head, not one far away, a wall or your own", () => {
    const g = new TrailGrid(200, 200);
    // Horizontal line at y = 108; head at y = 100 heading right.
    for (let x = 0; x < 200; x += 2) g.paint(x, 108, 2.5, 1, 0);
    const d = skimDistance(g, 100, 100, 0, 0, 5);
    expect(d).toBeLessThanOrEqual(7);
    expect(skimPoints(d)).toBe(3);
    expect(skimDistance(g, 100, 70, 0, 0, 5)).toBe(Infinity);
    expect(skimPoints(Infinity)).toBe(0);
    // Hugging the wall is not a skim.
    expect(skimDistance(new TrailGrid(200, 200), 100, 3, 0, 0, 0)).toBe(Infinity);
    // Your own line does not count (it can't kill you).
    const own = new TrailGrid(200, 200);
    for (let x = 0; x < 200; x += 2) own.paint(x, 108, 2.5, 0, 0);
    expect(skimDistance(own, 100, 100, 0, 0, 5)).toBe(Infinity);
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

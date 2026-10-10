import { describe, expect, it } from "vitest";
import { Rng } from "../../core/rng";
import { TrailGrid, botSteer, matchWinner, pickSpawns, rayFree } from "./curve-clash-logic";

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
});

import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { scribbleRace } from "./scribble-race";
import {
  accuracy, beginTrace, buildPath, catmullRom, feedTrace, generateControls, liftTrace, nearestOnPath,
  newBot, newTrace, pathEnd, pathStart, pointAt, roundScore, stepBot, type Fit, type TracePath,
} from "./logic";

const FIT: Fit = { w: 320, h: 720, padX: 60, padTop: 100, padBottom: 50, tol: 28, startR: 56 };

function makePath(seed: number, points = 5): TracePath {
  return buildPath(generateControls(new Rng(seed), points), FIT);
}

/** Feed the path's own sample points, offset sideways by `off` px. */
function traceAlong(trace: ReturnType<typeof newTrace>, path: TracePath, off: number, step = 4): string {
  let res = "ok";
  for (let s = 0; s <= path.length; s += step) {
    const q = pointAt(path, s);
    const edge = Math.min(1, Math.min(s, path.length - s) / (path.tol * 2));
    res = feedTrace(trace, path, { x: q.x + q.nx * off * edge, y: q.y + q.ny * off * edge });
    if (res !== "ok") return res;
  }
  return res;
}

describe("scribble race paths", () => {
  it("controls alternate sides, run top to bottom and fit the zone", () => {
    for (let seed = 1; seed < 40; seed++) {
      const controls = generateControls(new Rng(seed), 7);
      expect(controls).toHaveLength(7);
      expect(controls[0]!.y).toBe(0);
      expect(controls[6]!.y).toBe(1);
      for (let i = 1; i < controls.length; i++) {
        expect(controls[i]!.y).toBeGreaterThan(controls[i - 1]!.y);
        expect((controls[i]!.x < 0.5) !== (controls[i - 1]!.x < 0.5)).toBe(true);
      }
      const path = buildPath(controls, FIT);
      expect(path.length).toBeGreaterThan(FIT.h - FIT.padTop - FIT.padBottom);
      expect(pathStart(path).y).toBeCloseTo(FIT.padTop);
      expect(pathEnd(path).y).toBeCloseTo(FIT.h - FIT.padBottom);
      for (const p of path.pts) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(FIT.w);
      }
    }
  });

  it("catmull-rom passes through its control points", () => {
    const controls = [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }, { x: 30, y: 9 }];
    const pts = catmullRom(controls, 8);
    expect(pts).toHaveLength(3 * 8 + 1);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[8]).toEqual({ x: 10, y: 5 });
    expect(pts[16]).toEqual({ x: 20, y: 0 });
    expect(pts[24]).toEqual({ x: 30, y: 9 });
  });

  it("pointAt and nearestOnPath agree, and the search window does not skip ahead", () => {
    const path = makePath(5, 7);
    const q = pointAt(path, path.length * 0.4);
    const near = nearestOnPath(path, q, path.length * 0.4, 50, 50);
    expect(near.dist).toBeLessThan(0.01);
    expect(near.s).toBeCloseTo(path.length * 0.4, 1);
    // Searching only the first stretch cannot find a point near the end.
    const end = pathEnd(path);
    const windowed = nearestOnPath(path, end, 0, 10, 40);
    expect(windowed.dist).toBeGreaterThan(path.tol * 3);
  });
});

describe("scribble race tracing", () => {
  it("must start on the START dot", () => {
    const path = makePath(2);
    const t = newTrace();
    const start = pathStart(path);
    expect(beginTrace(t, path, { x: start.x + 200, y: start.y })).toBe(false);
    expect(t.state).toBe("idle");
    expect(beginTrace(t, path, { x: start.x + 10, y: start.y - 5 })).toBe(true);
    expect(t.state).toBe("tracing");
  });

  it("a perfect trace finishes at 100%, a sloppy one scores less", () => {
    const path = makePath(3);
    const perfect = newTrace();
    beginTrace(perfect, path, pathStart(path));
    expect(traceAlong(perfect, path, 0)).toBe("finished");
    expect(perfect.state).toBe("done");
    expect(roundScore(perfect, path)).toBe(100);

    const sloppy = newTrace();
    beginTrace(sloppy, path, pathStart(path));
    expect(traceAlong(sloppy, path, path.tol * 1.5)).toBe("finished");
    const score = roundScore(sloppy, path);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(60);
    expect(accuracy(sloppy)).toBeLessThan(accuracy(perfect));
  });

  it("straying past the outer band scraps the stroke", () => {
    const path = makePath(4);
    const t = newTrace();
    beginTrace(t, path, pathStart(path));
    expect(traceAlong(t, path, path.tol * 3.5)).toBe("scrapped");
    expect(t.state).toBe("idle");
    expect(t.points).toHaveLength(0);
    expect(t.scraps).toBe(1);
    expect(roundScore(t, path)).toBe(0);
  });

  it("lifting early scraps; an unfinished trace scores fraction times accuracy", () => {
    const path = makePath(6);
    const t = newTrace();
    beginTrace(t, path, pathStart(path));
    for (let s = 0; s <= path.length * 0.5; s += 4) {
      const q = pointAt(path, s);
      expect(feedTrace(t, path, { x: q.x, y: q.y })).toBe("ok");
    }
    expect(roundScore(t, path)).toBeGreaterThanOrEqual(49);
    expect(roundScore(t, path)).toBeLessThanOrEqual(51);
    expect(liftTrace(t)).toBe("scrapped");
    expect(liftTrace(t)).toBe("ignored");
    expect(roundScore(t, path)).toBe(0);
  });
});

describe("scribble race bots", () => {
  it("bots finish the path with accuracy near their skill", () => {
    for (const skill of [0.7, 0.82, 0.95]) {
      const accs: number[] = [];
      for (let seed = 1; seed <= 12; seed++) {
        const rng = new Rng(seed * 7);
        const path = makePath(seed, 6);
        const bot = newBot(rng, path, skill);
        const t = newTrace();
        let res = "ok";
        for (let f = 0; f < 60 * 14 && res !== "finished"; f++) {
          const p = stepBot(bot, path, rng, 1 / 60);
          if (!p) continue;
          if (t.state === "idle") expect(beginTrace(t, path, p)).toBe(true);
          else res = feedTrace(t, path, p);
          expect(res).not.toBe("scrapped");
        }
        expect(res).toBe("finished");
        accs.push(accuracy(t));
      }
      const mean = accs.reduce((a, b) => a + b, 0) / accs.length;
      expect(Math.abs(mean - skill)).toBeLessThan(0.12);
    }
  });
});

describe("scribble race game", () => {
  it("an all-bot table plays three rounds to the end", () => {
    const ctx = {
      width: 1280, height: 720, rng: new Rng(11), minTap: 44,
      players: [0, 1, 2, 3].map((slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
      canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      input: { justPressed: () => false },
      sfx: new Proxy({}, { get: () => vi.fn() }),
    } as never;
    const game = scribbleRace.create(ctx);
    for (let f = 0; f < 60 * 120 && !game.isFinished(); f++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    const scores = game.getScores();
    expect(scores).toHaveLength(4);
    for (const s of scores) {
      expect(s.score).toBeGreaterThan(100);
      expect(s.score).toBeLessThanOrEqual(300);
    }
    expect(game.getStats?.().some((s) => s.label === "Best trace %")).toBe(true);
    game.destroy();
  });
});

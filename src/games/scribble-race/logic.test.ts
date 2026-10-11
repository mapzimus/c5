import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { scribbleRace } from "./scribble-race";
import {
  accuracy, beginTrace, blotAlpha, blotLanding, buildPath, catmullRom, feedTrace, finishBonus, generateControls,
  inBlot, liftTrace, nearestOnPath, newBlot, newBot, newTrace, pathEnd, pathStart, pickSmudgeTarget, pointAt,
  roundScore, stepBlots, stepBot, totalRoundScore, wideBrushSeats, BLOT_FADE_S, BLOT_LIFE_S, ROUNDS, ROUND_CONFIG,
  type Fit, type TracePath,
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

  it("rounds escalate: more points, thinner band, and the last round is the Inkstorm", () => {
    expect(ROUND_CONFIG).toHaveLength(ROUNDS);
    for (let i = 1; i < ROUND_CONFIG.length; i++) {
      expect(ROUND_CONFIG[i]!.points).toBeGreaterThan(ROUND_CONFIG[i - 1]!.points);
      expect(ROUND_CONFIG[i]!.tol).toBeLessThan(ROUND_CONFIG[i - 1]!.tol);
    }
    expect(ROUND_CONFIG[ROUNDS - 1]!.title).toBe("INKSTORM");
    expect(ROUND_CONFIG[ROUNDS - 1]!.mult).toBeGreaterThan(1);
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

  it("a perfect trace finishes at 100% with a full streak, a sloppy one scores less", () => {
    const path = makePath(3);
    const perfect = newTrace();
    beginTrace(perfect, path, pathStart(path));
    expect(traceAlong(perfect, path, 0)).toBe("finished");
    expect(perfect.state).toBe("done");
    expect(roundScore(perfect, path)).toBe(100);
    expect(perfect.bestStreak).toBe(perfect.samples);

    const sloppy = newTrace();
    beginTrace(sloppy, path, pathStart(path));
    expect(traceAlong(sloppy, path, path.tol * 1.5)).toBe("finished");
    const score = roundScore(sloppy, path);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(60);
    expect(accuracy(sloppy)).toBeLessThan(accuracy(perfect));
    expect(sloppy.bestStreak).toBeLessThan(perfect.bestStreak);
  });

  it("straying past the outer band scraps the stroke but keeps half its partial", () => {
    const path = makePath(4);
    const t = newTrace();
    beginTrace(t, path, pathStart(path));
    for (let s = 0; s <= path.length * 0.6; s += 4) {
      const q = pointAt(path, s);
      expect(feedTrace(t, path, { x: q.x, y: q.y })).toBe("ok");
    }
    expect(traceAlong(t, path, path.tol * 3.5)).toBe("scrapped");
    expect(t.state).toBe("idle");
    expect(t.points).toHaveLength(0);
    expect(t.scraps).toBe(1);
    expect(t.streak).toBe(0);
    // Ran 60% clean before straying: keeps half of that.
    expect(roundScore(t, path)).toBeGreaterThanOrEqual(26);
    expect(roundScore(t, path)).toBeLessThanOrEqual(31);
  });

  it("coming back from the danger band counts a close call", () => {
    // A straight line, so a sideways offset is measured against the stretch under the finger.
    const path = buildPath([{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }], FIT);
    const t = newTrace();
    beginTrace(t, path, pathStart(path));
    const mid = path.length * 0.5;
    for (let s = 0; s <= mid; s += 4) {
      const q = pointAt(path, s);
      feedTrace(t, path, { x: q.x, y: q.y });
    }
    const q = pointAt(path, mid + 4);
    expect(feedTrace(t, path, { x: q.x + q.nx * path.tol * 2.6, y: q.y + q.ny * path.tol * 2.6 })).toBe("ok");
    expect(t.danger).toBe(true);
    expect(t.closeCalls).toBe(0);
    const q2 = pointAt(path, mid + 8);
    expect(feedTrace(t, path, { x: q2.x, y: q2.y })).toBe("ok");
    expect(t.danger).toBe(false);
    expect(t.closeCalls).toBe(1);
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
    expect(liftTrace(t, path)).toBe("scrapped");
    expect(liftTrace(t, path)).toBe("ignored");
    expect(roundScore(t, path)).toBe(25);
  });

  it("finish bonuses reward the first two in and the Inkstorm multiplies the lot", () => {
    expect(finishBonus(0)).toBe(10);
    expect(finishBonus(1)).toBe(5);
    expect(finishBonus(2)).toBe(0);
    expect(totalRoundScore(80, 0, 1)).toBe(90);
    expect(totalRoundScore(80, null, 1)).toBe(80);
    expect(totalRoundScore(80, 1, 1.5)).toBe(128);
  });

  it("the wide brush goes to whoever is last, and to nobody when level", () => {
    expect(wideBrushSeats([90, 40, 70, 40])).toEqual([false, true, false, true]);
    expect(wideBrushSeats([0, 0])).toEqual([false, false]);
    expect(wideBrushSeats([])).toEqual([]);
  });
});

describe("scribble race smudging", () => {
  it("blots stay wet, then dry away", () => {
    let blots = [newBlot(10, 10, 50, "#fff", 1)];
    expect(blotAlpha(blots[0]!)).toBe(1);
    expect(inBlot(blots, { x: 40, y: 10 })).toBe(true);
    expect(inBlot(blots, { x: 80, y: 10 })).toBe(false);
    blots = stepBlots(blots, BLOT_LIFE_S + BLOT_FADE_S * 0.8);
    expect(blots).toHaveLength(1);
    expect(blotAlpha(blots[0]!)).toBeCloseTo(0.2, 5);
    expect(inBlot(blots, { x: 40, y: 10 })).toBe(false);
    blots = stepBlots(blots, BLOT_FADE_S);
    expect(blots).toHaveLength(0);
  });

  it("a blot lands just ahead of a tracing finger, or mid-path for an idle one", () => {
    const path = makePath(7);
    const rng = new Rng(3);
    const t = newTrace();
    beginTrace(t, path, pathStart(path));
    for (let s = 0; s <= path.length * 0.3; s += 4) {
      const q = pointAt(path, s);
      feedTrace(t, path, { x: q.x, y: q.y });
    }
    const ahead = blotLanding(path, t, rng);
    const near = nearestOnPath(path, ahead, 0, 0, path.length);
    expect(near.dist).toBeLessThan(0.5);
    expect(near.s).toBeGreaterThan(t.progress);
    expect(near.s).toBeLessThan(path.length);
    const idle = blotLanding(path, newTrace(), rng);
    const nearIdle = nearestOnPath(path, idle, 0, 0, path.length);
    expect(nearIdle.s).toBeGreaterThan(path.length * 0.29);
    expect(nearIdle.s).toBeLessThan(path.length * 0.71);
  });

  it("smudgers target the unfinished rival who is winning", () => {
    const seats = [
      { finished: true, score: 90 },
      { finished: false, score: 120 },
      { finished: false, score: 70 },
      { finished: true, score: 200 },
    ];
    expect(pickSmudgeTarget(seats, 0)).toBe(1);
    expect(pickSmudgeTarget(seats, 1)).toBe(2);
    expect(pickSmudgeTarget([{ finished: true, score: 1 }, { finished: true, score: 2 }], 0)).toBe(-1);
  });
});

describe("scribble race bots", () => {
  it("bots finish the path with accuracy near their skill", () => {
    for (const skill of [0.7, 0.82, 0.95]) {
      const accs: number[] = [];
      for (let seed = 1; seed <= 12; seed++) {
        const rng = new Rng(seed * 7);
        const path = makePath(seed, 6);
        const bot = newBot(rng, path, skill, { slips: false });
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

  it("slips make bots fallible and a blot makes them sloppier", () => {
    let closeOrScrap = 0;
    let blindAcc = 0;
    let clearAcc = 0;
    const runs = 16;
    for (let seed = 1; seed <= runs; seed++) {
      const path = makePath(seed, 6);
      for (const blind of [false, true]) {
        const rng = new Rng(seed * 13);
        const bot = newBot(rng, path, 0.85, { slips: !blind });
        const t = newTrace();
        let res = "ok";
        for (let f = 0; f < 60 * 14 && res !== "finished" && res !== "scrapped"; f++) {
          const p = stepBot(bot, path, rng, 1 / 60, blind);
          if (!p) continue;
          if (t.state === "idle") beginTrace(t, path, p);
          else res = feedTrace(t, path, p);
        }
        if (!blind && (res === "scrapped" || t.closeCalls > 0)) closeOrScrap += 1;
        if (blind) blindAcc += accuracy(t);
        else clearAcc += accuracy(t);
      }
    }
    expect(closeOrScrap).toBeGreaterThan(runs * 0.3);
    expect(blindAcc / runs).toBeLessThan(clearAcc / runs - 0.1);
  });
});

describe("scribble race game", () => {
  it("an all-bot table plays four rounds to the end, smudging along the way", () => {
    const ctx = {
      width: 1280, height: 720, rng: new Rng(11), minTap: 44,
      players: [0, 1, 2, 3].map((slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
      canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      input: { justPressed: () => false },
      sfx: new Proxy({}, { get: () => vi.fn() }),
    } as never;
    const game = scribbleRace.create(ctx);
    let frames = 0;
    for (; frames < 60 * 120 && !game.isFinished(); frames++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    expect(frames / 60).toBeGreaterThan(40);
    expect(frames / 60).toBeLessThan(100);
    const scores = game.getScores();
    expect(scores).toHaveLength(4);
    for (const s of scores) {
      expect(s.score).toBeGreaterThan(100);
      expect(s.score).toBeLessThanOrEqual(ROUNDS * 110 * 1.5);
    }
    const stats = game.getStats?.() ?? [];
    expect(stats.some((s) => s.label === "Best trace %")).toBe(true);
    const smudges = stats.filter((s) => s.label === "Smudges thrown").reduce((a, s) => a + Number(s.value), 0);
    expect(smudges).toBeGreaterThan(0);
    game.destroy();
  });
});

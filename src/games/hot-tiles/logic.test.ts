import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import type { GameContext } from "../../core/types";
import { hotTiles } from "./hot-tiles";
import {
  applyRound, botTarget, fallers, finalScores, gridShape, matchingTiles, matchOver, MAX_PLAYS, planBot, planRound,
  resolveShoves, SCARCE_FROM_ROUND, TILE_COLORS, TILE_COUNT, tileAtPoint, tileCenter, tileRect, windowMs,
  type GridLayout,
} from "./logic";

const layout: GridLayout = { x: 40, y: 70, w: 1200, h: 620, cols: 5, rows: 4, gap: 12 };

describe("hot tiles logic", () => {
  it("shrinks the window 0.25s per round down to 0.9s", () => {
    expect(windowMs(0)).toBe(2200);
    expect(windowMs(1)).toBe(1950);
    expect(windowMs(5)).toBe(950);
    expect(windowMs(6)).toBe(900);
    expect(windowMs(20)).toBe(900);
  });

  it("early rounds have 4 tiles of every colour, later rounds only 2-3 of the called one", () => {
    const rng = new Rng(5);
    for (let i = 0; i < 100; i++) {
      const early = planRound(0, rng);
      expect(early.tiles).toHaveLength(TILE_COUNT);
      for (let c = 0; c < TILE_COLORS.length; c++) expect(early.tiles.filter((t) => t === c)).toHaveLength(4);
      expect(matchingTiles(early)).toHaveLength(4);

      const late = planRound(SCARCE_FROM_ROUND, rng);
      expect(late.tiles).toHaveLength(TILE_COUNT);
      const m = matchingTiles(late).length;
      expect(m).toBeGreaterThanOrEqual(2);
      expect(m).toBeLessThanOrEqual(3);
      for (let c = 0; c < TILE_COLORS.length; c++) expect(late.tiles.includes(c)).toBe(true);
    }
  });

  it("maps points to tiles, with gaps and off-grid counting as nothing", () => {
    expect(gridShape(1280, 720)).toEqual({ cols: 5, rows: 4 });
    expect(gridShape(720, 1280)).toEqual({ cols: 4, rows: 5 });
    const c = tileCenter(layout, 7);
    expect(tileAtPoint(layout, c.x, c.y)).toBe(7);
    const r = tileRect(layout, 7);
    expect(tileAtPoint(layout, r.x - 3, c.y)).toBe(-1);
    expect(tileAtPoint(layout, 0, 0)).toBe(-1);
    expect(tileAtPoint(layout, layout.x + layout.w + 5, c.y)).toBe(-1);
    expect(tileAtPoint(layout, tileCenter(layout, 19).x, tileCenter(layout, 19).y)).toBe(19);
  });

  it("shoves overlapping tokens apart and never moves a held one", () => {
    const pts = [{ x: 100, y: 100 }, { x: 110, y: 100 }];
    resolveShoves(pts, 30, [true, false]);
    expect(pts[0]).toEqual({ x: 100, y: 100 });
    expect(pts[1]!.x - pts[0]!.x).toBeCloseTo(60, 5);
    const free = [{ x: 200, y: 200 }, { x: 200, y: 200 }, { x: 500, y: 500 }];
    resolveShoves(free, 20, [false, false, false]);
    const d = Math.hypot(free[0]!.x - free[1]!.x, free[0]!.y - free[1]!.y);
    expect(d).toBeGreaterThanOrEqual(39.9);
    expect(free[2]).toEqual({ x: 500, y: 500 });
  });

  it("drops everyone off the colour, replays when all fall, scores by elimination order", () => {
    const plan = { color: 1, tiles: [1, 0, 0, 1, 2], windowMs: 2000 };
    expect(fallers([0, 1, 3, -1], plan, [true, true, true, true])).toEqual([1, 3]);
    expect(fallers([1, 1, 1, 1], plan, [true, false, true, true])).toEqual([0, 2, 3]);

    const alive = [true, true, true, true];
    const scores = [0, 0, 0, 0];
    expect(applyRound(alive, scores, [0, 1, 2, 3], 0)).toEqual({ outcome: "replay", eliminated: 0 });
    expect(alive).toEqual([true, true, true, true]);
    let e = applyRound(alive, scores, [2], 0).eliminated;
    expect(alive[2]).toBe(false);
    expect(e).toBe(1);
    expect(applyRound(alive, scores, [0, 1, 3], e).outcome).toBe("replay");
    e = applyRound(alive, scores, [0, 1], e).eliminated;
    expect(e).toBe(3);
    expect(matchOver(alive, 3)).toBe(true);
    expect(finalScores(alive, scores, e)).toEqual([1, 1, 0, 3]);
    expect(matchOver([true, true], MAX_PLAYS)).toBe(true);
    expect(matchOver([true, true], 2)).toBe(false);
  });

  it("bots aim at a matching tile after 300-900ms and sometimes go wrong first", () => {
    const rng = new Rng(21);
    const plan = planRound(0, rng);
    let wrong = 0;
    for (let i = 0; i < 300; i++) {
      const bot = planBot(plan, rng);
      expect(bot.delayMs).toBeGreaterThanOrEqual(300);
      expect(bot.delayMs).toBeLessThanOrEqual(900);
      expect(plan.tiles[bot.target]).toBe(plan.color);
      expect(botTarget(bot, bot.delayMs - 1)).toBeNull();
      expect(botTarget(bot, 5000)).toBe(bot.target);
      if (bot.wrongTarget !== null) {
        wrong++;
        expect(plan.tiles[bot.wrongTarget]).not.toBe(plan.color);
        expect(botTarget(bot, bot.delayMs + 1)).toBe(bot.wrongTarget);
      }
    }
    expect(wrong).toBeGreaterThan(10);
    expect(wrong).toBeLessThan(60);
    const short = { ...plan, windowMs: 900 };
    for (let i = 0; i < 20; i++) expect(planBot(short, rng).delayMs).toBeLessThanOrEqual(495.01);
  });
});

function context(width: number, height: number, seed: number, n = 4): GameContext {
  return {
    width, height, rng: new Rng(seed), minTap: 44,
    players: Array.from({ length: n }, (_, slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
    canvas: {
      style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(), setPointerCapture: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    },
    input: { justPressed: () => false },
    sfx: new Proxy({}, { get: () => vi.fn() }),
  } as unknown as GameContext;
}

describe("hot tiles game", () => {
  it("an all-bot table plays to the end in under 90 seconds, landscape and portrait", () => {
    for (const [w, h, seed] of [[1280, 720, 11], [720, 1280, 12], [1280, 720, 99]] as const) {
      const ctx = context(w, h, seed);
      const game = hotTiles.create(ctx);
      let frames = 0;
      for (; frames < 60 * 120 && !game.isFinished(); frames++) game.update(1 / 60);
      expect(game.isFinished()).toBe(true);
      expect(frames / 60).toBeLessThan(90);
      const scores = game.getScores();
      expect(scores).toHaveLength(4);
      expect(Math.max(...scores.map((s) => s.score))).toBeGreaterThan(0);
      expect(game.getStats?.()?.length).toBe(8);
      game.destroy();
      expect((ctx.canvas.removeEventListener as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(4);
    }
  });

  it("registers a touch-only, screen-filling game", () => {
    expect(hotTiles.id).toBe("hot-tiles");
    expect(hotTiles.fillsScreen).toBe(true);
    expect(hotTiles.durationMs).toBe(0);
  });
});

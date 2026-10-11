import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import type { GameContext } from "../../core/types";
import { hotTiles } from "./hot-tiles";
import {
  activeColor, activeHotSpot, applyFalls, botFreezeChance, botTarget, botWrongChance, canCurse, canRevive, cashEmbers, distanceToRect,
  fallers, finalColor, finalScores, gridShape, matchingTiles, matchOver, MAX_PLAYS, nearMiss, planBot, planGhost, planRound,
  resolveShoves, safeTiles, SCARCE_FROM_ROUND, startingLives, stepFuse, SWITCH_BONUS_MS, SWITCH_FROM_ROUND, TILE_COLORS,
  TILE_COUNT, tileAtPoint, tileCenter, tileRect, windowMs, type GridLayout, type RoundPlan,
} from "./logic";

const layout: GridLayout = { x: 40, y: 70, w: 1200, h: 620, cols: 5, rows: 4, gap: 12 };

function plan(color: number, tiles: number[], extra: Partial<RoundPlan> = {}): RoundPlan {
  return { color, tiles, windowMs: 2000, hotSpot: -1, switchAtMs: -1, switchColor: -1, switchHotSpot: -1, ...extra };
}

describe("hot tiles logic", () => {
  it("shrinks the window 0.25s per round down to 0.9s", () => {
    expect(windowMs(0)).toBe(2200);
    expect(windowMs(1)).toBe(1950);
    expect(windowMs(5)).toBe(950);
    expect(windowMs(6)).toBe(900);
    expect(windowMs(20)).toBe(900);
  });

  it("gives duels three lives and bigger tables two", () => {
    expect(startingLives(2)).toBe(3);
    expect(startingLives(3)).toBe(2);
    expect(startingLives(4)).toBe(2);
  });

  it("early rounds have 4 tiles of every colour, later rounds only 2-3 of the called one", () => {
    const rng = new Rng(5);
    for (let i = 0; i < 100; i++) {
      const early = planRound(0, rng);
      expect(early.tiles).toHaveLength(TILE_COUNT);
      for (let c = 0; c < TILE_COLORS.length; c++) expect(early.tiles.filter((t) => t === c)).toHaveLength(4);
      expect(matchingTiles(early)).toHaveLength(4);
      expect(early.hotSpot).toBe(-1);
      expect(early.switchAtMs).toBe(-1);

      const late = planRound(SCARCE_FROM_ROUND, rng);
      expect(late.tiles).toHaveLength(TILE_COUNT);
      const m = matchingTiles(late).length;
      expect(m).toBeGreaterThanOrEqual(2);
      expect(m).toBeLessThanOrEqual(3);
      for (let c = 0; c < TILE_COLORS.length; c++) expect(late.tiles.includes(c)).toBe(true);
      expect(late.tiles[late.hotSpot]).toBe(late.color);
      if (late.switchAtMs >= 0) {
        const m2 = matchingTiles(late, late.switchColor).length;
        expect(m2).toBeGreaterThanOrEqual(2);
        expect(m2).toBeLessThanOrEqual(3);
        expect(late.tiles[late.switchHotSpot]).toBe(late.switchColor);
      }
    }
  });

  it("switched calls change colour part-way, extend the window and move the hot spot", () => {
    const rng = new Rng(8);
    let switched = 0;
    for (let i = 0; i < 200; i++) {
      const p = planRound(SWITCH_FROM_ROUND, rng);
      if (p.switchAtMs < 0) {
        expect(p.windowMs).toBe(windowMs(SWITCH_FROM_ROUND));
        expect(finalColor(p)).toBe(p.color);
        continue;
      }
      switched++;
      expect(p.switchColor).not.toBe(p.color);
      expect(p.windowMs).toBe(windowMs(SWITCH_FROM_ROUND) + SWITCH_BONUS_MS);
      expect(p.switchAtMs).toBeGreaterThan(0);
      expect(p.switchAtMs).toBeLessThan(windowMs(SWITCH_FROM_ROUND) * 0.5 + 1);
      expect(activeColor(p, p.switchAtMs - 1)).toBe(p.color);
      expect(activeColor(p, p.switchAtMs)).toBe(p.switchColor);
      expect(finalColor(p)).toBe(p.switchColor);
      expect(activeHotSpot(p, 0)).toBe(p.hotSpot);
      expect(activeHotSpot(p, p.windowMs)).toBe(p.switchHotSpot);
    }
    expect(switched).toBeGreaterThan(40);
    expect(switched).toBeLessThan(110);
    for (let i = 0; i < 50; i++) expect(planRound(SWITCH_FROM_ROUND - 1, rng).switchAtMs).toBe(-1);
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

  it("spots near misses: a fall within reach of a safe tile's edge", () => {
    const r = tileRect(layout, 7);
    expect(distanceToRect(r, r.x + 5, r.y + 5)).toBe(0);
    expect(distanceToRect(r, r.x - 10, r.y + 5)).toBe(10);
    expect(nearMiss(layout, r.x - 10, r.y + r.h / 2, [7], 20)).toBe(true);
    expect(nearMiss(layout, r.x - 30, r.y + r.h / 2, [7], 20)).toBe(false);
    expect(nearMiss(layout, r.x - 10, r.y + r.h / 2, [], 20)).toBe(false);
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

  it("ghost curses need a fuse and can never remove the last safe tile", () => {
    const p = plan(1, [1, 0, 0, 1, 2]);
    expect(canCurse(p, [false, false, false, false, false], 0)).toBe(true);
    expect(canCurse(p, [true, false, false, false, false], 0)).toBe(false);
    expect(canCurse(p, [true, false, false, false, false], 3)).toBe(false);
    expect(canCurse(p, [false, false, false, false, false], 2)).toBe(true);
    expect(canCurse(p, [], -1)).toBe(false);
    expect(safeTiles(p, [true, false, false, false, false])).toEqual([3]);
    // With a switch coming, both colours must keep a tile.
    const sw = plan(1, [1, 0, 0, 1, 2], { switchAtMs: 500, switchColor: 2 });
    expect(canCurse(sw, [false, false, false, false, false], 4)).toBe(false);
    expect(canCurse(sw, [false, false, false, false, false], 0)).toBe(true);
    expect(safeTiles(sw, [false, false, false, false, false])).toEqual([4]);

    let fuse = 0;
    for (let i = 0; i < 30; i++) fuse = stepFuse(fuse, true, 1 / 60);
    expect(fuse).toBeLessThan(1);
    for (let i = 0; i < 30; i++) fuse = stepFuse(fuse, true, 1 / 60);
    expect(fuse).toBe(1);
    fuse = stepFuse(0.5, false, 0.1);
    expect(fuse).toBeLessThan(0.5);
    expect(stepFuse(0.01, false, 1)).toBe(0);
  });

  it("drops everyone off the colour or on a cursed tile, takes lives, knocks out the last life", () => {
    const p = plan(1, [1, 0, 0, 1, 2]);
    expect(fallers([0, 1, 3, -1], p, [true, true, true, true])).toEqual([1, 3]);
    expect(fallers([1, 1, 1, 1], p, [true, false, true, true])).toEqual([0, 2, 3]);
    expect(fallers([0, 3], p, [true, true], [true, false, false, false, false])).toEqual([0]);
    const sw = plan(1, [1, 0, 0, 1, 2], { switchAtMs: 500, switchColor: 2 });
    expect(fallers([0, 4], sw, [true, true])).toEqual([0]);

    const alive = [true, true, true, true];
    const lives = [2, 2, 2, 2];
    const ranks = [0, 0, 0, 0];
    let res = applyFalls(alive, lives, ranks, [2], 0);
    expect(res).toEqual({ outcome: "continue", eliminated: 0, knockedOut: [] });
    expect(lives).toEqual([2, 2, 1, 2]);
    expect(alive[2]).toBe(true);
    res = applyFalls(alive, lives, ranks, [2, 0], 0);
    expect(res).toEqual({ outcome: "continue", eliminated: 1, knockedOut: [2] });
    expect(alive).toEqual([true, true, false, true]);
    expect(lives).toEqual([1, 2, 0, 2]);
    expect(ranks[2]).toBe(0);
    // Everyone alive on their last life falling together: replay, nothing changes.
    lives[1] = 1;
    lives[3] = 1;
    res = applyFalls(alive, lives, ranks, [0, 1, 3], 1);
    expect(res.outcome).toBe("replay");
    expect(alive).toEqual([true, true, false, true]);
    expect(lives).toEqual([1, 1, 0, 1]);
    res = applyFalls(alive, lives, ranks, [0, 1], 1);
    expect(res).toEqual({ outcome: "continue", eliminated: 3, knockedOut: [0, 1] });
    expect(ranks).toEqual([1, 1, 0, 0]);
    expect(matchOver(alive, 3)).toBe(true);
    expect(matchOver([true, true], MAX_PLAYS)).toBe(true);
    expect(matchOver([true, true], 2)).toBe(false);
  });

  it("ranks survivors by lives then embers, the knocked out by order then hauntings", () => {
    const scores = finalScores([
      { alive: true, lives: 1, embers: 2, hauntings: 0, rank: 0 },
      { alive: true, lives: 2, embers: 0, hauntings: 0, rank: 0 },
      { alive: false, lives: 0, embers: 0, hauntings: 1, rank: 0 },
      { alive: false, lives: 0, embers: 0, hauntings: 0, rank: 0 },
    ]);
    expect(scores[1]).toBeGreaterThan(scores[0]!);
    expect(scores[0]).toBeGreaterThan(scores[2]!);
    expect(scores[2]).toBeGreaterThan(scores[3]!);
    expect(finalScores([{ alive: false, lives: 0, embers: 0, hauntings: 0, rank: 1 }])[0])
      .toBeGreaterThan(finalScores([{ alive: false, lives: 0, embers: 0, hauntings: 9, rank: 0 }])[0]!);
  });

  it("cashes three embers into a life (capped at three lives) and revives ghosts with two hauntings", () => {
    expect(cashEmbers(2, 2)).toEqual({ lives: 2, embers: 2, gained: false });
    expect(cashEmbers(2, 3)).toEqual({ lives: 3, embers: 0, gained: true });
    expect(cashEmbers(3, 3)).toEqual({ lives: 3, embers: 2, gained: false });
    expect(canRevive(2, false, 3)).toBe(true);
    expect(canRevive(1, false, 3)).toBe(false);
    expect(canRevive(2, true, 3)).toBe(false);
    expect(canRevive(2, false, MAX_PLAYS - 2)).toBe(false);
  });

  it("bots aim at a matching tile after 300-900ms, prefer near tiles, and sometimes go wrong first", () => {
    const rng = new Rng(21);
    const p = planRound(0, rng);
    let wrong = 0;
    for (let i = 0; i < 300; i++) {
      const bot = planBot(p, rng);
      expect(bot.delayMs).toBeGreaterThanOrEqual(300);
      expect(bot.delayMs).toBeLessThanOrEqual(900);
      expect(p.tiles[bot.target]).toBe(p.color);
      expect(botTarget(bot, bot.delayMs - 1)).toBeNull();
      expect(botTarget(bot, 5000)).toBe(bot.target);
      if (bot.wrongTarget !== null) {
        wrong++;
        expect(p.tiles[bot.wrongTarget]).not.toBe(p.color);
        expect(botTarget(bot, bot.delayMs + 1)).toBe(bot.wrongTarget);
      }
    }
    expect(wrong).toBeGreaterThan(10);
    expect(wrong).toBeLessThan(60);
    const short = { ...p, windowMs: 900 };
    for (let i = 0; i < 20; i++) expect(planBot(short, rng).delayMs).toBeLessThanOrEqual(495.01);

    // Distances: the nearest matching tile wins most of the time.
    const good = matchingTiles(p);
    const distances = p.tiles.map((_, i) => (i === good[0] ? 0 : 1000));
    let nearest = 0;
    for (let i = 0; i < 100; i++) if (planBot(p, rng, { distances }).target === good[0]) nearest++;
    expect(nearest).toBeGreaterThan(60);
    // Avoided (cursed) tiles are never chosen while another matching tile exists.
    const avoid = p.tiles.map((_, i) => i === good[0] || i === good[1]);
    for (let i = 0; i < 50; i++) expect(avoid[planBot(p, rng, { avoid, distances }).target]).toBe(false);
    // Re-plans after a switch start from `fromMs`, react quickly and never go wrong.
    for (let i = 0; i < 50; i++) {
      const b = planBot(p, rng, { color: (p.color + 1) % 5, fromMs: 800, quick: true });
      expect(b.delayMs).toBeGreaterThanOrEqual(1020);
      expect(b.delayMs).toBeLessThanOrEqual(1400);
      expect(b.wrongTarget).toBeNull();
      expect(p.tiles[b.target]).toBe((p.color + 1) % 5);
    }
    expect(botWrongChance(0)).toBeCloseTo(0.1);
    expect(botWrongChance(10)).toBeCloseTo(0.28);
    expect(botFreezeChance(0)).toBe(0);
    expect(botFreezeChance(1)).toBe(0);
    expect(botFreezeChance(3)).toBeCloseTo(0.06);
    expect(botFreezeChance(20)).toBeCloseTo(0.2);
    // A frozen bot sets off only when the window is nearly gone.
    let frozen = 0;
    for (let i = 0; i < 200; i++) {
      const b = planBot(p, rng, { freezeChance: 0.5 });
      if (b.delayMs > 900) {
        frozen++;
        expect(b.delayMs).toBeGreaterThanOrEqual(p.windowMs * 0.8 - 0.01);
        expect(b.wrongTarget).toBeNull();
      }
    }
    expect(frozen).toBeGreaterThan(60);
    expect(frozen).toBeLessThan(140);
  });

  it("bot ghosts hover then pick the juiciest cursable matching tile", () => {
    const rng = new Rng(3);
    const p = plan(1, [1, 0, 0, 1, 2, 1]);
    const weights = [0, 0, 0, 5, 0, 1];
    let best = 0;
    for (let i = 0; i < 100; i++) {
      const g = planGhost(p, rng, weights, [false, false, false, false, false, false]);
      expect(g).not.toBeNull();
      expect(p.tiles[g!.target]).toBe(1);
      expect(g!.delayMs).toBeGreaterThanOrEqual(440);
      expect(g!.delayMs).toBeLessThanOrEqual(1000);
      if (g!.target === 3) best++;
    }
    expect(best).toBeGreaterThan(60);
    // Only one matching tile left uncursed: nothing to curse.
    expect(planGhost(p, rng, weights, [true, false, false, true, false, false])).toBeNull();
    const late = planGhost(p, rng, weights, [false, false, false, false, false, false], 1000);
    expect(late!.delayMs).toBeGreaterThanOrEqual(1150);
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
  it("an all-bot table plays to the end in 30-95 seconds, landscape and portrait, 2 and 4 players", () => {
    for (const [w, h, seed, n] of [[1280, 720, 11, 4], [720, 1280, 12, 4], [1280, 720, 99, 2], [720, 1280, 7, 2], [1280, 720, 5, 3]] as const) {
      const ctx = context(w, h, seed, n);
      const game = hotTiles.create(ctx);
      let frames = 0;
      for (; frames < 60 * 120 && !game.isFinished(); frames++) game.update(1 / 60);
      expect(game.isFinished()).toBe(true);
      expect(frames / 60).toBeLessThan(95);
      expect(frames / 60).toBeGreaterThan(30);
      const scores = game.getScores();
      expect(scores).toHaveLength(n);
      expect(Math.max(...scores.map((s) => s.score))).toBeGreaterThan(0);
      expect(game.getStats?.()?.length).toBe(n * 3);
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

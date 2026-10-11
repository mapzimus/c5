import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { microMayhem } from "./micro-mayhem";
import {
  BOT_JINX_FACTOR, CatchGame, DodgeGame, HoldGame, MatchGame, MICRO_KINDS, MICROGAMES_PER_MATCH, PopGame, SHAKE_TAPS,
  ShakeGame, StopGame, SwatGame, TINY_SCALE, WAGER_PENALTY, ZONE_HEADER, botWagerChance, heatFor, isOverdrive,
  isSpeedUp, isUnderdog, jinxTransform, limitFor, makeMicrogame, pickJinxTarget, planBot, planOrder, scoreOutcomes,
  scoreRound, tierOf, unjinxPoint, type MicroKind, type Microgame, type Zone,
} from "./logic";

const ZONE: Zone = { x: 320, y: 0, w: 320, h: 720 };
const OPTS = { limit: 4, minTap: 60 };
const PH = ZONE.h - ZONE_HEADER;

function fresh<T extends Microgame>(mg: T, seed = 1, limit = 4): T {
  mg.reset(ZONE, new Rng(seed), { ...OPTS, limit });
  return mg;
}

/** Tap in play-area coords (the game adds the zone offset and header itself). */
function tapAt(mg: Microgame, x: number, y: number): void {
  mg.handle({ type: "down", x: ZONE.x + x, y: ZONE.y + ZONE_HEADER + y, id: 1 });
  mg.handle({ type: "up", x: ZONE.x + x, y: ZONE.y + ZONE_HEADER + y, id: 1 });
}

function run(mg: Microgame, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) mg.update(1 / 60);
}

describe("micro mayhem rules", () => {
  it("orders 15 microgames with no immediate repeats", () => {
    const rng = new Rng(5);
    for (let k = 0; k < 50; k++) {
      const order = planOrder(rng);
      expect(order).toHaveLength(MICROGAMES_PER_MATCH);
      for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]);
      for (const kind of order) expect(MICRO_KINDS).toContain(kind);
    }
  });

  it("ramps the timer every 5 microgames and goes to overdrive for the last 5", () => {
    expect(limitFor(0)).toBe(3.6);
    expect(limitFor(4)).toBe(3.6);
    expect(limitFor(5)).toBe(3.0);
    expect(limitFor(10)).toBe(2.4);
    expect(limitFor(14)).toBe(2.4);
    expect(tierOf(14)).toBe(2);
    expect(isSpeedUp(0)).toBe(false);
    expect(isSpeedUp(5)).toBe(true);
    expect(isSpeedUp(10)).toBe(true);
    expect(isSpeedUp(7)).toBe(false);
    expect(isOverdrive(9)).toBe(false);
    expect(isOverdrive(10)).toBe(true);
  });

  it("scores 1 per success and +1 to the fastest", () => {
    const r = scoreOutcomes([
      { success: true, at: 1.2 },
      { success: false, at: null },
      { success: true, at: 0.8 },
      { success: true, at: 0.8 },
    ]);
    expect(r.points).toEqual([1, 0, 2, 1]);
    expect(r.fastest).toBe(2);
    expect(scoreOutcomes([{ success: false, at: null }]).fastest).toBeNull();
  });

  it("heat climbs x1 -> x2 -> x3 with consecutive wins", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(heatFor)).toEqual([1, 1, 2, 2, 3, 3, 3]);
  });

  it("heat multiplies, DOUBLE doubles, failed wagers cost points unless underdog, overdrive doubles all", () => {
    const seat = (p: Partial<Parameters<typeof scoreRound>[0][number]>) =>
      ({ success: true, at: 1, heat: 1, wagered: false, underdog: false, ...p });
    const r = scoreRound([
      seat({ heat: 3, at: 1.0 }),
      seat({ heat: 2, wagered: true, at: 0.5 }),
      seat({ success: false, at: null, wagered: true }),
      seat({ success: false, at: null, wagered: true, underdog: true }),
    ], false);
    expect(r.fastest).toBe(1);
    expect(r.deltas).toEqual([3, 5, -WAGER_PENALTY, 0]);
    const od = scoreRound([seat({ heat: 2, wagered: true }), seat({ success: false, at: null, wagered: true })], true);
    expect(od.deltas).toEqual([10, -WAGER_PENALTY * 2]);
    expect(scoreRound([seat({ success: false, at: null })], true).deltas).toEqual([0]);
  });

  it("JINX punches up: the fastest hexes the best-scoring rival at or above them", () => {
    expect(pickJinxTarget([5, 2, 7, 3], 1)).toBe(2);
    expect(pickJinxTarget([5, 2, 7, 3], 2)).toBeNull();
    expect(pickJinxTarget([5, 5], 0)).toBe(1);
    expect(pickJinxTarget([5, 4], 0)).toBeNull();
    expect(pickJinxTarget([3, 9, 9], 0)).toBe(1);
  });

  it("the underdog is last and well behind", () => {
    expect(isUnderdog([6, 3, 2], 2)).toBe(true);
    expect(isUnderdog([6, 3, 2], 1)).toBe(false);
    expect(isUnderdog([4, 2], 1)).toBe(false);
    expect(isUnderdog([2, 2, 5], 0)).toBe(true);
    expect(isUnderdog([0, 0], 0)).toBe(false);
  });

  it("bots gamble more when behind, hot, underdog or in overdrive", () => {
    const base = botWagerChance({ deficit: 0, heat: 1, underdog: false, overdrive: false });
    expect(base).toBeGreaterThan(0);
    expect(botWagerChance({ deficit: 4, heat: 1, underdog: false, overdrive: false })).toBeGreaterThan(base);
    expect(botWagerChance({ deficit: 0, heat: 3, underdog: false, overdrive: false })).toBeGreaterThan(base);
    expect(botWagerChance({ deficit: 0, heat: 1, underdog: false, overdrive: true })).toBeGreaterThan(base);
    expect(botWagerChance({ deficit: 9, heat: 3, underdog: false, overdrive: true })).toBeLessThanOrEqual(0.75);
    expect(botWagerChance({ deficit: 0, heat: 1, underdog: true, overdrive: false })).toBe(0.9);
  });

  it("a jinxed bot succeeds less often", () => {
    const rng = new Rng(9);
    let plain = 0;
    let jinxed = 0;
    for (let i = 0; i < 3000; i++) {
      if (planBot(rng, 0).succeed) plain++;
      if (planBot(rng, 0, true).succeed) jinxed++;
    }
    expect(jinxed / plain).toBeGreaterThan(BOT_JINX_FACTOR - 0.1);
    expect(jinxed / plain).toBeLessThan(BOT_JINX_FACTOR + 0.1);
  });

  it("jinx transforms invert cleanly for finger input", () => {
    for (const kind of ["flip", "spin", "tiny", null] as const) {
      const xf = jinxTransform(kind, 1.3);
      const p = unjinxPoint(xf, 160, 300, 200, 120);
      // Re-apply the forward transform by hand and expect the original point back.
      const dx = (p.x - 160) * xf.scale;
      const dy = (p.y - 300) * xf.scale * xf.flipY;
      const fx = 160 + dx * Math.cos(xf.rot) - dy * Math.sin(xf.rot);
      const fy = 300 + dx * Math.sin(xf.rot) + dy * Math.cos(xf.rot);
      expect(fx).toBeCloseTo(200, 6);
      expect(fy).toBeCloseTo(120, 6);
    }
    expect(jinxTransform("tiny", 0).scale).toBe(TINY_SCALE);
    expect(jinxTransform("fog", 0)).toEqual({ scale: 1, rot: 0, flipY: 1 });
  });

  it("bots succeed less at higher tiers", () => {
    const rng = new Rng(2);
    const rate = (tier: number): number => {
      let ok = 0;
      for (let i = 0; i < 2000; i++) {
        const p = planBot(rng, tier);
        expect(p.delay).toBeGreaterThanOrEqual(0.2);
        expect(p.delay).toBeLessThanOrEqual(0.7);
        if (p.succeed) ok++;
      }
      return ok / 2000;
    };
    const r0 = rate(0);
    expect(r0).toBeGreaterThan(0.74);
    expect(r0).toBeLessThan(0.86);
    expect(rate(2)).toBeLessThan(r0);
  });
});

describe("microgames by hand", () => {
  it("POP: the rising balloon wins, any other fails, time out fails", () => {
    const mg = fresh(new PopGame());
    const rising = mg.balloons.find((b) => b.rising)!;
    tapAt(mg, rising.x, rising.y);
    expect(mg.success).toBe(true);
    expect(mg.successAt).toBe(0);
    const bad = fresh(new PopGame(), 2);
    const still = bad.balloons.find((b) => !b.rising)!;
    tapAt(bad, still.x, still.y);
    expect(bad.failed).toBe(true);
    const idle = fresh(new PopGame(), 3);
    run(idle, 4.1);
    expect(idle.failed).toBe(true);
  });

  it("SWAT: only a tap on the fly counts", () => {
    const mg = fresh(new SwatGame());
    run(mg, 0.5);
    tapAt(mg, mg.x + 200, mg.y + 200);
    expect(mg.done).toBe(false);
    tapAt(mg, mg.x, mg.y);
    expect(mg.success).toBe(true);
  });

  it("CATCH: dragging the basket under the egg catches it", () => {
    const mg = fresh(new CatchGame());
    mg.handle({ type: "down", x: ZONE.x + 10, y: 500, id: 7 });
    mg.handle({ type: "move", x: ZONE.x + mg.eggX, y: 500, id: 7 });
    expect(Math.abs(mg.basketX - mg.eggX)).toBeLessThan(mg.basketW / 2);
    run(mg, 4);
    expect(mg.success).toBe(true);
    const miss = fresh(new CatchGame());
    run(miss, 4);
    expect(miss.failed).toBe(true);
    expect(miss.splat).toBe(true);
  });

  it("DODGE: a vertical swipe dodges the arrow", () => {
    const mg = fresh(new DodgeGame());
    mg.handle({ type: "down", x: 400, y: 300, id: 1 });
    mg.handle({ type: "move", x: 400, y: 380, id: 1 });
    expect(mg.dodged).toBe(1);
    run(mg, 4);
    expect(mg.success).toBe(true);
    const hit = fresh(new DodgeGame());
    run(hit, 4);
    expect(hit.failed).toBe(true);
  });

  it("MATCH: the odd colour wins", () => {
    const mg = fresh(new MatchGame());
    const odd = mg.shapes.find((s) => s.odd)!;
    expect(mg.shapes.filter((s) => s.color === odd.color)).toHaveLength(1);
    tapAt(mg, odd.x, odd.y);
    expect(mg.success).toBe(true);
    const bad = fresh(new MatchGame());
    const same = bad.shapes.find((s) => !s.odd)!;
    tapAt(bad, same.x, same.y);
    expect(bad.failed).toBe(true);
  });

  it("HOLD: release inside the band wins, early or overflow fails", () => {
    const mg = fresh(new HoldGame());
    mg.handle({ type: "down", x: 400, y: 300, id: 1 });
    while (mg.fill < (mg.bandLo + mg.bandHi) / 2) mg.update(1 / 120);
    mg.handle({ type: "up", x: 400, y: 300, id: 1 });
    expect(mg.success).toBe(true);
    const early = fresh(new HoldGame());
    early.handle({ type: "down", x: 400, y: 300, id: 1 });
    early.update(0.05);
    early.handle({ type: "up", x: 400, y: 300, id: 1 });
    expect(early.failed).toBe(true);
    const over = fresh(new HoldGame());
    over.handle({ type: "down", x: 400, y: 300, id: 1 });
    run(over, 3.5);
    expect(over.failed).toBe(true);
    expect(over.fill).toBe(1);
  });

  it("SHAKE: 8 taps drop the apple", () => {
    const mg = fresh(new ShakeGame());
    for (let i = 0; i < SHAKE_TAPS - 1; i++) tapAt(mg, 100, 100);
    expect(mg.done).toBe(false);
    tapAt(mg, 100, 100);
    expect(mg.success).toBe(true);
  });

  it("STOP: tapping in the wedge wins, outside fails", () => {
    const mg = fresh(new StopGame());
    while (!mg.inWedge(mg.angle)) mg.update(1 / 240);
    tapAt(mg, 100, 100);
    expect(mg.success).toBe(true);
    const bad = fresh(new StopGame());
    while (bad.inWedge(bad.angle)) bad.update(1 / 240);
    tapAt(bad, 100, 100);
    expect(bad.failed).toBe(true);
  });

  it("near misses are flagged: HOLD just outside the band, STOP just past the wedge, SHAKE two taps short", () => {
    const hold = fresh(new HoldGame());
    hold.handle({ type: "down", x: 400, y: 300, id: 1 });
    while (hold.fill < hold.bandHi + 0.03) hold.update(1 / 240);
    hold.handle({ type: "up", x: 400, y: 300, id: 1 });
    expect(hold.failed).toBe(true);
    expect(hold.nearMiss).toBe(true);
    const early = fresh(new HoldGame());
    early.handle({ type: "down", x: 400, y: 300, id: 1 });
    early.update(0.05);
    early.handle({ type: "up", x: 400, y: 300, id: 1 });
    expect(early.nearMiss).toBe(false);
    const stop = fresh(new StopGame());
    while (!stop.inWedge(stop.angle)) stop.update(1 / 240);
    while (stop.inWedge(stop.angle)) stop.update(1 / 240);
    tapAt(stop, 100, 100);
    expect(stop.failed).toBe(true);
    expect(stop.nearMiss).toBe(true);
    const shake = fresh(new ShakeGame());
    for (let i = 0; i < SHAKE_TAPS - 2; i++) tapAt(shake, 100, 100);
    run(shake, 4.1);
    expect(shake.failed).toBe(true);
    expect(shake.nearMiss).toBe(true);
  });

  it("FLIP jinx mirrors the lane: the finger must tap where the balloon is drawn", () => {
    const mg = fresh(new PopGame());
    mg.jinx = "flip";
    const rising = mg.balloons.find((b) => b.rising)!;
    const mirroredY = PH - rising.y;
    tapAt(mg, rising.x, rising.y);
    // Tapping the unmirrored spot hits whatever balloon is drawn there (or nothing), not a guaranteed win.
    if (!mg.done) {
      tapAt(mg, rising.x, mirroredY);
      expect(mg.success).toBe(true);
    }
    const again = fresh(new PopGame());
    again.jinx = "flip";
    const r2 = again.balloons.find((b) => b.rising)!;
    tapAt(again, r2.x, PH - r2.y);
    expect(again.success).toBe(true);
  });

  it("TINY jinx shrinks the lane around its centre", () => {
    const mg = fresh(new MatchGame());
    mg.jinx = "tiny";
    const odd = mg.shapes.find((s) => s.odd)!;
    const sx = ZONE.w / 2 + (odd.x - ZONE.w / 2) * TINY_SCALE;
    const sy = PH / 2 + (odd.y - PH / 2) * TINY_SCALE;
    tapAt(mg, sx, sy);
    expect(mg.success).toBe(true);
  });

  it("FOG jinx leaves coordinates alone and remembers the finger for the spotlight", () => {
    const mg = fresh(new MatchGame());
    mg.jinx = "fog";
    const odd = mg.shapes.find((s) => s.odd)!;
    tapAt(mg, odd.x, odd.y);
    expect(mg.success).toBe(true);
    expect(mg.lastTouch).toEqual({ x: odd.x, y: odd.y });
  });
});

describe("microgame bots", () => {
  const kinds: MicroKind[] = [...MICRO_KINDS];
  for (const kind of kinds) {
    it(`${kind}: a succeeding script succeeds and a failing one fails, at every speed`, () => {
      for (const limit of [3.6, 3.0, 2.4]) {
        let ok = 0;
        let bad = 0;
        const n = 40;
        for (let seed = 1; seed <= n; seed++) {
          const good = fresh(makeMicrogame(kind), seed, limit);
          good.setBot({ delay: 0.2 + (seed % 6) * 0.1, succeed: true });
          run(good, limit + 0.1);
          if (good.success) ok++;
          const miss = fresh(makeMicrogame(kind), seed, limit);
          miss.setBot({ delay: 0.2 + (seed % 6) * 0.1, succeed: false });
          run(miss, limit + 0.1);
          if (miss.failed) bad++;
          expect(miss.done).toBe(true);
        }
        expect(ok, `${kind} @${limit}s succeed`).toBeGreaterThanOrEqual(n - 1);
        expect(bad, `${kind} @${limit}s fail`).toBe(n);
      }
    });
  }
});

describe("micro mayhem game", () => {
  function table(seed: number, n: number) {
    const canvas = { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const ctx = {
      width: 1280, height: 720, rng: new Rng(seed), minTap: 60,
      players: Array.from({ length: n }, (_, slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
      canvas,
      input: { justPressed: () => false },
      sfx: new Proxy({}, { get: () => vi.fn() }),
    } as never;
    return { canvas, game: microMayhem.create(ctx) };
  }

  it("an all-bot table plays 15 microgames to the end in 45-80s", () => {
    for (const [seed, n] of [[11, 4], [12, 2], [13, 3]] as const) {
      const { canvas, game } = table(seed, n);
      let frames = 0;
      for (; frames < 60 * 120 && !game.isFinished(); frames++) game.update(1 / 60);
      expect(game.isFinished()).toBe(true);
      expect(frames / 60).toBeLessThan(80);
      expect(frames / 60).toBeGreaterThan(45);
      const scores = game.getScores();
      expect(scores).toHaveLength(n);
      expect(scores.some((s) => s.score > 0)).toBe(true);
      // Max per microgame: heat 3 x double x overdrive + fastest = (6 + 1) * 2.
      for (const s of scores) expect(s.score).toBeLessThanOrEqual(MICROGAMES_PER_MATCH * 14);
      const stats = game.getStats!();
      expect(stats.some((s) => s.label === "Fastest win" && s.value.endsWith("ms"))).toBe(true);
      expect(stats.some((s) => s.label === "Best heat run")).toBe(true);
      game.destroy();
      expect(canvas.removeEventListener).toHaveBeenCalledTimes(4);
    }
  });

  it("renders every phase without throwing on a stub context", () => {
    const { game } = table(21, 4);
    const calls: string[] = [];
    const g = new Proxy({}, {
      get: (_t, key) => {
        if (key === "canvas") return { width: 1280, height: 720 };
        return (...args: unknown[]) => {
          calls.push(String(key));
          if (key === "createLinearGradient" || key === "createRadialGradient") return { addColorStop: vi.fn() };
          if (key === "measureText") return { width: 10 };
          return args.length ? undefined : 0;
        };
      },
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    for (let f = 0; f < 60 * 90 && !game.isFinished(); f++) {
      game.update(1 / 60);
      if (f % 7 === 0) game.render(g);
    }
    expect(game.isFinished()).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
    game.destroy();
  });
});

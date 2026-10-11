import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { microMayhem } from "./micro-mayhem";
import {
  CatchGame, DodgeGame, HoldGame, MatchGame, MICRO_KINDS, MICROGAMES_PER_MATCH, PopGame, SHAKE_TAPS, ShakeGame,
  StopGame, SwatGame, isSpeedUp, limitFor, makeMicrogame, planBot, planOrder, scoreOutcomes, tierOf,
  type MicroKind, type Microgame, type Zone,
} from "./logic";

const ZONE: Zone = { x: 320, y: 0, w: 320, h: 720 };
const OPTS = { limit: 4, minTap: 60 };

function fresh<T extends Microgame>(mg: T, seed = 1, limit = 4): T {
  mg.reset(ZONE, new Rng(seed), { ...OPTS, limit });
  return mg;
}

/** Tap in play-area coords (the game adds the zone offset and header itself). */
function tapAt(mg: Microgame, x: number, y: number): void {
  mg.handle({ type: "down", x: ZONE.x + x, y: ZONE.y + 96 + y, id: 1 });
  mg.handle({ type: "up", x: ZONE.x + x, y: ZONE.y + 96 + y, id: 1 });
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

  it("ramps the timer every 5 microgames", () => {
    expect(limitFor(0)).toBe(4);
    expect(limitFor(4)).toBe(4);
    expect(limitFor(5)).toBe(3.2);
    expect(limitFor(10)).toBe(2.5);
    expect(limitFor(14)).toBe(2.5);
    expect(tierOf(14)).toBe(2);
    expect(isSpeedUp(0)).toBe(false);
    expect(isSpeedUp(5)).toBe(true);
    expect(isSpeedUp(10)).toBe(true);
    expect(isSpeedUp(7)).toBe(false);
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
});

describe("microgame bots", () => {
  const kinds: MicroKind[] = [...MICRO_KINDS];
  for (const kind of kinds) {
    it(`${kind}: a succeeding script succeeds and a failing one fails, at every speed`, () => {
      for (const limit of [4, 3.2, 2.5]) {
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
  it("an all-bot table plays 15 microgames to the end in under 90s", () => {
    const canvas = { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const ctx = {
      width: 1280, height: 720, rng: new Rng(11), minTap: 60,
      players: [0, 1, 2, 3].map((slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
      canvas,
      input: { justPressed: () => false },
      sfx: new Proxy({}, { get: () => vi.fn() }),
    } as never;
    const game = microMayhem.create(ctx);
    let frames = 0;
    for (; frames < 60 * 120 && !game.isFinished(); frames++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    expect(frames / 60).toBeLessThan(90);
    expect(frames / 60).toBeGreaterThan(45);
    const scores = game.getScores();
    expect(scores).toHaveLength(4);
    expect(scores.some((s) => s.score > 0)).toBe(true);
    for (const s of scores) expect(s.score).toBeLessThanOrEqual(MICROGAMES_PER_MATCH * 2);
    const stats = game.getStats!();
    expect(stats.some((s) => s.label === "Fastest win" && s.value.endsWith("ms"))).toBe(true);
    game.destroy();
    expect(canvas.removeEventListener).toHaveBeenCalledTimes(4);
  });
});

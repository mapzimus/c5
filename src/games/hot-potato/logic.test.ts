import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { hotPotato } from "./hot-potato";
import {
  BOT_HOLD_MAX_S, BOT_HOLD_MIN_S, FREEZE_S, GLUE_AT_S, GLUE_S, HAUNT_COOLDOWN_S, SPOOK_WINDOW_S, STICKY_AT_S, STICKY_S,
  angleDiff, bombOdds, botAimTarget, canFreeze, chargeFill, chargeSeconds, chargeTier, eliminationScores, formatNerve,
  heartsFor, inZone, isNearMiss, isSuddenDeath, nerveTenths, otherLiving, pickTarget, planBomb, planBotHaunt,
  planBotHold, pointedSeat, seatLayout, spookEarned, stickFor,
} from "./logic";

describe("hold it! logic", () => {
  it("gives fewer hearts to bigger tables so matches stay short", () => {
    expect(heartsFor(2)).toBe(4);
    expect(heartsFor(3)).toBe(3);
    expect(heartsFor(4)).toBe(2);
  });

  it("shortens fuses and thins duds with every blast; sudden death is pure and fast", () => {
    const first = bombOdds(0, false);
    const later = bombOdds(5, false);
    expect(first.fuseMin).toBe(6);
    expect(first.fuseMax).toBe(11);
    expect(later.fuseMin).toBeLessThan(first.fuseMin);
    expect(later.fuseMax).toBeLessThan(first.fuseMax);
    expect(later.dudChance).toBeLessThan(first.dudChance);
    expect(later.fuseMin).toBeGreaterThanOrEqual(4);
    expect(bombOdds(50, false).fuseMax).toBe(7.5);
    const sd = bombOdds(3, true);
    expect(sd.dudChance).toBe(0);
    expect(sd.splitChance).toBe(0);
    expect(sd.fuseMax).toBeLessThanOrEqual(7);
  });

  it("plans fuses in range with the stage's dud and split odds", () => {
    const rng = new Rng(5);
    const odds = bombOdds(0, false);
    let duds = 0;
    let splits = 0;
    const n = 3000;
    for (let i = 0; i < n; i++) {
      const b = planBomb(rng, odds);
      expect(b.fuseS).toBeGreaterThanOrEqual(odds.fuseMin);
      expect(b.fuseS).toBeLessThanOrEqual(odds.fuseMax);
      if (b.kind === "dud") duds++;
      if (b.kind === "split") splits++;
    }
    expect(duds / n).toBeGreaterThan(0.16);
    expect(duds / n).toBeLessThan(0.24);
    expect(splits / n).toBeGreaterThan(0.11);
    expect(splits / n).toBeLessThan(0.19);
    for (let i = 0; i < 300; i++) {
      expect(planBomb(rng, odds, { allowDud: false }).kind).not.toBe("dud");
      expect(planBomb(rng, odds, { allowSplit: false }).kind).not.toBe("split");
      expect(planBomb(rng, bombOdds(0, true)).kind).toBe("live");
    }
  });

  it("sudden death is exactly two players both on their last heart", () => {
    expect(isSuddenDeath([1, 0, 1, 0])).toBe(true);
    expect(isSuddenDeath([1, 1])).toBe(true);
    expect(isSuddenDeath([2, 0, 1, 0])).toBe(false);
    expect(isSuddenDeath([1, 1, 1])).toBe(false);
    expect(isSuddenDeath([1, 0])).toBe(false);
  });

  it("charge tiers: 1.5s sticks for 1s, 3s glues for 2s, last-heart players charge 1.5x faster", () => {
    expect(chargeTier(0)).toBe(0);
    expect(chargeTier(STICKY_AT_S - 0.01)).toBe(0);
    expect(chargeTier(STICKY_AT_S)).toBe(1);
    expect(chargeTier(GLUE_AT_S)).toBe(2);
    expect(stickFor(0)).toBe(0);
    expect(stickFor(1)).toBe(STICKY_S);
    expect(stickFor(2)).toBe(GLUE_S);
    expect(chargeSeconds(2, false)).toBe(2);
    expect(chargeSeconds(2, true)).toBe(3);
    expect(chargeTier(chargeSeconds(1, true))).toBe(1);
    expect(chargeTier(chargeSeconds(1, false))).toBe(0);
    expect(chargeFill(0)).toBe(0);
    expect(chargeFill(GLUE_AT_S / 2)).toBeCloseTo(0.5);
    expect(chargeFill(99)).toBe(1);
  });

  it("ghost haunts respect freeze immunity and earn spooks only around the freeze", () => {
    expect(canFreeze(0, 0)).toBe(true);
    expect(canFreeze(0.3, 0)).toBe(false);
    expect(canFreeze(0, 0.5)).toBe(false);
    expect(spookEarned(FREEZE_S / 2, 99)).toBe(true);
    expect(spookEarned(0, SPOOK_WINDOW_S - 0.1)).toBe(true);
    expect(spookEarned(0, SPOOK_WINDOW_S + 0.1)).toBe(false);
    const rng = new Rng(3);
    for (let i = 0; i < 50; i++) {
      const t = planBotHaunt(rng);
      expect(t).toBeGreaterThanOrEqual(3);
      expect(t).toBeLessThanOrEqual(7);
    }
    expect(HAUNT_COOLDOWN_S).toBeGreaterThan(FREEZE_S * 2);
  });

  it("picks random targets among other living seats only", () => {
    const rng = new Rng(2);
    const alive = [true, false, true, true];
    expect(otherLiving(alive, 0)).toEqual([2, 3]);
    for (let i = 0; i < 100; i++) {
      const t = pickTarget(alive, 2, rng);
      expect([0, 3]).toContain(t);
    }
    expect(pickTarget([true, false], 0, rng)).toBe(-1);
  });

  it("the aim pointer picks the nearest living seat by angle", () => {
    const angles = seatLayout(4, 1280, 720).map((z) => z.angle);
    const alive = [true, true, true, true];
    expect(pointedSeat(angles[1]!, angles, alive, 0)).toBe(1);
    expect(pointedSeat(angles[3]! + 0.1, angles, alive, 0)).toBe(3);
    // Never points at yourself or the dead.
    expect(pointedSeat(angles[0]!, angles, alive, 0)).not.toBe(0);
    expect(pointedSeat(angles[2]!, angles, [true, true, false, true], 0)).not.toBe(2);
    expect(pointedSeat(0, angles, [true, false, false, false], 0)).toBe(-1);
    // A ghost (dead seat) aiming still finds the living.
    expect(pointedSeat(angles[1]!, angles, [false, true, true, true], 0)).toBe(1);
    expect(angleDiff(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(0.2);
    expect(angleDiff(Math.PI, -Math.PI)).toBeCloseTo(0);
  });

  it("bots throw fast on hot bombs, gamble on stickies when the bomb is young, and sometimes blunder", () => {
    const rng = new Rng(7);
    const n = 2000;
    const young = { quick: 0, sticky: 0, glue: 0, blunder: 0 };
    for (let i = 0; i < n; i++) {
      const p = planBotHold(rng, 1, false);
      young[p.intent]++;
      if (p.intent === "quick") {
        expect(p.holdS).toBeGreaterThanOrEqual(BOT_HOLD_MIN_S);
        expect(p.holdS).toBeLessThanOrEqual(BOT_HOLD_MAX_S);
      }
      if (p.intent === "sticky") expect(chargeTier(p.holdS)).toBe(1);
      if (p.intent === "glue") expect(chargeTier(p.holdS)).toBe(2);
      if (p.intent === "blunder") expect(p.holdS).toBeGreaterThanOrEqual(2.5);
    }
    expect(young.sticky + young.glue).toBeGreaterThan(n * 0.3);
    expect(young.glue).toBeGreaterThan(0);
    expect(young.blunder / n).toBeGreaterThan(0.04);
    expect(young.blunder / n).toBeLessThan(0.12);
    const hot = { quick: 0, sticky: 0, glue: 0, blunder: 0 };
    for (let i = 0; i < n; i++) hot[planBotHold(rng, 6, false).intent]++;
    expect(hot.sticky + hot.glue).toBe(0);
    expect(hot.quick).toBeGreaterThan(n * 0.85);
    // Last-heart bots hold less real time for the same tier.
    for (let i = 0; i < 200; i++) {
      const p = planBotHold(rng, 0.5, true);
      if (p.intent === "sticky") expect(chargeTier(chargeSeconds(p.holdS, true))).toBe(1);
    }
  });

  it("bots aim at the living leader (most hearts) about 35% of the time", () => {
    const rng = new Rng(9);
    const alive = [true, true, true, true];
    const hearts = [2, 1, 2, 1];
    let aimed = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const t = botAimTarget(alive, 0, hearts, rng);
      if (t !== null) {
        aimed++;
        expect(t).toBe(2);
      }
    }
    expect(aimed / n).toBeGreaterThan(0.3);
    expect(aimed / n).toBeLessThan(0.4);
    expect(botAimTarget(alive, 1, [2, 0, 2, 1], rng, 1)).not.toBe(1);
    expect(botAimTarget([true, false, false, false], 0, hearts, rng, 1)).toBeNull();
    // A ghost (dead seat) can still pick a living leader to haunt.
    expect(botAimTarget([false, true, true, true], 0, [0, 1, 2, 1], rng, 1)).toBe(2);
  });

  it("scores by elimination order with the survivor highest", () => {
    expect(eliminationScores([2, 0], 4)).toEqual([2, 4, 1, 4]);
    expect(eliminationScores([2, 0, 1], 4)).toEqual([2, 3, 1, 4]);
    expect(eliminationScores([], 3)).toEqual([3, 3, 3]);
  });

  it("near misses and nerve formatting", () => {
    expect(isNearMiss(0.2)).toBe(true);
    expect(isNearMiss(0.7)).toBe(true);
    expect(isNearMiss(0.71)).toBe(false);
    expect(isNearMiss(-1)).toBe(false);
    expect(nerveTenths(2.34)).toBe(23);
    expect(formatNerve(2.34)).toBe("2.3s");
    expect(formatNerve(0)).toBe("0.0s");
  });

  it("lays out one zone per seat that tiles the screen and holds its character", () => {
    for (const n of [2, 3, 4]) {
      const zones = seatLayout(n, 1280, 720);
      expect(zones).toHaveLength(n);
      const area = zones.reduce((a, z) => a + z.w * z.h, 0);
      expect(area).toBe(1280 * 720);
      for (const z of zones) {
        expect(inZone(z, z.cx, z.cy)).toBe(true);
        expect(z.w).toBeGreaterThanOrEqual(640);
        expect(z.h).toBeGreaterThanOrEqual(360);
      }
      // Every point belongs to exactly one zone.
      for (const [x, y] of [[10, 10], [1270, 10], [10, 710], [1270, 710], [640, 360]] as const) {
        expect(zones.filter((z) => inZone(z, x, y))).toHaveLength(1);
      }
    }
  });
});

function makeCtx(seed: number, n: number) {
  return {
    width: 1280, height: 720, rng: new Rng(seed), minTap: 44,
    players: Array.from({ length: n }, (_, slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
    canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    input: { justPressed: () => false },
    sfx: new Proxy({}, { get: () => vi.fn() }),
  } as never;
}

describe("hold it! game", () => {
  it("an all-bot table plays to one survivor in 30-110s and ranks by elimination", () => {
    for (const [seed, n] of [[11, 4], [23, 3], [37, 2], [41, 4], [53, 2]] as const) {
      const game = hotPotato.create(makeCtx(seed, n));
      let frames = 0;
      while (!game.isFinished() && frames < 60 * 240) {
        game.update(1 / 60);
        frames++;
      }
      expect(game.isFinished()).toBe(true);
      expect(frames / 60).toBeGreaterThan(30);
      expect(frames / 60).toBeLessThan(110);
      const scores = game.getScores().map((s) => s.score);
      expect(scores.filter((s) => s === n)).toHaveLength(1);
      expect([...scores].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      const stats = game.getStats?.() ?? [];
      expect(stats).toHaveLength(n);
      expect(stats.every((s) => s.label === "Nerve")).toBe(true);
      expect(stats.some((s) => s.value !== "0.0s")).toBe(true);
      game.destroy();
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { hotPotato } from "./hot-potato";
import {
  BOT_HOLD_MAX_S, BOT_HOLD_MIN_S, FUSE_MAX_S, FUSE_MIN_S, angleDiff, botAimTarget, eliminationScores,
  inZone, otherLiving, pickTarget, planBomb, planBotThrow, pointedSeat, seatLayout,
} from "./logic";

describe("hot potato logic", () => {
  it("plans fuses in range with roughly 20% duds and 15% splits", () => {
    const rng = new Rng(5);
    let duds = 0;
    let splits = 0;
    const n = 3000;
    for (let i = 0; i < n; i++) {
      const b = planBomb(rng);
      expect(b.fuseS).toBeGreaterThanOrEqual(FUSE_MIN_S);
      expect(b.fuseS).toBeLessThanOrEqual(FUSE_MAX_S);
      if (b.kind === "dud") duds++;
      if (b.kind === "split") splits++;
    }
    expect(duds / n).toBeGreaterThan(0.16);
    expect(duds / n).toBeLessThan(0.24);
    expect(splits / n).toBeGreaterThan(0.11);
    expect(splits / n).toBeLessThan(0.19);
    for (let i = 0; i < 300; i++) {
      expect(planBomb(rng, { allowDud: false }).kind).not.toBe("dud");
      expect(planBomb(rng, { allowSplit: false }).kind).not.toBe("split");
    }
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
    // Seat 1 is top-right (angle ~ -3/4 PI... measured from centre), seat 3 bottom-right.
    expect(pointedSeat(angles[1]!, angles, alive, 0)).toBe(1);
    expect(pointedSeat(angles[3]! + 0.1, angles, alive, 0)).toBe(3);
    // Never points at yourself or the dead.
    expect(pointedSeat(angles[0]!, angles, alive, 0)).not.toBe(0);
    expect(pointedSeat(angles[2]!, angles, [true, true, false, true], 0)).not.toBe(2);
    expect(pointedSeat(0, angles, [true, false, false, false], 0)).toBe(-1);
    expect(angleDiff(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(0.2);
    expect(angleDiff(Math.PI, -Math.PI)).toBeCloseTo(0);
  });

  it("bots hold 0.4-1.5s and aim at the top passer 30% of the time", () => {
    const rng = new Rng(7);
    for (let i = 0; i < 100; i++) {
      const t = planBotThrow(rng);
      expect(t).toBeGreaterThanOrEqual(BOT_HOLD_MIN_S);
      expect(t).toBeLessThanOrEqual(BOT_HOLD_MAX_S);
    }
    const alive = [true, true, true, true];
    const passes = [9, 2, 7, 3];
    let aimed = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const t = botAimTarget(alive, 0, passes, rng);
      if (t !== null) {
        aimed++;
        expect(t).toBe(2);
      }
    }
    expect(aimed / n).toBeGreaterThan(0.25);
    expect(aimed / n).toBeLessThan(0.35);
    expect(botAimTarget(alive, 1, [4, 0, 4, 1], rng, 1)).not.toBe(1);
    expect(botAimTarget([true, false, false, false], 0, passes, rng, 1)).toBeNull();
  });

  it("scores by elimination order with the survivor highest", () => {
    expect(eliminationScores([2, 0], 4)).toEqual([2, 4, 1, 4]);
    expect(eliminationScores([2, 0, 1], 4)).toEqual([2, 3, 1, 4]);
    expect(eliminationScores([], 3)).toEqual([3, 3, 3]);
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

describe("hot potato game", () => {
  it("an all-bot table plays to one survivor and ranks by elimination", () => {
    for (const [seed, n] of [[11, 4], [23, 3], [37, 2]] as const) {
      const game = hotPotato.create(makeCtx(seed, n));
      let frames = 0;
      while (!game.isFinished() && frames < 60 * 240) {
        game.update(1 / 60);
        frames++;
      }
      expect(game.isFinished()).toBe(true);
      // Max rounds * max fuse plus beats is well under 4 minutes; typical games are far shorter.
      expect(frames).toBeLessThan(60 * 240);
      const scores = game.getScores().map((s) => s.score);
      expect(scores.filter((s) => s === n)).toHaveLength(1);
      expect([...scores].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      const stats = game.getStats?.() ?? [];
      expect(stats).toHaveLength(n);
      expect(stats.every((s) => s.label === "Passes")).toBe(true);
      expect(stats.reduce((a, s) => a + Number(s.value), 0)).toBeGreaterThan(0);
      game.destroy();
    }
  });
});

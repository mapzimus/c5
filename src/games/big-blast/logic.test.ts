import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { bigBlast } from "./big-blast";
import {
  blowUp, liveOdds, matchOver, newBomb, newMatch, nextAlive, planBotPress, press, PLUNGERS,
  randomPlunger, scores, survivors, tension, unpressed,
} from "./logic";

describe("big blast logic", () => {
  it("a fresh bomb has one secret live plunger among five", () => {
    const rng = new Rng(1);
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const b = newBomb(rng);
      expect(b.live).toBeGreaterThanOrEqual(0);
      expect(b.live).toBeLessThan(PLUNGERS);
      expect(unpressed(b)).toHaveLength(PLUNGERS);
      seen.add(b.live);
    }
    expect(seen.size).toBe(PLUNGERS);
  });

  it("duds pass the turn in seat order, the live one booms and keeps the turn", () => {
    const m = newMatch(3, new Rng(2));
    m.bomb = { live: 2, pressed: Array(PLUNGERS).fill(false) };
    expect(press(m, 1, 0)).toBe("ignored");
    expect(press(m, 0, 0)).toBe("dud");
    expect(m.turn).toBe(1);
    expect(press(m, 1, 0)).toBe("ignored");
    expect(press(m, 1, 4)).toBe("dud");
    expect(m.turn).toBe(2);
    expect(tension(m.bomb)).toBeCloseTo(0.5);
    expect(liveOdds(m.bomb)).toBeCloseTo(1 / 3);
    expect(press(m, 2, 2)).toBe("boom");
    expect(m.turn).toBe(2);
  });

  it("blowing up removes the seat, credits survivors and resets the bomb", () => {
    const rng = new Rng(3);
    const m = newMatch(4, rng);
    m.bomb.pressed[0] = true;
    blowUp(m, 1, rng);
    expect(m.alive).toEqual([true, false, true, true]);
    expect(m.blownUp).toEqual([1]);
    expect(m.survived).toEqual([1, 0, 1, 1]);
    expect(unpressed(m.bomb)).toHaveLength(PLUNGERS);
    expect(m.round).toBe(2);
    expect(m.turn).toBe(2);
    expect(nextAlive(m, 3)).toBe(0);
    expect(nextAlive(m, 0)).toBe(2);
    expect(matchOver(m)).toBe(false);
    blowUp(m, 2, rng);
    blowUp(m, 0, rng);
    expect(matchOver(m)).toBe(true);
    expect(survivors(m)).toEqual([3]);
    expect(scores(m)).toEqual([2, 0, 1, 3]);
  });

  it("timeouts and bots only pick un-pressed plungers; bots press within the turn", () => {
    const rng = new Rng(4);
    const b = newBomb(rng);
    b.pressed[0] = b.pressed[1] = b.pressed[3] = true;
    for (let i = 0; i < 40; i++) {
      expect([2, 4]).toContain(randomPlunger(b, rng));
      const plan = planBotPress(b, rng);
      expect([2, 4]).toContain(plan.target);
      expect(plan.atMs).toBeGreaterThanOrEqual(800);
      expect(plan.atMs).toBeLessThanOrEqual(2200);
      for (const h of plan.hovers) {
        expect([2, 4]).toContain(h.plunger);
        expect(h.atMs).toBeLessThan(plan.atMs);
      }
    }
    const teased = planBotPress(b, rng, 1);
    expect(teased.hovers).toHaveLength(2);
    expect(teased.hovers[0]!.plunger).not.toBe(teased.hovers[1]!.plunger);
    b.pressed[2] = true;
    expect(planBotPress(b, rng, 1).hovers).toHaveLength(0);
  });
});

function fakeCtx(kinds: ("human" | "bot")[], seed: number) {
  return {
    width: 1280, height: 720, rng: new Rng(seed), minTap: 44,
    players: kinds.map((kind, slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind, slot })),
    canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(), getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) },
    input: { justPressed: () => false },
    sfx: new Proxy({}, { get: () => vi.fn() }),
  } as never;
}

describe("big blast game", () => {
  it("an all-bot table plays until one survivor", () => {
    for (const n of [2, 3, 4]) {
      const game = bigBlast.create(fakeCtx(Array(n).fill("bot"), 10 + n));
      for (let f = 0; f < 60 * 180 && !game.isFinished(); f++) game.update(1 / 60);
      expect(game.isFinished()).toBe(true);
      const sc = game.getScores();
      expect(sc.filter((s) => s.score === n - 1)).toHaveLength(1);
      expect(new Set(sc.map((s) => s.score)).size).toBe(n);
      const stats = game.getStats?.() ?? [];
      expect(stats.filter((s) => s.label === "Survived blasts")).toHaveLength(n);
      game.destroy();
    }
  });

  it("idle humans get a plunger picked for them when the timer runs out", () => {
    const game = bigBlast.create(fakeCtx(["human", "human", "bot"], 7));
    for (let f = 0; f < 60 * 300 && !game.isFinished(); f++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    game.destroy();
  });
});

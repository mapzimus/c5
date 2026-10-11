import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { bigBlast } from "./big-blast";
import {
  blowUp, BOMBS, botAgainChance, botJinxChance, bounty, canJinx, liveOdds, matchOver, newBomb, newMatch,
  planBotAgain, planBotPress, press, PLUNGERS, randomPlunger, scores, stop, SURVIVE_BONUS, tension, underdogs,
  unpressed, useJinx,
} from "./logic";

function fixedBomb(live: number) {
  return { live, pressed: Array(PLUNGERS).fill(false) as boolean[] };
}

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

  it("duds pay a climbing bounty into the stake and keep the turn; stop passes it on", () => {
    const m = newMatch(3, new Rng(2));
    m.bomb = fixedBomb(2);
    expect(press(m, 1, 0)).toBe("ignored");
    expect(bounty(m, 0)).toEqual({ base: 10, mult: 1, total: 10 });
    expect(press(m, 0, 0)).toBe("dud");
    expect(m.turn).toBe(0);
    expect(m.chain).toBe(1);
    expect(m.stake).toEqual([10, 0, 0]);
    expect(bounty(m, 0).total).toBe(20);
    expect(press(m, 0, 4)).toBe("dud");
    expect(m.stake).toEqual([30, 0, 0]);
    expect(m.bestChain).toEqual([2, 0, 0]);
    expect(tension(m.bomb)).toBeCloseTo(0.5);
    expect(liveOdds(m.bomb)).toBeCloseTo(1 / 3);
    expect(stop(m, 1)).toBe(false);
    expect(stop(m, 0)).toBe(true);
    expect(m.turn).toBe(1);
    expect(m.chain).toBe(0);
    expect(stop(m, 1)).toBe(false); // nothing pressed yet
    expect(bounty(m, 1).total).toBe(30);
    expect(press(m, 1, 1)).toBe("dud");
    expect(bounty(m, 1).total).toBe(50);
    expect(press(m, 1, 2)).toBe("boom");
    expect(m.turn).toBe(1);
    expect(m.stake).toEqual([30, 30, 0]);
  });

  it("blowing up burns the victim's stake, banks everyone else plus a bonus, and hands them the jinx", () => {
    const rng = new Rng(3);
    const m = newMatch(4, rng);
    m.stake = [30, 50, 0, 10];
    m.bomb.pressed[0] = true;
    blowUp(m, 1, rng);
    expect(m.coins).toEqual([30 + SURVIVE_BONUS, 0, SURVIVE_BONUS, 10 + SURVIVE_BONUS]);
    expect(m.stake).toEqual([0, 0, 0, 0]);
    expect(m.toasted).toEqual([0, 1, 0, 0]);
    expect(m.victims).toEqual([1]);
    expect(m.jinx).toBe(1);
    expect(m.turn).toBe(1);
    expect(unpressed(m.bomb)).toHaveLength(PLUNGERS);
    expect(m.round).toBe(2);
    expect(matchOver(m)).toBe(false);
    expect(underdogs(m)).toEqual([1]);
    expect(bounty(m, 1)).toEqual({ base: 10, mult: 2, total: 20 });
    expect(bounty(m, 0).mult).toBe(1);
  });

  it("the final bomb doubles bounties and the survival bonus; the match ends after it", () => {
    const rng = new Rng(5);
    const m = newMatch(2, rng);
    m.round = BOMBS;
    expect(bounty(m, 0)).toEqual({ base: 10, mult: 2, total: 20 });
    m.coins = [100, 0];
    expect(bounty(m, 1)).toEqual({ base: 10, mult: 4, total: 40 });
    m.stake = [15, 0];
    blowUp(m, 1, rng);
    expect(m.coins).toEqual([100 + 15 + SURVIVE_BONUS * 2, 0]);
    expect(matchOver(m)).toBe(true);
    expect(scores(m)).toEqual([155, 0]);
  });

  it("the jinx cancels one stop, only for its holder, only on someone else", () => {
    const rng = new Rng(6);
    const m = newMatch(3, rng);
    m.bomb = fixedBomb(4);
    blowUp(m, 2, rng); // seat 2 holds the jinx and goes first
    m.bomb = fixedBomb(4);
    expect(m.turn).toBe(2);
    press(m, 2, 0);
    expect(canJinx(m, 2, 2)).toBe(false);
    stop(m, 2);
    expect(canJinx(m, 2, 0)).toBe(false); // seat 0 has not pressed yet
    press(m, 0, 1);
    expect(canJinx(m, 1, 0)).toBe(false); // not the holder
    expect(canJinx(m, 2, 0)).toBe(true);
    expect(useJinx(m, 1, 0)).toBe(false);
    expect(useJinx(m, 2, 0)).toBe(true);
    expect(m.jinx).toBeNull();
    expect(m.turn).toBe(0);
    expect(m.chain).toBe(1);
    expect(useJinx(m, 2, 0)).toBe(false);
    expect(press(m, 0, 2)).toBe("dud");
    expect(m.chain).toBe(2);
  });

  it("timeouts and bots only pick un-pressed plungers; bots press within the turn", () => {
    const rng = new Rng(4);
    const b = newBomb(rng);
    b.pressed[0] = b.pressed[1] = b.pressed[3] = true;
    for (let i = 0; i < 40; i++) {
      expect([2, 4]).toContain(randomPlunger(b, rng));
      const plan = planBotPress(b, rng);
      expect([2, 4]).toContain(plan.target);
      expect(plan.atMs).toBeGreaterThanOrEqual(600);
      expect(plan.atMs).toBeLessThanOrEqual(1600);
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

  it("bots get greedier when safe, behind or reckless, and never press into a certain boom", () => {
    const rng = new Rng(8);
    const m = newMatch(2, rng);
    m.bomb = fixedBomb(0);
    const fresh = botAgainChance(m, 0, 0.5);
    expect(fresh).toBeGreaterThan(0.8);
    expect(botAgainChance(m, 0, 0.9)).toBeGreaterThan(fresh);
    m.bomb.pressed[1] = m.bomb.pressed[2] = m.bomb.pressed[3] = true;
    const tight = botAgainChance(m, 0, 0.5);
    expect(tight).toBeLessThan(0.3);
    m.coins = [0, 100];
    expect(botAgainChance(m, 0, 0.5)).toBeGreaterThan(tight);
    m.stake[0] = 200;
    expect(botAgainChance(m, 0, 0.5)).toBeLessThan(tight);
    m.bomb.pressed[4] = true;
    expect(botAgainChance(m, 0, 1)).toBe(0);
    for (let i = 0; i < 20; i++) {
      const plan = planBotAgain(m, 0, 0.9, rng);
      expect(plan.again).toBe(false);
      expect(plan.atMs).toBeGreaterThanOrEqual(450);
      expect(plan.atMs).toBeLessThanOrEqual(1200);
    }
  });

  it("bot jinxes are near-certain when the stopper left one plunger, rare on a fresh bomb", () => {
    const m = newMatch(2, new Rng(9));
    m.bomb = fixedBomb(0);
    expect(botJinxChance(m, 1)).toBeLessThan(0.1);
    m.bomb.pressed[1] = m.bomb.pressed[2] = m.bomb.pressed[3] = m.bomb.pressed[4] = true;
    expect(botJinxChance(m, 1)).toBeGreaterThan(0.9);
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
  it("an all-bot table plays four bombs and scores coins", () => {
    for (const n of [2, 3, 4]) {
      const game = bigBlast.create(fakeCtx(Array(n).fill("bot"), 10 + n));
      let frames = 0;
      for (; frames < 60 * 180 && !game.isFinished(); frames++) game.update(1 / 60);
      expect(game.isFinished()).toBe(true);
      expect(frames / 60).toBeLessThan(100);
      const sc = game.getScores();
      expect(sc).toHaveLength(n);
      expect(sc.reduce((a, s) => a + s.score, 0)).toBeGreaterThan(0);
      const stats = game.getStats?.() ?? [];
      expect(stats.filter((s) => s.label === "Longest chain")).toHaveLength(n);
      expect(stats.filter((s) => s.label === "Toasted").reduce((a, s) => a + Number(s.value), 0)).toBe(BOMBS);
      game.destroy();
    }
  });

  it("idle humans get a plunger picked for them and auto-stop when the clock runs out", () => {
    const game = bigBlast.create(fakeCtx(["human", "human", "bot"], 7));
    let frames = 0;
    for (; frames < 60 * 300 && !game.isFinished(); frames++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    expect(frames / 60).toBeLessThan(120);
    game.destroy();
  });
});

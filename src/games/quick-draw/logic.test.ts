import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { quickDraw } from "./quick-draw";
import {
  activeDecoy, activeFake, advanceRound, botBiteDecoy, botProfile, botWantsDouble, DRAW_TIMEOUT_MS, FAKE_SHOW_MS,
  heckle, HECKLES_PER_ROUND, isMatchPoint, LATE_WINDOW_MS, matchOver, maxWaitMs, MIN_WAIT_MS, newRound,
  planBotHeckles, planBotTap, planRound, ROUNDS, settleRound, tap, tickDone, underdogs, WINS_NEEDED,
} from "./logic";

describe("quick draw logic", () => {
  it("plans waits in range with more fakes later", () => {
    const rng = new Rng(3);
    let early = 0;
    let late = 0;
    for (let i = 0; i < 200; i++) {
      for (const round of [0, 4]) {
        const p = planRound(round, rng);
        expect(p.waitMs).toBeGreaterThanOrEqual(MIN_WAIT_MS);
        expect(p.waitMs).toBeLessThanOrEqual(maxWaitMs(round));
        for (const f of p.fakes) expect(f.atMs + FAKE_SHOW_MS).toBeLessThan(p.waitMs);
        if (round === 0) early += p.fakes.length; else late += p.fakes.length;
      }
    }
    expect(late).toBeGreaterThan(early);
  });

  it("tapping before DRAW is a false start; first tap after wins with reaction time", () => {
    const s = newRound({ waitMs: 2000, fakes: [{ atMs: 800, kind: "DRUM!" }] }, 3);
    advanceRound(s, 900);
    expect(activeFake(s)?.kind).toBe("DRUM!");
    expect(tap(s, 0)).toBe("false-start");
    expect(s.baitedBy[0]).toBeNull();
    expect(tap(s, 0)).toBe("ignored");
    advanceRound(s, 1100);
    expect(s.phase).toBe("draw");
    advanceRound(s, 250);
    expect(tap(s, 0)).toBe("ignored");
    expect(tap(s, 2)).toBe("win");
    expect(s.reactionMs).toBe(250);
    expect(s.winner).toBe(2);
  });

  it("a draw just after the winner is timed as late; much later is ignored", () => {
    const s = newRound({ waitMs: 2000, fakes: [] }, 3);
    advanceRound(s, 2250);
    expect(tap(s, 2)).toBe("win");
    tickDone(s, 40);
    expect(tap(s, 1)).toBe("late");
    expect(s.lateMs[1]).toBe(290);
    expect(tap(s, 1)).toBe("ignored");
    expect(tap(s, 2)).toBe("ignored");
    tickDone(s, LATE_WINDOW_MS + 10);
    expect(tap(s, 0)).toBe("ignored");
    expect(s.lateMs[0]).toBeNull();
  });

  it("false-starters heckle with limited bottles, never over another call, and get credit for bites", () => {
    const s = newRound({ waitMs: 4000, fakes: [{ atMs: 1000, kind: "BRAW!" }] }, 3);
    advanceRound(s, 300);
    expect(heckle(s, 0, "DRAW?")).toBeNull(); // still in the game
    tap(s, 0);
    const d = heckle(s, 0, "DRAW?");
    expect(d).not.toBeNull();
    expect(activeDecoy(s)?.word).toBe("DRAW?");
    expect(heckle(s, 0, "NOW!")).toBeNull(); // one call on screen at a time
    advanceRound(s, 100);
    expect(tap(s, 1)).toBe("false-start");
    expect(s.baitedBy[1]).toBe(0);
    advanceRound(s, 700);
    expect(activeFake(s)?.kind).toBe("BRAW!");
    expect(heckle(s, 0, "NOW!")).toBeNull(); // not over a real fake either
    advanceRound(s, FAKE_SHOW_MS);
    expect(heckle(s, 0, "NOW!")).not.toBeNull();
    expect(s.bottles[0]).toBe(HECKLES_PER_ROUND - 2);
    advanceRound(s, FAKE_SHOW_MS);
    expect(heckle(s, 0, "GO GO!")).toBeNull(); // out of bottles
    advanceRound(s, 2000);
    expect(s.phase).toBe("draw");
    expect(heckle(s, 1, "BANG!")).toBeNull(); // no heckling once DRAW is up
  });

  it("everyone out ends the round with no winner", () => {
    const s = newRound({ waitMs: 3000, fakes: [] }, 2);
    advanceRound(s, 500);
    tap(s, 0);
    tap(s, 1);
    expect(s.phase).toBe("done");
    expect(s.winner).toBeNull();
  });

  it("times out if nobody draws", () => {
    const s = newRound({ waitMs: 1500, fakes: [] }, 2);
    advanceRound(s, 1500 + DRAW_TIMEOUT_MS);
    expect(s.phase).toBe("done");
  });

  it("bots react 180-400ms after DRAW unless they bite; profiles vary and sometimes hesitate", () => {
    const rng = new Rng(9);
    const plan = { waitMs: 2000, fakes: [] };
    for (let i = 0; i < 50; i++) {
      const t = planBotTap(plan, rng);
      expect(t).toBeGreaterThanOrEqual(2180);
      expect(t).toBeLessThanOrEqual(2400);
    }
    const bitten = planBotTap({ waitMs: 4000, fakes: [{ atMs: 1000, kind: "BRAW!" }] }, rng, 1);
    expect(bitten).toBeLessThan(4000);
    const profile = botProfile(rng);
    let slow = 0;
    for (let i = 0; i < 300; i++) {
      const t = planBotTap(plan, rng, 0, profile);
      expect(t).toBeGreaterThanOrEqual(2000 + profile.base);
      if (t > 2000 + profile.base + profile.spread) slow++;
    }
    expect(slow).toBeGreaterThan(0);
    expect(slow).toBeLessThan(80);
    expect(botBiteDecoy(1000, rng, 1)).toBeGreaterThan(1000);
    expect(botBiteDecoy(1000, rng, 0)).toBeNull();
    const [a, b] = planBotHeckles(500, rng);
    expect(a).toBeGreaterThan(500);
    expect(b).toBeGreaterThan(a!);
  });

  it("settles stakes: doubled wins pay 2, doubled false starts cost 1 unless the double was free", () => {
    const s = newRound({ waitMs: 2000, fakes: [] }, 4);
    advanceRound(s, 500);
    tap(s, 1); // doubled, pays
    tap(s, 2); // free double, no penalty
    tap(s, 3); // doubled at zero: nothing to lose
    advanceRound(s, 1700);
    tap(s, 0);
    const r = settleRound([1, 2, 1, 0], s, [true, true, true, true], [false, false, true, false]);
    expect(r.deltas).toEqual([2, -1, 0, 0]);
    expect(r.wins).toEqual([3, 1, 1, 0]);
    const plain = settleRound([1, 2, 1, 0], s, [false, false, false, false], [false, false, false, false]);
    expect(plain.deltas).toEqual([1, 0, 0, 0]);
  });

  it("underdogs are the seats strictly behind everyone", () => {
    expect(underdogs([0, 0])).toEqual([false, false]);
    expect(underdogs([2, 0, 1, 0])).toEqual([false, true, false, true]);
    expect(isMatchPoint([2, 1], [false, false])).toBe(false);
    expect(isMatchPoint([2, 1], [true, false])).toBe(true);
    expect(isMatchPoint([WINS_NEEDED - 1, 0], [false, false])).toBe(true);
  });

  it("bots raise more when behind and almost always when it is free", () => {
    const rng = new Rng(5);
    const count = (wins: number[], seat: number, free: boolean): number => {
      let n = 0;
      for (let i = 0; i < 400; i++) if (botWantsDouble(wins, seat, free, false, rng)) n++;
      return n;
    };
    const leading = count([2, 0], 0, false);
    const behind = count([2, 0], 1, false);
    const free = count([2, 0], 1, true);
    expect(leading).toBeLessThan(behind);
    expect(behind).toBeLessThan(free);
    expect(free).toBeGreaterThan(280);
  });

  it("match ends at WINS_NEEDED or after ROUNDS", () => {
    expect(matchOver([WINS_NEEDED - 1, WINS_NEEDED - 1], ROUNDS - 1)).toBe(false);
    expect(matchOver([WINS_NEEDED, 0], 3)).toBe(true);
    expect(matchOver([2, 1, 1], ROUNDS)).toBe(true);
  });
});

describe("quick draw game", () => {
  const context = (seed: number, count: number) => ({
    width: 1280, height: 720, rng: new Rng(seed), minTap: 44,
    players: Array.from({ length: count }, (_, slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
    canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    input: { justPressed: () => false },
    sfx: new Proxy({}, { get: () => vi.fn() }),
  }) as never;

  it("an all-bot table plays to the end within the party length", () => {
    for (const [seed, count] of [[11, 4], [12, 2], [13, 3]] as const) {
      const game = quickDraw.create(context(seed, count));
      let frames = 0;
      for (; frames < 60 * 150 && !game.isFinished(); frames++) game.update(1 / 60);
      expect(game.isFinished()).toBe(true);
      expect(frames / 60).toBeGreaterThan(20);
      expect(frames / 60).toBeLessThan(95);
      const scores = game.getScores();
      expect(scores.some((s) => s.score > 0)).toBe(true);
      expect(Math.max(...scores.map((s) => s.score))).toBeLessThanOrEqual(WINS_NEEDED + 1);
      game.destroy();
    }
  });
});

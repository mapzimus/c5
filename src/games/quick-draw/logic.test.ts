import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { quickDraw } from "./quick-draw";
import {
  activeFake, advanceRound, DRAW_TIMEOUT_MS, FAKE_SHOW_MS, matchOver, maxWaitMs, MIN_WAIT_MS,
  newRound, planBotTap, planRound, tap,
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
    expect(tap(s, 0)).toBe("ignored");
    advanceRound(s, 1100);
    expect(s.phase).toBe("draw");
    advanceRound(s, 250);
    expect(tap(s, 0)).toBe("ignored");
    expect(tap(s, 2)).toBe("win");
    expect(s.reactionMs).toBe(250);
    expect(tap(s, 1)).toBe("ignored");
    expect(s.winner).toBe(2);
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

  it("bots react 180-400ms after DRAW unless they bite", () => {
    const rng = new Rng(9);
    const plan = { waitMs: 2000, fakes: [] };
    for (let i = 0; i < 50; i++) {
      const t = planBotTap(plan, rng);
      expect(t).toBeGreaterThanOrEqual(2180);
      expect(t).toBeLessThanOrEqual(2400);
    }
    const bitten = planBotTap({ waitMs: 4000, fakes: [{ atMs: 1000, kind: "BRAW!" }] }, rng, 1);
    expect(bitten).toBeLessThan(4000);
  });

  it("match ends at 3 wins or 5 rounds", () => {
    expect(matchOver([2, 2], 4)).toBe(false);
    expect(matchOver([3, 0], 3)).toBe(true);
    expect(matchOver([2, 1, 1], 5)).toBe(true);
  });
});

describe("quick draw game", () => {
  it("an all-bot table plays to the end", () => {
    const ctx = {
      width: 1280, height: 720, rng: new Rng(11), minTap: 44,
      players: [0, 1, 2, 3].map((slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
      canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      input: { justPressed: () => false },
      sfx: new Proxy({}, { get: () => vi.fn() }),
    } as never;
    const game = quickDraw.create(ctx);
    for (let f = 0; f < 60 * 120 && !game.isFinished(); f++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    expect(game.getScores().some((s) => s.score > 0)).toBe(true);
    game.destroy();
  });
});

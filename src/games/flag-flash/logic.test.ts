import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { flagFlash } from "./flag-flash";
import {
  advanceRound, BOTH_GRACE_MS, FEINT_MS, feintChance, matchOver, MAX_CALLS, MIN_WINDOW_MS, newRound,
  planBotCall, planBotFeint, RESOLVE_MS, START_WINDOW_MS, tap, windowMs, type RoundState,
} from "./logic";

/** Run the round until the next call appears (skipping feints), or fail. */
function toCall(s: RoundState, rng: Rng): void {
  for (let i = 0; i < 20000; i++) {
    if (advanceRound(s, 16, rng).includes("call")) return;
  }
  throw new Error("no call");
}

describe("flag flash logic", () => {
  it("window shrinks from 1.5s to a 0.5s floor; feints get more frequent", () => {
    expect(windowMs(0)).toBe(START_WINDOW_MS);
    expect(windowMs(5)).toBe(1000);
    expect(windowMs(10)).toBe(MIN_WINDOW_MS);
    expect(windowMs(30)).toBe(MIN_WINDOW_MS);
    expect(feintChance(6)).toBeGreaterThan(feintChance(0));
  });

  it("tapping during the gap or a feint knocks you out", () => {
    const rng = new Rng(1);
    const s = newRound(3, rng);
    expect(tap(s, 0, "left")).toBe("jumped");
    expect(s.seats[0]!.alive).toBe(false);
    expect(tap(s, 0, "left")).toBe("ignored");
    // Force a feint and bite on it.
    s.phase = "feint";
    s.t = 0;
    s.feintFlag = "RED";
    expect(tap(s, 1, "right")).toBe("jumped");
    expect(s.seats[1]!.outReason).toBe("jumped");
    advanceRound(s, FEINT_MS, rng);
    expect(s.phase).toBe("gap");
  });

  it("RED and BLUE want the matching half; NONE punishes any tap", () => {
    const rng = new Rng(2);
    const s = newRound(3, rng);
    toCall(s, rng);
    s.call = "RED";
    advanceRound(s, 200, rng);
    expect(tap(s, 0, "right")).toBe("wrong");
    expect(tap(s, 1, "left")).toBe("hit");
    expect(s.seats[1]!.hitMs).toBeGreaterThanOrEqual(200);
    expect(tap(s, 1, "left")).toBe("ignored");
    s.call = "NONE";
    expect(tap(s, 2, "left")).toBe("twitchy");
    expect(s.seats[2]!.outReason).toBe("twitchy");
  });

  it("BOTH needs two taps within the grace window", () => {
    const rng = new Rng(3);
    const s = newRound(2, rng);
    toCall(s, rng);
    s.call = "BOTH";
    advanceRound(s, 300, rng);
    expect(tap(s, 0, "left")).toBe("pending");
    advanceRound(s, 50, rng);
    expect(tap(s, 0, "right")).toBe("hit");
    expect(s.seats[0]!.hitMs).toBe(350);
    expect(tap(s, 1, "right")).toBe("pending");
    advanceRound(s, BOTH_GRACE_MS + 20, rng);
    expect(s.seats[1]!.alive).toBe(false);
    expect(s.seats[1]!.outReason).toBe("wrong");
  });

  it("too slow is out; last one standing wins the round", () => {
    const rng = new Rng(4);
    const s = newRound(3, rng);
    toCall(s, rng);
    s.call = "BLUE";
    advanceRound(s, 100, rng);
    expect(tap(s, 2, "right")).toBe("hit");
    const ev = advanceRound(s, s.windowMs, rng);
    expect(ev).toContain("resolved");
    expect(s.seats[0]!.outReason).toBe("slow");
    expect(s.seats[1]!.outReason).toBe("slow");
    const done = advanceRound(s, RESOLVE_MS, rng);
    expect(done).toContain("done");
    expect(s.winner).toBe(2);
    expect(advanceRound(s, 1000, rng)).toEqual([]);
  });

  it("everyone failing on the same call means nobody wins", () => {
    const rng = new Rng(5);
    const s = newRound(2, rng);
    toCall(s, rng);
    s.call = "RED";
    advanceRound(s, 100, rng);
    tap(s, 0, "right");
    tap(s, 1, "right");
    advanceRound(s, 16, rng);
    expect(s.phase).toBe("resolve");
    advanceRound(s, RESOLVE_MS, rng);
    expect(s.phase).toBe("done");
    expect(s.winner).toBeNull();
  });

  it("resolves early once everyone alive has answered, then calls again", () => {
    const rng = new Rng(6);
    const s = newRound(2, rng);
    toCall(s, rng);
    s.call = "RED";
    advanceRound(s, 100, rng);
    tap(s, 0, "left");
    tap(s, 1, "left");
    expect(advanceRound(s, 16, rng)).toContain("resolved");
    advanceRound(s, RESOLVE_MS, rng);
    expect(s.phase).toBe("gap");
    expect(s.seats.every((x) => x.alive)).toBe(true);
    toCall(s, rng);
    expect(s.callIndex).toBe(2);
    expect(s.windowMs).toBe(windowMs(1));
  });

  it("a round that drags on past the call cap is void", () => {
    const rng = new Rng(7);
    const s = newRound(2, rng);
    s.callIndex = MAX_CALLS;
    advanceRound(s, s.gapMs, rng);
    expect(s.phase).toBe("done");
    expect(s.winner).toBeNull();
  });

  it("bots answer 250-600ms in, 8% wrong early and worse at the floor", () => {
    const rng = new Rng(8);
    let wrongEarly = 0;
    let wrongLate = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const early = planBotCall("RED", START_WINDOW_MS, rng);
      expect(early).toHaveLength(1);
      expect(early[0]!.atMs).toBeGreaterThanOrEqual(250);
      expect(early[0]!.atMs).toBeLessThanOrEqual(600);
      if (early[0]!.half !== "left") wrongEarly++;
      const late = planBotCall("BLUE", MIN_WINDOW_MS, rng);
      if (late[0]!.half !== "right") wrongLate++;
    }
    expect(wrongEarly / n).toBeGreaterThan(0.04);
    expect(wrongEarly / n).toBeLessThan(0.13);
    expect(wrongLate).toBeGreaterThan(wrongEarly * 2);
    expect(planBotCall("NONE", START_WINDOW_MS, rng, 0)).toEqual([]);
    const both = planBotCall("BOTH", START_WINDOW_MS, rng, 0);
    expect(both).toHaveLength(2);
    expect(both[1]!.atMs - both[0]!.atMs).toBeLessThanOrEqual(BOTH_GRACE_MS);
    expect(planBotFeint(rng, 0)).toBeNull();
    expect(planBotFeint(rng, 1)).toBeLessThan(FEINT_MS);
  });

  it("match ends at 3 wins or 7 rounds", () => {
    expect(matchOver([2, 2], 6)).toBe(false);
    expect(matchOver([3, 0], 3)).toBe(true);
    expect(matchOver([2, 1, 1], 7)).toBe(true);
  });
});

describe("flag flash game", () => {
  it("an all-bot table plays to the end", () => {
    const canvas = { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const ctx = {
      width: 1280, height: 720, rng: new Rng(11), minTap: 44,
      players: [0, 1, 2, 3].map((slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
      canvas,
      input: { justPressed: () => false },
      sfx: new Proxy({}, { get: () => vi.fn() }),
    } as never;
    const game = flagFlash.create(ctx);
    for (let f = 0; f < 60 * 400 && !game.isFinished(); f++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    expect(game.getScores().some((s) => s.score > 0)).toBe(true);
    expect(game.getStats?.().some((s) => s.label === "Fastest response" && s.value.endsWith("ms"))).toBe(true);
    game.destroy();
    expect(canvas.removeEventListener).toHaveBeenCalled();
  });
});

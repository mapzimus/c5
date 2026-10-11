import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { flagFlash } from "./flag-flash";
import {
  advanceRound, bank, BITE_POINTS, BOTH_GRACE_MS, FEINT_MS, feintChance, heatConfig, heckle, isFinalHeat, MAX_HEATS, MIN_HEATS, OVERDRIVE_AT_MS,
  HECKLE_COOLDOWN_MS, HECKLE_DELAY_MS, HOT_STREAK, LATE_MS, MAX_CALLS, newRound, planBotBank, planBotCall,
  planBotFeint, planBotHeckle, POT_START, POT_STEP, RESOLVE_MS, secondWind, SHARE_POINTS, SHOWDOWN_CALLS, SWAP_MS, SWAP_SPACING,
  tap, wantHalf, windowMs, type RoundEvent, type RoundState,
} from "./logic";

/** Run the heat until the next call appears (skipping feints and swaps), or fail. */
function toCall(s: RoundState, rng: Rng): RoundEvent[] {
  const all: RoundEvent[] = [];
  for (let i = 0; i < 20000; i++) {
    const ev = advanceRound(s, 16, rng);
    all.push(...ev);
    if (ev.some((e) => e.type === "call")) return all;
  }
  throw new Error("no call");
}

function types(ev: RoundEvent[]): string[] {
  return ev.map((e) => e.type);
}

const cfg0 = heatConfig(0, false);

describe("flag flash logic", () => {
  it("window shrinks to a floor; feints ramp; overdrive is faster and worth double", () => {
    expect(windowMs(0, cfg0)).toBe(cfg0.startWindow);
    expect(windowMs(5, cfg0)).toBe(1000);
    expect(windowMs(30, cfg0)).toBe(cfg0.minWindow);
    expect(feintChance(6, cfg0)).toBeGreaterThan(feintChance(0, cfg0));
    const od = heatConfig(2, true);
    expect(od.overdrive).toBe(true);
    expect(heatConfig(2, false).overdrive).toBe(false);
    expect(isFinalHeat(1, OVERDRIVE_AT_MS * 2)).toBe(false); // at least three heats
    expect(isFinalHeat(2, OVERDRIVE_AT_MS)).toBe(true);
    expect(isFinalHeat(2, OVERDRIVE_AT_MS - 1)).toBe(false);
    expect(isFinalHeat(MAX_HEATS - 1, 0)).toBe(true);
    expect(MIN_HEATS).toBeLessThanOrEqual(MAX_HEATS);
    expect(od.mult).toBe(2);
    expect(od.startWindow).toBeLessThan(cfg0.startWindow);
    expect(od.feintBase).toBeGreaterThan(cfg0.feintBase);
  });

  it("swapped sides flip which half answers RED and BLUE", () => {
    expect(wantHalf("RED", false)).toBe("left");
    expect(wantHalf("BLUE", false)).toBe("right");
    expect(wantHalf("RED", true)).toBe("right");
    expect(wantHalf("BLUE", true)).toBe("left");
  });

  it("tapping during the gap, a feint or a swap knocks you out", () => {
    const rng = new Rng(1);
    const s = newRound(3, 0, rng);
    expect(tap(s, 0, "left")).toBe("jumped");
    expect(s.seats[0]!.alive).toBe(false);
    expect(tap(s, 0, "left")).toBe("ignored");
    s.phase = "feint";
    s.t = 0;
    s.feintFlag = "RED";
    expect(tap(s, 1, "right")).toBe("jumped");
    expect(s.seats[1]!.outReason).toBe("jumped");
    advanceRound(s, FEINT_MS, rng);
    expect(s.phase).toBe("gap");
    s.phase = "swap";
    s.t = 0;
    expect(tap(s, 2, "left")).toBe("jumped");
    // Nobody left: the heat is over.
    expect(advanceRound(s, SWAP_MS, rng).map((e) => e.type)).toContain("done");
    expect(s.phase).toBe("done");
  });

  it("RED and BLUE want the matching half and score; NONE punishes any tap", () => {
    const rng = new Rng(2);
    const s = newRound(3, 0, rng);
    toCall(s, rng);
    s.call = "RED";
    advanceRound(s, 200, rng);
    expect(tap(s, 0, "right")).toBe("wrong");
    expect(tap(s, 1, "left")).toBe("hit");
    expect(s.seats[1]!.hitMs).toBeGreaterThanOrEqual(200);
    expect(s.seats[1]!.points).toBe(1);
    expect(s.seats[1]!.streak).toBe(1);
    expect(tap(s, 1, "left")).toBe("ignored");
    s.call = "NONE";
    expect(tap(s, 2, "left")).toBe("twitchy");
    expect(s.seats[2]!.outReason).toBe("twitchy");
    const ev = advanceRound(s, 0, rng);
    expect(types(ev)).toEqual(["knockout", "score", "knockout"]);
  });

  it("after a swap the other half is right", () => {
    const rng = new Rng(12);
    const s = newRound(2, 0, rng);
    toCall(s, rng);
    s.call = "RED";
    s.swapped = true;
    advanceRound(s, 100, rng);
    expect(tap(s, 0, "left")).toBe("wrong");
    expect(tap(s, 1, "right")).toBe("hit");
  });

  it("BOTH needs two taps within the grace window", () => {
    const rng = new Rng(3);
    const s = newRound(2, 0, rng);
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

  it("too slow is out; a correct tap just after the window is a near miss", () => {
    const rng = new Rng(4);
    const s = newRound(3, 0, rng);
    toCall(s, rng);
    s.call = "BLUE";
    advanceRound(s, 100, rng);
    expect(tap(s, 2, "right")).toBe("hit");
    const ev = advanceRound(s, s.windowMs, rng);
    expect(types(ev)).toContain("resolved");
    expect(s.seats[0]!.outReason).toBe("slow");
    expect(s.seats[1]!.outReason).toBe("slow");
    // Seat 2 is alone: the resolve turns into a showdown.
    const done = advanceRound(s, RESOLVE_MS, rng);
    expect(types(done)).toContain("showdown");
    expect(s.showdown).toEqual({ seat: 2, pot: POT_START, calls: 0 });
    expect(s.phase).toBe("gap");
  });

  it("a late correct tap reads as SO CLOSE, a late wrong one is ignored", () => {
    const rng = new Rng(14);
    const s = newRound(2, 0, rng);
    toCall(s, rng);
    s.call = "RED";
    advanceRound(s, 100, rng);
    tap(s, 1, "left");
    s.seats[0]!.shield = true; // keep seat 0 alive through the slow knockout
    advanceRound(s, s.windowMs, rng);
    expect(s.phase).toBe("resolve");
    expect(s.seats[0]!.alive).toBe(true);
    expect(s.seats[0]!.saved).toBe(true);
    // Saved seats are not "late"; use a fresh seat state to check the near miss.
    s.seats[0]!.saved = false;
    advanceRound(s, LATE_MS / 2, rng);
    expect(tap(s, 0, "right")).toBe("ignored");
    expect(tap(s, 0, "left")).toBe("late");
    advanceRound(s, LATE_MS, rng);
    expect(tap(s, 0, "left")).toBe("ignored");
  });

  it("NONE survived counts as a hit; three in a row is HOT and pays double", () => {
    const rng = new Rng(5);
    const s = newRound(1, 0, rng);
    for (let k = 0; k < HOT_STREAK + 1; k++) {
      toCall(s, rng);
      s.call = "NONE";
      const ev = advanceRound(s, s.windowMs, rng);
      const scores = ev.filter((e) => e.type === "score");
      expect(scores.length).toBe(k + 1 >= HOT_STREAK ? 2 : 1);
      advanceRound(s, RESOLVE_MS, rng);
    }
    expect(s.seats[0]!.streak).toBe(HOT_STREAK + 1);
    expect(s.seats[0]!.points).toBe(HOT_STREAK + 1 + 2);
  });

  it("everyone failing on the same call ends the heat with no winner", () => {
    const rng = new Rng(6);
    const s = newRound(2, 0, rng);
    toCall(s, rng);
    s.call = "RED";
    advanceRound(s, 100, rng);
    tap(s, 0, "right");
    tap(s, 1, "right");
    advanceRound(s, 16, rng);
    expect(s.phase).toBe("resolve");
    const ev = advanceRound(s, RESOLVE_MS, rng);
    expect(types(ev)).toContain("done");
    expect(s.winner).toBeNull();
    expect(advanceRound(s, 1000, rng)).toEqual([]);
  });

  it("resolves early once everyone alive has answered, then calls again", () => {
    const rng = new Rng(7);
    const s = newRound(2, 0, rng);
    toCall(s, rng);
    s.call = "RED";
    advanceRound(s, 100, rng);
    tap(s, 0, "left");
    tap(s, 1, "left");
    expect(types(advanceRound(s, 16, rng))).toContain("resolved");
    advanceRound(s, RESOLVE_MS, rng);
    expect(s.phase).toBe("gap");
    expect(s.seats.every((x) => x.alive)).toBe(true);
    toCall(s, rng);
    expect(s.callIndex).toBe(2);
    expect(s.windowMs).toBe(windowMs(1, cfg0));
  });

  it("a heckler arms a feint that fires in the next gap and scores when a survivor bites", () => {
    const rng = new Rng(8);
    const s = newRound(3, 0, rng);
    expect(heckle(s, 0)).toBe("ignored"); // still alive
    tap(s, 0, "left");
    advanceRound(s, 0, rng);
    expect(s.seats[0]!.alive).toBe(false);
    expect(heckle(s, 0)).toBe("armed");
    expect(heckle(s, 0)).toBe("ignored"); // already armed
    s.t = 0;
    const ev = advanceRound(s, HECKLE_DELAY_MS, rng);
    expect(ev).toContainEqual({ type: "feint", owner: 0 });
    expect(s.phase).toBe("feint");
    expect(s.seats[0]!.heckleCooldown).toBe(HECKLE_COOLDOWN_MS);
    expect(heckle(s, 0)).toBe("cooling");
    expect(tap(s, 1, "left")).toBe("jumped");
    const after = advanceRound(s, 0, rng);
    expect(after).toContainEqual({ type: "knockout", seat: 1, reason: "jumped", by: 0 });
    expect(after).toContainEqual({ type: "score", seat: 0, points: BITE_POINTS, why: "bite" });
    expect(s.seats[0]!.bites).toBe(1);
    expect(s.seats[0]!.points).toBe(BITE_POINTS);
    // The feint ends and the heat carries on towards a call.
    advanceRound(s, FEINT_MS, rng);
    expect(s.phase).toBe("gap");
    expect(types(toCall(s, rng))).toContain("call");
    // Cooldown ticks down over time.
    expect(s.seats[0]!.heckleCooldown).toBeLessThan(HECKLE_COOLDOWN_MS);
  });

  it("the showdown pot grows per survived call and banks on demand", () => {
    const rng = new Rng(9);
    const s = newRound(2, 0, rng);
    tap(s, 0, "left");
    // With two seats the first fall opens the showdown at once.
    expect(types(advanceRound(s, 0, rng))).toEqual(["knockout", "showdown"]);
    expect(s.showdown).toEqual({ seat: 1, pot: POT_START, calls: 0 });
    expect(bank(s, 0)).toBe("ignored");
    // Survive one call: the pot grows.
    toCall(s, rng);
    s.call = "BLUE";
    advanceRound(s, 100, rng);
    expect(tap(s, 1, "right")).toBe("hit");
    const ev = advanceRound(s, 16, rng);
    expect(ev.filter((e) => e.type === "score")).toHaveLength(0);
    expect(ev).toContainEqual({ type: "pot", seat: 1, pot: POT_START + POT_STEP });
    expect(bank(s, 1)).toBe("ignored"); // not during resolve
    advanceRound(s, RESOLVE_MS, rng);
    expect(s.phase).toBe("gap");
    expect(bank(s, 1)).toBe("banked");
    expect(s.phase).toBe("done");
    expect(s.winner).toBe(1);
    expect(s.seats[1]!.points).toBe(POT_START + POT_STEP); // showdown hits feed the pot, not the score
    expect(advanceRound(s, 0, rng)).toContainEqual({ type: "score", seat: 1, points: POT_START + POT_STEP, why: "bank" });
  });

  it("the survivor loses the pot by biting a heckle, and the heckler scores", () => {
    const rng = new Rng(10);
    const s = newRound(2, 0, rng);
    tap(s, 0, "left");
    advanceRound(s, 0, rng);
    s.showdown = { seat: 1, pot: 7, calls: 2 };
    heckle(s, 0);
    s.t = 0;
    advanceRound(s, HECKLE_DELAY_MS, rng);
    expect(s.phase).toBe("feint");
    expect(tap(s, 1, "right")).toBe("jumped");
    const ev = advanceRound(s, 0, rng);
    expect(ev).toContainEqual({ type: "potlost", seat: 1, pot: 7 });
    expect(s.seats[0]!.points).toBe(BITE_POINTS);
    expect(s.seats[1]!.points).toBe(0);
    expect(s.phase).toBe("done");
    expect(s.winner).toBeNull();
  });

  it("the last two biting the same feint ends the heat; one biting opens the showdown", () => {
    const rng = new Rng(18);
    const s = newRound(3, 0, rng);
    s.phase = "feint";
    s.feintFlag = "BLUE";
    expect(tap(s, 0, "right")).toBe("jumped");
    expect(s.showdown).toBeNull();
    expect(tap(s, 1, "right")).toBe("jumped");
    expect(s.showdown?.seat).toBe(2);
    expect(types(advanceRound(s, 0, rng))).toContain("showdown");
    expect(tap(s, 2, "left")).toBe("jumped");
    expect(s.phase).toBe("done");
  });

  it("the pot banks itself after the showdown call cap", () => {
    const rng = new Rng(11);
    const s = newRound(1, 0, rng);
    s.showdown = { seat: 0, pot: POT_START, calls: SHOWDOWN_CALLS - 1 };
    toCall(s, rng);
    s.call = "NONE";
    advanceRound(s, s.windowMs, rng);
    const ev = advanceRound(s, RESOLVE_MS, rng);
    expect(types(ev)).toEqual(["score", "done"]);
    expect(s.winner).toBe(0);
    expect(s.seats[0]!.points).toBe(POT_START + POT_STEP);
  });

  it("a second-wind shield absorbs one mistake, then you are on your own", () => {
    const rng = new Rng(13);
    const s = newRound(2, 0, rng, [true, false]);
    expect(tap(s, 0, "left")).toBe("saved");
    expect(s.seats[0]!.alive).toBe(true);
    expect(s.seats[0]!.shield).toBe(false);
    expect(types(advanceRound(s, 0, rng))).toEqual(["shield"]);
    expect(tap(s, 0, "left")).toBe("jumped");
    expect(secondWind([3, 7, 3, 9])).toEqual([true, false, true, false]);
    expect(secondWind([4, 4])).toEqual([false, false]);
  });

  it("a heat that drags past the call cap ends with the survivors sharing", () => {
    const rng = new Rng(15);
    const s = newRound(2, 0, rng);
    s.callIndex = MAX_CALLS;
    const ev = advanceRound(s, s.gapMs, rng);
    expect(s.phase).toBe("done");
    expect(s.winner).toBeNull();
    expect(ev.filter((e) => e.type === "score" && e.why === "share")).toHaveLength(2);
    expect(s.seats[0]!.points).toBe(SHARE_POINTS);
  });

  it("sides swap now and then, never twice in quick succession, and any tap during it jumps", () => {
    const rng = new Rng(16);
    const s = newRound(2, 0, rng);
    s.cfg = { ...s.cfg, swapChance: 1 };
    s.callIndex = 5;
    const ev = advanceRound(s, s.gapMs, rng);
    expect(types(ev)).toEqual(["swap"]);
    expect(s.phase).toBe("swap");
    expect(s.swapped).toBe(true);
    expect(tap(s, 0, "left")).toBe("jumped");
    advanceRound(s, SWAP_MS, rng);
    expect(s.phase).toBe("gap");
    advanceRound(s, s.gapMs, rng);
    expect(s.phase).not.toBe("swap"); // spacing rule
    s.phase = "gap";
    s.t = 0;
    s.callIndex = 5 + SWAP_SPACING;
    advanceRound(s, s.gapMs, rng);
    expect(s.phase).toBe("swap");
    expect(s.swapped).toBe(false);
  });

  it("bots answer 250-600ms in, 8% wrong early, worse at the floor and after a swap", () => {
    const rng = new Rng(17);
    let wrongEarly = 0;
    let wrongLate = 0;
    let wrongDazed = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const early = planBotCall("RED", cfg0.startWindow, cfg0, false, rng);
      expect(early).toHaveLength(1);
      expect(early[0]!.atMs).toBeGreaterThanOrEqual(250);
      expect(early[0]!.atMs).toBeLessThanOrEqual(600);
      if (early[0]!.half !== "left") wrongEarly++;
      const late = planBotCall("BLUE", cfg0.minWindow, cfg0, false, rng);
      if (late[0]!.half !== "right") wrongLate++;
      const dazed = planBotCall("RED", cfg0.startWindow, cfg0, true, rng, 0.08, 0.25);
      if (dazed[0]!.half !== "right") wrongDazed++;
    }
    expect(wrongEarly / n).toBeGreaterThan(0.04);
    expect(wrongEarly / n).toBeLessThan(0.13);
    expect(wrongLate).toBeGreaterThan(wrongEarly * 2);
    expect(wrongDazed).toBeGreaterThan(wrongEarly * 2);
    expect(planBotCall("NONE", cfg0.startWindow, cfg0, false, rng, 0)).toEqual([]);
    const both = planBotCall("BOTH", cfg0.startWindow, cfg0, false, rng, 0);
    expect(both).toHaveLength(2);
    expect(both[1]!.atMs - both[0]!.atMs).toBeLessThanOrEqual(BOTH_GRACE_MS);
    expect(planBotFeint(rng, 0)).toBeNull();
    expect(planBotFeint(rng, 1)).toBeLessThan(FEINT_MS);
    expect(planBotHeckle(rng, 0)).toBeNull();
    expect(planBotHeckle(rng, 1)).toBeGreaterThanOrEqual(0);
    let banks = 0;
    for (let i = 0; i < n; i++) if (planBotBank(4, rng)) banks++;
    expect(banks / n).toBeGreaterThan(0.6);
  });
});

describe("flag flash game", () => {
  function play(seatCount: number, seed: number): { seconds: number; game: ReturnType<typeof flagFlash.create>; canvas: { removeEventListener: ReturnType<typeof vi.fn> } } {
    const canvas = { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const ctx = {
      width: 1280, height: 720, rng: new Rng(seed), minTap: 44,
      players: Array.from({ length: seatCount }, (_, slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
      canvas,
      input: { justPressed: () => false },
      sfx: new Proxy({}, { get: () => vi.fn() }),
    } as never;
    const game = flagFlash.create(ctx);
    let frames = 0;
    for (; frames < 60 * 400 && !game.isFinished(); frames++) game.update(1 / 60);
    return { seconds: frames / 60, game, canvas };
  }

  it("an all-bot table plays to the end in 45-100 seconds", () => {
    for (const [seats, seed] of [[2, 11], [4, 12], [3, 13], [4, 14], [2, 15], [2, 16], [2, 17], [4, 18], [4, 19], [3, 20]] as const) {
      const { seconds, game, canvas } = play(seats, seed);
      expect(game.isFinished()).toBe(true);
      expect(seconds).toBeGreaterThan(40);
      expect(seconds).toBeLessThan(105);
      expect(game.getScores().some((s) => s.score > 0)).toBe(true);
      expect(game.getStats?.().some((s) => s.label === "Fastest response" && s.value.endsWith("ms"))).toBe(true);
      game.destroy();
      expect(canvas.removeEventListener).toHaveBeenCalled();
    }
  });
});

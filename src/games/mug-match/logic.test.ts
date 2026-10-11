import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { mugMatch } from "./mug-match";
import {
  baseParams, botPickTarget, botSnapCheck, botSnapThreshold, eyeRadius, flashMult, handlesFromParams, knockHandle,
  matchPercent, newSpring, paramsFromHandles, planBot, randomTarget, roundSeconds, roundStakes, scoreTier,
  snapScore, stepBot, stepSpring, underdogs,
  FINAL_STAKES, HANDLE_COUNT, HANDLE_LIMIT, PARAM_COUNT, LEFT_BROW, RIGHT_BROW, ROUNDS,
} from "./logic";

describe("mug shots logic", () => {
  it("round-trips params through handles", () => {
    const rng = new Rng(5);
    for (let i = 0; i < 50; i++) {
      const p = Array.from({ length: PARAM_COUNT }, () => rng.float(0, 1));
      const h = handlesFromParams(p);
      expect(h).toHaveLength(HANDLE_COUNT);
      const back = paramsFromHandles(h);
      for (let k = 0; k < PARAM_COUNT; k++) expect(back[k]).toBeCloseTo(p[k]!, 6);
    }
  });

  it("scores 100 for a match and less the further off you are", () => {
    const base = baseParams();
    expect(matchPercent(base, base)).toBe(100);
    const near = base.map((v) => v + 0.05);
    const far = base.map((v) => v + 0.3);
    expect(matchPercent(base, near)).toBeGreaterThanOrEqual(87);
    expect(matchPercent(base, near)).toBeLessThanOrEqual(88);
    expect(matchPercent(base, far)).toBe(25);
    expect(matchPercent(base, base.map(() => 2))).toBe(0);
  });

  it("raising the brows makes the eyes bulge", () => {
    const h = handlesFromParams(baseParams());
    const r0 = eyeRadius(h);
    h[LEFT_BROW]!.y -= 0.2;
    h[RIGHT_BROW]!.y -= 0.2;
    expect(eyeRadius(h)).toBeGreaterThan(r0);
  });

  it("targets get more absurd each round and a blank mug is never worth snapping", () => {
    const rng = new Rng(2);
    const avg: number[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      let sum = 0;
      let blank = 0;
      for (let i = 0; i < 200; i++) {
        const t = randomTarget(round, rng);
        for (const v of t) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
          sum += Math.abs(v - 0.5);
        }
        blank += matchPercent(baseParams(), t);
      }
      avg.push(sum / (200 * PARAM_COUNT));
      // Even at x2 a blank mug loses to a decent sculpt at x1.
      expect(blank / 200).toBeLessThan(40);
    }
    for (let r = 1; r < ROUNDS; r++) expect(avg[r]!).toBeGreaterThan(avg[r - 1]!);
  });

  it("rounds get shorter and the final pays double", () => {
    for (let r = 1; r < ROUNDS; r++) expect(roundSeconds(r)).toBeLessThanOrEqual(roundSeconds(r - 1));
    expect(roundSeconds(ROUNDS + 5)).toBe(roundSeconds(ROUNDS - 1));
    expect(roundStakes(0)).toBe(1);
    expect(roundStakes(ROUNDS - 1)).toBe(FINAL_STAKES);
  });

  it("the flash bonus drains from x2 to x1 and a rough early snap can beat a late perfect one", () => {
    expect(flashMult(12, 12)).toBe(2);
    expect(flashMult(6, 12)).toBe(1.5);
    expect(flashMult(0, 12)).toBe(1);
    expect(flashMult(-3, 12)).toBe(1);
    expect(snapScore(100, 0, 12, 0)).toBe(100);
    expect(snapScore(60, 9, 12, 0)).toBe(105);
    expect(snapScore(60, 9, 12, ROUNDS - 1)).toBe(210);
  });

  it("names the tiers with a near miss just under perfect", () => {
    expect(scoreTier(95)).toBe("PERFECT");
    expect(scoreTier(90)).toBe("PERFECT");
    expect(scoreTier(87)).toBe("SO CLOSE");
    expect(scoreTier(70)).toBe("NICE");
    expect(scoreTier(45)).toBe("MEH");
    expect(scoreTier(10)).toBe("WHO?");
  });

  it("only the trailing seats get the underdog guide", () => {
    expect(underdogs([0, 0, 0])).toEqual([]);
    expect(underdogs([120, 80, 200, 80])).toEqual([1, 3]);
    expect(underdogs([50, 90])).toEqual([0]);
    expect(underdogs([70])).toEqual([]);
  });

  it("a tomato knocks a handle a noticeable distance and keeps it in bounds", () => {
    const rng = new Rng(3);
    for (let i = 0; i < 100; i++) {
      const h = { x: rng.float(-1.4, 1.4), y: rng.float(-1.4, 1.4) };
      const k = knockHandle(h, rng);
      expect(Math.abs(k.x)).toBeLessThanOrEqual(HANDLE_LIMIT);
      expect(Math.abs(k.y)).toBeLessThanOrEqual(HANDLE_LIMIT);
      if (Math.abs(h.x) < 1 && Math.abs(h.y) < 1) expect(Math.hypot(k.x - h.x, k.y - h.y)).toBeGreaterThan(0.19);
    }
  });

  it("the skin spring settles onto the handles", () => {
    const h = handlesFromParams(baseParams());
    const s = newSpring(h);
    h[0]!.x -= 0.4;
    for (let i = 0; i < 120; i++) stepSpring(s, h, 1 / 60);
    expect(s.pos[0]!.x).toBeCloseTo(h[0]!.x, 2);
  });

  it("a bot drags one handle at a time and lands near the target", () => {
    const rng = new Rng(8);
    const target = randomTarget(2, rng);
    const handles = handlesFromParams(baseParams());
    const bot = planBot(target, 0.05, rng);
    let movedTwo = false;
    for (let f = 0; f < 60 * 12; f++) {
      const before = handles.map((p) => ({ ...p }));
      stepBot(bot, handles, 1 / 60, rng);
      const moved = handles.filter((p, i) => p.x !== before[i]!.x || p.y !== before[i]!.y).length;
      if (moved > 1) movedTwo = true;
    }
    expect(movedTwo).toBe(false);
    expect(bot.queue).toHaveLength(0);
    expect(matchPercent(paramsFromHandles(handles), target)).toBeGreaterThan(80);
  });

  it("a bot goes back and repairs a handle a tomato knocked", () => {
    const rng = new Rng(9);
    const target = randomTarget(1, rng);
    const handles = handlesFromParams(baseParams());
    const bot = planBot(target, 0.05, rng);
    for (let f = 0; f < 60 * 12; f++) stepBot(bot, handles, 1 / 60, rng);
    const settled = matchPercent(paramsFromHandles(handles), target);
    handles[0] = knockHandle(handles[0]!, rng);
    expect(matchPercent(paramsFromHandles(handles), target)).toBeLessThan(settled);
    for (let f = 0; f < 60 * 4; f++) stepBot(bot, handles, 1 / 60, rng);
    expect(matchPercent(paramsFromHandles(handles), target)).toBeGreaterThanOrEqual(settled - 1);
  });

  it("bots snap sooner the less time is left, and hesitate before pressing", () => {
    expect(botSnapThreshold(1, 0)).toBeGreaterThan(botSnapThreshold(0.5, 0));
    expect(botSnapThreshold(0.5, 0)).toBeGreaterThan(botSnapThreshold(0, 0));
    expect(botSnapThreshold(0.5, 1)).toBeLessThan(botSnapThreshold(0.5, 0));
    const rng = new Rng(4);
    const bot = planBot(baseParams(), 0.1, rng, 0.5);
    // A terrible mug with most of the round left: no snap.
    for (let f = 0; f < 60; f++) expect(botSnapCheck(bot, 20, 0.9, 1 / 60, rng)).toBe(false);
    // A great mug: decides, then commits within a second.
    let frames = 0;
    let snapped = false;
    while (frames < 120 && !snapped) { snapped = botSnapCheck(bot, 95, 0.9, 1 / 60, rng); frames++; }
    expect(snapped).toBe(true);
    expect(frames).toBeGreaterThan(10);
  });

  it("bots throw at whoever is still sculpting and most dangerous", () => {
    expect(botPickTarget([
      { index: 0, snapped: true, threat: 99 },
      { index: 1, snapped: false, threat: 40 },
      { index: 2, snapped: false, threat: 70 },
    ])).toBe(2);
    expect(botPickTarget([{ index: 0, snapped: true, threat: 99 }])).toBe(-1);
  });
});

describe("mug shots game", () => {
  function makeCtx(count: number, seed: number) {
    return {
      width: 1280, height: 720, rng: new Rng(seed), minTap: 44,
      players: Array.from({ length: count }, (_, slot) => ({
        id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot,
      })),
      canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) },
      input: { justPressed: () => false },
      sfx: new Proxy({}, { get: () => vi.fn() }),
    } as never;
  }

  it("an all-bot table plays every round to the end inside the party window", () => {
    for (const [count, seed] of [[2, 11], [4, 12]] as const) {
      const ctx = makeCtx(count, seed);
      const game = mugMatch.create(ctx);
      let frames = 0;
      for (; frames < 60 * 100 && !game.isFinished(); frames++) game.update(1 / 60);
      expect(game.isFinished()).toBe(true);
      expect(frames / 60).toBeGreaterThan(30);
      expect(frames / 60).toBeLessThan(100);
      for (const s of game.getScores()) {
        expect(s.score).toBeGreaterThan(0);
        expect(s.score).toBeLessThanOrEqual(100 * 2 * (ROUNDS - 1 + FINAL_STAKES) + 10 * ROUNDS);
      }
      const stats = game.getStats?.() ?? [];
      expect(stats.some((s) => s.label === "Best shot")).toBe(true);
      expect(stats.some((s) => s.label === "Splats")).toBe(true);
      const rounds = stats.filter((s) => s.label === "Rounds");
      for (const r of rounds) expect(r.value.split(" / ")).toHaveLength(ROUNDS);
      game.destroy();
      expect((ctx as { canvas: { removeEventListener: ReturnType<typeof vi.fn> } }).canvas.removeEventListener).toHaveBeenCalledTimes(4);
    }
  });

  it("bots actually snap before the buzzer and throw tomatoes", () => {
    const game = mugMatch.create(makeCtx(4, 21));
    for (let f = 0; f < 60 * 100 && !game.isFinished(); f++) game.update(1 / 60);
    const stats = game.getStats?.() ?? [];
    const splats = stats.filter((s) => s.label === "Splats").reduce((sum, s) => sum + Number(s.value), 0);
    expect(splats).toBeGreaterThan(0);
    const bestShots = stats.filter((s) => s.label === "Best shot").map((s) => Number(s.value));
    // A best shot above 100 can only come from the flash bonus or the final round, i.e. a real snap decision.
    expect(Math.max(...bestShots)).toBeGreaterThan(100);
    game.destroy();
  });
});

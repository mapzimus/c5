import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { mugMatch } from "./mug-match";
import {
  baseParams, eyeRadius, handlesFromParams, matchPercent, newSpring, paramsFromHandles, planBot,
  randomTarget, stepBot, stepSpring, HANDLE_COUNT, PARAM_COUNT, LEFT_BROW, RIGHT_BROW, ROUNDS,
} from "./logic";

describe("mug match logic", () => {
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
    expect(matchPercent(base, near)).toBe(90);
    expect(matchPercent(base, far)).toBe(40);
    expect(matchPercent(base, base.map(() => 2))).toBe(0);
  });

  it("raising the brows makes the eyes bulge", () => {
    const h = handlesFromParams(baseParams());
    const r0 = eyeRadius(h);
    h[LEFT_BROW]!.y -= 0.2;
    h[RIGHT_BROW]!.y -= 0.2;
    expect(eyeRadius(h)).toBeGreaterThan(r0);
  });

  it("targets get more absurd each round", () => {
    const rng = new Rng(2);
    const avg: number[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      let sum = 0;
      for (let i = 0; i < 200; i++) {
        const t = randomTarget(round, rng);
        for (const v of t) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
          sum += Math.abs(v - 0.5);
        }
      }
      avg.push(sum / (200 * PARAM_COUNT));
    }
    expect(avg[1]!).toBeGreaterThan(avg[0]!);
    expect(avg[2]!).toBeGreaterThan(avg[1]!);
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
});

describe("mug match game", () => {
  it("an all-bot table plays three rounds to the end", () => {
    const ctx = {
      width: 1280, height: 720, rng: new Rng(11), minTap: 44,
      players: [0, 1, 2, 3].map((slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
      canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) },
      input: { justPressed: () => false },
      sfx: new Proxy({}, { get: () => vi.fn() }),
    } as never;
    const game = mugMatch.create(ctx);
    for (let f = 0; f < 60 * 90 && !game.isFinished(); f++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    for (const s of game.getScores()) {
      expect(s.score).toBeGreaterThan(0);
      expect(s.score).toBeLessThanOrEqual(100 * ROUNDS);
    }
    const stats = game.getStats?.() ?? [];
    expect(stats.some((s) => s.label === "Best match %")).toBe(true);
    game.destroy();
  });
});

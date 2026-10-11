import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { towerTopple } from "./tower-topple";
import {
  FIRE_STREAK, PERFECT_REGROW, START_WIDTH, dropScore, isOver, nextSeat, perfectWidth, regrow, sliceDrop, wobbleKick,
} from "./rules";

describe("tower topple rules", () => {
  const top = { x: 640, w: 200 };

  it("perfect drop keeps width and snaps to the top", () => {
    const r = sliceDrop(top, 644, 200);
    expect(r).toEqual({ kind: "perfect", block: { x: 640, w: 200 } });
  });

  it("slices the overhang off", () => {
    const r = sliceDrop(top, 690, 200);
    expect(r.kind).toBe("hit");
    if (r.kind !== "hit") return;
    expect(r.block.w).toBe(150);
    expect(r.block.x).toBe(665);
    expect(r.cut.w).toBe(50);
    expect(r.cut.x).toBe(765);
  });

  it("slices the left overhang", () => {
    const r = sliceDrop(top, 600, 200);
    if (r.kind !== "hit") throw new Error("expected hit");
    expect(r.block).toEqual({ x: 620, w: 160 });
    expect(r.cut).toEqual({ x: 520, w: 40 });
  });

  it("misses entirely", () => {
    expect(sliceDrop(top, 900, 200).kind).toBe("miss");
  });

  it("regrow caps at start width", () => {
    expect(regrow({ x: 1, w: 30 }).w).toBe(80);
    expect(regrow({ x: 1, w: START_WIDTH - 5 }).w).toBe(START_WIDTH);
  });

  it("skips out players and ends with one left", () => {
    const seats = [{ lives: 0, drops: 3 }, { lives: 2, drops: 3 }, { lives: 1, drops: 3 }];
    expect(nextSeat(seats, 2)).toBe(1);
    expect(isOver(seats)).toBe(false);
    seats[2]!.lives = 0;
    expect(isOver(seats)).toBe(true);
  });

  it("ends when everyone used their drops", () => {
    expect(isOver([{ lives: 3, drops: 12 }, { lives: 1, drops: 12 }])).toBe(true);
  });
});

describe("tower topple game", () => {
  it("an all-bot table plays to the end", () => {
    const ctx = {
      width: 1280, height: 720, rng: new Rng(7), minTap: 44,
      players: [0, 1, 2].map((slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
      canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      input: { justPressed: () => false },
      sfx: new Proxy({}, { get: () => vi.fn() }),
    } as never;
    const game = towerTopple.create(ctx);
    for (let f = 0; f < 60 * 60 * 5 && !game.isFinished(); f++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    expect(game.getScores().some((s) => s.score > 0)).toBe(true);
    game.destroy();
  });
});

describe("tower topple streaks and wobble", () => {
  it("perfect streaks pay more, capped", () => {
    const perfect = sliceDrop({ x: 640, w: 200 }, 640, 200);
    expect(dropScore(perfect, 1)).toBe(2);
    expect(dropScore(perfect, 2)).toBe(3);
    expect(dropScore(perfect, 9)).toBe(6);
    expect(dropScore(sliceDrop({ x: 640, w: 200 }, 700, 200), 5)).toBe(1);
  });

  it("perfects grow the block back, faster on fire", () => {
    expect(perfectWidth(100, 1)).toBe(100 + PERFECT_REGROW);
    expect(perfectWidth(100, FIRE_STREAK)).toBe(100 + PERFECT_REGROW * 2);
    expect(perfectWidth(START_WIDTH - 1, 1)).toBe(START_WIDTH);
  });

  it("sloppier drops kick the tower harder", () => {
    const top = { x: 640, w: 200 };
    const small = wobbleKick(sliceDrop(top, 650, 200), 5);
    const big = wobbleKick(sliceDrop(top, 720, 200), 5);
    expect(small).toBeGreaterThan(0);
    expect(big).toBeGreaterThan(small);
    expect(wobbleKick(sliceDrop(top, 640, 200), 5)).toBe(0);
    expect(wobbleKick(sliceDrop(top, 900, 200), 5)).toBe(0);
  });
});

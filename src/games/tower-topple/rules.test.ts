import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { towerTopple } from "./tower-topple";
import {
  BREATH_FILL, FIRE_STREAK, PERFECT_REGROW, PERFECT_TOLERANCE, START_WIDTH, UNDERDOG_TOLERANCE,
  breathRate, dropScore, dropsEach, gustLeanKick, isFinalRound, isNearMiss, isOver, nextSeat, perfectWidth, regrow,
  sliceDrop, swingSpeed, toppleCount, toppleLosses, underdogs, wobbleKick,
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

  it("the underdog gets a wider perfect window", () => {
    expect(sliceDrop(top, 640 + PERFECT_TOLERANCE + 2, 200).kind).toBe("hit");
    expect(sliceDrop(top, 640 + PERFECT_TOLERANCE + 2, 200, UNDERDOG_TOLERANCE).kind).toBe("perfect");
  });

  it("flags a near miss just outside the perfect window", () => {
    expect(isNearMiss(top, 640 + PERFECT_TOLERANCE + 1)).toBe(true);
    expect(isNearMiss(top, 640 + PERFECT_TOLERANCE + 40)).toBe(false);
    expect(isNearMiss(top, 641)).toBe(false);
  });

  it("regrow caps at start width", () => {
    expect(regrow({ x: 1, w: 30 }).w).toBe(80);
    expect(regrow({ x: 1, w: START_WIDTH - 5 }).w).toBe(START_WIDTH);
  });

  it("gives fewer drops at a bigger table", () => {
    expect(dropsEach(2)).toBe(12);
    expect(dropsEach(3)).toBe(10);
    expect(dropsEach(4)).toBe(8);
  });

  it("skips out players and ends with one left", () => {
    const seats = [{ lives: 0, drops: 3 }, { lives: 2, drops: 3 }, { lives: 1, drops: 3 }];
    expect(nextSeat(seats, 2, 10)).toBe(1);
    expect(isOver(seats, 10)).toBe(false);
    seats[2]!.lives = 0;
    expect(isOver(seats, 10)).toBe(true);
  });

  it("ends when everyone used their drops", () => {
    expect(isOver([{ lives: 3, drops: 12 }, { lives: 1, drops: 12 }], 12)).toBe(true);
    expect(isOver([{ lives: 3, drops: 11 }, { lives: 1, drops: 12 }], 12)).toBe(false);
  });

  it("the final round starts when every living seat is on its last drop", () => {
    expect(isFinalRound([{ lives: 3, drops: 7 }, { lives: 2, drops: 7 }], 8)).toBe(true);
    expect(isFinalRound([{ lives: 3, drops: 6 }, { lives: 2, drops: 7 }], 8)).toBe(false);
    expect(isFinalRound([{ lives: 0, drops: 2 }, { lives: 2, drops: 7 }], 8)).toBe(true);
  });

  it("swings faster as the tower grows and in the final round", () => {
    expect(swingSpeed(10)).toBeGreaterThan(swingSpeed(0));
    expect(swingSpeed(10, true)).toBeGreaterThan(swingSpeed(10));
  });
});

describe("tower topple gusts and topples", () => {
  it("sheds the top 40% of the tower, at least two blocks, never the base", () => {
    expect(toppleCount(0)).toBe(0);
    expect(toppleCount(1)).toBe(0);
    expect(toppleCount(2)).toBe(2);
    expect(toppleCount(10)).toBe(4);
    expect(toppleCount(20)).toBe(8);
  });

  it("charges each owner one point per fallen block", () => {
    const losses = toppleLosses([0, 2, 2, -1, 0]);
    expect(losses.get(0)).toBe(2);
    expect(losses.get(2)).toBe(2);
    expect(losses.has(-1)).toBe(false);
  });

  it("gusts rock taller towers harder, with a cap", () => {
    expect(gustLeanKick(10)).toBeGreaterThan(gustLeanKick(0));
    expect(gustLeanKick(100)).toBe(gustLeanKick(40));
  });

  it("eliminated seats become ghost wind and the final round is windier", () => {
    const alive = { lives: 2, drops: 0 };
    const ghost = { lives: 0, drops: 0 };
    expect(breathRate(alive, false)).toBeCloseTo(1 / BREATH_FILL);
    expect(breathRate(ghost, false)).toBeCloseTo(2 / BREATH_FILL);
    expect(breathRate(alive, true)).toBeGreaterThan(breathRate(alive, false));
  });

  it("marks the lowest living score as underdog only when someone is ahead", () => {
    expect(underdogs([5, 2, 9], [true, true, true])).toEqual([false, true, false]);
    expect(underdogs([4, 4], [true, true])).toEqual([false, false]);
    expect(underdogs([1, 7], [false, true])).toEqual([false, false]);
    expect(underdogs([3, 3, 8], [true, true, true])).toEqual([true, true, false]);
  });
});

describe("tower topple streaks and wobble", () => {
  it("perfect streaks pay more, capped, and double in the final round", () => {
    const perfect = sliceDrop({ x: 640, w: 200 }, 640, 200);
    expect(dropScore(perfect, 1)).toBe(2);
    expect(dropScore(perfect, 2)).toBe(3);
    expect(dropScore(perfect, 9)).toBe(6);
    expect(dropScore(perfect, 2, 2)).toBe(6);
    expect(dropScore(sliceDrop({ x: 640, w: 200 }, 700, 200), 5)).toBe(1);
    expect(dropScore(sliceDrop({ x: 640, w: 200 }, 700, 200), 5, 2)).toBe(2);
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

describe("tower topple game", () => {
  function context(players: number, seed = 7) {
    return {
      width: 1280, height: 720, rng: new Rng(seed), minTap: 44,
      players: Array.from({ length: players }, (_, slot) => ({
        id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot,
      })),
      canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      input: { justPressed: () => false },
      sfx: new Proxy({}, { get: () => vi.fn() }),
    } as never;
  }

  it("an all-bot table plays to the end in under 100 seconds", () => {
    for (const n of [2, 4]) {
      const game = towerTopple.create(context(n));
      let frames = 0;
      for (; frames < 60 * 100 && !game.isFinished(); frames++) game.update(1 / 60);
      expect(game.isFinished()).toBe(true);
      expect(frames / 60).toBeLessThan(100);
      expect(game.getScores().some((s) => s.score > 0)).toBe(true);
      expect(game.getStats?.().some((s) => s.label === "Gusts" && Number(s.value) > 0)).toBe(true);
      game.destroy();
    }
  });

  it("removes its pointer listener on destroy", () => {
    const ctx = context(2);
    const game = towerTopple.create(ctx);
    game.destroy();
    expect((ctx as { canvas: { removeEventListener: ReturnType<typeof vi.fn> } }).canvas.removeEventListener)
      .toHaveBeenCalledWith("pointerdown", expect.any(Function));
  });
});

import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { towerTopple } from "./tower-topple";
import { isOver, nextSeat, regrow, sliceDrop, START_WIDTH } from "./rules";

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

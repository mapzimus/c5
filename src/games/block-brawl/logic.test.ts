import { describe, expect, it } from "vitest";
import {
  Bag,
  COLS,
  ROWS,
  addGarbage,
  bestPlacement,
  clearLines,
  collides,
  dropY,
  emptyBoard,
  garbageFor,
  lockPiece,
  spawnPiece,
  tryRotate,
} from "./logic";

describe("block brawl logic", () => {
  it("bags with the same seed give every player the same sequence", () => {
    const a = new Bag(42);
    const b = new Bag(42);
    const seqA = Array.from({ length: 21 }, () => a.next());
    const seqB = Array.from({ length: 21 }, () => b.next());
    expect(seqA).toEqual(seqB);
    for (let i = 0; i < 21; i += 7) {
      expect([...seqA.slice(i, i + 7)].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    }
  });

  it("every piece has 4 cells in every rotation and spawns in bounds", () => {
    const board = emptyBoard();
    for (let t = 0; t < 7; t++) {
      let p = spawnPiece(t);
      expect(collides(board, p)).toBe(false);
      for (let r = 0; r < 4; r++) {
        p = tryRotate(board, p)!;
        expect(p).not.toBeNull();
      }
    }
  });

  it("clears full lines and maps garbage 2/3/4 -> 1/2/4", () => {
    const board = emptyBoard();
    for (let y = ROWS - 2; y < ROWS; y++) board[y]!.fill(1);
    board[ROWS - 3]![0] = 2;
    expect(clearLines(board)).toBe(2);
    expect(board[ROWS - 1]![0]).toBe(2);
    expect([1, 2, 3, 4].map(garbageFor)).toEqual([0, 1, 2, 4]);
  });

  it("garbage pushes rows up and reports top-out", () => {
    const board = emptyBoard();
    expect(addGarbage(board, [3, 5])).toBe(false);
    expect(board[ROWS - 2]![3]).toBe(0);
    expect(board[ROWS - 1]![5]).toBe(0);
    expect(board[ROWS - 1]!.filter((c) => c !== 0).length).toBe(COLS - 1);
    board[0]![0] = 1;
    expect(addGarbage(board, [0])).toBe(true);
  });

  it("hard drop lands on the floor", () => {
    const board = emptyBoard();
    const p = spawnPiece(1);
    const y = dropY(board, p);
    lockPiece(board, { ...p, y });
    expect(board[ROWS - 1]!.filter((c) => c !== 0).length).toBe(2);
  });

  it("bot picks the placement that completes a line", () => {
    const board = emptyBoard();
    // Bottom row full except the 4 rightmost columns: a flat I fits there.
    for (let x = 0; x < COLS - 4; x++) board[ROWS - 1]![x] = 8;
    const best = bestPlacement(board, 0)!;
    const p = { type: 0, rot: best.rot, x: best.x, y: 0 };
    lockPiece(board, { ...p, y: dropY(board, p) });
    expect(clearLines(board)).toBe(1);
  });
});

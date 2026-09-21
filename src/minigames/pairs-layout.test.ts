import { describe, expect, it } from "vitest";
import { hitCard, layoutPairBoard, PAIR_COLS, PAIR_ROWS } from "./pairs-layout";

describe("layoutPairBoard", () => {
  it("fits a 6x6 grid inside a landscape desktop", () => {
    const board = layoutPairBoard(1280, 720, 2);
    expect(board.slots).toHaveLength(PAIR_COLS * PAIR_ROWS);
    expect(board.narrow).toBe(false);
    const last = board.slots[35]!;
    expect(last.x + board.cardW).toBeLessThanOrEqual(1280);
    expect(last.y + board.cardH).toBeLessThanOrEqual(720);
    expect(board.cardW).toBeGreaterThanOrEqual(90);
  });

  it("keeps phone cards inside the portrait play area and large enough to tap", () => {
    const board = layoutPairBoard(720, 1404, 2);
    expect(board.narrow).toBe(true);
    const last = board.slots[35]!;
    expect(last.x + board.cardW).toBeLessThanOrEqual(720);
    expect(last.y + board.cardH).toBeLessThanOrEqual(1404);
    expect(board.cardW).toBeGreaterThanOrEqual(96);
    expect(board.slots[0]!.y).toBeGreaterThanOrEqual(board.hudHeight);
  });

  it("hits the card under a tap", () => {
    const board = layoutPairBoard(720, 1404, 2);
    const slot = board.slots[8]!;
    expect(hitCard(board, slot.x + 4, slot.y + 4)).toBe(8);
    expect(hitCard(board, 2, 2)).toBeNull();
  });
});

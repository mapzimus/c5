import { describe, expect, it } from "vitest";
import { layoutLogicalSize } from "../core/viewport";
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

  it("fills an iPhone-width board with cards large enough to tap", () => {
    const phone = layoutLogicalSize(390, 844);
    const board = layoutPairBoard(phone.width, phone.height, 2);
    expect(board.narrow).toBe(true);
    const first = board.slots[0]!;
    const last = board.slots[35]!;
    expect(last.x + board.cardW).toBeLessThanOrEqual(phone.width);
    expect(last.y + board.cardH).toBeLessThanOrEqual(phone.height);
    expect(board.cardW).toBeGreaterThanOrEqual(96);
    expect(board.cardH).toBe(board.cardW);
    expect(first.y).toBeGreaterThanOrEqual(board.hudHeight);
    expect((last.x + board.cardW - first.x) / phone.width).toBeGreaterThan(0.9);
  });

  it("hits the card under a tap", () => {
    const board = layoutPairBoard(720, 1558, 2);
    const slot = board.slots[8]!;
    expect(hitCard(board, slot.x + 4, slot.y + 4)).toBe(8);
    expect(hitCard(board, 2, 2)).toBeNull();
  });
});

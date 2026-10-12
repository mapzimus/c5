import { describe, expect, it } from "vitest";
import { layoutLogicalSize } from "../core/viewport";
import { hitCard, hitChip, layoutChips, layoutPairBoard, PAIR_COLS, PAIR_ROWS } from "./pairs-layout";

const CARDS = PAIR_COLS * PAIR_ROWS;

describe("layoutPairBoard", () => {
  it("fits a 6x4 grid inside a landscape desktop", () => {
    const board = layoutPairBoard(1280, 720, 2);
    expect(CARDS).toBe(24);
    expect(board.slots).toHaveLength(CARDS);
    expect(board.cols).toBe(6);
    expect(board.rows).toBe(4);
    expect(board.narrow).toBe(false);
    const last = board.slots[CARDS - 1]!;
    expect(last.x + board.cardW).toBeLessThanOrEqual(1280);
    expect(last.y + board.cardH).toBeLessThanOrEqual(720);
    expect(board.cardW).toBeGreaterThanOrEqual(90);
  });

  it("fills an iPhone-width board with cards large enough to tap", () => {
    const phone = layoutLogicalSize(390, 844);
    const board = layoutPairBoard(phone.width, phone.height, 2);
    expect(board.narrow).toBe(true);
    expect(board.cols).toBe(4);
    expect(board.rows).toBe(6);
    const first = board.slots[0]!;
    const last = board.slots[CARDS - 1]!;
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

describe("layoutChips", () => {
  it("keeps four phone badges tappable and above the board", () => {
    const phone = layoutLogicalSize(390, 844);
    const minTap = 44 / (390 / phone.width);
    const chips = layoutChips(phone.width, 4, true, minTap);
    const board = layoutPairBoard(phone.width, phone.height, 4);
    expect(chips).toHaveLength(4);
    for (const chip of chips) {
      expect(chip.h).toBeGreaterThanOrEqual(minTap);
      expect(chip.w).toBeGreaterThanOrEqual(minTap);
      expect(chip.y + chip.h).toBeLessThanOrEqual(board.hudHeight);
      expect(chip.x + chip.w).toBeLessThanOrEqual(phone.width);
    }
    expect(hitChip(chips, chips[2]!.x + 5, chips[2]!.y + 5)).toBe(2);
    expect(hitChip(chips, 0, 0)).toBeNull();
  });

  it("keeps desktop badges clear of the board", () => {
    const chips = layoutChips(1280, 4, false, 44);
    const board = layoutPairBoard(1280, 720, 4);
    for (const chip of chips) expect(chip.y + chip.h).toBeLessThanOrEqual(board.hudHeight);
    expect(chips[0]!.x).toBeGreaterThan(0);
  });
});

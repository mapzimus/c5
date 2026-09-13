import { describe, expect, it } from "vitest";
import { canFlip, dealPairs, nextTurnIndex, PAIR_FACES, pickKnownIndex, remember, type PairCard } from "./pairs-logic";

describe("dealPairs", () => {
  it("deals two of each face", () => {
    const deck = dealPairs(PAIR_FACES, (max) => max - 1);
    expect(deck).toHaveLength(PAIR_FACES.length * 2);
    for (const face of PAIR_FACES) {
      expect(deck.filter((card) => card.face === face)).toHaveLength(2);
    }
  });
});

describe("matching turns", () => {
  it("lets the same player go again after a match", () => {
    expect(nextTurnIndex(0, 2, true)).toBe(0);
  });

  it("passes the turn after a miss", () => {
    expect(nextTurnIndex(0, 2, false)).toBe(1);
    expect(nextTurnIndex(1, 2, false)).toBe(0);
  });

  it("only flips face-down cards", () => {
    expect(canFlip({ id: 0, face: "star", state: "down" })).toBe(true);
    expect(canFlip({ id: 1, face: "star", state: "up" })).toBe(false);
    expect(canFlip({ id: 2, face: "star", state: "matched" })).toBe(false);
  });
});

describe("bot memory", () => {
  it("picks the mate of the card just flipped", () => {
    const cards: PairCard[] = [
      { id: 0, face: "star", state: "up" },
      { id: 1, face: "bolt", state: "down" },
      { id: 2, face: "star", state: "down" },
    ];
    const memory = new Map<string, number[]>();
    remember(memory, 0, "star");
    remember(memory, 2, "star");
    expect(pickKnownIndex(cards, memory, 0)).toBe(2);
  });

  it("opens a remembered pair when starting a turn", () => {
    const cards: PairCard[] = [
      { id: 0, face: "gem", state: "down" },
      { id: 1, face: "gem", state: "down" },
      { id: 2, face: "eye", state: "down" },
    ];
    const memory = new Map<string, number[]>();
    remember(memory, 0, "gem");
    remember(memory, 1, "gem");
    expect(pickKnownIndex(cards, memory, null)).toBe(0);
  });
});

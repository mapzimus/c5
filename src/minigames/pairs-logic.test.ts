import { describe, expect, it } from "vitest";
import { PAIR_FACES } from "./crests";
import { canFlip, dealPairs, nextTurnIndex, pickKnownIndex, remember, type PairCard } from "./pairs-logic";

describe("dealPairs", () => {
  it("deals two of each crest", () => {
    const deck = dealPairs(PAIR_FACES, (max) => max - 1);
    expect(PAIR_FACES).toHaveLength(18);
    expect(deck).toHaveLength(36);
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
    expect(canFlip({ id: 0, face: "barcelona", state: "down" })).toBe(true);
    expect(canFlip({ id: 1, face: "barcelona", state: "up" })).toBe(false);
    expect(canFlip({ id: 2, face: "barcelona", state: "matched" })).toBe(false);
  });
});

describe("bot memory", () => {
  it("picks the mate of the card just flipped", () => {
    const cards: PairCard[] = [
      { id: 0, face: "liverpool", state: "up" },
      { id: 1, face: "arsenal", state: "down" },
      { id: 2, face: "liverpool", state: "down" },
    ];
    const memory = new Map<string, number[]>();
    remember(memory, 0, "liverpool");
    remember(memory, 2, "liverpool");
    expect(pickKnownIndex(cards, memory, 0)).toBe(2);
  });

  it("opens a remembered pair when starting a turn", () => {
    const cards: PairCard[] = [
      { id: 0, face: "boca", state: "down" },
      { id: 1, face: "boca", state: "down" },
      { id: 2, face: "river", state: "down" },
    ];
    const memory = new Map<string, number[]>();
    remember(memory, 0, "boca");
    remember(memory, 1, "boca");
    expect(pickKnownIndex(cards, memory, null)).toBe(0);
  });
});

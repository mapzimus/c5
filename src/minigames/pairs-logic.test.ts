import { describe, expect, it } from "vitest";
import { CRESTS, PAIR_COUNT, PAIR_FACES } from "./crests";
import {
  BOT_MEMORY_LIMIT,
  CLOSER_BONUS,
  canFlip,
  dealPairs,
  glimpseIndices,
  nextStreak,
  nextTurnIndex,
  pickFaces,
  pickKnownIndex,
  pointsForMatch,
  remainingPairs,
  remember,
  rememberCard,
  stepCursor,
  type PairCard,
} from "./pairs-logic";

describe("crest pool", () => {
  it("is large enough to randomize a 6x6 round", () => {
    expect(PAIR_FACES.length).toBe(CRESTS.length);
    expect(CRESTS.length).toBeGreaterThan(PAIR_COUNT);
    expect(new Set(PAIR_FACES).size).toBe(PAIR_FACES.length);
  });
});

describe("dealPairs", () => {
  it("deals two of each selected crest", () => {
    const faces = pickFaces(PAIR_FACES, PAIR_COUNT, (max) => max - 1);
    expect(faces).toHaveLength(PAIR_COUNT);
    expect(new Set(faces).size).toBe(PAIR_COUNT);
    const deck = dealPairs(faces, (max) => max - 1);
    expect(deck).toHaveLength(PAIR_COUNT * 2);
    for (const face of faces) {
      expect(deck.filter((card) => card.face === face)).toHaveLength(2);
    }
  });

  it("picks a different subset when the shuffle changes", () => {
    const a = pickFaces(PAIR_FACES, PAIR_COUNT, (max) => Math.max(0, max - 1));
    let n = 0;
    const b = pickFaces(PAIR_FACES, PAIR_COUNT, (max) => {
      n += 1;
      return n % max;
    });
    expect(a).not.toEqual(b);
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

describe("combo scoring", () => {
  it("pays 1, then 2, then 3 for a streak", () => {
    expect(pointsForMatch(1, 10)).toBe(1);
    expect(pointsForMatch(2, 9)).toBe(2);
    expect(pointsForMatch(3, 8)).toBe(3);
  });

  it("adds a closer bonus on the last pair", () => {
    expect(pointsForMatch(1, 0)).toBe(1 + CLOSER_BONUS);
    expect(pointsForMatch(3, 0)).toBe(3 + CLOSER_BONUS);
  });

  it("grows a streak on a match and resets on a miss", () => {
    expect(nextStreak(0, true)).toBe(1);
    expect(nextStreak(2, true)).toBe(3);
    expect(nextStreak(3, false)).toBe(0);
  });

  it("counts unmatched pairs", () => {
    const cards: PairCard[] = [
      { id: 0, face: "a", state: "matched" },
      { id: 1, face: "a", state: "matched" },
      { id: 2, face: "b", state: "down" },
      { id: 3, face: "b", state: "up" },
    ];
    expect(remainingPairs(cards)).toBe(1);
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

  it("forgets the oldest sighting once memory is full", () => {
    const memory = new Map<string, number[]>();
    const recency: number[] = [];
    rememberCard(memory, recency, 0, "alpha", 2);
    rememberCard(memory, recency, 1, "beta", 2);
    rememberCard(memory, recency, 2, "gamma", 2);
    expect(memory.has("alpha")).toBe(false);
    expect(memory.get("beta")).toEqual([1]);
    expect(memory.get("gamma")).toEqual([2]);
    expect(recency).toEqual([1, 2]);
  });

  it("refreshes a card already in memory instead of dropping it", () => {
    const memory = new Map<string, number[]>();
    const recency: number[] = [];
    rememberCard(memory, recency, 0, "alpha", 2);
    rememberCard(memory, recency, 1, "beta", 2);
    rememberCard(memory, recency, 0, "alpha", 2);
    expect(memory.get("alpha")).toEqual([0]);
    expect(memory.get("beta")).toEqual([1]);
    expect(recency).toEqual([1, 0]);
  });

  it("glimpses a unique subset for the peek", () => {
    const seen = glimpseIndices(36, BOT_MEMORY_LIMIT, (max) => max - 1);
    expect(seen).toHaveLength(BOT_MEMORY_LIMIT);
    expect(new Set(seen).size).toBe(BOT_MEMORY_LIMIT);
    expect(seen.every((index) => index >= 0 && index < 36)).toBe(true);
  });
});

describe("board cursor", () => {
  it("wraps along a row and skips blocked cards", () => {
    expect(stepCursor(5, 1, 0, 6, 6, () => true)).toBe(0);
    expect(stepCursor(0, 1, 0, 6, 6, (index) => index !== 1)).toBe(2);
    expect(stepCursor(0, 0, 1, 6, 6, () => true)).toBe(6);
  });
});

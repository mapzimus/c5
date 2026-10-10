import { describe, expect, it } from "vitest";
import { FLAGS, PAIR_COUNT, PAIR_FACES } from "./flags";
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
  bestHumanScore,
  feverMultiplier,
  GOLDEN_FACTOR,
  SHAKE_COUNT,
  SHAKE_EVERY,
  forgetCards,
  missesUntilShake,
  pickShakeIndices,
  shakeDue,
  shakeUp,
  inFever,
  scoreMatch,
  remainingPairs,
  remember,
  rememberCard,
  stepCursor,
  type PairCard,
} from "./pairs-logic";

describe("flag pool", () => {
  it("is large enough to randomize a 6x6 round", () => {
    expect(PAIR_FACES.length).toBe(FLAGS.length);
    expect(FLAGS.length).toBeGreaterThan(PAIR_COUNT);
    expect(new Set(PAIR_FACES).size).toBe(PAIR_FACES.length);
  });
});

describe("dealPairs", () => {
  it("deals two of each selected flag", () => {
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

describe("fever and golden scoring", () => {
  it("escalates the multiplier with the streak", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(feverMultiplier)).toEqual([1, 1, 1, 2, 2, 3, 3]);
    expect(inFever(2)).toBe(false);
    expect(inFever(3)).toBe(true);
  });

  it("multiplies combo points by fever", () => {
    expect(scoreMatch(1, 10, false)).toBe(1);
    expect(scoreMatch(3, 8, false)).toBe(3 * 2);
    expect(scoreMatch(5, 6, false)).toBe(5 * 3);
    expect(scoreMatch(3, 0, false)).toBe((3 + CLOSER_BONUS) * 2);
  });

  it("triples the golden pair on top of fever", () => {
    expect(scoreMatch(1, 10, true)).toBe(GOLDEN_FACTOR);
    expect(scoreMatch(5, 6, true)).toBe(5 * 3 * GOLDEN_FACTOR);
  });

  it("finds the best human score", () => {
    const players = [{ kind: "human" }, { kind: "bot" }, { kind: "human" }];
    expect(bestHumanScore(players, [4, 99, 7])).toBe(7);
    expect(bestHumanScore([{ kind: "bot" }], [5])).toBeNull();
  });
});

describe("shake-up", () => {
  const first = (max: number) => max - 1; // identity shuffle

  it("fires on every 4th miss", () => {
    expect(SHAKE_EVERY).toBe(4);
    expect([0, 1, 2, 3, 4, 5, 8, 12].map((n) => shakeDue(n))).toEqual([
      false, false, false, false, true, false, true, true,
    ]);
    expect(missesUntilShake(0)).toBe(4);
    expect(missesUntilShake(3)).toBe(1);
    expect(missesUntilShake(4)).toBe(4);
  });

  it("only picks face-down tiles, at most SHAKE_COUNT", () => {
    const cards = dealPairs(["a", "b", "c", "d"], first);
    cards[0]!.state = "matched";
    cards[1]!.state = "matched";
    cards[2]!.state = "up";
    const picked = pickShakeIndices(cards, SHAKE_COUNT, (max) => Math.floor(max / 2));
    expect(picked).toHaveLength(SHAKE_COUNT);
    expect(new Set(picked).size).toBe(SHAKE_COUNT);
    for (const index of picked) expect(cards[index]!.state).toBe("down");
  });

  it("skips when fewer than two tiles are face down", () => {
    const cards = dealPairs(["a", "b"], first);
    cards.forEach((card) => (card.state = "matched"));
    cards[3]!.state = "down";
    expect(pickShakeIndices(cards, SHAKE_COUNT, first)).toEqual([]);
    expect(shakeUp(cards, [3])).toEqual([]);
  });

  it("moves every chosen tile and keeps the deck intact", () => {
    const cards = dealPairs(["a", "b", "c", "d"], first);
    const before = cards.map((card) => card.id);
    const indices = [1, 4, 6, 7];
    const moves = shakeUp(cards, indices);
    expect(moves).toEqual([
      { from: 1, to: 4 },
      { from: 4, to: 6 },
      { from: 6, to: 7 },
      { from: 7, to: 1 },
    ]);
    for (const move of moves) expect(cards[move.to]!.id).toBe(before[move.from]);
    expect([...cards.map((card) => card.id)].sort()).toEqual([...before].sort());
    // untouched slots stay put
    for (const index of [0, 2, 3, 5]) expect(cards[index]!.id).toBe(before[index]);
  });

  it("makes the bot forget moved tiles", () => {
    const memory = new Map<string, number[]>();
    const recency: number[] = [];
    rememberCard(memory, recency, 0, "a");
    rememberCard(memory, recency, 1, "a");
    rememberCard(memory, recency, 2, "b");
    forgetCards(memory, recency, [1, 2]);
    expect(memory.get("a")).toEqual([0]);
    expect(memory.has("b")).toBe(false);
    expect(recency).toEqual([0]);
  });
});

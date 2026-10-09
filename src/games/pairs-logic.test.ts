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

  it("doubles the golden pair on top of fever", () => {
    expect(scoreMatch(1, 10, true)).toBe(GOLDEN_FACTOR);
    expect(scoreMatch(5, 6, true)).toBe(5 * 3 * GOLDEN_FACTOR);
  });

  it("finds the best human score", () => {
    const players = [{ kind: "human" }, { kind: "bot" }, { kind: "human" }];
    expect(bestHumanScore(players, [4, 99, 7])).toBe(7);
    expect(bestHumanScore([{ kind: "bot" }], [5])).toBeNull();
  });
});

import {
  allFlagsMatched,
  applyTrickScores,
  assignPersonas,
  BOT_PERSONAS,
  dealBoard,
  FLAG_PAIRS,
  flagPairsLeft,
  fillLine,
  FRENZY_FACTOR,
  inFrenzy,
  JACKPOT_POINTS,
  leaderExcept,
  missedObvious,
  pickLine,
  QUIPS,
  reshuffleDown,
  snipeBonus,
  stealAmount,
  totalMatchPoints,
  tricksFor,
  turnClockSeconds,
  underdogBonus,
  type TrickCard,
} from "./pairs-logic";
import { PAIR_COLS as COLS, PAIR_ROWS as ROWS } from "./pairs-layout";

describe("trick board", () => {
  it("fills the 6x6 board with 16 flag pairs and 4 tricks", () => {
    const faces = pickFaces(PAIR_FACES, FLAG_PAIRS, (max) => max - 1);
    for (const count of [1, 2, 4]) {
      const deck = dealBoard(faces, tricksFor(count), (max) => max - 1);
      expect(deck).toHaveLength(COLS * ROWS);
      expect(deck.filter((card) => card.trick)).toHaveLength(4);
      expect(flagPairsLeft(deck)).toBe(FLAG_PAIRS);
      expect(new Set(deck.map((card) => card.id)).size).toBe(deck.length);
    }
    expect(tricksFor(1)).not.toContain("swap");
    expect(tricksFor(1)).not.toContain("thief");
    expect(tricksFor(3)).toEqual(expect.arrayContaining(["peek", "bomb", "thief", "swap"]));
  });

  it("ends the round when every flag is matched, ignoring leftover tricks", () => {
    const cards: TrickCard[] = [
      { id: 0, face: "a", state: "matched" },
      { id: 1, face: "a", state: "matched" },
      { id: 2, face: "trick:bomb", state: "down", trick: "bomb" },
    ];
    expect(allFlagsMatched(cards)).toBe(true);
    cards[1]!.state = "down";
    expect(allFlagsMatched(cards)).toBe(false);
  });

  it("bomb reshuffles only face-down cards", () => {
    const cards: TrickCard[] = [
      { id: 0, face: "a", state: "matched" },
      { id: 1, face: "b", state: "down" },
      { id: 2, face: "c", state: "down" },
      { id: 3, face: "a", state: "matched" },
      { id: 4, face: "d", state: "down" },
    ];
    reshuffleDown(cards, () => 0);
    expect(cards[0]!.id).toBe(0);
    expect(cards[3]!.id).toBe(3);
    expect([cards[1]!.id, cards[2]!.id, cards[4]!.id].sort()).toEqual([1, 2, 4]);
    expect([cards[1]!.id, cards[2]!.id, cards[4]!.id]).not.toEqual([1, 2, 4]);
  });
});

describe("trick scores", () => {
  it("thief steals a quarter of the leader (min 3, capped at what they have)", () => {
    expect(stealAmount(0)).toBe(0);
    expect(stealAmount(2)).toBe(2);
    expect(stealAmount(8)).toBe(3);
    expect(stealAmount(40)).toBe(10);
    const out = applyTrickScores("thief", [4, 20, 10], 0);
    expect(out.target).toBe(1);
    expect(out.scores).toEqual([9, 15, 10]);
    expect(out.scores.reduce((a, b) => a + b)).toBe(34);
  });

  it("swap trades with the leader, and backfires on the leader", () => {
    expect(applyTrickScores("swap", [2, 20, 9], 0)).toMatchObject({ scores: [20, 2, 9], target: 1, delta: 18 });
    const backfire = applyTrickScores("swap", [20, 2, 9], 0);
    expect(backfire.target).toBe(1);
    expect(backfire.scores).toEqual([2, 20, 9]);
    expect(backfire.delta).toBeLessThan(0);
  });

  it("jackpot pays flat points and solo tricks never crash", () => {
    expect(applyTrickScores("jackpot", [3], 0).scores).toEqual([3 + JACKPOT_POINTS]);
    expect(applyTrickScores("swap", [3], 0)).toMatchObject({ scores: [3], target: -1 });
    expect(applyTrickScores("thief", [3], 0)).toMatchObject({ scores: [3], target: -1 });
    expect(leaderExcept([5], 0)).toBe(-1);
  });
});

describe("tension and catch-up", () => {
  it("doubles the last three pairs in the final frenzy", () => {
    expect(inFrenzy(4)).toBe(false);
    expect(inFrenzy(3)).toBe(true);
    expect(inFrenzy(1)).toBe(true);
    expect(inFrenzy(0)).toBe(false);
    const plain = totalMatchPoints(1, 2, false, { frenzy: false, underdog: 0, snipe: 0 });
    expect(totalMatchPoints(1, 2, false, { frenzy: true, underdog: 0, snipe: 0 })).toBe(plain * FRENZY_FACTOR);
    expect(totalMatchPoints(1, 2, false, { frenzy: false, underdog: 2, snipe: 1 })).toBe(plain + 3);
  });

  it("gives trailing players an underdog bonus", () => {
    expect(underdogBonus([0, 4], 0)).toBe(0);
    expect(underdogBonus([0, 5], 0)).toBe(1);
    expect(underdogBonus([0, 12], 0)).toBe(2);
    expect(underdogBonus([12, 0], 0)).toBe(0);
    expect(underdogBonus([0], 0)).toBe(0);
  });

  it("pays a snipe for matching a rival's just-missed flag", () => {
    expect(snipeBonus(["fr", "de"], 1, "fr", 0)).toBe(1);
    expect(snipeBonus(["fr", "de"], 0, "fr", 0)).toBe(0);
    expect(snipeBonus(["fr", "de"], 1, "it", 0)).toBe(0);
    expect(snipeBonus([], -1, "fr", 0)).toBe(0);
  });

  it("shrinks the shot clock as the board empties", () => {
    expect(turnClockSeconds(FLAG_PAIRS)).toBe(9);
    expect(turnClockSeconds(0)).toBe(4);
    expect(turnClockSeconds(8)).toBeLessThan(turnClockSeconds(12));
  });

  it("spots a miss when the mate was already shown elsewhere", () => {
    const cards: TrickCard[] = [
      { id: 0, face: "fr", state: "up" },
      { id: 1, face: "de", state: "up" },
      { id: 2, face: "fr", state: "down" },
      { id: 3, face: "de", state: "down" },
    ];
    expect(missedObvious(cards, new Set([0, 1]), 0, 1)).toBe(false);
    expect(missedObvious(cards, new Set([0, 1, 2]), 0, 1)).toBe(true);
  });
});

describe("bot personas and announcer", () => {
  it("hands out distinct personas while they last", () => {
    const four = assignPersonas(4, () => 0);
    expect(new Set(four.map((p) => p.id)).size).toBe(4);
    expect(assignPersonas(6, () => 0)).toHaveLength(6);
    for (const persona of BOT_PERSONAS) {
      expect(persona.memory).toBeGreaterThan(0);
      expect(persona.match.length).toBeGreaterThan(0);
      expect(persona.miss.length).toBeGreaterThan(0);
    }
  });

  it("fills names into lines and leaves no holes", () => {
    expect(fillLine("Thanks, {victim}! — {name}", { name: "Ace", victim: "Blitz" })).toBe("Thanks, Blitz! — Ace");
    for (const kind of Object.keys(QUIPS) as (keyof typeof QUIPS)[]) {
      const line = pickLine(kind, { name: "A", victim: "B", n: 3 }, () => 0);
      expect(line).not.toMatch(/\{\w+\}/);
    }
  });
});

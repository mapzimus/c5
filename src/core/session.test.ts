import { describe, expect, it } from "vitest";
import { rankResults } from "./session";

describe("rankResults", () => {
  it("ranks by score and marks only first place as the win", () => {
    const ranked = rankResults([
      { playerId: "a", score: 10 },
      { playerId: "b", score: 40 },
      { playerId: "c", score: 20 },
      { playerId: "d", score: 5 },
    ]);
    expect(ranked.map((row) => row.playerId)).toEqual(["b", "c", "a", "d"]);
    expect(ranked.map((row) => row.rank)).toEqual([1, 2, 3, 4]);
    expect(ranked.map((row) => row.won)).toEqual([true, false, false, false]);
  });

  it("gives every player tied for first the win", () => {
    const ranked = rankResults([
      { playerId: "a", score: 10 },
      { playerId: "b", score: 10 },
      { playerId: "c", score: 3 },
    ]);
    expect(ranked.map((row) => row.rank)).toEqual([1, 1, 3]);
    expect(ranked.map((row) => row.won)).toEqual([true, true, false]);
  });
});

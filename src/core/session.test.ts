import { describe, expect, it } from "vitest";
import { rankResults, Session } from "./session";
import { PLAYER_COLORS, type Player } from "./types";

function players(): Player[] {
  return ["a", "b", "c", "d"].map((id, index) => ({
    id,
    name: id.toUpperCase(),
    color: PLAYER_COLORS[index]!,
    kind: "bot" as const,
    slot: index as 0 | 1 | 2 | 3,
  }));
}

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

describe("Session", () => {
  it("scores 1 point per win and hands the pick to the winner", () => {
    const session = new Session(players());
    expect(session.pickerId).toBeNull();
    session.applyResults([
      { playerId: "a", score: 1 },
      { playerId: "b", score: 9 },
      { playerId: "c", score: 4 },
      { playerId: "d", score: 3 },
    ]);
    expect(session.pickerId).toBe("b");
    session.applyResults([
      { playerId: "a", score: 8 },
      { playerId: "b", score: 2 },
      { playerId: "c", score: 2 },
      { playerId: "d", score: 1 },
    ]);
    session.applyResults([
      { playerId: "a", score: 1 },
      { playerId: "b", score: 5 },
      { playerId: "c", score: 0 },
      { playerId: "d", score: 0 },
    ]);

    expect(session.gamesPlayed).toBe(3);
    expect(session.standingFor("b")?.wins).toBe(2);
    expect(session.standingFor("a")?.wins).toBe(1);
    expect(session.standingFor("c")?.wins).toBe(0);
    expect(session.leader()?.playerId).toBe("b");
    expect(session.picker()?.name).toBe("B");
  });
});

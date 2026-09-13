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
  it("awards party points by rank", () => {
    const ranked = rankResults([
      { playerId: "a", score: 10 },
      { playerId: "b", score: 40 },
      { playerId: "c", score: 20 },
      { playerId: "d", score: 5 },
    ]);
    expect(ranked.map((row) => row.playerId)).toEqual(["b", "c", "a", "d"]);
    expect(ranked.map((row) => row.rank)).toEqual([1, 2, 3, 4]);
    expect(ranked.map((row) => row.partyPoints)).toEqual([5, 3, 2, 1]);
  });

  it("shares rank and points on a tie", () => {
    const ranked = rankResults([
      { playerId: "a", score: 10 },
      { playerId: "b", score: 10 },
      { playerId: "c", score: 3 },
    ]);
    expect(ranked[0]?.rank).toBe(1);
    expect(ranked[1]?.rank).toBe(1);
    expect(ranked[0]?.partyPoints).toBe(5);
    expect(ranked[1]?.partyPoints).toBe(5);
    expect(ranked[2]?.rank).toBe(3);
    expect(ranked[2]?.partyPoints).toBe(2);
  });
});

describe("Session", () => {
  it("accumulates standings and wins", () => {
    const session = new Session(players());
    session.applyResults([
      { playerId: "a", score: 1 },
      { playerId: "b", score: 9 },
      { playerId: "c", score: 4 },
      { playerId: "d", score: 3 },
    ]);
    session.applyResults([
      { playerId: "a", score: 8 },
      { playerId: "b", score: 2 },
      { playerId: "c", score: 2 },
      { playerId: "d", score: 1 },
    ]);

    expect(session.gamesPlayed).toBe(2);
    expect(session.standingFor("b")?.wins).toBe(1);
    expect(session.standingFor("a")?.wins).toBe(1);
    expect(session.leader()?.playerId).toBe("b");
    expect(session.standingFor("b")?.points).toBe(5 + 3);
  });

  it("walks a chaos circuit", () => {
    const session = new Session(players());
    session.startCircuit(["storm-surge", "gust-grab"]);
    expect(session.currentCircuitId()).toBe("storm-surge");
    expect(session.advanceCircuit()).toBe("gust-grab");
    session.advanceCircuit();
    expect(session.circuitDone()).toBe(true);
  });
});

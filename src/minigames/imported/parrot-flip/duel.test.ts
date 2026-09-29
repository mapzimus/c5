import { describe, expect, it } from "vitest";
import { Rng } from "../../../core/rng";
import { MAX_LIVES, STARTING_LIVES, SD_THRESHOLD, advanceDuel, dealDuel, duelMissWouldEliminate, isOver, resolveDuelRound, scoresFromTable } from "./rules";

describe("parrot duel rules", () => {
  it("both make: stake +2, streaks climb, nobody pays", () => {
    const duel = dealDuel(["a", "b"]);
    const round = resolveDuelRound(duel, [true, true]);
    expect(duel.table.stake).toBe(2);
    expect(round.stakePaid).toBe(0);
    expect(duel.table.seats.map((s) => s.streak)).toEqual([1, 1]);
  });

  it("one misses: the misser pays the stake including this round's make, then it resets", () => {
    const duel = dealDuel(["a", "b"]);
    resolveDuelRound(duel, [true, true]); // stake 2
    const round = resolveDuelRound(duel, [true, false]); // a makes -> 3, b pays 3
    expect(round.sides[1].penalty).toBe(3);
    expect(duel.table.seats[1]!.lives).toBe(STARTING_LIVES - 3);
    expect(duel.table.seats[0]!.lives).toBe(STARTING_LIVES);
    expect(duel.table.stake).toBe(0);
  });

  it("both miss: both pay", () => {
    const duel = dealDuel(["a", "b"]);
    resolveDuelRound(duel, [true, true]);
    const round = resolveDuelRound(duel, [false, false]);
    expect(round.sides.map((s) => s.penalty)).toEqual([2, 2]);
    expect(round.stakePaid).toBe(2);
  });

  it("a golden make adds 2 to the stake", () => {
    const duel = dealDuel(["a", "b"]);
    resolveDuelRound(duel, [true, false], [{ golden: true }, {}]);
    expect(duel.table.seats[1]!.lives).toBe(STARTING_LIVES - 2);
  });

  it("three in a row ignites; ON FIRE makes add lives and a miss is free", () => {
    const duel = dealDuel(["a", "b"]);
    resolveDuelRound(duel, [true, true]);
    resolveDuelRound(duel, [true, true]);
    const ignite = resolveDuelRound(duel, [true, false]);
    expect(ignite.sides[0].justIgnited).toBe(true);
    expect(duel.table.seats[0]!.onFire).toBe(true);
    const gain = resolveDuelRound(duel, [true, true]);
    expect(gain.sides[0].fireGain).toBe(1);
    const cool = resolveDuelRound(duel, [false, true]);
    expect(cool.sides[0].fireEnded).toBe(true);
    expect(cool.sides[0].penalty).toBe(0);
    expect(duel.table.seats[0]!.onFire).toBe(false);
  });

  it("ON FIRE lives stop at the cap", () => {
    const duel = dealDuel(["a", "b"], MAX_LIVES - 1);
    for (let i = 0; i < 3; i += 1) resolveDuelRound(duel, [true, true]);
    resolveDuelRound(duel, [true, true]);
    expect(duel.table.seats[0]!.lives).toBe(MAX_LIVES);
  });

  it("warns when a miss would knock someone out", () => {
    const duel = dealDuel(["a", "b"], 2);
    resolveDuelRound(duel, [true, true]);
    expect(duelMissWouldEliminate(duel, 0)).toBe(true);
  });

  it("double KO brings both back on 1 life", () => {
    const duel = dealDuel(["a", "b"], 1);
    resolveDuelRound(duel, [true, true]);
    const round = resolveDuelRound(duel, [false, false]);
    expect(round.doubleKo).toBe(true);
    expect(duel.table.seats.map((s) => [s.lives, s.eliminated])).toEqual([[1, false], [1, false]]);
    expect(isOver(duel.table)).toBe(false);
  });

  it("winner stays on: the next player replaces whoever is out, and ranks hold", () => {
    const duel = dealDuel(["a", "b", "c"], 1);
    resolveDuelRound(duel, [true, true]);
    resolveDuelRound(duel, [true, false]); // b out
    expect(advanceDuel(duel)).toEqual([1]);
    expect(duel.sides).toEqual([0, 2]);
    // Drive to the end with a always missing and c always making.
    let guard = 0;
    while (!isOver(duel.table) && guard++ < 50) {
      resolveDuelRound(duel, [false, true]);
      advanceDuel(duel);
    }
    const byId = Object.fromEntries(scoresFromTable(duel.table).map((s) => [s.playerId, s.score]));
    expect(byId.c).toBeGreaterThan(byId.a!);
    expect(byId.a).toBeGreaterThan(byId.b!);
  });

  it("sudden death makes every coin-flip duel end", () => {
    const rng = new Rng(9);
    for (let game = 0; game < 40; game += 1) {
      const duel = dealDuel(["a", "b", "c", "d"]);
      let guard = 0;
      while (!isOver(duel.table) && guard++ < 3000) {
        resolveDuelRound(duel, [rng.next() < 0.6, rng.next() < 0.6]);
        advanceDuel(duel);
      }
      expect(isOver(duel.table)).toBe(true);
    }
    expect(SD_THRESHOLD).toBeGreaterThan(0);
  });
});

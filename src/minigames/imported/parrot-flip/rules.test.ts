import { describe, expect, it } from "vitest";
import { Rng } from "../../../core/rng";
import {
  TOSSES_EACH,
  allDone,
  botFlick,
  dealSeats,
  nextTurnIndex,
  recordToss,
  scoresFromSeats,
  seatDone,
} from "./rules";

describe("parrot flip party rules", () => {
  it("deals a seat per player with empty scores", () => {
    const seats = dealSeats(["p1", "p2"]);
    expect(seats).toEqual([
      { playerId: "p1", makes: 0, tosses: 0 },
      { playerId: "p2", makes: 0, tosses: 0 },
    ]);
  });

  it("counts makes and tosses", () => {
    const afterMake = recordToss(dealSeats(["p1"])[0]!, true);
    expect(afterMake).toEqual({ playerId: "p1", makes: 1, tosses: 1 });
    const afterMiss = recordToss(afterMake, false);
    expect(afterMiss).toEqual({ playerId: "p1", makes: 1, tosses: 2 });
  });

  it("rotates to the next player who still has tosses", () => {
    let seats = dealSeats(["a", "b"]);
    expect(nextTurnIndex(seats, 0)).toBe(1);
    seats = [recordToss(seats[0]!, true), seats[1]!];
    expect(nextTurnIndex(seats, 0)).toBe(1);
  });

  it("skips a finished seat and ends the round", () => {
    let seats = dealSeats(["a", "b"]);
    for (let i = 0; i < TOSSES_EACH; i += 1) seats[0] = recordToss(seats[0]!, true);
    expect(seatDone(seats[0]!)).toBe(true);
    expect(allDone(seats)).toBe(false);
    expect(nextTurnIndex(seats, 0)).toBe(1);
    for (let i = 0; i < TOSSES_EACH; i += 1) seats[1] = recordToss(seats[1]!, false);
    expect(allDone(seats)).toBe(true);
    expect(nextTurnIndex(seats, 1)).toBe(-1);
    expect(scoresFromSeats(seats)).toEqual([
      { playerId: "a", score: TOSSES_EACH },
      { playerId: "b", score: 0 },
    ]);
  });

  it("aims the bot near the sweet-spot flick", () => {
    const rng = new Rng(7);
    const sample = Array.from({ length: 40 }, () => botFlick(rng));
    const ups = sample.map((flick) => -flick.vy);
    const mean = ups.reduce((sum, n) => sum + n, 0) / ups.length;
    expect(mean).toBeGreaterThan(1500);
    expect(mean).toBeLessThan(2700);
    expect(sample.every((flick) => flick.vy < 0)).toBe(true);
  });
});

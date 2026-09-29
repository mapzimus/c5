import { describe, expect, it } from "vitest";
import { Rng } from "../../../core/rng";
import {
  MAX_LIVES,
  SD_THRESHOLD,
  STARTING_LIVES,
  advanceTurn,
  botFlick,
  dealTable,
  isOver,
  missWouldEliminate,
  resolveFlip,
  scoresFromTable,
  suddenDeathLevel,
} from "./rules";

describe("parrot flip bottle-game rules", () => {
  it("deals everyone the starting lives with no stake", () => {
    const table = dealTable(["a", "b"]);
    expect(table.seats.map((s) => s.lives)).toEqual([STARTING_LIVES, STARTING_LIVES]);
    expect(table.stake).toBe(0);
  });

  it("a miss with no stake is free", () => {
    const table = dealTable(["a", "b"]);
    const out = resolveFlip(table, false);
    expect(out.penalty).toBe(0);
    expect(table.seats[0]!.lives).toBe(STARTING_LIVES);
  });

  it("makes build a shared stake that the next misser pays, then it resets", () => {
    const table = dealTable(["a", "b"]);
    resolveFlip(table, true); // a: stake 1
    advanceTurn(table);
    resolveFlip(table, true); // b: stake 2
    advanceTurn(table);
    const out = resolveFlip(table, false); // a misses
    expect(out.penalty).toBe(2);
    expect(table.seats[0]!.lives).toBe(STARTING_LIVES - 2);
    expect(table.stake).toBe(0);
  });

  it("two in a row heats up, three ignites and keeps the turn", () => {
    const table = dealTable(["a", "b"]);
    resolveFlip(table, true);
    advanceTurn(table);
    advanceTurn(table); // back to a (b passes without flipping for this test)
    table.turn = 0;
    resolveFlip(table, true);
    expect(table.seats[0]!.heatingUp).toBe(true);
    const out = resolveFlip(table, true);
    expect(out.justIgnited).toBe(true);
    expect(table.seats[0]!.onFire).toBe(true);
    advanceTurn(table);
    expect(table.turn).toBe(0);
  });

  it("ON FIRE makes add a life and a miss ends the run with no penalty, stake kept", () => {
    const table = dealTable(["a", "b"]);
    for (let i = 0; i < 3; i += 1) resolveFlip(table, true);
    const stake = table.stake;
    expect(resolveFlip(table, true).fireGain).toBe(1);
    expect(table.seats[0]!.lives).toBe(STARTING_LIVES + 1);
    const out = resolveFlip(table, false);
    expect(out.fireEnded).toBe(true);
    expect(out.penalty).toBe(0);
    expect(table.stake).toBe(stake);
    advanceTurn(table);
    expect(table.turn).toBe(1);
  });

  it("ON FIRE ends cleanly at the life cap", () => {
    const table = dealTable(["a", "b"], MAX_LIVES - 1);
    for (let i = 0; i < 3; i += 1) resolveFlip(table, true);
    resolveFlip(table, true);
    expect(table.seats[0]!.lives).toBe(MAX_LIVES);
    expect(table.seats[0]!.onFire).toBe(false);
  });

  it("knocks out at zero lives, skips them, and ends with one left", () => {
    const table = dealTable(["a", "b", "c"], 1);
    resolveFlip(table, true); // a, stake 1
    advanceTurn(table);
    expect(missWouldEliminate(table)).toBe(true);
    const out = resolveFlip(table, false); // b out
    expect(out.eliminated).toBe(true);
    advanceTurn(table);
    expect(table.turn).toBe(2);
    resolveFlip(table, true); // c, stake 1
    advanceTurn(table);
    expect(table.turn).toBe(0);
    resolveFlip(table, false); // a out
    expect(isOver(table)).toBe(true);
    const scores = scoresFromTable(table);
    const byId = Object.fromEntries(scores.map((s) => [s.playerId, s.score]));
    expect(byId.c).toBeGreaterThan(byId.a!);
    expect(byId.a).toBeGreaterThan(byId.b!);
  });

  it("sudden death adds an escalating cost to misses", () => {
    expect(suddenDeathLevel(SD_THRESHOLD)).toBe(0);
    expect(suddenDeathLevel(SD_THRESHOLD + 1)).toBe(1);
    const table = dealTable(["a", "b"]);
    table.flips = SD_THRESHOLD;
    expect(resolveFlip(table, false).penalty).toBe(1);
  });

  it("a game between coin-flip bots always ends", () => {
    const rng = new Rng(3);
    for (let game = 0; game < 50; game += 1) {
      const table = dealTable(["a", "b", "c", "d"]);
      let guard = 0;
      while (!isOver(table) && guard < 5000) {
        resolveFlip(table, rng.next() < 0.55);
        advanceTurn(table);
        guard += 1;
      }
      expect(isOver(table)).toBe(true);
    }
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

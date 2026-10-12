import { describe, expect, it } from "vitest";
import { Rng } from "../../../core/rng";
import {
  DUO_LIVES,
  GOLDEN_ODDS,
  MAX_LIVES,
  MIN_PENALTY,
  OVERDRIVE_EXTRA,
  PERCH_HALF,
  RETURN_STREAK,
  SD_THRESHOLD,
  STARTING_LIVES,
  UNDERDOG_SCALE,
  advanceTurn,
  botBet,
  botFlick,
  dealTable,
  ghostSeats,
  isFinalRound,
  isOver,
  isOverdrive,
  livesFor,
  missCue,
  missPenalty,
  missWouldEliminate,
  onPerch,
  perchFor,
  placeBet,
  resolveFlip,
  rollGolden,
  rollPerch,
  roundsFor,
  scoresFromTable,
  settleBets,
  suddenDeathLevel,
  underdogSeat,
} from "./rules";

describe("parrot flip bottle-game rules", () => {
  it("deals everyone the starting lives with no stake (more lives head to head)", () => {
    const table = dealTable(["a", "b"]);
    expect(table.seats.map((s) => s.lives)).toEqual([DUO_LIVES, DUO_LIVES]);
    expect(table.stake).toBe(0);
    expect(dealTable(["a", "b", "c"]).seats[0]!.lives).toBe(STARTING_LIVES);
    expect(livesFor(4)).toBe(STARTING_LIVES);
  });

  it("a miss with no stake still costs the minimum", () => {
    const table = dealTable(["a", "b"], STARTING_LIVES);
    expect(missPenalty(table)).toBe(MIN_PENALTY);
    const out = resolveFlip(table, false);
    expect(out.penalty).toBe(MIN_PENALTY);
    expect(table.seats[0]!.lives).toBe(STARTING_LIVES - MIN_PENALTY);
  });

  it("makes build a shared stake that the next misser pays, then it resets", () => {
    const table = dealTable(["a", "b"], STARTING_LIVES);
    resolveFlip(table, true); // a: stake 1
    advanceTurn(table);
    resolveFlip(table, true); // b: stake 2
    advanceTurn(table);
    const out = resolveFlip(table, false); // a misses
    expect(out.penalty).toBe(2);
    expect(table.seats[0]!.lives).toBe(STARTING_LIVES - 2);
    expect(table.stake).toBe(0);
  });

  it("two in a row heats up, three ignites, and the fire carries over without holding the turn", () => {
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
    expect(table.turn).toBe(1);
    advanceTurn(table);
    expect(table.turn).toBe(0);
    expect(table.seats[0]!.onFire).toBe(true);
  });

  it("ON FIRE makes add a life and a miss ends the run with no penalty, stake kept", () => {
    const table = dealTable(["a", "b"], STARTING_LIVES);
    for (let i = 0; i < 3; i += 1) resolveFlip(table, true);
    const stake = table.stake;
    expect(missPenalty(table)).toBe(0);
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

  it("sudden death (duel) adds an escalating cost to misses", () => {
    expect(suddenDeathLevel(SD_THRESHOLD)).toBe(0);
    expect(suddenDeathLevel(SD_THRESHOLD + 1)).toBe(1);
  });

  it("a game between coin-flip bots always ends within the round cap", () => {
    const rng = new Rng(3);
    for (const n of [2, 3, 4]) {
      const ids = ["a", "b", "c", "d"].slice(0, n);
      for (let game = 0; game < 40; game += 1) {
        const table = dealTable(ids);
        let flips = 0;
        while (!isOver(table) && flips < 5000) {
          resolveFlip(table, rng.next() < 0.55);
          advanceTurn(table);
          flips += 1;
        }
        expect(isOver(table)).toBe(true);
        expect(flips).toBeLessThanOrEqual(roundsFor(n) * n);
      }
    }
  });

  it("rounds advance when the turn wraps, the last two are OVERDRIVE, and the cap ends it", () => {
    const table = dealTable(["a", "b", "c"]);
    expect(table.rounds).toBe(roundsFor(3));
    expect(table.round).toBe(1);
    resolveFlip(table, true);
    expect(advanceTurn(table)).toBe(false);
    resolveFlip(table, true);
    expect(advanceTurn(table)).toBe(false);
    resolveFlip(table, true);
    expect(advanceTurn(table)).toBe(true);
    expect(table.round).toBe(2);
    expect(isOverdrive(table)).toBe(false);
    table.round = table.rounds - 1;
    expect(isOverdrive(table)).toBe(true);
    expect(isFinalRound(table)).toBe(false);
    table.round = table.rounds;
    expect(isFinalRound(table)).toBe(true);
    table.turn = 2;
    advanceTurn(table);
    expect(isOver(table)).toBe(true);
  });

  it("OVERDRIVE misses cost extra and the stake never resets", () => {
    const table = dealTable(["a", "b"]);
    resolveFlip(table, true);
    advanceTurn(table);
    resolveFlip(table, true); // stake 2
    table.round = table.rounds;
    expect(missPenalty(table)).toBe(2 + OVERDRIVE_EXTRA);
    const out = resolveFlip(table, false);
    expect(out.overdrive).toBe(true);
    expect(out.penalty).toBe(2 + OVERDRIVE_EXTRA);
    expect(table.stake).toBe(2);
    // An ON FIRE miss in overdrive pays only the extra.
    const hot = dealTable(["a", "b"]);
    for (let i = 0; i < 3; i += 1) resolveFlip(hot, true);
    hot.round = hot.rounds;
    expect(missPenalty(hot)).toBe(OVERDRIVE_EXTRA);
    expect(resolveFlip(hot, false).penalty).toBe(OVERDRIVE_EXTRA);
  });

  it("the perch alternates sides and a landing inside it is golden (worth 2)", () => {
    const rng = new Rng(5);
    let perch = rollPerch(rng, 1280);
    for (let i = 0; i < 20; i += 1) {
      const next = rollPerch(rng, 1280, perch);
      expect(next.x < 640).toBe(!(perch.x < 640));
      expect(Math.abs(next.x - 640)).toBeGreaterThanOrEqual(120);
      expect(Math.abs(next.x - 640)).toBeLessThanOrEqual(230);
      perch = next;
    }
    expect(onPerch({ x: 800, halfWidth: PERCH_HALF }, 800 + PERCH_HALF)).toBe(true);
    expect(onPerch({ x: 800, halfWidth: PERCH_HALF }, 800 - PERCH_HALF - 1)).toBe(false);

    const table = dealTable(["a", "b"]);
    const golden = resolveFlip(table, true, { golden: true });
    expect(golden.worth).toBe(2);
    expect(table.stake).toBe(2);
    expect(table.seats[0]!.perches).toBe(1);
    expect(resolveFlip(table, true).worth).toBe(1);
    expect(table.stake).toBe(3);
  });

  it("the seat with strictly the fewest lives gets the wide underdog perch", () => {
    const table = dealTable(["a", "b", "c"]);
    expect(underdogSeat(table)).toBeNull();
    table.seats[1]!.lives = 3;
    expect(underdogSeat(table)).toBe(1);
    const perch = { x: 500, halfWidth: PERCH_HALF };
    expect(perchFor(table, perch, 1).halfWidth).toBeCloseTo(PERCH_HALF * UNDERDOG_SCALE);
    expect(perchFor(table, perch, 0).halfWidth).toBe(PERCH_HALF);
    table.seats[2]!.lives = 3;
    expect(underdogSeat(table)).toBeNull();
    table.seats[2]!.eliminated = true;
    expect(underdogSeat(table)).toBe(1);
  });

  it("ghosts bet on every flip, earn doubloons, and three in a row brings them back once", () => {
    const table = dealTable(["a", "b", "c"], 1);
    expect(placeBet(table, 1, "MAKE")).toBe(false); // alive seats cannot bet
    resolveFlip(table, true); // a makes, stake 1
    advanceTurn(table);
    resolveFlip(table, false); // b out
    expect(ghostSeats(table)).toEqual([1]);
    advanceTurn(table);
    expect(table.turn).toBe(2);
    expect(placeBet(table, 1, "MISS")).toBe(true);
    resolveFlip(table, true); // c makes
    let bets = settleBets(table, true);
    expect(bets).toEqual([{ seat: 1, bet: "MISS", hit: false, returned: false }]);
    expect(table.seats[1]!.doubloons).toBe(0);
    expect(table.seats[1]!.bet).toBeNull();
    for (let i = 0; i < RETURN_STREAK; i += 1) {
      placeBet(table, 1, "MAKE");
      bets = settleBets(table, true);
    }
    expect(table.seats[1]!.doubloons).toBe(RETURN_STREAK);
    expect(bets[0]!.returned).toBe(true);
    expect(table.seats[1]!.eliminated).toBe(false);
    expect(table.seats[1]!.lives).toBe(1);
    expect(table.seats[1]!.returned).toBe(true);
    expect(table.outCount).toBe(0);
    // A ghost with no call is skipped, and a second return never happens.
    table.seats[1]!.eliminated = true;
    expect(settleBets(table, true)).toEqual([]);
    for (let i = 0; i < RETURN_STREAK + 1; i += 1) {
      placeBet(table, 1, "MAKE");
      settleBets(table, true);
    }
    expect(table.seats[1]!.eliminated).toBe(true);
  });

  it("bot ghosts lean MAKE and lean harder on a hot flipper", () => {
    const table = dealTable(["a", "b"]);
    const sample = (seed: number) => {
      const rng = new Rng(seed);
      let makes = 0;
      for (let i = 0; i < 400; i += 1) if (botBet(rng, table) === "MAKE") makes += 1;
      return makes / 400;
    };
    const cold = sample(1);
    table.seats[0]!.onFire = true;
    const hot = sample(1);
    expect(cold).toBeGreaterThan(0.5);
    expect(cold).toBeLessThan(0.7);
    expect(hot).toBeGreaterThan(cold);
  });

  it("miss cues name the cause", () => {
    expect(missCue({ reason: "underrotated", turns: 0.4, touchdownTilt: null }).text).toBe("TOO SOFT");
    expect(missCue({ reason: "timeout", turns: 1, touchdownTilt: 1 }).text).toBe("WOBBLED OUT");
    expect(missCue({ reason: "fallen", turns: 1.0, touchdownTilt: 0.3 }).close).toBe(true);
    expect(missCue({ reason: "fallen", turns: 1.6, touchdownTilt: 1.2 }).text).toContain("OVER-SPUN");
    expect(missCue({ reason: "fallen", turns: 0.7, touchdownTilt: 1.2 }).text).toContain("UNDER-SPUN");
    expect(missCue({ reason: "fallen", turns: 1.0, touchdownTilt: 1.2 }).text).toBe("TIPPED OVER");
  });

  it("an aimed bot flick leans toward the perch, a blind one does not", () => {
    const rng = new Rng(4);
    const aimed = Array.from({ length: 60 }, () => botFlick(rng, { dx: 150, skill: 0.8 }).vx);
    const blind = Array.from({ length: 60 }, () => botFlick(rng).vx);
    const mean = (xs: number[]) => xs.reduce((s, n) => s + n, 0) / xs.length;
    expect(mean(aimed)).toBeGreaterThan(700);
    expect(Math.abs(mean(blind))).toBeLessThan(150);
    expect(aimed.every((vx) => Math.abs(vx) <= 1700)).toBe(true);
  });

  it("ranks survivors by lives and ghosts by doubloons, then by how long they lasted", () => {
    const table = dealTable(["a", "b", "c", "d"], 1);
    resolveFlip(table, true);
    advanceTurn(table);
    resolveFlip(table, false); // b out first
    advanceTurn(table);
    resolveFlip(table, false); // c out second
    advanceTurn(table);
    table.seats[1]!.doubloons = 2;
    const byId = Object.fromEntries(scoresFromTable(table).map((s) => [s.playerId, s.score]));
    expect(byId.a!).toBe(byId.d!); // both alive on one life: a tie
    table.seats[0]!.lives = 3;
    const again = Object.fromEntries(scoresFromTable(table).map((s) => [s.playerId, s.score]));
    expect(again.a!).toBeGreaterThan(again.d!);
    expect(again.d!).toBeGreaterThan(again.b!);
    expect(again.b!).toBeGreaterThan(again.c!);
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

  it("a golden make adds 2 to the stake but still counts as one make toward the streak", () => {
    const table = dealTable(["a", "b"]);
    const out = resolveFlip(table, true, { golden: true });
    expect(out.golden).toBe(true);
    expect(out.worth).toBe(2);
    expect(table.stake).toBe(2);
    expect(table.seats[0]!.streak).toBe(1);
    expect(table.seats[0]!.heatingUp).toBe(false);
  });

  it("a golden miss is just a miss", () => {
    const table = dealTable(["a", "b"]);
    resolveFlip(table, true);
    const out = resolveFlip(table, false, { golden: true });
    expect(out.golden).toBe(false);
    expect(out.penalty).toBe(1);
  });

  it("a golden make while ON FIRE is +2 lives, capped at MAX_LIVES", () => {
    const table = dealTable(["a", "b"], STARTING_LIVES);
    for (let i = 0; i < 3; i += 1) resolveFlip(table, true);
    expect(resolveFlip(table, true, { golden: true }).fireGain).toBe(2);
    expect(table.seats[0]!.lives).toBe(STARTING_LIVES + 2);

    const capped = dealTable(["a", "b"], MAX_LIVES - 1);
    for (let i = 0; i < 3; i += 1) resolveFlip(capped, true);
    expect(resolveFlip(capped, true, { golden: true }).fireGain).toBe(1);
    expect(capped.seats[0]!.lives).toBe(MAX_LIVES);
    expect(capped.seats[0]!.onFire).toBe(false);
  });

  it("golden flips roll about 1 in 150 like flipgame", () => {
    const rng = new Rng(11);
    const n = 150_000;
    let hits = 0;
    for (let i = 0; i < n; i += 1) if (rollGolden(rng)) hits += 1;
    expect(hits / n).toBeGreaterThan(0.7 / GOLDEN_ODDS);
    expect(hits / n).toBeLessThan(1.3 / GOLDEN_ODDS);
  });
});

import type { Rng } from "../../../core/rng";

/**
 * Bottle-game rules ported from mapzimus/flipgame (js/game.js):
 * - Everyone starts with STARTING_LIVES.
 * - Each make adds +1 to the shared stake. A miss costs the flipper `stake` lives, then resets it.
 * - 2 makes in a row = Heating Up. 3 = ON FIRE: keep flipping, each make is +1 life,
 *   a miss just ends the run (no penalty, stake carries over).
 * - 0 lives = out. Last player standing wins.
 * - Sudden death after SD_THRESHOLD flips: ON FIRE stops minting lives and every miss
 *   costs an escalating extra life, so every game ends.
 */
export const STARTING_LIVES = 10;
export const MAX_LIVES = 20;
export const SD_THRESHOLD = 70;
export const SD_STEP = 20;
/**
 * Golden flip odds, matching flipgame (js/main.js: `seed % 150 === 77`): 1 in 150 flicks.
 * A golden MAKE is worth 2 (stake steps, or ON FIRE lives).
 */
export const GOLDEN_ODDS = 150;

/** Roll the golden-flip lottery for one flick (1 in GOLDEN_ODDS). */
export function rollGolden(rng: Rng): boolean {
  return rng.int(0, GOLDEN_ODDS - 1) === 77 % GOLDEN_ODDS;
}

/** Per-flip extras, like flipgame's resolveFlip `meta`. */
export interface FlipMeta {
  golden?: boolean;
}

export interface FlipSeat {
  playerId: string;
  lives: number;
  streak: number;
  heatingUp: boolean;
  onFire: boolean;
  eliminated: boolean;
  /** Order this seat was knocked out in (0 = first out). Null while alive. */
  outOrder: number | null;
}

export interface FlipTable {
  seats: FlipSeat[];
  turn: number;
  stake: number;
  flips: number;
  outCount: number;
}

export interface FlipOutcome {
  made: boolean;
  /** Lives actually lost on this flip. */
  penalty: number;
  /** Lives gained from an ON FIRE make. */
  fireGain: number;
  justIgnited: boolean;
  fireEnded: boolean;
  eliminated: boolean;
  /** This make was a golden flip (worth 2). */
  golden: boolean;
  /** 1 normally, 2 for a golden make. */
  worth: number;
}

export function dealTable(playerIds: readonly string[], lives = STARTING_LIVES): FlipTable {
  return {
    seats: playerIds.map((playerId) => ({
      playerId,
      lives,
      streak: 0,
      heatingUp: false,
      onFire: false,
      eliminated: false,
      outOrder: null,
    })),
    turn: 0,
    stake: 0,
    flips: 0,
    outCount: 0,
  };
}

export function suddenDeathLevel(flips: number): number {
  return flips > SD_THRESHOLD ? Math.floor((flips - SD_THRESHOLD) / SD_STEP) + 1 : 0;
}

/** Would the current flipper be knocked out by missing the next flip? */
export function missWouldEliminate(table: FlipTable): boolean {
  const seat = table.seats[table.turn];
  if (!seat || seat.eliminated) return false;
  const sd = suddenDeathLevel(table.flips + 1);
  const penalty = seat.onFire ? sd : table.stake + sd;
  return penalty > 0 && seat.lives - penalty <= 0;
}

/** Apply one flip for the current seat. Mutates the table. */
export function resolveFlip(table: FlipTable, made: boolean, meta: FlipMeta = {}): FlipOutcome {
  const seat = table.seats[table.turn]!;
  const golden = made && !!meta.golden;
  const worth = golden ? 2 : 1;
  const out: FlipOutcome = {
    made,
    penalty: 0,
    fireGain: 0,
    justIgnited: false,
    fireEnded: false,
    eliminated: false,
    golden,
    worth,
  };
  table.flips += 1;
  const sd = suddenDeathLevel(table.flips);

  if (seat.onFire) {
    if (made) {
      if (!sd) {
        const before = seat.lives;
        seat.lives = Math.min(seat.lives + worth, MAX_LIVES);
        out.fireGain = seat.lives - before;
      }
      // Hitting the life cap ends the run cleanly.
      if (seat.lives >= MAX_LIVES) endFire(seat);
    } else {
      if (sd) out.penalty = loseLives(table, seat, sd);
      endFire(seat);
      out.fireEnded = true;
    }
    out.eliminated = seat.eliminated;
    return out;
  }

  if (made) {
    seat.streak += 1;
    table.stake += worth;
    seat.heatingUp = seat.streak === 2;
    if (seat.streak >= 3) {
      seat.onFire = true;
      seat.heatingUp = false;
      out.justIgnited = true;
    }
  } else {
    out.penalty = loseLives(table, seat, table.stake + sd);
    seat.streak = 0;
    seat.heatingUp = false;
    table.stake = 0;
  }
  out.eliminated = seat.eliminated;
  return out;
}

function endFire(seat: FlipSeat): void {
  seat.onFire = false;
  seat.heatingUp = false;
  seat.streak = 0;
}

function loseLives(table: FlipTable, seat: FlipSeat, amount: number): number {
  const before = seat.lives;
  seat.lives = Math.max(0, seat.lives - amount);
  if (seat.lives <= 0 && !seat.eliminated) {
    seat.eliminated = true;
    seat.outOrder = table.outCount;
    table.outCount += 1;
    endFire(seat);
  }
  return before - seat.lives;
}

export function activeSeats(table: FlipTable): FlipSeat[] {
  return table.seats.filter((seat) => !seat.eliminated);
}

export function isOver(table: FlipTable): boolean {
  return table.seats.length > 0 && activeSeats(table).length <= 1;
}

/** ON FIRE keeps the turn; otherwise pass to the next player still in. Mutates the table. */
export function advanceTurn(table: FlipTable): void {
  if (isOver(table)) return;
  const current = table.seats[table.turn]!;
  if (current.onFire && !current.eliminated) return;
  const n = table.seats.length;
  for (let step = 1; step <= n; step += 1) {
    const next = (table.turn + step) % n;
    if (!table.seats[next]!.eliminated) {
      table.turn = next;
      return;
    }
  }
}

/** CPU aims at the ~2100 px/s sweet spot with classroom miss chance. */
export function botFlick(rng: Rng): { vx: number; vy: number } {
  const sigma = 540;
  const u1 = Math.max(rng.next(), 1e-6);
  const u2 = rng.next();
  const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const up = Math.max(500, 2100 + gauss * sigma);
  const vx = (rng.next() - 0.5) * 520;
  return { vx, vy: -up };
}

/** Last standing ranks first; everyone else by how long they survived. */
export function scoresFromTable(table: FlipTable): { playerId: string; score: number }[] {
  const n = table.seats.length;
  return table.seats.map((seat) => ({
    playerId: seat.playerId,
    score: seat.eliminated ? (seat.outOrder ?? 0) : n + seat.lives,
  }));
}

// ---- Duel: two players flip at the same time ---------------------------------
//
// Same lives, stake, streaks, ON FIRE, golden flips and sudden death as the
// classic game, resolved in rounds where both duelists flip at once:
// - Every non-fire make adds its worth to the shared stake (both make = +2).
// - Anyone who misses pays the stake (after this round's makes), then it resets.
//   Both miss = both pay.
// - ON FIRE: a make is +worth lives, a miss is free and ends the run.
// - Both knocked out in the same round = DOUBLE KO: both come back on 1 life.
// - 3-4 players: winner stays on; the next waiting player replaces whoever is out.

export interface Duel {
  table: FlipTable;
  /** Seat index on the left and right half of the screen. */
  sides: [number, number];
  /** Waiting seat indexes, in order. */
  queue: number[];
}

export interface DuelSideOutcome extends FlipOutcome {
  seat: number;
}

export interface DuelRound {
  sides: [DuelSideOutcome, DuelSideOutcome];
  doubleKo: boolean;
  /** Stake before it was paid and reset (0 if nobody paid). */
  stakePaid: number;
}

export function dealDuel(playerIds: readonly string[], lives = STARTING_LIVES): Duel {
  const table = dealTable(playerIds, lives);
  return {
    table,
    sides: [0, 1],
    queue: playerIds.map((_, i) => i).slice(2),
  };
}

/** Would this duelist be knocked out by missing the coming round (ignoring the other's make)? */
export function duelMissWouldEliminate(duel: Duel, side: 0 | 1): boolean {
  const seat = duel.table.seats[duel.sides[side]];
  if (!seat || seat.eliminated) return false;
  const sd = suddenDeathLevel(duel.table.flips + 2);
  const penalty = seat.onFire ? sd : duel.table.stake + sd;
  return penalty > 0 && seat.lives - penalty <= 0;
}

/** Resolve one simultaneous round. Mutates the duel's table. */
export function resolveDuelRound(
  duel: Duel,
  made: readonly [boolean, boolean],
  meta: readonly [FlipMeta, FlipMeta] = [{}, {}],
): DuelRound {
  const { table } = duel;
  table.flips += 2;
  const sd = suddenDeathLevel(table.flips);
  const wasOnFire = duel.sides.map((i) => table.seats[i]!.onFire);
  const outs = duel.sides.map((seatIndex, side) => {
    const golden = made[side]! && !!meta[side]?.golden;
    return {
      seat: seatIndex,
      made: made[side]!,
      penalty: 0,
      fireGain: 0,
      justIgnited: false,
      fireEnded: false,
      eliminated: false,
      golden,
      worth: golden ? 2 : 1,
    } satisfies DuelSideOutcome;
  }) as [DuelSideOutcome, DuelSideOutcome];

  // Makes first, so the stake a misser pays includes this round's makes.
  outs.forEach((out, side) => {
    if (!out.made) return;
    const seat = table.seats[out.seat]!;
    if (wasOnFire[side]) {
      if (!sd) {
        const before = seat.lives;
        seat.lives = Math.min(seat.lives + out.worth, MAX_LIVES);
        out.fireGain = seat.lives - before;
      }
      if (seat.lives >= MAX_LIVES) endFire(seat);
      return;
    }
    seat.streak += 1;
    table.stake += out.worth;
    seat.heatingUp = seat.streak === 2;
    if (seat.streak >= 3) {
      seat.onFire = true;
      seat.heatingUp = false;
      out.justIgnited = true;
    }
  });

  const stake = table.stake;
  let paid = false;
  outs.forEach((out, side) => {
    if (out.made) return;
    const seat = table.seats[out.seat]!;
    if (wasOnFire[side]) {
      if (sd) out.penalty = loseLives(table, seat, sd);
      endFire(seat);
      out.fireEnded = true;
      return;
    }
    out.penalty = loseLives(table, seat, stake + sd);
    seat.streak = 0;
    seat.heatingUp = false;
    paid = true;
  });
  if (paid) table.stake = 0;

  let doubleKo = false;
  const [a, b] = outs.map((out) => table.seats[out.seat]!);
  if (a!.eliminated && b!.eliminated && activeSeats(table).length === 0) {
    // Nobody left standing: both come back on one life and it continues.
    doubleKo = true;
    for (const seat of [a!, b!]) {
      seat.eliminated = false;
      seat.outOrder = null;
      seat.lives = 1;
    }
    table.outCount -= 2;
    table.stake = 0;
  }
  outs.forEach((out) => (out.eliminated = table.seats[out.seat]!.eliminated));
  return { sides: outs, doubleKo, stakePaid: paid ? stake : 0 };
}

/** Winner stays on: swap in the next waiting player for anyone knocked out. Returns the sides that changed. */
export function advanceDuel(duel: Duel): (0 | 1)[] {
  const changed: (0 | 1)[] = [];
  for (const side of [0, 1] as const) {
    if (!duel.table.seats[duel.sides[side]]!.eliminated) continue;
    const next = duel.queue.shift();
    if (next === undefined) continue;
    duel.sides[side] = next;
    changed.push(side);
  }
  return changed;
}

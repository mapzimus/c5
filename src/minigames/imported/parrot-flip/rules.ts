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
export function resolveFlip(table: FlipTable, made: boolean): FlipOutcome {
  const seat = table.seats[table.turn]!;
  const out: FlipOutcome = { made, penalty: 0, fireGain: 0, justIgnited: false, fireEnded: false, eliminated: false };
  table.flips += 1;
  const sd = suddenDeathLevel(table.flips);

  if (seat.onFire) {
    if (made) {
      if (!sd) {
        const before = seat.lives;
        seat.lives = Math.min(seat.lives + 1, MAX_LIVES);
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
    table.stake += 1;
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

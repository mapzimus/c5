import type { Rng } from "../../../core/rng";

/**
 * Bottle-game rules ported from mapzimus/flipgame (js/game.js), reworked for a
 * 45-100 second party match ("Parrot Flip: Walk the Perch"):
 * - Everyone starts with STARTING_LIVES.
 * - Each make adds its worth to the shared stake. A miss costs the flipper the
 *   stake (at least MIN_PENALTY), then the stake resets.
 * - 2 makes in a row = Heating Up. 3 = ON FIRE: each make is +worth lives, a
 *   miss just ends the run (no penalty, stake carries over). The fire carries
 *   over to your next turn; it no longer keeps the turn.
 * - THE PERCH: a glowing target on the ground that moves every flip. Land on
 *   it and the make is golden (worth 2). The seat with the fewest lives gets a
 *   wider perch (underdog).
 * - Rounds: every living seat flips once per round. The last OVERDRIVE_ROUNDS
 *   rounds are OVERDRIVE: misses cost OVERDRIVE_EXTRA more and the stake never
 *   resets. After the final round the most lives wins.
 * - 0 lives = out, but ghosts keep playing: before every flip they bet MAKE or
 *   MISS. A correct call is a doubloon (ranks the ghosts); RETURN_STREAK
 *   correct calls in a row and the ghost comes back with one life, once.
 */
export const STARTING_LIVES = 6;
/** Two-player tables get more lives so a match is not over in a dozen flips. */
export const DUO_LIVES = 10;
export const MAX_LIVES = 12;
/** A miss always costs at least this many lives in the classic game. */
export const MIN_PENALTY = 1;
/** The last N rounds of a match run in OVERDRIVE. */
export const OVERDRIVE_ROUNDS = 2;
/** Extra lives lost per miss in OVERDRIVE. */
export const OVERDRIVE_EXTRA = 1;
/** Correct ghost calls in a row needed to come back from the deep. */
export const RETURN_STREAK = 3;
/** Make/miss history kept per seat (for the make-rate readout). */
export const RECENT_FLIPS = 10;
/** Half width of the perch target, in world px; the underdog gets UNDERDOG_SCALE times that. */
export const PERCH_HALF = 70;
export const UNDERDOG_SCALE = 1.5;
/** Sudden death for the duel: flips before misses start costing extra. */
export const SD_THRESHOLD = 40;
export const SD_STEP = 16;
/**
 * Golden flip odds for the duel, matching flipgame (js/main.js: `seed % 150 === 77`): 1 in 150 flicks.
 * In the classic game golden flips come from landing on the perch instead.
 */
export const GOLDEN_ODDS = 150;

/** Roll the golden-flip lottery for one flick (1 in GOLDEN_ODDS). */
export function rollGolden(rng: Rng): boolean {
  return rng.int(0, GOLDEN_ODDS - 1) === 77 % GOLDEN_ODDS;
}

/** Rounds in a match: everyone flips once per round. Tuned for 45-100 s with bots and humans. */
export function roundsFor(playerCount: number): number {
  if (playerCount <= 2) return 10;
  if (playerCount === 3) return 7;
  return 5;
}

/** Starting lives for a table of this size. */
export function livesFor(playerCount: number): number {
  return playerCount <= 2 ? DUO_LIVES : STARTING_LIVES;
}

/** Per-flip extras, like flipgame's resolveFlip `meta`. */
export interface FlipMeta {
  /** Golden make: worth 2 (duel lottery, or landed on the perch). */
  golden?: boolean;
}

export type Bet = "MAKE" | "MISS";

export interface FlipSeat {
  playerId: string;
  lives: number;
  streak: number;
  heatingUp: boolean;
  onFire: boolean;
  eliminated: boolean;
  /** Flip count when this seat was knocked out (later = survived longer). Null while alive. */
  outOrder: number | null;
  /** Ghost call for the coming flip. */
  bet: Bet | null;
  /** Correct ghost calls (ranks the ghosts). */
  doubloons: number;
  /** Correct ghost calls in a row. */
  betStreak: number;
  /** Already came back from the deep once. */
  returned: boolean;
  makes: number;
  attempts: number;
  perches: number;
  /** Last RECENT_FLIPS results, newest last. */
  recent: boolean[];
}

export interface Perch {
  x: number;
  halfWidth: number;
}

export interface FlipTable {
  seats: FlipSeat[];
  turn: number;
  stake: number;
  flips: number;
  outCount: number;
  /** 1-based round; every living seat flips once per round. */
  round: number;
  /** Round cap: after this round the most lives wins. */
  rounds: number;
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
  /** The flip happened in OVERDRIVE (stake kept, extra penalty). */
  overdrive: boolean;
}

export interface BetResult {
  seat: number;
  bet: Bet;
  hit: boolean;
  /** Reached RETURN_STREAK and came back with one life. */
  returned: boolean;
}

export function dealTable(playerIds: readonly string[], lives = livesFor(playerIds.length), rounds = roundsFor(playerIds.length)): FlipTable {
  return {
    seats: playerIds.map((playerId) => ({
      playerId,
      lives,
      streak: 0,
      heatingUp: false,
      onFire: false,
      eliminated: false,
      outOrder: null,
      bet: null,
      doubloons: 0,
      betStreak: 0,
      returned: false,
      makes: 0,
      attempts: 0,
      perches: 0,
      recent: [],
    })),
    turn: 0,
    stake: 0,
    flips: 0,
    outCount: 0,
    round: 1,
    rounds,
  };
}

export function suddenDeathLevel(flips: number): number {
  return flips > SD_THRESHOLD ? Math.floor((flips - SD_THRESHOLD) / SD_STEP) + 1 : 0;
}

export function isOverdrive(table: FlipTable): boolean {
  return table.round > table.rounds - OVERDRIVE_ROUNDS;
}

export function isFinalRound(table: FlipTable): boolean {
  return table.round === table.rounds;
}

/** What the current flipper loses on a miss right now. */
export function missPenalty(table: FlipTable): number {
  const seat = table.seats[table.turn];
  if (!seat || seat.eliminated) return 0;
  const extra = isOverdrive(table) ? OVERDRIVE_EXTRA : 0;
  if (seat.onFire) return extra;
  return Math.max(MIN_PENALTY, table.stake) + extra;
}

/** Would the current flipper be knocked out by missing the next flip? */
export function missWouldEliminate(table: FlipTable): boolean {
  const seat = table.seats[table.turn];
  if (!seat || seat.eliminated) return false;
  const penalty = missPenalty(table);
  return penalty > 0 && seat.lives - penalty <= 0;
}

/** Apply one flip for the current seat. Mutates the table. */
export function resolveFlip(table: FlipTable, made: boolean, meta: FlipMeta = {}): FlipOutcome {
  const seat = table.seats[table.turn]!;
  const golden = made && !!meta.golden;
  const worth = golden ? 2 : 1;
  const overdrive = isOverdrive(table);
  const out: FlipOutcome = {
    made,
    penalty: 0,
    fireGain: 0,
    justIgnited: false,
    fireEnded: false,
    eliminated: false,
    golden,
    worth,
    overdrive,
  };
  table.flips += 1;
  seat.attempts += 1;
  if (made) seat.makes += 1;
  if (golden) seat.perches += 1;
  seat.recent.push(made);
  if (seat.recent.length > RECENT_FLIPS) seat.recent.shift();
  const extra = overdrive ? OVERDRIVE_EXTRA : 0;

  if (seat.onFire) {
    if (made) {
      const before = seat.lives;
      seat.lives = Math.min(seat.lives + worth, MAX_LIVES);
      out.fireGain = seat.lives - before;
      // Hitting the life cap ends the run cleanly.
      if (seat.lives >= MAX_LIVES) endFire(seat);
    } else {
      if (extra) out.penalty = loseLives(table, seat, extra);
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
    out.penalty = loseLives(table, seat, Math.max(MIN_PENALTY, table.stake) + extra);
    seat.streak = 0;
    seat.heatingUp = false;
    if (!overdrive) table.stake = 0;
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
    seat.outOrder = table.flips;
    table.outCount += 1;
    endFire(seat);
  }
  return before - seat.lives;
}

export function activeSeats(table: FlipTable): FlipSeat[] {
  return table.seats.filter((seat) => !seat.eliminated);
}

export function ghostSeats(table: FlipTable): number[] {
  return table.seats.map((seat, i) => (seat.eliminated ? i : -1)).filter((i) => i >= 0);
}

export function isOver(table: FlipTable): boolean {
  if (table.seats.length === 0) return false;
  return activeSeats(table).length <= 1 || table.round > table.rounds;
}

/**
 * Pass to the next player still in; wrapping around starts the next round.
 * Mutates the table. Returns true when a new round began.
 */
export function advanceTurn(table: FlipTable): boolean {
  if (activeSeats(table).length <= 1) return false;
  const n = table.seats.length;
  for (let step = 1; step <= n; step += 1) {
    const next = (table.turn + step) % n;
    if (!table.seats[next]!.eliminated) {
      const wrapped = next <= table.turn;
      table.turn = next;
      if (wrapped) table.round += 1;
      return wrapped;
    }
  }
  return false;
}

// ---- The perch ------------------------------------------------------------------

/** Place the perch left or right of the start, never on the same side twice. */
export function rollPerch(rng: Rng, width: number, prev: Perch | null = null): Perch {
  const centre = width / 2;
  let sign = rng.sign();
  if (prev) sign = prev.x < centre ? 1 : -1;
  const offset = rng.float(120, 230);
  return { x: centre + sign * offset, halfWidth: PERCH_HALF };
}

/** Seat with strictly the fewest lives among the living (null when tied or alone). */
export function underdogSeat(table: FlipTable): number | null {
  const alive = table.seats.map((seat, i) => ({ seat, i })).filter(({ seat }) => !seat.eliminated);
  if (alive.length < 2) return null;
  let best: { seat: FlipSeat; i: number } | null = null;
  let tie = false;
  for (const entry of alive) {
    if (!best || entry.seat.lives < best.seat.lives) {
      best = entry;
      tie = false;
    } else if (entry.seat.lives === best.seat.lives) tie = true;
  }
  return best && !tie ? best.i : null;
}

/** The perch as the given seat sees it (wider for the underdog). */
export function perchFor(table: FlipTable, perch: Perch, seatIndex: number): Perch {
  const wide = underdogSeat(table) === seatIndex;
  return { x: perch.x, halfWidth: wide ? perch.halfWidth * UNDERDOG_SCALE : perch.halfWidth };
}

export function onPerch(perch: Perch, landX: number): boolean {
  return Math.abs(landX - perch.x) <= perch.halfWidth;
}

// ---- Ghost bets -------------------------------------------------------------------

/** A knocked-out seat calls the coming flip. Returns false for living seats. */
export function placeBet(table: FlipTable, seatIndex: number, bet: Bet): boolean {
  const seat = table.seats[seatIndex];
  if (!seat || !seat.eliminated) return false;
  seat.bet = bet;
  return true;
}

/** Pay out the ghosts' calls after a flip resolves. Mutates the table. */
export function settleBets(table: FlipTable, made: boolean): BetResult[] {
  const results: BetResult[] = [];
  table.seats.forEach((seat, index) => {
    if (!seat.eliminated || !seat.bet) return;
    const hit = (seat.bet === "MAKE") === made;
    const result: BetResult = { seat: index, bet: seat.bet, hit, returned: false };
    seat.bet = null;
    if (hit) {
      seat.doubloons += 1;
      seat.betStreak += 1;
      if (seat.betStreak >= RETURN_STREAK && !seat.returned && activeSeats(table).length >= 2) {
        seat.returned = true;
        seat.betStreak = 0;
        seat.eliminated = false;
        seat.outOrder = null;
        seat.lives = 1;
        table.outCount -= 1;
        result.returned = true;
      }
    } else seat.betStreak = 0;
    results.push(result);
  });
  return results;
}

/** Bot ghosts lean MAKE, more so when the flipper is hot. */
export function botBet(rng: Rng, table: FlipTable): Bet {
  const flipper = table.seats[table.turn];
  let p = 0.58;
  if (flipper?.onFire) p += 0.17;
  else if (flipper?.heatingUp) p += 0.08;
  return rng.next() < p ? "MAKE" : "MISS";
}

// ---- Feedback ----------------------------------------------------------------------

export interface MissCueInfo {
  reason: string;
  /** Full turns completed at touchdown. */
  turns: number;
  /** Tilt from upright at touchdown (radians), null if it never came down cleanly. */
  touchdownTilt: number | null;
}

/** Short cause-of-miss cue so a miss teaches something. */
export function missCue(info: MissCueInfo): { text: string; close: boolean } {
  if (info.reason === "timeout") return { text: "WOBBLED OUT", close: false };
  if (info.reason === "underrotated") return { text: "TOO SOFT", close: false };
  if (info.touchdownTilt != null && info.touchdownTilt < 0.5) return { text: "SO CLOSE! TIPPED OVER", close: true };
  if (info.turns > 1.3) return { text: "TOO HARD · OVER-SPUN", close: false };
  if (info.turns < 0.85) return { text: "TOO SOFT · UNDER-SPUN", close: false };
  return { text: "TIPPED OVER", close: false };
}

/** CPU aims at the ~2100 px/s sweet spot with classroom miss chance; optionally aims sideways at the perch. */
export function botFlick(rng: Rng, aim: { dx: number; skill?: number } | null = null): { vx: number; vy: number } {
  const sigma = 540;
  const u1 = Math.max(rng.next(), 1e-6);
  const u2 = rng.next();
  const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const up = Math.max(500, 2100 + gauss * sigma);
  if (!aim) return { vx: (rng.next() - 0.5) * 520, vy: -up };
  // Landing drift is about 0.13 px per px/s of sideways flick (see physics.test).
  const skill = aim.skill ?? 0.5;
  const vx = aim.dx * 7.7 * rng.float(0.6, 1.3) + (rng.next() - 0.5) * (1500 - 1000 * skill);
  return { vx: Math.max(-1700, Math.min(1700, vx)), vy: -up };
}

/** Survivors rank by lives (20 + lives); ghosts (always below) by doubloons, then by how long they lasted. */
export function scoresFromTable(table: FlipTable): { playerId: string; score: number }[] {
  const outs = table.seats
    .filter((seat) => seat.eliminated)
    .sort((a, b) => (a.outOrder ?? 0) - (b.outOrder ?? 0));
  return table.seats.map((seat) => ({
    playerId: seat.playerId,
    score: seat.eliminated ? Math.min(19, seat.doubloons * 4 + Math.min(3, outs.indexOf(seat))) : 20 + seat.lives,
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
      overdrive: false,
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

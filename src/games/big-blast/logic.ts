import type { Rng } from "../../core/rng";

/**
 * Pure rules for Big Blast. No canvas, no DOM. Times are ms.
 *
 * One bomb, five plungers, one of them live. Every dud you press pays a bounty that
 * climbs with the danger. Bounties sit in your STAKE until the bomb goes off: the
 * victim's stake burns, everyone else banks theirs plus a survival bonus. After a
 * dud you choose: press AGAIN (more coins, more danger, fewer safe plungers for the
 * next player) or STOP. Whoever got toasted last holds a JINX: once, they can cancel
 * someone's STOP and make them press again.
 */

export const PLUNGERS = 5;
export const BOMBS = 4;
/** A player gets this long to pick a plunger before one is picked for them. */
export const TURN_MS = 4000;
/** After a dud, this long to press again before you auto-STOP. */
export const AGAIN_MS = 2600;
/** Hiss time between pressing the live plunger and the KABOOM. */
export const FUSE_MS = 600;
/** Base bounty for a dud, indexed by how many plungers were open when it was pressed. */
export const BOUNTY: readonly number[] = [0, 0, 50, 30, 20, 10];
/** Everyone who is not toasted banks this on top of their stake. */
export const SURVIVE_BONUS = 20;
/** The last bomb pays double. */
export const FINAL_MULT = 2;
/** Seats with the fewest coins earn double bounties. */
export const UNDERDOG_MULT = 2;

export interface BombState {
  /** Secret index of the live plunger. */
  live: number;
  pressed: boolean[];
}

export function newBomb(rng: Rng): BombState {
  return { live: rng.int(0, PLUNGERS - 1), pressed: Array(PLUNGERS).fill(false) };
}

export interface MatchState {
  /** Banked coins per seat (the score). */
  coins: number[];
  /** Unbanked coins earned on the current bomb, burned if you get toasted. */
  stake: number[];
  /** Times each seat has been blown up. */
  toasted: number[];
  /** Longest run of duds in one turn per seat. */
  bestChain: number[];
  /** Seat whose turn it is. */
  turn: number;
  /** Duds the current seat has pressed this turn. */
  chain: number;
  bomb: BombState;
  /** 1-based bomb number. */
  round: number;
  /** Seat holding the JINX this bomb (whoever was toasted last), if it is unused. */
  jinx: number | null;
  /** Seats in the order they were blown up. */
  victims: number[];
}

export function newMatch(seats: number, rng: Rng): MatchState {
  return {
    coins: Array(seats).fill(0),
    stake: Array(seats).fill(0),
    toasted: Array(seats).fill(0),
    bestChain: Array(seats).fill(0),
    turn: 0,
    chain: 0,
    bomb: newBomb(rng),
    round: 1,
    jinx: null,
    victims: [],
  };
}

export function unpressed(bomb: BombState): number[] {
  const out: number[] = [];
  for (let i = 0; i < bomb.pressed.length; i++) if (!bomb.pressed[i]) out.push(i);
  return out;
}

/** 0 on a fresh bomb, 1 when only the live plunger is left. */
export function tension(bomb: BombState): number {
  const left = unpressed(bomb).length;
  return Math.min(1, Math.max(0, (PLUNGERS - left) / (PLUNGERS - 1)));
}

/** Chance the next press is the live one. */
export function liveOdds(bomb: BombState): number {
  const left = unpressed(bomb).length;
  return left === 0 ? 1 : 1 / left;
}

export function isFinalBomb(m: MatchState): boolean {
  return m.round >= BOMBS;
}

/** Seats with the fewest banked coins, only once someone is ahead of them. */
export function underdogs(m: MatchState): number[] {
  let min = Infinity;
  let max = -Infinity;
  for (const c of m.coins) { min = Math.min(min, c); max = Math.max(max, c); }
  if (min >= max) return [];
  const out: number[] = [];
  m.coins.forEach((c, i) => { if (c === min) out.push(i); });
  return out;
}

export interface Bounty {
  base: number;
  /** Combined underdog and final-bomb multiplier (1, 2 or 4). */
  mult: number;
  total: number;
}

/** What `seat` earns for pressing a dud right now. */
export function bounty(m: MatchState, seat: number): Bounty {
  const base = BOUNTY[unpressed(m.bomb).length] ?? 0;
  let mult = 1;
  if (isFinalBomb(m)) mult *= FINAL_MULT;
  if (underdogs(m).includes(seat)) mult *= UNDERDOG_MULT;
  return { base, mult, total: base * mult };
}

export function nextSeat(m: MatchState, from: number): number {
  return (from + 1) % m.coins.length;
}

export type PressResult = "ignored" | "dud" | "boom";

/**
 * `seat` presses `plunger`. A dud adds the bounty to their stake and keeps the turn
 * (they now choose: again or stop); a boom keeps the turn until `blowUp` runs.
 */
export function press(m: MatchState, seat: number, plunger: number): PressResult {
  if (seat !== m.turn) return "ignored";
  if (plunger < 0 || plunger >= PLUNGERS || m.bomb.pressed[plunger]) return "ignored";
  const pay = bounty(m, seat).total;
  m.bomb.pressed[plunger] = true;
  if (plunger === m.bomb.live) return "boom";
  m.stake[seat] = (m.stake[seat] ?? 0) + pay;
  m.chain += 1;
  if (m.chain > (m.bestChain[seat] ?? 0)) m.bestChain[seat] = m.chain;
  return "dud";
}

/** The current seat stops pressing; the turn passes on. Only legal after at least one dud. */
export function stop(m: MatchState, seat: number): boolean {
  if (seat !== m.turn || m.chain === 0) return false;
  m.chain = 0;
  m.turn = nextSeat(m, seat);
  return true;
}

/** Can `holder` jinx `stopper`'s STOP right now? */
export function canJinx(m: MatchState, holder: number, stopper: number): boolean {
  return m.jinx === holder && holder !== stopper && stopper === m.turn && m.chain > 0;
}

/**
 * `holder` spends the JINX on `stopper`: their STOP is cancelled and they must press
 * again. The turn stays with the stopper. Returns false if the jinx is not available.
 */
export function useJinx(m: MatchState, holder: number, stopper: number): boolean {
  if (!canJinx(m, holder, stopper)) return false;
  m.jinx = null;
  return true;
}

/**
 * Blow up `seat`: their stake burns, everyone else banks stake + bonus, the victim
 * gets the JINX and goes first on the next bomb.
 */
export function blowUp(m: MatchState, seat: number, rng: Rng): void {
  const bonus = SURVIVE_BONUS * (isFinalBomb(m) ? FINAL_MULT : 1);
  for (let i = 0; i < m.coins.length; i++) {
    if (i !== seat) m.coins[i] = (m.coins[i] ?? 0) + (m.stake[i] ?? 0) + bonus;
    m.stake[i] = 0;
  }
  m.toasted[seat] = (m.toasted[seat] ?? 0) + 1;
  m.victims.push(seat);
  m.jinx = seat;
  m.chain = 0;
  m.bomb = newBomb(rng);
  m.round += 1;
  m.turn = seat;
}

export function matchOver(m: MatchState): boolean {
  return m.round > BOMBS;
}

/** Banked coins. */
export function scores(m: MatchState): number[] {
  return [...m.coins];
}

export function randomPlunger(bomb: BombState, rng: Rng): number {
  const open = unpressed(bomb);
  return open.length === 0 ? 0 : rng.pick(open);
}

export interface BotPlan {
  /** When the bot presses, ms from turn start. */
  atMs: number;
  target: number;
  /** Plungers the hand teases over on the way, in time order. */
  hovers: { atMs: number; plunger: number }[];
}

/** Bots press after 0.6-1.6s, sometimes hovering over two plungers first. */
export function planBotPress(bomb: BombState, rng: Rng, hoverChance = 0.55): BotPlan {
  const open = unpressed(bomb);
  const target = open.length === 0 ? 0 : rng.pick(open);
  const atMs = Math.round(rng.float(600, 1600));
  const hovers: BotPlan["hovers"] = [];
  if (open.length >= 2 && rng.next() < hoverChance) {
    const a = rng.pick(open);
    let b = rng.pick(open);
    while (b === a) b = rng.pick(open);
    hovers.push({ atMs: Math.round(atMs * 0.3), plunger: a });
    hovers.push({ atMs: Math.round(atMs * 0.62), plunger: b });
  }
  return { atMs, target, hovers };
}

/** Base chance a bot presses again, by plungers still open. */
const AGAIN_BASE: readonly number[] = [0, 0, 0.18, 0.4, 0.65, 0.9];

/**
 * Chance (0-1) that a bot with this much `nerve` (0 timid .. 1 reckless) presses again.
 * Greedier when safe, when its stake is small, when it is behind, and on the final bomb.
 * Never presses into a certain boom.
 */
export function botAgainChance(m: MatchState, seat: number, nerve: number): number {
  const open = unpressed(m.bomb).length;
  if (open <= 1) return 0;
  let p = AGAIN_BASE[open] ?? 0;
  p -= (m.stake[seat] ?? 0) / 250;
  const lead = Math.max(...m.coins) - (m.coins[seat] ?? 0);
  if (lead >= 40) p += 0.2;
  if (isFinalBomb(m)) p += 0.12;
  p += (nerve - 0.5) * 0.4;
  return Math.min(0.95, Math.max(0.02, p));
}

/** Bots decide again/stop 0.45-1.2s after a dud. */
export function planBotAgain(m: MatchState, seat: number, nerve: number, rng: Rng): { again: boolean; atMs: number } {
  const again = rng.next() < botAgainChance(m, seat, nerve);
  return { again, atMs: Math.round(rng.float(450, 1200)) };
}

/** Chance a bot spends its JINX on `stopper`: nearly certain when it would be a death sentence. */
export function botJinxChance(m: MatchState, stopper: number): number {
  const open = unpressed(m.bomb).length;
  let p = [0, 0.97, 0.72, 0.38, 0.14, 0.05][open] ?? 0;
  const leader = m.coins.indexOf(Math.max(...m.coins));
  if (leader === stopper && (m.coins[stopper] ?? 0) > 0) p += 0.15;
  if (isFinalBomb(m)) p += 0.1;
  return Math.min(0.98, p);
}

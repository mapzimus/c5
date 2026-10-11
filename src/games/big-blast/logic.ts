import type { Rng } from "../../core/rng";

/** Pure rules for Big Blast. No canvas, no DOM. Times are ms. */

export const PLUNGERS = 5;
/** A player gets this long to pick a plunger before one is picked for them. */
export const TURN_MS = 4000;
/** Hiss time between pressing the live plunger and the KABOOM. */
export const FUSE_MS = 600;

export interface BombState {
  /** Secret index of the live plunger. */
  live: number;
  pressed: boolean[];
}

export function newBomb(rng: Rng): BombState {
  return { live: rng.int(0, PLUNGERS - 1), pressed: Array(PLUNGERS).fill(false) };
}

export interface MatchState {
  alive: boolean[];
  /** Seats in the order they were blown up. */
  blownUp: number[];
  /** Blasts each seat lived through. */
  survived: number[];
  /** Seat whose turn it is. */
  turn: number;
  bomb: BombState;
  /** 1-based bomb number. */
  round: number;
}

export function newMatch(seats: number, rng: Rng): MatchState {
  return {
    alive: Array(seats).fill(true),
    blownUp: [],
    survived: Array(seats).fill(0),
    turn: 0,
    bomb: newBomb(rng),
    round: 1,
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

export function survivors(m: MatchState): number[] {
  const out: number[] = [];
  for (let i = 0; i < m.alive.length; i++) if (m.alive[i]) out.push(i);
  return out;
}

/** Next living seat after `from` in seat order (wraps). Returns `from` if nobody else lives. */
export function nextAlive(m: MatchState, from: number): number {
  const n = m.alive.length;
  for (let k = 1; k <= n; k++) {
    const seat = (from + k) % n;
    if (m.alive[seat]) return seat;
  }
  return from;
}

export type PressResult = "ignored" | "dud" | "boom";

/**
 * `seat` presses `plunger`. A dud passes the turn on; a boom leaves the turn on the
 * presser until `blowUp` runs (after the fuse).
 */
export function press(m: MatchState, seat: number, plunger: number): PressResult {
  if (seat !== m.turn || !m.alive[seat]) return "ignored";
  if (plunger < 0 || plunger >= PLUNGERS || m.bomb.pressed[plunger]) return "ignored";
  m.bomb.pressed[plunger] = true;
  if (plunger === m.bomb.live) return "boom";
  m.turn = nextAlive(m, seat);
  return "dud";
}

/** Eliminate `seat`, credit everyone else a survived blast, reset the bomb, pass the turn. */
export function blowUp(m: MatchState, seat: number, rng: Rng): void {
  if (!m.alive[seat]) return;
  m.alive[seat] = false;
  m.blownUp.push(seat);
  for (let i = 0; i < m.alive.length; i++) if (m.alive[i]) m.survived[i] = (m.survived[i] ?? 0) + 1;
  m.bomb = newBomb(rng);
  m.round += 1;
  m.turn = nextAlive(m, seat);
}

export function matchOver(m: MatchState): boolean {
  return survivors(m).length <= 1;
}

/** Elimination order: first blown up scores 0, survivors score highest. */
export function scores(m: MatchState): number[] {
  const out = Array<number>(m.alive.length).fill(m.blownUp.length);
  m.blownUp.forEach((seat, order) => { out[seat] = order; });
  return out;
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

/** Bots press after 0.8-2.2s, sometimes hovering over two plungers first. */
export function planBotPress(bomb: BombState, rng: Rng, hoverChance = 0.55): BotPlan {
  const open = unpressed(bomb);
  const target = open.length === 0 ? 0 : rng.pick(open);
  const atMs = Math.round(rng.float(800, 2200));
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

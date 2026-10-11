import type { Rng } from "../../core/rng";

/** Pure rules for Flag Flash. No canvas, no DOM. Times are ms. */

export type CallKind = "RED" | "BLUE" | "BOTH" | "NONE";
export type Half = "left" | "right";
export type Flag = "RED" | "BLUE";

export const WINS_NEEDED = 3;
export const MAX_ROUNDS = 7;
export const START_WINDOW_MS = 1500;
export const MIN_WINDOW_MS = 500;
export const WINDOW_STEP_MS = 100;
/** Two taps this close together count as a BOTH response. */
export const BOTH_GRACE_MS = 150;
export const FEINT_MS = 380;
export const RESOLVE_MS = 450;
/** Safety valve: a round that drags past this many calls is void. */
export const MAX_CALLS = 24;

export function windowMs(callIndex: number): number {
  return Math.max(MIN_WINDOW_MS, START_WINDOW_MS - callIndex * WINDOW_STEP_MS);
}

/** Feints get more frequent as the round goes on. */
export function feintChance(callIndex: number): number {
  return Math.min(0.6, 0.12 + callIndex * 0.06);
}

export function pickCall(rng: Rng): CallKind {
  const r = rng.next();
  if (r < 0.32) return "RED";
  if (r < 0.64) return "BLUE";
  if (r < 0.82) return "BOTH";
  return "NONE";
}

export type Phase = "gap" | "feint" | "call" | "resolve" | "done";
export type OutReason = "jumped" | "wrong" | "slow" | "twitchy";

export interface SeatState {
  alive: boolean;
  /** Reaction ms of a correct response to the current call, or null. */
  hitMs: number | null;
  /** First tap of a BOTH response, waiting for its partner. */
  pendingAt: number | null;
  outReason: OutReason | null;
}

export interface RoundState {
  phase: Phase;
  /** ms into the current phase. */
  t: number;
  gapMs: number;
  /** Calls made so far this round (drives the window and feint frequency). */
  callIndex: number;
  call: CallKind | null;
  feintFlag: Flag | null;
  windowMs: number;
  seats: SeatState[];
  winner: number | null;
}

export type RoundEvent = "feint" | "call" | "resolved" | "done";

export function newRound(seatCount: number, rng: Rng): RoundState {
  return {
    phase: "gap",
    t: 0,
    gapMs: Math.round(rng.float(900, 1400)),
    callIndex: 0,
    call: null,
    feintFlag: null,
    windowMs: START_WINDOW_MS,
    seats: Array.from({ length: seatCount }, () => ({ alive: true, hitMs: null, pendingAt: null, outReason: null })),
    winner: null,
  };
}

export function aliveCount(s: RoundState): number {
  return s.seats.filter((x) => x.alive).length;
}

function knockOut(seat: SeatState, reason: OutReason): void {
  seat.alive = false;
  seat.outReason = reason;
  seat.pendingAt = null;
  seat.hitMs = null;
}

/** True when every surviving seat has answered the current (non-NONE) call. */
function allAnswered(s: RoundState): boolean {
  if (s.call === "NONE") return false;
  return s.seats.every((x) => !x.alive || x.hitMs !== null);
}

function startResolve(s: RoundState, events: RoundEvent[]): void {
  if (s.call !== "NONE") {
    for (const seat of s.seats) if (seat.alive && seat.hitMs === null) knockOut(seat, "slow");
  }
  s.phase = "resolve";
  s.t = 0;
  events.push("resolved");
}

function finish(s: RoundState, events: RoundEvent[]): void {
  s.phase = "done";
  s.t = 0;
  const alive = s.seats.map((x, i) => (x.alive ? i : -1)).filter((i) => i >= 0);
  s.winner = alive.length === 1 ? alive[0]! : null;
  events.push("done");
}

/** Advance the round by dtMs. Returns the events that fired, in order. */
export function advanceRound(s: RoundState, dtMs: number, rng: Rng): RoundEvent[] {
  const events: RoundEvent[] = [];
  if (s.phase === "done") return events;
  s.t += dtMs;

  if (s.phase === "gap") {
    if (s.t < s.gapMs) return events;
    if (s.callIndex >= MAX_CALLS) {
      for (const seat of s.seats) if (seat.alive) knockOut(seat, "slow");
      finish(s, events);
      return events;
    }
    s.t = 0;
    if (rng.next() < feintChance(s.callIndex)) {
      s.phase = "feint";
      s.feintFlag = rng.next() < 0.5 ? "RED" : "BLUE";
      events.push("feint");
      return events;
    }
    s.phase = "call";
    s.call = pickCall(rng);
    s.windowMs = windowMs(s.callIndex);
    s.callIndex += 1;
    for (const seat of s.seats) {
      seat.hitMs = null;
      seat.pendingAt = null;
    }
    events.push("call");
    return events;
  }

  if (s.phase === "feint") {
    if (s.t >= FEINT_MS) {
      s.phase = "gap";
      s.t = 0;
      s.feintFlag = null;
      s.gapMs = Math.round(rng.float(300, 650));
    }
    return events;
  }

  if (s.phase === "call") {
    for (const seat of s.seats) {
      if (seat.alive && seat.pendingAt !== null && s.t - seat.pendingAt > BOTH_GRACE_MS) knockOut(seat, "wrong");
    }
    if (s.t >= s.windowMs || allAnswered(s) || aliveCount(s) === 0) startResolve(s, events);
    return events;
  }

  // resolve
  if (s.t < RESOLVE_MS) return events;
  if (aliveCount(s) <= 1) {
    finish(s, events);
    return events;
  }
  s.phase = "gap";
  s.t = 0;
  s.gapMs = Math.round(rng.float(600, 1100));
  return events;
}

export type TapResult = "ignored" | "jumped" | "twitchy" | "wrong" | "pending" | "hit";

/** Apply a tap on `half` from `seat` at the current round time. */
export function tap(s: RoundState, seat: number, half: Half): TapResult {
  const st = s.seats[seat];
  if (!st || !st.alive) return "ignored";
  if (s.phase === "gap" || s.phase === "feint") {
    knockOut(st, "jumped");
    return "jumped";
  }
  if (s.phase !== "call" || s.call === null) return "ignored";
  if (st.hitMs !== null) return "ignored";
  switch (s.call) {
    case "NONE":
      knockOut(st, "twitchy");
      return "twitchy";
    case "RED":
    case "BLUE": {
      const want: Half = s.call === "RED" ? "left" : "right";
      if (half === want) {
        st.hitMs = Math.round(s.t);
        return "hit";
      }
      knockOut(st, "wrong");
      return "wrong";
    }
    case "BOTH":
      if (st.pendingAt === null) {
        st.pendingAt = s.t;
        return "pending";
      }
      if (s.t - st.pendingAt <= BOTH_GRACE_MS) {
        st.hitMs = Math.round(s.t);
        st.pendingAt = null;
        return "hit";
      }
      knockOut(st, "wrong");
      return "wrong";
  }
}

export interface BotTap {
  /** ms after the call appeared. */
  atMs: number;
  half: Half;
}

/** How much the shrinking window rattles the bots: 0 at the start, 1 at the floor. */
export function pressure(window: number): number {
  return Math.min(1, Math.max(0, (START_WINDOW_MS - window) / (START_WINDOW_MS - MIN_WINDOW_MS)));
}

/** Bots answer 250-600ms after a call, 8% wrong at first and worse as the window shrinks. */
export function planBotCall(call: CallKind, window: number, rng: Rng, wrongChance = 0.08): BotTap[] {
  const p = pressure(window);
  const wrong = rng.next() < wrongChance + p * 0.3;
  const react = Math.round(rng.float(250, 600) + p * rng.float(0, 120));
  const other: Half = rng.next() < 0.5 ? "left" : "right";
  switch (call) {
    case "NONE":
      return wrong ? [{ atMs: react, half: other }] : [];
    case "RED":
      return [{ atMs: react, half: wrong ? "right" : "left" }];
    case "BLUE":
      return [{ atMs: react, half: wrong ? "left" : "right" }];
    case "BOTH":
      if (wrong) return [{ atMs: react, half: other }];
      return [{ atMs: react, half: "left" }, { atMs: react + rng.int(5, 60), half: "right" }];
  }
}

/** When a bot bites on a feint (ms after the twitch starts), or null if it holds. */
export function planBotFeint(rng: Rng, biteChance = 0.15): number | null {
  return rng.next() < biteChance ? Math.round(rng.float(100, 300)) : null;
}

/** Match ends when someone reaches 3 wins or 7 rounds are played. */
export function matchOver(wins: readonly number[], roundsPlayed: number): boolean {
  return wins.some((w) => w >= WINS_NEEDED) || roundsPlayed >= MAX_ROUNDS;
}

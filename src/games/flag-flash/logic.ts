import type { Rng } from "../../core/rng";

/**
 * Pure rules for Flag Flash. No canvas, no DOM. Times are ms.
 *
 * A match is three HEATS. In a heat the caller shouts RED / BLUE / BOTH / NONE and
 * every correct answer scores. Fall (wrong half, too slow, biting a feint) and you
 * become a HECKLER: you can make the caller twitch a flag to bait the survivors, and
 * you score when somebody bites. When one player is left standing the heat becomes
 * a SHOWDOWN: a pot grows every call the survivor answers; they can BANK it at any
 * moment or lose it all when the hecklers finally get them. The last heat is
 * OVERDRIVE: shorter windows, more feints, everything worth double.
 */

export type CallKind = "RED" | "BLUE" | "BOTH" | "NONE";
export type Half = "left" | "right";
export type Flag = "RED" | "BLUE";

/** Heats are played until the match clock passes OVERDRIVE_AT_MS, then one final OVERDRIVE heat. */
export const MIN_HEATS = 3;
export const MAX_HEATS = 6;
export const OVERDRIVE_AT_MS = 36000;
/** Two taps this close together count as a BOTH response. */
export const BOTH_GRACE_MS = 150;
export const FEINT_MS = 380;
export const SWAP_MS = 650;
export const RESOLVE_MS = 450;
/** A correct tap this soon after the window closed is a near miss ("SO CLOSE"). */
export const LATE_MS = 140;
/** Safety valve: a heat that drags past this many calls ends with the survivors sharing a bonus. */
export const MAX_CALLS = 16;
export const HECKLE_COOLDOWN_MS = 3000;
/** Earliest a heckle can fire into a gap, so a feint never lands on the resolve flash. */
export const HECKLE_DELAY_MS = 180;
export const MAX_FEINTS_PER_GAP = 2;
/** Calls that must pass between two side swaps. */
export const SWAP_SPACING = 3;
export const POT_START = 3;
export const POT_STEP = 2;
/** The pot banks itself after this many survived showdown calls. */
export const SHOWDOWN_CALLS = 6;
export const BITE_POINTS = 2;
export const HOT_STREAK = 3;
export const SHARE_POINTS = 3;
/** A correct response faster than this is a FLASH. */
export const FLASH_MS = 250;

export interface HeatConfig {
  startWindow: number;
  minWindow: number;
  step: number;
  feintBase: number;
  feintRamp: number;
  swapChance: number;
  /** Score multiplier for every point in the heat. */
  mult: number;
  overdrive: boolean;
}

/** Whether heat `nextHeat` (0-based) is the final OVERDRIVE heat, given the match clock so far. */
export function isFinalHeat(nextHeat: number, elapsedMs: number): boolean {
  if (nextHeat >= MAX_HEATS - 1) return true;
  return nextHeat >= MIN_HEATS - 1 && elapsedMs >= OVERDRIVE_AT_MS;
}

export function heatConfig(heat: number, final: boolean): HeatConfig {
  if (final) {
    return { startWindow: 1100, minWindow: 420, step: 100, feintBase: 0.2, feintRamp: 0.06, swapChance: 0.2, mult: 2, overdrive: true };
  }
  if (heat >= 1) {
    return { startWindow: 1300, minWindow: 500, step: 100, feintBase: 0.15, feintRamp: 0.06, swapChance: 0.14, mult: 1, overdrive: false };
  }
  return { startWindow: 1500, minWindow: 550, step: 100, feintBase: 0.12, feintRamp: 0.06, swapChance: 0.1, mult: 1, overdrive: false };
}

export function windowMs(callIndex: number, cfg: HeatConfig): number {
  return Math.max(cfg.minWindow, cfg.startWindow - callIndex * cfg.step);
}

/** Feints get more frequent as the heat goes on. */
export function feintChance(callIndex: number, cfg: HeatConfig): number {
  return Math.min(0.6, cfg.feintBase + callIndex * cfg.feintRamp);
}

export function pickCall(rng: Rng): CallKind {
  const r = rng.next();
  if (r < 0.32) return "RED";
  if (r < 0.64) return "BLUE";
  if (r < 0.82) return "BOTH";
  return "NONE";
}

/** Which screen half answers a RED or BLUE call, given whether the sides are swapped. */
export function wantHalf(call: "RED" | "BLUE", swapped: boolean): Half {
  const natural: Half = call === "RED" ? "left" : "right";
  if (!swapped) return natural;
  return natural === "left" ? "right" : "left";
}

export type Phase = "gap" | "feint" | "swap" | "call" | "resolve" | "done";
export type OutReason = "jumped" | "wrong" | "slow" | "twitchy";
export type ScoreWhy = "hit" | "hot" | "bite" | "bank" | "share";

export interface SeatState {
  alive: boolean;
  /** Reaction ms of a correct response to the current call, or null. */
  hitMs: number | null;
  /** First tap of a BOTH response, waiting for its partner. */
  pendingAt: number | null;
  pendingHalf: Half | null;
  outReason: OutReason | null;
  /** Consecutive correct answers this heat. */
  streak: number;
  /** Second wind: absorbs one mistake. */
  shield: boolean;
  /** The shield already absorbed a mistake on the current call. */
  saved: boolean;
  /** Points scored this heat. */
  points: number;
  heckleCooldown: number;
  heckleArmed: boolean;
  /** Survivors this seat's feints knocked out. */
  bites: number;
}

export interface Showdown {
  seat: number;
  pot: number;
  calls: number;
}

export interface RoundState {
  phase: Phase;
  /** ms into the current phase. */
  t: number;
  gapMs: number;
  /** Calls made so far this heat (drives the window and feint frequency). */
  callIndex: number;
  call: CallKind | null;
  feintFlag: Flag | null;
  /** Heckler seat whose feint is showing, or null for the caller's own. */
  feintOwner: number | null;
  windowMs: number;
  swapped: boolean;
  lastSwapCall: number;
  feintsThisGap: number;
  seats: SeatState[];
  showdown: Showdown | null;
  winner: number | null;
  cfg: HeatConfig;
  events: RoundEvent[];
}

export type RoundEvent =
  | { type: "feint"; owner: number | null }
  | { type: "swap" }
  | { type: "call" }
  | { type: "resolved" }
  | { type: "showdown"; seat: number }
  | { type: "knockout"; seat: number; reason: OutReason; by: number | null }
  | { type: "shield"; seat: number }
  | { type: "score"; seat: number; points: number; why: ScoreWhy }
  | { type: "pot"; seat: number; pot: number }
  | { type: "potlost"; seat: number; pot: number }
  | { type: "done" };

export function newRound(seatCount: number, heat: number, rng: Rng, shields: readonly boolean[] = [], final = false): RoundState {
  const cfg = heatConfig(heat, final);
  return {
    phase: "gap",
    t: 0,
    gapMs: Math.round(rng.float(900, 1400)),
    callIndex: 0,
    call: null,
    feintFlag: null,
    feintOwner: null,
    windowMs: cfg.startWindow,
    swapped: false,
    lastSwapCall: -SWAP_SPACING,
    feintsThisGap: 0,
    seats: Array.from({ length: seatCount }, (_, i) => ({
      alive: true, hitMs: null, pendingAt: null, pendingHalf: null, outReason: null, streak: 0, shield: shields[i] ?? false,
      saved: false, points: 0, heckleCooldown: 0, heckleArmed: false, bites: 0,
    })),
    showdown: null,
    winner: null,
    cfg,
    events: [],
  };
}

export function aliveCount(s: RoundState): number {
  return s.seats.filter((x) => x.alive).length;
}

function award(s: RoundState, seat: number, points: number, why: ScoreWhy): void {
  const st = s.seats[seat];
  if (!st || points <= 0) return;
  st.points += points;
  s.events.push({ type: "score", seat, points, why });
}

/** Knock a seat out (or burn its shield). Returns true when the seat actually fell. */
function knockOut(s: RoundState, idx: number, reason: OutReason, by: number | null): boolean {
  const st = s.seats[idx];
  if (!st || !st.alive) return false;
  st.pendingAt = null;
  st.pendingHalf = null;
  st.hitMs = null;
  st.streak = 0;
  if (st.shield) {
    st.shield = false;
    st.saved = true;
    s.events.push({ type: "shield", seat: idx });
    return false;
  }
  st.alive = false;
  st.outReason = reason;
  s.events.push({ type: "knockout", seat: idx, reason, by });
  if (by !== null && by !== idx) {
    const h = s.seats[by];
    if (h) h.bites += 1;
    award(s, by, BITE_POINTS * s.cfg.mult, "bite");
  }
  if (s.showdown && s.showdown.seat === idx) s.events.push({ type: "potlost", seat: idx, pot: s.showdown.pot });
  return true;
}

function onHit(s: RoundState, idx: number): void {
  const st = s.seats[idx]!;
  st.hitMs = Math.round(s.t);
  st.pendingAt = null;
  st.pendingHalf = null;
  st.streak += 1;
  if (s.showdown && s.showdown.seat === idx) return; // the pot grows at resolve instead
  award(s, idx, s.cfg.mult, "hit");
  if (st.streak >= HOT_STREAK) award(s, idx, s.cfg.mult, "hot");
}

/** True when every surviving seat has answered the current (non-NONE) call. */
function allAnswered(s: RoundState): boolean {
  if (s.call === "NONE") return false;
  return s.seats.every((x) => !x.alive || x.hitMs !== null || x.saved);
}

function startResolve(s: RoundState): void {
  if (s.call === "NONE") {
    for (let i = 0; i < s.seats.length; i++) {
      const st = s.seats[i]!;
      if (st.alive && !st.saved) onHit(s, i);
    }
  } else {
    for (let i = 0; i < s.seats.length; i++) {
      const st = s.seats[i]!;
      if (st.alive && st.hitMs === null && !st.saved) knockOut(s, i, "slow", null);
    }
  }
  const sd = s.showdown;
  if (sd) {
    const st = s.seats[sd.seat]!;
    if (st.alive) {
      sd.calls += 1;
      sd.pot += POT_STEP * s.cfg.mult;
      s.events.push({ type: "pot", seat: sd.seat, pot: sd.pot });
    }
  }
  s.phase = "resolve";
  s.t = 0;
  s.events.push({ type: "resolved" });
}

function finish(s: RoundState, winner: number | null): void {
  s.phase = "done";
  s.t = 0;
  s.winner = winner;
  s.feintFlag = null;
  s.feintOwner = null;
  s.events.push({ type: "done" });
}

function bankPot(s: RoundState): void {
  const sd = s.showdown!;
  award(s, sd.seat, sd.pot, "bank");
  finish(s, sd.seat);
}

/** After a knockout: end the heat if the survivor fell, or open the showdown. Returns true when the heat ended. */
function settle(s: RoundState): boolean {
  const sd = s.showdown;
  if (sd) {
    if (s.seats[sd.seat]!.alive) return false;
    finish(s, null);
    return true;
  }
  const alive = aliveCount(s);
  if (alive === 0) {
    finish(s, null);
    return true;
  }
  if (alive === 1 && s.seats.length > 1) {
    const seat = s.seats.findIndex((x) => x.alive);
    s.showdown = { seat, pot: POT_START * s.cfg.mult, calls: 0 };
    s.events.push({ type: "showdown", seat });
  }
  return false;
}

function startGap(s: RoundState, rng: Rng, min: number, max: number): void {
  s.phase = "gap";
  s.t = 0;
  s.feintFlag = null;
  s.feintOwner = null;
  s.gapMs = Math.round(rng.float(min, max));
}

/** Advance the heat by dtMs. Returns the events that fired, in order. */
export function advanceRound(s: RoundState, dtMs: number, rng: Rng): RoundEvent[] {
  if (s.phase === "done") return s.events.splice(0);
  s.t += dtMs;
  for (const st of s.seats) st.heckleCooldown = Math.max(0, st.heckleCooldown - dtMs);

  if (s.phase === "gap") {
    // An armed heckler fires a feint into the gap.
    if (s.t >= HECKLE_DELAY_MS && s.feintsThisGap < MAX_FEINTS_PER_GAP) {
      const h = s.seats.findIndex((x) => !x.alive && x.heckleArmed);
      if (h >= 0) {
        const heckler = s.seats[h]!;
        heckler.heckleArmed = false;
        heckler.heckleCooldown = HECKLE_COOLDOWN_MS;
        s.feintsThisGap += 1;
        s.phase = "feint";
        s.t = 0;
        s.feintFlag = rng.next() < 0.5 ? "RED" : "BLUE";
        s.feintOwner = h;
        s.events.push({ type: "feint", owner: h });
        return s.events.splice(0);
      }
    }
    if (s.t < s.gapMs) return s.events.splice(0);
    if (s.callIndex >= MAX_CALLS) {
      if (s.showdown) {
        bankPot(s);
      } else {
        for (let i = 0; i < s.seats.length; i++) if (s.seats[i]!.alive) award(s, i, SHARE_POINTS * s.cfg.mult, "share");
        finish(s, null);
      }
      return s.events.splice(0);
    }
    s.t = 0;
    if (s.callIndex - s.lastSwapCall >= SWAP_SPACING && s.callIndex >= 2 && rng.next() < s.cfg.swapChance) {
      s.phase = "swap";
      s.swapped = !s.swapped;
      s.lastSwapCall = s.callIndex;
      s.events.push({ type: "swap" });
      return s.events.splice(0);
    }
    if (s.feintsThisGap < MAX_FEINTS_PER_GAP && rng.next() < feintChance(s.callIndex, s.cfg)) {
      s.feintsThisGap += 1;
      s.phase = "feint";
      s.feintFlag = rng.next() < 0.5 ? "RED" : "BLUE";
      s.feintOwner = null;
      s.events.push({ type: "feint", owner: null });
      return s.events.splice(0);
    }
    s.phase = "call";
    s.call = pickCall(rng);
    s.windowMs = windowMs(s.callIndex, s.cfg);
    s.callIndex += 1;
    s.feintsThisGap = 0;
    for (const seat of s.seats) {
      seat.hitMs = null;
      seat.pendingAt = null;
      seat.pendingHalf = null;
      seat.saved = false;
    }
    s.events.push({ type: "call" });
    return s.events.splice(0);
  }

  if (s.phase === "feint") {
    if (s.t >= FEINT_MS) startGap(s, rng, 300, 650);
    return s.events.splice(0);
  }

  if (s.phase === "swap") {
    if (s.t >= SWAP_MS) startGap(s, rng, 450, 800);
    return s.events.splice(0);
  }

  if (s.phase === "call") {
    for (let i = 0; i < s.seats.length; i++) {
      const seat = s.seats[i]!;
      if (seat.alive && seat.pendingAt !== null && s.t - seat.pendingAt > BOTH_GRACE_MS) knockOut(s, i, "wrong", null);
    }
    if (s.t >= s.windowMs || allAnswered(s) || aliveCount(s) === 0) startResolve(s);
    return s.events.splice(0);
  }

  // resolve
  if (s.t < RESOLVE_MS) return s.events.splice(0);
  const sd = s.showdown;
  if (sd) {
    const st = s.seats[sd.seat]!;
    if (!st.alive) finish(s, null);
    else if (sd.calls >= SHOWDOWN_CALLS) bankPot(s);
    else startGap(s, rng, 700, 1100);
    return s.events.splice(0);
  }
  if (!settle(s)) startGap(s, rng, s.showdown ? 900 : 600, s.showdown ? 1200 : 1100);
  return s.events.splice(0);
}

export type TapResult = "ignored" | "jumped" | "twitchy" | "wrong" | "pending" | "hit" | "late" | "saved";

/** Apply a tap on `half` (screen side) from `seat` at the current heat time. */
export function tap(s: RoundState, seat: number, half: Half): TapResult {
  const st = s.seats[seat];
  if (!st || !st.alive) return "ignored";
  if (s.phase === "gap" || s.phase === "feint" || s.phase === "swap") {
    const by = s.phase === "feint" ? s.feintOwner : null;
    if (!knockOut(s, seat, "jumped", by)) return "saved";
    settle(s);
    return "jumped";
  }
  if (s.phase === "resolve") {
    // Near miss: the right answer, just after the window shut.
    if (s.call && s.call !== "NONE" && st.hitMs === null && s.t < LATE_MS && !st.saved) {
      const ok = s.call === "BOTH" || half === wantHalf(s.call, s.swapped);
      if (ok) return "late";
    }
    return "ignored";
  }
  if (s.phase !== "call" || s.call === null) return "ignored";
  if (st.hitMs !== null || st.saved) return "ignored";
  switch (s.call) {
    case "NONE":
      return knockOut(s, seat, "twitchy", null) ? "twitchy" : "saved";
    case "RED":
    case "BLUE": {
      if (half === wantHalf(s.call, s.swapped)) {
        onHit(s, seat);
        return "hit";
      }
      return knockOut(s, seat, "wrong", null) ? "wrong" : "saved";
    }
    case "BOTH":
      if (st.pendingAt === null) {
        st.pendingAt = s.t;
        st.pendingHalf = half;
        return "pending";
      }
      if (half !== st.pendingHalf && s.t - st.pendingAt <= BOTH_GRACE_MS) {
        onHit(s, seat);
        return "hit";
      }
      return knockOut(s, seat, "wrong", null) ? "wrong" : "saved";
  }
}

export type HeckleResult = "armed" | "cooling" | "ignored";

/** A knocked-out seat arms a feint; it fires in the next gap. */
export function heckle(s: RoundState, seat: number): HeckleResult {
  const st = s.seats[seat];
  if (!st || st.alive || s.phase === "done") return "ignored";
  if (st.heckleArmed) return "ignored";
  if (st.heckleCooldown > 0) return "cooling";
  st.heckleArmed = true;
  return "armed";
}

export type BankResult = "banked" | "ignored";

/** The showdown survivor takes the pot and ends the heat. Not allowed while a call resolves. */
export function bank(s: RoundState, seat: number): BankResult {
  const sd = s.showdown;
  if (!sd || sd.seat !== seat || s.phase === "done" || s.phase === "resolve") return "ignored";
  if (!s.seats[seat]?.alive) return "ignored";
  bankPot(s);
  return "banked";
}

export interface BotTap {
  /** ms after the call appeared. */
  atMs: number;
  half: Half;
}

/** How much the shrinking window rattles the bots: 0 at the start, 1 at the floor. */
export function pressure(window: number, cfg: HeatConfig): number {
  return Math.min(1, Math.max(0, (cfg.startWindow - window) / (cfg.startWindow - cfg.minWindow)));
}

/**
 * Bots answer 250-600ms after a call, 8% wrong at first and worse as the window shrinks.
 * `extraWrong` models muscle memory right after a side swap.
 */
export function planBotCall(call: CallKind, window: number, cfg: HeatConfig, swapped: boolean, rng: Rng, wrongChance = 0.08, extraWrong = 0): BotTap[] {
  const p = pressure(window, cfg);
  const wrong = rng.next() < wrongChance + p * 0.3 + extraWrong;
  const react = Math.round(rng.float(250, 600) + p * rng.float(0, 120));
  const other: Half = rng.next() < 0.5 ? "left" : "right";
  switch (call) {
    case "NONE":
      return wrong ? [{ atMs: react, half: other }] : [];
    case "RED":
    case "BLUE": {
      const want = wantHalf(call, swapped);
      const miss: Half = want === "left" ? "right" : "left";
      return [{ atMs: react, half: wrong ? miss : want }];
    }
    case "BOTH":
      if (wrong) return [{ atMs: react, half: other }];
      return [{ atMs: react, half: "left" }, { atMs: react + rng.int(5, 60), half: "right" }];
  }
}

/** When a bot bites on a feint (ms after the twitch starts), or null if it holds. */
export function planBotFeint(rng: Rng, biteChance = 0.15): number | null {
  return rng.next() < biteChance ? Math.round(rng.float(100, 300)) : null;
}

/** When a heckler bot arms its feint (ms into a gap), or null if it sits this one out. */
export function planBotHeckle(rng: Rng, chance = 0.55): number | null {
  return rng.next() < chance ? Math.round(rng.float(0, 500)) : null;
}

/** Whether a showdown bot banks now: greedy at first, nervous as the pot grows. */
export function planBotBank(calls: number, rng: Rng): boolean {
  return rng.next() < 0.12 + calls * 0.28;
}

/** Seats that start the next heat with a second-wind shield: whoever is last, unless everyone is tied. */
export function secondWind(scores: readonly number[]): boolean[] {
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (min === max) return scores.map(() => false);
  return scores.map((x) => x === min);
}

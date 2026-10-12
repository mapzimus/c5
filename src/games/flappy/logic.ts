/**
 * Pure Sky Dash rules: pacing curve, run multiplier, bank/skim checks, underdog,
 * ranking and bot nerve. No DOM, no rendering.
 */

export const MATCH_SECONDS = 75;
/** Last stretch of the match: faster, tighter, every run gain doubled. */
export const OVERDRIVE_AT = 55;
export const BANK_WARNING_AT = MATCH_SECONDS - 10;
export const LIVES = 3;
/** Every this many gates is a split gate with a gold BANK half. */
export const BANK_EVERY = 3;
/** Split gates open wider than the others: the choice is which half, not a precision test. */
export const BANK_GAP_SCALE = 1.4;
/** Consecutive gates needed to raise the run multiplier by one. */
export const MULT_STEP = 3;
export const MULT_MAX = 5;
/** Trailing the leader by at least this much makes you the underdog (+1x). */
export const UNDERDOG_GAP = 15;

export const JET_RADIUS = 16;
export const GATE_WIDTH = 52;
/** Clearance (px) between jet edge and gate edge that counts as a skim. */
export const NEAR_MISS = 9;
export const HAZARD_RADIUS = 20;

export const POINTS_GATE = 1;
export const POINTS_COIN = 2;
export const POINTS_SKIM = 3;
/** A storm cloud scores this when its shot brings a jet down. */
export const STORM_HIT_POINTS = 5;
/** Banked on top of the run when the match ends because everyone else is out. */
export const SURVIVOR_BONUS = 10;
export const STORM_COOLDOWN = 3;
export const RESPAWN_DELAY = 1.2;
export const RELAUNCH_GRACE = 1.5;

export const SPEED_START = 180;
export const SPEED_MAX = 330;
export const SPEED_OVERDRIVE = 400;
export const GAP_START = 180;
export const GAP_MIN = 120;
export const GAP_OVERDRIVE = 110;
export const INTERVAL_START = 1.8;
export const INTERVAL_MIN = 1.05;
export const INTERVAL_OVERDRIVE = 0.95;

export type BankSide = "top" | "bottom";

export interface Pace {
  speed: number;
  gap: number;
  interval: number;
  overdrive: boolean;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Scroll speed, gap height and gate spacing `t` seconds into the match. */
export function paceAt(t: number): Pace {
  if (t < OVERDRIVE_AT) {
    const p = clamp01(t / OVERDRIVE_AT);
    return {
      speed: lerp(SPEED_START, SPEED_MAX, p),
      gap: lerp(GAP_START, GAP_MIN, p),
      interval: lerp(INTERVAL_START, INTERVAL_MIN, p),
      overdrive: false,
    };
  }
  const q = clamp01((t - OVERDRIVE_AT) / 2);
  return {
    speed: lerp(SPEED_MAX, SPEED_OVERDRIVE, q),
    gap: lerp(GAP_MIN, GAP_OVERDRIVE, q),
    interval: lerp(INTERVAL_MIN, INTERVAL_OVERDRIVE, q),
    overdrive: true,
  };
}

/** Run multiplier for a streak of consecutive gates (x1..x5), +1 for the underdog. */
export function multFor(streak: number, underdog = false): number {
  const base = Math.min(MULT_MAX, 1 + Math.floor(Math.max(0, streak) / MULT_STEP));
  return base + (underdog ? 1 : 0);
}

/** Pips lit toward the next multiplier (0..MULT_STEP). Full once capped. */
export function multPips(streak: number): number {
  if (streak >= (MULT_MAX - 1) * MULT_STEP) return MULT_STEP;
  return Math.max(0, streak) % MULT_STEP;
}

/** Points added to the run for a base award at this multiplier (doubled in overdrive). */
export function gain(base: number, mult: number, overdrive: boolean): number {
  return base * mult * (overdrive ? 2 : 1);
}

/** True when the `n`th gate a lane spawns (1-based) carries a gold BANK half. */
export function isBankGate(n: number): boolean {
  return n > 0 && n % BANK_EVERY === 0;
}

/** Smallest distance from the jet's edge to either gap edge; negative means a hit. */
export function clearance(y: number, gapY: number, gapH: number, r = JET_RADIUS): number {
  const top = y - r - (gapY - gapH / 2);
  const bottom = gapY + gapH / 2 - (y + r);
  return Math.min(top, bottom);
}

export function isSkim(minClear: number): boolean {
  return minClear >= 0 && minClear < NEAR_MISS;
}

/** True when a jet centred at `y` is in the gold half of a split gate's gap. */
export function inBankHalf(y: number, gapY: number, side: BankSide): boolean {
  return side === "top" ? y < gapY : y > gapY;
}

/** Index of the lone lowest scorer trailing the leader by UNDERDOG_GAP or more; -1 when nobody is. */
export function underdogIndex(scores: readonly number[]): number {
  if (scores.length < 2) return -1;
  let lo = 0;
  let hi = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i]! < scores[lo]!) lo = i;
    if (scores[i]! > scores[hi]!) hi = i;
  }
  const low = scores[lo]!;
  if (scores[hi]! - low < UNDERDOG_GAP) return -1;
  if (scores.filter((s) => s === low).length > 1) return -1;
  return lo;
}

export interface Rankable {
  score: number;
  lives: number;
  run: number;
}

/** Sort order for the results: banked score, then lives left, then unbanked run. */
export function compareLanes(a: Rankable, b: Rankable): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.lives !== b.lives) return b.lives - a.lives;
  return b.run - a.run;
}

/** Vertical band a flap-only bot can hold inside a gap (a flap lifts ~57px, the jet is 32px tall). */
export function safeBand(gapY: number, gapH: number): { lo: number; hi: number } {
  const lo = gapY - gapH / 2 + 81;
  const hi = gapY + gapH / 2 - 30;
  return { lo: Math.min(lo, hi), hi };
}

/** Fastest climb (px/s) a course may demand between gates; drops may be steeper. */
export const MAX_RISE_RATE = 150;
export const MAX_DROP_RATE = 240;

/** Narrow lanes show less of the course ahead, so they scroll slower to keep reaction time fair. */
export function speedScale(laneWidth: number): number {
  return Math.min(1, Math.max(0.72, laneWidth / 640));
}

/** Next gap centre: random within the arena, but reachable from the previous gap in `interval` seconds. */
export function nextGapY(prev: number, interval: number, minY: number, maxY: number, roll: number): number {
  const lo = Math.max(minY, prev - MAX_RISE_RATE * interval);
  const hi = Math.min(maxY, prev + MAX_DROP_RATE * interval);
  if (lo >= hi) return Math.min(maxY, Math.max(minY, prev));
  return lo + roll * (hi - lo);
}

/** Height a flap lifts the jet before gravity wins (FLAP_VEL^2 / 2g with -320 px/s and 900 px/s^2). */
export const FLAP_LIFT = (320 * 320) / (2 * 900);

/** True when flapping from `y` keeps the jet's top edge under `ceiling` (a gap top or the arena roof). */
export function flapClearsCeiling(y: number, ceiling: number, r = JET_RADIUS): boolean {
  return y - FLAP_LIFT - r > ceiling + 4;
}

/** A bot flaps once its upward speed has decayed past this; it taps sooner the further it sits below its target. */
export function flapThreshold(drop: number): number {
  if (drop > 110) return -250;
  if (drop > 50) return -150;
  return -40;
}

/** Where a bot aims inside a split gate: the gold half when banking, the other half when riding. */
export function bankAim(gapY: number, gapH: number, side: BankSide, wantBank: boolean): number {
  const goldTop = side === "top";
  const aimTop = goldTop === wantBank;
  return aimTop ? gapY - gapH / 4 - 4 : gapY + gapH / 4 + 10;
}

/** Bot decision at a split gate. `nerve` 0..1: higher waits for a bigger run. */
export function botWantsBank(run: number, mult: number, nerve: number, timeLeft: number): boolean {
  if (run <= 0) return false;
  if (timeLeft < 9) return true;
  if (mult >= MULT_MAX) return true;
  return run >= 6 + nerve * 40;
}

/** Chance per decision tick (30/s) that a bot hesitates for a beat; grows with scroll speed. */
export function botSloppiness(speed: number): number {
  const fast = clamp01((speed - SPEED_START) / (SPEED_OVERDRIVE - SPEED_START));
  return 0.0025 + 0.015 * fast * fast;
}

/** How long a hesitating bot stops deciding, in seconds. */
export const HESITATION_MIN = 0.08;
export const HESITATION_MAX = 0.25;

/** Which rival a storm cloud bot shoots: the leader most of the time, otherwise anyone flying. */
export function stormTarget(scores: readonly number[], candidates: readonly number[], roll: number): number {
  if (candidates.length === 0) return -1;
  if (roll < 0.6) {
    let best = candidates[0]!;
    for (const c of candidates) if (scores[c]! > scores[best]!) best = c;
    return best;
  }
  const i = Math.min(candidates.length - 1, Math.floor(((roll - 0.6) / 0.4) * candidates.length));
  return candidates[i]!;
}

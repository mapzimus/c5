import type { Rng } from "../../core/rng";

/** Pure rules for Mash Dash. No canvas, no DOM. Progress runs 0 (start) to 1 (finish line). */

/** Taps closer together than this chain into a speed bonus. */
export const CHAIN_WINDOW_MS = 200;
/** Progress gained per plain tap. */
export const STEP = 0.0045;
/** Chain length that gives the full speed bonus. */
export const CHAIN_FOR_MAX = 12;
/** Full bonus multiplies a step by (1 + MAX_BONUS). */
export const MAX_BONUS = 0.6;
export const TRIP_SLIDE = 0.05;
export const TRIP_STUN_S = 0.8;
export const SPRING_BOOST = 0.07;
export const YELLOW_S = 0.3;
/** Everyone still running this long after the winner crosses is placed by distance. */
export const FINISH_GRACE_S = 10;
/** Points for 1st, 2nd, 3rd, 4th. */
export const PLACE_POINTS: readonly number[] = [10, 7, 4, 2];

export type LightPhase = "green" | "yellow" | "red";

export interface Light {
  phase: LightPhase;
  /** Seconds spent in the current phase. */
  t: number;
  dur: number;
  /** Past the halfway mark: no yellow warning, shorter and more frequent reds. */
  late: boolean;
}

function greenDur(late: boolean, rng: Rng): number {
  return late ? rng.float(1.0, 2.0) : rng.float(2.2, 4.0);
}

function redDur(late: boolean, rng: Rng): number {
  return late ? rng.float(0.6, 1.1) : rng.float(1.3, 2.0);
}

export function newLight(rng: Rng): Light {
  return { phase: "green", t: 0, dur: greenDur(false, rng), late: false };
}

/** Advance the light. Returns true when the phase just changed. */
export function advanceLight(l: Light, dt: number, rng: Rng): boolean {
  l.t += dt;
  if (l.t < l.dur) return false;
  l.t = 0;
  if (l.phase === "green") {
    if (l.late) {
      l.phase = "red";
      l.dur = redDur(true, rng);
    } else {
      l.phase = "yellow";
      l.dur = YELLOW_S;
    }
  } else if (l.phase === "yellow") {
    l.phase = "red";
    l.dur = redDur(l.late, rng);
  } else {
    l.phase = "green";
    l.dur = greenDur(l.late, rng);
  }
  return true;
}

export type HazardKind = "banana" | "spring";

export interface Hazard {
  kind: HazardKind;
  at: number;
  used: boolean;
}

/** One spring and 1-2 bananas per lane, spread over the middle of the track. */
export function planHazards(rng: Rng): Hazard[] {
  const kinds: HazardKind[] = ["spring", "banana"];
  if (rng.next() < 0.5) kinds.push("banana");
  const out: Hazard[] = [];
  let guard = 0;
  while (out.length < kinds.length && guard++ < 100) {
    const at = rng.float(0.15, 0.88);
    if (out.some((h) => Math.abs(h.at - at) < 0.1)) continue;
    out.push({ kind: kinds[out.length]!, at, used: false });
  }
  return out.sort((a, b) => a.at - b.at);
}

export interface Runner {
  progress: number;
  chain: number;
  lastTapMs: number;
  /** Seconds left lying on the ground after a trip. */
  stun: number;
  taps: number;
  trips: number;
  /** A banana was stepped on: the next tap is wasted. */
  slipArmed: boolean;
  place: number | null;
  hazards: Hazard[];
}

export function newRunner(hazards: Hazard[]): Runner {
  return {
    progress: 0, chain: 0, lastTapMs: -Infinity, stun: 0, taps: 0, trips: 0,
    slipArmed: false, place: null, hazards,
  };
}

/** Multiplier for a tap at the end of a chain of `chain` quick taps. */
export function stepBonus(chain: number): number {
  return 1 + MAX_BONUS * Math.min(1, chain / CHAIN_FOR_MAX);
}

export type TapResult = "step" | "trip" | "slip" | "ignored";

/** Apply a tap at `nowMs` (any monotonic clock) under the current light. */
export function tapRunner(r: Runner, light: Light, nowMs: number): TapResult {
  if (r.place !== null || r.stun > 0) return "ignored";
  r.taps += 1;
  if (light.phase === "red") {
    r.trips += 1;
    r.chain = 0;
    r.stun = TRIP_STUN_S;
    r.progress = Math.max(0, r.progress - TRIP_SLIDE);
    return "trip";
  }
  if (r.slipArmed) {
    r.slipArmed = false;
    r.chain = 0;
    return "slip";
  }
  r.chain = nowMs - r.lastTapMs <= CHAIN_WINDOW_MS ? r.chain + 1 : 0;
  r.lastTapMs = nowMs;
  r.progress = Math.min(1, r.progress + STEP * stepBonus(r.chain));
  return "step";
}

/** Fire the first unused hazard the runner has reached, if any. Springs push forward; bananas arm a slip. */
export function collectHazard(r: Runner): Hazard | null {
  for (const h of r.hazards) {
    if (h.used || r.progress < h.at) continue;
    h.used = true;
    if (h.kind === "spring") r.progress = Math.min(1, r.progress + SPRING_BOOST);
    else r.slipArmed = true;
    return h;
  }
  return null;
}

export function updateRunner(r: Runner, dt: number): void {
  if (r.stun > 0) r.stun = Math.max(0, r.stun - dt);
}

/** Give every unplaced runner at the line the next place, in progress order. Returns the next free place. */
export function placeFinishers(runners: Runner[], nextPlace: number): number {
  const done = runners.filter((r) => r.place === null && r.progress >= 1);
  for (const r of done) r.place = nextPlace++;
  return nextPlace;
}

/** Place everyone still running by distance (ties keep index order). Returns the next free place. */
export function placeByDistance(runners: Runner[], nextPlace: number): number {
  const left = runners.map((r, i) => ({ r, i })).filter((x) => x.r.place === null);
  left.sort((a, b) => b.r.progress - a.r.progress || a.i - b.i);
  for (const x of left) x.r.place = nextPlace++;
  return nextPlace;
}

export function placePoints(place: number): number {
  return PLACE_POINTS[place - 1] ?? 1;
}

export interface BotBrain {
  hz: number;
  nextTap: number;
  /** Seconds after a light change before the bot notices it. */
  reactS: number;
  stall: number;
  stopOnYellow: boolean;
}

export function newBot(rng: Rng): BotBrain {
  return { hz: rng.float(6, 9), nextTap: rng.float(0.1, 0.4), reactS: rng.float(0.15, 0.4), stall: 0, stopOnYellow: true };
}

/** Re-roll how the bot reads a fresh light phase. */
export function botOnLight(b: BotBrain, light: Light, prev: LightPhase, rng: Rng): void {
  if (light.phase === "yellow") {
    b.stopOnYellow = rng.next() < 0.8;
    b.reactS = rng.float(0.05, 0.25);
  } else if (light.phase === "red") {
    const alreadyStopped = prev === "yellow" && b.stopOnYellow;
    // Half the time in late reds the bot was already easing off and stops clean.
    b.reactS = alreadyStopped || rng.next() < 0.5 ? 0 : rng.float(0.15, 0.4);
  } else {
    b.reactS = rng.float(0.15, 0.4);
  }
}

/** Does the bot believe it should be mashing right now? */
export function botSeesGo(b: BotBrain, light: Light): boolean {
  if (light.phase === "green") return light.t >= b.reactS;
  if (light.phase === "yellow") return !(b.stopOnYellow && light.t >= b.reactS);
  return light.t < b.reactS;
}

/** Advance the bot by dt. Returns true when it taps this frame. */
export function tickBot(b: BotBrain, light: Light, dt: number, rng: Rng): boolean {
  if (b.stall > 0) {
    b.stall -= dt;
    return false;
  }
  if (rng.next() < 0.12 * dt) {
    b.stall = 0.5;
    return false;
  }
  if (!botSeesGo(b, light)) return false;
  b.nextTap -= dt;
  if (b.nextTap > 0) return false;
  b.nextTap = (1 / b.hz) * rng.float(0.75, 1.3);
  return true;
}

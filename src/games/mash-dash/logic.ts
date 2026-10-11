import type { Rng } from "../../core/rng";

/**
 * Pure rules for Dare Dash (id "mash-dash"). No canvas, no DOM. Progress runs 0 (start) to 1 (finish line).
 *
 * The light cycles GREEN -> YELLOW -> RED. Green taps step you forward. Yellow is the DARE: taps there do not
 * move you, they charge a pot. Hold still through the red and the pot pays out as a dash when the light goes
 * green again. A tap on red trips you: you slide back, lie stunned and the pot bursts.
 */

/** Taps closer together than this chain into a speed bonus. */
export const CHAIN_WINDOW_MS = 200;
/** Progress gained per plain tap. */
export const STEP = 0.004;
/** Chain length that gives the full speed bonus. */
export const CHAIN_FOR_MAX = 12;
/** Full bonus multiplies a step by (1 + MAX_BONUS). */
export const MAX_BONUS = 0.6;
export const TRIP_SLIDE = 0.05;
export const TRIP_STUN_S = 0.8;
export const SPRING_BOOST = 0.07;
/** Each dare tap (yellow) is worth this many plain steps, early / in overdrive. */
export const DARE_MULT = 3;
export const DARE_MULT_LATE = 4;
/** The last dare tap landing this close before the red earns a clutch bonus on the pot. */
export const CLUTCH_WINDOW_MS = 150;
export const CLUTCH_BONUS = 0.5;
/** Last place, this far behind the leader, runs with turbo. */
export const TURBO_GAP = 0.12;
export const TURBO_MULT = 1.3;
/** A thrown peel lands this far ahead of its target. */
export const PEEL_LEAD = 0.07;
export const HECKLE_COOLDOWN_S = 2.5;
/** Everyone still running this long after the winner crosses is placed by distance. */
export const FINISH_GRACE_S = 8;
/** Points for 1st, 2nd, 3rd, 4th. */
export const PLACE_POINTS: readonly number[] = [10, 7, 4, 2];

export type LightPhase = "green" | "yellow" | "red";

export interface Light {
  phase: LightPhase;
  /** Seconds spent in the current phase. */
  t: number;
  dur: number;
  /** Overdrive (someone passed halfway): shorter everything, dares pay more. */
  late: boolean;
}

function greenDur(late: boolean, rng: Rng): number {
  return late ? rng.float(1.0, 1.8) : rng.float(2.2, 3.4);
}

/** The dare window is deliberately unpredictable: that is the gamble. */
function yellowDur(late: boolean, rng: Rng): number {
  return late ? rng.float(0.25, 0.9) : rng.float(0.5, 1.4);
}

function redDur(late: boolean, rng: Rng): number {
  return late ? rng.float(0.6, 1.0) : rng.float(1.2, 1.8);
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
    l.phase = "yellow";
    l.dur = yellowDur(l.late, rng);
  } else if (l.phase === "yellow") {
    l.phase = "red";
    l.dur = redDur(l.late, rng);
  } else {
    l.phase = "green";
    l.dur = greenDur(l.late, rng);
  }
  return true;
}

export function dareMult(light: Light): number {
  return light.late ? DARE_MULT_LATE : DARE_MULT;
}

export type HazardKind = "banana" | "spring";

export interface Hazard {
  kind: HazardKind;
  at: number;
  used: boolean;
  /** Lobbed in from the bench by a finished rival. */
  thrown?: boolean;
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
  /** Progress charged by dare taps this yellow, paid out at the red. */
  pot: number;
  /** Dare taps in the current pot (for display). */
  potTaps: number;
  /** Progress banked from dares over the whole race. */
  banked: number;
  /** Pots lost to a trip. */
  busts: number;
  /** Last place and far behind: steps are worth more. */
  turbo: boolean;
  /** A banana was stepped on: the next tap is wasted. */
  slipArmed: boolean;
  place: number | null;
  /** Race seconds at the line. */
  finishS: number | null;
  hazards: Hazard[];
  /** Seconds until this finished runner may lob another peel. */
  heckleCd: number;
  peels: number;
}

export function newRunner(hazards: Hazard[]): Runner {
  return {
    progress: 0, chain: 0, lastTapMs: -Infinity, stun: 0, taps: 0, trips: 0,
    pot: 0, potTaps: 0, banked: 0, busts: 0, turbo: false,
    slipArmed: false, place: null, finishS: null, hazards, heckleCd: 0, peels: 0,
  };
}

/** Multiplier for a tap at the end of a chain of `chain` quick taps. */
export function stepBonus(chain: number): number {
  return 1 + MAX_BONUS * Math.min(1, chain / CHAIN_FOR_MAX);
}

export type TapResult = "step" | "dare" | "trip" | "bust" | "slip" | "ignored";

/** Apply a tap at `nowMs` (any monotonic clock) under the current light. */
export function tapRunner(r: Runner, light: Light, nowMs: number): TapResult {
  if (r.place !== null || r.stun > 0) return "ignored";
  r.taps += 1;
  if (light.phase === "red") {
    r.trips += 1;
    r.chain = 0;
    r.stun = TRIP_STUN_S;
    r.progress = Math.max(0, r.progress - TRIP_SLIDE);
    const busted = r.pot > 0;
    if (busted) r.busts += 1;
    r.pot = 0;
    r.potTaps = 0;
    return busted ? "bust" : "trip";
  }
  if (r.slipArmed) {
    r.slipArmed = false;
    r.chain = 0;
    return "slip";
  }
  r.chain = nowMs - r.lastTapMs <= CHAIN_WINDOW_MS ? r.chain + 1 : 0;
  r.lastTapMs = nowMs;
  const step = STEP * stepBonus(r.chain) * (r.turbo ? TURBO_MULT : 1);
  if (light.phase === "yellow") {
    r.pot += step * dareMult(light);
    r.potTaps += 1;
    return "dare";
  }
  r.progress = Math.min(1, r.progress + step);
  return "step";
}

export interface Payout {
  amount: number;
  taps: number;
  clutch: boolean;
}

/**
 * The red is over: pay the pot out as a dash. `redStartMs` is when the light turned red; a last dare tap that
 * landed inside the clutch window before it earns a bonus. Returns null when there was nothing in the pot.
 */
export function bankPot(r: Runner, redStartMs: number): Payout | null {
  if (r.pot <= 0) return null;
  const gap = redStartMs - r.lastTapMs;
  const clutch = gap >= 0 && gap <= CLUTCH_WINDOW_MS;
  const amount = r.pot * (clutch ? 1 + CLUTCH_BONUS : 1);
  r.progress = Math.min(1, r.progress + amount);
  r.banked += amount;
  const taps = r.potTaps;
  r.pot = 0;
  r.potTaps = 0;
  return { amount, taps, clutch };
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
  if (r.heckleCd > 0) r.heckleCd = Math.max(0, r.heckleCd - dt);
}

/** Give the sole last-placed runner turbo when they trail the leader by TURBO_GAP or more. */
export function updateTurbo(runners: Runner[]): void {
  const live = runners.filter((r) => r.place === null);
  for (const r of runners) r.turbo = false;
  if (live.length < 2) return;
  const lead = Math.max(...runners.map((r) => (r.place === null ? r.progress : 1)));
  const low = Math.min(...live.map((r) => r.progress));
  const last = live.filter((r) => r.progress === low);
  if (last.length === 1 && lead - low >= TURBO_GAP) last[0]!.turbo = true;
}

/** Lob a peel from a finished runner onto `target`'s lane, just ahead of them. Returns the peel or null. */
export function throwPeel(from: Runner, target: Runner): Hazard | null {
  if (from.place === null || from.heckleCd > 0 || target.place !== null) return null;
  const at = Math.min(0.97, target.progress + PEEL_LEAD);
  const peel: Hazard = { kind: "banana", at, used: false, thrown: true };
  target.hazards.push(peel);
  target.hazards.sort((a, b) => a.at - b.at);
  from.heckleCd = HECKLE_COOLDOWN_S;
  from.peels += 1;
  return peel;
}

/** Give every unplaced runner at the line the next place, in progress order. Returns the next free place. */
export function placeFinishers(runners: Runner[], nextPlace: number, raceS = 0): number {
  const done = runners.filter((r) => r.place === null && r.progress >= 1);
  for (const r of done) {
    r.place = nextPlace++;
    r.finishS = raceS;
    r.pot = 0;
    r.potTaps = 0;
  }
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

/** Personal best is stored as a speed score so a faster time is a higher number. */
export function timeScore(seconds: number): number {
  return Math.round(100000 / Math.max(1, seconds));
}

export function scoreTime(score: number): number {
  return score > 0 ? 100000 / score : 0;
}

export interface BotBrain {
  hz: number;
  nextTap: number;
  /** Seconds after a light change before the bot notices it. */
  reactS: number;
  stall: number;
  /** How many dare taps the bot means to risk this yellow. */
  dareTaps: number;
  /** Seconds before a benched bot lobs its next peel. */
  heckleWait: number;
}

export function newBot(rng: Rng): BotBrain {
  return {
    hz: rng.float(6.5, 9), nextTap: rng.float(0.1, 0.4), reactS: rng.float(0.15, 0.4), stall: 0,
    dareTaps: 0, heckleWait: rng.float(1.5, 3),
  };
}

/** Pick how greedy a bot is on a fresh yellow: most take a few, some take none, a few get caught. */
export function planDare(late: boolean, rng: Rng): number {
  const u = rng.next();
  if (u < 0.15) return 0;
  if (u < 0.65) return rng.int(1, late ? 2 : 3);
  if (u < 0.9) return rng.int(late ? 3 : 4, late ? 5 : 6);
  return 99;
}

/** Re-roll how the bot reads a fresh light phase. */
export function botOnLight(b: BotBrain, light: Light, prev: LightPhase, rng: Rng): void {
  if (light.phase === "yellow") {
    b.dareTaps = planDare(light.late, rng);
    b.reactS = rng.float(0.05, 0.2);
  } else if (light.phase === "red") {
    // A bot that already stopped daring is standing still; one still mashing may be caught.
    const stillDaring = prev === "yellow" && b.dareTaps > 0;
    b.reactS = stillDaring ? rng.float(0.1, 0.35) : rng.next() < 0.1 ? rng.float(0.1, 0.3) : 0;
  } else {
    b.reactS = rng.float(0.15, 0.4);
  }
}

/** Does the bot believe it should be mashing right now? */
export function botSeesGo(b: BotBrain, light: Light): boolean {
  if (light.phase === "green") return light.t >= b.reactS;
  if (light.phase === "yellow") return light.t < b.reactS || b.dareTaps > 0;
  return light.t < b.reactS;
}

/** Advance the bot by dt. Returns true when it taps this frame. */
export function tickBot(b: BotBrain, light: Light, dt: number, rng: Rng): boolean {
  if (b.stall > 0) {
    b.stall -= dt;
    return false;
  }
  if (rng.next() < 0.1 * dt) {
    b.stall = 0.45;
    return false;
  }
  if (!botSeesGo(b, light)) return false;
  b.nextTap -= dt;
  if (b.nextTap > 0) return false;
  b.nextTap = (1 / b.hz) * rng.float(0.8, 1.25);
  if (light.phase === "yellow" && light.t >= b.reactS) b.dareTaps -= 1;
  return true;
}

/** Advance a benched bot's heckle timer. Returns true when it wants to throw now. */
export function tickHeckler(b: BotBrain, dt: number, rng: Rng): boolean {
  b.heckleWait -= dt;
  if (b.heckleWait > 0) return false;
  b.heckleWait = rng.float(1.2, 3.2);
  return true;
}

/** The bench targets whoever is furthest ahead and still running. Returns the index or -1. */
export function pickHeckleTarget(runners: Runner[]): number {
  let best = -1;
  for (let i = 0; i < runners.length; i++) {
    const r = runners[i]!;
    if (r.place !== null) continue;
    if (best < 0 || r.progress > runners[best]!.progress) best = i;
  }
  return best;
}

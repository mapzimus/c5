import type { Rng } from "../../core/rng";

/** Pure rules for Thin Ice Stampede. No canvas, no DOM. Times are seconds from round start. */

export const LANES = 5;
export const ROUND_S = 20;
export const ROUNDS = 3;
export const HOP_S = 0.15;
/** Two-lane critters start showing up after this many seconds. */
export const BIG_AFTER_S = 6;
/** Stampede walls (one safe lane) start after this many seconds, then repeat every STAMPEDE_GAP_S. */
export const STAMPEDE_AFTER_S = 11;
export const STAMPEDE_GAP_S = 4.5;
/** The final round starts this far along the difficulty curve (OVERDRIVE). */
export const OVERDRIVE_S = 6;
/** Hopping out of a lane this close to impact is a CLOSE call. */
export const NEAR_S = 0.24;
export const NEAR_BONUS = 2;
export const NEAR_STREAK_CAP = 5;
export const LAST_STANDING_BONUS = 5;
export const REVENGE_BONUS = 4;
/** Seconds between a rider's launches. */
export const RIDER_GAP_S = 4;
/** Seconds after going out before a seat becomes a rider. */
export const RIDER_DELAY_S = 1;
/** Bots start looking for a way off cracking ice at this fraction of the crack limit. */
export const BOT_CRACK_PANIC = 0.7;

export interface WaveCritter {
  /** Top lane the critter covers. A big critter also covers lane + 1. */
  lane: number;
  big: boolean;
}

export interface Wave {
  critters: WaveCritter[];
  stampede: boolean;
}

export interface Difficulty {
  /** Slide speed in px/s. */
  speed: number;
  /** Seconds between waves. */
  interval: number;
  /** Most lanes one wave may fill. Never all of them. */
  maxCount: number;
}

/** Waves get faster, closer together and fatter as the round goes on. */
export function difficulty(t: number): Difficulty {
  const p = Math.max(0, Math.min(1, t / ROUND_S));
  return {
    speed: 320 + 440 * p,
    interval: 1.4 - 0.8 * p,
    maxCount: Math.min(LANES - 1, 1 + Math.floor(Math.max(0, t) / 4)),
  };
}

/** Seconds you may stand in one lane before the ice under you gives way. Shrinks over the round. */
export function crackLimit(t: number): number {
  const p = Math.max(0, Math.min(1, t / ROUND_S));
  return 3.2 - 1.2 * p;
}

export function occupiedLanes(c: WaveCritter): number[] {
  return c.big ? [c.lane, c.lane + 1] : [c.lane];
}

/**
 * Plan the next wave at round time `t`. Always leaves at least one lane free.
 * A stampede fills every lane but one, once per STAMPEDE_GAP_S after STAMPEDE_AFTER_S.
 */
export function planWave(t: number, rng: Rng, lastStampedeAt: number): Wave {
  if (t >= STAMPEDE_AFTER_S && t - lastStampedeAt >= STAMPEDE_GAP_S) {
    const safe = rng.int(0, LANES - 1);
    const critters: WaveCritter[] = [];
    for (let l = 0; l < LANES; l++) if (l !== safe) critters.push({ lane: l, big: false });
    return { critters, stampede: true };
  }
  const d = difficulty(t);
  const wanted = rng.int(1, d.maxCount);
  const taken = new Set<number>();
  const critters: WaveCritter[] = [];
  const freeLanes = (big: boolean): number[] => {
    const options: number[] = [];
    for (let l = 0; l < LANES; l++) {
      const needs = occupiedLanes({ lane: l, big });
      if (needs.some((n) => n >= LANES || taken.has(n))) continue;
      if (taken.size + needs.length > LANES - 1) continue;
      options.push(l);
    }
    return options;
  };
  for (let i = 0; i < wanted; i++) {
    let big = t >= BIG_AFTER_S && rng.next() < 0.3;
    let options = freeLanes(big);
    if (options.length === 0 && big) {
      // No room for a fat one: try a regular critter instead.
      big = false;
      options = freeLanes(false);
    }
    if (options.length === 0) break;
    const lane = rng.pick(options);
    for (const n of occupiedLanes({ lane, big })) taken.add(n);
    critters.push({ lane, big });
  }
  return { critters, stampede: false };
}

export interface Obstacle {
  x: number;
  rx: number;
  lanes: readonly number[];
}

/** Seconds until the nearest critter in `lane` reaches a player at `px` (Infinity if none coming). */
export function arrivalTime(
  obs: readonly Obstacle[],
  lane: number,
  px: number,
  pr: number,
  speed: number,
): number {
  let best = Infinity;
  for (const o of obs) {
    if (!o.lanes.includes(lane)) continue;
    if (o.x + o.rx < px - pr) continue;
    const gap = Math.max(0, o.x - o.rx - (px + pr));
    best = Math.min(best, gap / speed);
  }
  return best;
}

/** True when leaving `lane` right now counts as a CLOSE call: a critter was about to land on you. */
export function isNearMiss(
  obs: readonly Obstacle[],
  lane: number,
  px: number,
  pr: number,
  speed: number,
): boolean {
  return arrivalTime(obs, lane, px, pr, speed) < NEAR_S;
}

/** Points for the n-th close call in a row (streak starts at 1). */
export function nearMissBonus(streak: number): number {
  return NEAR_BONUS * Math.min(NEAR_STREAK_CAP, Math.max(1, streak));
}

/**
 * Bot brain. Looks at the nearest critter in its lane; if it arrives within `threshold`
 * seconds, returns the safest adjacent lane (or a random one `missChance` of the time).
 * When the ice under it is about to give way (`crackFrac` >= BOT_CRACK_PANIC) it leaves
 * for whichever neighbour is hit latest, however bad that is. Returns null to stay put.
 */
export function botDecide(
  lane: number,
  obs: readonly Obstacle[],
  px: number,
  pr: number,
  speed: number,
  threshold: number,
  rng: Rng,
  missChance = 0.1,
  crackFrac = 0,
): number | null {
  const options = [lane - 1, lane + 1].filter((l) => l >= 0 && l < LANES);
  if (options.length === 0) return null;
  if (crackFrac >= BOT_CRACK_PANIC) {
    let best = options[0] ?? lane;
    let bestT = -1;
    for (const l of options) {
      const a = arrivalTime(obs, l, px, pr, speed);
      if (a > bestT) {
        bestT = a;
        best = l;
      }
    }
    return best;
  }
  const here = arrivalTime(obs, lane, px, pr, speed);
  if (here > threshold) return null;
  if (rng.next() < missChance) return rng.pick(options);
  let best: number | null = null;
  let bestT = here;
  for (const l of options) {
    const a = arrivalTime(obs, l, px, pr, speed);
    if (a > bestT) {
      bestT = a;
      best = l;
    }
  }
  return best;
}

export interface RiderTarget {
  lane: number;
  score: number;
}

/**
 * Rider bot brain: which lane to aim the next revenge critter at. Hunts the leader among the
 * players still standing, with a `wildChance` of picking any of them. Null when nobody is standing.
 */
export function riderBotAim(targets: readonly RiderTarget[], rng: Rng, wildChance = 0.25): number | null {
  const first = targets[0];
  if (!first) return null;
  if (rng.next() < wildChance) return rng.pick(targets).lane;
  let best = first;
  for (const t of targets) if (t.score > best.score) best = t;
  return best.lane;
}

/** Seats that start the next round with an underdog shield: everyone sharing the lowest total, if they trail. */
export function underdogs(scores: readonly number[]): number[] {
  if (scores.length < 2) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const s of scores) {
    min = Math.min(min, s);
    max = Math.max(max, s);
  }
  if (max - min < 1) return [];
  const out: number[] = [];
  scores.forEach((s, i) => {
    if (s === min) out.push(i);
  });
  return out;
}

export interface SeatState {
  alive: boolean;
}

/** A round runs until the clock runs out or everyone is off the ice. Riders keep the last one busy. */
export function roundOver(seats: readonly SeatState[], timedOut: boolean): boolean {
  return timedOut || seats.every((s) => !s.alive);
}

/** Highest total takes the match; ties share. */
export function matchWinners(scores: readonly number[]): number[] {
  let top = -Infinity;
  for (const s of scores) top = Math.max(top, s);
  const out: number[] = [];
  scores.forEach((s, i) => {
    if (s === top) out.push(i);
  });
  return out;
}

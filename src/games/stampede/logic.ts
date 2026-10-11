import type { Rng } from "../../core/rng";

/** Pure rules for Stampede. No canvas, no DOM. Times are seconds from round start. */

export const LANES = 5;
export const ROUND_S = 45;
export const WINS_NEEDED = 2;
export const MAX_ROUNDS = 5;
export const HOP_S = 0.15;
/** Two-lane critters start showing up after this many seconds. */
export const BIG_AFTER_S = 20;
/** Stampede walls (one safe lane) start after this many seconds, then repeat every STAMPEDE_GAP_S. */
export const STAMPEDE_AFTER_S = 30;
export const STAMPEDE_GAP_S = 7;

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
    speed: 310 + 420 * p,
    interval: 1.5 - 0.85 * p,
    maxCount: Math.min(LANES - 1, 1 + Math.floor(Math.max(0, t) / 6)),
  };
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

/**
 * Bot brain. Looks at the nearest critter in its lane; if it arrives within `threshold`
 * seconds, returns the safest adjacent lane (or a random one `missChance` of the time).
 * Returns null to stay put.
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
): number | null {
  const here = arrivalTime(obs, lane, px, pr, speed);
  if (here > threshold) return null;
  const options = [lane - 1, lane + 1].filter((l) => l >= 0 && l < LANES);
  if (options.length === 0) return null;
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

export interface SeatState {
  alive: boolean;
  /** Round time the player was flattened, or null while standing. */
  fellAt: number | null;
}

export function roundOver(seats: readonly SeatState[], timedOut: boolean): boolean {
  return timedOut || seats.filter((s) => s.alive).length <= 1;
}

/**
 * Seat indexes that win the round: the last one standing, every survivor at the
 * time limit, or (if everyone fell) whoever fell last. Ties share.
 */
export function roundWinners(seats: readonly SeatState[], timedOut: boolean): number[] {
  const alive: number[] = [];
  seats.forEach((s, i) => {
    if (s.alive) alive.push(i);
  });
  if (alive.length === 1 || (timedOut && alive.length > 0)) return alive;
  if (alive.length > 1) return [];
  let last = -Infinity;
  for (const s of seats) if (s.fellAt !== null && s.fellAt > last) last = s.fellAt;
  const out: number[] = [];
  seats.forEach((s, i) => {
    if (s.fellAt === last) out.push(i);
  });
  return out;
}

/** Match ends when someone has 2 round wins or 5 rounds were played. */
export function matchOver(wins: readonly number[], roundsPlayed: number): boolean {
  return wins.some((w) => w >= WINS_NEEDED) || roundsPlayed >= MAX_ROUNDS;
}

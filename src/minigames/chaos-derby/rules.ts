import type { Rng } from "../../core/rng";

/**
 * Chaos Derby roster, betting and scoring. The race itself lives in world.ts.
 * Nothing a player does affects the race: the only input is the bet.
 */

export type Build = "tall" | "round" | "tiny" | "normal" | "wide";
export type Hat = "none" | "cap" | "bow" | "antenna" | "tophat" | "mohawk" | "headband";

export interface RacerSpec {
  id: string;
  name: string;
  color: string;
  build: Build;
  hat: Hat;
}

export const RACER_POOL: readonly RacerSpec[] = [
  { id: "gary", name: "Gary", color: "#4ade80", build: "normal", hat: "cap" },
  { id: "linda", name: "Big Linda", color: "#f472b6", build: "round", hat: "bow" },
  { id: "pickles", name: "Pickles", color: "#a3e635", build: "tall", hat: "none" },
  { id: "bones", name: "Dr. Bones", color: "#e2e8f0", build: "tall", hat: "tophat" },
  { id: "meatball", name: "Meatball", color: "#f97316", build: "round", hat: "none" },
  { id: "kevin", name: "Kevin", color: "#38bdf8", build: "normal", hat: "headband" },
  { id: "noodle", name: "Noodle", color: "#facc15", build: "tall", hat: "antenna" },
  { id: "nana", name: "Nana", color: "#c084fc", build: "tiny", hat: "bow" },
  { id: "chad", name: "Chad", color: "#fb7185", build: "wide", hat: "headband" },
  { id: "waffles", name: "Waffles", color: "#fbbf24", build: "wide", hat: "cap" },
  { id: "sprout", name: "Sprout", color: "#86efac", build: "tiny", hat: "antenna" },
  { id: "duchess", name: "Duchess", color: "#a78bfa", build: "normal", hat: "tophat" },
  { id: "tater", name: "Tater", color: "#d6b98c", build: "round", hat: "cap" },
  { id: "boris", name: "Boris", color: "#f87171", build: "normal", hat: "mohawk" },
];

/** Physics size of each build, legs included. */
export const BUILD_SIZE: Record<Build, { w: number; h: number }> = {
  tall: { w: 30, h: 74 },
  round: { w: 50, h: 56 },
  tiny: { w: 28, h: 42 },
  normal: { w: 38, h: 60 },
  wide: { w: 56, h: 48 },
};

export const RACER_COUNT = 6;
/** Decoration only. The odds have no effect on anything. */
export const FAKE_ODDS = ["EVENS", "2-1", "3-1", "5-1", "7-2", "8-1", "11-4", "13-1", "20-1", "33-1", "50-1", "100-1"] as const;

/**
 * Hidden, re-rolled every race and unrelated to the racer's look,
 * so there is no form to read.
 */
export interface RacerStats {
  /** Cruising speed in px/s. */
  topSpeed: number;
  /** How fast they get up to speed, per second. */
  accel: number;
  /** Chance of seeing a hurdle coming and jumping it. */
  jumpSkill: number;
  /** How hard they fight to stay upright. */
  balance: number;
  /** Seconds lying there after a fall. */
  getUp: number;
  /** Stamina drain per second. */
  fatigue: number;
}

export interface RacerEntry {
  spec: RacerSpec;
  lane: number;
  odds: string;
  stats: RacerStats;
}

export function rollStats(rng: Rng): RacerStats {
  return {
    topSpeed: rng.float(235, 285),
    accel: rng.float(2.2, 4.5),
    jumpSkill: rng.float(0.35, 0.92),
    balance: rng.float(0.55, 1),
    getUp: rng.float(0.5, 1.8),
    fatigue: rng.float(0.004, 0.014),
  };
}

/** Six different racers from the pool, random lanes, made-up odds, hidden stats. */
export function draftRacers(rng: Rng, count = RACER_COUNT): RacerEntry[] {
  const pool = [...RACER_POOL];
  const racers: RacerEntry[] = [];
  for (let lane = 0; lane < count && pool.length > 0; lane += 1) {
    const spec = pool.splice(rng.int(0, pool.length - 1), 1)[0]!;
    racers.push({ spec, lane, odds: rng.pick(FAKE_ODDS), stats: rollStats(rng) });
  }
  return racers;
}

/** What placing needs to know about a racer. */
export interface Placeable {
  lane: number;
  finished: boolean;
  /** 1-based finishing place, 0 while still running. */
  place: number;
  /** Distance along the track. */
  x: number;
}

/** Finishers by place, then everyone still running by distance. */
export function placings<T extends Placeable>(racers: readonly T[]): T[] {
  const done = racers.filter((r) => r.finished).sort((a, b) => a.place - b.place);
  const rest = racers.filter((r) => !r.finished).sort((a, b) => b.x - a.x);
  return [...done, ...rest];
}

/**
 * A bet on the racer that placed best wins. Score is how many racers your pick beat,
 * so backers of the winner top the table and two people on the same racer tie.
 */
export function scoreBets(order: readonly Placeable[], bets: ReadonlyMap<string, number>): Map<string, number> {
  const rank = new Map(order.map((r, i) => [r.lane, i]));
  const scores = new Map<string, number>();
  for (const [playerId, lane] of bets) {
    const i = rank.get(lane);
    scores.set(playerId, i === undefined ? 0 : order.length - i);
  }
  return scores;
}

/** Who backed a lane, in seat order. */
export function backersOf(lane: number, bets: ReadonlyMap<string, number>): string[] {
  return [...bets].filter(([, l]) => l === lane).map(([id]) => id);
}

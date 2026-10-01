import type { Rng } from "../../core/rng";

/**
 * Chaos Derby roster, betting and scoring. The race itself lives in world.ts.
 * Nothing a player does affects the race: the only input is the bet.
 */

export type Shape = "bean" | "ball" | "noodle" | "cube" | "pear" | "pickle" | "jelly" | "wide";
export type Eyes = "two" | "cyclops" | "three" | "mismatch";
/** How they run. Mostly looks, but hoppers really do hop. */
export type Gait = "sprint" | "flail" | "waddle" | "hop" | "powerwalk";
export type Hat = "none" | "cap" | "bow" | "antenna" | "tophat" | "mohawk" | "headband" | "bun" | "sprout" | "propeller";
export type Extra = "mustache" | "monocle" | "glasses" | "shades" | "lashes" | "lipstick" | "unibrow" | "nose" | "bucktooth" | "tongue";
export type Pattern = "none" | "stripes" | "spots" | "belly";

export interface RacerSpec {
  id: string;
  name: string;
  color: string;
  shape: Shape;
  /** Physics size, legs included. */
  w: number;
  h: number;
  eyes: Eyes;
  gait: Gait;
  hat: Hat;
  extras: readonly Extra[];
  pattern: Pattern;
  arms: "normal" | "noodle" | "stubby";
  legs: "normal" | "long" | "stubby";
  feet: "sneaker" | "clown" | "bare";
  /**
   * Hidden handicap on running speed so no body shape has an edge (round and wide runners
   * fall more and take longer to get up). Calibrated from simulated races; see world.test.ts.
   */
  pace: number;
}

export const RACER_POOL: readonly RacerSpec[] = [
  { id: "gary", name: "Gary", color: "#ef2b2b", shape: "bean", w: 38, h: 60, eyes: "two", gait: "sprint", hat: "cap", extras: ["mustache", "nose"], pattern: "none", arms: "normal", legs: "normal", feet: "sneaker", pace: 0.994 },
  { id: "linda", name: "Big Linda", color: "#ff4fb3", shape: "ball", w: 56, h: 56, eyes: "two", gait: "waddle", hat: "bow", extras: ["lashes", "lipstick"], pattern: "belly", arms: "stubby", legs: "stubby", feet: "sneaker", pace: 1.074 },
  { id: "noodle", name: "Noodle", color: "#ffe14d", shape: "noodle", w: 24, h: 84, eyes: "mismatch", gait: "flail", hat: "antenna", extras: ["tongue"], pattern: "none", arms: "noodle", legs: "long", feet: "bare", pace: 0.976 },
  { id: "bones", name: "Dr. Bones", color: "#f4f4f5", shape: "pear", w: 36, h: 70, eyes: "two", gait: "powerwalk", hat: "tophat", extras: ["monocle", "nose"], pattern: "none", arms: "normal", legs: "long", feet: "sneaker", pace: 1.005 },
  { id: "meatball", name: "Meatball", color: "#8a5a2b", shape: "ball", w: 50, h: 50, eyes: "two", gait: "waddle", hat: "none", extras: ["bucktooth", "unibrow"], pattern: "spots", arms: "stubby", legs: "stubby", feet: "clown", pace: 1.042 },
  { id: "kevin", name: "Kevin", color: "#2f6bff", shape: "cube", w: 44, h: 58, eyes: "three", gait: "sprint", hat: "headband", extras: [], pattern: "none", arms: "normal", legs: "normal", feet: "sneaker", pace: 1.013 },
  { id: "nana", name: "Nana", color: "#9b4dff", shape: "ball", w: 32, h: 42, eyes: "two", gait: "waddle", hat: "bun", extras: ["glasses"], pattern: "belly", arms: "stubby", legs: "stubby", feet: "sneaker", pace: 0.979 },
  { id: "chad", name: "Chad", color: "#ff8a1f", shape: "wide", w: 58, h: 52, eyes: "two", gait: "flail", hat: "none", extras: ["shades", "bucktooth"], pattern: "stripes", arms: "normal", legs: "normal", feet: "clown", pace: 1.072 },
  { id: "sprout", name: "Sprout", color: "#9eff3d", shape: "jelly", w: 30, h: 42, eyes: "two", gait: "hop", hat: "sprout", extras: ["lashes"], pattern: "none", arms: "stubby", legs: "stubby", feet: "bare", pace: 0.982 },
  { id: "blorp", name: "Blorp", color: "#1fe0e0", shape: "jelly", w: 46, h: 54, eyes: "cyclops", gait: "hop", hat: "propeller", extras: ["tongue"], pattern: "spots", arms: "noodle", legs: "stubby", feet: "bare", pace: 1.007 },
  { id: "pickles", name: "Pickles", color: "#138a3a", shape: "pickle", w: 32, h: 70, eyes: "mismatch", gait: "sprint", hat: "none", extras: ["unibrow"], pattern: "spots", arms: "noodle", legs: "normal", feet: "clown", pace: 0.997 },
  { id: "boris", name: "Boris", color: "#262a33", shape: "bean", w: 40, h: 62, eyes: "two", gait: "flail", hat: "mohawk", extras: ["unibrow", "bucktooth"], pattern: "stripes", arms: "normal", legs: "normal", feet: "sneaker", pace: 0.992 },
];

/** Perceptual distance between two hex colours (weighted "redmean" RGB). */
export function colorDistance(a: string, b: string): number {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const [r1, g1, b1] = [(pa >> 16) & 255, (pa >> 8) & 255, pa & 255];
  const [r2, g2, b2] = [(pb >> 16) & 255, (pb >> 8) & 255, pb & 255];
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
}

/** Two runners in the same race must be at least this far apart in colour. */
export const MIN_COLOR_GAP = 215;

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

/**
 * Six random runners in random lanes, made-up odds, hidden stats. Each keeps its own
 * colour unless that clashes with someone already in the race; then it borrows the
 * closest colour that doesn't, so every race has six colours that are easy to tell apart.
 */
export function draftRacers(rng: Rng, count = RACER_COUNT): RacerEntry[] {
  const pool = [...RACER_POOL];
  const specs: RacerSpec[] = [];
  while (specs.length < count && pool.length > 0) specs.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]!);
  const colors = assignColors(specs, rng);
  return specs.map((spec, lane) => ({ spec: { ...spec, color: colors[lane]! }, lane, odds: rng.pick(FAKE_ODDS), stats: rollStats(rng) }));
}

const PALETTE = RACER_POOL.map((r) => r.color);

/** Keep as many signature colours as possible, then recolour the rest to the nearest colour that doesn't clash. */
export function assignColors(specs: readonly RacerSpec[], rng: Rng): string[] {
  const n = specs.length;
  const clash = (a: string, b: string): boolean => colorDistance(a, b) < MIN_COLOR_GAP;
  let bestSize = -1;
  let best: number[] = [];
  for (let mask = 0; mask < 1 << n; mask += 1) {
    const members = specs.map((_, i) => i).filter((i) => mask & (1 << i));
    if (members.length < bestSize) continue;
    const ok = members.every((i, k) => members.slice(k + 1).every((j) => !clash(specs[i]!.color, specs[j]!.color)));
    if (!ok) continue;
    if (members.length > bestSize) {
      bestSize = members.length;
      best = [mask];
    } else best.push(mask);
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const mask = best[rng.int(0, best.length - 1)]!;
    const colors: string[] = specs.map((s, i) => (mask & (1 << i) ? s.color : ""));
    const rest = specs.map((_, i) => i).filter((i) => !(mask & (1 << i)));
    for (let i = rest.length - 1; i > 0; i -= 1) {
      const j = rng.int(0, i);
      [rest[i], rest[j]] = [rest[j]!, rest[i]!];
    }
    let ok = true;
    for (const i of rest) {
      const own = specs[i]!.color;
      const used = colors.filter(Boolean);
      const pick = [...PALETTE].sort((a, b) => colorDistance(own, a) - colorDistance(own, b)).find((c) => used.every((u) => u !== c && !clash(u, c)));
      if (!pick) {
        ok = false;
        break;
      }
      colors[i] = pick;
    }
    if (ok) return colors;
  }
  return specs.map((s) => s.color);
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

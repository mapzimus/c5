import type { Rng } from "../../core/rng";

/**
 * Pure rules for Ice Luge: a seeded winding chute, sleds that auto-accelerate down it,
 * wall scrapes, rock spin-outs, crystal boosts and finishing places.
 * No canvas, no DOM. Track distance is in logical px, lateral position is in "lane units"
 * where -1..1 spans the drawable lane. Times are seconds.
 */

/** Distance from the start to the finish line. */
export const LENGTH = 20000;
/** Straight run-out past the finish so finished sleds keep gliding. */
export const RUNOUT = 1400;
/** Top speed at the start and at the finish line (px/s). It climbs linearly between. */
export const V0 = 260;
export const V1 = 720;
export const ACCEL = 240;
/** Speed never drops below this, even when grinding a wall. */
export const MIN_V = 110;
export const SCRAPE_DECEL = 520;
export const ROCK_SPIN_S = 0.8;
/** Fraction of speed kept after hitting a rock. */
export const ROCK_SPEED_KEEP = 0.35;
export const BOOST = 170;
/** A boosted sled can exceed the current top speed by at most this much. */
export const BOOST_CAP = 220;
/** Speed above top speed bleeds off at this rate. */
export const OVER_DECAY = 90;
/** Lateral speed with the steer fully held (lane units/s). */
export const STEER_MAX = 2.3;
export const STEER_RESPONSE = 12;
export const SLED_HALF = 0.09;
export const ITEM_HALF = 0.07;
/** Items are hit when the sled passes within this many px along the track. */
export const ITEM_REACH_D = 30;
/** Chute half width (lane units) at the start and at the finish. */
export const HALF_START = 0.64;
export const HALF_END = 0.33;
/** The first stretch is straight so everyone gets going. */
export const EASE_IN = 900;
/** After the winner crosses, the rest get this long before being placed by distance. */
export const FINISH_GRACE_S = 8;
/** If nobody has finished by then, everyone is placed by distance. */
export const RACE_CAP_S = 95;
export const PLACE_POINTS: readonly number[] = [5, 3, 2, 1];

export type ItemKind = "crystal" | "rock";

export interface Item {
  id: number;
  d: number;
  /** Lateral position in lane units. */
  x: number;
  kind: ItemKind;
}

export interface Wave {
  amp: number;
  wavelength: number;
  phase: number;
}

export interface Course {
  waves: Wave[];
  wobblePhase: number;
  /** Sorted by d. */
  items: Item[];
}

export interface Chute {
  center: number;
  half: number;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Centre line and half width of the chute at track distance `d`. */
export function chuteAt(course: Course, d: number): Chute {
  const ease = smoothstep(d / EASE_IN);
  const fade = 1 - smoothstep((d - LENGTH) / 600);
  let half = lerp(HALF_START, HALF_END, smoothstep(d / LENGTH)) + 0.04 * Math.sin(d / 330 + course.wobblePhase);
  half = half * fade + 0.7 * (1 - fade);
  let raw = 0;
  for (const w of course.waves) raw += w.amp * Math.sin((Math.PI * 2 * d) / w.wavelength + w.phase);
  raw = clamp(raw, -1, 1);
  return { center: raw * (1 - half) * ease * fade, half };
}

/** Same seed, same course for everyone at the table. */
export function makeCourse(rng: Rng): Course {
  const waves: Wave[] = [
    { amp: 0.5, wavelength: rng.float(2400, 3600), phase: rng.float(0, Math.PI * 2) },
    { amp: 0.3, wavelength: rng.float(1300, 1900), phase: rng.float(0, Math.PI * 2) },
    { amp: 0.18, wavelength: rng.float(700, 1000), phase: rng.float(0, Math.PI * 2) },
  ];
  const course: Course = { waves, wobblePhase: rng.float(0, Math.PI * 2), items: [] };
  let id = 0;
  let d = 1100;
  while (d < LENGTH - 500) {
    const roll = rng.next();
    if (roll < 0.78) {
      const ch = chuteAt(course, d);
      const x = ch.center + rng.float(-0.75, 0.75) * ch.half;
      course.items.push({ id: id++, d, x, kind: roll < 0.5 ? "crystal" : "rock" });
    }
    d += rng.float(240, 400);
  }
  return course;
}

export function topSpeed(d: number): number {
  return lerp(V0, V1, clamp(d / LENGTH, 0, 1));
}

export interface Sled {
  d: number;
  x: number;
  v: number;
  vx: number;
  /** Seconds of spin-out left. */
  spin: number;
  /** Wall currently being scraped: -1 left, 1 right, 0 none. */
  scrapeSide: -1 | 0 | 1;
  finished: boolean;
  place: number | null;
  crystals: number;
  scrapes: number;
  /** Item ids this sled has already collected or hit. */
  taken: Set<number>;
}

export function newSled(): Sled {
  return {
    d: 0, x: 0, v: 0, vx: 0, spin: 0, scrapeSide: 0, finished: false, place: null,
    crystals: 0, scrapes: 0, taken: new Set(),
  };
}

export interface StepEvents {
  /** Set when a new wall contact started this step. */
  scrapeStart: -1 | 0 | 1;
  scraping: -1 | 0 | 1;
  rock: Item | null;
  crystals: Item[];
  /** Crossed the finish line this step. */
  crossed: boolean;
}

/** Advance one sled by `dt` with steer `input` in -1..1 (negative = left). */
export function stepSled(s: Sled, input: number, course: Course, dt: number): StepEvents {
  const ev: StepEvents = { scrapeStart: 0, scraping: 0, rock: null, crystals: [], crossed: false };
  const prevD = s.d;

  if (s.spin > 0) {
    s.spin = Math.max(0, s.spin - dt);
    input = 0;
    s.vx = 0;
  } else {
    const top = topSpeed(s.d);
    if (s.v < top) s.v = Math.min(top, s.v + ACCEL * dt);
    else s.v = Math.max(top, s.v - OVER_DECAY * dt);
  }

  const targetVx = clamp(input, -1, 1) * STEER_MAX;
  s.vx += (targetVx - s.vx) * Math.min(1, STEER_RESPONSE * dt);
  s.x += s.vx * dt;
  s.d += s.v * dt;

  const ch = chuteAt(course, s.d);
  const left = ch.center - ch.half;
  const right = ch.center + ch.half;
  let side: -1 | 0 | 1 = 0;
  if (s.x - SLED_HALF < left) {
    s.x = left + SLED_HALF;
    if (s.vx < 0) s.vx = 0;
    side = -1;
  } else if (s.x + SLED_HALF > right) {
    s.x = right - SLED_HALF;
    if (s.vx > 0) s.vx = 0;
    side = 1;
  }
  if (side !== 0) {
    s.v = Math.max(MIN_V, s.v - SCRAPE_DECEL * dt);
    if (s.scrapeSide !== side) {
      s.scrapes += 1;
      ev.scrapeStart = side;
    }
  }
  s.scrapeSide = side;
  ev.scraping = side;

  for (const item of course.items) {
    if (item.d < prevD - ITEM_REACH_D) continue;
    if (item.d > s.d + ITEM_REACH_D) break;
    if (s.taken.has(item.id)) continue;
    if (Math.abs(item.x - s.x) >= SLED_HALF + ITEM_HALF) continue;
    if (item.kind === "crystal") {
      s.taken.add(item.id);
      s.crystals += 1;
      s.v = Math.min(s.v + BOOST, topSpeed(s.d) + BOOST_CAP);
      ev.crystals.push(item);
    } else if (s.spin <= 0 && ev.rock === null) {
      s.taken.add(item.id);
      s.spin = ROCK_SPIN_S;
      s.v = Math.max(MIN_V, s.v * ROCK_SPEED_KEEP);
      s.vx = 0;
      ev.rock = item;
    }
  }

  if (!s.finished && s.d >= LENGTH) {
    s.finished = true;
    ev.crossed = true;
  }
  return ev;
}

/** Place every unfinished sled by distance, continuing from `nextPlace`. Returns the next free place. */
export function placeByDistance(sleds: readonly Sled[], nextPlace: number): number {
  const rest = sleds.filter((s) => s.place === null).sort((a, b) => b.d - a.d);
  for (const s of rest) {
    s.place = nextPlace;
    nextPlace += 1;
  }
  return nextPlace;
}

export function pointsForPlace(place: number | null): number {
  if (place === null) return 0;
  return PLACE_POINTS[place - 1] ?? 0;
}

export function ordinal(place: number): string {
  const suffix = place === 1 ? "ST" : place === 2 ? "ND" : place === 3 ? "RD" : "TH";
  return `${place}${suffix}`;
}

export interface BotBrain {
  target: number;
  /** Seconds until the bot re-reads the track. */
  think: number;
  /** How often it goes for a crystal it can reach. */
  crystalLove: number;
  /** Reaction lag range (s). */
  lagMin: number;
  lagMax: number;
  noise: number;
}

export function newBotBrain(rng: Rng): BotBrain {
  return {
    target: 0, think: 0, crystalLove: rng.float(0.5, 0.9),
    lagMin: rng.float(0.1, 0.18), lagMax: rng.float(0.22, 0.34), noise: rng.float(0.3, 0.55),
  };
}

/**
 * Bots aim at the chute centre a little way ahead, with reaction lag and noise, so they
 * scrape sometimes. They grab crystals that are easy and mostly dodge rocks.
 */
export function botInput(s: Sled, course: Course, brain: BotBrain, rng: Rng, dt: number): number {
  brain.think -= dt;
  if (brain.think <= 0) {
    brain.think = rng.float(brain.lagMin, brain.lagMax);
    const lookD = s.d + Math.max(120, s.v * 0.45);
    const ch = chuteAt(course, lookD);
    let target = ch.center + rng.float(-1, 1) * ch.half * brain.noise;
    const reach = ch.half - SLED_HALF - 0.02;
    for (const item of course.items) {
      if (item.d < s.d + 40) continue;
      if (item.d > s.d + Math.max(300, s.v * 0.9)) break;
      if (s.taken.has(item.id)) continue;
      if (item.kind === "crystal") {
        if (Math.abs(item.x - ch.center) <= reach && rng.next() < brain.crystalLove) {
          target = item.x;
          break;
        }
      } else if (Math.abs(item.x - target) < SLED_HALF + ITEM_HALF + 0.05 && rng.next() < 0.8) {
        const away = target === item.x ? (ch.center >= item.x ? 1 : -1) : Math.sign(target - item.x);
        target = clamp(item.x + away * 0.28, ch.center - reach, ch.center + reach);
      }
    }
    brain.target = target;
  }
  return clamp((brain.target - s.x) * 6, -1, 1);
}

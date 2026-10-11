import type { Rng } from "../../core/rng";

/**
 * Pure rules for Avalanche Luge: a seeded winding chute, sleds that auto-accelerate down it,
 * wall scrapes, rock spin-outs, crystal boosts, the TUCK push-your-luck heat meter, slipstream
 * ghosts with a draft meter that fires a slingshot, the avalanche that buries stragglers, and
 * snowballs lobbed by anyone who is already done.
 * No canvas, no DOM. Track distance is in logical px, lateral position is in "lane units"
 * where -1..1 spans the drawable lane. Times are seconds.
 */

/** Distance from the start to the finish line. */
export const LENGTH = 25000;
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
/** Passing a rock closer than this (beyond the hit radius) is a near miss. */
export const NEAR_MISS = 0.07;
/** Chute half width (lane units) at the start and at the finish. */
export const HALF_START = 0.64;
export const HALF_END = 0.33;
/** The first stretch is straight so everyone gets going. */
export const EASE_IN = 900;
/** After the avalanche is released, the rest get at most this long before being placed by distance. */
export const FINISH_GRACE_S = 11;
/** If nobody has finished by then, the avalanche is released anyway. */
export const RACE_CAP_S = 70;
export const PLACE_POINTS: readonly number[] = [5, 3, 2, 1];

// --- Tuck (hold both halves): no steering, big speed, heat builds. Full heat = meltdown. ---
/** Tucked top speed as a multiple of the normal top speed. */
export const TUCK_MULT = 1.32;
export const TUCK_ACCEL = 420;
/** Seconds of tucking from cold to meltdown. */
export const TUCK_FULL_S = 2.3;
/** Heat gained per second on top while scraping a wall tucked. */
export const TUCK_SCRAPE_HEAT = 0.55;
/** Seconds for a full meter to cool off. */
export const COOL_S = 1.4;
export const MELT_SPIN_S = 0.7;
export const MELT_SPEED_KEEP = 0.45;
/** Releasing the tuck with at least this much heat is a PERFECT tuck. */
export const PERFECT_HEAT = 0.72;
export const PERFECT_BONUS = 110;

// --- Slipstream: ride right behind a rival's ghost to fill the draft meter, then slingshot. ---
/** How far ahead (px) a rival can be and still give you a wake. */
export const DRAFT_RANGE = 460;
/** Overlapping sleds do not count as a wake. */
export const DRAFT_MIN_GAP = 40;
/** No drafting on the start straight, where everyone is still on top of each other. */
export const DRAFT_START = 1600;
/** Lateral tolerance (lane units) to count as in the wake. */
export const DRAFT_HALF = 0.17;
/** Seconds in a wake to fill the meter when you are second. Every place further back is faster. */
export const DRAFT_FILL_S = 3.4;
export const DRAFT_RANK_BONUS = 0.4;
export const DRAFT_DECAY_S = 2.5;
/** Extra top speed while in a wake. */
export const DRAFT_TOP = 70;
export const DRAFT_ACCEL = 200;
export const SLING_BOOST = 290;
export const SLING_CAP = 380;
/** Visual timer for the slingshot streak. */
export const SLING_S = 1;

// --- Avalanche: released when the first sled finishes (or at the race cap). ---
export const AVALANCHE_GAP = 1200;
export const AVALANCHE_V0 = 780;
export const AVALANCHE_ACCEL = 90;

// --- Snowballs: finished and buried players lob them at everyone still racing. ---
export const SNOWBALL_FLIGHT_S = 0.85;
export const SNOWBALL_HALF = 0.12;
export const SNOWBALL_COOLDOWN_S = 1.1;
export const SNOWBALL_SPEED_KEEP = 0.7;
export const SPLAT_S = 1.1;

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

/**
 * How straight the chute is from `from` to `to`: the largest distance the centre line strays
 * from `x`, as a fraction of the free room beside the sled. Below 1 means a sled holding `x`
 * would not touch a wall.
 */
export function strayAhead(course: Course, x: number, from: number, to: number): number {
  let worst = 0;
  for (let d = from; d <= to; d += 60) {
    const ch = chuteAt(course, d);
    const room = Math.max(0.01, ch.half - SLED_HALF);
    worst = Math.max(worst, Math.abs(ch.center - x) / room);
  }
  return worst;
}

export interface Sled {
  d: number;
  x: number;
  v: number;
  vx: number;
  /** Seconds of spin-out left. */
  spin: number;
  /** Length of the current spin-out, for the tumble animation. */
  spinTotal: number;
  /** Wall currently being scraped: -1 left, 1 right, 0 none. */
  scrapeSide: -1 | 0 | 1;
  /** Crossed the finish line. */
  finished: boolean;
  /** Caught by the avalanche. */
  buried: boolean;
  place: number | null;
  /** Race time at the finish line, seconds. */
  finishT: number | null;
  crystals: number;
  scrapes: number;
  tucking: boolean;
  /** Tuck heat 0..1; 1 is a meltdown. */
  heat: number;
  meltdowns: number;
  /** Draft meter 0..1; full fires a slingshot. */
  draft: number;
  /** In a rival's wake this step. */
  drafting: boolean;
  slingshots: number;
  /** Seconds left on the slingshot streak visual. */
  sling: number;
  nearMisses: number;
  /** Seconds of snow splat left on the screen. */
  splat: number;
  splats: number;
  /** Item ids this sled has already collected or hit. */
  taken: Set<number>;
}

export function newSled(): Sled {
  return {
    d: 0, x: 0, v: 0, vx: 0, spin: 0, spinTotal: ROCK_SPIN_S, scrapeSide: 0, finished: false, buried: false, place: null,
    finishT: null, crystals: 0, scrapes: 0, tucking: false, heat: 0, meltdowns: 0, draft: 0,
    drafting: false, slingshots: 0, sling: 0, nearMisses: 0, splat: 0, splats: 0, taken: new Set(),
  };
}

/** Done racing: across the line or under the snow. */
export function isOut(s: Sled): boolean {
  return s.finished || s.buried;
}

export interface SledInput {
  /** -1..1, negative = left. */
  steer: number;
  /** Hold both halves: tuck. */
  tuck: boolean;
}

export interface StepEvents {
  /** Set when a new wall contact started this step. */
  scrapeStart: -1 | 0 | 1;
  scraping: -1 | 0 | 1;
  rock: Item | null;
  crystals: Item[];
  /** Crossed the finish line this step. */
  crossed: boolean;
  /** Tuck heat hit 1. */
  meltdown: boolean;
  /** Heat at the moment the tuck was released, or null if it was not released this step. */
  tuckRelease: number | null;
  perfectTuck: boolean;
  /** Entered a wake this step. */
  draftStart: boolean;
  slingshot: boolean;
  /** Rivals this sled moved past this step. */
  passed: Sled[];
  nearMiss: boolean;
}

/**
 * Advance one sled by `dt`. `rivals` are the other sleds (for wakes and overtakes) and
 * `rankBehind` is how many rivals are ahead of this sled right now: the further back you are,
 * the faster the draft meter fills.
 */
export function stepSled(
  s: Sled,
  input: SledInput,
  course: Course,
  dt: number,
  rivals: readonly Sled[] = [],
  rankBehind = 0,
): StepEvents {
  const ev: StepEvents = {
    scrapeStart: 0, scraping: 0, rock: null, crystals: [], crossed: false, meltdown: false,
    tuckRelease: null, perfectTuck: false, draftStart: false, slingshot: false, passed: [], nearMiss: false,
  };
  const prevD = s.d;
  let steer = clamp(input.steer, -1, 1);
  const top = topSpeed(s.d);
  s.sling = Math.max(0, s.sling - dt);
  s.splat = Math.max(0, s.splat - dt);

  // Tuck and heat.
  const wantTuck = input.tuck && s.spin <= 0 && !s.finished;
  if (wantTuck) {
    s.tucking = true;
    steer = 0;
    s.heat += dt / TUCK_FULL_S;
    if (s.scrapeSide !== 0) s.heat += TUCK_SCRAPE_HEAT * dt;
    if (s.heat >= 1) {
      s.heat = 0;
      s.tucking = false;
      s.spin = MELT_SPIN_S;
      s.spinTotal = MELT_SPIN_S;
      s.v = Math.max(MIN_V, s.v * MELT_SPEED_KEEP);
      s.vx = 0;
      s.meltdowns += 1;
      ev.meltdown = true;
    }
  } else {
    if (s.tucking) {
      s.tucking = false;
      ev.tuckRelease = s.heat;
      if (s.heat >= PERFECT_HEAT) {
        ev.perfectTuck = true;
        s.v = Math.min(s.v + PERFECT_BONUS, top * TUCK_MULT + PERFECT_BONUS);
      }
    }
    s.heat = Math.max(0, s.heat - dt / COOL_S);
  }

  // Wake check against the rivals' current positions.
  let inWake = false;
  for (const r of rivals) {
    if (r.buried || s.d < DRAFT_START) continue;
    const gap = r.d - s.d;
    if (gap < DRAFT_MIN_GAP || gap > DRAFT_RANGE) continue;
    if (Math.abs(r.x - s.x) < DRAFT_HALF) {
      inWake = true;
      break;
    }
  }

  if (s.spin > 0) {
    s.spin = Math.max(0, s.spin - dt);
    steer = 0;
    s.vx = 0;
    inWake = false;
  } else if (s.tucking) {
    const cap = top * TUCK_MULT;
    if (s.v < cap) s.v = Math.min(cap, s.v + TUCK_ACCEL * dt);
    else s.v = Math.max(cap, s.v - OVER_DECAY * dt);
  } else if (inWake && !s.finished) {
    const cap = top + DRAFT_TOP;
    if (s.v < cap) s.v = Math.min(cap, s.v + DRAFT_ACCEL * dt);
    else s.v = Math.max(cap, s.v - OVER_DECAY * dt);
  } else {
    if (s.v < top) s.v = Math.min(top, s.v + ACCEL * dt);
    else s.v = Math.max(top, s.v - OVER_DECAY * dt);
  }

  // Draft meter.
  if (inWake && !s.finished) {
    if (!s.drafting) ev.draftStart = true;
    s.draft += (dt / DRAFT_FILL_S) * (1 + DRAFT_RANK_BONUS * Math.max(0, rankBehind - 1));
    if (s.draft >= 1) {
      s.draft = 0;
      s.slingshots += 1;
      s.sling = SLING_S;
      s.v = Math.min(s.v + SLING_BOOST, top + SLING_CAP);
      ev.slingshot = true;
    }
  } else {
    s.draft = Math.max(0, s.draft - dt / DRAFT_DECAY_S);
  }
  s.drafting = inWake && !s.finished;

  const targetVx = steer * STEER_MAX;
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
    const gapX = Math.abs(item.x - s.x);
    if (gapX >= SLED_HALF + ITEM_HALF) {
      if (item.kind === "rock" && s.spin <= 0 && item.d > prevD && item.d <= s.d && gapX < SLED_HALF + ITEM_HALF + NEAR_MISS) {
        ev.nearMiss = true;
        s.nearMisses += 1;
      }
      continue;
    }
    if (item.kind === "crystal") {
      s.taken.add(item.id);
      s.crystals += 1;
      s.v = Math.min(s.v + BOOST, topSpeed(s.d) + BOOST_CAP);
      ev.crystals.push(item);
    } else if (s.spin <= 0 && ev.rock === null) {
      s.taken.add(item.id);
      s.spin = ROCK_SPIN_S;
      s.spinTotal = ROCK_SPIN_S;
      s.v = Math.max(MIN_V, s.v * ROCK_SPEED_KEEP);
      s.vx = 0;
      s.tucking = false;
      s.heat = 0;
      ev.rock = item;
    }
  }

  for (const r of rivals) {
    if (r.buried) continue;
    if (r.d > prevD && r.d <= s.d) ev.passed.push(r);
  }

  if (!s.finished && s.d >= LENGTH) {
    s.finished = true;
    s.tucking = false;
    ev.crossed = true;
  }
  return ev;
}

/** Number of unburied rivals ahead of `s` on the track. */
export function rankBehind(s: Sled, sleds: readonly Sled[]): number {
  let n = 0;
  for (const r of sleds) if (r !== s && !r.buried && r.d > s.d) n += 1;
  return n;
}

/** Place every sled still racing by distance, continuing from `nextPlace`. Returns the next free place. */
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

// --- Avalanche ---

export interface Avalanche {
  d: number;
  v: number;
}

/** Released just behind the last sled still racing. */
export function startAvalanche(sleds: readonly Sled[]): Avalanche {
  let lowest = LENGTH;
  for (const s of sleds) if (!isOut(s)) lowest = Math.min(lowest, s.d);
  return { d: lowest - AVALANCHE_GAP, v: AVALANCHE_V0 };
}

export function stepAvalanche(av: Avalanche, dt: number): void {
  av.v += AVALANCHE_ACCEL * dt;
  av.d += av.v * dt;
}

/**
 * Bury every racing sled the avalanche has reached, placing them by distance (furthest first).
 * Returns the buried sleds in placing order and the next free place.
 */
export function buryCaught(sleds: readonly Sled[], av: Avalanche, nextPlace: number): { buried: Sled[]; nextPlace: number } {
  const caught = sleds.filter((s) => !isOut(s) && s.d <= av.d).sort((a, b) => b.d - a.d);
  for (const s of caught) {
    s.buried = true;
    s.tucking = false;
    s.place = nextPlace;
    nextPlace += 1;
  }
  return { buried: caught, nextPlace };
}

// --- Snowballs ---

export interface Snowball {
  /** Lateral landing spot in lane units; the same spot in every racing lane. */
  x: number;
  /** Seconds until it lands. */
  t: number;
  /** Seat index of the thrower. */
  from: number;
}

export function throwSnowball(x: number, from: number): Snowball {
  return { x: clamp(x, -1, 1), t: SNOWBALL_FLIGHT_S, from };
}

export interface SnowballHit {
  ball: Snowball;
  sled: Sled;
}

/** Fly every snowball; the ones that land are removed and hit any racing sled under them. */
export function stepSnowballs(balls: Snowball[], targets: readonly Sled[], dt: number): { landed: Snowball[]; hits: SnowballHit[] } {
  const landed: Snowball[] = [];
  const hits: SnowballHit[] = [];
  for (const b of balls) {
    b.t -= dt;
    if (b.t > 0) continue;
    landed.push(b);
    for (const s of targets) {
      if (isOut(s)) continue;
      if (Math.abs(s.x - b.x) >= SLED_HALF + SNOWBALL_HALF) continue;
      s.v = Math.max(MIN_V, s.v * SNOWBALL_SPEED_KEEP);
      s.splat = SPLAT_S;
      s.splats += 1;
      hits.push({ ball: b, sled: s });
    }
  }
  if (landed.length) {
    let w = 0;
    for (const b of balls) if (b.t > 0) balls[w++] = b;
    balls.length = w;
  }
  return { landed, hits };
}

// --- Bots ---

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
  /** Heat at which it lets go of the tuck. Above 1 means it sometimes melts down. */
  tuckGreed: number;
  /** How reliably it judges whether the stretch ahead is straight enough to tuck. */
  tuckSkill: number;
  /** How often it goes to sit in a rival's wake. */
  draftLove: number;
  /** Current tuck decision, re-made on each think. */
  tuckWant: boolean;
  /** Seconds until this bot throws its next snowball once it is done racing. */
  throwT: number;
}

export function newBotBrain(rng: Rng): BotBrain {
  return {
    target: 0, think: 0, crystalLove: rng.float(0.5, 0.9),
    lagMin: rng.float(0.1, 0.18), lagMax: rng.float(0.22, 0.34), noise: rng.float(0.3, 0.55),
    tuckGreed: rng.float(0.6, 1.15), tuckSkill: rng.float(0.65, 0.95), draftLove: rng.float(0.4, 0.9),
    tuckWant: false, throwT: rng.float(0.8, 1.6),
  };
}

/**
 * Bots aim at the chute centre a little way ahead, with reaction lag and noise, so they
 * scrape sometimes. They grab crystals that are easy, mostly dodge rocks, sit in a rival's wake
 * when one is close ahead, tuck on straights (and sometimes on bends, by mistake) and let go
 * of the tuck at their own greed level. `threats` are snowball landing spots to dodge.
 */
export function botInput(
  s: Sled,
  course: Course,
  brain: BotBrain,
  rng: Rng,
  dt: number,
  rivals: readonly Sled[] = [],
  threats: readonly number[] = [],
): SledInput {
  brain.think -= dt;
  if (brain.think <= 0) {
    brain.think = rng.float(brain.lagMin, brain.lagMax);
    const lookD = s.d + Math.max(120, s.v * 0.45);
    const ch = chuteAt(course, lookD);
    let target = ch.center + rng.float(-1, 1) * ch.half * brain.noise;
    const reach = ch.half - SLED_HALF - 0.02;

    // Slipstream: tuck in behind the nearest rival ahead.
    let wake: Sled | null = null;
    for (const r of rivals) {
      if (r.buried || r.d <= s.d || r.d - s.d > DRAFT_RANGE * 1.4) continue;
      if (!wake || r.d < wake.d) wake = r;
    }
    if (wake && rng.next() < brain.draftLove) target = clamp(wake.x, ch.center - reach, ch.center + reach);

    let rockAhead = false;
    for (const item of course.items) {
      if (item.d < s.d + 40) continue;
      if (item.d > s.d + Math.max(300, s.v * 0.9)) break;
      if (s.taken.has(item.id)) continue;
      if (item.kind === "crystal") {
        if (Math.abs(item.x - ch.center) <= reach && rng.next() < brain.crystalLove) {
          target = item.x;
          break;
        }
      } else {
        if (Math.abs(item.x - s.x) < SLED_HALF + ITEM_HALF + 0.06) rockAhead = true;
        if (Math.abs(item.x - target) < SLED_HALF + ITEM_HALF + 0.05 && rng.next() < 0.8) {
          const away = target === item.x ? (ch.center >= item.x ? 1 : -1) : Math.sign(target - item.x);
          target = clamp(item.x + away * 0.28, ch.center - reach, ch.center + reach);
        }
      }
    }
    for (const tx of threats) {
      if (Math.abs(tx - target) < SLED_HALF + SNOWBALL_HALF + 0.05 && rng.next() < 0.75) {
        const away = tx >= ch.center ? -1 : 1;
        target = clamp(tx + away * 0.32, ch.center - reach, ch.center + reach);
      }
    }
    brain.target = target;

    // Tuck when the stretch ahead is straight enough to hold this line blind.
    // Once tucked it stays down until the line ahead turns bad (or it misjudges that).
    const stray = strayAhead(course, s.x, s.d + 60, s.d + Math.max(400, s.v * 1.1));
    if (s.tucking) {
      const stillSafe = stray < 1 && !rockAhead;
      brain.tuckWant = rng.next() < brain.tuckSkill ? stillSafe : !stillSafe;
    } else {
      const safe = stray < 0.85 && !rockAhead && Math.abs(target - s.x) < 0.08;
      const judged = rng.next() < brain.tuckSkill ? safe : !safe && rng.next() < 0.35;
      brain.tuckWant = judged && s.d > EASE_IN * 0.6;
    }
  }
  // Let go at the greed level, or as soon as a tucked run starts grinding a wall. The decision
  // then stays off until the next think, so the bot does not flicker back into the tuck.
  if (s.tucking && (s.heat >= brain.tuckGreed || s.scrapeSide !== 0)) brain.tuckWant = false;
  const steer = clamp((brain.target - s.x) * 6, -1, 1);
  return { steer, tuck: brain.tuckWant };
}

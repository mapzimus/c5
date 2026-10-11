import type { Rng } from "../../core/rng";

/**
 * Pure rules for Slot Cars: closed-spline tracks with concentric lanes, cars that move
 * along their lane's arc length, curvature speed limits, spin-outs and turbo pads.
 * No canvas, no DOM. Distances are logical px, times are seconds.
 */

export type TrackShape = "oval" | "kidney" | "hairpin";
export const TRACK_SHAPES: readonly TrackShape[] = ["oval", "kidney", "hairpin"];

export const LAPS_TO_WIN = 3;
/** Distance between neighbouring lanes. */
export const LANE_GAP = 24;
/** Top speed with the throttle held (px/s). */
export const VMAX = 400;
export const ACCEL = 320;
/** Deceleration when the throttle is released (brakes + friction). */
export const COAST_DECEL = 440;
/** Grip: v^2 / radius may not exceed this, otherwise the car spins out. */
export const GRIP = 430;
export const SPIN_S = 1.2;
/** Speed the car resumes at after a spin-out. */
export const RESUME_V = 90;
export const TURBO_BOOST = 170;
export const TURBO_VMAX = 540;
/** Over VMAX, speed bleeds back down at this rate. */
export const TURBO_DECAY = 120;
export const PAD_LEN = 150;
/** Straight road kept between the pad and the next bend so a boosted car can still brake. */
export const PAD_BRAKE_ROOM = 240;
/** After the winner finishes, everyone else has this long before being placed by progress. */
export const FINISH_GRACE_S = 8;
export const PLACE_POINTS: readonly number[] = [5, 3, 2, 1];
/** Finished cars cruise around at this speed, immune to spin-outs. */
export const CRUISE_V = 200;
/** Bots look this many seconds ahead (scaled by speed). */
export const BOT_LOOKAHEAD_S = 0.5;

export interface Vec {
  x: number;
  y: number;
}

function arc(cx: number, cy: number, r: number, fromDeg: number, toDeg: number, stepDeg: number): Vec[] {
  const out: Vec[] = [];
  for (let a = fromDeg; stepDeg > 0 ? a <= toDeg : a >= toDeg; a += stepDeg) {
    out.push({ x: cx + Math.cos((a * Math.PI) / 180) * r, y: cy + Math.sin((a * Math.PI) / 180) * r });
  }
  return out;
}

/** Control points in a box roughly 960x480 around the origin. Index 0 is the start line. */
const SHAPES: Record<TrackShape, readonly Vec[]> = {
  // Stadium: two straights joined by 230px semicircles.
  oval: [
    { x: -120, y: -230 }, { x: 60, y: -230 },
    ...arc(250, 0, 230, -90, 90, 30),
    { x: 60, y: 230 }, { x: -120, y: 230 },
    ...arc(-250, 0, 230, 90, 270, 30),
  ],
  // Bean: a wide loop with a deep dip pinched into the bottom edge.
  kidney: [
    { x: -480, y: 0 }, { x: -380, y: -180 }, { x: -220, y: -235 }, { x: -60, y: -230 }, { x: 200, y: -240 },
    { x: 420, y: -170 }, { x: 480, y: 0 }, { x: 430, y: 170 }, { x: 300, y: 235 },
    ...arc(40, 300, 190, -30, -150, -30),
    { x: -260, y: 235 }, { x: -420, y: 180 },
  ],
  // Long top straight, a sweeping right-hand side, then a tight hairpin before the home bend.
  hairpin: [
    { x: -120, y: -230 }, { x: 320, y: -230 }, { x: 460, y: -150 }, { x: 470, y: 40 }, { x: 400, y: 220 },
    { x: 180, y: 240 }, { x: 10, y: 200 }, { x: -130, y: 110 },
    ...arc(-230, -10, 80, 0, -180, -45),
    ...arc(-395, 110, 85, 0, 180, 45),
    { x: -470, y: -90 }, { x: -380, y: -205 },
  ],
};

/** One point of the centerline, resampled at uniform arc length. */
export interface TrackPoint extends Vec {
  /** Heading in radians. */
  angle: number;
  /** Signed curvature (1/px). */
  k: number;
  /** Max safe speed here (px/s). */
  limit: number;
}

export interface Track {
  shape: TrackShape;
  pts: TrackPoint[];
  /** Lap length along the centerline. Every lane shares it so lanes are fair. */
  length: number;
  /** Signed sideways offset for each seat's lane. */
  laneOffsets: number[];
  /** Turbo pad as an s-range along the centerline. */
  padStart: number;
  padEnd: number;
  roadWidth: number;
}

const TRACK_SAMPLES = 720;
const STEPS_PER_SEG = 40;

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Centripetal Catmull-Rom through a closed polygon of control points (no cusps or overshoot). */
function sampleSpline(ctrl: readonly Vec[], steps: number): Vec[] {
  const n = ctrl.length;
  const out: Vec[] = [];
  const knot = (a: Vec, b: Vec): number => Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y));
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n]!;
    const p1 = ctrl[i]!;
    const p2 = ctrl[(i + 1) % n]!;
    const p3 = ctrl[(i + 2) % n]!;
    const t0 = 0;
    const t1 = t0 + knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    for (let j = 0; j < steps; j++) {
      const t = t1 + ((t2 - t1) * j) / steps;
      const lerp = (a: Vec, b: Vec, ta: number, tb: number): Vec => {
        const w = tb > ta ? (t - ta) / (tb - ta) : 0;
        return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
      };
      const a1 = lerp(p0, p1, t0, t1);
      const a2 = lerp(p1, p2, t1, t2);
      const a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2);
      const b2 = lerp(a2, a3, t1, t3);
      out.push(lerp(b1, b2, t1, t2));
    }
  }
  return out;
}

export function speedLimit(k: number): number {
  const ak = Math.abs(k);
  if (ak < 1e-6) return VMAX;
  return Math.min(VMAX, Math.sqrt(GRIP / ak));
}

/** Sideways offsets for `count` concentric lanes, one per seat. */
export function laneOffsets(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push((i - (count - 1) / 2) * LANE_GAP);
  return out;
}

/**
 * Build a track: spline centerline at (cx, cy) with `scale`, resampled at uniform arc length
 * with smoothed curvature and speed limits, plus a turbo pad on the longest straight away
 * from the start line.
 */
export function buildTrack(shape: TrackShape, cx: number, cy: number, scale: number, laneCount: number): Track {
  const ctrl = SHAPES[shape].map((p) => ({ x: cx + p.x * scale, y: cy + p.y * scale }));
  const raw = sampleSpline(ctrl, STEPS_PER_SEG);
  const m = raw.length;
  // Cumulative arc length of the raw samples.
  const cum: number[] = [0];
  for (let i = 1; i < m; i++) cum.push(cum[i - 1]! + Math.hypot(raw[i]!.x - raw[i - 1]!.x, raw[i]!.y - raw[i - 1]!.y));
  const length = cum[m - 1]! + Math.hypot(raw[0]!.x - raw[m - 1]!.x, raw[0]!.y - raw[m - 1]!.y);

  // Resample uniformly, then heading and curvature from the uniform samples.
  const n = TRACK_SAMPLES;
  const step = length / n;
  const pts: TrackPoint[] = [];
  let i = 0;
  for (let j = 0; j < n; j++) {
    const target = j * step;
    while (i + 1 < m && cum[i + 1]! <= target) i++;
    const a = raw[i]!;
    const b = raw[(i + 1) % m]!;
    const bs = i + 1 < m ? cum[i + 1]! : length;
    const f = bs > cum[i]! ? (target - cum[i]!) / (bs - cum[i]!) : 0;
    pts.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, angle: 0, k: 0, limit: VMAX });
  }
  for (let j = 0; j < n; j++) {
    const a = pts[(j - 1 + n) % n]!;
    const b = pts[(j + 1) % n]!;
    pts[j]!.angle = Math.atan2(b.y - a.y, b.x - a.x);
  }
  const rawK: number[] = [];
  for (let j = 0; j < n; j++) {
    const a = pts[(j - 1 + n) % n]!;
    const b = pts[(j + 1) % n]!;
    rawK.push(wrapAngle(b.angle - a.angle) / (2 * step));
  }
  const win = 6;
  for (let j = 0; j < n; j++) {
    let sum = 0;
    for (let d = -win; d <= win; d++) sum += rawK[(j + d + n) % n]!;
    const k = sum / (2 * win + 1);
    pts[j]!.k = k;
    pts[j]!.limit = speedLimit(k);
  }

  // Turbo pad: on the longest near-straight run that stays clear of the start line, placed so
  // there is still braking room between the pad and the next bend.
  const straightK = (GRIP / (VMAX * VMAX)) * 0.9;
  const guard = Math.floor(n * 0.12);
  let bestStart = -1;
  let bestLen = 0;
  let runStart = -1;
  for (let j = 0; j < n * 2; j++) {
    const idx = j % n;
    const nearStart = idx < guard || idx > n - guard;
    if (Math.abs(pts[idx]!.k) < straightK && !nearStart) {
      if (runStart < 0) runStart = j;
      const len = j - runStart + 1;
      if (len > bestLen && runStart < n) {
        bestLen = len;
        bestStart = runStart;
      }
    } else {
      runStart = -1;
    }
  }
  const room = Math.round((PAD_LEN / 2 + PAD_BRAKE_ROOM) / step);
  const padIdx = bestStart < 0 ? Math.floor(n / 2) : bestStart + Math.max(Math.floor(bestLen / 2), bestLen - room);
  const padMid = (padIdx % n) * step;

  return {
    shape,
    pts,
    length,
    laneOffsets: laneOffsets(laneCount),
    padStart: padMid - PAD_LEN / 2,
    padEnd: padMid + PAD_LEN / 2,
    roadWidth: (laneCount - 1) * LANE_GAP + 56,
  };
}

/** Interpolated centerline point at arc length s (wraps). */
export function trackAt(track: Track, s: number): TrackPoint {
  const n = track.pts.length;
  let u = (s % track.length) / track.length;
  if (u < 0) u += 1;
  const f = u * n;
  const i0 = Math.floor(f) % n;
  const i1 = (i0 + 1) % n;
  const t = f - Math.floor(f);
  const a = track.pts[i0]!;
  const b = track.pts[i1]!;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    angle: a.angle + wrapAngle(b.angle - a.angle) * t,
    k: a.k + (b.k - a.k) * t,
    limit: a.limit + (b.limit - a.limit) * t,
  };
}

/** Where a car sitting in the lane with sideways `offset` is drawn at arc length s. */
export function lanePos(track: Track, offset: number, s: number): { x: number; y: number; angle: number } {
  const p = trackAt(track, s);
  return { x: p.x - Math.sin(p.angle) * offset, y: p.y + Math.cos(p.angle) * offset, angle: p.angle };
}

/** Lowest speed limit between s and s + ahead. */
export function minLimitAhead(track: Track, s: number, ahead: number): number {
  let min = Infinity;
  const step = track.length / track.pts.length;
  for (let d = 0; d <= ahead; d += step) min = Math.min(min, trackAt(track, s + d).limit);
  return min;
}

export function onPad(track: Track, s: number): boolean {
  let u = s % track.length;
  if (u < 0) u += track.length;
  return u >= track.padStart && u <= track.padEnd;
}

export interface Car {
  s: number;
  v: number;
  throttle: boolean;
  /** Seconds of spin-out left (0 = driving). */
  spin: number;
  spinouts: number;
  lap: number;
  lapStart: number;
  bestLap: number | null;
  finished: boolean;
  /** 1-based finishing place, 0 while racing. */
  place: number;
  turboUsed: boolean;
}

export function newCar(): Car {
  return {
    s: 0, v: 0, throttle: false, spin: 0, spinouts: 0, lap: 0, lapStart: 0, bestLap: null,
    finished: false, place: 0, turboUsed: false,
  };
}

export type CarEvent = "spin" | "lap" | "turbo" | "finish";

/** Advance a car by dt seconds along its lane. `time` is the race clock, used for lap times. */
export function stepCar(car: Car, track: Track, dt: number, time: number): CarEvent[] {
  const events: CarEvent[] = [];
  if (car.finished) {
    car.v += (CRUISE_V - car.v) * Math.min(1, dt * 2);
    car.s = (car.s + car.v * dt) % track.length;
    return events;
  }
  if (car.spin > 0) {
    car.spin -= dt;
    if (car.spin <= 0) {
      car.spin = 0;
      car.v = RESUME_V;
    }
    return events;
  }
  if (car.throttle) {
    if (car.v < VMAX) car.v = Math.min(VMAX, car.v + ACCEL * dt);
    else car.v = Math.max(VMAX, car.v - TURBO_DECAY * dt);
  } else {
    car.v = Math.max(0, car.v - COAST_DECEL * dt);
  }
  const pad = onPad(track, car.s);
  if (pad && car.throttle && !car.turboUsed) {
    car.turboUsed = true;
    car.v = Math.min(TURBO_VMAX, car.v + TURBO_BOOST);
    events.push("turbo");
  }
  if (!pad) car.turboUsed = false;

  car.s += car.v * dt;
  if (car.s >= track.length) {
    car.s -= track.length;
    car.lap += 1;
    const lapTime = time - car.lapStart;
    if (car.bestLap === null || lapTime < car.bestLap) car.bestLap = lapTime;
    car.lapStart = time;
    events.push("lap");
    if (car.lap >= LAPS_TO_WIN) {
      car.finished = true;
      events.push("finish");
      return events;
    }
  }
  const here = trackAt(track, car.s);
  // Straights never spin you out, so a turbo over VMAX is safe until the next bend.
  if (car.v > here.limit && here.limit < VMAX) {
    car.spin = SPIN_S;
    car.spinouts += 1;
    car.v = 0;
    car.turboUsed = false;
    events.push("spin");
  }
  return events;
}

/** 0 = safe, 1 = at the limit (spin-out beyond). */
export function danger(car: Car, track: Track): number {
  const limit = trackAt(track, car.s).limit;
  return limit > 0 ? car.v / limit : 0;
}

/** Laps plus fraction of the current lap. Used for placing cars that didn't finish. */
export function progress(car: Car, track: Track): number {
  return car.lap + car.s / track.length;
}

export interface BotSkill {
  /** Fraction of the upcoming limit the bot is happy to carry (0.9 = cautious, 1 = reckless). */
  margin: number;
  /** Current noise added to the margin; re-rolled now and then. */
  noise: number;
  /** Momentary lapse: the bot looks less far ahead and pushes harder, so it may brake late into a bend. */
  lateBrake: boolean;
}

export function newBotSkill(rng: Rng): BotSkill {
  return { margin: rng.float(0.9, 0.96), noise: 0, lateBrake: false };
}

/** Re-roll the bot's momentary misjudgement (call every ~0.3s). */
export function rollBotNoise(skill: BotSkill, rng: Rng, lapseChance = 0.07): void {
  skill.noise = rng.float(-0.03, 0.03);
  skill.lateBrake = rng.next() < lapseChance;
}

/**
 * Hold the throttle unless the slowest point within the next speed*0.5s (plus a car length)
 * would be exceeded, after the bot's margin and noise are applied. Straights are always full throttle.
 */
export function botThrottle(car: Car, track: Track, skill: BotSkill): boolean {
  const ahead = car.v * BOT_LOOKAHEAD_S * (skill.lateBrake ? 0.3 : 1) + 40;
  const limit = minLimitAhead(track, car.s, ahead);
  if (limit >= VMAX) return true;
  return car.v < limit * (skill.margin + skill.noise + (skill.lateBrake ? 0.07 : 0));
}

/** Order the cars: finished by place, then the rest by progress. Returns car indices. */
export function standings(cars: readonly Car[], track: Track): number[] {
  return cars
    .map((_, i) => i)
    .sort((a, b) => {
      const ca = cars[a]!;
      const cb = cars[b]!;
      if (ca.finished && cb.finished) return ca.place - cb.place;
      if (ca.finished !== cb.finished) return ca.finished ? -1 : 1;
      return progress(cb, track) - progress(ca, track);
    });
}

export function pointsForPlace(place: number): number {
  return PLACE_POINTS[place - 1] ?? 0;
}

export function ordinal(place: number): string {
  const suffix = place === 1 ? "st" : place === 2 ? "nd" : place === 3 ? "rd" : "th";
  return `${place}${suffix}`;
}

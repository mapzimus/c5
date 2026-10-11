import type { Rng } from "../../core/rng";

/**
 * Pure rules for Slot Hop: closed-spline tracks with concentric slots, cars that move along their
 * slot, curvature speed limits, spin-outs, turbo pads, slot hopping, blocking/shunting in shared
 * slots, oil slicks dropped by finished "marshals", catch-up grip and the final-lap OVERDRIVE.
 * No canvas, no DOM. Distances are logical px, times are seconds.
 */

export type TrackShape = "oval" | "kidney" | "hairpin";
export const TRACK_SHAPES: readonly TrackShape[] = ["oval", "kidney", "hairpin"];

/** Distance between neighbouring slots. */
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
/** Over the top speed, speed bleeds back down at this rate. */
export const TURBO_DECAY = 120;
export const PAD_LEN = 150;
/** Straight road kept between the pad and the next bend so a boosted car can still brake. */
export const PAD_BRAKE_ROOM = 240;
/** After the winner finishes, everyone else has this long before being placed by progress. */
export const FINISH_GRACE_S = 8;
export const PLACE_POINTS: readonly number[] = [5, 3, 2, 1];
/** Finished cars (marshals) cruise around at this speed, immune to everything. */
export const CRUISE_V = 200;
/** Bots look this many seconds ahead (scaled by speed). */
export const BOT_LOOKAHEAD_S = 0.5;

/** Length of a car along its slot; two cars in one slot can't be closer than this. */
export const CAR_LEN = 34;
/** Hop animation length and the minimum time between hops. */
export const HOP_S = 0.22;
export const HOP_COOLDOWN_S = 0.45;
/** Share of the closing speed handed to the car in front when shunted, and kept by the shunter. */
export const BUMP_GIVE = 0.65;
export const BUMP_KEEP = 0.25;
/** Oil slicks: length along the track, lifetime, limit multiplier and marshal cooldown. */
export const OIL_LEN = 80;
export const OIL_LIFE_S = 4;
export const OIL_GRIP = 0.6;
export const OIL_COOLDOWN_S = 3;
/** Final lap: everyone's top speed and grip go up. */
export const OVERDRIVE_VMAX = 1.15;
export const OVERDRIVE_GRIP = 1.12;
/** Last place, at least this many laps behind the leader, gets extra top speed and grip. */
export const CATCHUP_GAP = 0.2;
export const CATCHUP_VMAX = 1.08;
export const CATCHUP_GRIP = 1.08;
/** Peaking above this fraction of the limit and surviving counts as a near miss. */
export const NEAR_MISS = 0.985;

export function lapsToWin(shape: TrackShape): number {
  return shape === "oval" ? 6 : 4;
}

/** Number of slots on the track: at least three so there is always somewhere to hop to. */
export function laneCountFor(players: number): number {
  return Math.max(3, players);
}

/** Starting slot for a seat: seats are spread across the slots. */
export function startLane(seat: number, players: number, lanes: number): number {
  if (players <= 1) return 0;
  return Math.round((seat * (lanes - 1)) / (players - 1));
}

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
  /** Max safe speed on the centerline here (px/s). */
  limit: number;
}

export interface Track {
  shape: TrackShape;
  pts: TrackPoint[];
  /** Lap length along the centerline. Progress is measured along it for every slot. */
  length: number;
  laneCount: number;
  /** Signed sideways offset for each slot, index 0 = innermost (shortest). */
  laneOffsets: number[];
  /** Physical length of each slot. */
  laneLengths: number[];
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

export function speedLimit(k: number, grip = 1, vmax = VMAX): number {
  const ak = Math.abs(k);
  if (ak < 1e-6) return vmax;
  return Math.min(vmax, Math.sqrt((GRIP * grip) / ak));
}

/** Sideways offsets for `count` concentric slots (unsorted, symmetric around the centerline). */
export function laneOffsets(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push((i - (count - 1) / 2) * LANE_GAP);
  return out;
}

/**
 * Build a track: spline centerline at (cx, cy) with `scale`, resampled at uniform arc length
 * with smoothed curvature and speed limits, slots sorted innermost first, plus a turbo pad on
 * the longest straight away from the start line.
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

  // Slots: a slot at sideways offset o covers (1 - k*o) px per centerline px, so the slot on the
  // inside of the bends is shorter. Sort innermost (shortest) first.
  const offsets = laneOffsets(laneCount)
    .map((o) => ({ o, len: pts.reduce((sum, p) => sum + Math.max(0.3, 1 - p.k * o) * step, 0) }))
    .sort((a, b) => a.len - b.len);

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
    laneCount,
    laneOffsets: offsets.map((l) => l.o),
    laneLengths: offsets.map((l) => l.len),
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

/** Where a car sitting in the slot with sideways `offset` is drawn at arc length s. */
export function lanePos(track: Track, offset: number, s: number): { x: number; y: number; angle: number } {
  const p = trackAt(track, s);
  return { x: p.x - Math.sin(p.angle) * offset, y: p.y + Math.cos(p.angle) * offset, angle: p.angle };
}

/** Signed distance along the track from a to b, in (-length/2, length/2]. */
export function wrapDist(track: Track, from: number, to: number): number {
  let d = (to - from) % track.length;
  if (d > track.length / 2) d -= track.length;
  if (d <= -track.length / 2) d += track.length;
  return d;
}

/** Slot px covered per centerline px at s for a slot. <1 inside a bend, >1 outside. */
export function laneFactor(track: Track, s: number, lane: number): number {
  return Math.max(0.3, 1 - trackAt(track, s).k * (track.laneOffsets[lane] ?? 0));
}

export function onPad(track: Track, s: number): boolean {
  let u = s % track.length;
  if (u < 0) u += track.length;
  return u >= track.padStart && u <= track.padEnd;
}

/** Oil slick dropped by a marshal, centred at s on every slot. */
export interface Oil {
  s: number;
  life: number;
  owner: number;
}

export function oilMul(track: Track, oils: readonly Oil[], s: number): number {
  for (const o of oils) if (Math.abs(wrapDist(track, s, o.s)) < OIL_LEN / 2) return OIL_GRIP;
  return 1;
}

/** Per-car rule modifiers: top speed and grip multipliers. */
export interface Mods {
  vmax: number;
  grip: number;
}

export const BASE_MODS: Mods = { vmax: 1, grip: 1 };

/**
 * Speed limit for a slot at s. A slot inside a bend has a tighter radius than the centerline
 * and so a lower limit; a slot outside has a higher one. Oil cuts it further. Returns the limit
 * and whether this is a "straight" (no bend limit), because straights never spin you out.
 */
export function limitAt(track: Track, oils: readonly Oil[], s: number, lane: number, mods: Mods = BASE_MODS): { limit: number; straight: boolean } {
  const p = trackAt(track, s);
  const f = Math.max(0.3, 1 - p.k * (track.laneOffsets[lane] ?? 0));
  const vmax = VMAX * mods.vmax;
  const bend = speedLimit(p.k / f, mods.grip, vmax);
  const oil = oilMul(track, oils, s);
  return { limit: bend * oil, straight: bend >= vmax && oil === 1 };
}

/** Lowest speed limit on a slot between s and s + ahead. */
export function minLimitAhead(track: Track, oils: readonly Oil[], lane: number, s: number, ahead: number, mods: Mods = BASE_MODS): number {
  let min = Infinity;
  const step = track.length / track.pts.length;
  for (let d = 0; d <= ahead; d += step) min = Math.min(min, limitAt(track, oils, s + d, lane, mods).limit);
  return min;
}

export interface Car {
  /** Progress along the centerline (px). */
  s: number;
  /** Speed along the slot (px/s). */
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
  lane: number;
  /** Slot the car is hopping from while hopT > 0. */
  laneFrom: number;
  hopT: number;
  hopCd: number;
  hops: number;
  /** Highest danger reached in the current bend (for near-miss detection). */
  peak: number;
  nearMisses: number;
  bumpCd: number;
  /** Marshal oil cooldown. */
  oilCd: number;
  oilsDropped: number;
  catchUp: boolean;
  /** Set when the car spun this lap; cleared on the line. */
  spunThisLap: boolean;
  cleanLaps: number;
}

export function newCar(lane = 0): Car {
  return {
    s: 0, v: 0, throttle: false, spin: 0, spinouts: 0, lap: 0, lapStart: 0, bestLap: null,
    finished: false, place: 0, turboUsed: false, lane, laneFrom: lane, hopT: 0, hopCd: 0, hops: 0,
    peak: 0, nearMisses: 0, bumpCd: 0, oilCd: 0, oilsDropped: 0, catchUp: false, spunThisLap: false, cleanLaps: 0,
  };
}

export type EventType = "spin" | "lap" | "cleanlap" | "turbo" | "finish" | "hop" | "noroom" | "bump" | "nearmiss" | "overdrive" | "oil";

export interface RaceEvent {
  type: EventType;
  /** Car index the event belongs to. */
  car: number;
  /** The other car for bumps (the one shunted). */
  other?: number;
}

export interface Race {
  track: Track;
  cars: Car[];
  oils: Oil[];
  time: number;
  overdrive: boolean;
  laps: number;
}

export function newRace(track: Track, cars: Car[]): Race {
  return { track, cars, oils: [], time: 0, overdrive: false, laps: lapsToWin(track.shape) };
}

export function carMods(race: Race, i: number): Mods {
  const car = race.cars[i]!;
  let vmax = 1;
  let grip = 1;
  if (race.overdrive) {
    vmax *= OVERDRIVE_VMAX;
    grip *= OVERDRIVE_GRIP;
  }
  if (car.catchUp) {
    vmax *= CATCHUP_VMAX;
    grip *= CATCHUP_GRIP;
  }
  return { vmax, grip };
}

/** Laps plus fraction of the current lap. Used for placing cars that didn't finish. */
export function progress(car: Car, track: Track): number {
  return car.lap + car.s / track.length;
}

function racing(car: Car): boolean {
  return !car.finished && car.spin <= 0;
}

/** Is a racing car (other than `except`) sitting in `lane` within `margin` px of s? */
export function occupied(race: Race, lane: number, s: number, margin: number, except = -1): number {
  for (let j = 0; j < race.cars.length; j++) {
    if (j === except) continue;
    const c = race.cars[j]!;
    if (!racing(c) || c.lane !== lane) continue;
    if (Math.abs(wrapDist(race.track, s, c.s)) < margin) return j;
  }
  return -1;
}

/** Hop one slot in (-1) or out (+1). Fails when there is no slot, on cooldown, or no room. */
export function hopCar(race: Race, i: number, dir: -1 | 1): "hop" | "noroom" | null {
  const car = race.cars[i]!;
  if (!racing(car) || car.hopCd > 0) return null;
  const target = car.lane + dir;
  if (target < 0 || target >= race.track.laneCount) return null;
  if (occupied(race, target, car.s, CAR_LEN * 1.3, i) >= 0) {
    car.hopCd = 0.2;
    return "noroom";
  }
  car.laneFrom = car.lane;
  car.lane = target;
  car.hopT = HOP_S;
  car.hopCd = HOP_COOLDOWN_S;
  car.hops += 1;
  return "hop";
}

/** A finished car (marshal) drops an oil slick where it is. */
export function dropOil(race: Race, i: number): boolean {
  const car = race.cars[i]!;
  if (!car.finished || car.oilCd > 0) return false;
  race.oils.push({ s: car.s, life: OIL_LIFE_S, owner: i });
  car.oilCd = OIL_COOLDOWN_S;
  car.oilsDropped += 1;
  return true;
}

/** Spin the car if it is over the limit of its slot here. Straights never spin you out. */
function checkSpin(race: Race, i: number, events: RaceEvent[]): void {
  const car = race.cars[i]!;
  if (!racing(car)) return;
  const mods = carMods(race, i);
  const { limit, straight } = limitAt(race.track, race.oils, car.s, car.lane, mods);
  if (straight) {
    if (car.peak >= NEAR_MISS) {
      car.nearMisses += 1;
      events.push({ type: "nearmiss", car: i });
    }
    car.peak = 0;
    return;
  }
  const d = car.v / limit;
  if (d > 1) {
    car.spin = SPIN_S;
    car.spinouts += 1;
    car.spunThisLap = true;
    car.v = 0;
    car.turboUsed = false;
    car.peak = 0;
    car.hopT = 0;
    events.push({ type: "spin", car: i });
    return;
  }
  if (d > car.peak) car.peak = d;
  else if (d < 0.75) {
    if (car.peak >= NEAR_MISS) {
      car.nearMisses += 1;
      events.push({ type: "nearmiss", car: i });
    }
    car.peak = 0;
  }
}

function stepCar(race: Race, i: number, dt: number, events: RaceEvent[]): void {
  const car = race.cars[i]!;
  const track = race.track;
  car.hopCd = Math.max(0, car.hopCd - dt);
  car.bumpCd = Math.max(0, car.bumpCd - dt);
  car.oilCd = Math.max(0, car.oilCd - dt);
  if (car.hopT > 0) car.hopT = Math.max(0, car.hopT - dt);
  if (car.finished) {
    car.v += (CRUISE_V - car.v) * Math.min(1, dt * 2);
    car.s = (car.s + car.v * dt) % track.length;
    return;
  }
  if (car.spin > 0) {
    car.spin -= dt;
    if (car.spin <= 0) {
      car.spin = 0;
      car.v = RESUME_V;
    }
    return;
  }
  const mods = carMods(race, i);
  const vmax = VMAX * mods.vmax;
  if (car.throttle) {
    if (car.v < vmax) car.v = Math.min(vmax, car.v + ACCEL * dt);
    else car.v = Math.max(vmax, car.v - TURBO_DECAY * dt);
  } else {
    car.v = Math.max(0, car.v - COAST_DECEL * dt);
  }
  const pad = onPad(track, car.s);
  if (pad && car.throttle && !car.turboUsed) {
    car.turboUsed = true;
    car.v = Math.min(TURBO_VMAX * mods.vmax, car.v + TURBO_BOOST);
    events.push({ type: "turbo", car: i });
  }
  if (!pad) car.turboUsed = false;

  // Slot speed -> centerline progress: the inside slot covers less road per centerline px.
  car.s += (car.v * dt) / laneFactor(track, car.s, car.lane);
  if (car.s >= track.length) {
    car.s -= track.length;
    car.lap += 1;
    const lapTime = race.time - car.lapStart;
    if (car.bestLap === null || lapTime < car.bestLap) car.bestLap = lapTime;
    car.lapStart = race.time;
    events.push({ type: "lap", car: i });
    if (!car.spunThisLap) {
      car.cleanLaps += 1;
      events.push({ type: "cleanlap", car: i });
    } else car.cleanLaps = 0;
    car.spunThisLap = false;
    if (car.lap >= race.laps) {
      car.finished = true;
      car.catchUp = false;
      events.push({ type: "finish", car: i });
      return;
    }
  }
  checkSpin(race, i, events);
}

/** Cars sharing a slot can't pass through each other: the one behind is held, and shunts the one in front. */
function resolveBlocking(race: Race, events: RaceEvent[]): void {
  const track = race.track;
  const cars = race.cars;
  for (let a = 0; a < cars.length; a++) {
    const A = cars[a]!;
    if (!racing(A)) continue;
    let nearest = -1;
    let gap = Infinity;
    for (let b = 0; b < cars.length; b++) {
      if (b === a) continue;
      const B = cars[b]!;
      if (!racing(B) || B.lane !== A.lane) continue;
      const d = wrapDist(track, A.s, B.s);
      if (d > 0 && d < gap) {
        gap = d;
        nearest = b;
      }
    }
    if (nearest < 0 || gap >= CAR_LEN) continue;
    const B = cars[nearest]!;
    if (A.v > B.v) {
      const closing = A.v - B.v;
      const bv = B.v;
      B.v = bv + closing * BUMP_GIVE;
      A.v = bv + closing * BUMP_KEEP;
      if (A.bumpCd <= 0) {
        A.bumpCd = 0.4;
        events.push({ type: "bump", car: a, other: nearest });
      }
    }
    A.s = B.s - CAR_LEN;
    if (A.s < 0) A.s += track.length;
    checkSpin(race, a, events);
    checkSpin(race, nearest, events);
  }
}

/** Last place, well behind the leader, gets catch-up grip and speed. */
function updateCatchUp(race: Race): void {
  const live = race.cars.filter((c) => !c.finished);
  for (const c of race.cars) c.catchUp = false;
  if (live.length < 2) return;
  let lead = -Infinity;
  let last: Car | null = null;
  let lastProg = Infinity;
  for (const c of live) {
    const p = progress(c, race.track);
    if (p > lead) lead = p;
    if (p < lastProg) {
      lastProg = p;
      last = c;
    }
  }
  if (last && lead - lastProg >= CATCHUP_GAP) last.catchUp = true;
}

/** Advance the whole race by dt seconds. Throttles must already be set on the cars. */
export function stepRace(race: Race, dt: number): RaceEvent[] {
  const events: RaceEvent[] = [];
  race.time += dt;
  for (const o of race.oils) o.life -= dt;
  race.oils = race.oils.filter((o) => o.life > 0);
  for (let i = 0; i < race.cars.length; i++) stepCar(race, i, dt, events);
  resolveBlocking(race, events);
  updateCatchUp(race);
  if (!race.overdrive && race.cars.some((c) => c.lap >= race.laps - 1)) {
    race.overdrive = true;
    events.push({ type: "overdrive", car: -1 });
  }
  return events;
}

/** 0 = safe, 1 = at the limit (spin-out beyond). Turbo on a straight never reads as danger. */
export function danger(race: Race, i: number): number {
  const car = race.cars[i]!;
  if (car.finished) return 0;
  const { limit, straight } = limitAt(race.track, race.oils, car.s, car.lane, carMods(race, i));
  if (limit <= 0) return 0;
  const d = car.v / limit;
  return straight ? Math.min(0.5, d * 0.5) : d;
}

export interface BotSkill {
  /** Fraction of the upcoming limit the bot is happy to carry (0.9 = cautious, 1 = reckless). */
  margin: number;
  /** Current noise added to the margin; re-rolled now and then. */
  noise: number;
  /** Momentary lapse: the bot looks less far ahead and pushes harder, so it may brake late into a bend. */
  lateBrake: boolean;
  /** How keen the bot is to dive for the short inside slot. */
  greed: number;
  /** Rolled each tick from greed: wants the inside slot right now. */
  greedy: boolean;
  /** Rolled each tick: will bail out to a wider slot when about to spin. */
  willSave: boolean;
}

export function newBotSkill(rng: Rng): BotSkill {
  return { margin: rng.float(0.9, 0.96), noise: 0, lateBrake: false, greed: rng.float(0.25, 0.7), greedy: false, willSave: false };
}

/** Re-roll the bot's momentary misjudgement (call every ~0.3s). */
export function rollBotNoise(skill: BotSkill, rng: Rng, lapseChance = 0.045): void {
  skill.noise = rng.float(-0.03, 0.03);
  skill.lateBrake = rng.next() < lapseChance;
  skill.greedy = rng.next() < skill.greed;
  skill.willSave = rng.next() < 0.6;
}

/**
 * Hold the throttle unless the slowest point of the slot within the next speed*0.5s (plus a car
 * length) would be exceeded, after the bot's margin and noise are applied. Straights are full throttle.
 */
export function botThrottle(race: Race, i: number, skill: BotSkill): boolean {
  const car = race.cars[i]!;
  const mods = carMods(race, i);
  const ahead = car.v * BOT_LOOKAHEAD_S * (skill.lateBrake ? 0.4 : 1) + 40;
  const limit = minLimitAhead(race.track, race.oils, car.lane, car.s, ahead, mods);
  if (limit >= VMAX * mods.vmax) return true;
  return car.v < limit * (skill.margin + skill.noise + (skill.lateBrake ? 0.06 : 0));
}

/**
 * Which way a bot wants to hop right now, if at all: out to escape a slower car ahead or to save
 * a bend it's too fast for, in to grab the short inside slot on a straight.
 */
export function botHop(race: Race, i: number, skill: BotSkill): -1 | 0 | 1 {
  const car = race.cars[i]!;
  if (!racing(car) || car.hopCd > 0) return 0;
  const track = race.track;
  const mods = carMods(race, i);
  const vmax = VMAX * mods.vmax;
  const ahead = car.v * 0.6 + 40;
  const free = (lane: number): boolean =>
    lane >= 0 && lane < track.laneCount && occupied(race, lane, car.s, CAR_LEN * 2, i) < 0;
  const fits = (lane: number, margin: number): boolean =>
    minLimitAhead(track, race.oils, lane, car.s, ahead, mods) >= car.v * margin;

  // Blocked: a slower car close ahead in my slot.
  for (let j = 0; j < race.cars.length; j++) {
    if (j === i) continue;
    const other = race.cars[j]!;
    if (!racing(other) || other.lane !== car.lane) continue;
    const d = wrapDist(track, car.s, other.s);
    if (d > 0 && d < car.v * 0.6 + CAR_LEN * 2 && other.v < car.v + 10) {
      const inner = car.lane - 1;
      const outer = car.lane + 1;
      if (free(inner) && fits(inner, 0.95)) return -1;
      if (free(outer) && fits(outer, 0.9)) return 1;
      return 0;
    }
  }
  // Bail out: about to exceed my slot's limit; a neighbouring slot with a wider line would hold.
  // (Which neighbour is wider depends on the bend: the short slot is outside the bends that turn
  // against the loop.)
  const soon = minLimitAhead(track, race.oils, car.lane, car.s, car.v * 0.18 + 20, mods);
  if (soon < vmax && car.v > soon * 0.99 && skill.willSave) {
    for (const dir of [1, -1] as const) {
      const lane = car.lane + dir;
      if (free(lane) && fits(lane, 0.97)) return dir;
    }
  }
  // Greed: dive for the inside on a straight when it is clear and the next bend allows my speed.
  if (skill.greedy && car.lane > 0) {
    const inner = car.lane - 1;
    if (free(inner) && fits(inner, 1) && minLimitAhead(track, race.oils, car.lane, car.s, 60, mods) >= vmax) return -1;
  }
  return 0;
}

/** A bot marshal drops oil when a racing car is about to reach its ghost. */
export function botWantsOil(race: Race, i: number): boolean {
  const ghost = race.cars[i]!;
  if (!ghost.finished || ghost.oilCd > 0) return false;
  for (let j = 0; j < race.cars.length; j++) {
    const c = race.cars[j]!;
    if (j === i || c.finished || c.v < 60) continue;
    const d = wrapDist(race.track, c.s, ghost.s);
    if (d > c.v * 0.5 && d < c.v * 1.2) return true;
  }
  return false;
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

/** Lap record score: higher is better, so it fits saveBest. */
export function lapScore(lapTime: number): number {
  return Math.max(1, Math.round(100000 - lapTime * 100));
}

export function lapFromScore(score: number): number {
  return (100000 - score) / 100;
}

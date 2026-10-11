import type { Rng } from "../../core/rng";

/**
 * Pure rules and physics for Sumo Rings ("Tilt Sumo"). No canvas, no DOM.
 * Units: logical pixels, seconds. Positive y is down.
 *
 * The platform is a disc balanced on a pivot: the combined weight of every ball on it
 * (and every fallen player hanging on the rim) tips it, and everyone slides downhill.
 */

export const BALL_R = 40;
export const UNDERDOG_R = 46;
export const MAX_ROUNDS = 4;
export const SHRINK_EVERY_S = 7;
export const SHRINK_FACTOR = 0.84;
/** Round time at which OVERDRIVE starts: the ring shrinks continuously and the tilt bites harder. */
export const OVERDRIVE_AT_S = 18;
export const OVERDRIVE_SHRINK_PX_S = 24;
export const OVERDRIVE_TILT_GAIN = 1.5;
/** Safety cap: a round that somehow never resolves ends with no winner. */
export const ROUND_CAP_S = 36;
/** Drag distance (px) for full stick force. */
export const STICK_MAX = 90;
/** Steering acceleration at full force. */
export const ACCEL = 950;
export const MAX_SPEED = 500;
/** Fraction of velocity kept per second. */
export const FRICTION = 0.08;
export const ICE_FRICTION = 0.93;
/** Steering accel multiplier on ice (you slide, you don't grip). */
export const ICE_TRACTION = 0.35;
export const WIND_ACCEL = 700;
export const SPIN_RATE = 1.7;
export const SPIN_KNOCK = 540;
export const BAR_HALF_W = 14;
export const FALL_S = 0.6;

/** Downhill acceleration at full tilt. */
export const TILT_ACCEL = 330;
/** How much a rim rider weighs relative to a ball at the very edge. */
export const GHOST_WEIGHT = 1.3;
export const GHOST_STOMP_WEIGHT = 2.6;
export const GHOST_STOMP_S = 0.7;
export const GHOST_STOMP_COOLDOWN_S = 2.4;
/** Max angular speed of a rim rider (rad/s). */
export const GHOST_TURN_RATE = 1.9;

export const SLAM_SPEED = 800;
export const SLAM_S = 0.25;
/** Velocity kept when a slam ends: the lunge spends its momentum. */
export const SLAM_BRAKE = 0.5;
/** Roughly how far a slam carries a ball, for bots judging whether they would fly off. */
export const SLAM_REACH = 240;
export const SLAM_RECHARGE_S = 2.6;
/** Mass multiplier while slamming. */
export const SLAM_MASS = 1.7;
/** A press shorter than this with less than TAP_MAX_PX of drag is a tap (slam / stomp). */
export const TAP_MAX_S = 0.22;
export const TAP_MAX_PX = 16;

export const WIN_POINTS = 2;
export const BUMP_POINTS = 1;
export const FINAL_MULT = 2;

/** A live ball closer than this to the rim is in danger; back inside EDGE_SAFE_PX and it was an EDGE SAVE. */
export const EDGE_DANGER_PX = 14;
export const EDGE_SAFE_PX = 50;

export type Hazard = "none" | "ice" | "spinner" | "gust";
export const HAZARDS: readonly Hazard[] = ["ice", "spinner", "gust"];

export interface Vec {
  x: number;
  y: number;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  mass: number;
  alive: boolean;
  /** 0..1 fall animation progress once dead. */
  fall: number;
  /** Slam charge 0..1; a slam needs a full charge. */
  slam: number;
  /** Seconds of slam left (0 = not slamming). */
  slamming: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A weight pressing on the platform: a live ball or a rim rider. */
export interface Weight {
  x: number;
  y: number;
  w: number;
}

export function makeBall(x: number, y: number, r = BALL_R): Ball {
  return { x, y, vx: 0, vy: 0, r, mass: r * r, alive: true, fall: 0, slam: 1, slamming: 0 };
}

/** Virtual stick: origin at the touch-down point, drag sets direction and force (0..1). */
export function stick(ox: number, oy: number, x: number, y: number, max = STICK_MAX): { dir: Vec; force: number } {
  const dx = x - ox;
  const dy = y - oy;
  const d = Math.hypot(dx, dy);
  if (d < 1) return { dir: { x: 0, y: 0 }, force: 0 };
  return { dir: { x: dx / d, y: dy / d }, force: Math.min(1, d / max) };
}

/** A quick, still press is a tap. */
export function isTap(heldS: number, movedPx: number): boolean {
  return heldS <= TAP_MAX_S && movedPx <= TAP_MAX_PX;
}

/** Push a ball with its stick. `traction` scales the accel (ice). */
export function applySteer(b: Ball, dir: Vec, force: number, dt: number, traction = 1): void {
  if (!b.alive || force <= 0) return;
  b.vx += dir.x * force * ACCEL * traction * dt;
  b.vy += dir.y * force * ACCEL * traction * dt;
}

/** Integrate one step: friction, speed cap, move. Dead balls keep drifting while they fall. */
export function integrate(b: Ball, dt: number, friction = FRICTION, maxSpeed = MAX_SPEED): void {
  if (b.alive) {
    const keep = Math.pow(friction, dt);
    b.vx *= keep;
    b.vy *= keep;
    const cap = b.slamming > 0 ? Math.max(maxSpeed, SLAM_SPEED) : maxSpeed;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > cap) {
      b.vx *= cap / sp;
      b.vy *= cap / sp;
    }
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
}

/** Fire a slam: a burst of speed and extra mass in `dir`. Returns false when not charged. */
export function startSlam(b: Ball, dir: Vec): boolean {
  if (!b.alive || b.slam < 1) return false;
  const d = Math.hypot(dir.x, dir.y);
  if (d < 1e-6) return false;
  b.vx = (dir.x / d) * SLAM_SPEED;
  b.vy = (dir.y / d) * SLAM_SPEED;
  b.slam = 0;
  b.slamming = SLAM_S;
  b.mass = b.r * b.r * SLAM_MASS;
  return true;
}

/** Tick slam timers: recharge, and drop the extra mass when the slam ends. */
export function tickSlam(b: Ball, dt: number): void {
  if (!b.alive) return;
  if (b.slamming > 0) {
    b.slamming = Math.max(0, b.slamming - dt);
    if (b.slamming === 0) {
      b.mass = b.r * b.r;
      b.vx *= SLAM_BRAKE;
      b.vy *= SLAM_BRAKE;
    }
  } else {
    b.slam = Math.min(1, b.slam + dt / SLAM_RECHARGE_S);
  }
}

/**
 * Elastic circle collision with mass. Separates the pair and exchanges momentum.
 * Returns the impulse magnitude (0 when no bounce happened).
 */
export function collidePair(a: Ball, b: Ball, restitution = 0.88): number {
  if (!a.alive || !b.alive) return 0;
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let d = Math.hypot(dx, dy);
  const minD = a.r + b.r;
  if (d >= minD) return 0;
  if (d < 1e-6) {
    dx = 1;
    dy = 0;
    d = 1;
  }
  const nx = dx / d;
  const ny = dy / d;
  const total = a.mass + b.mass;
  const overlap = minD - d;
  a.x -= nx * overlap * (b.mass / total);
  a.y -= ny * overlap * (b.mass / total);
  b.x += nx * overlap * (a.mass / total);
  b.y += ny * overlap * (a.mass / total);
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rel > 0) return 0;
  const j = (-(1 + restitution) * rel) / (1 / a.mass + 1 / b.mass);
  a.vx -= (j / a.mass) * nx;
  a.vy -= (j / a.mass) * ny;
  b.vx += (j / b.mass) * nx;
  b.vy += (j / b.mass) * ny;
  return j;
}

/** Spinning bar through (cx, cy) at `angle`. Knocks the ball away and returns true on a hit. */
export function spinnerCollide(
  b: Ball, cx: number, cy: number, angle: number, halfLen: number, halfW = BAR_HALF_W, omega = SPIN_RATE, knock = SPIN_KNOCK,
): boolean {
  if (!b.alive) return false;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const rx = b.x - cx;
  const ry = b.y - cy;
  const t = Math.max(-halfLen, Math.min(halfLen, rx * ux + ry * uy));
  const px = cx + ux * t;
  const py = cy + uy * t;
  let nx = b.x - px;
  let ny = b.y - py;
  let d = Math.hypot(nx, ny);
  const minD = b.r + halfW;
  if (d >= minD) return false;
  if (d < 1e-6) {
    // Dead centre: shove along the bar's leading edge.
    nx = -uy;
    ny = ux;
    d = 1;
  }
  nx /= d;
  ny /= d;
  b.x = px + nx * minD;
  b.y = py + ny * minD;
  // Surface velocity of the bar at the contact point.
  const sx = -omega * (py - cy);
  const sy = omega * (px - cx);
  const vn = b.vx * nx + b.vy * ny;
  if (vn < knock) {
    b.vx += nx * (knock - vn);
    b.vy += ny * (knock - vn);
  }
  b.vx += sx * 0.6;
  b.vy += sy * 0.6;
  return true;
}

/** A ball is out once its centre leaves the platform. */
export function outside(b: Ball, cx: number, cy: number, ringR: number): boolean {
  return Math.hypot(b.x - cx, b.y - cy) > ringR;
}

/**
 * Tilt of the platform from the weights on it: a unit-capped vector pointing downhill.
 * A ball's lever arm is its offset from the pivot over the ring radius, so opposite
 * weights cancel and a crowd on one side tips it. `seats` normalises for the table size.
 */
export function computeTilt(weights: readonly Weight[], cx: number, cy: number, ringR: number, seats: number): Vec {
  let x = 0;
  let y = 0;
  const div = Math.max(2, seats) * Math.max(1, ringR);
  for (const w of weights) {
    x += ((w.x - cx) * w.w) / div;
    y += ((w.y - cy) * w.w) / div;
  }
  const m = Math.hypot(x, y);
  if (m > 1) {
    x /= m;
    y /= m;
  }
  return { x, y };
}

/** Slide every live ball downhill. */
export function applyTilt(b: Ball, tilt: Vec, dt: number, gain = 1): void {
  if (!b.alive) return;
  b.vx += tilt.x * TILT_ACCEL * gain * dt;
  b.vy += tilt.y * TILT_ACCEL * gain * dt;
}

/** Signed shortest angular difference b - a in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d <= -Math.PI) d += Math.PI * 2;
  if (d > Math.PI) d -= Math.PI * 2;
  return d;
}

/** Move a rim rider's angle toward `target` at most `rate * dt` radians. */
export function turnToward(current: number, target: number, rate: number, dt: number): number {
  const d = angleDelta(current, target);
  const step = Math.min(Math.abs(d), rate * dt);
  return current + Math.sign(d) * step;
}

/** Start spots: evenly spread on a circle at 55% of the platform radius. */
export function startPositions(n: number, cx: number, cy: number, ringR: number): Vec[] {
  const out: Vec[] = [];
  const d = ringR * 0.55;
  for (let i = 0; i < n; i++) {
    const a = Math.PI + (i * Math.PI * 2) / n + (n === 2 ? 0 : Math.PI / 4);
    out.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d });
  }
  return out;
}

/** Touch pads per seat: 2 players share the bottom (left/right), 3-4 take the four corners. */
export function padZones(n: number, w: number, h: number): Rect[] {
  if (n <= 2) {
    return Array.from({ length: n }, (_, i) => ({ x: (i * w) / 2, y: h / 2, w: w / 2, h: h / 2 }));
  }
  return Array.from({ length: n }, (_, i) => ({
    x: (i % 2) * (w / 2), y: Math.floor(i / 2) * (h / 2), w: w / 2, h: h / 2,
  }));
}

export function inRect(p: Vec, r: Rect): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

/**
 * Bot steering: head for the nearest opponent while near the centre, head for the centre
 * when near the edge, and lean uphill against the tilt the closer to the edge it gets.
 * `noise` is the max heading wobble in radians.
 */
export function botSteer(
  me: Ball, others: readonly Ball[], cx: number, cy: number, ringR: number, rng: Rng, noise = 0.7, tilt: Vec = { x: 0, y: 0 },
): Vec {
  const dist = Math.hypot(me.x - cx, me.y - cy);
  let tx = cx;
  let ty = cy;
  if (dist < ringR * 0.5) {
    let best: Ball | null = null;
    let bestD = Infinity;
    for (const o of others) {
      if (!o.alive || o === me) continue;
      const d = Math.hypot(o.x - me.x, o.y - me.y);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (best) {
      tx = best.x;
      ty = best.y;
    }
  }
  const a = Math.atan2(ty - me.y, tx - me.x) + (rng.next() - 0.5) * 2 * noise;
  const lean = 0.5 + 1.3 * Math.min(1, dist / ringR);
  const x = Math.cos(a) - tilt.x * lean;
  const y = Math.sin(a) - tilt.y * lean;
  const m = Math.hypot(x, y) || 1;
  return { x: x / m, y: y / m };
}

/**
 * Should a bot slam now? Needs a charge, a target within reach roughly along `heading`,
 * and (unless reckless) a landing spot still on the platform. Returns the aim direction or null.
 */
export function botSlamAim(
  me: Ball, others: readonly Ball[], heading: Vec, cx: number, cy: number, ringR: number, reckless = false,
): Vec | null {
  if (!me.alive || me.slam < 1) return null;
  let best: Vec | null = null;
  let bestD = 220;
  for (const o of others) {
    if (!o.alive || o === me) continue;
    const dx = o.x - me.x;
    const dy = o.y - me.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d >= bestD) continue;
    const dot = (dx / d) * heading.x + (dy / d) * heading.y;
    if (dot < 0.6) continue;
    const land = Math.hypot(me.x + (dx / d) * SLAM_REACH - cx, me.y + (dy / d) * SLAM_REACH - cy);
    if (!reckless && land > ringR * 0.8) continue;
    bestD = d;
    best = { x: dx / d, y: dy / d };
  }
  return best;
}

/**
 * Where a rim rider wants to sit: under the live ball with the most points (ties: the one
 * nearest the edge), so the ring tips toward the leader. Returns null with nobody alive.
 */
export function ghostTarget(balls: readonly Ball[], points: readonly number[], cx: number, cy: number): number | null {
  let best = -1;
  let bestPts = -Infinity;
  let bestDist = -1;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i]!;
    if (!b.alive) continue;
    const pts = points[i] ?? 0;
    const dist = Math.hypot(b.x - cx, b.y - cy);
    if (pts > bestPts || (pts === bestPts && dist > bestDist)) {
      best = i;
      bestPts = pts;
      bestDist = dist;
    }
  }
  if (best < 0) return null;
  const b = balls[best]!;
  return Math.atan2(b.y - cy, b.x - cx);
}

/** The match is a fixed number of rounds. */
export function matchOver(roundsPlayed: number): boolean {
  return roundsPlayed >= MAX_ROUNDS;
}

/** Points multiplier: the final round pays double. */
export function roundMultiplier(roundIndex: number): number {
  return roundIndex >= MAX_ROUNDS - 1 ? FINAL_MULT : 1;
}

/** Seats with the fewest points get the underdog ball in the final; nobody when all are level. */
export function underdogs(points: readonly number[]): number[] {
  if (points.length === 0) return [];
  const min = Math.min(...points);
  const max = Math.max(...points);
  if (min === max) return [];
  return points.map((p, i) => (p === min ? i : -1)).filter((i) => i >= 0);
}

/** Round 1 is plain so everyone learns the tilt; each later round rolls a different hazard. */
export function planHazards(rng: Rng, rounds = MAX_ROUNDS): Hazard[] {
  const out: Hazard[] = ["none"];
  while (out.length < rounds) {
    const bag = [...HAZARDS];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      const t = bag[i]!;
      bag[i] = bag[j]!;
      bag[j] = t;
    }
    out.push(...bag);
  }
  return out.slice(0, rounds);
}

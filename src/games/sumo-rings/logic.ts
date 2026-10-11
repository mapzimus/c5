import type { Rng } from "../../core/rng";

/**
 * Pure rules and physics for Sumo Rings. No canvas, no DOM.
 * Units: logical pixels, seconds. Positive y is down.
 */

export const BALL_R = 40;
export const WINS_NEEDED = 2;
export const MAX_ROUNDS = 5;
export const SHRINK_EVERY_S = 10;
export const SHRINK_FACTOR = 0.85;
/** Drag distance (px) for full stick force. */
export const STICK_MAX = 90;
/** Steering acceleration at full force. */
export const ACCEL = 1100;
export const MAX_SPEED = 560;
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

export type Hazard = "ice" | "spinner" | "gust";
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
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function makeBall(x: number, y: number, r = BALL_R): Ball {
  return { x, y, vx: 0, vy: 0, r, mass: r * r, alive: true, fall: 0 };
}

/** Virtual stick: origin at the touch-down point, drag sets direction and force (0..1). */
export function stick(ox: number, oy: number, x: number, y: number, max = STICK_MAX): { dir: Vec; force: number } {
  const dx = x - ox;
  const dy = y - oy;
  const d = Math.hypot(dx, dy);
  if (d < 1) return { dir: { x: 0, y: 0 }, force: 0 };
  return { dir: { x: dx / d, y: dy / d }, force: Math.min(1, d / max) };
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
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > maxSpeed) {
      b.vx *= maxSpeed / sp;
      b.vy *= maxSpeed / sp;
    }
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
}

/**
 * Elastic circle collision with mass. Separates the pair and exchanges momentum.
 * Returns the impulse magnitude (0 when no bounce happened).
 */
export function collidePair(a: Ball, b: Ball, restitution = 0.96): number {
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
 * when near the edge. `noise` is the max heading wobble in radians.
 */
export function botSteer(me: Ball, others: readonly Ball[], cx: number, cy: number, ringR: number, rng: Rng, noise = 0.7): Vec {
  const dist = Math.hypot(me.x - cx, me.y - cy);
  let tx = cx;
  let ty = cy;
  if (dist < ringR * 0.55) {
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
  return { x: Math.cos(a), y: Math.sin(a) };
}

/** Match ends at 2 round wins or after 5 rounds. */
export function matchOver(wins: readonly number[], roundsPlayed: number): boolean {
  return wins.some((w) => w >= WINS_NEEDED) || roundsPlayed >= MAX_ROUNDS;
}

/** Hazard per round: a shuffled cycle so the three show up before any repeats. */
export function planHazards(rng: Rng, rounds = MAX_ROUNDS): Hazard[] {
  const out: Hazard[] = [];
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

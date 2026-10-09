/** Tiny top-down puck physics: sliding discs, static pegs, walls, and a swirl that curves paths. */

export type PuckKind = "normal" | "heavy" | "bomb" | "sticky" | "splitter" | "mini";

export interface Puck {
  id: number;
  owner: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** Defaults to 1. Heavy pucks shove, minis get shoved. */
  mass?: number;
  /** Sticky pucks glue down once slow: puck hits can't move them (blasts can). */
  anchored?: boolean;
  kind?: PuckKind;
}

/** A body that moves on its own path and shoves pucks aside (flying cows). */
export interface Kinematic {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

export interface Peg {
  x: number;
  y: number;
  r: number;
}

export interface Swirl {
  x: number;
  y: number;
  radius: number;
  /** rad/s the velocity vector turns at the swirl's centre. Sign = direction. */
  spin: number;
}

export interface World {
  width: number;
  height: number;
  pucks: Puck[];
  pegs: Peg[];
  swirl: Swirl;
}

export const PUCK_RADIUS = 18;
export const REST_SPEED = 10;
const LINEAR_DRAG = 0.9;
const FLAT_DRAG = 70;
const PUCK_BOUNCE = 0.92;
const PEG_BOUNCE = 0.85;
const WALL_BOUNCE = 0.7;
const SUBSTEPS = 4;

export interface StepEvents {
  puckHits: number;
  pegHits: number;
  wallHits: number;
  /** Pucks that hit each other hard this step, with the impact speed. */
  contacts: { a: Puck; b: Puck; speed: number }[];
}

export function speed(p: Puck): number {
  return Math.hypot(p.vx, p.vy);
}

export function isResting(p: Puck): boolean {
  return speed(p) < REST_SPEED;
}

/** Advance the world. `jitter` returns [-1, 1) and adds a little chaos to peg bounces. */
export function stepWorld(world: World, dt: number, jitter: () => number = () => 0): StepEvents {
  const events: StepEvents = { puckHits: 0, pegHits: 0, wallHits: 0, contacts: [] };
  const h = dt / SUBSTEPS;
  for (let s = 0; s < SUBSTEPS; s += 1) {
    for (const p of world.pucks) integrate(world, p, h);
    for (let i = 0; i < world.pucks.length; i += 1) {
      for (let j = i + 1; j < world.pucks.length; j += 1) {
        const a = world.pucks[i]!;
        const b = world.pucks[j]!;
        const rel = Math.hypot(a.vx - b.vx, a.vy - b.vy);
        if (collidePucks(a, b)) {
          events.puckHits += 1;
          events.contacts.push({ a, b, speed: rel });
        }
      }
    }
    for (const p of world.pucks) {
      for (const peg of world.pegs) if (collidePeg(p, peg, jitter)) events.pegHits += 1;
      if (collideWalls(p, world.width, world.height)) events.wallHits += 1;
    }
  }
  return events;
}

function integrate(world: World, p: Puck, h: number): void {
  if (p.anchored) {
    p.vx = 0;
    p.vy = 0;
    return;
  }
  const v = speed(p);
  if (v === 0) return;

  // Swirl rotates the velocity (no energy added) so it bends shots without keeping pucks alive.
  const { swirl } = world;
  const d = Math.hypot(p.x - swirl.x, p.y - swirl.y);
  if (d < swirl.radius) {
    const angle = swirl.spin * (1 - d / swirl.radius) * h;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const vx = p.vx * c - p.vy * s;
    p.vy = p.vx * s + p.vy * c;
    p.vx = vx;
  }

  const next = Math.max(0, v * Math.exp(-LINEAR_DRAG * h) - FLAT_DRAG * h);
  if (next < REST_SPEED * 0.5) {
    p.vx = 0;
    p.vy = 0;
  } else {
    p.vx *= next / v;
    p.vy *= next / v;
  }
  p.x += p.vx * h;
  p.y += p.vy * h;
}

function invMass(p: Puck): number {
  return p.anchored ? 0 : 1 / (p.mass ?? 1);
}

export function collidePucks(a: Puck, b: Puck): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const min = a.r + b.r;
  if (dist >= min || dist === 0) return false;
  const nx = dx / dist;
  const ny = dy / dist;
  const ia = invMass(a);
  const ib = invMass(b);
  const total = ia + ib;
  const overlap = min - dist;
  const shareA = total === 0 ? 0.5 : ia / total;
  const shareB = total === 0 ? 0.5 : ib / total;
  a.x -= nx * overlap * shareA;
  a.y -= ny * overlap * shareA;
  b.x += nx * overlap * shareB;
  b.y += ny * overlap * shareB;
  const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (rel <= 0 || total === 0) return false;
  const impulse = (rel * (1 + PUCK_BOUNCE)) / total;
  a.vx -= impulse * ia * nx;
  a.vy -= impulse * ia * ny;
  b.vx += impulse * ib * nx;
  b.vy += impulse * ib * ny;
  return rel > 40;
}

/** Shove a puck out of a moving body's way. Returns the impact speed (0 = no touch). */
export function collideKinematic(p: Puck, body: Kinematic): number {
  const dx = p.x - body.x;
  const dy = p.y - body.y;
  const dist = Math.hypot(dx, dy);
  const min = p.r + body.r;
  if (dist >= min) return 0;
  const nx = dist === 0 ? 0 : dx / dist;
  const ny = dist === 0 ? -1 : dy / dist;
  p.x = body.x + nx * min;
  p.y = body.y + ny * min;
  const rel = (body.vx - p.vx) * nx + (body.vy - p.vy) * ny;
  if (rel <= 0) return 0;
  p.anchored = false;
  const kick = (rel * 1.6) / (p.mass ?? 1);
  p.vx += nx * kick;
  p.vy += ny * kick;
  return rel;
}

/**
 * Explosion: every puck within `radius` (except `skipId`) flies outward, harder the closer it is.
 * Unsticks anchored pucks. Returns the pucks that were pushed.
 */
export function blast(pucks: readonly Puck[], x: number, y: number, radius: number, power: number, skipId = -1): Puck[] {
  const hit: Puck[] = [];
  for (const p of pucks) {
    if (p.id === skipId) continue;
    const dx = p.x - x;
    const dy = p.y - y;
    const dist = Math.hypot(dx, dy);
    if (dist > radius + p.r) continue;
    const nx = dist === 0 ? 1 : dx / dist;
    const ny = dist === 0 ? 0 : dy / dist;
    const falloff = 1 - Math.min(1, dist / (radius + p.r)) * 0.7;
    const kick = (power * falloff) / (p.mass ?? 1);
    p.anchored = false;
    p.vx += nx * kick;
    p.vy += ny * kick;
    hit.push(p);
  }
  return hit;
}

/** How far a puck launched at `v0` slides on open ground before stopping (closed form of the drag model). */
export function slideDistance(v0: number): number {
  if (v0 <= 0) return 0;
  return v0 / LINEAR_DRAG - (FLAT_DRAG / (LINEAR_DRAG * LINEAR_DRAG)) * Math.log(1 + (LINEAR_DRAG * v0) / FLAT_DRAG);
}

export function collidePeg(p: Puck, peg: Peg, jitter: () => number): boolean {
  const dx = p.x - peg.x;
  const dy = p.y - peg.y;
  const dist = Math.hypot(dx, dy);
  const min = p.r + peg.r;
  if (dist >= min || dist === 0) return false;
  // Nudge the bounce normal a few degrees: same shot, slightly different luck.
  const wobble = jitter() * 0.18;
  const base = Math.atan2(dy, dx);
  const nx = Math.cos(base + wobble);
  const ny = Math.sin(base + wobble);
  p.x = peg.x + (dx / dist) * min;
  p.y = peg.y + (dy / dist) * min;
  const into = p.vx * nx + p.vy * ny;
  if (into >= 0) return false;
  p.vx -= (1 + PEG_BOUNCE) * into * nx;
  p.vy -= (1 + PEG_BOUNCE) * into * ny;
  return -into > 40;
}

function collideWalls(p: Puck, w: number, h: number): boolean {
  let hit = false;
  if (p.x < p.r) {
    p.x = p.r;
    if (p.vx < 0) {
      hit ||= p.vx < -40;
      p.vx = -p.vx * WALL_BOUNCE;
    }
  } else if (p.x > w - p.r) {
    p.x = w - p.r;
    if (p.vx > 0) {
      hit ||= p.vx > 40;
      p.vx = -p.vx * WALL_BOUNCE;
    }
  }
  if (p.y < p.r) {
    p.y = p.r;
    if (p.vy < 0) {
      hit ||= p.vy < -40;
      p.vy = -p.vy * WALL_BOUNCE;
    }
  } else if (p.y > h - p.r) {
    p.y = h - p.r;
    if (p.vy > 0) {
      hit ||= p.vy > 40;
      p.vy = -p.vy * WALL_BOUNCE;
    }
  }
  return hit;
}

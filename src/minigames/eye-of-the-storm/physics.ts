/** Tiny top-down puck physics: sliding discs, static pegs, walls, and a swirl that curves paths. */

export interface Puck {
  id: number;
  owner: string;
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
}

export function speed(p: Puck): number {
  return Math.hypot(p.vx, p.vy);
}

export function isResting(p: Puck): boolean {
  return speed(p) < REST_SPEED;
}

/** Advance the world. `jitter` returns [-1, 1) and adds a little chaos to peg bounces. */
export function stepWorld(world: World, dt: number, jitter: () => number = () => 0): StepEvents {
  const events: StepEvents = { puckHits: 0, pegHits: 0, wallHits: 0 };
  const h = dt / SUBSTEPS;
  for (let s = 0; s < SUBSTEPS; s += 1) {
    for (const p of world.pucks) integrate(world, p, h);
    for (let i = 0; i < world.pucks.length; i += 1) {
      for (let j = i + 1; j < world.pucks.length; j += 1) {
        if (collidePucks(world.pucks[i]!, world.pucks[j]!)) events.puckHits += 1;
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

export function collidePucks(a: Puck, b: Puck): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const min = a.r + b.r;
  if (dist >= min || dist === 0) return false;
  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = (min - dist) / 2;
  a.x -= nx * overlap;
  a.y -= ny * overlap;
  b.x += nx * overlap;
  b.y += ny * overlap;
  const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (rel <= 0) return false;
  const impulse = (rel * (1 + PUCK_BOUNCE)) / 2;
  a.vx -= impulse * nx;
  a.vy -= impulse * ny;
  b.vx += impulse * nx;
  b.vy += impulse * ny;
  return rel > 40;
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

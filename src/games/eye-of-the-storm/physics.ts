/** Tiny top-down puck physics: sliding discs, static pegs, walls, a swirl that curves paths, and lightning blasts. */

export interface Puck {
  id: number;
  owner: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** 1 for a light puck, more for a heavy one: it hits harder, is shoved less and the swirl bends it less. */
  mass: number;
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
  const v = speed(p);
  if (v === 0) return;

  // Swirl rotates the velocity (no energy added) so it bends shots without keeping pucks alive.
  // Heavy pucks carry more momentum, so the storm turns them less.
  const { swirl } = world;
  const d = Math.hypot(p.x - swirl.x, p.y - swirl.y);
  if (d < swirl.radius) {
    const angle = (swirl.spin / Math.max(1, p.mass)) * (1 - d / swirl.radius) * h;
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
  const ia = 1 / Math.max(0.01, a.mass);
  const ib = 1 / Math.max(0.01, b.mass);
  const overlap = min - dist;
  a.x -= nx * overlap * (ia / (ia + ib));
  a.y -= ny * overlap * (ia / (ia + ib));
  b.x += nx * overlap * (ib / (ia + ib));
  b.y += ny * overlap * (ib / (ia + ib));
  const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (rel <= 0) return false;
  const impulse = (rel * (1 + PUCK_BOUNCE)) / (ia + ib);
  a.vx -= impulse * ia * nx;
  a.vy -= impulse * ia * ny;
  b.vx += impulse * ib * nx;
  b.vy += impulse * ib * ny;
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

/**
 * Lightning: every puck within `radius` of the strike is shoved straight away from it.
 * The shove is strongest at the centre and heavy pucks resist it. `jitter` breaks the tie
 * for a puck sitting exactly on the strike point. Returns the pucks that were moved.
 */
export function applyBlast(
  world: World,
  x: number,
  y: number,
  radius: number,
  power: number,
  jitter: () => number = () => 0,
): Puck[] {
  const hit: Puck[] = [];
  for (const p of world.pucks) {
    const dx = p.x - x;
    const dy = p.y - y;
    const d = Math.hypot(dx, dy);
    if (d > radius + p.r) continue;
    const falloff = 1 - Math.min(1, d / (radius + p.r)) * 0.6;
    const push = (power * falloff) / Math.max(1, p.mass);
    let nx: number;
    let ny: number;
    if (d < 1) {
      const a = jitter() * Math.PI;
      nx = Math.cos(a);
      ny = Math.sin(a);
    } else {
      nx = dx / d;
      ny = dy / d;
    }
    p.vx += nx * push;
    p.vy += ny * push;
    hit.push(p);
  }
  return hit;
}

export interface Preview {
  /** Sampled positions along the predicted path, start first. */
  points: { x: number; y: number }[];
  /** True when the path ran into a peg (the rest is a guess) or ran out of time. */
  uncertain: boolean;
}

/**
 * Approximate flight of a lone puck through the current swirl, drag and pegs, with no jitter and
 * no other pucks. Stops early at the first peg hit because after that the real shot is anyone's guess.
 */
export function previewPath(world: World, start: Puck, seconds = 3, sampleEvery = 0.05): Preview {
  const p: Puck = { ...start };
  const ghost: World = { ...world, pucks: [p] };
  const h = 1 / 240;
  const points: { x: number; y: number }[] = [{ x: p.x, y: p.y }];
  let since = 0;
  const steps = Math.ceil(seconds / h);
  for (let i = 0; i < steps; i += 1) {
    integrate(ghost, p, h);
    for (const peg of world.pegs) {
      const touching = Math.hypot(p.x - peg.x, p.y - peg.y) < p.r + peg.r;
      if (touching) {
        points.push({ x: p.x, y: p.y });
        return { points, uncertain: true };
      }
    }
    collideWalls(p, world.width, world.height);
    since += h;
    if (since >= sampleEvery) {
      since = 0;
      points.push({ x: p.x, y: p.y });
    }
    if (isResting(p)) {
      points.push({ x: p.x, y: p.y });
      return { points, uncertain: false };
    }
  }
  return { points, uncertain: true };
}

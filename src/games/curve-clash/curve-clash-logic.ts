/**
 * DOM-free pieces of Curve Clash: the occupancy grid, spawn picking, bot
 * steering raycasts, pickups, near-miss checks and the shrinking arena.
 * Kept separate so they can be unit tested.
 */

export const CELL = 4;
export const EMPTY = -1;

export class TrailGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly owner: Int8Array;
  private readonly stamp: Float32Array;
  /** How far the walls have closed in from every edge (shrinking arena). */
  inset = 0;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.cols = Math.ceil(width / CELL);
    this.rows = Math.ceil(height / CELL);
    this.owner = new Int8Array(this.cols * this.rows).fill(EMPTY);
    this.stamp = new Float32Array(this.cols * this.rows);
  }

  clear(): void {
    this.owner.fill(EMPTY);
    this.stamp.fill(0);
  }

  inBounds(x: number, y: number): boolean {
    const m = this.inset;
    return x >= m && y >= m && x < this.width - m && y < this.height - m;
  }

  /**
   * True if (x, y) holds a trail that would kill `who` (walls don't count).
   * Used for ghosts (who ignore trails) and the near-miss check.
   */
  trailAt(x: number, y: number, who: number, t: number, ignoreSecs: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    const i = Math.floor(y / CELL) * this.cols + Math.floor(x / CELL);
    const o = this.owner[i]!;
    if (o === EMPTY) return false;
    return !(o === who && t - this.stamp[i]! < ignoreSecs);
  }

  /** True if no trail cell lies within `radius` of (x, y) and the disc is inside the walls. */
  areaFree(x: number, y: number, radius: number): boolean {
    if (!this.inBounds(x - radius, y - radius) || !this.inBounds(x + radius, y + radius)) return false;
    for (let dy = -radius; dy <= radius; dy += CELL) {
      for (let dx = -radius; dx <= radius; dx += CELL) {
        if (dx * dx + dy * dy > radius * radius) continue;
        if (this.trailAt(x + dx, y + dy, EMPTY, 0, 0)) return false;
      }
    }
    return true;
  }

  /** Paint a filled disc of cells for `who` at time `t`. */
  paint(x: number, y: number, radius: number, who: number, t: number): void {
    const c0 = Math.max(0, Math.floor((x - radius) / CELL));
    const c1 = Math.min(this.cols - 1, Math.floor((x + radius) / CELL));
    const r0 = Math.max(0, Math.floor((y - radius) / CELL));
    const r1 = Math.min(this.rows - 1, Math.floor((y + radius) / CELL));
    const rr = (radius + CELL * 0.5) ** 2;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cx = (c + 0.5) * CELL - x;
        const cy = (r + 0.5) * CELL - y;
        if (cx * cx + cy * cy > rr) continue;
        const i = r * this.cols + c;
        if (this.owner[i] !== EMPTY) continue; // first writer keeps the cell
        this.owner[i] = who;
        this.stamp[i] = t;
      }
    }
  }

  /**
   * True if (x, y) is a wall or a trail that should kill `who` at time `t`.
   * Own cells newer than `ignoreSecs` are skipped (the line right behind the head).
   */
  blocked(x: number, y: number, who: number, t: number, ignoreSecs: number): boolean {
    if (!this.inBounds(x, y)) return true;
    return this.trailAt(x, y, who, t, ignoreSecs);
  }
}

/** Distance along heading `angle` before hitting something, capped at `maxDist`. */
export function rayFree(
  grid: TrailGrid,
  x: number,
  y: number,
  angle: number,
  maxDist: number,
  who: number,
  t: number,
  ignoreSecs: number,
  startDist = CELL * 2,
): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  for (let d = startDist; d <= maxDist; d += CELL) {
    if (grid.blocked(x + dx * d, y + dy * d, who, t, ignoreSecs)) return d;
  }
  return maxDist;
}

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Bot steering: cast rays at a fan of offsets, then return -1 (turn left),
 * 0 (straight) or 1 (turn right) toward the most open side. With a `target`
 * (a pickup) the bot turns toward it, but only while that heading is clear.
 */
export function botSteer(
  grid: TrailGrid,
  x: number,
  y: number,
  angle: number,
  who: number,
  t: number,
  ignoreSecs: number,
  lookAhead = 170,
  target?: { x: number; y: number },
): -1 | 0 | 1 {
  if (target) {
    const dist = Math.hypot(target.x - x, target.y - y);
    const diff = wrapAngle(Math.atan2(target.y - y, target.x - x) - angle);
    const want: -1 | 0 | 1 = Math.abs(diff) < 0.12 ? 0 : diff < 0 ? -1 : 1;
    const need = Math.min(lookAhead, dist + CELL * 2);
    const clearAt = (off: number, len: number) =>
      rayFree(grid, x, y, angle + off, len, who, t, ignoreSecs) >= len;
    // The chosen heading and the fan around it must both be open.
    const safe =
      want === 0
        ? clearAt(0, need) && clearAt(-0.3, need * 0.7) && clearAt(0.3, need * 0.7)
        : clearAt(want * 0.45, need) && clearAt(want * 1.0, need * 0.6) && clearAt(0, need * 0.6);
    if (safe) return want;
  }
  const straight = rayFree(grid, x, y, angle, lookAhead, who, t, ignoreSecs);
  const left =
    rayFree(grid, x, y, angle - 0.45, lookAhead, who, t, ignoreSecs) +
    rayFree(grid, x, y, angle - 1.0, lookAhead * 0.7, who, t, ignoreSecs) * 0.5;
  const right =
    rayFree(grid, x, y, angle + 0.45, lookAhead, who, t, ignoreSecs) +
    rayFree(grid, x, y, angle + 1.0, lookAhead * 0.7, who, t, ignoreSecs) * 0.5;
  if (straight >= lookAhead) return 0;
  return left > right ? -1 : 1;
}

export interface Spawn {
  x: number;
  y: number;
  angle: number;
}

/**
 * Pick `n` spawns away from walls and from each other, each heading roughly
 * toward the board centre so nobody starts by facing a wall.
 */
export function pickSpawns(
  n: number,
  width: number,
  height: number,
  random: () => number,
  margin = 140,
  minGap = 170,
): Spawn[] {
  const out: Spawn[] = [];
  for (let i = 0; i < n; i++) {
    let best: Spawn | null = null;
    for (let tries = 0; tries < 60; tries++) {
      const x = margin + random() * (width - margin * 2);
      const y = margin + random() * (height - margin * 2);
      const ok = out.every((s) => Math.hypot(s.x - x, s.y - y) >= minGap);
      const toCentre = Math.atan2(height / 2 - y, width / 2 - x);
      best = { x, y, angle: toCentre + (random() - 0.5) * 1.6 };
      if (ok) break;
    }
    out.push(best!);
  }
  return out;
}

/** Index of the round/match winner, or -1 while undecided. */
export function matchWinner(roundWins: readonly number[], target: number): number {
  return roundWins.findIndex((w) => w >= target);
}

// ---------------------------------------------------------------------------
// Pickups
// ---------------------------------------------------------------------------

export type PickupKind = "eraser" | "wrap" | "ghost";

export interface PickupInfo {
  label: string;
  /** One letter drawn inside the token. */
  glyph: string;
  color: string;
  /** Callout when grabbed. */
  shout: string;
}

export const PICKUPS: Record<PickupKind, PickupInfo> = {
  eraser: { label: "WIPE", glyph: "W", color: "#FFE45C", shout: "WIPED CLEAN!" },
  wrap: { label: "PORTAL", glyph: "P", color: "#9B6BFF", shout: "WALLS ARE PORTALS!" },
  ghost: { label: "GHOST", glyph: "G", color: "#E8ECF4", shout: "GHOST!" },
};

export const PICKUP_KINDS: readonly PickupKind[] = ["eraser", "wrap", "ghost"];

export interface Pickup {
  kind: PickupKind;
  x: number;
  y: number;
}

/**
 * Find an empty spot for a pickup: clear of trails, inside the walls with
 * `margin`, and at least `minHeadGap` from every head (no free grabs at spawn).
 * Returns null if nothing fits after a few tries.
 */
export function findPickupSpot(
  grid: TrailGrid,
  random: () => number,
  heads: readonly { x: number; y: number }[],
  existing: readonly { x: number; y: number }[] = [],
  margin = 60,
  minHeadGap = 90,
  radius = 26,
): { x: number; y: number } | null {
  const lo = grid.inset + margin;
  const w = grid.width - lo * 2;
  const h = grid.height - lo * 2;
  if (w <= 0 || h <= 0) return null;
  for (let tries = 0; tries < 40; tries++) {
    const x = lo + random() * w;
    const y = lo + random() * h;
    if (heads.some((p) => Math.hypot(p.x - x, p.y - y) < minHeadGap)) continue;
    if (existing.some((p) => Math.hypot(p.x - x, p.y - y) < radius * 4)) continue;
    if (!grid.areaFree(x, y, radius)) continue;
    return { x, y };
  }
  return null;
}

/** Portal walls: wrap a point that left the arena back in from the opposite side. */
export function wrapPoint(
  x: number,
  y: number,
  width: number,
  height: number,
  inset = 0,
): { x: number; y: number } {
  const w = width - inset * 2;
  const h = height - inset * 2;
  const nx = inset + ((((x - inset) % w) + w) % w);
  const ny = inset + ((((y - inset) % h) + h) % h);
  return { x: nx, y: ny };
}

// ---------------------------------------------------------------------------
// Near misses
// ---------------------------------------------------------------------------

/**
 * Closest trail to either side of the head, looking sideways (and slightly
 * forward) up to `maxSide` px. Returns Infinity if nothing is that close.
 * Walls don't count: skimming a wall isn't the thrill, skimming a line is.
 */
export function skimDistance(
  grid: TrailGrid,
  x: number,
  y: number,
  angle: number,
  who: number,
  t: number,
  ignoreSecs: number,
  maxSide = 12,
  minSide = 5,
): number {
  let best = Infinity;
  for (const side of [-1, 1]) {
    for (const lean of [0, 0.5]) {
      const a = angle + side * (Math.PI / 2 - lean);
      for (let d = minSide; d <= maxSide; d += 2) {
        if (grid.trailAt(x + Math.cos(a) * d, y + Math.sin(a) * d, who, t, ignoreSecs)) {
          if (d < best) best = d;
          break;
        }
      }
    }
  }
  return best;
}

/** Points for a skim: the tighter, the more. */
export function skimPoints(dist: number): number {
  if (!Number.isFinite(dist)) return 0;
  return dist <= 7 ? 3 : 1;
}

// ---------------------------------------------------------------------------
// Shrinking arena
// ---------------------------------------------------------------------------

export const SHRINK_START = 22; // seconds into the round
export const SHRINK_RATE = 9; // px per second, per side

/** How far the walls have moved in at `roundTime`; stops leaving a small box. */
export function arenaInset(roundTime: number, width: number, height: number): number {
  if (roundTime <= SHRINK_START) return 0;
  const max = Math.min(width, height) / 2 - 90;
  return Math.min(max, (roundTime - SHRINK_START) * SHRINK_RATE);
}

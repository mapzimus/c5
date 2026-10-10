/**
 * DOM-free pieces of Curve Clash: the occupancy grid, spawn picking and the
 * bot steering raycasts. Kept separate so they can be unit tested.
 */

export const CELL = 4;
export const EMPTY = -1;

export class TrailGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly owner: Int8Array;
  private readonly stamp: Float32Array;

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
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
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
    const i = Math.floor(y / CELL) * this.cols + Math.floor(x / CELL);
    const o = this.owner[i]!;
    if (o === EMPTY) return false;
    if (o === who && t - this.stamp[i]! < ignoreSecs) return false;
    return true;
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

/**
 * Bot steering: cast rays at a fan of offsets, then return -1 (turn left),
 * 0 (straight) or 1 (turn right) toward the most open side.
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
): -1 | 0 | 1 {
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

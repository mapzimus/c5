/**
 * DOM-free pieces of Curve Clash: the occupancy grid (trails, claimed ground,
 * fading wraith ink), spawn picking, bot steering raycasts, pickups, near-miss
 * checks, loop claims and the shrinking arena. Kept separate so they can be
 * unit tested.
 */

export const CELL = 4;
export const EMPTY = -1;
/** Cell owner codes: 0-3 trail of player n, 10-13 ground claimed by n, 20-23 wraith ink of n. */
export const TERRITORY_BASE = 10;
export const INK_BASE = 20;
/** Wraith ink only kills for this long after it was laid. */
export const INK_SECS = 2.2;
/** Stamp used for claimed ground (older than any self-ignore window). */
const GROUND_STAMP = -1000;

export interface Point {
  x: number;
  y: number;
}

export function isTrail(code: number): boolean {
  return code >= 0 && code < TERRITORY_BASE;
}

export function isTerritory(code: number): boolean {
  return code >= TERRITORY_BASE && code < INK_BASE;
}

export function isInk(code: number): boolean {
  return code >= INK_BASE;
}

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

  get cellCount(): number {
    return this.cols * this.rows;
  }

  clear(): void {
    this.owner.fill(EMPTY);
    this.stamp.fill(0);
  }

  /** Remove every trail cell (WIPE); claimed ground and ink stay. */
  clearTrails(): void {
    for (let i = 0; i < this.owner.length; i++) {
      if (isTrail(this.owner[i]!)) this.owner[i] = EMPTY;
    }
  }

  inBounds(x: number, y: number): boolean {
    const m = this.inset;
    return x >= m && y >= m && x < this.width - m && y < this.height - m;
  }

  private index(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1;
    return Math.floor(y / CELL) * this.cols + Math.floor(x / CELL);
  }

  /** Raw owner code at (x, y), or EMPTY (also outside the board). */
  cellAt(x: number, y: number): number {
    const i = this.index(x, y);
    return i < 0 ? EMPTY : this.owner[i]!;
  }

  /**
   * Owner code of whatever would kill `who` at (x, y) at time `t`, or EMPTY.
   * Your own line and your own ground never kill you; rival lines, rival
   * ground and fresh wraith ink do. Walls don't count (see `inBounds`).
   */
  hazardAt(x: number, y: number, who: number, t: number): number {
    const i = this.index(x, y);
    if (i < 0) return EMPTY;
    const o = this.owner[i]!;
    if (o === EMPTY) return EMPTY;
    if (isTrail(o)) return o === who ? EMPTY : o;
    if (isTerritory(o)) return o - TERRITORY_BASE === who ? EMPTY : o;
    return t - this.stamp[i]! < INK_SECS ? o : EMPTY;
  }

  /** True if (x, y) holds something that kills `who` (walls don't count). */
  trailAt(x: number, y: number, who: number, t: number): boolean {
    return this.hazardAt(x, y, who, t) !== EMPTY;
  }

  /** True if (x, y) is `who`'s own line, painted more than `ignoreSecs` ago (loop closing). */
  ownTrailAt(x: number, y: number, who: number, t: number, ignoreSecs: number): boolean {
    const i = this.index(x, y);
    if (i < 0) return false;
    return this.owner[i] === who && t - this.stamp[i]! >= ignoreSecs;
  }

  /** True if no trail, ground or ink cell lies within `radius` of (x, y) and the disc is inside the walls. */
  areaFree(x: number, y: number, radius: number, t = 0): boolean {
    if (!this.inBounds(x - radius, y - radius) || !this.inBounds(x + radius, y + radius)) return false;
    for (let dy = -radius; dy <= radius; dy += CELL) {
      for (let dx = -radius; dx <= radius; dx += CELL) {
        if (dx * dx + dy * dy > radius * radius) continue;
        if (this.trailAt(x + dx, y + dy, EMPTY, t)) return false;
      }
    }
    return true;
  }

  /**
   * Paint a filled disc of cells for `who` at time `t`. Existing cells keep
   * their owner, except expired ink which may be overwritten.
   */
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
        const o = this.owner[i]!;
        if (o !== EMPTY && !(isInk(o) && t - this.stamp[i]! >= INK_SECS)) continue;
        this.owner[i] = who;
        this.stamp[i] = t;
      }
    }
  }

  /**
   * Claim every cell inside `poly` (even-odd rule) for `code`, overriding
   * lines, ink and rival ground. Returns the number of cells claimed.
   */
  fillPolygon(poly: readonly Point[], code: number): number {
    if (poly.length < 3) return 0;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of poly) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const r0 = Math.max(0, Math.floor(minY / CELL));
    const r1 = Math.min(this.rows - 1, Math.floor(maxY / CELL));
    const xs: number[] = [];
    let count = 0;
    for (let r = r0; r <= r1; r++) {
      const y = (r + 0.5) * CELL;
      xs.length = 0;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]!;
        const b = poly[j]!;
        if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.round(xs[k]! / CELL));
        const c1 = Math.min(this.cols, Math.round(xs[k + 1]! / CELL));
        for (let c = c0; c < c1; c++) {
          const i = r * this.cols + c;
          if (this.owner[i] !== code) {
            this.owner[i] = code;
            this.stamp[i] = GROUND_STAMP;
            count++;
          }
        }
      }
    }
    return count;
  }

  /** Make a disc of cells `code` ground unconditionally (absorbs the loop's own line). */
  stampGround(x: number, y: number, radius: number, code: number): void {
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
        this.owner[i] = code;
        this.stamp[i] = GROUND_STAMP;
      }
    }
  }

  /**
   * True if (x, y) is a wall or something that kills `who` at time `t`.
   * (`ignoreSecs` is kept for call-site symmetry; own lines never block.)
   */
  blocked(x: number, y: number, who: number, t: number, _ignoreSecs = 0): boolean {
    if (!this.inBounds(x, y)) return true;
    return this.trailAt(x, y, who, t);
  }
}

/** Even-odd point-in-polygon test. */
export function pointInPolygon(poly: readonly Point[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x)) inside = !inside;
  }
  return inside;
}

/** Unsigned shoelace area of a polygon. */
export function polygonArea(poly: readonly Point[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    s += b.x * a.y - a.x * b.y;
  }
  return Math.abs(s) / 2;
}

/**
 * Where a head touching its own line closes a loop: the index into `path`
 * of the touched point, ignoring the last `skipPx` of path right behind the
 * head. Returns -1 if no older point is within `reach` of the head.
 */
export function loopStart(path: readonly Point[], head: Point, skipPx: number, reach: number): number {
  let cut = path.length - 1;
  let acc = 0;
  while (cut > 0 && acc < skipPx) {
    const a = path[cut]!;
    const b = path[cut - 1]!;
    acc += Math.hypot(a.x - b.x, a.y - b.y);
    cut--;
  }
  let best = -1;
  let bestD = reach;
  for (let i = 0; i < cut; i++) {
    const p = path[i]!;
    const d = Math.hypot(p.x - head.x, p.y - head.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
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

/**
 * Bot "curl": while a bot wants to draw a loop it keeps turning `dir` as long
 * as that side stays open; otherwise it falls back to `fallback`.
 */
export function botCurl(
  grid: TrailGrid,
  x: number,
  y: number,
  angle: number,
  who: number,
  t: number,
  dir: -1 | 1,
  fallback: -1 | 0 | 1,
): -1 | 0 | 1 {
  if (fallback !== 0) return fallback;
  const a = rayFree(grid, x, y, angle + dir * 0.5, 120, who, t, 0);
  const b = rayFree(grid, x, y, angle + dir * 1.0, 80, who, t, 0);
  return a >= 120 && b >= 80 ? dir : fallback;
}

/**
 * Wraith steering: head for where `target` will be in `lead` seconds (it moves
 * at `targetSpeed` along `targetAngle`). Wraiths pass through everything, so
 * no raycasts are needed.
 */
export function wraithSteer(
  x: number,
  y: number,
  angle: number,
  target: { x: number; y: number; angle: number },
  targetSpeed: number,
  lead: number,
): -1 | 0 | 1 {
  const tx = target.x + Math.cos(target.angle) * targetSpeed * lead;
  const ty = target.y + Math.sin(target.angle) * targetSpeed * lead;
  const diff = wrapAngle(Math.atan2(ty - y, tx - x) - angle);
  return Math.abs(diff) < 0.1 ? 0 : diff < 0 ? -1 : 1;
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

/** Index of the match winner: most points, ties broken by rounds won, then seat. */
export function matchWinner(scores: readonly number[], roundWins: readonly number[]): number {
  let best = -1;
  for (let i = 0; i < scores.length; i++) {
    if (best < 0) {
      best = i;
      continue;
    }
    const s = scores[i]!;
    const b = scores[best]!;
    if (s > b || (s === b && (roundWins[i] ?? 0) > (roundWins[best] ?? 0))) best = i;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export const ROUNDS = 3;
export const ROUND_WIN_PTS = 60;
export const OUTLAST_PTS = 10;
export const TRAP_PTS = 40;
export const HAUNT_PTS = 25;
export const FENCE_PTS = 15;
/** Smallest loop that counts, as a fraction of the board. */
export const MIN_CLAIM_FRAC = 0.004;

/** Percent of the board that `cells` of `total` make, at least one. */
export function claimPercent(cells: number, total: number): number {
  return Math.max(1, Math.round((100 * cells) / total));
}

/** Points for claiming `pct` percent of the board. */
export const CLAIM_PTS_PER_PCT = 2;

/** Everything scores double in the final round. */
export function roundMultiplier(round: number): number {
  return round >= ROUNDS ? 2 : 1;
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
  t = 0,
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
    if (!grid.areaFree(x, y, radius, t)) continue;
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
 * Closest deadly line to either side of the head, looking sideways (and
 * slightly forward) up to `maxSide` px. Returns Infinity if nothing is that
 * close. Walls and your own line don't count: skimming a rival is the thrill.
 */
export function skimDistance(
  grid: TrailGrid,
  x: number,
  y: number,
  angle: number,
  who: number,
  t: number,
  maxSide = 12,
  minSide = 5,
): number {
  let best = Infinity;
  for (const side of [-1, 1]) {
    for (const lean of [0, 0.5]) {
      const a = angle + side * (Math.PI / 2 - lean);
      for (let d = minSide; d <= maxSide; d += 2) {
        if (grid.trailAt(x + Math.cos(a) * d, y + Math.sin(a) * d, who, t)) {
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

export const SHRINK_START = 16; // seconds into the round
export const SHRINK_START_FINAL = 8; // the final round squeezes early
export const SHRINK_RATE = 12; // px per second, per side

/** How far the walls have moved in at `roundTime`; stops leaving a small box. */
export function arenaInset(roundTime: number, width: number, height: number, start = SHRINK_START): number {
  if (roundTime <= start) return 0;
  const max = Math.min(width, height) / 2 - 90;
  return Math.min(max, (roundTime - start) * SHRINK_RATE);
}

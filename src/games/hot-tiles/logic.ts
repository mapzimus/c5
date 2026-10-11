import type { Rng } from "../../core/rng";

/** Pure rules for Hot Tiles. No canvas, no DOM. Times are ms unless noted. */

export interface TileColor {
  name: string;
  hex: string;
}

export const TILE_COLORS: readonly TileColor[] = [
  { name: "RED", hex: "#E8352F" },
  { name: "BLUE", hex: "#2F6BFF" },
  { name: "GREEN", hex: "#2ED35A" },
  { name: "YELLOW", hex: "#FFD21F" },
  { name: "PURPLE", hex: "#A64DFF" },
];

export const TILE_COUNT = 20;
export const WINDOW_START_MS = 2200;
export const WINDOW_STEP_MS = 250;
export const WINDOW_MIN_MS = 900;
/** From this 0-based round on, only 2-3 tiles carry the called colour. */
export const SCARCE_FROM_ROUND = 3;
/** Hard cap on plays (replays included) so a match stays under ~90s. */
export const MAX_PLAYS = 12;
export const BOT_DELAY_MIN_MS = 300;
export const BOT_DELAY_MAX_MS = 900;
export const BOT_WRONG_CHANCE = 0.1;

/** How long players get after the colour is called: 2.2s, shrinking 0.25s per round to 0.9s. */
export function windowMs(round: number): number {
  return Math.max(WINDOW_MIN_MS, WINDOW_START_MS - round * WINDOW_STEP_MS);
}

export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const a = items[i]!;
    items[i] = items[j]!;
    items[j] = a;
  }
  return items;
}

export interface RoundPlan {
  /** Index into TILE_COLORS. */
  color: number;
  /** Colour index per tile, row-major. */
  tiles: number[];
  windowMs: number;
}

/** Colour layout and call for round `round` (0-based). Early rounds: 4 tiles of each colour. */
export function planRound(round: number, rng: Rng): RoundPlan {
  const color = rng.int(0, TILE_COLORS.length - 1);
  const tiles: number[] = [];
  if (round < SCARCE_FROM_ROUND) {
    for (let i = 0; i < TILE_COUNT; i++) tiles.push(i % TILE_COLORS.length);
  } else {
    const matching = rng.int(2, 3);
    const others: number[] = [];
    for (let c = 0; c < TILE_COLORS.length; c++) if (c !== color) others.push(c);
    for (let i = 0; i < matching; i++) tiles.push(color);
    // Every other colour shows at least once, the rest is uneven so the scarce one doesn't stand out.
    for (const c of others) tiles.push(c);
    while (tiles.length < TILE_COUNT) tiles.push(rng.pick(others));
  }
  shuffle(tiles, rng);
  return { color, tiles, windowMs: windowMs(round) };
}

export function matchingTiles(plan: RoundPlan): number[] {
  const out: number[] = [];
  plan.tiles.forEach((c, i) => { if (c === plan.color) out.push(i); });
  return out;
}

export interface GridLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  cols: number;
  rows: number;
  gap: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 5x4 on a landscape screen, 4x5 on a portrait one. */
export function gridShape(width: number, height: number): { cols: number; rows: number } {
  return width >= height ? { cols: 5, rows: 4 } : { cols: 4, rows: 5 };
}

/** The tile's own rect (the gap is split evenly around each tile). */
export function tileRect(layout: GridLayout, i: number): Rect {
  const cw = layout.w / layout.cols;
  const ch = layout.h / layout.rows;
  const c = i % layout.cols;
  const r = Math.floor(i / layout.cols);
  return { x: layout.x + c * cw + layout.gap / 2, y: layout.y + r * ch + layout.gap / 2, w: cw - layout.gap, h: ch - layout.gap };
}

export function tileCenter(layout: GridLayout, i: number): { x: number; y: number } {
  const r = tileRect(layout, i);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** Tile under a point, or -1 when the point is in a gap or off the grid. */
export function tileAtPoint(layout: GridLayout, px: number, py: number): number {
  if (px < layout.x || py < layout.y || px >= layout.x + layout.w || py >= layout.y + layout.h) return -1;
  const cw = layout.w / layout.cols;
  const ch = layout.h / layout.rows;
  const c = Math.min(layout.cols - 1, Math.floor((px - layout.x) / cw));
  const r = Math.min(layout.rows - 1, Math.floor((py - layout.y) / ch));
  const i = r * layout.cols + c;
  const t = tileRect(layout, i);
  if (px < t.x || px > t.x + t.w || py < t.y || py > t.y + t.h) return -1;
  return i;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Circle repulsion between tokens. Overlapping pairs push apart; a pinned token (held by a finger)
 * doesn't move and shoves the other one the full distance. Mutates `points`.
 */
export function resolveShoves(points: Point[], radius: number, pinned: readonly boolean[], iterations = 2): void {
  const min = radius * 2;
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i]!;
        const b = points[j]!;
        const pa = pinned[i] ?? false;
        const pb = pinned[j] ?? false;
        if (pa && pb) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d < 1e-6) {
          dx = 1;
          dy = 0.5 * (j - i);
          d = Math.hypot(dx, dy);
        }
        const overlap = min - d;
        const nx = dx / d;
        const ny = dy / d;
        if (pa) {
          b.x += nx * overlap;
          b.y += ny * overlap;
        } else if (pb) {
          a.x -= nx * overlap;
          a.y -= ny * overlap;
        } else {
          a.x -= nx * overlap * 0.5;
          a.y -= ny * overlap * 0.5;
          b.x += nx * overlap * 0.5;
          b.y += ny * overlap * 0.5;
        }
      }
    }
  }
}

/** Alive tokens that are not on a tile of the called colour when the window closes. */
export function fallers(tileOf: readonly number[], plan: RoundPlan, alive: readonly boolean[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < tileOf.length; i++) {
    if (!alive[i]) continue;
    const t = tileOf[i]!;
    if (t < 0 || plan.tiles[t] !== plan.color) out.push(i);
  }
  return out;
}

export type RoundOutcome = "replay" | "continue";

/**
 * Apply a round's fallers. If everyone still alive fell, nobody is eliminated and the round is
 * replayed. Otherwise the fallers are knocked out and share the next elimination score.
 * Returns the outcome and the new eliminated count.
 */
export function applyRound(
  alive: boolean[], scores: number[], fell: readonly number[], eliminatedSoFar: number,
): { outcome: RoundOutcome; eliminated: number } {
  const aliveCount = alive.filter(Boolean).length;
  if (fell.length > 0 && fell.length >= aliveCount) return { outcome: "replay", eliminated: eliminatedSoFar };
  for (const i of fell) {
    alive[i] = false;
    scores[i] = eliminatedSoFar;
  }
  return { outcome: "continue", eliminated: eliminatedSoFar + fell.length };
}

/** Survivors score above everyone eliminated (ties share). */
export function finalScores(alive: readonly boolean[], scores: number[], eliminated: number): number[] {
  for (let i = 0; i < alive.length; i++) if (alive[i]) scores[i] = eliminated;
  return scores;
}

export function matchOver(alive: readonly boolean[], plays: number): boolean {
  return alive.filter(Boolean).length <= 1 || plays >= MAX_PLAYS;
}

export interface BotPlan {
  /** When the bot starts moving, ms after the call. */
  delayMs: number;
  /** A tile of the called colour. */
  target: number;
  /** Wrong tile picked first (10%), corrected at `correctAtMs`. */
  wrongTarget: number | null;
  correctAtMs: number;
}

/** Bots react 300-900ms after the call (capped so late, short windows stay winnable), 10% go wrong first. */
export function planBot(plan: RoundPlan, rng: Rng, wrongChance = BOT_WRONG_CHANCE): BotPlan {
  const delayMs = Math.min(rng.float(BOT_DELAY_MIN_MS, BOT_DELAY_MAX_MS), plan.windowMs * 0.55);
  const good = matchingTiles(plan);
  const bad: number[] = [];
  plan.tiles.forEach((c, i) => { if (c !== plan.color) bad.push(i); });
  const target = rng.pick(good);
  if (bad.length > 0 && rng.next() < wrongChance) {
    return { delayMs, target, wrongTarget: rng.pick(bad), correctAtMs: delayMs + rng.float(300, 600) };
  }
  return { delayMs, target, wrongTarget: null, correctAtMs: delayMs };
}

/** Where a bot is heading `tMs` after the call, or null while it's still reacting. */
export function botTarget(bot: BotPlan, tMs: number): number | null {
  if (tMs < bot.delayMs) return null;
  if (bot.wrongTarget !== null && tMs < bot.correctAtMs) return bot.wrongTarget;
  return bot.target;
}

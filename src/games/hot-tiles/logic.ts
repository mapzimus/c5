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
/** From this 0-based round on, one matching tile is the Hot Spot (stand on it at the close for an ember). */
export const HOT_SPOT_FROM_ROUND = 1;
/** From this 0-based round on, the call may switch colour part-way through the window. */
export const SWITCH_FROM_ROUND = 2;
export const SWITCH_CHANCE = 0.35;
export const SWITCH_CHANCE_OVERDRIVE = 0.5;
/** Extra time added to the window when the call switches. */
export const SWITCH_BONUS_MS = 400;
/** 0-based round where Overdrive starts: shortest windows, more switches. */
export const OVERDRIVE_ROUND = 5;
/** Hard cap on plays (replays included) so a match stays under ~90s. */
export const MAX_PLAYS = 14;
export const BOT_DELAY_MIN_MS = 300;
export const BOT_DELAY_MAX_MS = 900;
export const BOT_WRONG_CHANCE = 0.1;
/** Seconds a ghost must sit on a tile before its curse arms (shorter in short windows, see curseArmS). */
export const CURSE_ARM_S = 0.75;
export const CURSE_ARM_MIN_S = 0.35;
export const MAX_LIVES = 3;
/** Embers (Hot Spot closes) needed to earn a life. */
export const EMBERS_PER_LIFE = 3;
/** Hauntings a ghost needs to climb back out of the lava. */
export const REVIVE_HAUNTINGS = 2;

/** Fewer players, more lives: 3 each in a duel, 2 each at a 3-4 player table. */
export function startingLives(playerCount: number): number {
  return playerCount <= 2 ? 3 : 2;
}

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
  /** Full window including any switch bonus. */
  windowMs: number;
  /** Hot Spot tile for `color`, or -1 (none before HOT_SPOT_FROM_ROUND). */
  hotSpot: number;
  /** When the call switches colour, or -1 for an honest call. */
  switchAtMs: number;
  /** Colour after the switch (only meaningful when switchAtMs >= 0). */
  switchColor: number;
  /** Hot Spot tile for `switchColor`, or -1. */
  switchHotSpot: number;
}

function tilesOf(tiles: readonly number[], color: number): number[] {
  const out: number[] = [];
  tiles.forEach((c, i) => { if (c === color) out.push(i); });
  return out;
}

/**
 * Colour layout and call for round `round` (0-based). Early rounds: 4 tiles of each colour.
 * Later rounds: only 2-3 tiles of the called colour (and of the switch colour, if any).
 */
export function planRound(round: number, rng: Rng): RoundPlan {
  const color = rng.int(0, TILE_COLORS.length - 1);
  const switching = round >= SWITCH_FROM_ROUND
    && rng.next() < (round >= OVERDRIVE_ROUND ? SWITCH_CHANCE_OVERDRIVE : SWITCH_CHANCE);
  let switchColor = -1;
  if (switching) {
    switchColor = (color + rng.int(1, TILE_COLORS.length - 1)) % TILE_COLORS.length;
  }
  const tiles: number[] = [];
  if (round < SCARCE_FROM_ROUND) {
    for (let i = 0; i < TILE_COUNT; i++) tiles.push(i % TILE_COLORS.length);
  } else {
    const matching = rng.int(2, 3);
    const others: number[] = [];
    for (let c = 0; c < TILE_COLORS.length; c++) if (c !== color && c !== switchColor) others.push(c);
    for (let i = 0; i < matching; i++) tiles.push(color);
    if (switchColor >= 0) {
      const m2 = rng.int(2, 3);
      for (let i = 0; i < m2; i++) tiles.push(switchColor);
    }
    // Every other colour shows at least once, the rest is uneven so the scarce one doesn't stand out.
    for (const c of others) tiles.push(c);
    while (tiles.length < TILE_COUNT) tiles.push(rng.pick(others));
  }
  shuffle(tiles, rng);
  const base = windowMs(round);
  const hotSpot = round >= HOT_SPOT_FROM_ROUND ? rng.pick(tilesOf(tiles, color)) : -1;
  if (switchColor < 0) {
    return { color, tiles, windowMs: base, hotSpot, switchAtMs: -1, switchColor: -1, switchHotSpot: -1 };
  }
  return {
    color, tiles, windowMs: base + SWITCH_BONUS_MS, hotSpot,
    switchAtMs: Math.round(base * rng.float(0.3, 0.5)),
    switchColor,
    switchHotSpot: round >= HOT_SPOT_FROM_ROUND ? rng.pick(tilesOf(tiles, switchColor)) : -1,
  };
}

/** The colour that counts `tMs` after the call (switched calls change part-way). */
export function activeColor(plan: RoundPlan, tMs: number): number {
  return plan.switchAtMs >= 0 && tMs >= plan.switchAtMs ? plan.switchColor : plan.color;
}

export function activeHotSpot(plan: RoundPlan, tMs: number): number {
  return plan.switchAtMs >= 0 && tMs >= plan.switchAtMs ? plan.switchHotSpot : plan.hotSpot;
}

/** The colour that will count when the window closes. */
export function finalColor(plan: RoundPlan): number {
  return activeColor(plan, Number.POSITIVE_INFINITY);
}

export function matchingTiles(plan: RoundPlan, color = plan.color): number[] {
  return tilesOf(plan.tiles, color);
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

/** Distance from a point to the nearest edge of a rect (0 inside). */
export function distanceToRect(r: Rect, px: number, py: number): number {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/** A fall counts as a near miss when the token was within `reach` of a safe tile's edge. */
export function nearMiss(layout: GridLayout, px: number, py: number, safeTiles: readonly number[], reach: number): boolean {
  for (const t of safeTiles) if (distanceToRect(tileRect(layout, t), px, py) <= reach) return true;
  return false;
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

// ---------------------------------------------------------------- curses (ghosts)

/** Tiles that stay up when the window closes: the final colour, minus any cursed tile. */
export function safeTiles(plan: RoundPlan, cursed: readonly boolean[]): number[] {
  return matchingTiles(plan, finalColor(plan)).filter((t) => !cursed[t]);
}

/**
 * A ghost may curse `tile` when it isn't cursed yet and at least one uncursed tile of the called
 * colour (and of the switch colour, if the call will switch) would remain. Nobody gets to wipe the board.
 */
export function canCurse(plan: RoundPlan, cursed: readonly boolean[], tile: number): boolean {
  if (tile < 0 || tile >= plan.tiles.length || cursed[tile]) return false;
  const colors = plan.switchAtMs >= 0 ? [plan.color, plan.switchColor] : [plan.color];
  for (const c of colors) {
    const left = matchingTiles(plan, c).filter((t) => !cursed[t] && t !== tile);
    if (left.length === 0) return false;
  }
  return true;
}

/** A curse arms in 40% of the window: 0.75s on a long early window, down to 0.35s in Overdrive. */
export function curseArmS(windowMs: number): number {
  return Math.max(CURSE_ARM_MIN_S, Math.min(CURSE_ARM_S, (windowMs / 1000) * 0.4));
}

/** Fuse progress (0-1) for a ghost sitting on a tile: fills in `armS`, drains twice as fast off it. */
export function stepFuse(fuse: number, holding: boolean, dtS: number, armS = CURSE_ARM_S): number {
  const next = holding ? fuse + dtS / armS : fuse - (2 * dtS) / armS;
  return Math.max(0, Math.min(1, next));
}

/**
 * Only one token claims the Hot Spot: the alive one standing on it closest to its centre
 * (shoving matters). Returns the token index or -1.
 */
export function hotSpotClaimant(
  tokens: readonly Point[], alive: readonly boolean[], tileOf: readonly number[], hotSpot: number, center: Point,
): number {
  let best = -1;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < tokens.length; i++) {
    if (!alive[i] || hotSpot < 0 || tileOf[i] !== hotSpot) continue;
    const t = tokens[i]!;
    const d = Math.hypot(t.x - center.x, t.y - center.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// ---------------------------------------------------------------- the close

/** Alive tokens that are not on a safe tile (final colour, uncursed) when the window closes. */
export function fallers(tileOf: readonly number[], plan: RoundPlan, alive: readonly boolean[], cursed: readonly boolean[] = []): number[] {
  const color = finalColor(plan);
  const out: number[] = [];
  for (let i = 0; i < tileOf.length; i++) {
    if (!alive[i]) continue;
    const t = tileOf[i]!;
    if (t < 0 || plan.tiles[t] !== color || cursed[t]) out.push(i);
  }
  return out;
}

export type RoundOutcome = "replay" | "continue";

/**
 * Apply a round's fallers: each loses a life, and anyone on their last life is knocked out
 * (sharing the next elimination rank). If every alive player would be knocked out at once,
 * nothing changes and the round is replayed. Returns the outcome, the new eliminated count and
 * who got knocked out this round.
 */
export function applyFalls(
  alive: boolean[], lives: number[], ranks: number[], fell: readonly number[], eliminatedSoFar: number,
): { outcome: RoundOutcome; eliminated: number; knockedOut: number[] } {
  const aliveCount = alive.filter(Boolean).length;
  const knockedOut = fell.filter((i) => alive[i] && (lives[i] ?? 0) <= 1);
  if (knockedOut.length > 0 && knockedOut.length >= aliveCount) {
    return { outcome: "replay", eliminated: eliminatedSoFar, knockedOut: [] };
  }
  for (const i of fell) {
    if (!alive[i]) continue;
    lives[i] = Math.max(0, (lives[i] ?? 0) - 1);
    if (lives[i] === 0) {
      alive[i] = false;
      ranks[i] = eliminatedSoFar;
    }
  }
  return { outcome: "continue", eliminated: eliminatedSoFar + knockedOut.length, knockedOut };
}

export interface Standing {
  alive: boolean;
  lives: number;
  embers: number;
  hauntings: number;
  /** Elimination rank (0 = first out), ignored while alive. */
  rank: number;
}

/**
 * Final scores: survivors above everyone knocked out, ranked by lives then embers;
 * the knocked out by elimination order, with hauntings as the tiebreak.
 */
export function finalScores(standings: readonly Standing[]): number[] {
  return standings.map((s) => s.alive
    ? 1000 + s.lives * 100 + s.embers * 10 + Math.min(9, s.hauntings)
    : s.rank * 10 + Math.min(9, s.hauntings));
}

export function matchOver(alive: readonly boolean[], plays: number): boolean {
  return alive.filter(Boolean).length <= 1 || plays >= MAX_PLAYS;
}

/** A ghost with enough hauntings climbs back out with one life, once per match, unless the match is about to end. */
export function canRevive(hauntings: number, revived: boolean, plays: number): boolean {
  return !revived && hauntings >= REVIVE_HAUNTINGS && plays < MAX_PLAYS - 2;
}

/** Collect embers into lives: returns the new lives and embers after cashing in. */
export function cashEmbers(lives: number, embers: number): { lives: number; embers: number; gained: boolean } {
  if (embers < EMBERS_PER_LIFE) return { lives, embers, gained: false };
  if (lives >= MAX_LIVES) return { lives, embers: EMBERS_PER_LIFE - 1, gained: false };
  return { lives: lives + 1, embers: embers - EMBERS_PER_LIFE, gained: true };
}

// ---------------------------------------------------------------- bots

export interface BotPlan {
  /** When the bot starts moving, ms after the call. */
  delayMs: number;
  /** A tile of the called colour. */
  target: number;
  /** Wrong tile picked first, corrected at `correctAtMs`. */
  wrongTarget: number | null;
  correctAtMs: number;
}

export interface BotOptions {
  /** Colour to aim for (defaults to the plan's first call). */
  color?: number;
  /** Added to delay and correction times: the moment (ms after the call) the bot started thinking. */
  fromMs?: number;
  /** Shorter reaction, used when re-planning after a switch or a curse. */
  quick?: boolean;
  /** Distance from the bot to each tile; when given the bot prefers near tiles. */
  distances?: readonly number[];
  /** Tiles the bot refuses (cursed). */
  avoid?: readonly boolean[];
  /** Hot Spot tile the bot may contest (-1 for none). */
  hotSpot?: number;
  wrongChance?: number;
  hotSpotChance?: number;
  /** Chance the bot freezes up and sets off far too late (a human-like choke). */
  freezeChance?: number;
}

/**
 * Bots react 300-900ms after the call (capped so late, short windows stay winnable). They prefer
 * the nearest matching tile, contest the Hot Spot some of the time, and sometimes go wrong first.
 */
export function planBot(plan: RoundPlan, rng: Rng, options: BotOptions = {}): BotPlan {
  const color = options.color ?? plan.color;
  const from = options.fromMs ?? 0;
  const remaining = Math.max(200, plan.windowMs - from);
  const raw = options.quick ? rng.float(220, 600) : rng.float(BOT_DELAY_MIN_MS, BOT_DELAY_MAX_MS);
  const frozen = !options.quick && rng.next() < (options.freezeChance ?? 0);
  const delayMs = from + (frozen ? remaining * rng.float(0.8, 1.1) : Math.min(raw, remaining * 0.55));
  const avoid = options.avoid ?? [];
  let good = matchingTiles(plan, color).filter((t) => !avoid[t]);
  if (good.length === 0) good = matchingTiles(plan, color);
  const bad: number[] = [];
  plan.tiles.forEach((c, i) => { if (c !== color) bad.push(i); });

  let target: number;
  const hot = options.hotSpot ?? -1;
  if (hot >= 0 && good.includes(hot) && rng.next() < (options.hotSpotChance ?? 0.4)) {
    target = hot;
  } else if (options.distances && rng.next() < 0.7) {
    const d = options.distances;
    target = good.reduce((best, t) => ((d[t] ?? Infinity) < (d[best] ?? Infinity) ? t : best), good[0]!);
  } else {
    target = rng.pick(good);
  }
  const wrongChance = options.wrongChance ?? BOT_WRONG_CHANCE;
  if (bad.length > 0 && !options.quick && !frozen && rng.next() < wrongChance) {
    return { delayMs, target, wrongTarget: rng.pick(bad), correctAtMs: delayMs + rng.float(300, 600) };
  }
  return { delayMs, target, wrongTarget: null, correctAtMs: delayMs };
}

/** Bots slip more as the rounds speed up: 10% wrong-first in round 1, up to 28%. */
export function botWrongChance(round: number): number {
  return Math.min(0.28, BOT_WRONG_CHANCE + round * 0.03);
}

/** Bots choke more as the rounds speed up: never in rounds 1-2, then 3% more each round up to 20%. */
export function botFreezeChance(round: number): number {
  return Math.min(0.2, Math.max(0, round - 1) * 0.03);
}

/** Where a bot is heading `tMs` after the call, or null while it's still reacting. */
export function botTarget(bot: BotPlan, tMs: number): number | null {
  if (tMs < bot.delayMs) return null;
  if (bot.wrongTarget !== null && tMs < bot.correctAtMs) return bot.wrongTarget;
  return bot.target;
}

export interface GhostPlan {
  /** When the ghost starts drifting, ms after the call. */
  delayMs: number;
  target: number;
}

/**
 * A bot ghost picks a tile to curse: usually the cursable matching tile with the most "prey"
 * (weights such as tokens standing on it, the Hot Spot), sometimes a random one, after hovering
 * for 22-50% of the window.
 */
export function planGhost(plan: RoundPlan, rng: Rng, weights: readonly number[], cursed: readonly boolean[], fromMs = 0): GhostPlan | null {
  const color = activeColor(plan, fromMs);
  const options = matchingTiles(plan, color).filter((t) => canCurse(plan, cursed, t));
  if (options.length === 0) return null;
  let target: number;
  if (rng.next() < 0.65) {
    target = options.reduce((best, t) => ((weights[t] ?? 0) > (weights[best] ?? 0) ? t : best), options[0]!);
  } else {
    target = rng.pick(options);
  }
  const delayMs = fromMs + (fromMs > 0 ? rng.float(150, 400) : plan.windowMs * rng.float(0.22, 0.5));
  return { delayMs, target };
}

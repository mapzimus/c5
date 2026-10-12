import { Rng } from "../../core/rng";

/** Pure rules for Block Brawl: board, pieces, bag, garbage, high stakes, tide, ghosts, bot heuristic. */

export const COLS = 10;
export const ROWS = 20;
export const GARBAGE = 8;

/** Bit set on a board cell that holds a power cell. */
export const POWER = 16;

/**
 * 0 = empty, 1..7 = piece type + 1, 8 = garbage, optionally | POWER for a power cell.
 * Indexed board[row][col], row 0 at top.
 */
export type Board = number[][];

export const PIECE_NAMES = ["I", "O", "T", "S", "Z", "J", "L"] as const;

const SHAPES: readonly (readonly string[])[] = [
  ["....", "XXXX", "....", "...."],
  ["XX", "XX"],
  [".X.", "XXX", "..."],
  [".XX", "XX.", "..."],
  ["XX.", ".XX", "..."],
  ["X..", "XXX", "..."],
  ["..X", "XXX", "..."],
];

export type Cells = readonly (readonly [number, number])[];

/** ROTATIONS[type][rot] = list of [col, row] offsets inside the piece box. */
export const ROTATIONS: readonly (readonly Cells[])[] = SHAPES.map((rows) => {
  const n = rows.length;
  let cells: [number, number][] = [];
  rows.forEach((line, y) => {
    for (let x = 0; x < line.length; x++) if (line[x] === "X") cells.push([x, y]);
  });
  const out: Cells[] = [];
  for (let r = 0; r < 4; r++) {
    out.push(cells);
    cells = cells.map(([x, y]) => [n - 1 - y, x] as [number, number]);
  }
  return out;
});

export function boxSize(type: number): number {
  return SHAPES[type]!.length;
}

export interface Piece {
  type: number;
  rot: number;
  x: number;
  y: number;
}

export function emptyBoard(): Board {
  return Array.from({ length: ROWS }, () => new Array<number>(COLS).fill(0));
}

export function spawnPiece(type: number): Piece {
  return { type, rot: 0, x: Math.floor((COLS - boxSize(type)) / 2), y: 0 };
}

export function pieceCells(p: Piece): [number, number][] {
  return ROTATIONS[p.type]![p.rot & 3]!.map(([cx, cy]) => [p.x + cx, p.y + cy]);
}

export function collides(board: Board, p: Piece): boolean {
  for (const [x, y] of pieceCells(p)) {
    if (x < 0 || x >= COLS || y >= ROWS) return true;
    if (y >= 0 && board[y]![x] !== 0) return true;
  }
  return false;
}

/** Lowest y the piece can fall to. */
export function dropY(board: Board, p: Piece): number {
  let y = p.y;
  while (!collides(board, { ...p, y: y + 1 })) y++;
  return y;
}

/** Write the piece into the board (mutates). `power` = index of the glowing cell, or -1. */
export function lockPiece(board: Board, p: Piece, power = -1): void {
  pieceCells(p).forEach(([x, y], i) => {
    if (y >= 0 && y < ROWS) board[y]![x] = (p.type + 1) | (i === power ? POWER : 0);
  });
}

/** Colour index of a cell value (strips the power bit). */
export function cellKind(v: number): number {
  return v & ~POWER;
}

/** Power cells sitting in rows that are full right now (call before clearLines). */
export function powersInFullRows(board: Board): number {
  let n = 0;
  for (const row of board) {
    if (row.every((c) => c !== 0)) n += row.filter((c) => (c & POWER) !== 0).length;
  }
  return n;
}

/** Remove full rows (mutates). Returns the number of cleared rows. */
export function clearLines(board: Board): number {
  let cleared = 0;
  for (let y = ROWS - 1; y >= 0; y--) {
    if (board[y]!.every((c) => c !== 0)) {
      board.splice(y, 1);
      cleared++;
    }
  }
  for (let i = 0; i < cleared; i++) board.unshift(new Array<number>(COLS).fill(0));
  return cleared;
}

/** Rows from the floor to the highest filled cell (0 = empty well). */
export function stackHeight(board: Board): number {
  for (let y = 0; y < ROWS; y++) if (board[y]!.some((c) => c !== 0)) return ROWS - y;
  return 0;
}

/** 2/3/4 lines send 1/2/4 garbage. */
export function garbageFor(lines: number): number {
  if (lines >= 4) return 4;
  if (lines === 3) return 2;
  if (lines === 2) return 1;
  return 0;
}

/** Chain = consecutive locks that cleared at least one line. */
export function nextChain(chain: number, cleared: number): number {
  return cleared > 0 ? chain + 1 : 0;
}

/** Extra garbage for a chain: x2 +1, x4 +2, x6+ +3. */
export function chainBonus(chain: number): number {
  return chain >= 2 ? Math.min(3, Math.floor(chain / 2)) : 0;
}

// ---- high stakes ----

/**
 * The stakes line sits this many rows above the floor. A clear made while the stack
 * (measured just before the clear) reaches it is HIGH STAKES: line garbage is doubled.
 * Stack high to hit hard, stack low to stay safe.
 */
export const STAKES_HEIGHT = 10;

export function isHighStakes(heightBeforeClear: number): boolean {
  return heightBeforeClear >= STAKES_HEIGHT;
}

/**
 * Garbage sent by a clear while on `chain` (chain already includes this clear).
 * `stakes` doubles the line garbage, `bonus` is a flat extra (underdog).
 */
export function attackFor(lines: number, chain: number, stakes = false, bonus = 0): number {
  if (lines <= 0) return 0;
  const base = garbageFor(lines) * (stakes ? 2 : 1);
  return base + chainBonus(chain) + bonus;
}

// ---- underdog ----

/** Lines behind the leader before the underdog bonus kicks in. */
export const UNDERDOG_GAP = 3;

/**
 * The living player strictly last on lines, at least UNDERDOG_GAP behind the leader,
 * gets +1 on every attack. `rivalLines` = lines of the other living players.
 */
export function isUnderdog(myLines: number, rivalLines: readonly number[]): boolean {
  if (rivalLines.length === 0) return false;
  return rivalLines.every((l) => l > myLines) && Math.max(...rivalLines) - myLines >= UNDERDOG_GAP;
}

// ---- clock, overdrive and the tide ----

export const TIME_LIMIT = 90;
/** When the tide starts: a garbage row for every living well, again and again. */
export const OVERDRIVE_AT = 50;
export const GRAVITY_START = 0.8;
export const GRAVITY_MIN = 0.1;

export function isOverdrive(time: number): boolean {
  return time >= OVERDRIVE_AT;
}

/** Seconds between tide rows: 3s when overdrive starts, 1.5s by the time limit. */
export function tideInterval(time: number): number {
  const t = Math.min(1, Math.max(0, (time - OVERDRIVE_AT) / (TIME_LIMIT - OVERDRIVE_AT)));
  return 3 - 1.5 * t;
}

/** Gravity interval in seconds: ramps over the match, faster in overdrive and under RUSH. */
export function gravityFor(time: number, rushed = false): number {
  let base = Math.max(GRAVITY_MIN, GRAVITY_START - time / 160);
  if (isOverdrive(time)) base = Math.max(GRAVITY_MIN, base * 0.7);
  return rushed ? rushGravity(base) : base;
}

// ---- ghosts ----

/** Seconds a knocked-out player waits between haunts (one garbage row each). */
export const HAUNT_COOLDOWN = 5;

export interface Rival {
  lines: number;
  height: number;
}

/**
 * Which living rival a bot ghost haunts: usually the leader on lines, sometimes
 * whoever is closest to the top (finish them), occasionally anyone.
 */
export function pickHauntTarget(rivals: readonly Rival[], roll: number): number {
  if (rivals.length === 0) return -1;
  if (roll < 0.55) {
    let best = 0;
    rivals.forEach((r, i) => {
      if (r.lines > rivals[best]!.lines) best = i;
    });
    return best;
  }
  if (roll < 0.85) {
    let best = 0;
    rivals.forEach((r, i) => {
      if (r.height > rivals[best]!.height) best = i;
    });
    return best;
  }
  return Math.min(rivals.length - 1, Math.floor(((roll - 0.85) / 0.15) * rivals.length));
}

// ---- powers ----

export const POWERS = ["ink", "rush", "flip"] as const;
export type PowerKind = (typeof POWERS)[number];

/** Seconds each power lasts on the victim. */
export const POWER_TIME: Record<PowerKind, number> = { ink: 5, rush: 3.5, flip: 5 };

export const POWER_LABEL: Record<PowerKind, string> = {
  ink: "INK!",
  rush: "RUSH!",
  flip: "FLIP!",
};

/** About 1 in 6 pieces carries a power cell. */
export const POWER_ODDS = 6;

/**
 * Which cell (0..3) of the n-th piece glows, or -1. Pure hash of seed + index, so
 * every player gets the same power pieces at the same point in the shared sequence.
 */
export function powerCellFor(seed: number, n: number): number {
  let h = Math.imul((seed ^ 0x9e3779b9) + n * 0x85ebca6b, 0xc2b2ae35) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x27d4eb2f) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  if (n < 3 || h % POWER_ODDS !== 0) return -1;
  return (h >>> 8) & 3;
}

/** Gravity interval while rushed: much faster, never below 0.04s. */
export function rushGravity(interval: number): number {
  return Math.max(0.04, interval * 0.2);
}

/** Flip swaps left/right and the rotation direction. */
export function flipDir(dir: number, flipped: boolean): number {
  return flipped ? -dir : dir;
}

/**
 * Push garbage rows in from the bottom (mutates). Each row has one hole from `holes`.
 * Returns true if filled cells were pushed off the top (topped out).
 */
export function addGarbage(board: Board, holes: readonly number[]): boolean {
  let toppedOut = false;
  for (const hole of holes) {
    const top = board.shift()!;
    if (top.some((c) => c !== 0)) toppedOut = true;
    const row = new Array<number>(COLS).fill(GARBAGE);
    row[hole] = 0;
    board.push(row);
  }
  return toppedOut;
}

/**
 * Hole columns for `count` garbage rows landing together. Rows in one batch usually
 * share a hole (so a well-placed I bar digs out several), sometimes it shifts.
 * `roll` returns a float in [0,1).
 */
export function garbageHoles(count: number, roll: () => number): number[] {
  const holes: number[] = [];
  let hole = Math.floor(roll() * COLS);
  for (let i = 0; i < count; i++) {
    if (i > 0 && roll() < 0.3) hole = Math.floor(roll() * COLS);
    holes.push(Math.min(COLS - 1, hole));
  }
  return holes;
}

/** Try rotating with small sideways kicks. Returns the new piece or null. */
export function tryRotate(board: Board, p: Piece, dir = 1): Piece | null {
  const rot = (p.rot + dir + 4) & 3;
  for (const dx of [0, -1, 1, -2, 2]) {
    for (const dy of [0, -1]) {
      const cand = { ...p, rot, x: p.x + dx, y: p.y + dy };
      if (!collides(board, cand)) return cand;
    }
  }
  return null;
}

/** 7-bag randomizer. Two bags built from the same seed yield the same sequence. */
export class Bag {
  private readonly rng: Rng;
  private queue: number[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  private refill(): void {
    const bag = [0, 1, 2, 3, 4, 5, 6];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      [bag[i], bag[j]] = [bag[j]!, bag[i]!];
    }
    this.queue.push(...bag);
  }

  peek(): number {
    if (this.queue.length === 0) this.refill();
    return this.queue[0]!;
  }

  next(): number {
    if (this.queue.length === 0) this.refill();
    return this.queue.shift()!;
  }
}

// ---- bots ----

/** A bot's temperament. Greedy bots ride the stakes line; careful bots keep the well low. */
export interface BotProfile {
  name: string;
  /** Penalty per row of aggregate height (more negative = plays lower). */
  heightW: number;
  /** Reward for finishing a drop with the stack inside the stakes band (not too tall). */
  stakesW: number;
  /** Chance per piece to pick a worse placement by mistake. */
  mistake: number;
  /** Seconds between bot inputs. */
  step: number;
}

export const BOT_PROFILES: readonly BotProfile[] = [
  { name: "careful", heightW: -0.6, stakesW: 0, mistake: 0.03, step: 0.16 },
  { name: "greedy", heightW: -0.38, stakesW: 1.0, mistake: 0.05, step: 0.14 },
  { name: "wild", heightW: -0.45, stakesW: 0.6, mistake: 0.08, step: 0.12 },
] as const;

export const DEFAULT_PROFILE: BotProfile = { name: "plain", heightW: -0.51, stakesW: 0, mistake: 0, step: 0.14 };

/** Survival instinct: any bot plays it safe once the stack gets this tall. */
export const PANIC_HEIGHT = 14;
export const PANIC_PROFILE: BotProfile = { name: "panic", heightW: -0.7, stakesW: 0, mistake: 0, step: 0.12 };

export function evaluateBoard(board: Board, lines: number, powers = 0, profile: BotProfile = DEFAULT_PROFILE): number {
  const heights: number[] = [];
  let holes = 0;
  for (let x = 0; x < COLS; x++) {
    let h = 0;
    let seen = false;
    for (let y = 0; y < ROWS; y++) {
      if (board[y]![x] !== 0) {
        if (!seen) {
          seen = true;
          h = ROWS - y;
        }
      } else if (seen) {
        holes++;
      }
    }
    heights.push(h);
  }
  let agg = 0;
  let bump = 0;
  let top = 0;
  for (let x = 0; x < COLS; x++) {
    agg += heights[x]!;
    top = Math.max(top, heights[x]!);
    if (x > 0) bump += Math.abs(heights[x]! - heights[x - 1]!);
  }
  const stakes = top >= STAKES_HEIGHT && top <= STAKES_HEIGHT + 2 ? profile.stakesW : 0;
  return profile.heightW * agg + 0.76 * lines - 0.36 * holes - 0.18 * bump + 0.9 * powers + stakes;
}

export interface Placement {
  rot: number;
  x: number;
  score: number;
}

/**
 * Every legal rotation x column, hard-dropped from row `fromY` (the spawn row by
 * default), best first. Bots like clearing rows that hold power cells (including the
 * piece's own, `power`). Only spots the piece can actually turn and slide to from
 * (`fromX`, `fromY`) count. `onlyRot` limits the search to one rotation (re-planning a
 * piece that is already too low to turn).
 */
export function rankPlacements(
  board: Board,
  type: number,
  power = -1,
  profile: BotProfile = DEFAULT_PROFILE,
  fromY = spawnPiece(type).y,
  onlyRot = -1,
  fromX = spawnPiece(type).x,
): Placement[] {
  const out: Placement[] = [];
  for (let rot = 0; rot < 4; rot++) {
    if (onlyRot >= 0 && rot !== onlyRot) continue;
    // The bot turns first, then slides: both must be possible at this row.
    if (collides(board, { type, rot, x: fromX, y: fromY })) continue;
    for (let x = -3; x < COLS; x++) {
      const p: Piece = { type, rot, x, y: fromY };
      if (collides(board, p) || !slideClear(board, p, fromX)) continue;
      const landed = { ...p, y: dropY(board, p) };
      const copy = board.map((row) => row.slice());
      lockPiece(copy, landed, power);
      const powers = powersInFullRows(copy);
      const lines = clearLines(copy);
      out.push({ rot, x, score: evaluateBoard(copy, lines, powers, profile) });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** True when the piece can slide along its row from column `fromX` to its own column. */
export function slideClear(board: Board, p: Piece, fromX: number): boolean {
  const step = Math.sign(p.x - fromX);
  for (let x = fromX; x !== p.x; x += step) {
    if (collides(board, { ...p, x })) return false;
  }
  return true;
}

export function bestPlacement(board: Board, type: number, power = -1, profile: BotProfile = DEFAULT_PROFILE): Placement | null {
  return rankPlacements(board, type, power, profile)[0] ?? null;
}

/**
 * The placement a bot actually goes for: the best one, or with probability
 * `profile.mistake` the runner-up when it is nearly as good (a human-looking slip,
 * never a blunder). `roll` in [0,1).
 */
export function pickPlacement(ranked: readonly Placement[], profile: BotProfile, roll: number): Placement | null {
  const best = ranked[0];
  if (!best) return null;
  const second = ranked[1];
  if (roll >= profile.mistake || !second || best.score - second.score > 1) return best;
  return second;
}

import { Rng } from "../../core/rng";

/** Pure rules for Block Brawl: board, pieces, bag, garbage, bot heuristic. */

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

/** Garbage sent by a clear while on `chain` (chain already includes this clear). */
export function attackFor(lines: number, chain: number): number {
  return lines > 0 ? garbageFor(lines) + chainBonus(chain) : 0;
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

export function evaluateBoard(board: Board, lines: number, powers = 0): number {
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
  for (let x = 0; x < COLS; x++) {
    agg += heights[x]!;
    if (x > 0) bump += Math.abs(heights[x]! - heights[x - 1]!);
  }
  return -0.51 * agg + 0.76 * lines - 0.36 * holes - 0.18 * bump + 0.9 * powers;
}

export interface Placement {
  rot: number;
  x: number;
  score: number;
}

/**
 * Try every rotation x column, hard-dropped from the spawn row. Bots like
 * clearing rows that hold power cells (including the piece's own, `power`).
 */
export function bestPlacement(board: Board, type: number, power = -1): Placement | null {
  let best: Placement | null = null;
  const spawn = spawnPiece(type);
  for (let rot = 0; rot < 4; rot++) {
    for (let x = -3; x < COLS; x++) {
      const p: Piece = { type, rot, x, y: spawn.y };
      if (collides(board, p)) continue;
      const landed = { ...p, y: dropY(board, p) };
      const copy = board.map((row) => row.slice());
      lockPiece(copy, landed, power);
      const powers = powersInFullRows(copy);
      const lines = clearLines(copy);
      const score = evaluateBoard(copy, lines, powers);
      if (!best || score > best.score) best = { rot, x, score };
    }
  }
  return best;
}

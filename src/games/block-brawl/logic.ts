import { Rng } from "../../core/rng";

/** Pure rules for Block Brawl: board, pieces, bag, garbage, bot heuristic. */

export const COLS = 10;
export const ROWS = 20;
export const GARBAGE = 8;

/** 0 = empty, 1..7 = piece type + 1, 8 = garbage. Indexed board[row][col], row 0 at top. */
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

/** Write the piece into the board (mutates). */
export function lockPiece(board: Board, p: Piece): void {
  for (const [x, y] of pieceCells(p)) {
    if (y >= 0 && y < ROWS) board[y]![x] = p.type + 1;
  }
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

export function evaluateBoard(board: Board, lines: number): number {
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
  return -0.51 * agg + 0.76 * lines - 0.36 * holes - 0.18 * bump;
}

export interface Placement {
  rot: number;
  x: number;
  score: number;
}

/** Try every rotation x column, hard-dropped from the spawn row. */
export function bestPlacement(board: Board, type: number): Placement | null {
  let best: Placement | null = null;
  const spawn = spawnPiece(type);
  for (let rot = 0; rot < 4; rot++) {
    for (let x = -3; x < COLS; x++) {
      const p: Piece = { type, rot, x, y: spawn.y };
      if (collides(board, p)) continue;
      const landed = { ...p, y: dropY(board, p) };
      const copy = board.map((row) => row.slice());
      lockPiece(copy, landed);
      const lines = clearLines(copy);
      const score = evaluateBoard(copy, lines);
      if (!best || score > best.score) best = { rot, x, score };
    }
  }
  return best;
}

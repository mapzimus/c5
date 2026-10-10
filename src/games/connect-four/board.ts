/** Pure board rules for Drop Zone: placing, power discs, gravity and win checks. */

export const COLS = 7;
export const ROWS = 6;

export type Cell = string | null;
/** grid[row][col]; row 0 is the top. */
export type Grid = Cell[][];
export type DiscKind = "normal" | "bomb" | "anvil";

export interface Pos {
  r: number;
  c: number;
}

export interface WinLine {
  cells: Pos[];
  winner: string;
}

export interface Fall {
  c: number;
  fromR: number;
  toR: number;
  owner: string;
}

export function createGrid(rows = ROWS, cols = COLS): Grid {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, (): Cell => null));
}

export function cloneGrid(grid: Grid): Grid {
  return grid.map((row) => row.slice());
}

/** Lowest empty row in a column, or -1 when the column is full. */
export function topRow(grid: Grid, col: number): number {
  for (let r = grid.length - 1; r >= 0; r--) if (!grid[r]![col]) return r;
  return -1;
}

export function isFull(grid: Grid): boolean {
  return grid[0]!.every((cell) => cell !== null);
}

/** Can this disc kind be dropped in this column? Anvils smash through full columns. */
export function canDrop(grid: Grid, col: number, kind: DiscKind): boolean {
  if (col < 0 || col >= grid[0]!.length) return false;
  return kind === "anvil" || topRow(grid, col) >= 0;
}

/** Clears the 3x3 square centred on (row, col). Returns the discs it destroyed. */
export function bombBlast(grid: Grid, row: number, col: number): { cell: Pos; owner: string }[] {
  const destroyed: { cell: Pos; owner: string }[] = [];
  for (let r = row - 1; r <= row + 1; r++) {
    for (let c = col - 1; c <= col + 1; c++) {
      if (r < 0 || r >= grid.length || c < 0 || c >= grid[0]!.length) continue;
      const owner = grid[r]![c];
      if (owner) destroyed.push({ cell: { r, c }, owner });
      grid[r]![c] = null;
    }
  }
  return destroyed;
}

/** Wipes the whole column, then parks the anvil owner's disc on the bottom row. */
export function anvilSmash(grid: Grid, col: number, owner: string): { cell: Pos; owner: string }[] {
  const destroyed: { cell: Pos; owner: string }[] = [];
  for (let r = 0; r < grid.length; r++) {
    const o = grid[r]![col];
    if (o) destroyed.push({ cell: { r, c: col }, owner: o });
    grid[r]![col] = null;
  }
  grid[grid.length - 1]![col] = owner;
  return destroyed;
}

/** Drops every floating disc down its column. Returns the moves made. */
export function applyGravity(grid: Grid): Fall[] {
  const falls: Fall[] = [];
  for (let c = 0; c < grid[0]!.length; c++) {
    let write = grid.length - 1;
    for (let r = grid.length - 1; r >= 0; r--) {
      const owner = grid[r]![c];
      if (!owner) continue;
      if (r !== write) {
        grid[write]![c] = owner;
        grid[r]![c] = null;
        falls.push({ c, fromR: r, toR: write, owner });
      }
      write--;
    }
  }
  return falls;
}

const DIRS: [number, number][] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/** Every run of 4+ same-owner discs on the board, one line per run. */
export function findWins(grid: Grid): WinLine[] {
  const rows = grid.length;
  const cols = grid[0]!.length;
  const lines: WinLine[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const owner = grid[r]![c];
      if (!owner) continue;
      for (const [dr, dc] of DIRS) {
        // Only start counting at the beginning of a run.
        const pr = r - dr;
        const pc = c - dc;
        if (pr >= 0 && pr < rows && pc >= 0 && pc < cols && grid[pr]![pc] === owner) continue;
        const cells: Pos[] = [];
        let nr = r;
        let nc = c;
        while (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr]![nc] === owner) {
          cells.push({ r: nr, c: nc });
          nr += dr;
          nc += dc;
        }
        if (cells.length >= 4) lines.push({ cells, winner: owner });
      }
    }
  }
  return lines;
}

/** Who takes the round: the mover if they have a line, otherwise the first other line found. */
export function pickWinner(lines: WinLine[], moverId: string): string | null {
  if (lines.length === 0) return null;
  return lines.some((l) => l.winner === moverId) ? moverId : lines[0]!.winner;
}

export interface MoveResult {
  grid: Grid;
  /** Where the dropped piece came to rest before any blast/gravity. */
  landed: Pos;
  destroyed: { cell: Pos; owner: string }[];
  falls: Fall[];
  lines: WinLine[];
  winner: string | null;
}

/** Plays one move start to finish without touching the input grid. Null if illegal. */
export function playMove(grid: Grid, col: number, kind: DiscKind, owner: string): MoveResult | null {
  if (!canDrop(grid, col, kind)) return null;
  const next = cloneGrid(grid);
  let landed: Pos;
  let destroyed: { cell: Pos; owner: string }[] = [];
  let falls: Fall[] = [];
  if (kind === "anvil") {
    destroyed = anvilSmash(next, col, owner);
    landed = { r: next.length - 1, c: col };
  } else {
    landed = { r: topRow(next, col), c: col };
    if (kind === "normal") {
      next[landed.r]![col] = owner;
    } else {
      destroyed = bombBlast(next, landed.r, col);
      falls = applyGravity(next);
    }
  }
  const lines = findWins(next);
  return { grid: next, landed, destroyed, falls, lines, winner: pickWinner(lines, owner) };
}

/** Columns where `owner` would win right now with a plain disc. */
export function winningColumns(grid: Grid, owner: string): number[] {
  const out: number[] = [];
  for (let c = 0; c < grid[0]!.length; c++) {
    const res = playMove(grid, c, "normal", owner);
    if (res && res.winner === owner) out.push(c);
  }
  return out;
}

/** Pure board rules for Drop Zone: placing, power discs, gravity, tilts, line clears and scoring. */

export const COLS = 7;
export const ROWS = 6;
/** Points for a plain four. Longer lines and chains multiply it (see lineScore). */
export const LINE_POINTS = 100;

export type Cell = string | null;
/** grid[row][col]; row 0 is the top. */
export type Grid = Cell[][];
export type DiscKind = "normal" | "bomb" | "anvil";
export type TiltDir = "left" | "right";

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

export interface Slide {
  r: number;
  fromC: number;
  toC: number;
  owner: string;
}

/** One link of a chain: the lines found, every cell they cover, and the gravity moves after clearing. */
export interface ChainStep {
  chain: number;
  lines: WinLine[];
  cells: Pos[];
  falls: Fall[];
  points: Record<string, number>;
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

/** Every run of `needed`+ same-owner discs on the board, one line per run. */
export function findWins(grid: Grid, needed = 4): WinLine[] {
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
        if (cells.length >= needed) lines.push({ cells, winner: owner });
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

/** Columns where `owner` would make a line right now with a plain disc. */
export function winningColumns(grid: Grid, owner: string, needed = 4): number[] {
  const out: number[] = [];
  for (let c = 0; c < grid[0]!.length; c++) {
    const row = topRow(grid, c);
    if (row < 0) continue;
    grid[row]![c] = owner;
    const hit = findWins(grid, needed).some((l) => l.winner === owner);
    grid[row]![c] = null;
    if (hit) out.push(c);
  }
  return out;
}

/** How many in a row score: four head to head, three once the board is shared by three or four colours. */
export function lineLengthFor(playerCount: number): number {
  return playerCount >= 3 ? 3 : 4;
}

/** Points one line is worth: 100 for the needed length, +50 per extra disc, times the chain link (1, 2, 3...). */
export function lineScore(length: number, chain: number, needed = 4): number {
  return (LINE_POINTS + Math.max(0, length - needed) * 50) * Math.max(1, chain);
}

/** Distinct cells covered by a set of lines (a cross counts each cell once). */
export function lineCells(lines: WinLine[]): Pos[] {
  const seen = new Set<number>();
  const out: Pos[] = [];
  for (const line of lines) {
    for (const cell of line.cells) {
      const key = cell.r * 1000 + cell.c;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cell);
    }
  }
  return out;
}

/** Points per owner for these lines at this chain link. Every line pays its owner; crosses pay twice. */
export function scoreLines(lines: WinLine[], chain: number, needed = 4): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of lines) out[line.winner] = (out[line.winner] ?? 0) + lineScore(line.cells.length, chain, needed);
  return out;
}

/** Empties the given cells. */
export function clearCells(grid: Grid, cells: Pos[]): void {
  for (const { r, c } of cells) grid[r]![c] = null;
}

/**
 * Clears every line on the board, drops what was above, and repeats while new lines form.
 * Mutates the grid and returns one step per chain link (empty when nothing lined up).
 */
export function settle(grid: Grid, needed = 4, startChain = 1, maxSteps = 12): ChainStep[] {
  const steps: ChainStep[] = [];
  for (let i = 0; i < maxSteps; i++) {
    const lines = findWins(grid, needed);
    if (lines.length === 0) break;
    const chain = startChain + i;
    const cells = lineCells(lines);
    clearCells(grid, cells);
    const falls = applyGravity(grid);
    steps.push({ chain, lines, cells, falls, points: scoreLines(lines, chain, needed) });
  }
  return steps;
}

/** Sums the points of several chain steps per owner. */
export function totalPoints(steps: ChainStep[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const step of steps) {
    for (const [id, pts] of Object.entries(step.points)) out[id] = (out[id] ?? 0) + pts;
  }
  return out;
}

/**
 * The Tilt: every row packs toward one side, keeping the order of its discs, as if the board were
 * rocked sideways. Call applyGravity afterwards to let the stacks drop back down. Returns the moves.
 */
export function tiltSlide(grid: Grid, dir: TiltDir): Slide[] {
  const slides: Slide[] = [];
  const cols = grid[0]!.length;
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r]!;
    const order = dir === "left"
      ? Array.from({ length: cols }, (_, c) => c)
      : Array.from({ length: cols }, (_, c) => cols - 1 - c);
    const next: Cell[] = Array.from({ length: cols }, (): Cell => null);
    let write = 0;
    for (const c of order) {
      const owner = row[c];
      if (!owner) continue;
      const toC = order[write]!;
      next[toC] = owner;
      if (toC !== c) slides.push({ r, fromC: c, toC, owner });
      write++;
    }
    grid[r] = next;
  }
  return slides;
}

export interface TiltResult {
  grid: Grid;
  slides: Slide[];
  falls: Fall[];
  steps: ChainStep[];
  points: Record<string, number>;
}

/** Plays a whole tilt (slide, drop, clear chains) on a copy of the grid. */
export function previewTilt(grid: Grid, dir: TiltDir, needed = 4): TiltResult {
  const next = cloneGrid(grid);
  const slides = tiltSlide(next, dir);
  const falls = applyGravity(next);
  const steps = settle(next, needed);
  return { grid: next, slides, falls, steps, points: totalPoints(steps) };
}

/** Which way the board tilts: heavier side wins, a tie goes to the most recent vote, no votes keeps the default. */
export function tallyTilt(
  votes: { dir: TiltDir; weight: number }[],
  lastVote: TiltDir | null,
  fallback: TiltDir,
): TiltDir {
  let left = 0;
  let right = 0;
  for (const v of votes) {
    if (v.dir === "left") left += v.weight;
    else right += v.weight;
  }
  if (left > right) return "left";
  if (right > left) return "right";
  return lastVote ?? fallback;
}

export interface SimResult {
  grid: Grid;
  landed: Pos;
  destroyed: { cell: Pos; owner: string }[];
  steps: ChainStep[];
  points: Record<string, number>;
}

/**
 * A full move as the match plays it: drop (or blast), then clear every chain. If `tilt` is given the
 * board also tilts that way afterwards, as it does for the last drop before a tilt. Null if illegal.
 */
export function simulateMove(grid: Grid, col: number, kind: DiscKind, owner: string, tilt: TiltDir | null = null, needed = 4): SimResult | null {
  const move = playMove(grid, col, kind, owner);
  if (!move) return null;
  const next = move.grid;
  const steps = settle(next, needed);
  if (tilt) {
    const after = previewTilt(next, tilt, needed);
    return { grid: after.grid, landed: move.landed, destroyed: move.destroyed, steps: steps.concat(after.steps), points: totalPoints(steps.concat(after.steps)) };
  }
  return { grid: next, landed: move.landed, destroyed: move.destroyed, steps, points: totalPoints(steps) };
}

/** Players sitting on the lowest score when someone is ahead of them; nobody when all are level. */
export function underdogs(scores: Record<string, number>): string[] {
  const ids = Object.keys(scores);
  if (ids.length < 2) return [];
  const values = ids.map((id) => scores[id] ?? 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [];
  return ids.filter((id) => (scores[id] ?? 0) === min);
}

/**
 * Scatters `perPlayer` discs of every owner onto the board at random, settled, with nothing lined up.
 * The zone never starts empty, so the first tilt already has something to throw around.
 */
export function seedGrid(grid: Grid, owners: string[], perPlayer: number, random: () => number, needed = 4): Pos[] {
  const placed: Pos[] = [];
  const cols = grid[0]!.length;
  const queue: string[] = [];
  for (let i = 0; i < perPlayer; i++) for (const o of owners) queue.push(o);
  for (const owner of queue) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const c = Math.floor(random() * cols);
      const r = topRow(grid, c);
      if (r < 0) continue;
      grid[r]![c] = owner;
      if (findWins(grid, needed).length === 0) {
        placed.push({ r, c });
        break;
      }
      grid[r]![c] = null;
    }
  }
  return placed;
}

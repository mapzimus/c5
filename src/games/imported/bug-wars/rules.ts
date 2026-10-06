import type { Rng } from "../../../core/rng";

/**
 * Bug Wars rules: a hex garden, a stack of bugs on every tile, dice for fights.
 * Everything here is pure and DOM-free so it can be unit tested and driven by bots.
 */

export const COLS = 8;
export const ROWS = 5;
/** Cells turned into stones so the garden has shape. Lowered if it would split the map. */
export const HOLES = 10;
export const MAX_BUGS = 8;
/** Bugs per owned tile at the start (one is always on the tile, the rest land at random). */
export const START_BUGS_PER_TILE = 3;
/** Reinforcements that don't fit on the board wait in the nest, up to this many. */
export const STASH_MAX = 12;
export const MAX_ROUNDS = 8;
export const NO_OWNER = -1;

export type Species = "ants" | "bees" | "beetles" | "spiders";
export const SPECIES: readonly Species[] = ["ants", "bees", "beetles", "spiders"];
export const SPECIES_NAMES: Record<Species, string> = {
  ants: "Ants",
  bees: "Bees",
  beetles: "Beetles",
  spiders: "Spiders",
};

export interface Tile {
  id: number;
  col: number;
  row: number;
  /** Seat index, or NO_OWNER. Every land tile starts owned. */
  owner: number;
  bugs: number;
}

export interface Board {
  cols: number;
  rows: number;
  tiles: Tile[];
  /** Neighbouring tile ids, indexed by tile id. */
  adjacency: number[][];
  /** Cells that are stones, as "col,row". */
  holes: Set<string>;
}

export interface Battle {
  from: number;
  to: number;
  attacker: number;
  defender: number;
  attackRolls: number[];
  defendRolls: number[];
  attackSum: number;
  defendSum: number;
  captured: boolean;
}

export function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

/** Pointy-top hexes in odd-r offset coordinates (odd rows shift right). */
export function hexNeighbours(col: number, row: number, cols: number, rows: number): { col: number; row: number }[] {
  const odd = row % 2 === 1;
  const candidates = odd
    ? [
        [col - 1, row],
        [col + 1, row],
        [col, row - 1],
        [col + 1, row - 1],
        [col, row + 1],
        [col + 1, row + 1],
      ]
    : [
        [col - 1, row],
        [col + 1, row],
        [col - 1, row - 1],
        [col, row - 1],
        [col - 1, row + 1],
        [col, row + 1],
      ];
  return candidates
    .filter(([c, r]) => c! >= 0 && c! < cols && r! >= 0 && r! < rows)
    .map(([c, r]) => ({ col: c!, row: r! }));
}

function connected(cells: { col: number; row: number }[], cols: number, rows: number): boolean {
  if (cells.length === 0) return false;
  const land = new Set(cells.map((cell) => cellKey(cell.col, cell.row)));
  const seen = new Set<string>();
  const stack = [cells[0]!];
  seen.add(cellKey(cells[0]!.col, cells[0]!.row));
  while (stack.length > 0) {
    const cell = stack.pop()!;
    for (const next of hexNeighbours(cell.col, cell.row, cols, rows)) {
      const key = cellKey(next.col, next.row);
      if (!land.has(key) || seen.has(key)) continue;
      seen.add(key);
      stack.push(next);
    }
  }
  return seen.size === land.size;
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    const a = items[i]!;
    items[i] = items[j]!;
    items[j] = a;
  }
  return items;
}

export interface BoardOptions {
  cols?: number;
  rows?: number;
  holes?: number;
  bugsPerTile?: number;
}

/** A connected garden with stones punched out, dealt evenly to every seat. */
export function generateBoard(rng: Rng, playerCount: number, options: BoardOptions = {}): Board {
  const cols = options.cols ?? COLS;
  const rows = options.rows ?? ROWS;
  const bugsPerTile = options.bugsPerTile ?? START_BUGS_PER_TILE;
  let holes = Math.min(options.holes ?? HOLES, cols * rows - playerCount);
  const all: { col: number; row: number }[] = [];
  for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) all.push({ col, row });

  let land = all;
  let holeSet = new Set<string>();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const order = shuffle([...all], rng);
    const picked = order.slice(0, holes);
    holeSet = new Set(picked.map((cell) => cellKey(cell.col, cell.row)));
    land = all.filter((cell) => !holeSet.has(cellKey(cell.col, cell.row)));
    if (connected(land, cols, rows)) break;
    if (attempt % 10 === 9 && holes > 0) holes -= 1;
    if (attempt === 59) {
      holeSet = new Set();
      land = all;
    }
  }

  const tiles: Tile[] = land.map((cell, id) => ({ id, col: cell.col, row: cell.row, owner: NO_OWNER, bugs: 1 }));
  const byKey = new Map(tiles.map((tile) => [cellKey(tile.col, tile.row), tile.id]));
  const adjacency = tiles.map((tile) =>
    hexNeighbours(tile.col, tile.row, cols, rows)
      .map((cell) => byKey.get(cellKey(cell.col, cell.row)))
      .filter((id): id is number => id !== undefined),
  );

  const deal = shuffle(tiles.map((tile) => tile.id), rng);
  deal.forEach((id, index) => {
    tiles[id]!.owner = index % playerCount;
  });

  const board: Board = { cols, rows, tiles, adjacency, holes: holeSet };
  for (let seat = 0; seat < playerCount; seat += 1) {
    const extra = tilesOwned(board, seat) * (bugsPerTile - 1);
    reinforce(board, seat, extra, rng);
  }
  return board;
}

export function tilesOwned(board: Board, seat: number): number {
  return board.tiles.filter((tile) => tile.owner === seat).length;
}

export function bugsOwned(board: Board, seat: number): number {
  return board.tiles.filter((tile) => tile.owner === seat).reduce((sum, tile) => sum + tile.bugs, 0);
}

export function isAlive(board: Board, seat: number): boolean {
  return board.tiles.some((tile) => tile.owner === seat);
}

export function aliveSeats(board: Board, playerCount: number): number[] {
  const seats: number[] = [];
  for (let seat = 0; seat < playerCount; seat += 1) if (isAlive(board, seat)) seats.push(seat);
  return seats;
}

export function isAdjacent(board: Board, a: number, b: number): boolean {
  return board.adjacency[a]?.includes(b) ?? false;
}

/** A tile can attack when it belongs to the seat, holds 2+ bugs, and the target is a neighbouring enemy. */
export function canAttack(board: Board, from: number, to: number, seat: number): boolean {
  const source = board.tiles[from];
  const target = board.tiles[to];
  if (!source || !target) return false;
  if (source.owner !== seat || source.bugs < 2) return false;
  if (target.owner === seat) return false;
  return isAdjacent(board, from, to);
}

/** Tiles this seat can launch an attack from right now. */
export function attackers(board: Board, seat: number): number[] {
  return board.tiles
    .filter((tile) => tile.owner === seat && tile.bugs >= 2)
    .filter((tile) => board.adjacency[tile.id]!.some((id) => board.tiles[id]!.owner !== seat))
    .map((tile) => tile.id);
}

/** Enemy neighbours a tile could hit (empty when it can't attack at all). */
export function targetsFrom(board: Board, from: number): number[] {
  const source = board.tiles[from];
  if (!source || source.bugs < 2) return [];
  return board.adjacency[from]!.filter((id) => board.tiles[id]!.owner !== source.owner);
}

export function hasAnyAttack(board: Board, seat: number): boolean {
  return attackers(board, seat).length > 0;
}

export function rollDice(rng: Rng, count: number): number[] {
  return Array.from({ length: count }, () => rng.int(1, 6));
}

/** Roll a fight without touching the board. Attacker needs strictly more; ties go to the defender. */
export function rollBattle(board: Board, from: number, to: number, rng: Rng): Battle {
  const source = board.tiles[from]!;
  const target = board.tiles[to]!;
  if (!canAttack(board, from, to, source.owner)) throw new Error(`Illegal attack ${from} -> ${to}`);
  const attackRolls = rollDice(rng, source.bugs);
  const defendRolls = rollDice(rng, target.bugs);
  const attackSum = attackRolls.reduce((a, b) => a + b, 0);
  const defendSum = defendRolls.reduce((a, b) => a + b, 0);
  return {
    from,
    to,
    attacker: source.owner,
    defender: target.owner,
    attackRolls,
    defendRolls,
    attackSum,
    defendSum,
    captured: attackSum > defendSum,
  };
}

/** Move the swarm on a win (one bug stays home); a loss leaves the attacker with one bug. */
export function applyBattle(board: Board, battle: Battle): void {
  const source = board.tiles[battle.from]!;
  const target = board.tiles[battle.to]!;
  if (battle.captured) {
    target.owner = battle.attacker;
    target.bugs = source.bugs - 1;
  }
  source.bugs = 1;
}

/** Size of the biggest connected patch this seat owns: that's the end-of-turn income. */
export function largestRegion(board: Board, seat: number): number {
  const seen = new Set<number>();
  let best = 0;
  for (const tile of board.tiles) {
    if (tile.owner !== seat || seen.has(tile.id)) continue;
    let size = 0;
    const stack = [tile.id];
    seen.add(tile.id);
    while (stack.length > 0) {
      const id = stack.pop()!;
      size += 1;
      for (const next of board.adjacency[id]!) {
        if (seen.has(next) || board.tiles[next]!.owner !== seat) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    best = Math.max(best, size);
  }
  return best;
}

/** Drop `amount` bugs one at a time on random owned tiles with room. Returns where they landed and what's left. */
export function reinforce(board: Board, seat: number, amount: number, rng: Rng): { placed: number[]; leftover: number } {
  const placed: number[] = [];
  let left = amount;
  while (left > 0) {
    const room = board.tiles.filter((tile) => tile.owner === seat && tile.bugs < MAX_BUGS);
    if (room.length === 0) break;
    const tile = rng.pick(room);
    tile.bugs += 1;
    placed.push(tile.id);
    left -= 1;
  }
  return { placed, leftover: left };
}

/** End of turn: income (biggest patch + stash) lands on the board, the rest waits in the nest. */
export function endTurnIncome(board: Board, seat: number, stash: number, rng: Rng): { income: number; placed: number[]; stash: number } {
  const income = largestRegion(board, seat) + stash;
  const result = reinforce(board, seat, income, rng);
  return { income, placed: result.placed, stash: Math.min(STASH_MAX, result.leftover) };
}

/** Next living seat after `current` in seat order, and whether the order wrapped (a new round). */
export function nextSeat(board: Board, playerCount: number, current: number): { seat: number; wrapped: boolean } | null {
  for (let step = 1; step <= playerCount; step += 1) {
    const seat = (current + step) % playerCount;
    if (!isAlive(board, seat)) continue;
    return { seat, wrapped: seat <= current };
  }
  return null;
}

export interface AttackChoice {
  from: number;
  to: number;
}

/**
 * Bot: attack when it has more bugs than the target, biggest edge first (bigger prize on ties).
 * A full stack will also gamble on an equal fight, which keeps late games moving.
 */
export function botPickAttack(board: Board, seat: number, rng: Rng): AttackChoice | null {
  const options: { choice: AttackChoice; score: number }[] = [];
  for (const from of attackers(board, seat)) {
    const source = board.tiles[from]!;
    for (const to of targetsFrom(board, from)) {
      const target = board.tiles[to]!;
      const edge = source.bugs - target.bugs;
      if (edge <= 0 && !(edge === 0 && source.bugs >= MAX_BUGS - 1)) continue;
      options.push({ choice: { from, to }, score: edge * 10 + target.bugs + rng.float(0, 0.5) });
    }
  }
  if (options.length === 0) return null;
  options.sort((a, b) => b.score - a.score);
  return options[0]!.choice;
}

/** Game over when one seat holds the whole garden or the round cap has passed. */
export function gameOver(board: Board, playerCount: number, round: number): "conquered" | "rounds" | null {
  if (aliveSeats(board, playerCount).length <= 1) return "conquered";
  if (round > MAX_ROUNDS) return "rounds";
  return null;
}

export function speciesFor(slot: number): Species {
  return SPECIES[slot % SPECIES.length]!;
}

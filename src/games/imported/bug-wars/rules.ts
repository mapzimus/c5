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

/** Snacks and gadgets lying on a tile. Whoever captures the tile triggers it. */
export type ItemKind = "cake" | "firecracker" | "egg" | "pepper" | "trap";

export interface Tile {
  id: number;
  col: number;
  row: number;
  /** Seat index, or NO_OWNER. Every land tile starts owned. */
  owner: number;
  bugs: number;
  item?: ItemKind | null;
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
  /** Extra dice from bonuses (revenge, pepper, frenzy). */
  attackBonus?: number;
  /** Extra dice from bonuses (last stand). */
  defendBonus?: number;
  /** Three or more matching dice: attack auto-wins, defence auto-holds (defence wins if both). */
  jackpot?: "attack" | "defend" | null;
}

/** Bonus dice on top of the bug count. */
export interface BattleMods {
  attackDice?: number;
  defendDice?: number;
}

/** A roll of this many dice or more that all match is a jackpot. */
export const JACKPOT_MIN_DICE = 3;

export function isJackpot(rolls: readonly number[]): boolean {
  return rolls.length >= JACKPOT_MIN_DICE && rolls.every((d) => d === rolls[0]);
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

  const tiles: Tile[] = land.map((cell, id) => ({ id, col: cell.col, row: cell.row, owner: NO_OWNER, bugs: 1, item: null }));
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

/**
 * Roll a fight without touching the board. Attacker needs strictly more; ties go to the defender.
 * Jackpots (3+ matching dice) override the sums, and a defending jackpot beats an attacking one.
 */
export function rollBattle(board: Board, from: number, to: number, rng: Rng, mods: BattleMods = {}): Battle {
  const source = board.tiles[from]!;
  const target = board.tiles[to]!;
  if (!canAttack(board, from, to, source.owner)) throw new Error(`Illegal attack ${from} -> ${to}`);
  const attackBonus = Math.max(0, Math.floor(mods.attackDice ?? 0));
  const defendBonus = Math.max(0, Math.floor(mods.defendDice ?? 0));
  const attackRolls = rollDice(rng, source.bugs + attackBonus);
  const defendRolls = rollDice(rng, target.bugs + defendBonus);
  return judgeBattle(from, to, source.owner, target.owner, attackRolls, defendRolls, attackBonus, defendBonus);
}

/** Score already-rolled dice. Split out so the rule is testable with fixed dice. */
export function judgeBattle(
  from: number,
  to: number,
  attacker: number,
  defender: number,
  attackRolls: number[],
  defendRolls: number[],
  attackBonus = 0,
  defendBonus = 0,
): Battle {
  const attackSum = attackRolls.reduce((a, b) => a + b, 0);
  const defendSum = defendRolls.reduce((a, b) => a + b, 0);
  const jackpot = isJackpot(defendRolls) ? "defend" : isJackpot(attackRolls) ? "attack" : null;
  const captured = jackpot === "defend" ? false : jackpot === "attack" ? true : attackSum > defendSum;
  return {
    from,
    to,
    attacker,
    defender,
    attackRolls,
    defendRolls,
    attackSum,
    defendSum,
    captured,
    attackBonus,
    defendBonus,
    jackpot,
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
export function endTurnIncome(board: Board, seat: number, stash: number, rng: Rng, bonus = 0): { income: number; placed: number[]; stash: number } {
  const income = largestRegion(board, seat) + stash + Math.max(0, bonus);
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

export interface BotOptions {
  /** Smallest bug edge worth attacking at (default 1). Reckless bots use 0 or -1. */
  minEdge?: number;
  /** Extra score for a target tile (items, grudges, the leader...). */
  favour?: (to: number) => number;
  /** Random noise added to every option score (chaotic bots). */
  noise?: number;
  /** Bonus dice the bot would bring, counted as bugs when judging the edge. */
  bonusDice?: (to: number) => number;
}

/**
 * Bot: attack when it has more bugs than the target, biggest edge first (bigger prize on ties).
 * A full stack will also gamble on an equal fight, which keeps late games moving.
 * Personas tune it with `options`.
 */
export function botPickAttack(board: Board, seat: number, rng: Rng, options: BotOptions = {}): AttackChoice | null {
  const minEdge = options.minEdge ?? 1;
  const noise = options.noise ?? 0.5;
  const choices: { choice: AttackChoice; score: number }[] = [];
  for (const from of attackers(board, seat)) {
    const source = board.tiles[from]!;
    for (const to of targetsFrom(board, from)) {
      const target = board.tiles[to]!;
      const edge = source.bugs + (options.bonusDice?.(to) ?? 0) - target.bugs;
      const gamble = edge === 0 && source.bugs >= MAX_BUGS - 1;
      if (edge < minEdge && !gamble) continue;
      choices.push({ choice: { from, to }, score: edge * 10 + target.bugs + (options.favour?.(to) ?? 0) + rng.float(0, noise) });
    }
  }
  if (choices.length === 0) return null;
  choices.sort((a, b) => b.score - a.score);
  return choices[0]!.choice;
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

const sumCache = new Map<number, number[]>();

/** Probability distribution of the sum of `count` d6 (index = sum). */
export function diceSumDistribution(count: number): number[] {
  const cached = sumCache.get(count);
  if (cached) return cached;
  let dist = [1];
  for (let n = 0; n < count; n += 1) {
    const next = new Array(dist.length + 6).fill(0);
    dist.forEach((p, sum) => {
      if (p === 0) return;
      for (let face = 1; face <= 6; face += 1) next[sum + face] += p / 6;
    });
    dist = next;
  }
  sumCache.set(count, dist);
  return dist;
}

/** Chance the attacker's sum beats the defender's (ignores jackpots, which are rare). */
export function winChance(attackDice: number, defendDice: number): number {
  const a = diceSumDistribution(attackDice);
  const d = diceSumDistribution(defendDice);
  let below = 0;
  let chance = 0;
  for (let sum = 0; sum < a.length; sum += 1) {
    chance += (a[sum] ?? 0) * below;
    below += d[sum] ?? 0;
  }
  return chance;
}

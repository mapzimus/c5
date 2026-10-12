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
/** Classic round cap; party matches use `roundsFor(playerCount)` instead. */
export const MAX_ROUNDS = 8;
export const NO_OWNER = -1;
/** Actions per turn for every seat, human or bot: an attack or a march costs one. */
export const AP_PER_TURN = 3;
/** The final round is a frenzy: one extra action for everyone. */
export const FINAL_ROUND_AP = 4;
/** How many times a swarm may press on after a capture before it must dig in. */
export const SURGE_MAX = 3;
/** A swarm needs this many bugs on the captured tile to press on. */
export const SURGE_MIN_BUGS = 3;
/** Human turn clock in seconds; the turn ends on its own when it runs out. */
export const TURN_SECONDS = 15;
/** Seconds a human ghost gets to pick a tile to stomp. */
export const STOMP_SECONDS = 6;
/** Extra income for the seat with the fewest tiles. */
export const UNDERDOG_INCOME = 2;

/** Round cap by table size so a party match stays near a minute. */
export function roundsFor(playerCount: number): number {
  return playerCount <= 2 ? 4 : 3;
}

export function isFinalRound(round: number, maxRounds: number): boolean {
  return round >= maxRounds;
}

export function apFor(round: number, maxRounds: number): number {
  return isFinalRound(round, maxRounds) ? FINAL_ROUND_AP : AP_PER_TURN;
}

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
  /** Extra dice the attacker rolled (surge momentum). */
  bonusDice: number;
  /** Underdog privilege: an equal sum counts as a win for the attacker. */
  tiesWin: boolean;
  /** 0 for a normal attack, 1..SURGE_MAX for a press-on after a capture. */
  surge: number;
}

export interface BattleOptions {
  bonusDice?: number;
  tiesWin?: boolean;
  surge?: number;
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

/**
 * Roll a fight without touching the board. Attacker needs strictly more; ties go to the defender,
 * unless the attacker is the underdog (`tiesWin`). Surge momentum adds bonus dice.
 */
export function rollBattle(board: Board, from: number, to: number, rng: Rng, options: BattleOptions = {}): Battle {
  const source = board.tiles[from]!;
  const target = board.tiles[to]!;
  if (!canAttack(board, from, to, source.owner)) throw new Error(`Illegal attack ${from} -> ${to}`);
  const bonusDice = Math.max(0, options.bonusDice ?? 0);
  const tiesWin = options.tiesWin ?? false;
  const attackRolls = rollDice(rng, source.bugs + bonusDice);
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
    captured: attackSum > defendSum || (tiesWin && attackSum === defendSum),
    bonusDice,
    tiesWin,
    surge: options.surge ?? 0,
  };
}

const sumCache = new Map<number, number[]>();

/** Probability mass of the sum of `dice` six-sided dice, indexed by sum. */
export function sumDistribution(dice: number): number[] {
  const count = Math.max(0, Math.floor(dice));
  const cached = sumCache.get(count);
  if (cached) return cached;
  let dist = [1];
  for (let i = 0; i < count; i += 1) {
    const next = new Array<number>(dist.length + 6).fill(0);
    for (let sum = 0; sum < dist.length; sum += 1) {
      const p = dist[sum]!;
      if (p === 0) continue;
      for (let face = 1; face <= 6; face += 1) next[sum + face] = (next[sum + face] ?? 0) + p / 6;
    }
    dist = next;
  }
  sumCache.set(count, dist);
  return dist;
}

/** Exact chance that `attackDice` d6 beat `defendDice` d6 under the real fight rules. */
export function winChance(attackDice: number, defendDice: number, tiesWin = false): number {
  if (attackDice <= 0) return 0;
  const attack = sumDistribution(attackDice);
  const defend = sumDistribution(defendDice);
  const below: number[] = [];
  let run = 0;
  for (let sum = 0; sum < defend.length; sum += 1) {
    below[sum] = run;
    run += defend[sum]!;
  }
  let total = 0;
  for (let sum = 0; sum < attack.length; sum += 1) {
    const p = attack[sum]!;
    if (p === 0) continue;
    const lower = sum >= below.length ? 1 : below[sum]!;
    const equal = defend[sum] ?? 0;
    total += p * (lower + (tiesWin ? equal : 0));
  }
  return Math.min(1, total);
}

/** Win chance of a concrete attack on the board (0 when it is not legal). */
export function attackChance(board: Board, from: number, to: number, options: BattleOptions = {}): number {
  const source = board.tiles[from];
  const target = board.tiles[to];
  if (!source || !target || !canAttack(board, from, to, source.owner)) return 0;
  return winChance(source.bugs + (options.bonusDice ?? 0), target.bugs, options.tiesWin ?? false);
}

/** A routed surge: the tile the swarm pressed from goes back to who held it, with a single bug. */
export function revertTile(board: Board, id: number, owner: number): void {
  const tile = board.tiles[id];
  if (!tile) return;
  tile.owner = owner;
  tile.bugs = 1;
}

/** Friendly neighbours a stack of 2+ could march into (tiles with room). */
export function marchTargets(board: Board, from: number): number[] {
  const source = board.tiles[from];
  if (!source || source.bugs < 2 || source.owner === NO_OWNER) return [];
  return board.adjacency[from]!.filter((id) => {
    const tile = board.tiles[id]!;
    return tile.owner === source.owner && tile.bugs < MAX_BUGS;
  });
}

export function canMarch(board: Board, from: number, to: number, seat: number): boolean {
  const source = board.tiles[from];
  if (!source || source.owner !== seat) return false;
  return marchTargets(board, from).includes(to);
}

/** Move every bug but one into a neighbouring friendly tile (up to its cap). Returns how many moved. */
export function applyMarch(board: Board, from: number, to: number): number {
  const source = board.tiles[from]!;
  const target = board.tiles[to]!;
  const moved = Math.max(0, Math.min(source.bugs - 1, MAX_BUGS - target.bugs));
  source.bugs -= moved;
  target.bugs += moved;
  return moved;
}

/** Tiles this seat can act from: attack or march. */
export function hasAnyAction(board: Board, seat: number): boolean {
  return board.tiles.some((tile) => tile.owner === seat && tile.bugs >= 2 && (targetsFrom(board, tile.id).length > 0 || marchTargets(board, tile.id).length > 0));
}

/** A ghost's boot: the stack loses half its bugs (at least one always survives). Returns bugs lost. */
export function stompTile(board: Board, id: number): number {
  const tile = board.tiles[id];
  if (!tile) return 0;
  const after = Math.max(1, Math.floor(tile.bugs / 2));
  const lost = tile.bugs - after;
  tile.bugs = after;
  return lost;
}

/** Seat with the most tiles (first on ties), or -1 when nobody is alive. */
export function leaderSeat(board: Board, playerCount: number): number {
  let best = -1;
  let bestTiles = 0;
  for (let seat = 0; seat < playerCount; seat += 1) {
    const tiles = tilesOwned(board, seat);
    if (tiles > bestTiles) {
      bestTiles = tiles;
      best = seat;
    }
  }
  return best;
}

/** The living seat with strictly the fewest tiles, or -1 when there is a tie or fewer than two seats left. */
export function underdogSeat(board: Board, playerCount: number): number {
  const alive = aliveSeats(board, playerCount);
  if (alive.length < 2) return -1;
  let best = -1;
  let bestTiles = Number.POSITIVE_INFINITY;
  let tied = false;
  for (const seat of alive) {
    const tiles = tilesOwned(board, seat);
    if (tiles < bestTiles) {
      bestTiles = tiles;
      best = seat;
      tied = false;
    } else if (tiles === bestTiles) {
      tied = true;
    }
  }
  return tied ? -1 : best;
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
  /** Chance the bot takes its second-best option instead of the best (a human-like slip). */
  mistakeChance?: number;
  /** The bot is the underdog this turn: ties go to it. */
  tiesWin?: boolean;
  /** Lowest win chance it will attack at. Full stacks gamble a little lower. */
  minChance?: number;
}

/**
 * Bot: attack where the real win chance is good, best odds first (bigger prize on ties).
 * A full stack will also gamble on a coin flip, which keeps late games moving.
 */
export function botPickAttack(board: Board, seat: number, rng: Rng, options: BotOptions = {}): AttackChoice | null {
  const minChance = options.minChance ?? 0.55;
  const scored: { choice: AttackChoice; score: number }[] = [];
  for (const from of attackers(board, seat)) {
    const source = board.tiles[from]!;
    for (const to of targetsFrom(board, from)) {
      const target = board.tiles[to]!;
      const chance = winChance(source.bugs, target.bugs, options.tiesWin ?? false);
      const floor = source.bugs >= MAX_BUGS - 1 ? Math.min(minChance, 0.45) : minChance;
      if (chance < floor) continue;
      scored.push({ choice: { from, to }, score: chance * 100 + target.bugs * 2 + rng.float(0, 6) });
    }
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  const slip = options.mistakeChance ?? 0;
  if (scored.length > 1 && slip > 0 && rng.next() < slip) return scored[1]!.choice;
  return scored[0]!.choice;
}

/** Bot surge: press on from a fresh capture when the odds (with momentum dice) clear `threshold`. */
export function botPickSurge(board: Board, from: number, bonusDice: number, tiesWin: boolean, threshold: number): { to: number; chance: number } | null {
  let best: { to: number; chance: number } | null = null;
  for (const to of targetsFrom(board, from)) {
    const chance = attackChance(board, from, to, { bonusDice, tiesWin });
    if (!best || chance > best.chance) best = { to, chance };
  }
  return best && best.chance >= threshold ? best : null;
}

/** Bot march: shove an idle interior stack toward a border tile that has room. */
export function botPickMarch(board: Board, seat: number): AttackChoice | null {
  let best: { choice: AttackChoice; score: number } | null = null;
  for (const tile of board.tiles) {
    if (tile.owner !== seat || tile.bugs < 3) continue;
    if (targetsFrom(board, tile.id).length > 0) continue;
    for (const to of marchTargets(board, tile.id)) {
      const target = board.tiles[to]!;
      const frontline = board.adjacency[to]!.some((id) => board.tiles[id]!.owner !== seat);
      if (!frontline) continue;
      const score = tile.bugs * 2 + (MAX_BUGS - target.bugs);
      if (!best || score > best.score) best = { choice: { from: tile.id, to }, score };
    }
  }
  return best?.choice ?? null;
}

/** Ghost bot: stomp the leader's fattest stack (any big stack if the leader has none). */
export function botPickStomp(board: Board, playerCount: number, rng: Rng): number | null {
  const leader = leaderSeat(board, playerCount);
  const pool = board.tiles.filter((tile) => tile.owner === leader && tile.bugs >= 2);
  const candidates = pool.length > 0 ? pool : board.tiles.filter((tile) => tile.owner !== NO_OWNER && tile.bugs >= 2);
  if (candidates.length === 0) return null;
  const most = Math.max(...candidates.map((tile) => tile.bugs));
  return rng.pick(candidates.filter((tile) => tile.bugs === most)).id;
}

/** Game over when one seat holds the whole garden or the round cap has passed. */
export function gameOver(board: Board, playerCount: number, round: number, maxRounds = MAX_ROUNDS): "conquered" | "rounds" | null {
  if (aliveSeats(board, playerCount).length <= 1) return "conquered";
  if (round > maxRounds) return "rounds";
  return null;
}

export function speciesFor(slot: number): Species {
  return SPECIES[slot % SPECIES.length]!;
}

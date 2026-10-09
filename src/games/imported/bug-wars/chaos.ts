import type { Rng } from "../../../core/rng";
import {
  MAX_BUGS,
  MAX_ROUNDS,
  NO_OWNER,
  STASH_MAX,
  type Board,
  type BotOptions,
  type ItemKind,
  aliveSeats,
  bugsOwned,
  tilesOwned,
} from "./rules";

/**
 * Bug Wars chaos layer: garden snacks, backyard disasters, comeback bonuses,
 * bot personalities and trash talk. Pure and DOM-free like rules.ts.
 */

// ---------------------------------------------------------------- items

export const ITEM_INFO: Record<ItemKind, { emoji: string; name: string; blurb: string }> = {
  cake: { emoji: "\u{1F370}", name: "SUGAR RUSH", blurb: "+3 bugs here" },
  firecracker: { emoji: "\u{1F9E8}", name: "KABOOM", blurb: "neighbours lose half" },
  egg: { emoji: "\u{1F95A}", name: "BABY BOOM", blurb: "+5 bugs in the nest" },
  pepper: { emoji: "\u{1F336}\u{FE0F}", name: "HOT PEPPER", blurb: "next attack +2 dice" },
  trap: { emoji: "\u{1FAA4}", name: "STICKY TRAP", blurb: "oops, down to 1 bug" },
};

/** Weighted table: traps are rare so grabbing snacks is usually worth it. */
const ITEM_TABLE: readonly [ItemKind, number][] = [
  ["cake", 3],
  ["firecracker", 2],
  ["egg", 2],
  ["pepper", 3],
  ["trap", 1],
];

export const MAX_ITEMS_ON_BOARD = 5;

export function rollItem(rng: Rng): ItemKind {
  const total = ITEM_TABLE.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng.float(0, total);
  for (const [kind, weight] of ITEM_TABLE) {
    roll -= weight;
    if (roll < 0) return kind;
  }
  return "cake";
}

export function itemCount(board: Board): number {
  return board.tiles.filter((tile) => tile.item).length;
}

/** Drop up to `count` items on empty tiles (never above MAX_ITEMS_ON_BOARD). Returns the tile ids. */
export function spawnItems(board: Board, rng: Rng, count: number): number[] {
  const placed: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (itemCount(board) >= MAX_ITEMS_ON_BOARD) break;
    const free = board.tiles.filter((tile) => !tile.item);
    if (free.length === 0) break;
    const tile = rng.pick(free);
    tile.item = rollItem(rng);
    placed.push(tile.id);
  }
  return placed;
}

export interface ItemEffect {
  kind: ItemKind;
  tile: number;
  /** Tiles whose bug count changed. */
  touched: number[];
  stashGain: number;
  pepperDice: number;
}

/** Trigger the item on a freshly captured tile for `seat`. Removes it from the board. */
export function triggerItem(board: Board, tileId: number, seat: number): ItemEffect | null {
  const tile = board.tiles[tileId];
  if (!tile || !tile.item) return null;
  const kind = tile.item;
  tile.item = null;
  const effect: ItemEffect = { kind, tile: tileId, touched: [], stashGain: 0, pepperDice: 0 };
  switch (kind) {
    case "cake":
      tile.bugs = Math.min(MAX_BUGS, tile.bugs + 3);
      effect.touched.push(tileId);
      break;
    case "firecracker":
      for (const id of board.adjacency[tileId] ?? []) {
        const near = board.tiles[id]!;
        if (near.owner === seat || near.owner === NO_OWNER) continue;
        const after = Math.max(1, Math.ceil(near.bugs / 2));
        if (after !== near.bugs) {
          near.bugs = after;
          effect.touched.push(id);
        }
      }
      break;
    case "egg":
      effect.stashGain = 5;
      break;
    case "pepper":
      effect.pepperDice = 2;
      break;
    case "trap":
      tile.bugs = 1;
      effect.touched.push(tileId);
      break;
  }
  return effect;
}

/** Add to a nest without passing the cap. */
export function addStash(stash: number, gain: number): number {
  return Math.min(STASH_MAX, stash + gain);
}

// ---------------------------------------------------------------- standings & comebacks

export function leaderSeat(board: Board, playerCount: number): number {
  let best = -1;
  let bestScore = -1;
  for (const seat of aliveSeats(board, playerCount)) {
    const score = tilesOwned(board, seat) * 100 + bugsOwned(board, seat);
    if (score > bestScore) {
      bestScore = score;
      best = seat;
    }
  }
  return best;
}

export function trailingSeat(board: Board, playerCount: number): number {
  let worst = -1;
  let worstScore = Infinity;
  for (const seat of aliveSeats(board, playerCount)) {
    const score = tilesOwned(board, seat) * 100 + bugsOwned(board, seat);
    if (score < worstScore) {
      worstScore = score;
      worst = seat;
    }
  }
  return worst;
}

/** Extra income for a seat that is far behind the leader: one bug per 3 tiles of gap, max 4. */
export function underdogBonus(board: Board, seat: number, playerCount: number): number {
  let most = 0;
  for (const other of aliveSeats(board, playerCount)) most = Math.max(most, tilesOwned(board, other));
  const gap = most - tilesOwned(board, seat);
  return Math.min(4, Math.max(0, Math.floor(gap / 3)));
}

/** Defenders down to their last couple of tiles fight harder. */
export const LAST_STAND_TILES = 2;

export function isLastStand(board: Board, seat: number): boolean {
  const owned = tilesOwned(board, seat);
  return owned > 0 && owned <= LAST_STAND_TILES;
}

export function isFinalRound(round: number): boolean {
  return round === MAX_ROUNDS;
}

export interface AttackContext {
  /** The seat that last captured from the attacker (or -1). */
  grudge: number;
  /** Pepper dice the attacker is carrying. */
  pepper: number;
  round: number;
}

export interface BonusBreakdown {
  attackDice: number;
  defendDice: number;
  labels: string[];
}

/** Every bonus that applies to one attack, with the shout-outs to show. */
export function attackBonuses(board: Board, from: number, to: number, context: AttackContext): BonusBreakdown {
  const source = board.tiles[from]!;
  const target = board.tiles[to]!;
  const out: BonusBreakdown = { attackDice: 0, defendDice: 0, labels: [] };
  if (context.grudge >= 0 && target.owner === context.grudge) {
    out.attackDice += 1;
    out.labels.push("+1 REVENGE");
  }
  if (context.pepper > 0) {
    out.attackDice += context.pepper;
    out.labels.push(`+${context.pepper} HOT PEPPER`);
  }
  if (isFinalRound(context.round)) {
    out.attackDice += 1;
    out.labels.push("+1 FRENZY");
  }
  if (target.owner !== source.owner && isLastStand(board, target.owner)) {
    out.defendDice += 1;
    out.labels.push("+1 LAST STAND");
  }
  return out;
}

// ---------------------------------------------------------------- backyard chaos

export type ChaosKind = "shoe" | "spray" | "picnic" | "mower" | "frog" | "ladybug";

export const CHAOS_INFO: Record<ChaosKind, { emoji: string; name: string; blurb: string }> = {
  shoe: { emoji: "\u{1F45F}", name: "GIANT SHOE!", blurb: "STOMP on the leader's biggest stack" },
  spray: { emoji: "\u{1F9F4}", name: "BUG SPRAY!", blurb: "A toxic cloud halves a whole patch" },
  picnic: { emoji: "\u{1F9FA}", name: "PICNIC DROP!", blurb: "Snacks rain on the garden" },
  mower: { emoji: "\u{1F69C}", name: "LAWNMOWER!", blurb: "A row gets trimmed by 2" },
  frog: { emoji: "\u{1F438}", name: "HUNGRY FROG!", blurb: "SLURP: the leader loses 3 bugs" },
  ladybug: { emoji: "\u{1F41E}", name: "LUCKY LADYBUG!", blurb: "Last place gets +4 bugs" },
};

export const CHAOS_KINDS: readonly ChaosKind[] = ["shoe", "spray", "picnic", "mower", "frog", "ladybug"];

export interface ChaosPlan {
  kind: ChaosKind;
  /** Tiles that get hit (shown as a warning shadow before impact). */
  tiles: number[];
  /** Seat the event targets, or -1. */
  seat: number;
}

/** Pick a different event from the last one so the backyard keeps surprising. */
export function pickChaos(rng: Rng, last: ChaosKind | null): ChaosKind {
  const pool = CHAOS_KINDS.filter((kind) => kind !== last);
  return rng.pick(pool);
}

function biggestStack(board: Board, seat: number): number {
  let best = -1;
  for (const tile of board.tiles) {
    if (tile.owner !== seat) continue;
    if (best < 0 || tile.bugs > board.tiles[best]!.bugs) best = tile.id;
  }
  return best;
}

export function planChaos(board: Board, playerCount: number, kind: ChaosKind, rng: Rng): ChaosPlan {
  const leader = leaderSeat(board, playerCount);
  switch (kind) {
    case "shoe":
    case "frog": {
      const tile = biggestStack(board, leader);
      return { kind, tiles: tile >= 0 ? [tile] : [], seat: leader };
    }
    case "spray": {
      // Aim at the leader's turf most of the time, anywhere otherwise.
      const pool = board.tiles.filter((tile) => tile.owner === leader);
      const center = rng.next() < 0.7 && pool.length > 0 ? rng.pick(pool) : rng.pick(board.tiles);
      return { kind, tiles: [center.id, ...(board.adjacency[center.id] ?? [])], seat: -1 };
    }
    case "picnic": {
      const free = board.tiles.filter((tile) => !tile.item).map((tile) => tile.id);
      const tiles: number[] = [];
      for (let i = 0; i < 3 && free.length > 0; i += 1) tiles.push(free.splice(rng.int(0, free.length - 1), 1)[0]!);
      return { kind, tiles, seat: -1 };
    }
    case "mower": {
      const rows = [...new Set(board.tiles.map((tile) => tile.row))];
      const row = rng.pick(rows);
      return { kind, tiles: board.tiles.filter((tile) => tile.row === row).map((tile) => tile.id), seat: -1 };
    }
    case "ladybug": {
      const seat = trailingSeat(board, playerCount);
      const tiles = board.tiles.filter((tile) => tile.owner === seat).map((tile) => tile.id);
      return { kind, tiles, seat };
    }
  }
}

export interface ChaosResult {
  /** Total bugs removed from the board. */
  squashed: number;
  /** Bugs added (ladybug). */
  added: number;
  /** Items placed (picnic). */
  items: number[];
}

/** Apply a planned event. Never removes a tile's owner: every hit tile keeps at least 1 bug. */
export function applyChaos(board: Board, plan: ChaosPlan, rng: Rng): ChaosResult {
  const result: ChaosResult = { squashed: 0, added: 0, items: [] };
  const cut = (id: number, after: number) => {
    const tile = board.tiles[id];
    if (!tile) return;
    const next = Math.max(1, Math.min(tile.bugs, after));
    result.squashed += tile.bugs - next;
    tile.bugs = next;
  };
  switch (plan.kind) {
    case "shoe":
      for (const id of plan.tiles) cut(id, 1);
      break;
    case "frog":
      for (const id of plan.tiles) cut(id, board.tiles[id]!.bugs - 3);
      break;
    case "spray":
      for (const id of plan.tiles) cut(id, Math.ceil(board.tiles[id]!.bugs / 2));
      break;
    case "mower":
      for (const id of plan.tiles) cut(id, board.tiles[id]!.bugs - 2);
      break;
    case "picnic":
      for (const id of plan.tiles) {
        const tile = board.tiles[id];
        if (!tile || tile.item) continue;
        tile.item = rng.next() < 0.5 ? "cake" : rollItem(rng);
        result.items.push(id);
      }
      break;
    case "ladybug": {
      let left = 4;
      while (left > 0) {
        const room = plan.tiles.map((id) => board.tiles[id]!).filter((tile) => tile.owner === plan.seat && tile.bugs < MAX_BUGS);
        if (room.length === 0) break;
        rng.pick(room).bugs += 1;
        result.added += 1;
        left -= 1;
      }
      break;
    }
  }
  return result;
}

// ---------------------------------------------------------------- bot personalities

export type PersonaKind = "reckless" | "careful" | "chaotic" | "bully";

export interface Persona {
  kind: PersonaKind;
  label: string;
  /** Attacks per turn before the bot calls it. */
  maxAttacks: number;
  minEdge: number;
  noise: number;
  taunts: readonly string[];
}

export const PERSONAS: Record<PersonaKind, Persona> = {
  reckless: {
    kind: "reckless",
    label: "\u{1F624} Reckless",
    maxAttacks: 5,
    minEdge: 0,
    noise: 4,
    taunts: ["CHAAARGE!", "No plan. Only legs.", "YOLO (you only larva once)", "MORE LEGS!"],
  },
  careful: {
    kind: "careful",
    label: "\u{1F9D0} Careful",
    maxAttacks: 3,
    minEdge: 2,
    noise: 0.5,
    taunts: ["As calculated.", "Statistically delicious.", "I ran the numbers.", "Proceeding cautiously."],
  },
  chaotic: {
    kind: "chaotic",
    label: "\u{1F92A} Chaotic",
    maxAttacks: 4,
    minEdge: 1,
    noise: 25,
    taunts: ["bzzzt?", "I forgot why I'm here", "wheee!", "is that a crumb??"],
  },
  bully: {
    kind: "bully",
    label: "\u{1F608} Bully",
    maxAttacks: 4,
    minEdge: 1,
    noise: 0.5,
    taunts: ["Pick on someone smaller? OK!", "Your lunch money. Now.", "Tiny bugs, tiny dreams.", "Nyeh heh heh."],
  },
};

const PERSONA_ORDER: readonly PersonaKind[] = ["reckless", "careful", "chaotic", "bully"];

/** Seat-stable persona, shuffled per game so a slot isn't always the same character. */
export function personaFor(slot: number, shift: number): Persona {
  return PERSONAS[PERSONA_ORDER[(slot + shift) % PERSONA_ORDER.length]!];
}

/** Turn a persona into bot options for botPickAttack. */
export function personaOptions(board: Board, seat: number, playerCount: number, persona: Persona, context: AttackContext): BotOptions {
  const leader = leaderSeat(board, playerCount);
  const weakest = trailingSeat(board, playerCount);
  return {
    minEdge: persona.minEdge,
    noise: persona.noise,
    bonusDice: (to) => {
      const target = board.tiles[to]!;
      let dice = context.pepper + (isFinalRound(context.round) ? 1 : 0);
      if (target.owner === context.grudge) dice += 1;
      if (isLastStand(board, target.owner)) dice -= 1;
      return dice;
    },
    favour: (to) => {
      const target = board.tiles[to]!;
      let score = 0;
      if (target.item && target.item !== "trap") score += 6;
      if (target.owner === context.grudge) score += 5;
      if (target.owner === leader && leader !== seat) score += 4;
      if (persona.kind === "bully" && target.owner === weakest) score += 12;
      if (tilesOwned(board, target.owner) === 1) score += 15; // finish them
      return score;
    },
  };
}

// ---------------------------------------------------------------- trash talk

export const BARKS = {
  capture: ["NOM NOM", "MY LEAF NOW", "For the Queen!", "Get off my lawn!", "Squish squish!", "Mine mine mine!", "Thanks for the snacks", "Leg day paid off"],
  defend: ["Not today!", "Ha! Missed!", "This dirt is MINE", "Nice try, crumb", "Shell yeah!", "Bounce off!"],
  ouch: ["ow my antennae", "I had a FAMILY", "bzzz... urk", "tell my larvae...", "RUDE.", "I'm calling my mom"],
  upset: ["DAVID vs GOLIATH!", "UPSET IN THE GARDEN!", "TINY BUT MIGHTY!", "WHO SAW THAT COMING?!"],
  stomp: ["AAAAAA", "WHO WEARS SIZE 40?!", "flat as a pancake", "not the shoe!!"],
  wipe: ["EXTERMINATED!", "SWATTED!", "GAME OVER, BUG!", "BACK TO THE COMPOST!"],
} as const;

export type BarkKind = keyof typeof BARKS;

export function bark(kind: BarkKind, rng: Rng): string {
  return rng.pick(BARKS[kind]);
}

/** Announcer flavour for a finished battle, or null for an ordinary one. */
export function battleHeadline(attackBugs: number, defendBugs: number, captured: boolean, jackpot: "attack" | "defend" | null | undefined, margin: number): string | null {
  if (jackpot === "attack") return "JACKPOT! AUTO-WIN!";
  if (jackpot === "defend") return "IRON SHELL! AUTO-HOLD!";
  if (captured && attackBugs < defendBugs) return "UPSET!";
  if (!captured && attackBugs >= defendBugs + 3) return "EPIC FAIL!";
  if (captured && margin >= 15) return "OBLITERATED!";
  if (Math.abs(margin) <= 1) return captured ? "BY A WHISKER!" : "PHOTO FINISH!";
  return null;
}

import type { Rng } from "../../core/rng";

export type PieceKind = "cube" | "brick" | "plank" | "pillar" | "block" | "wedge";

export interface PieceSpec {
  w: number;
  h: number;
  shape: "rect" | "wedge";
  /** Relative odds in the queue. */
  weight: number;
  hp: number;
}

export const PIECE_SPECS: Record<PieceKind, PieceSpec> = {
  cube: { w: 44, h: 44, shape: "rect", weight: 3, hp: 2 },
  brick: { w: 72, h: 34, shape: "rect", weight: 3, hp: 2 },
  plank: { w: 150, h: 20, shape: "rect", weight: 2, hp: 2 },
  pillar: { w: 26, h: 110, shape: "rect", weight: 2, hp: 2 },
  block: { w: 80, h: 80, shape: "rect", weight: 1, hp: 4 },
  wedge: { w: 70, h: 56, shape: "wedge", weight: 1, hp: 3 },
};

export const PIECE_KINDS = Object.keys(PIECE_SPECS) as PieceKind[];

export const BUILD_SECONDS = 16;
export const QUEUE_LENGTH = 10;
export const ROUNDS_TO_WIN = 2;
export const KING_HP = 3;
/** After this many shots each in a round, every shot is a bomb. */
export const SUDDEN_DEATH_AFTER = 4;
/** The deciding round goes to bombs sooner. */
export const FINAL_SUDDEN_DEATH_AFTER = 3;
/** Seconds a human shooter gets to pick ammo and fire before the cannon fires itself. */
export const TURN_CLOCK_S = 10;

export function isFinalRound(round: number): boolean {
  return round >= ROUNDS_TO_WIN * 2 - 1;
}

export function suddenDeathAfter(round: number): number {
  return isFinalRound(round) ? FINAL_SUDDEN_DEATH_AFTER : SUDDEN_DEATH_AFTER;
}

function weightedPick<T extends string>(rng: Rng, weights: Record<T, number>): T {
  const keys = Object.keys(weights) as T[];
  const total = keys.reduce((sum, key) => sum + weights[key], 0);
  let roll = rng.float(0, total);
  for (const key of keys) {
    roll -= weights[key];
    if (roll < 0) return key;
  }
  return keys[keys.length - 1]!;
}

/** The drop order for a round. Both sides get the same queue. */
export function dealQueue(rng: Rng, length = QUEUE_LENGTH, kinds: readonly PieceKind[] = PIECE_KINDS): PieceKind[] {
  const weights = Object.fromEntries(kinds.map((kind) => [kind, PIECE_SPECS[kind].weight])) as Record<PieceKind, number>;
  return Array.from({ length }, () => weightedPick(rng, weights));
}

// ---- Build decrees: a symmetric building condition announced before each round after the first ----

export type Decree = "none" | "brittle" | "narrow" | "tall" | "bulk";

export interface DecreeSpec {
  title: string;
  line: string;
  /** Which kinds the queue is dealt from. */
  kinds: readonly PieceKind[];
  /** Queue length. */
  length: number;
  /** HP override for every piece but the big block (null keeps the spec). */
  hp: number | null;
  /** Fraction of the zone width you may build in. */
  lot: number;
  buildSeconds: number;
}

export const DECREES: Record<Decree, DecreeSpec> = {
  none: { title: "", line: "Place your king, then stack a fortress!", kinds: PIECE_KINDS, length: QUEUE_LENGTH, hp: null, lot: 1, buildSeconds: BUILD_SECONDS },
  brittle: { title: "BRITTLE", line: "Every piece shatters in one hit", kinds: PIECE_KINDS, length: QUEUE_LENGTH, hp: 1, lot: 1, buildSeconds: BUILD_SECONDS - 2 },
  narrow: { title: "NARROW LOT", line: "Half the ground to build on", kinds: PIECE_KINDS, length: QUEUE_LENGTH, hp: null, lot: 0.5, buildSeconds: BUILD_SECONDS - 2 },
  tall: { title: "TALL ORDER", line: "Pillars and planks only", kinds: ["pillar", "plank", "wedge"], length: QUEUE_LENGTH, hp: null, lot: 1, buildSeconds: BUILD_SECONDS - 2 },
  bulk: { title: "BIG BLOCKS", line: "Six heavy pieces, nothing else", kinds: ["block", "cube", "wedge"], length: 6, hp: null, lot: 1, buildSeconds: BUILD_SECONDS - 4 },
};

const DECREE_POOL: readonly Decree[] = ["brittle", "narrow", "tall", "bulk"];

/** Round 1 is always classic; later rounds draw a decree that hasn't come up yet this match. */
export function rollDecree(rng: Rng, round: number, used: readonly Decree[]): Decree {
  if (round <= 1) return "none";
  const fresh = DECREE_POOL.filter((d) => !used.includes(d));
  return rng.pick(fresh.length ? fresh : DECREE_POOL);
}

/** HP a piece starts with under a decree. The big block always keeps at least 2. */
export function pieceHp(kind: PieceKind, decree: Decree): number {
  const base = PIECE_SPECS[kind].hp;
  const override = DECREES[decree].hp;
  if (override === null) return base;
  return kind === "block" ? Math.max(override + 1, 2) : override;
}

export type Ammo = "ball" | "bomb" | "triple" | "boulder" | "golden";

/** Chance of the rare golden cannonball on a normal (non sudden-death) roll. */
export const GOLDEN_ODDS = 0.06;
/** Extra damage a golden ball deals on top of the heavy bonus. */
export const GOLDEN_BONUS = 1;

/** Relative odds of the common ammo. Golden is carved out of the total, keeping these proportions. */
export const BASE_AMMO_WEIGHTS: Record<Exclude<Ammo, "golden">, number> = { ball: 4, bomb: 2, triple: 2, boulder: 1 };

const BASE_TOTAL = Object.values(BASE_AMMO_WEIGHTS).reduce((sum, w) => sum + w, 0);

/** Probabilities (sum to 1). */
export const AMMO_WEIGHTS: Record<Ammo, number> = {
  ...(Object.fromEntries(
    Object.entries(BASE_AMMO_WEIGHTS).map(([ammo, w]) => [ammo, ((1 - GOLDEN_ODDS) * w) / BASE_TOTAL]),
  ) as Record<Exclude<Ammo, "golden">, number>),
  golden: GOLDEN_ODDS,
};

export const AMMO_LABELS: Record<Ammo, string> = {
  ball: "CANNONBALL",
  bomb: "BOMB",
  triple: "TRIPLE SHOT",
  boulder: "BOULDER",
  golden: "GOLDEN BALL",
};

/** Heavy ammo cracks blocks harder and hurts kings more. */
export function isHeavy(ammo: Ammo | undefined): boolean {
  return ammo === "boulder" || ammo === "golden";
}

export function rollAmmo(rng: Rng, shotsThisRound: number, suddenAfter = SUDDEN_DEATH_AFTER): Ammo {
  if (shotsThisRound >= suddenAfter) return "bomb";
  return weightedPick(rng, AMMO_WEIGHTS);
}

/**
 * Two public ammo offers for an exchange; both shooters pick from the same pair.
 * Distinct unless it's sudden death (then it's bombs and the pick is skipped).
 */
export function dealOffers(rng: Rng, shotsThisRound: number, suddenAfter = SUDDEN_DEATH_AFTER): [Ammo, Ammo] {
  if (shotsThisRound >= suddenAfter) return ["bomb", "bomb"];
  const first = weightedPick(rng, AMMO_WEIGHTS);
  for (let i = 0; i < 20; i += 1) {
    const second = weightedPick(rng, AMMO_WEIGHTS);
    if (second !== first) return rng.next() < 0.5 ? [first, second] : [second, first];
  }
  return [first, first === "ball" ? "bomb" : "ball"];
}

export interface BotPickContext {
  /** Enemy blocks still standing. */
  blocks: number;
  /** Enemy king HP. */
  kingHp: number;
  /** Absolute wind. */
  wind: number;
  /** Defender's breath, 0..1: full lungs mean a light shot may get blown off. */
  breath: number;
}

/** Ammo value for a bot: heavy when the defender has breath or the wind is up, bombs for finishing, triple for clearing. */
export function ammoValue(ammo: Ammo, c: BotPickContext): number {
  switch (ammo) {
    case "golden":
      return 10;
    case "boulder":
      return 3 + c.breath * 3 + c.wind / 10;
    case "bomb":
      return 3.5 + (c.kingHp <= 2 ? 1.5 : 0) + (c.blocks >= 4 ? 1 : 0) - c.breath * 1.5;
    case "triple":
      return 2.5 + Math.min(3, c.blocks) * 0.5 - c.breath;
    default:
      return 2 + (c.blocks <= 2 ? 1 : 0);
  }
}

export function botPick(offers: readonly [Ammo, Ammo], c: BotPickContext): 0 | 1 {
  return ammoValue(offers[1], c) > ammoValue(offers[0], c) ? 1 : 0;
}

// ---- Bellows: the defending king blows at incoming shots ----

/** Seconds of gust one full breath buys. */
export const BREATH_MAX = 1;
/** Breath regained each time your turn to defend comes around. */
export const BREATH_REGAIN = 0.5;
/** Headwind the bellows adds for a light ball, in wind units (natural wind tops out at WIND_MAX). */
export const GUST_STRENGTH = 38;
/** A ball passing within this many px of the king without touching it is a near miss. */
export const NEAR_MISS_PX = 48;

/** Heavy ammo shrugs off the gust: scale by the cannonball's relative density. */
export function gustFactor(ammo: Ammo): number {
  return ammo === "golden" ? 0.35 : ammo === "boulder" ? 0.55 : ammo === "bomb" ? 1.15 : 1;
}

/** Breath for the next defence: regain some, a full tank when you're behind in rounds (underdog lungs). */
export function refillBreath(breath: number, underdog: boolean): number {
  return underdog ? BREATH_MAX : Math.min(BREATH_MAX, breath + BREATH_REGAIN);
}

/** Standard normal via Box-Muller. */
export function gaussian(rng: Rng): number {
  const u = Math.max(rng.next(), 1e-9);
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const WIND_MAX = 20;

/** Wind for one shot: whole numbers, mostly small, sometimes a gale. Negative blows left. */
export function rollWind(rng: Rng): number {
  const raw = Math.round(gaussian(rng) * 7);
  return Math.max(-WIND_MAX, Math.min(WIND_MAX, raw)) || 0;
}

/** Impact damage from relative speed (px/step). Soft bumps do nothing. */
export function impactDamage(speed: number, heavy: boolean): number {
  const threshold = 4.5;
  if (speed < threshold) return 0;
  return 1 + Math.floor((speed - threshold) / 5) + (heavy ? 1 : 0);
}

export type Team = 0 | 1;

/** Seats alternate teams: 1st and 3rd on the left, 2nd and 4th on the right. */
export function teamOf(playerIndex: number): Team {
  return playerIndex % 2 === 0 ? 0 : 1;
}

export function other(team: Team): Team {
  return team === 0 ? 1 : 0;
}

export function matchWinner(wins: readonly [number, number]): Team | null {
  if (wins[0] >= ROUNDS_TO_WIN) return 0;
  if (wins[1] >= ROUNDS_TO_WIN) return 1;
  return null;
}

export function comboCallout(smashed: number): string | null {
  if (smashed >= 6) return "DEMOLITION!";
  if (smashed >= 4) return "MEGA SMASH!";
  if (smashed >= 3) return "TRIPLE SMASH!";
  if (smashed >= 2) return "DOUBLE SMASH!";
  return null;
}

// ---- Real-time siege: both cannons fire whenever they're reloaded ----------------

/** Seconds between shots for each cannon. */
export const REALTIME_RELOAD_S = 3;
/** After this long in a real-time siege, every roll is a bomb. */
export const REALTIME_SUDDEN_DEATH_S = 45;
/** Wind shifts on its own every so often (there are no turns to reroll it on). */
export const REALTIME_WIND_EVERY_S = 6;

/** Ammo for the next real-time shot: normal odds until sudden death, then bombs. */
export function realtimeAmmo(rng: Rng, siegeSeconds: number): Ammo {
  return rollAmmo(rng, siegeSeconds >= REALTIME_SUDDEN_DEATH_S ? SUDDEN_DEATH_AFTER : 0);
}

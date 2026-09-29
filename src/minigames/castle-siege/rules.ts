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

export const BUILD_SECONDS = 25;
export const QUEUE_LENGTH = 12;
export const ROUNDS_TO_WIN = 2;
export const KING_HP = 3;
/** After this many shots each in a round, every shot is a bomb. */
export const SUDDEN_DEATH_AFTER = 5;

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
export function dealQueue(rng: Rng, length = QUEUE_LENGTH): PieceKind[] {
  const weights = Object.fromEntries(PIECE_KINDS.map((kind) => [kind, PIECE_SPECS[kind].weight])) as Record<PieceKind, number>;
  return Array.from({ length }, () => weightedPick(rng, weights));
}

export type Ammo = "ball" | "bomb" | "triple" | "boulder";

export const AMMO_WEIGHTS: Record<Ammo, number> = { ball: 4, bomb: 2, triple: 2, boulder: 1 };

export const AMMO_LABELS: Record<Ammo, string> = {
  ball: "CANNONBALL",
  bomb: "BOMB",
  triple: "TRIPLE SHOT",
  boulder: "BOULDER",
};

export function rollAmmo(rng: Rng, shotsThisRound: number): Ammo {
  if (shotsThisRound >= SUDDEN_DEATH_AFTER) return "bomb";
  return weightedPick(rng, AMMO_WEIGHTS);
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

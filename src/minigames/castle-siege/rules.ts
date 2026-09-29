import type { Rng } from "../../core/rng";

export type PieceKind = "cube" | "brick" | "plank" | "pillar" | "block" | "wedge";

export interface PieceSpec {
  w: number;
  h: number;
  shape: "rect" | "wedge";
  /** Relative odds in the draw. Big blocks are rare, cubes and bricks are common. */
  weight: number;
}

export const PIECE_SPECS: Record<PieceKind, PieceSpec> = {
  cube: { w: 44, h: 44, shape: "rect", weight: 3 },
  brick: { w: 70, h: 34, shape: "rect", weight: 3 },
  plank: { w: 150, h: 20, shape: "rect", weight: 2 },
  pillar: { w: 26, h: 110, shape: "rect", weight: 2 },
  block: { w: 80, h: 80, shape: "rect", weight: 1 },
  wedge: { w: 70, h: 56, shape: "wedge", weight: 1 },
};

export const PIECE_KINDS = Object.keys(PIECE_SPECS) as PieceKind[];

export const GAME_SIZES = [20, 40] as const;
export type GameSize = (typeof GAME_SIZES)[number];

export const SHOTS_PER_TEAM = 8;
export const SETTLE_SECONDS = 3;
export const HANDOFF_SECONDS = 30;

/** 20 pieces → 2 base, 40 pieces → 4 base. Base pieces come out of the total. */
export function baseCount(size: GameSize): number {
  return size / 10;
}

export function buildSeconds(size: GameSize): number {
  return size === 40 ? 360 : 180;
}

export type PieceCounts = Record<PieceKind, number>;

export function emptyCounts(): PieceCounts {
  return { cube: 0, brick: 0, plank: 0, pillar: 0, block: 0, wedge: 0 };
}

/** One weighted draw. Both teams get a copy of the same counts. */
export function drawPieces(rng: Rng, size: GameSize): PieceCounts {
  const counts = emptyCounts();
  const total = PIECE_KINDS.reduce((sum, kind) => sum + PIECE_SPECS[kind].weight, 0);
  for (let i = 0; i < size; i += 1) {
    let roll = rng.float(0, total);
    for (const kind of PIECE_KINDS) {
      roll -= PIECE_SPECS[kind].weight;
      if (roll < 0) {
        counts[kind] += 1;
        break;
      }
    }
  }
  return counts;
}

export function countTotal(counts: PieceCounts): number {
  return PIECE_KINDS.reduce((sum, kind) => sum + counts[kind], 0);
}

/** Standard normal via Box-Muller. */
export function gaussian(rng: Rng): number {
  const u = Math.max(rng.next(), 1e-9);
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const WIND_SD = 8;
export const WIND_MAX = 25;

/** Wind for one shot: normal around 0, sd 8, clamped to ±25, whole numbers. Negative blows left. */
export function rollWind(rng: Rng): number {
  const raw = Math.round(gaussian(rng) * WIND_SD);
  return Math.max(-WIND_MAX, Math.min(WIND_MAX, raw)) || 0;
}

export type Team = 0 | 1;

/** Seats alternate teams: 1st, 3rd → left; 2nd, 4th → right. */
export function teamOf(playerIndex: number): Team {
  return playerIndex % 2 === 0 ? 0 : 1;
}

export type Outcome = Team | "draw";

/** Knockout: a side with nothing standing loses. Otherwise fewest standing loses. */
export function outcome(standing: readonly [number, number]): Outcome {
  if (standing[0] === standing[1]) return "draw";
  return standing[0] > standing[1] ? 0 : 1;
}

export function isKnockout(standing: readonly [number, number]): boolean {
  return standing[0] === 0 || standing[1] === 0;
}

export function nextShooter(shots: readonly [number, number], last: Team): Team | null {
  const other: Team = last === 0 ? 1 : 0;
  if (shots[other] < SHOTS_PER_TEAM) return other;
  if (shots[last] < SHOTS_PER_TEAM) return last;
  return null;
}

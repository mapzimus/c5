import type { Rng } from "../../core/rng";

/** Pure rules for Hot Potato. No canvas, no DOM. Times in seconds unless named *Ms. */

export const FUSE_MIN_S = 6;
export const FUSE_MAX_S = 14;
export const DUD_CHANCE = 0.2;
export const SPLIT_CHANCE = 0.15;
/** A split bomb clones itself this long after it is lit. */
export const SPLIT_AT_S = 3;
export const FLIGHT_S = 0.35;
/** Hold your zone this long and the aim pointer appears. */
export const AIM_HOLD_S = 0.5;
/** Pointer sweep speed: one lap around the ring every 1.4s. */
export const AIM_SWEEP_RAD_PER_S = (Math.PI * 2) / 1.4;
export const BOT_HOLD_MIN_S = 0.4;
export const BOT_HOLD_MAX_S = 1.5;
export const BOT_AIM_CHANCE = 0.3;

export type BombKind = "live" | "dud" | "split";

export interface BombPlan {
  kind: BombKind;
  fuseS: number;
}

/** Roll a new bomb: 20% dud, 15% split, otherwise plain live. Fuse 6-14s. */
export function planBomb(rng: Rng, options: { allowDud?: boolean; allowSplit?: boolean } = {}): BombPlan {
  const fuseS = rng.float(FUSE_MIN_S, FUSE_MAX_S);
  const roll = rng.next();
  let kind: BombKind = "live";
  if (roll < DUD_CHANCE) kind = (options.allowDud ?? true) ? "dud" : "live";
  else if (roll < DUD_CHANCE + SPLIT_CHANCE) kind = (options.allowSplit ?? true) ? "split" : "live";
  return { kind, fuseS };
}

/** Living seats other than `from`. */
export function otherLiving(alive: readonly boolean[], from: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < alive.length; i++) if (alive[i] && i !== from) out.push(i);
  return out;
}

/** A random living seat other than `from`, or -1 if there is none. */
export function pickTarget(alive: readonly boolean[], from: number, rng: Rng): number {
  const others = otherLiving(alive, from);
  return others.length === 0 ? -1 : rng.pick(others);
}

/** Smallest absolute difference between two angles, in [0, PI]. */
export function angleDiff(a: number, b: number): number {
  const tau = Math.PI * 2;
  let d = (a - b) % tau;
  if (d < 0) d += tau;
  return d > Math.PI ? tau - d : d;
}

/** The living seat (not `from`) whose ring angle is closest to the pointer. -1 if none. */
export function pointedSeat(
  aimAngle: number,
  seatAngles: readonly number[],
  alive: readonly boolean[],
  from: number,
): number {
  let best = -1;
  let bestDiff = Infinity;
  for (const i of otherLiving(alive, from)) {
    const d = angleDiff(aimAngle, seatAngles[i] ?? 0);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return best;
}

/** How long a bot holds a bomb before throwing it. */
export function planBotThrow(rng: Rng): number {
  return rng.float(BOT_HOLD_MIN_S, BOT_HOLD_MAX_S);
}

/**
 * 30% of the time a bot aims at the living player with the most passes (ties broken at random).
 * Returns null when the bot should just throw at random.
 */
export function botAimTarget(
  alive: readonly boolean[],
  from: number,
  passes: readonly number[],
  rng: Rng,
  aimChance = BOT_AIM_CHANCE,
): number | null {
  if (rng.next() >= aimChance) return null;
  const others = otherLiving(alive, from);
  if (others.length === 0) return null;
  const top = Math.max(...others.map((i) => passes[i] ?? 0));
  return rng.pick(others.filter((i) => (passes[i] ?? 0) === top));
}

/**
 * Score = elimination order. First out scores 1, next 2, ... Survivors all get `seats`
 * (the winner is the single survivor when the match runs to the end).
 */
export function eliminationScores(order: readonly number[], seats: number): number[] {
  const scores = Array<number>(seats).fill(seats);
  order.forEach((seat, i) => {
    if (seat >= 0 && seat < seats) scores[seat] = i + 1;
  });
  return scores;
}

export interface SeatZone {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where the character stands (pulled a little toward the middle of the screen). */
  cx: number;
  cy: number;
  /** Angle from the screen centre, used by the aim pointer. */
  angle: number;
}

/**
 * Touch zones around the screen: 2 = left/right halves, 3 = two top quadrants + bottom half,
 * 4 = quadrants. Characters stand inside their zone, shifted toward the centre so bombs fly
 * across a ring in the middle.
 */
export function seatLayout(n: number, width: number, height: number): SeatZone[] {
  let rects: { x: number; y: number; w: number; h: number }[];
  const hw = width / 2;
  const hh = height / 2;
  if (n <= 1) rects = [{ x: 0, y: 0, w: width, h: height }];
  else if (n === 2) rects = [{ x: 0, y: 0, w: hw, h: height }, { x: hw, y: 0, w: hw, h: height }];
  else if (n === 3) {
    rects = [
      { x: 0, y: 0, w: hw, h: hh },
      { x: hw, y: 0, w: hw, h: hh },
      { x: 0, y: hh, w: width, h: hh },
    ];
  } else {
    rects = [
      { x: 0, y: 0, w: hw, h: hh },
      { x: hw, y: 0, w: hw, h: hh },
      { x: 0, y: hh, w: hw, h: hh },
      { x: hw, y: hh, w: hw, h: hh },
    ];
  }
  return rects.slice(0, Math.max(1, n)).map((r) => {
    const zx = r.x + r.w / 2;
    const zy = r.y + r.h / 2;
    const cx = zx + (hw - zx) * 0.22;
    const cy = zy + (hh - zy) * 0.22;
    return { ...r, cx, cy, angle: Math.atan2(zy - hh, zx - hw) };
  });
}

export function inZone(z: SeatZone, x: number, y: number): boolean {
  return x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h;
}

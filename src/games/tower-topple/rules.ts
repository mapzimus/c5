/** Pure Tower Topple rules: slicing, gusts, topples, turn order, end check. No DOM. */

export const START_WIDTH = 220;
export const PERFECT_TOLERANCE = 6;
/** The underdog (lowest score at the table) gets a wider PERFECT window. */
export const UNDERDOG_TOLERANCE = 10;
/** A drop this far outside the PERFECT window still earns a "SO CLOSE" callout. */
export const NEAR_MISS = 6;
/** Narrower than this and the landing counts as a miss. */
export const MIN_WIDTH = 6;
export const START_LIVES = 3;
/** A miss widens the tower top by this much (capped at START_WIDTH). */
export const MISS_REGROW = 50;
/** Seconds a dropper gets before the block drops on its own. */
export const SHOT_CLOCK = 4.5;
/** Lean (radians) past which the tower sheds its top. */
export const TOPPLE_LEAN = 0.2;
/** Seconds for a waiting player's breath to refill for one gust. */
export const BREATH_FILL = 3;
/** Pendulum kick (rad/s) a gust gives the swinging block. */
export const GUST_SWING = 0.9;
/** Sideways push (px/s) a gust gives a block already falling. */
export const GUST_FALL = 140;
/** Score multiplier in the final round. */
export const FINAL_MULT = 2;

/** Drops each seat gets: fewer at a bigger table so a match stays under ~90s. */
export function dropsEach(players: number): number {
  return players <= 2 ? 12 : players === 3 ? 10 : 8;
}

export interface Span {
  /** Center x. */
  x: number;
  w: number;
}

export type DropResult =
  | { kind: "perfect"; block: Span }
  | { kind: "hit"; block: Span; cut: Span }
  | { kind: "miss" };

/** Land a block of `width` centered at `dropX` on `top`. */
export function sliceDrop(top: Span, dropX: number, width: number, tolerance = PERFECT_TOLERANCE): DropResult {
  if (Math.abs(dropX - top.x) <= tolerance) {
    return { kind: "perfect", block: { x: top.x, w: width } };
  }
  const left = Math.max(dropX - width / 2, top.x - top.w / 2);
  const right = Math.min(dropX + width / 2, top.x + top.w / 2);
  const w = right - left;
  if (w < MIN_WIDTH) return { kind: "miss" };
  const block = { x: (left + right) / 2, w };
  const cutW = width - w;
  const cutX = dropX > top.x ? right + cutW / 2 : left - cutW / 2;
  return { kind: "hit", block, cut: { x: cutX, w: cutW } };
}

/** Just outside the PERFECT window: close enough to deserve a "SO CLOSE". */
export function isNearMiss(top: Span, dropX: number, tolerance = PERFECT_TOLERANCE): boolean {
  const d = Math.abs(dropX - top.x);
  return d > tolerance && d <= tolerance + NEAR_MISS;
}

/** Each perfect in a row widens the block back by this much (capped at START_WIDTH). */
export const PERFECT_REGROW = 14;
/** Perfect streak needed for ON FIRE (bigger regrow, bigger points). */
export const FIRE_STREAK = 3;

/**
 * Points for a drop. `streak` = perfects in a row including this one.
 * Perfect pays 2, +1 per extra streak step (3, 4, 5...), capped at 6. `mult` doubles it in the final round.
 */
export function dropScore(result: DropResult, streak = 1, mult = 1): number {
  if (result.kind === "perfect") return mult * Math.min(6, 1 + Math.max(1, streak));
  return result.kind === "hit" ? mult : 0;
}

/** Width after a perfect: streaks earn the tower its width back. */
export function perfectWidth(w: number, streak: number): number {
  const grow = PERFECT_REGROW * (streak >= FIRE_STREAK ? 2 : 1);
  return Math.min(START_WIDTH, w + grow);
}

/** Wobble kick (rad/s) a landing gives the tower: more overhang sliced = harder knock. */
export function wobbleKick(result: DropResult, height: number): number {
  if (result.kind !== "hit") return 0;
  const frac = result.cut.w / Math.max(1, result.block.w + result.cut.w);
  return frac * 1.4 * (1 + Math.min(2, height * 0.08));
}

/** Lean kick (rad/s) one gust gives a tower of `height` blocks: taller towers are floppier. */
export function gustLeanKick(height: number): number {
  return 0.16 * (1 + Math.min(2, height * 0.06));
}

/** Widen a span after a miss so play can continue. */
export function regrow(top: Span): Span {
  return { x: top.x, w: Math.min(START_WIDTH, top.w + MISS_REGROW) };
}

/** How many blocks a topple sheds from a tower `height` blocks tall (base excluded): the top 40%, at least 2. */
export function toppleCount(height: number): number {
  if (height < 2) return 0;
  return Math.min(height, Math.max(2, Math.round(height * 0.4)));
}

/** Blocks lost per owner when `owners` (one seat index per fallen block) tumble off. */
export function toppleLosses(owners: readonly number[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const o of owners) if (o >= 0) out.set(o, (out.get(o) ?? 0) + 1);
  return out;
}

export interface Seat {
  lives: number;
  drops: number;
}

export function canPlay(seat: Seat, limit: number): boolean {
  return seat.lives > 0 && seat.drops < limit;
}

/** Index of the next seat after `from` that can still play, or -1. */
export function nextSeat(seats: readonly Seat[], from: number, limit: number): number {
  for (let k = 1; k <= seats.length; k++) {
    const i = (from + k) % seats.length;
    if (canPlay(seats[i]!, limit)) return i;
  }
  return -1;
}

export function isOver(seats: readonly Seat[], limit: number): boolean {
  const alive = seats.filter((s) => s.lives > 0).length;
  if (seats.length > 1 && alive <= 1) return true;
  return !seats.some((s) => canPlay(s, limit));
}

/** True once every living seat is on its last drop. */
export function isFinalRound(seats: readonly Seat[], limit: number): boolean {
  const alive = seats.filter((s) => s.lives > 0);
  return alive.length > 0 && alive.every((s) => s.drops >= limit - 1);
}

/**
 * Which seats are the underdog: alive, strictly lowest score at the table, and actually behind someone.
 * Everyone level means nobody needs help.
 */
export function underdogs(scores: readonly number[], alive: readonly boolean[]): boolean[] {
  const live = scores.filter((_, i) => alive[i]);
  if (live.length === 0) return scores.map(() => false);
  const lo = Math.min(...live);
  const hi = Math.max(...live);
  return scores.map((s, i) => Boolean(alive[i]) && s === lo && lo < hi);
}

/** Breath refill per second: eliminated seats become ghost wind and refill twice as fast; the final round is windier. */
export function breathRate(seat: Seat, finalRound: boolean): number {
  let rate = 1 / BREATH_FILL;
  if (seat.lives <= 0) rate *= 2;
  if (finalRound) rate *= 1.5;
  return rate;
}

/** Swing angular speed (rad/s of phase) for a tower of `height` blocks; faster in the final round. */
export function swingSpeed(height: number, finalRound = false): number {
  return (2.2 + Math.min(3, height * 0.09)) * (finalRound ? 1.2 : 1);
}

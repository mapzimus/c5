/** Pure Tower Topple rules: slicing, turn order, end check. No DOM. */

export const START_WIDTH = 220;
export const PERFECT_TOLERANCE = 6;
/** Narrower than this and the landing counts as a miss. */
export const MIN_WIDTH = 6;
export const START_LIVES = 3;
export const DROPS_EACH = 12;
/** A miss widens the tower top by this much (capped at START_WIDTH). */
export const MISS_REGROW = 50;

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
export function sliceDrop(top: Span, dropX: number, width: number): DropResult {
  if (Math.abs(dropX - top.x) <= PERFECT_TOLERANCE) {
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

export function dropScore(result: DropResult): number {
  return result.kind === "perfect" ? 2 : result.kind === "hit" ? 1 : 0;
}

/** Widen a span after a miss so play can continue. */
export function regrow(top: Span): Span {
  return { x: top.x, w: Math.min(START_WIDTH, top.w + MISS_REGROW) };
}

export interface Seat {
  lives: number;
  drops: number;
}

export function canPlay(seat: Seat): boolean {
  return seat.lives > 0 && seat.drops < DROPS_EACH;
}

/** Index of the next seat after `from` that can still play, or -1. */
export function nextSeat(seats: readonly Seat[], from: number): number {
  for (let k = 1; k <= seats.length; k++) {
    const i = (from + k) % seats.length;
    if (canPlay(seats[i]!)) return i;
  }
  return -1;
}

export function isOver(seats: readonly Seat[]): boolean {
  const alive = seats.filter((s) => s.lives > 0).length;
  if (seats.length > 1 && alive <= 1) return true;
  return !seats.some(canPlay);
}

/** Swing angular speed (rad/s of phase) for a tower of `height` blocks. */
export function swingSpeed(height: number): number {
  return 2.2 + Math.min(3, height * 0.09);
}

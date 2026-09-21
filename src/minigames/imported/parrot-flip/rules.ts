import type { Rng } from "../../../core/rng";

/** Tosses each seat gets in a party round. Short enough for a minigame, long enough to miss. */
export const TOSSES_EACH = 4;

export interface FlipSeat {
  playerId: string;
  makes: number;
  tosses: number;
}

export function dealSeats(playerIds: readonly string[]): FlipSeat[] {
  return playerIds.map((playerId) => ({ playerId, makes: 0, tosses: 0 }));
}

export function recordToss(seat: FlipSeat, made: boolean): FlipSeat {
  return {
    playerId: seat.playerId,
    makes: seat.makes + (made ? 1 : 0),
    tosses: seat.tosses + 1,
  };
}

export function seatDone(seat: FlipSeat): boolean {
  return seat.tosses >= TOSSES_EACH;
}

export function allDone(seats: readonly FlipSeat[]): boolean {
  return seats.length > 0 && seats.every(seatDone);
}

/** Next player who still has a toss. Wraps. Returns -1 when the round is over. */
export function nextTurnIndex(seats: readonly FlipSeat[], current: number): number {
  if (allDone(seats)) return -1;
  const n = seats.length;
  for (let step = 1; step <= n; step += 1) {
    const index = (current + step) % n;
    if (!seatDone(seats[index]!)) return index;
  }
  return -1;
}

/** CPU aims at the ~2100 px/s sweet spot with classroom miss chance. */
export function botFlick(rng: Rng): { vx: number; vy: number } {
  const sigma = 540;
  const u1 = Math.max(rng.next(), 1e-6);
  const u2 = rng.next();
  const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const up = Math.max(500, 2100 + gauss * sigma);
  const vx = (rng.next() - 0.5) * 520;
  return { vx, vy: -up };
}

export function scoresFromSeats(seats: readonly FlipSeat[]): { playerId: string; score: number }[] {
  return seats.map((seat) => ({ playerId: seat.playerId, score: seat.makes }));
}

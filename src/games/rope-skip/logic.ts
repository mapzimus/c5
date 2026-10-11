/** Pure Rope Skip rules: rope phase, jump arc, sweep check, bot timing, scoring. No DOM. */

export const TAU = Math.PI * 2;
export const ROUND_SECONDS = 15;
export const AIR_TIME = 0.45;
/** Fraction of the jump arc's peak the feet must clear for the rope to pass under. */
export const CLEAR_FRACTION = 0.2;
/** Rope angular speed limits (rad/s). One full turn takes TAU / omega seconds. */
export const MIN_OMEGA = 2.4;
export const MAX_OMEGA = 9;
/** Rope phase where it sweeps the jumpers' feet. 0 = overhead. */
export const BOTTOM = Math.PI;
export const BOT_LEAD = 0.2;
/** Every this many clears in a row pays a bonus point. */
export const STREAK_EVERY = 5;
/** Clearing with less height margin than this is a close call (sparks, no bonus). */
export const CLOSE_CALL_MARGIN = 0.12;

export function clampOmega(omega: number): number {
  return Math.min(MAX_OMEGA, Math.max(MIN_OMEGA, Math.abs(omega)));
}

/** True when the rope passed its bottom while moving from `prev` to `next` (unwrapped angles, next >= prev). */
export function crossedBottom(prev: number, next: number): boolean {
  return Math.floor((next - BOTTOM) / TAU) > Math.floor((prev - BOTTOM) / TAU);
}

/** Seconds until the rope next reaches the bottom at constant `omega`. */
export function timeToBottom(phi: number, omega: number): number {
  let d = (BOTTOM - phi) % TAU;
  if (d <= 0) d += TAU;
  return d / Math.max(1e-6, omega);
}

/** Jump height as a fraction of peak (0..1) `t` seconds after takeoff. 0 when grounded. */
export function jumpHeight(t: number | null): number {
  if (t === null || t < 0 || t >= AIR_TIME) return 0;
  const u = t / AIR_TIME;
  return 4 * u * (1 - u);
}

/** True when a jumper `t` seconds into a jump (null = grounded) is high enough to clear the rope. */
export function isClear(t: number | null): boolean {
  return jumpHeight(t) > CLEAR_FRACTION;
}

/** Bonus points awarded when a jumper's clear streak reaches `streak` (1 per STREAK_EVERY). */
export function streakBonus(streak: number): number {
  return streak > 0 && streak % STREAK_EVERY === 0 ? 1 : 0;
}

/** True when a clear was barely a clear. */
export function isCloseCall(t: number | null): boolean {
  const h = jumpHeight(t);
  return h > CLEAR_FRACTION && h < CLEAR_FRACTION + CLOSE_CALL_MARGIN;
}

/** Launch velocity (px/s) for a jumper the rope just swept, scaled by rope speed. */
export function knockVelocity(omega: number, rand: () => number): { vx: number; vy: number; spin: number } {
  const k = omega / MAX_OMEGA;
  return {
    vx: 180 + k * 420 + rand() * 80,
    vy: -(260 + k * 360),
    spin: 6 + k * 10 + rand() * 4,
  };
}

/** Wrapped signed angle difference in (-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/**
 * Spinner order: index into players for each round. A solo player gets a single
 * round against the CPU spinner (-1).
 */
export function spinnerOrder(playerCount: number): number[] {
  if (playerCount <= 1) return [-1];
  return Array.from({ length: playerCount }, (_, i) => i);
}

/**
 * Points for one round. `out[i]` = player i was knocked out this round.
 * Survivors get +1, the spinner gets +1 per knockout. Returns per-player deltas.
 */
export function scoreRound(playerCount: number, spinner: number, out: readonly boolean[]): number[] {
  const delta = new Array<number>(playerCount).fill(0);
  let knocks = 0;
  for (let i = 0; i < playerCount; i++) {
    if (i === spinner) continue;
    if (out[i]) knocks++;
    else delta[i] = 1;
  }
  if (spinner >= 0) delta[spinner] = knocks;
  return delta;
}

export interface SpinSegment {
  kind: "cruise" | "burst" | "stutter";
  omega: number;
  duration: number;
}

/** Next chunk of the bot spinner's random schedule. */
export function nextBotSegment(rand: () => number): SpinSegment {
  const r = rand();
  const span = (a: number, b: number) => a + rand() * (b - a);
  if (r < 0.25) return { kind: "burst", omega: span(7, MAX_OMEGA), duration: span(0.6, 1.4) };
  if (r < 0.45) return { kind: "stutter", omega: MIN_OMEGA, duration: span(0.25, 0.6) };
  return { kind: "cruise", omega: span(3.2, 6), duration: span(1, 2.4) };
}

/** How early (s before the rope hits bottom) a bot jumper takes off this turn. */
export function botLead(rand: () => number): number {
  const noise = (rand() + rand() - 1) * 0.06;
  if (rand() < 0.08) return BOT_LEAD + (rand() < 0.5 ? -0.22 : 0.3);
  return BOT_LEAD + noise;
}

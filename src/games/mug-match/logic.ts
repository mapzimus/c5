import type { Rng } from "../../core/rng";

/**
 * Pure rules for Mug Match. No canvas, no DOM.
 * Face space: head radius = 1, origin at the head centre, y grows downwards.
 */

export const ROUNDS = 3;
export const ROUND_MS = 12_000;

export interface Pt {
  x: number;
  y: number;
}

/** Handle order: left eye, right eye, left brow end, right brow end, left mouth corner, right mouth corner, nose tip. */
export const HANDLE_COUNT = 7;
export const LEFT_EYE = 0;
export const RIGHT_EYE = 1;
export const LEFT_BROW = 2;
export const RIGHT_BROW = 3;
export const LEFT_MOUTH = 4;
export const RIGHT_MOUTH = 5;
export const NOSE = 6;
export type Handles = Pt[];

/** Param order: eye spacing, eye height, eye size, mouth width, mouth curve, nose length, brow tilt. All normalised 0..1. */
export const PARAM_COUNT = 7;
export type Params = number[];

/** Face-space range of each param (min at 0, max at 1). */
export const RANGES: readonly (readonly [number, number])[] = [
  [0.18, 0.62], // eye spacing (half distance between eyes)
  [-0.66, -0.04], // eye height (y of the eyes)
  [0.05, 0.24], // eye size (radius); drives the brow-to-eye gap
  [0.12, 0.72], // mouth width (half)
  [-0.38, 0.38], // mouth curve (corner y relative to MOUTH_Y; negative = smile)
  [0.1, 0.72], // nose length (tip y below the root)
  [-0.4, 0.4], // brow tilt (right brow end y minus left brow end y)
];

export const MOUTH_Y = 0.42;
export const NOSE_ROOT_Y = -0.08;
/** The brow sits this far above the eye at eye size 0, plus twice the eye radius. */
const BROW_GAP_BASE = 0.06;
const BROW_OUT = 0.14;

/** How far a handle may be dragged from the head centre. */
export const HANDLE_LIMIT = 1.5;

export function baseParams(): Params {
  return Array(PARAM_COUNT).fill(0.5);
}

function unnorm(p: Params, i: number): number {
  const r = RANGES[i]!;
  return r[0] + (p[i] ?? 0.5) * (r[1] - r[0]);
}

function norm(value: number, i: number): number {
  const r = RANGES[i]!;
  return (value - r[0]) / (r[1] - r[0]);
}

/** Symmetric handle layout for a set of params. */
export function handlesFromParams(p: Params): Handles {
  const eyeX = unnorm(p, 0);
  const eyeY = unnorm(p, 1);
  const eyeSize = unnorm(p, 2);
  const mouthW = unnorm(p, 3);
  const curve = unnorm(p, 4);
  const nose = unnorm(p, 5);
  const tilt = unnorm(p, 6);
  const browY = eyeY - (eyeSize * 2 + BROW_GAP_BASE);
  return [
    { x: -eyeX, y: eyeY },
    { x: eyeX, y: eyeY },
    { x: -eyeX - BROW_OUT, y: browY - tilt / 2 },
    { x: eyeX + BROW_OUT, y: browY + tilt / 2 },
    { x: -mouthW, y: MOUTH_Y + curve },
    { x: mouthW, y: MOUTH_Y + curve },
    { x: 0, y: NOSE_ROOT_Y + nose },
  ];
}

/** Eye radius implied by the brow-to-eye gap (raise the brows and the eyes bulge). */
export function eyeRadius(h: Handles): number {
  const eyeY = (h[LEFT_EYE]!.y + h[RIGHT_EYE]!.y) / 2;
  const browY = (h[LEFT_BROW]!.y + h[RIGHT_BROW]!.y) / 2;
  return Math.max(0.03, Math.min(0.42, (eyeY - browY - BROW_GAP_BASE) / 2));
}

/** The params a handle layout expresses. Not clamped: overshooting the range counts against you. */
export function paramsFromHandles(h: Handles): Params {
  const le = h[LEFT_EYE]!, re = h[RIGHT_EYE]!, lb = h[LEFT_BROW]!, rb = h[RIGHT_BROW]!;
  const lm = h[LEFT_MOUTH]!, rm = h[RIGHT_MOUTH]!, n = h[NOSE]!;
  const eyeY = (le.y + re.y) / 2;
  const browY = (lb.y + rb.y) / 2;
  return [
    norm((re.x - le.x) / 2, 0),
    norm(eyeY, 1),
    norm((eyeY - browY - BROW_GAP_BASE) / 2, 2),
    norm((rm.x - lm.x) / 2, 3),
    norm((lm.y + rm.y) / 2 - MOUTH_Y, 4),
    norm(n.y - NOSE_ROOT_Y, 5),
    norm(rb.y - lb.y, 6),
  ];
}

/** 100 at a perfect match; a mean half-range miss across the params is 0. */
export function matchPercent(a: Params, b: Params): number {
  let sum = 0;
  for (let i = 0; i < PARAM_COUNT; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  const dist = Math.min(1, sum / PARAM_COUNT / 0.5);
  return Math.max(0, Math.min(100, Math.round(100 * (1 - dist))));
}

/** A target face for round `round` (0-based). Later rounds push every param further from neutral. */
export function randomTarget(round: number, rng: Rng): Params {
  const spread = Math.min(1, 0.55 + round * 0.225);
  const push = Math.min(0.6, round * 0.3);
  const out: Params = [];
  for (let i = 0; i < PARAM_COUNT; i++) {
    const v = rng.float(-1, 1);
    const sign = v < 0 ? -1 : 1;
    const mag = Math.abs(v) * (1 - push) + push;
    out.push(0.5 + sign * mag * 0.5 * spread);
  }
  return out;
}

export function clampHandle(p: Pt): Pt {
  return {
    x: Math.max(-HANDLE_LIMIT, Math.min(HANDLE_LIMIT, p.x)),
    y: Math.max(-HANDLE_LIMIT, Math.min(HANDLE_LIMIT, p.y)),
  };
}

/** Rubbery skin: a spring per handle that lags behind, overshoots and settles. */
export interface Spring {
  pos: Pt[];
  vel: Pt[];
}

export function newSpring(h: Handles): Spring {
  return { pos: h.map((p) => ({ ...p })), vel: h.map(() => ({ x: 0, y: 0 })) };
}

export function resetSpring(s: Spring, h: Handles): void {
  for (let i = 0; i < h.length; i++) {
    s.pos[i] = { ...h[i]! };
    s.vel[i] = { x: 0, y: 0 };
  }
}

export function stepSpring(s: Spring, h: Handles, dt: number, stiffness = 220, damping = 14): void {
  const step = Math.min(dt, 1 / 30);
  for (let i = 0; i < h.length; i++) {
    const p = s.pos[i]!, v = s.vel[i]!, t = h[i]!;
    v.x += ((t.x - p.x) * stiffness - v.x * damping) * step;
    v.y += ((t.y - p.y) * stiffness - v.y * damping) * step;
    p.x += v.x * step;
    p.y += v.y * step;
  }
}

/** Bot: drags one handle at a time toward a noisy copy of the target. */
export interface BotState {
  goal: Handles;
  queue: number[];
  current: number | null;
  wait: number;
  speed: number;
}

/** `error` 0.05-0.25: how far off (in param units) the bot's idea of the target is. */
export function planBot(target: Params, error: number, rng: Rng): BotState {
  const goalParams = target.map((p) => p + rng.float(-error, error) * 1.5);
  const queue = [LEFT_EYE, RIGHT_EYE, LEFT_BROW, RIGHT_BROW, LEFT_MOUTH, RIGHT_MOUTH, NOSE];
  for (let i = queue.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const a = queue[i]!, b = queue[j]!;
    queue[i] = b;
    queue[j] = a;
  }
  return { goal: handlesFromParams(goalParams), queue, current: null, wait: rng.float(0.4, 1.0), speed: rng.float(5, 8) };
}

/** Advance the bot; mutates `handles`. Returns true when the bot moved something this step. */
export function stepBot(bot: BotState, handles: Handles, dt: number, rng: Rng): boolean {
  bot.wait -= dt;
  if (bot.wait > 0) return false;
  if (bot.current === null) {
    const next = bot.queue.shift();
    if (next === undefined) return false;
    bot.current = next;
  }
  const i = bot.current;
  const h = handles[i]!, g = bot.goal[i]!;
  const k = 1 - Math.exp(-bot.speed * dt);
  h.x += (g.x - h.x) * k;
  h.y += (g.y - h.y) * k;
  if (Math.hypot(g.x - h.x, g.y - h.y) < 0.012) {
    h.x = g.x;
    h.y = g.y;
    bot.current = null;
    bot.wait = rng.float(0.1, 0.45);
  }
  return true;
}

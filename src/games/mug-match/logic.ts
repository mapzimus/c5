import type { Rng } from "../../core/rng";

/**
 * Pure rules for Mug Shots (id "mug-match"). No canvas, no DOM.
 * Face space: head radius = 1, origin at the head centre, y grows downwards.
 */

export const ROUNDS = 4;
/** Seconds per round: the booth gets quicker as the mugs get uglier. */
export const ROUND_SECONDS: readonly number[] = [11, 10, 9, 9];
export const ROUND_NAMES: readonly string[] = ["ODD", "WEIRD", "ABSURD", "FINAL"];
/** Kept for callers that only want a nominal round length. */
export const ROUND_MS = 12_000;
/** The last round pays double. */
export const FINAL_STAKES = 2;
/** Tomatoes each player may throw per round, unlocked once they have snapped. */
export const TOMATOES_PER_ROUND = 1;
/** Points for splatting a mug that is still being sculpted. */
export const SPLAT_BONUS = 10;

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

/** 100 at a perfect match; a mean miss of 40% of a param's range is 0. Strict enough that a blank mug scores poorly. */
export const MISS_FOR_ZERO = 0.4;
export function matchPercent(a: Params, b: Params): number {
  let sum = 0;
  for (let i = 0; i < PARAM_COUNT; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  const dist = Math.min(1, sum / PARAM_COUNT / MISS_FOR_ZERO);
  return Math.max(0, Math.min(100, Math.round(100 * (1 - dist))));
}

/**
 * A target face for round `round` (0-based). Every param is pushed well away from neutral so an untouched mug
 * is never worth snapping; later rounds push further and spread wider.
 */
export function randomTarget(round: number, rng: Rng): Params {
  const spread = Math.min(1, 0.75 + round * 0.1);
  const push = Math.min(0.6, 0.4 + round * 0.1);
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

// ── Rounds, the flash bonus and snapping ──

export function roundSeconds(round: number): number {
  return ROUND_SECONDS[Math.min(round, ROUND_SECONDS.length - 1)] ?? 12;
}

export function roundName(round: number): string {
  return ROUND_NAMES[Math.min(round, ROUND_NAMES.length - 1)] ?? "FINAL";
}

/** Point multiplier for the round: the last round pays double. */
export function roundStakes(round: number): number {
  return round >= ROUNDS - 1 ? FINAL_STAKES : 1;
}

/** Flash bonus: x2 at the opening whistle, draining to x1 at the buzzer. Snap early and it is yours. */
export function flashMult(timeLeft: number, roundS: number): number {
  const f = Math.max(0, Math.min(1, roundS > 0 ? timeLeft / roundS : 0));
  return 1 + f;
}

/** Points for snapping a mug of `match` % with `timeLeft` seconds on the clock. */
export function snapScore(match: number, timeLeft: number, roundS: number, round: number): number {
  return Math.round(match * flashMult(timeLeft, roundS) * roundStakes(round));
}

export type Tier = "PERFECT" | "SO CLOSE" | "NICE" | "MEH" | "WHO?";

/** A word for a snapped match %. 85-89 is a near miss on PERFECT. */
export function scoreTier(match: number): Tier {
  if (match >= 90) return "PERFECT";
  if (match >= 85) return "SO CLOSE";
  if (match >= 65) return "NICE";
  if (match >= 40) return "MEH";
  return "WHO?";
}

/** Seats on the lowest total get the underdog guide next round. Nobody does when everyone is level. */
export function underdogs(totals: readonly number[]): number[] {
  if (totals.length < 2) return [];
  const min = Math.min(...totals);
  const max = Math.max(...totals);
  if (min === max) return [];
  const out: number[] = [];
  totals.forEach((t, i) => { if (t === min) out.push(i); });
  return out;
}

/** A tomato lands: the handle is yanked 0.2-0.35 head radii in a random direction (roughly -20% match until fixed). */
export function knockHandle(h: Pt, rng: Rng): Pt {
  const a = rng.float(0, Math.PI * 2);
  const d = rng.float(0.2, 0.35);
  return clampHandle({ x: h.x + Math.cos(a) * d, y: h.y + Math.sin(a) * d });
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

// ── Bots ──

/** Bot: drags one handle at a time toward a noisy copy of the target, then eyeballs its mug and snaps. */
export interface BotState {
  goal: Handles;
  queue: number[];
  current: number | null;
  wait: number;
  speed: number;
  /** 0 = patient perfectionist, 1 = trigger happy. */
  greed: number;
  /** Seconds until the bot commits to a snap it has decided on; negative while undecided. */
  decide: number;
  /** The bot's (noisy) idea of its own match %. */
  estimate: number;
  /** Seconds until the bot throws the tomato it has decided to throw; negative while undecided. */
  throwIn: number;
  /** Second-guessing tweaks left once every handle has been placed (perfectionists fuss more). */
  fuss: number;
  /** Seconds until the bot next looks at its mug and re-estimates. */
  look: number;
}

/** `error` 0.05-0.25: how far off (in param units) the bot's idea of the target is. */
export function planBot(target: Params, error: number, rng: Rng, greed = rng.float(0, 1)): BotState {
  const goalParams = target.map((p) => p + rng.float(-error, error) * 1.5);
  const queue = [LEFT_EYE, RIGHT_EYE, LEFT_BROW, RIGHT_BROW, LEFT_MOUTH, RIGHT_MOUTH, NOSE];
  for (let i = queue.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const a = queue[i]!, b = queue[j]!;
    queue[i] = b;
    queue[j] = a;
  }
  return {
    goal: handlesFromParams(goalParams), queue, current: null, wait: rng.float(0.5, 1.4), speed: rng.float(3.5, 6),
    greed, decide: -1, estimate: 0, throwIn: -1, fuss: Math.round((1 - greed) * 3), look: 0,
  };
}

/** Advance the bot; mutates `handles`. Returns true when the bot moved something this step. */
export function stepBot(bot: BotState, handles: Handles, dt: number, rng: Rng): boolean {
  bot.wait -= dt;
  if (bot.wait > 0) return false;
  if (bot.current === null) {
    const next = bot.queue.shift();
    if (next !== undefined) {
      bot.current = next;
    } else {
      // Repairs: a tomato knocked something, so go back and fix the worst handle.
      let worst = -1;
      let worstD = 0.06;
      for (let i = 0; i < handles.length; i++) {
        const d = Math.hypot(bot.goal[i]!.x - handles[i]!.x, bot.goal[i]!.y - handles[i]!.y);
        if (d > worstD) { worstD = d; worst = i; }
      }
      if (worst >= 0) {
        bot.current = worst;
      } else if (bot.fuss > 0) {
        // Everything is placed; a fussy bot still nudges something "just a touch".
        bot.fuss -= 1;
        const i = rng.int(0, handles.length - 1);
        const g = bot.goal[i]!;
        bot.goal[i] = clampHandle({ x: g.x + rng.float(-0.03, 0.03), y: g.y + rng.float(-0.03, 0.03) });
        bot.current = i;
        bot.wait = rng.float(0.2, 0.6);
        return false;
      } else {
        return false;
      }
    }
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
    bot.wait = rng.float(0.15, 0.6);
  }
  return true;
}

/** How good a mug must look before a bot snaps it, given the fraction of the round left. */
export function botSnapThreshold(timeFrac: number, greed: number): number {
  return 94 - (1 - timeFrac) * 50 - greed * 24;
}

/**
 * The bot eyeballs its own mug (with noise) and commits when it looks good enough for the time left,
 * then hesitates a beat before pressing. Returns true on the frame it snaps.
 */
export function botSnapCheck(bot: BotState, match: number, timeFrac: number, dt: number, rng: Rng): boolean {
  if (bot.decide >= 0) {
    bot.decide -= dt;
    return bot.decide <= 0;
  }
  bot.look -= dt;
  if (bot.look <= 0) {
    bot.look = rng.float(0.25, 0.5);
    bot.estimate = match + rng.float(-8, 8);
  }
  const panic = timeFrac < 0.1 && rng.next() < dt * 4;
  if (bot.estimate >= botSnapThreshold(timeFrac, bot.greed) || panic) {
    bot.decide = rng.float(0.25, 0.8);
  }
  return false;
}

export interface TargetInfo {
  index: number;
  snapped: boolean;
  /** How much the bot wants them hit: live match % or total points. */
  threat: number;
}

/** Bots throw at whoever is still sculpting and looks most dangerous; -1 when there is nobody worth hitting. */
export function botPickTarget(candidates: readonly TargetInfo[]): number {
  let best = -1;
  let bestThreat = -Infinity;
  for (const c of candidates) {
    if (c.snapped) continue;
    if (c.threat > bestThreat) { bestThreat = c.threat; best = c.index; }
  }
  return best;
}

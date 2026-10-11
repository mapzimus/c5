import type { Rng } from "../../core/rng";

/**
 * Pure rules for Smudge Race: path generation, trace scoring, ink blots (smudges), finish
 * bonuses, the wide-brush comeback and bot tracing. No canvas, no DOM.
 */

export interface Pt {
  x: number;
  y: number;
}

export const ROUNDS = 4;
export const ROUND_TIME_S = 13;
/** Once someone finishes, everyone else has this long to wrap up. */
export const FINISH_GRACE_S = 3;
/** Straying further than this many tolerances from the path scraps the stroke. */
export const OUTER_BAND = 3;
/** Beyond this many tolerances the stroke is in danger; coming back inside is a close call. */
export const DANGER_BAND = 2.2;
/** Tolerance multiplier for the player in last place (the comeback brush). */
export const WIDE_BRUSH = 1.35;
/** Ink blots a finished player may throw per round. */
export const BLOTS_PER_ROUND = 2;
/** How long a blot hides the path, then how long it takes to dry away. */
export const BLOT_LIFE_S = 2.4;
export const BLOT_FADE_S = 0.5;
/** Bonus points for finishing 1st, 2nd... */
export const FINISH_BONUS: readonly number[] = [10, 5];
/** A scrapped stroke keeps this share of its partial score. */
export const SCRAP_KEEP = 0.5;

export interface RoundConfig {
  /** Random control points on the squiggle. */
  points: number;
  /** Tolerance band radius as a fraction of the zone width. */
  tol: number;
  /** Round score multiplier. */
  mult: number;
  /** Blot radius in tolerances. */
  blotR: number;
  /** Shown on the round card when set. */
  title?: string;
}

/** Each round: more control points, thinner band. The last round is the Inkstorm climax. */
export const ROUND_CONFIG: readonly RoundConfig[] = [
  { points: 5, tol: 0.1, mult: 1, blotR: 4.2 },
  { points: 6, tol: 0.085, mult: 1, blotR: 4.6 },
  { points: 7, tol: 0.07, mult: 1, blotR: 5 },
  { points: 8, tol: 0.06, mult: 1.5, blotR: 5.6, title: "INKSTORM" },
];

export interface TracePath {
  /** Sampled polyline in zone-local coords. */
  pts: Pt[];
  /** Cumulative arc length at each point. */
  cum: number[];
  length: number;
  tol: number;
  /** How close to the first point a stroke must begin. */
  startR: number;
}

/**
 * Control points in normalized 0..1 coords: top to bottom with jittered spacing,
 * alternating left/right so the curve is a readable squiggle.
 */
export function generateControls(rng: Rng, count: number): Pt[] {
  const n = Math.max(2, count);
  const side = rng.sign();
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const base = i / (n - 1);
    const jitter = i === 0 || i === n - 1 ? 0 : rng.float(-0.25, 0.25) / (n - 1);
    const y = Math.min(1, Math.max(0, base + jitter));
    const left = (i % 2 === 0) === (side > 0);
    const x = left ? rng.float(0.05, 0.42) : rng.float(0.58, 0.95);
    pts.push({ x, y });
  }
  return pts;
}

/** Centripetal-ish Catmull-Rom spline through all control points (endpoints duplicated). */
export function catmullRom(controls: readonly Pt[], stepsPerSegment = 24): Pt[] {
  if (controls.length < 2) return controls.slice();
  const out: Pt[] = [];
  const first = controls[0]!;
  const last = controls[controls.length - 1]!;
  const get = (i: number): Pt => (i < 0 ? first : i >= controls.length ? last : controls[i]!);
  for (let i = 0; i < controls.length - 1; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    const steps = i === controls.length - 2 ? stepsPerSegment + 1 : stepsPerSegment;
    for (let k = 0; k < steps; k++) {
      const t = Math.min(1, k / stepsPerSegment);
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return out;
}

export interface Fit {
  /** Zone size in px. */
  w: number;
  h: number;
  padX: number;
  padTop: number;
  padBottom: number;
  tol: number;
  startR: number;
}

/** Map normalized controls into a zone, sample the curve and measure it. */
export function buildPath(controls: readonly Pt[], fit: Fit): TracePath {
  const innerW = Math.max(1, fit.w - fit.padX * 2);
  const innerH = Math.max(1, fit.h - fit.padTop - fit.padBottom);
  const scaled = controls.map((c) => ({ x: fit.padX + c.x * innerW, y: fit.padTop + c.y * innerH }));
  const pts = catmullRom(scaled);
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return { pts, cum, length: cum[cum.length - 1] ?? 0, tol: fit.tol, startR: fit.startR };
}

export function pathStart(path: TracePath): Pt {
  return path.pts[0] ?? { x: 0, y: 0 };
}

export function pathEnd(path: TracePath): Pt {
  return path.pts[path.pts.length - 1] ?? { x: 0, y: 0 };
}

/** Point on the path at arc length `s`, plus its unit normal. */
export function pointAt(path: TracePath, s: number): { x: number; y: number; nx: number; ny: number } {
  const n = path.pts.length;
  if (n < 2) {
    const p = pathStart(path);
    return { x: p.x, y: p.y, nx: 0, ny: 0 };
  }
  const target = Math.min(path.length, Math.max(0, s));
  let i = 0;
  while (i < n - 2 && path.cum[i + 1]! < target) i++;
  const a = path.pts[i]!;
  const b = path.pts[i + 1]!;
  const seg = path.cum[i + 1]! - path.cum[i]!;
  const t = seg > 0 ? (target - path.cum[i]!) / seg : 0;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: a.x + dx * t, y: a.y + dy * t, nx: -dy / len, ny: dx / len };
}

export interface Nearest {
  dist: number;
  /** Arc length of the nearest point. */
  s: number;
  /** Segment index of the nearest point. */
  idx: number;
}

/**
 * Nearest point on the path to `p`, searching only segments whose arc length is within
 * [sFrom - back, sFrom + fwd] so a squiggle that doubles back cannot be skipped.
 */
export function nearestOnPath(path: TracePath, p: Pt, sFrom: number, back: number, fwd: number): Nearest {
  const n = path.pts.length;
  let best: Nearest = { dist: Infinity, s: sFrom, idx: 0 };
  if (n < 2) return best;
  const lo = sFrom - back;
  const hi = sFrom + fwd;
  for (let i = 0; i < n - 1; i++) {
    if (path.cum[i + 1]! < lo || path.cum[i]! > hi) continue;
    const a = path.pts[i]!;
    const b = path.pts[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segLen2 = dx * dx + dy * dy;
    const t = segLen2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / segLen2)) : 0;
    const qx = a.x + dx * t;
    const qy = a.y + dy * t;
    const d = Math.hypot(p.x - qx, p.y - qy);
    if (d < best.dist) best = { dist: d, s: path.cum[i]! + Math.sqrt(segLen2) * t, idx: i };
  }
  return best;
}

export type TraceState = "idle" | "tracing" | "done";

export interface Trace {
  state: TraceState;
  /** Stroke points for drawing. */
  points: Pt[];
  samples: number;
  hits: number;
  /** Arc length of the finger's current spot on the path. */
  s: number;
  /** Furthest arc length reached this stroke. */
  progress: number;
  /** Last sampled point (samples need a minimum spacing). */
  lastSample: Pt | null;
  scraps: number;
  /** Consecutive in-band samples (the heat meter) and the best run this round. */
  streak: number;
  bestStreak: number;
  /** True while the finger is past the danger band. */
  danger: boolean;
  /** Times the finger came back from the danger band without scrapping. */
  closeCalls: number;
  /** Best (fraction traced x accuracy) of any scrapped stroke this round, 0..1. */
  bestPartial: number;
}

export function newTrace(): Trace {
  return {
    state: "idle", points: [], samples: 0, hits: 0, s: 0, progress: 0, lastSample: null, scraps: 0,
    streak: 0, bestStreak: 0, danger: false, closeCalls: 0, bestPartial: 0,
  };
}

const SAMPLE_SPACING = 3;

/** Try to start a stroke at `p`. Only works on the START dot. */
export function beginTrace(trace: Trace, path: TracePath, p: Pt): boolean {
  if (trace.state !== "idle") return false;
  const start = pathStart(path);
  if (Math.hypot(p.x - start.x, p.y - start.y) > path.startR) return false;
  trace.state = "tracing";
  trace.points = [{ x: p.x, y: p.y }];
  trace.samples = 0;
  trace.hits = 0;
  trace.s = 0;
  trace.progress = 0;
  trace.lastSample = null;
  trace.streak = 0;
  trace.danger = false;
  return true;
}

export type FeedResult = "ignored" | "ok" | "scrapped" | "finished";

/** Fraction of the path traced times accuracy, 0..1, for the current stroke. */
function partial(trace: Trace, path: TracePath): number {
  const frac = path.length > 0 ? Math.min(1, trace.progress / path.length) : 0;
  return frac * accuracy(trace);
}

function scrap(trace: Trace, path: TracePath): "scrapped" {
  trace.bestPartial = Math.max(trace.bestPartial, partial(trace, path));
  trace.state = "idle";
  trace.points = [];
  trace.s = 0;
  trace.progress = 0;
  trace.streak = 0;
  trace.danger = false;
  trace.scraps += 1;
  return "scrapped";
}

/** Feed a finger position while tracing. Strays outside the outer band scrap the stroke. */
export function feedTrace(trace: Trace, path: TracePath, p: Pt): FeedResult {
  if (trace.state !== "tracing") return "ignored";
  trace.points.push({ x: p.x, y: p.y });
  const near = nearestOnPath(path, p, trace.s, path.tol * 4, Math.max(path.length * 0.15, path.tol * 6));
  if (near.dist > path.tol * OUTER_BAND) return scrap(trace, path);
  trace.s = near.s;
  trace.progress = Math.max(trace.progress, near.s);
  if (near.dist > path.tol * DANGER_BAND) {
    trace.danger = true;
  } else if (trace.danger && near.dist <= path.tol) {
    trace.danger = false;
    trace.closeCalls += 1;
  }
  const last = trace.lastSample;
  if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= SAMPLE_SPACING) {
    trace.samples += 1;
    if (near.dist <= path.tol) {
      trace.hits += 1;
      trace.streak += 1;
      trace.bestStreak = Math.max(trace.bestStreak, trace.streak);
    } else {
      trace.streak = 0;
    }
    trace.lastSample = { x: p.x, y: p.y };
  }
  const end = pathEnd(path);
  if (near.s >= path.length - path.tol * 2 && Math.hypot(p.x - end.x, p.y - end.y) <= path.tol * 2) {
    trace.state = "done";
    trace.progress = path.length;
    return "finished";
  }
  return "ok";
}

/** Finger lifted. Lifting before END scraps the stroke. */
export function liftTrace(trace: Trace, path: TracePath): FeedResult {
  if (trace.state !== "tracing") return "ignored";
  return scrap(trace, path);
}

/** Fraction of sampled points inside the tolerance band, 0..1. */
export function accuracy(trace: Trace): number {
  return trace.samples === 0 ? 0 : trace.hits / trace.samples;
}

/**
 * Round score 0-100 before bonuses: accuracy when finished, else the live stroke's
 * (fraction traced x accuracy), or half of the best scrapped stroke's, whichever is higher.
 */
export function roundScore(trace: Trace, path: TracePath): number {
  if (trace.state === "done") return Math.round(accuracy(trace) * 100);
  const live = trace.state === "tracing" ? partial(trace, path) : 0;
  return Math.round(Math.max(live, trace.bestPartial * SCRAP_KEEP) * 100);
}

/** Bonus for finishing in `place` (0 = first). */
export function finishBonus(place: number): number {
  return FINISH_BONUS[place] ?? 0;
}

/** Final round score: base plus finish bonus, times the round multiplier. */
export function totalRoundScore(base: number, place: number | null, mult: number): number {
  return Math.round((base + (place === null ? 0 : finishBonus(place))) * mult);
}

/** Seats with the lowest total get the wide brush; nobody does when everyone is level. */
export function wideBrushSeats(totals: readonly number[]): boolean[] {
  if (totals.length === 0) return [];
  const lo = Math.min(...totals);
  const hi = Math.max(...totals);
  return totals.map((t) => hi > lo && t === lo);
}

/** An ink blot hiding part of a rival's lane. */
export interface Blot {
  x: number;
  y: number;
  r: number;
  life: number;
  maxLife: number;
  /** Shape seed for the splat lobes. */
  seed: number;
  /** Colour of whoever threw it. */
  color: string;
}

export function newBlot(x: number, y: number, r: number, color: string, seed: number): Blot {
  const life = BLOT_LIFE_S + BLOT_FADE_S;
  return { x, y, r, life, maxLife: life, seed, color };
}

/** Age blots and drop the dry ones. Returns the live list. */
export function stepBlots(blots: Blot[], dt: number): Blot[] {
  for (const b of blots) b.life -= dt;
  return blots.filter((b) => b.life > 0);
}

/** 1 while wet, fading to 0 over the last BLOT_FADE_S. */
export function blotAlpha(b: Blot): number {
  return Math.max(0, Math.min(1, b.life / BLOT_FADE_S));
}

export function inBlot(blots: readonly Blot[], p: Pt): boolean {
  for (const b of blots) {
    if (blotAlpha(b) > 0.3 && Math.hypot(p.x - b.x, p.y - b.y) <= b.r) return true;
  }
  return false;
}

/**
 * Where a thrown blot lands in the target's lane: a little ahead of a tracing finger so it
 * hides the upcoming stretch, or somewhere in the middle of the path for an idle one.
 */
export function blotLanding(path: TracePath, trace: Trace, rng: Rng): Pt {
  const s = trace.state === "tracing"
    ? Math.min(path.length - path.tol * 4, trace.progress + path.length * 0.14)
    : path.length * rng.float(0.3, 0.7);
  const q = pointAt(path, Math.max(0, s));
  return { x: q.x, y: q.y };
}

export interface SmudgeCandidate {
  finished: boolean;
  /** Running total plus the live round score: who is winning right now. */
  score: number;
}

/** The unfinished rival with the highest score, or -1 when nobody is left to smudge. */
export function pickSmudgeTarget(seats: readonly SmudgeCandidate[], self: number): number {
  let best = -1;
  for (let i = 0; i < seats.length; i++) {
    const c = seats[i]!;
    if (i === self || c.finished) continue;
    if (best === -1 || c.score > seats[best]!.score) best = i;
  }
  return best;
}

export interface Bot {
  skill: number;
  /** Seconds before the bot puts its finger down. */
  delay: number;
  /** Path length per second. */
  speed: number;
  s: number;
  noise: number;
  target: number;
  retime: number;
  amp: number;
  started: boolean;
  /** Seconds until the next human-like slip, and how long the current one lasts. */
  slipIn: number;
  slipLeft: number;
  /** Slip offset in tolerances (signed). */
  slipK: number;
}

export interface BotOptions {
  /** Let the bot make occasional slips toward the outer band (default true). */
  slips?: boolean;
}

/** Bots trace at a fixed pace with smoothed perpendicular wobble sized so they land near `skill` accuracy. */
export function newBot(rng: Rng, path: TracePath, skill = rng.float(0.7, 0.95), opts: BotOptions = {}): Bot {
  return {
    skill,
    delay: rng.float(0.3, 1.0),
    speed: path.length / rng.float(5, 7.5),
    s: 0,
    noise: 0,
    target: 0,
    retime: 0,
    amp: (path.tol / skill) * 1.45,
    started: false,
    slipIn: opts.slips === false ? Infinity : rng.float(2.2, 5),
    slipLeft: 0,
    slipK: 0,
  };
}

/**
 * Advance the bot. Returns the finger position to feed, or null while it waits / after it finished.
 * A blinded bot (inside a blot) wobbles much wider, like a human tracing from memory.
 */
export function stepBot(bot: Bot, path: TracePath, rng: Rng, dt: number, blind = false): Pt | null {
  if (bot.delay > 0) {
    bot.delay -= dt;
    if (bot.delay > 0) return null;
  }
  if (bot.started) bot.s = Math.min(path.length, bot.s + bot.speed * dt);
  bot.started = true;
  bot.retime -= dt;
  if (bot.retime <= 0) {
    bot.target = rng.float(-1, 1);
    bot.retime = blind ? rng.float(0.2, 0.5) : rng.float(0.08, 0.3);
  }
  bot.noise += (bot.target - bot.noise) * Math.min(1, dt * 10);
  // Settle onto the dots at both ends so the stroke starts and finishes cleanly.
  const edge = Math.min(bot.s, path.length - bot.s) / (path.tol * 3);
  const envelope = Math.max(0, Math.min(1, edge));
  const q = pointAt(path, bot.s);
  let off = bot.noise * bot.amp * (blind ? 1.9 : 1) * envelope;
  if (bot.slipLeft > 0) {
    bot.slipLeft -= dt;
    off = bot.slipK * path.tol * envelope;
  } else {
    bot.slipIn -= dt;
    if (bot.slipIn <= 0 && envelope >= 1) {
      bot.slipLeft = 0.22;
      bot.slipK = rng.float(2.2, 3.3) * rng.sign();
      bot.slipIn = rng.float(2.5, 5);
    }
  }
  return { x: q.x + q.nx * off, y: q.y + q.ny * off };
}

import type { Rng } from "../../core/rng";

/** Pure rules for Scribble Race: path generation, trace scoring and bot tracing. No canvas, no DOM. */

export interface Pt {
  x: number;
  y: number;
}

export const ROUNDS = 3;
export const ROUND_TIME_S = 15;
/** Once someone finishes, everyone else has this long to wrap up. */
export const FINISH_GRACE_S = 2.5;
/** Straying further than this many tolerances from the path scraps the stroke. */
export const OUTER_BAND = 3;

export interface RoundConfig {
  /** Random control points on the squiggle. */
  points: number;
  /** Tolerance band radius as a fraction of the zone width. */
  tol: number;
}

/** Each round: more control points, thinner band. */
export const ROUND_CONFIG: readonly RoundConfig[] = [
  { points: 5, tol: 0.1 },
  { points: 6, tol: 0.08 },
  { points: 7, tol: 0.065 },
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
}

export function newTrace(): Trace {
  return { state: "idle", points: [], samples: 0, hits: 0, s: 0, progress: 0, lastSample: null, scraps: 0 };
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
  return true;
}

export type FeedResult = "ignored" | "ok" | "scrapped" | "finished";

function scrap(trace: Trace): "scrapped" {
  trace.state = "idle";
  trace.points = [];
  trace.s = 0;
  trace.progress = 0;
  trace.scraps += 1;
  return "scrapped";
}

/** Feed a finger position while tracing. Strays outside the outer band scrap the stroke. */
export function feedTrace(trace: Trace, path: TracePath, p: Pt): FeedResult {
  if (trace.state !== "tracing") return "ignored";
  trace.points.push({ x: p.x, y: p.y });
  const near = nearestOnPath(path, p, trace.s, path.tol * 4, Math.max(path.length * 0.15, path.tol * 6));
  if (near.dist > path.tol * OUTER_BAND) return scrap(trace);
  trace.s = near.s;
  trace.progress = Math.max(trace.progress, near.s);
  const last = trace.lastSample;
  if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= SAMPLE_SPACING) {
    trace.samples += 1;
    if (near.dist <= path.tol) trace.hits += 1;
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
export function liftTrace(trace: Trace): FeedResult {
  if (trace.state !== "tracing") return "ignored";
  return scrap(trace);
}

/** Fraction of sampled points inside the tolerance band, 0..1. */
export function accuracy(trace: Trace): number {
  return trace.samples === 0 ? 0 : trace.hits / trace.samples;
}

/** Round score 0-100: accuracy when finished, else fraction traced times accuracy. */
export function roundScore(trace: Trace, path: TracePath): number {
  const acc = accuracy(trace);
  if (trace.state === "done") return Math.round(acc * 100);
  const frac = path.length > 0 ? Math.min(1, trace.progress / path.length) : 0;
  return Math.round(frac * acc * 100);
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
}

/** Bots trace at a fixed pace with smoothed perpendicular wobble sized so they land near `skill` accuracy. */
export function newBot(rng: Rng, path: TracePath, skill = rng.float(0.7, 0.95)): Bot {
  return {
    skill,
    delay: rng.float(0.3, 1.0),
    speed: path.length / rng.float(5.5, 8.5),
    s: 0,
    noise: 0,
    target: 0,
    retime: 0,
    amp: (path.tol / skill) * 1.45,
    started: false,
  };
}

/** Advance the bot. Returns the finger position to feed, or null while it waits / after it finished. */
export function stepBot(bot: Bot, path: TracePath, rng: Rng, dt: number): Pt | null {
  if (bot.delay > 0) {
    bot.delay -= dt;
    if (bot.delay > 0) return null;
  }
  if (bot.started) bot.s = Math.min(path.length, bot.s + bot.speed * dt);
  bot.started = true;
  bot.retime -= dt;
  if (bot.retime <= 0) {
    bot.target = rng.float(-1, 1);
    bot.retime = rng.float(0.08, 0.3);
  }
  bot.noise += (bot.target - bot.noise) * Math.min(1, dt * 10);
  // Settle onto the dots at both ends so the stroke starts and finishes cleanly.
  const edge = Math.min(bot.s, path.length - bot.s) / (path.tol * 3);
  const envelope = Math.max(0, Math.min(1, edge));
  const q = pointAt(path, bot.s);
  const off = bot.noise * bot.amp * envelope;
  return { x: q.x + q.nx * off, y: q.y + q.ny * off };
}

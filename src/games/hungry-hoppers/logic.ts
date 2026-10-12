/**
 * Pure rules for Chomp (id "hungry-hoppers"): board geometry, marble physics, chomp hitboxes,
 * the belly (unbanked points that a bomb makes you barf), the tilting bowl and bot reads.
 */

export type MarbleKind = "normal" | "gold" | "bomb";

export interface Marble {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: MarbleKind;
}

export const BOARD_W = 1280;
export const BOARD_H = 720;
export const ARENA_X = 640;
export const ARENA_Y = 374;
export const ARENA_R = 300;
export const MARBLE_R = 11;

/** Round length in seconds (must match the definition's durationMs). */
export const DURATION_S = 50;

export const CHOMP_TIME = 0.35;
/** How far the mouth lunges in from its rest spot at full extension. */
export const CHOMP_REACH = 120;
/** Mouth centre at rest sits this far inside the rim. */
export const MOUTH_REST_IN = 28;
export const MOUTH_R = 58;
export const STUN_TIME = 1.2;
/** Each tap while stunned shaves this many seconds off the stun. */
export const MASH_RECOVER = 0.15;

/** Seconds into the round when a frenzy wave floods the bowl. */
export const FRENZY_TIMES: readonly number[] = [12, 26];
export const FRENZY_COUNT = 24;
/** Seconds into the round when OVERDRIVE starts: faster marbles, more gold, double points. */
export const OVERDRIVE_AT = 40;
export const OVERDRIVE_MULT = 2;
/** Gold chance during OVERDRIVE (normally 4%). */
export const OVERDRIVE_GOLD = 0.07;
export const OVERDRIVE_SPEED = 1.4;
export const SPAWN_INTERVAL = 0.4;
export const OVERDRIVE_SPAWN_INTERVAL = 0.22;
export const MAX_LIVE = 34;

const FRICTION = 0.35; // fraction of speed kept per second
const MIN_SPEED = 70;
/** Gold marbles never slow below this: they're fast and hard to catch. */
export const GOLD_MIN_SPEED = 260;
export const GOLD_SPEED_BOOST = 1.8;

export const POINTS: Record<MarbleKind, number> = { normal: 1, gold: 8, bomb: 0 };

/** Every 4 marbles in your belly adds +1x, up to x4. */
export const BELLY_STEP = 4;
export const MAX_MULT = 4;
/** Seconds without chomping before the belly is gulped (banked). */
export const DIGEST_TIME = 0.75;
/** At most this many marbles come back out in a barf (the rest are just lost). */
export const BARF_CAP = 24;

/** The bowl starts tilting toward last place once the lead is this big, fully tilted at TILT_FULL_GAP. */
export const TILT_GAP = 6;
export const TILT_FULL_GAP = 48;
export const TILT_GRAVITY = 130;

export function bellyMultiplier(count: number): number {
  return Math.min(MAX_MULT, 1 + Math.floor(Math.max(0, count) / BELLY_STEP));
}

/** Half the belly survives the buzzer; gulp before time runs out for the full value. */
export function buzzerValue(bellyPts: number): number {
  return Math.floor(Math.max(0, bellyPts) / 2);
}

/**
 * Angle (from arena centre) where each seat's creature sits.
 * 2 players: left / right. 3–4: corners TL, TR, BL, BR (seat order).
 */
export function seatAngles(n: number): number[] {
  if (n <= 2) return [Math.PI, 0].slice(0, Math.max(1, n));
  const corners = [-0.75 * Math.PI, -0.25 * Math.PI, 0.75 * Math.PI, 0.25 * Math.PI];
  return corners.slice(0, n);
}

/** Which seat owns the tap at (x, y), or -1. 2 players: halves. 3–4: quadrants. */
export function zoneFor(x: number, y: number, n: number, w = BOARD_W, h = BOARD_H): number {
  if (n <= 2) return x < w / 2 ? 0 : n === 2 ? 1 : 0;
  const q = (x < w / 2 ? 0 : 1) + (y < h / 2 ? 0 : 2);
  return q < n ? q : -1;
}

/** 0 → 1 → 0 lunge curve over the chomp. `t` is seconds since the chomp started. */
export function chompExtension(t: number): number {
  if (t <= 0 || t >= CHOMP_TIME) return 0;
  return Math.sin((t / CHOMP_TIME) * Math.PI);
}

export function mouthCenter(angle: number, ext: number): { x: number; y: number } {
  const d = ARENA_R - MOUTH_REST_IN - ext * CHOMP_REACH;
  return { x: ARENA_X + Math.cos(angle) * d, y: ARENA_Y + Math.sin(angle) * d };
}

/** Indices of marbles whose centre is inside the mouth circle. */
export function marblesInMouth(marbles: readonly Marble[], mx: number, my: number, r = MOUTH_R): number[] {
  const out: number[] = [];
  marbles.forEach((m, i) => {
    const dx = m.x - mx;
    const dy = m.y - my;
    if (dx * dx + dy * dy <= r * r) out.push(i);
  });
  return out;
}

/** True when food sits just outside the fully extended mouth: a whiff that deserves "SO CLOSE". */
export function nearMiss(marbles: readonly Marble[], angle: number, margin = 26): boolean {
  const m = mouthCenter(angle, 1);
  const outer = marblesInMouth(marbles, m.x, m.y, MOUTH_R + margin);
  return outer.some((i) => marbles[i]!.kind !== "bomb");
}

export interface EatResult {
  /** Points added to the belly (already multiplied). */
  pts: number;
  /** Food marbles swallowed (go into the belly). */
  food: MarbleKind[];
  stunned: boolean;
  eaten: number;
  golds: number;
  bombs: number;
}

/**
 * Sort a mouthful: food goes into the belly worth POINTS × mult (× extra, e.g. OVERDRIVE);
 * any bomb stuns, and the caller barfs the belly.
 */
export function applyEat(kinds: readonly MarbleKind[], mult = 1, extra = 1): EatResult {
  let pts = 0;
  let golds = 0;
  let bombs = 0;
  const food: MarbleKind[] = [];
  for (const k of kinds) {
    if (k === "bomb") {
      bombs++;
      continue;
    }
    if (k === "gold") golds++;
    food.push(k);
    pts += POINTS[k] * mult * extra;
  }
  return { pts, food, stunned: bombs > 0, eaten: kinds.length, golds, bombs };
}

/** ~4% gold, ~12% bomb, rest normal (OVERDRIVE passes a higher gold chance). */
export function rollKind(r: number, goldChance = 0.04, bombChance = 0.12): MarbleKind {
  if (r < goldChance) return "gold";
  if (r < goldChance + bombChance) return "bomb";
  return "normal";
}

export function spawnMarble(rand: () => number, kind = rollKind(rand())): Marble {
  const a = rand() * Math.PI * 2;
  const sp = (160 + rand() * 180) * (kind === "gold" ? GOLD_SPEED_BOOST : 1);
  return {
    x: ARENA_X + (rand() - 0.5) * 30,
    y: ARENA_Y + (rand() - 0.5) * 30,
    vx: Math.cos(a) * sp,
    vy: Math.sin(a) * sp,
    kind,
  };
}

/**
 * Marbles that come back out of a belly: they spray from the mouth toward the middle of the bowl,
 * so the other players get to eat your lunch. Capped at BARF_CAP.
 */
export function barfMarbles(
  belly: readonly MarbleKind[],
  mouthX: number,
  mouthY: number,
  angle: number,
  rand: () => number,
): Marble[] {
  const out: Marble[] = [];
  const dir = angle + Math.PI;
  for (const kind of belly.slice(0, BARF_CAP)) {
    const a = dir + (rand() - 0.5) * 1.3;
    const sp = (260 + rand() * 240) * (kind === "gold" ? 1.3 : 1);
    out.push({
      x: mouthX + Math.cos(dir) * 20 + (rand() - 0.5) * 16,
      y: mouthY + Math.sin(dir) * 20 + (rand() - 0.5) * 16,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      kind,
    });
  }
  return out;
}

export interface Tilt {
  /** Seat the bowl tilts toward, or -1 when level. */
  seat: number;
  /** 0 (level) → 1 (full tilt). */
  strength: number;
  gx: number;
  gy: number;
}

/**
 * Comeback: the bowl tilts toward whoever is last, so marbles roll their way. Starts once the
 * leader is TILT_GAP ahead, ramps to full gravity at TILT_FULL_GAP. Level when tied for last.
 */
export function tiltFor(scores: readonly number[], angles: readonly number[]): Tilt {
  const level: Tilt = { seat: -1, strength: 0, gx: 0, gy: 0 };
  if (scores.length < 2) return level;
  let lo = 0;
  let hi = 0;
  scores.forEach((s, i) => {
    if (s < scores[lo]!) lo = i;
    if (s > scores[hi]!) hi = i;
  });
  const gap = scores[hi]! - scores[lo]!;
  if (gap < TILT_GAP) return level;
  if (scores.filter((s) => s === scores[lo]).length > 1) return level;
  const strength = Math.min(1, (gap - TILT_GAP) / (TILT_FULL_GAP - TILT_GAP));
  const a = angles[lo] ?? 0;
  return { seat: lo, strength, gx: Math.cos(a) * TILT_GRAVITY * strength, gy: Math.sin(a) * TILT_GRAVITY * strength };
}

export interface StepOptions {
  gx?: number;
  gy?: number;
  /** Multiplies the minimum rolling speed (OVERDRIVE). */
  speedScale?: number;
}

/** Move marbles, keep them rolling, bounce off the round wall and each other. Mutates in place. */
export function stepMarbles(marbles: Marble[], dt: number, opts: StepOptions = {}): void {
  const keep = Math.pow(FRICTION, dt);
  const wall = ARENA_R - MARBLE_R;
  const gx = opts.gx ?? 0;
  const gy = opts.gy ?? 0;
  const scale = opts.speedScale ?? 1;
  for (const m of marbles) {
    // Bombs don't roll downhill: the tilt feeds the trailing player food, not trouble.
    const rolls = m.kind !== "bomb";
    m.vx = m.vx * keep + (rolls ? gx * dt : 0);
    m.vy = m.vy * keep + (rolls ? gy * dt : 0);
    const sp = Math.hypot(m.vx, m.vy);
    const floor = (m.kind === "gold" ? GOLD_MIN_SPEED : MIN_SPEED) * scale;
    if (sp < floor) {
      if (sp < 1e-3) {
        m.vx = floor;
        m.vy = 0;
      } else {
        m.vx *= floor / sp;
        m.vy *= floor / sp;
      }
    }
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    const dx = m.x - ARENA_X;
    const dy = m.y - ARENA_Y;
    const d = Math.hypot(dx, dy);
    if (d > wall) {
      const nx = dx / d;
      const ny = dy / d;
      m.x = ARENA_X + nx * wall;
      m.y = ARENA_Y + ny * wall;
      const vn = m.vx * nx + m.vy * ny;
      if (vn > 0) {
        m.vx -= 2 * vn * nx;
        m.vy -= 2 * vn * ny;
      }
    }
  }
  // Simple equal-mass elastic collisions.
  const min = MARBLE_R * 2;
  for (let i = 0; i < marbles.length; i++) {
    const a = marbles[i]!;
    for (let j = i + 1; j < marbles.length; j++) {
      const b = marbles[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const ny = dy / d;
      const push = (min - d) / 2;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel < 0) {
        a.vx += rel * nx;
        a.vy += rel * ny;
        b.vx -= rel * nx;
        b.vy -= rel * ny;
      }
    }
  }
}

/**
 * Bot read: is it worth chomping now? Looks at the mid-lunge mouth spot.
 * Returns "go" if there's food and no bomb, "risky" if food plus a bomb, else "wait".
 */
export function botRead(marbles: readonly Marble[], angle: number): "go" | "risky" | "wait" {
  const m = mouthCenter(angle, 0.6);
  const hits = marblesInMouth(marbles, m.x, m.y, MOUTH_R + 10);
  let food = 0;
  let bomb = false;
  for (const i of hits) {
    if (marbles[i]!.kind === "bomb") bomb = true;
    else food++;
  }
  if (food === 0) return "wait";
  return bomb ? "risky" : "go";
}

export interface BotView {
  read: "go" | "risky" | "wait";
  /** Marbles in the belly. */
  belly: number;
  /** This bot's personal "time to gulp" belly size. */
  bankAt: number;
  timeLeft: number;
  /** Random 0..1 for the greedy bomb bite. */
  roll: number;
}

/**
 * Bot decision: hold still to gulp when the belly is big enough (or the buzzer is near),
 * chomp when food is lined up, and now and then bite at food next to a bomb out of greed.
 */
export function botDecide(v: BotView): "chomp" | "hold" {
  if (v.belly > 0 && v.timeLeft < DIGEST_TIME + 0.7) return "hold";
  if (v.belly >= v.bankAt + 5) return "hold";
  if (v.belly >= v.bankAt && v.read !== "go") return "hold";
  if (v.read === "go") return "chomp";
  if (v.read === "risky" && v.roll < 0.06) return "chomp";
  return "hold";
}

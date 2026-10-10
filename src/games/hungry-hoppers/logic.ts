/** Pure rules for Chomp (id "hungry-hoppers"): board geometry, marble physics, chomp hitboxes, scoring. */

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

export const CHOMP_TIME = 0.35;
/** How far the mouth lunges in from its rest spot at full extension. */
export const CHOMP_REACH = 120;
/** Mouth centre at rest sits this far inside the rim. */
export const MOUTH_REST_IN = 28;
export const MOUTH_R = 58;
export const STUN_TIME = 1;
export const BOMB_PENALTY = 2;

/** Seconds into the 45s round when a frenzy wave floods the bowl. */
export const FRENZY_TIMES: readonly number[] = [12, 25, 37];
export const FRENZY_COUNT = 24;
export const SPAWN_INTERVAL = 0.4;
export const MAX_LIVE = 34;

const FRICTION = 0.35; // fraction of speed kept per second
const MIN_SPEED = 70;
/** Gold marbles never slow below this: they're fast and hard to catch. */
export const GOLD_MIN_SPEED = 260;
export const GOLD_SPEED_BOOST = 1.8;

export const POINTS: Record<MarbleKind, number> = { normal: 1, gold: 8, bomb: -BOMB_PENALTY };

/** Every 3 good chomps in a row adds +1x, up to 4x. */
export const STREAK_STEP = 3;
export const MAX_MULT = 4;

export function streakMultiplier(streak: number): number {
  return Math.min(MAX_MULT, 1 + Math.floor(Math.max(0, streak) / STREAK_STEP));
}

/**
 * Streak after a chomp finishes. Eating food (without a bomb) extends it;
 * a whiff (nothing eaten) or a bomb resets it to 0.
 */
export function nextStreak(streak: number, ateFood: boolean, ateBomb: boolean): number {
  if (ateBomb || !ateFood) return 0;
  return streak + 1;
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

export interface EatResult {
  score: number;
  stunned: boolean;
  eaten: number;
  golds: number;
  bombs: number;
}

/**
 * Apply a mouthful to a score. Food is multiplied by the streak multiplier;
 * bombs cost 2 each (never multiplied, score floors at 0) and stun.
 */
export function applyEat(score: number, kinds: readonly MarbleKind[], mult = 1): EatResult {
  let s = score;
  let golds = 0;
  let bombs = 0;
  for (const k of kinds) {
    if (k === "gold") golds++;
    if (k === "bomb") bombs++;
    s = Math.max(0, s + (k === "bomb" ? POINTS[k] : POINTS[k] * mult));
  }
  return { score: s, stunned: bombs > 0, eaten: kinds.length, golds, bombs };
}

/** ~4% gold, ~12% bomb, rest normal. */
export function rollKind(r: number): MarbleKind {
  if (r < 0.04) return "gold";
  if (r < 0.16) return "bomb";
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

/** Move marbles, keep them rolling, bounce off the round wall and each other. Mutates in place. */
export function stepMarbles(marbles: Marble[], dt: number): void {
  const keep = Math.pow(FRICTION, dt);
  const wall = ARENA_R - MARBLE_R;
  for (const m of marbles) {
    m.vx *= keep;
    m.vy *= keep;
    const sp = Math.hypot(m.vx, m.vy);
    const floor = m.kind === "gold" ? GOLD_MIN_SPEED : MIN_SPEED;
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

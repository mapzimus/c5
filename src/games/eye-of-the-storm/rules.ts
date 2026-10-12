import type { Rng } from "../../core/rng";
import { PUCK_RADIUS, previewPath, type Peg, type Puck, type World } from "./physics";

export const PUCKS_EACH = 6;
export const MAX_PULL = 150;
export const MAX_LAUNCH_SPEED = 1500;
export const MIN_PULL = 14;
export const PAD_RADIUS = 75;
/** Pads sit this far from both edges so a full pull in any direction stays on the screen. */
export const PAD_INSET = 150;
export const RELOAD_S = 0.55;
/** Seconds of shooting per volley before everyone's remaining pucks are forfeited. */
export const VOLLEY_S = 20;
/** Once every puck is out, lightning may still be called for this long before the volley settles. */
export const LAST_STRIKES_S = 2;

/** Heavy pucks: fewer, bigger, hit like a bowling ball, shrug off the swirl and lightning. Two per volley. */
export const HEAVY_MASS = 2.5;
export const HEAVY_RADIUS = 22;
export const HEAVY_PER_VOLLEY = 2;
export const HEAVY_LAUNCH = 0.85;

/** Lightning, callable only by a seat with no pucks left. */
export const BOLT_RADIUS = 95;
export const BOLT_POWER = 250;
export const BOLT_TELEGRAPH_S = 0.9;
export const BOLT_COOLDOWN_S = 4.5;
export const BOLTS_PER_VOLLEY = 2;
/**
 * Drag at least this far from the pad to call a bolt: further than any slingshot pull, so a player
 * who keeps flicking after their last puck doesn't drop lightning on their own corner.
 */
export const BOLT_MIN_DRAG = 180;
export const BOLT_MARGIN = 40;

/** A puck that stops within this many px outside the bullseye gets a "SO CLOSE". */
export const NEAR_MISS_PX = 16;
/** A quick, short touch on the pad is a tap (toggle heavy), not a shot. */
export const TAP_MAX_S = 0.35;

/** Target rings from the inside out. A puck scores the best ring its centre sits in. */
export const RINGS = [
  { radius: 44, points: 10 },
  { radius: 100, points: 5 },
  { radius: 165, points: 2 },
] as const;

export interface Point {
  x: number;
  y: number;
}

/**
 * Launch pads sit in the corners so players can stand around a table screen.
 * Seat order puts two players on opposite corners.
 */
export function padPositions(width: number, height: number): Point[] {
  const inset = PAD_INSET;
  return [
    { x: inset, y: inset },
    { x: width - inset, y: height - inset },
    { x: width - inset, y: inset },
    { x: inset, y: height - inset },
  ];
}

export function ringPoints(x: number, y: number, center: Point): number {
  const d = Math.hypot(x - center.x, y - center.y);
  for (const ring of RINGS) if (d <= ring.radius) return ring.points;
  return 0;
}

/** Just outside the bullseye: worth a shout, not points. */
export function isNearMiss(x: number, y: number, center: Point): boolean {
  const d = Math.hypot(x - center.x, y - center.y);
  return d > RINGS[0].radius && d <= RINGS[0].radius + NEAR_MISS_PX;
}

export function scoreBoard(pucks: readonly Puck[], ownerIds: readonly string[], center: Point): Map<string, number> {
  const scores = new Map<string, number>(ownerIds.map((id) => [id, 0]));
  for (const p of pucks) {
    if (!scores.has(p.owner)) continue;
    scores.set(p.owner, scores.get(p.owner)! + ringPoints(p.x, p.y, center));
  }
  return scores;
}

/** Slingshot: drag back from the pad, release to fire the opposite way. Null if the pull is too short. */
export function launchVelocity(pad: Point, release: Point, scale = 1): { vx: number; vy: number } | null {
  const dx = pad.x - release.x;
  const dy = pad.y - release.y;
  const pull = Math.hypot(dx, dy);
  if (pull < MIN_PULL) return null;
  const power = Math.min(pull, MAX_PULL) / MAX_PULL;
  const speed = power * MAX_LAUNCH_SPEED * scale;
  return { vx: (dx / pull) * speed, vy: (dy / pull) * speed };
}

/** A short, quick touch that barely moved: toggles the puck type instead of firing. */
export function isTap(down: Point, up: Point, heldS: number): boolean {
  return heldS <= TAP_MAX_S && Math.hypot(up.x - down.x, up.y - down.y) < MIN_PULL;
}

/** Random peg field, kept clear of the pads and the bullseye. */
export function scatterPegs(rng: Rng, width: number, height: number, pads: readonly Point[], count = 9): Peg[] {
  const center = { x: width / 2, y: height / 2 };
  const pegs: Peg[] = [];
  let tries = 0;
  while (pegs.length < count && tries < 500) {
    tries += 1;
    const peg = { x: rng.float(80, width - 80), y: rng.float(70, height - 70), r: rng.float(12, 22) };
    if (Math.hypot(peg.x - center.x, peg.y - center.y) < RINGS[0].radius + 40) continue;
    if (pads.some((pad) => Math.hypot(peg.x - pad.x, peg.y - pad.y) < PAD_RADIUS + 90)) continue;
    if (pegs.some((other) => Math.hypot(peg.x - other.x, peg.y - other.y) < 110)) continue;
    pegs.push(peg);
  }
  return pegs;
}

/** Bots aim at a target with a shaky hand, and don't know which way the swirl turns. */
export function botRelease(rng: Rng, pad: Point, target: Point, center: Point = target, wobble = 0.22): Point {
  const dx = target.x - pad.x;
  const dy = target.y - pad.y;
  const dist = Math.hypot(dx, dy);
  const toCenter = Math.hypot(center.x - pad.x, center.y - pad.y) || dist || 1;
  const angle = Math.atan2(dy, dx) + rng.float(-wobble, wobble);
  // Pull scales with how far the target is compared with the bullseye; the calm bot shot lands on the rings.
  const pull = rng.float(0.42, 0.56) * MAX_PULL * Math.min(1.2, Math.max(0.6, dist / toCenter));
  return { x: pad.x - Math.cos(angle) * pull, y: pad.y - Math.sin(angle) * pull };
}

/**
 * Bots glance down the lane before they shoot: a few candidate pulls are previewed through the pegs
 * (with the swirl ignored, since bots don't read it) and the one that ends nearest the target wins.
 * They still fluff it: the candidates all carry the usual shaky-hand wobble.
 */
export function botAimAround(rng: Rng, world: World, pad: Point, target: Point, center: Point, candidates = 6): Point {
  const calm: World = { ...world, pucks: [], swirl: { ...world.swirl, spin: 0 } };
  let best: Point | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < candidates; i += 1) {
    // Later candidates swing wider, so a peg square in the lane can be skirted.
    const release = botRelease(rng, pad, target, center, 0.22 + i * 0.12);
    const v = launchVelocity(pad, release);
    if (!v) continue;
    const ghost: Puck = { id: -1, owner: "bot", x: pad.x, y: pad.y, r: PUCK_RADIUS, mass: 1, ...v };
    const preview = previewPath(calm, ghost, 4);
    const end = preview.points[preview.points.length - 1]!;
    // A peg in the way makes the landing a guess: count it as landing far off.
    const dist = Math.hypot(end.x - target.x, end.y - target.y) + (preview.uncertain ? 400 : 0);
    if (dist < bestDist) {
      bestDist = dist;
      best = release;
    }
  }
  return best ?? botRelease(rng, pad, target, center);
}

export interface BotShot {
  target: Point;
  heavy: boolean;
}

/**
 * What a bot shoots at: usually the bullseye, but when a rival sits in the eye and a heavy puck is
 * left, it goes bowling. Bots also sometimes waste a heavy on nothing, like people do.
 */
export function botPickShot(
  rng: Rng,
  pucks: readonly Puck[],
  selfId: string,
  center: Point,
  heavyLeft: number,
  golden: Point | null,
): BotShot {
  if (golden && rng.next() < 0.35) return { target: golden, heavy: false };
  if (heavyLeft > 0) {
    const rivals = pucks
      .filter((p) => p.owner !== selfId && ringPoints(p.x, p.y, center) >= RINGS[1].points)
      .sort((a, b) => ringPoints(b.x, b.y, center) - ringPoints(a.x, a.y, center));
    const prey = rivals[0];
    if (prey && rng.next() < 0.75) return { target: { x: prey.x, y: prey.y }, heavy: true };
    if (rng.next() < 0.08) return { target: center, heavy: true };
  }
  return { target: center, heavy: false };
}

/**
 * Where a bot calls lightning: on the rival puck worth the most (ties broken at random), unless one of
 * its own scoring pucks would be caught in the blast. Null when there is nothing worth zapping.
 * Bots are not surgeons: the strike lands off by up to `error` px.
 */
export function botBoltTarget(
  rng: Rng,
  pucks: readonly Puck[],
  selfId: string,
  center: Point,
  error = 28,
): Point | null {
  let best: Puck | null = null;
  let bestValue = 0;
  for (const p of pucks) {
    if (p.owner === selfId) continue;
    const value = ringPoints(p.x, p.y, center) + rng.float(0, 1.5);
    if (value <= 1.5 || value <= bestValue) continue;
    const friendlyFire = pucks.some(
      (q) => q.owner === selfId && ringPoints(q.x, q.y, center) >= RINGS[1].points && Math.hypot(q.x - p.x, q.y - p.y) < BOLT_RADIUS,
    );
    if (friendlyFire) continue;
    best = p;
    bestValue = value;
  }
  if (!best) return null;
  const a = rng.float(0, Math.PI * 2);
  const e = rng.float(0, error);
  return { x: best.x + Math.cos(a) * e, y: best.y + Math.sin(a) * e };
}

/** A human's bolt lands where the finger let go, kept on the board. Null if the drag was too short. */
export function boltTargetFromDrag(pad: Point, release: Point, width: number, height: number): Point | null {
  if (Math.hypot(release.x - pad.x, release.y - pad.y) < BOLT_MIN_DRAG) return null;
  return {
    x: Math.min(width - BOLT_MARGIN, Math.max(BOLT_MARGIN, release.x)),
    y: Math.min(height - BOLT_MARGIN, Math.max(BOLT_MARGIN, release.y)),
  };
}

/** Seats with the lowest banked total, unless everyone is level. They get an extra puck next volley. */
export function underdogs(bank: ReadonlyMap<string, number>, ids: readonly string[]): string[] {
  if (ids.length < 2) return [];
  const totals = ids.map((id) => bank.get(id) ?? 0);
  const min = Math.min(...totals);
  const max = Math.max(...totals);
  if (min === max) return [];
  return ids.filter((id) => (bank.get(id) ?? 0) === min);
}

/** Callout for a run of consecutive bullseyes. Empty for the first one. */
export function streakLabel(streak: number): string {
  if (streak === 2) return "DOUBLE BULLSEYE";
  if (streak === 3) return "HAT-TRICK!";
  if (streak >= 4) return `ON FIRE x${streak}`;
  return "";
}

/** Bonus cells: glowing pickups that give the owner of the first puck through them an extra puck. */
export const CELL_RADIUS = 26;
export const CELL_LIFE_S = 7;
export const CELL_EVERY_S: readonly [number, number] = [5, 9];

export interface BonusCell extends Point {
  life: number;
}

/** Somewhere open: off the bullseye, away from pads and pegs. Null if no spot found. */
export function placeCell(rng: Rng, width: number, height: number, pads: readonly Point[], pegs: readonly Peg[]): BonusCell | null {
  const center = { x: width / 2, y: height / 2 };
  for (let tries = 0; tries < 100; tries += 1) {
    const cell = { x: rng.float(120, width - 120), y: rng.float(90, height - 90), life: CELL_LIFE_S };
    if (Math.hypot(cell.x - center.x, cell.y - center.y) < RINGS[1].radius) continue;
    if (pads.some((pad) => Math.hypot(cell.x - pad.x, cell.y - pad.y) < PAD_RADIUS + 80)) continue;
    if (pegs.some((peg) => Math.hypot(cell.x - peg.x, cell.y - peg.y) < peg.r + CELL_RADIUS + 20)) continue;
    return cell;
  }
  return null;
}

export function touchesCell(cell: Point, puck: { x: number; y: number; r: number }): boolean {
  return Math.hypot(cell.x - puck.x, cell.y - puck.y) < CELL_RADIUS + puck.r;
}

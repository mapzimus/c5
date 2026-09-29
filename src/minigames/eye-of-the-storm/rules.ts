import type { Rng } from "../../core/rng";
import type { Peg, Puck } from "./physics";

export const PUCKS_EACH = 6;
export const MAX_PULL = 170;
export const MAX_LAUNCH_SPEED = 1500;
export const MIN_PULL = 14;
export const PAD_RADIUS = 70;
export const RELOAD_S = 0.55;

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
  const inset = 96;
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

export function scoreBoard(pucks: readonly Puck[], ownerIds: readonly string[], center: Point): Map<string, number> {
  const scores = new Map<string, number>(ownerIds.map((id) => [id, 0]));
  for (const p of pucks) {
    if (!scores.has(p.owner)) continue;
    scores.set(p.owner, scores.get(p.owner)! + ringPoints(p.x, p.y, center));
  }
  return scores;
}

/** Slingshot: drag back from the pad, release to fire the opposite way. Null if the pull is too short. */
export function launchVelocity(pad: Point, release: Point): { vx: number; vy: number } | null {
  const dx = pad.x - release.x;
  const dy = pad.y - release.y;
  const pull = Math.hypot(dx, dy);
  if (pull < MIN_PULL) return null;
  const power = Math.min(pull, MAX_PULL) / MAX_PULL;
  const speed = power * MAX_LAUNCH_SPEED;
  return { vx: (dx / pull) * speed, vy: (dy / pull) * speed };
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

/** Bots aim at the bullseye with a shaky hand, and don't know which way the swirl turns. */
export function botRelease(rng: Rng, pad: Point, center: Point): Point {
  const dx = center.x - pad.x;
  const dy = center.y - pad.y;
  const angle = Math.atan2(dy, dx) + rng.float(-0.22, 0.22);
  const pull = rng.float(0.42, 0.56) * MAX_PULL;
  return { x: pad.x - Math.cos(angle) * pull, y: pad.y - Math.sin(angle) * pull };
}

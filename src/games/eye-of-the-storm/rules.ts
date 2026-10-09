import type { Rng } from "../../core/rng";
import { slideDistance, type Peg, type Puck, type PuckKind } from "./physics";

export const PUCKS_EACH = 6;
export const MAX_PULL = 170;
export const MAX_LAUNCH_SPEED = 1500;
export const MIN_PULL = 14;
export const PAD_RADIUS = 75;
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

/** What one puck is worth where it sits. Minis (splitter shards) score half, bombs score nothing. */
export function puckPoints(p: Puck, center: Point): number {
  const ring = ringPoints(p.x, p.y, center);
  if (p.kind === "bomb") return 0;
  if (p.kind === "mini") return Math.ceil(ring / 2);
  return ring;
}

export function scoreBoard(pucks: readonly Puck[], ownerIds: readonly string[], center: Point): Map<string, number> {
  const scores = new Map<string, number>(ownerIds.map((id) => [id, 0]));
  for (const p of pucks) {
    if (!scores.has(p.owner)) continue;
    scores.set(p.owner, scores.get(p.owner)! + puckPoints(p, center));
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
export function scatterPegs(rng: Rng, width: number, height: number, pads: readonly Point[], count = 9, clear = RINGS[0].radius + 40): Peg[] {
  const center = { x: width / 2, y: height / 2 };
  const pegs: Peg[] = [];
  let tries = 0;
  while (pegs.length < count && tries < 500) {
    tries += 1;
    const peg = { x: rng.float(80, width - 80), y: rng.float(70, height - 70), r: rng.float(12, 22) };
    if (Math.hypot(peg.x - center.x, peg.y - center.y) < clear) continue;
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

// ---- special pucks ---------------------------------------------------------

export const SPECIAL_KINDS = ["heavy", "bomb", "sticky", "splitter"] as const satisfies readonly PuckKind[];

export const PUCK_SPECS: Record<PuckKind, { r: number; mass: number; label: string; color: string }> = {
  normal: { r: 18, mass: 1, label: "", color: "#F4F7FB" },
  heavy: { r: 25, mass: 3, label: "HEAVY", color: "#9aa4b2" },
  bomb: { r: 18, mass: 1, label: "BOMB", color: "#ff5a36" },
  sticky: { r: 18, mass: 1, label: "STICKY", color: "#7CFF6B" },
  splitter: { r: 18, mass: 1, label: "SPLIT", color: "#c084fc" },
  mini: { r: 12, mass: 0.5, label: "", color: "#c084fc" },
};

export const BOMB_FUSE_S = 0.6;
export const BOMB_RADIUS = 150;
export const BOMB_POWER = 950;
export const SPLIT_AFTER_S = 0.38;
export const STICK_SPEED = 90;

/** A volley's worth of pucks: mostly normal, `specials` of them special, shuffled (never a special first). */
export function rollMagazine(rng: Rng, count: number, specials: number): PuckKind[] {
  const mag: PuckKind[] = Array.from({ length: count }, () => "normal");
  const slots = Array.from({ length: Math.max(0, count - 1) }, (_, i) => i + 1);
  for (let i = 0; i < Math.min(specials, slots.length); i += 1) {
    const pick = rng.int(0, slots.length - 1);
    const slot = slots.splice(pick, 1)[0]!;
    mag[slot] = rng.pick(SPECIAL_KINDS);
  }
  return mag;
}

/** A splitter bursts into three half-value shards fanned around its heading. */
export function splitVelocities(vx: number, vy: number, fan = 0.32): { vx: number; vy: number }[] {
  return [-fan, 0, fan].map((a) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return { vx: (vx * c - vy * s) * 0.95, vy: (vx * s + vy * c) * 0.95 };
  });
}

// ---- standings, catch-up, storm targeting ----------------------------------

/** The single player strictly ahead with points on the board, or null on a tie / empty board. */
export function leaderOf(scores: ReadonlyMap<string, number>): string | null {
  let best: string | null = null;
  let top = 0;
  let tied = false;
  for (const [id, score] of scores) {
    if (score > top) {
      top = score;
      best = id;
      tied = false;
    } else if (score === top && score > 0) {
      tied = true;
    }
  }
  return tied ? null : best;
}

export const CATCH_UP_GAP = 12;

/** Players this far behind the leader get storm luck (a free bomb) next volley. */
export function catchUpPlayers(scores: ReadonlyMap<string, number>, gap = CATCH_UP_GAP): string[] {
  const top = Math.max(0, ...scores.values());
  if (top === 0) return [];
  return [...scores].filter(([, s]) => top - s >= gap).map(([id]) => id);
}

/** Lightning hunts the leader: their best-scoring resting puck. Null if nobody leads. */
export function lightningTarget(pucks: readonly Puck[], scores: ReadonlyMap<string, number>, center: Point, restSpeed = 10): Puck | null {
  const leader = leaderOf(scores);
  if (!leader) return null;
  let best: Puck | null = null;
  let bestPts = 0;
  for (const p of pucks) {
    if (p.owner !== leader || Math.hypot(p.vx, p.vy) >= restSpeed) continue;
    const pts = puckPoints(p, center);
    if (pts > bestPts) {
      best = p;
      bestPts = pts;
    }
  }
  return best;
}

/** In the Tempest the eye wanders. Offset from the table centre at storm time `t`. */
export function eyeOffset(t: number): Point {
  return { x: Math.sin(t * 0.45) * 70, y: Math.sin(t * 0.7 + 1) * 40 };
}

/** A cow (or sheep) blown across the table: starts off one side, flies to the other. */
export function debrisPath(rng: Rng, width: number, height: number, speed = 520): { x: number; y: number; vx: number; vy: number } {
  const fromLeft = rng.next() < 0.5;
  const y = rng.float(height * 0.22, height * 0.78);
  const tilt = rng.float(-0.18, 0.18);
  const dir = fromLeft ? 1 : -1;
  return { x: fromLeft ? -60 : width + 60, y, vx: dir * speed * Math.cos(tilt), vy: speed * Math.sin(tilt) };
}

// ---- bots with personality --------------------------------------------------

export type BotPersona = "sniper" | "bully" | "cannon";

export const PERSONAS: Record<BotPersona, { label: string; wobble: number; wait: readonly [number, number] }> = {
  sniper: { label: "the Sniper", wobble: 0.1, wait: [1.8, 3.4] },
  bully: { label: "the Bully", wobble: 0.14, wait: [1.3, 2.8] },
  cannon: { label: "Loose Cannon", wobble: 0.4, wait: [0.7, 1.6] },
};

/** Pull length that slides a puck about `distance` px on open ground. */
export function pullForDistance(distance: number): number {
  let lo = 0;
  let hi = MAX_LAUNCH_SPEED;
  for (let i = 0; i < 30; i += 1) {
    const mid = (lo + hi) / 2;
    if (slideDistance(mid) < distance) lo = mid;
    else hi = mid;
  }
  return Math.max(MIN_PULL + 1, Math.min(MAX_PULL, (hi / MAX_LAUNCH_SPEED) * MAX_PULL));
}

function releaseToward(pad: Point, target: Point, angleNoise: number, distance: number): Point {
  const angle = Math.atan2(target.y - pad.y, target.x - pad.x) + angleNoise;
  const pull = pullForDistance(distance);
  return { x: pad.x - Math.cos(angle) * pull, y: pad.y - Math.sin(angle) * pull };
}

/**
 * Persona shot. Sniper: careful bullseye. Bully: rams the best enemy puck on the board.
 * Loose Cannon: roughly at the eye, wildly over- or under-powered.
 */
export function botShot(rng: Rng, persona: BotPersona, pad: Point, center: Point, pucks: readonly Puck[], self: string): Point {
  const spec = PERSONAS[persona];
  const noise = rng.float(-spec.wobble, spec.wobble);
  if (persona === "bully") {
    let target: Puck | null = null;
    let best = 0;
    for (const p of pucks) {
      if (p.owner === self) continue;
      const pts = puckPoints(p, center);
      if (pts > best) {
        best = pts;
        target = p;
      }
    }
    if (target) {
      const d = Math.hypot(target.x - pad.x, target.y - pad.y);
      return releaseToward(pad, target, noise, d + rng.float(160, 300));
    }
  }
  const d = Math.hypot(center.x - pad.x, center.y - pad.y);
  if (persona === "cannon") return releaseToward(pad, center, noise, d * rng.float(0.7, 1.35));
  return releaseToward(pad, center, noise, d * rng.float(0.94, 1.04));
}

// ---- comedy ------------------------------------------------------------------

export const KO_QUIPS = ["NOOO!", "WHY?!", "rude.", "ow ow ow", "BYE!", "my ring!", "I HAD A FAMILY", "wheee…", "not cool", "AAAA"] as const;
export const BULLSEYE_QUIPS = ["comfy.", "mine.", "nailed it", "ahh, warm", "ez", "home!"] as const;
export const BOT_TAUNTS: Record<BotPersona, readonly string[]> = {
  sniper: ["Calculated.", "Precisely.", "*adjusts monocle*"],
  bully: ["MOVE IT!", "Get bonked!", "My table now."],
  cannon: ["YOLO!", "Was that me?", "LOL oops"],
};

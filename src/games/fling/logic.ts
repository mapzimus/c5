import type { Rng } from "../../core/rng";

/**
 * Pure rules for Fling! ("Vault Heist"). No canvas, no DOM, no timers.
 * Units: logical pixels and seconds. Positive y is down.
 *
 * Coins you roll over go into your POUCH (unbanked, stealable). Rolling into the
 * roaming VAULT banks the pouch times a multiplier that grows with the pouch,
 * so every fling is a choice: grab more, or cash out before someone rams you.
 */

export interface Vec2 { x: number; y: number }
export const v2 = (x = 0, y = 0): Vec2 => ({ x, y });
export const vadd = (a: Vec2, b: Vec2): Vec2 => v2(a.x + b.x, a.y + b.y);
export const vsub = (a: Vec2, b: Vec2): Vec2 => v2(a.x - b.x, a.y - b.y);
export const vmul = (a: Vec2, s: number): Vec2 => v2(a.x * s, a.y * s);
export const vlen = (a: Vec2): number => Math.sqrt(a.x * a.x + a.y * a.y);
export const vnorm = (a: Vec2): Vec2 => { const l = vlen(a); return l > 0.001 ? v2(a.x / l, a.y / l) : v2(); };
export const vdot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const vdist = (a: Vec2, b: Vec2): number => vlen(vsub(a, b));

// ── Match ──
export const GAME_DURATION_S = 60;
/** Time left at which the FINAL HEIST starts: vault pays double, coins pour in. */
export const HEIST_AT_S = 15;
/** Match time at which the arena stops warming up (coin rate, vault speed reach their peak). */
export const RAMP_S = 45;

// ── Flinging ──
export const POWER_SCALE = 5.5;
export const MAX_POWER = 900;
export const MIN_DRAG = 18;
/** Grab radius as a multiple of the ball radius (always at least the tap minimum). */
export const GRAB_RADIUS_MULT = 2.8;
/** A ball slower than this can be grabbed again. */
export const REGRAB_SPEED = 50;
export const REGRAB_CD = 0.4;

// ── Physics ──
/** Fraction of velocity kept per second of rolling. */
export const FRICTION_PER_S = 0.46;
export const COIN_FRICTION_PER_S = 0.09;
export const RESTITUTION = 0.82;
export const WALL_BOUNCE = 0.75;
/** Relative closing speed above which a hit steals from the pouch. */
export const STEAL_FORCE = 150;
/** Closing speed per extra loose coin knocked out of the victim. */
export const SPILL_FORCE = 300;
export const MAX_SPILL = 2;

// ── Pouch and vault ──
/** Pouch value per extra multiplier step: 8 → x2, 16 → x3 (the cap). */
export const BANK_STEP = 8;
export const BANK_MAX_MULT = 3;
/** Extra multiplier on every bank during the FINAL HEIST. */
export const HEIST_BONUS_MULT = 1;
/** Hard cap on the total multiplier, bonuses included. */
export const TOTAL_MULT_CAP = BANK_MAX_MULT + 1;
/** Last place gets +1x at the vault when this far behind the leader. */
export const UNDERDOG_GAP = 10;
/** Seconds the vault waits before relocating on its own. */
export const VAULT_MOVE_S = 10;
export const VAULT_MOVE_HEIST_S = 6;
/** Vault radius as a multiple of the ball radius (shrinks toward VAULT_R_MIN by RAMP_S). */
export const VAULT_R_MAX = 2.1;
export const VAULT_R_MIN = 1.6;
/** A stopped ball this close to the vault rim with loot aboard was SO CLOSE. */
export const NEAR_MISS_PX = 40;
/** Minimum pouch for near-miss and "fat pouch" bot targeting. */
export const FAT_POUCH = 6;
/** A bot passing close to the vault cashes out from this pouch size. */
export const NEAR_BANK = 4;
/** Fraction of the victim's pouch a clean hit steals (rounded up). */
export const STEAL_FRACTION = 0.5;
export const STEAL_CAP = 12;
/** Hits on the crowned leader steal this much more. */
export const CROWN_STEAL_MULT = 1.5;
/** A bank at least this big earns the BIG BANK callout. */
export const BIG_BANK = 16;

export const COIN_VALUES: Readonly<Record<string, number>> = { bronze: 1, silver: 3, gold: 5, diamond: 10, dropped: 1 };
export const COIN_LIFE_S: Readonly<Record<string, number>> = { bronze: 9, silver: 11, gold: 13, diamond: 16, dropped: 7 };
export const COMBO_WINDOW_S = 1.5;

export interface Bounds { x0: number; y0: number; x1: number; y1: number }

export interface Body {
  pos: Vec2;
  vel: Vec2;
  radius: number;
  mass: number;
}

/** Drag-and-release launch: pull back from the ball, fly the other way. Null when the drag is too short. */
export function launchVelocity(pos: Vec2, aim: Vec2, turbo = false): Vec2 | null {
  const drag = vsub(aim, pos);
  const dist = vlen(drag);
  if (dist < MIN_DRAG) return null;
  const dir = vnorm(vmul(drag, -1));
  let power = Math.min(dist * POWER_SCALE, MAX_POWER);
  if (turbo) power *= 2;
  return vmul(dir, power);
}

/** Launch power preview for the aim arrow (0..1 of MAX_POWER). */
export function launchPower(pos: Vec2, aim: Vec2): number {
  return Math.min(vdist(pos, aim) * POWER_SCALE, MAX_POWER) / MAX_POWER;
}

/**
 * A bot shot at `target`: aims straight, then wobbles by `wobbleRad` and misjudges power by `powerError` px/s.
 * With the default friction a launch travels about 1.29x its speed in pixels, so `powerPerPx` 0.82 parks the
 * ball on the target and 1.1 arrives still fast enough to steal.
 */
export function aimAt(
  pos: Vec2, target: Vec2, wobbleRad: number, powerError: number, turbo = false,
  options: { powerPerPx?: number; basePower?: number } = {},
): Vec2 {
  const toT = vnorm(vsub(target, pos));
  const angle = Math.atan2(toT.y, toT.x) + wobbleRad;
  const dist = vdist(pos, target);
  const perPx = options.powerPerPx ?? 0.85;
  const base = options.basePower ?? 40;
  let power = Math.max(60, Math.min(dist * perPx + base + powerError, MAX_POWER));
  if (turbo) power *= 2;
  return v2(Math.cos(angle) * power, Math.sin(angle) * power);
}

export function applyFriction(vel: Vec2, dt: number, perSecond = FRICTION_PER_S): Vec2 {
  const k = Math.pow(perSecond, dt);
  return v2(vel.x * k, vel.y * k);
}

/** Moves a body and bounces it off the arena walls. Returns the number of walls hit (0..2). */
export function stepBody(b: Body, dt: number, bounds: Bounds, bounce = WALL_BOUNCE): number {
  b.pos.x += b.vel.x * dt;
  b.pos.y += b.vel.y * dt;
  let hits = 0;
  if (b.pos.x - b.radius < bounds.x0) { b.pos.x = bounds.x0 + b.radius; b.vel.x = Math.abs(b.vel.x) * bounce; hits++; }
  if (b.pos.x + b.radius > bounds.x1) { b.pos.x = bounds.x1 - b.radius; b.vel.x = -Math.abs(b.vel.x) * bounce; hits++; }
  if (b.pos.y - b.radius < bounds.y0) { b.pos.y = bounds.y0 + b.radius; b.vel.y = Math.abs(b.vel.y) * bounce; hits++; }
  if (b.pos.y + b.radius > bounds.y1) { b.pos.y = bounds.y1 - b.radius; b.vel.y = -Math.abs(b.vel.y) * bounce; hits++; }
  return hits;
}

export interface Impact {
  /** Closing speed along the contact normal (0 when the balls were separating or not touching). */
  force: number;
  /** Which ball ends up faster and therefore does the stealing. */
  attacker: "a" | "b" | null;
  /** A shield absorbed the hit and bounced the other ball away. */
  shieldPopped: "a" | "b" | null;
}

/**
 * Elastic-ish collision between two balls. Separates them, exchanges momentum by mass,
 * or pops a shield. `aHeld`/`bHeld` mark a ball under a finger: it gives no ground.
 */
export function resolveCollision(
  a: Body, b: Body,
  options: { aHeld?: boolean; bHeld?: boolean; aShield?: boolean; bShield?: boolean } = {},
): Impact {
  const none: Impact = { force: 0, attacker: null, shieldPopped: null };
  const d = vsub(b.pos, a.pos);
  const dist = vlen(d);
  const minD = a.radius + b.radius;
  if (dist >= minD || dist < 0.1) return none;
  const n = vnorm(d);
  const overlap = minD - dist;
  const pushA = options.aHeld ? 0 : options.bHeld ? 1 : 0.5;
  const pushB = options.bHeld ? 0 : options.aHeld ? 1 : 0.5;
  a.pos = vsub(a.pos, vmul(n, overlap * pushA));
  b.pos = vadd(b.pos, vmul(n, overlap * pushB));
  const velN = vdot(vsub(a.vel, b.vel), n);
  if (velN <= 0) return none;
  if (options.aShield) { b.vel = vadd(b.vel, vmul(n, velN * 2)); return { force: velN, attacker: null, shieldPopped: "a" }; }
  if (options.bShield) { a.vel = vsub(a.vel, vmul(n, velN * 2)); return { force: velN, attacker: null, shieldPopped: "b" }; }
  const imp = -(1 + RESTITUTION) * velN / (1 / a.mass + 1 / b.mass);
  a.vel = vadd(a.vel, vmul(n, imp / a.mass));
  b.vel = vsub(b.vel, vmul(n, imp / b.mass));
  const attacker = velN >= STEAL_FORCE ? "a" : null;
  return { force: velN, attacker, shieldPopped: null };
}

/** How much of the victim's pouch a hit takes: half of it, more off the crowned leader, capped. */
export function stealAmount(victimPouch: number, victimCrowned: boolean): number {
  if (victimPouch <= 0) return 0;
  const base = Math.ceil(victimPouch * STEAL_FRACTION);
  return Math.min(victimPouch, Math.min(STEAL_CAP, Math.ceil(base * (victimCrowned ? CROWN_STEAL_MULT : 1))));
}

/** Loose coins knocked out of the victim by a hard hit (on top of the steal). */
export function spillCount(force: number): number {
  return Math.max(0, Math.min(MAX_SPILL, Math.floor(force / SPILL_FORCE)));
}

/** Vault payout multiplier: grows with the pouch, +1 for the underdog, +1 during the heist, never above the cap. */
export function bankMultiplier(pouch: number, options: { underdog?: boolean; heist?: boolean } = {}): number {
  let m = Math.min(BANK_MAX_MULT, 1 + Math.floor(Math.max(0, pouch) / BANK_STEP));
  if (options.underdog) m += 1;
  if (options.heist) m += HEIST_BONUS_MULT;
  return Math.min(TOTAL_MULT_CAP, m);
}

export function bankPayout(pouch: number, options: { underdog?: boolean; heist?: boolean } = {}): number {
  return Math.max(0, pouch) * bankMultiplier(pouch, options);
}

/** Combo multiplier on coin pickups: every 3 in a row adds x1, up to x4. */
export function comboMultiplier(combo: number): number {
  return Math.min(4, 1 + Math.floor(Math.max(0, combo) / 3));
}

export function isHeist(timeLeft: number): boolean {
  return timeLeft <= HEIST_AT_S;
}

/** 0 at the start, 1 once the arena has fully ramped. */
export function rampFraction(elapsed: number): number {
  return Math.max(0, Math.min(1, elapsed / RAMP_S));
}

/** Seconds between bronze coin waves: 2.2 at the start down to 1.2 after the ramp, 1.0 during the heist. */
export function coinWaveInterval(elapsed: number, heist: boolean): number {
  if (heist) return 1.0;
  return 2.2 - rampFraction(elapsed);
}

export function vaultRadius(ballR: number, elapsed: number): number {
  return ballR * (VAULT_R_MAX - (VAULT_R_MAX - VAULT_R_MIN) * rampFraction(elapsed));
}

/**
 * Leader (crown) and underdog (+1x) from banked scores. Nobody is crowned on a tie for first
 * or while everyone is still at zero; the underdog is the unique last place at least UNDERDOG_GAP behind.
 */
export function crownAndUnderdog(scores: readonly number[]): { leader: number; underdog: number } {
  if (scores.length < 2) return { leader: -1, underdog: -1 };
  let hi = -Infinity, lo = Infinity;
  for (const s of scores) { hi = Math.max(hi, s); lo = Math.min(lo, s); }
  const tops = scores.filter((s) => s === hi).length;
  const bottoms = scores.filter((s) => s === lo).length;
  const leader = hi > 0 && tops === 1 ? scores.indexOf(hi) : -1;
  const underdog = bottoms === 1 && hi - lo >= UNDERDOG_GAP ? scores.indexOf(lo) : -1;
  return { leader, underdog };
}

/** A ball that stopped just outside the vault with loot aboard: SO CLOSE. */
export function isNearMiss(distToVault: number, vaultR: number, ballR: number, pouch: number): boolean {
  const gap = distToVault - vaultR - ballR;
  return pouch >= FAT_POUCH && gap > 0 && gap <= NEAR_MISS_PX;
}

/** Picks a spot for the vault at least `minDist` from every ball, preferring the farthest of a few candidates. */
export function nextVaultPos(rng: Rng, bounds: Bounds, avoid: readonly Vec2[], vaultR: number, minDist: number): Vec2 {
  const pad = vaultR + 20;
  let best: Vec2 = v2((bounds.x0 + bounds.x1) / 2, (bounds.y0 + bounds.y1) / 2);
  let bestD = -1;
  for (let i = 0; i < 8; i++) {
    const p = v2(rng.float(bounds.x0 + pad, bounds.x1 - pad), rng.float(bounds.y0 + pad, bounds.y1 - pad));
    let d = Infinity;
    for (const a of avoid) d = Math.min(d, vdist(p, a));
    if (d >= minDist) return p;
    if (d > bestD) { bestD = d; best = p; }
  }
  return best;
}

export interface CoinLike { pos: Vec2; value: number }

/** The coin worth walking to: distance minus a bonus per point of value. */
export function pickCoinTarget(pos: Vec2, coins: readonly CoinLike[]): CoinLike | null {
  let best: CoinLike | null = null;
  let bestScore = Infinity;
  for (const c of coins) {
    const score = vdist(pos, c.pos) - c.value * 30;
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}

export interface BotView {
  pos: Vec2;
  pouch: number;
  /** Pouch size at which this bot likes to cash out (its personality). */
  bankAt: number;
  vault: Vec2;
  rivals: readonly { pos: Vec2; pouch: number; crowned: boolean }[];
  coins: readonly CoinLike[];
  heist: boolean;
  timeLeft: number;
  /** A uniform roll in [0,1) that decides the bot's mood this turn. */
  roll: number;
}

export type BotPlan =
  | { kind: "bank"; target: Vec2 }
  | { kind: "ram"; target: Vec2; rival: number }
  | { kind: "coin"; target: Vec2 }
  | { kind: "wander"; target: Vec2 };

/** What a bot does with its next fling. Pure: all randomness comes in through `roll`. */
export function botPlan(view: BotView): BotPlan {
  const { pos, pouch, vault } = view;
  const vaultDist = vdist(pos, vault);
  // Cash out when the pouch is fat, when the vault is right there, or when time is running out.
  const closing = view.timeLeft <= 6 && pouch > 0;
  if (closing || pouch >= view.bankAt || (pouch >= NEAR_BANK && vaultDist < 260) || (view.heist && pouch >= FAT_POUCH && view.roll < 0.5)) {
    return { kind: "bank", target: vault };
  }
  // Hunt a fat pouch nearby, the crowned leader especially.
  let bestRival = -1;
  let bestWorth = 0;
  view.rivals.forEach((r, i) => {
    const d = vdist(pos, r.pos);
    if (d > 340 || r.pouch < FAT_POUCH) return;
    const worth = stealAmount(r.pouch, r.crowned) - d / 60;
    if (worth > bestWorth) { bestWorth = worth; bestRival = i; }
  });
  if (bestRival >= 0 && view.roll < 0.55) {
    return { kind: "ram", target: view.rivals[bestRival]!.pos, rival: bestRival };
  }
  const coin = pickCoinTarget(pos, view.coins);
  if (coin) return { kind: "coin", target: coin.pos };
  const a = view.roll * Math.PI * 2;
  return { kind: "wander", target: v2(pos.x + Math.cos(a) * 120, pos.y + Math.sin(a) * 120) };
}

/** Spots where the balls start: the four corners, inset by `pad`. */
export function startPositions(bounds: Bounds, pad: number): Vec2[] {
  return [
    v2(bounds.x0 + pad, bounds.y0 + pad),
    v2(bounds.x1 - pad, bounds.y0 + pad),
    v2(bounds.x0 + pad, bounds.y1 - pad),
    v2(bounds.x1 - pad, bounds.y1 - pad),
  ];
}

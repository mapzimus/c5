import type { Rng } from "../../core/rng";

/** Pure rules for Hold It! (id "hot-potato"). No canvas, no DOM. Times in seconds unless named *Ms. */

export const FLIGHT_S = 0.35;
/** Hold your zone this long and the aim pointer appears. */
export const AIM_HOLD_S = 0.5;
/** Pointer sweep speed: one lap around the ring every 1.4s. */
export const AIM_SWEEP_RAD_PER_S = (Math.PI * 2) / 1.4;
/** A split bomb clones itself this long after it is lit. */
export const SPLIT_AT_S = 3;

// ---------------------------------------------------------------- hearts and stages

/** Hearts per player: 2 players get 4, 3 get 3, 4 get 2 (match stays 45-100s). */
export function heartsFor(players: number): number {
  return Math.max(2, 6 - players);
}

export interface BombOdds {
  fuseMin: number;
  fuseMax: number;
  dudChance: number;
  splitChance: number;
}

/**
 * The fuse shortens and duds get rarer with every blast (escalation curve). Sudden death
 * (the next blast decides the match) has the shortest fuses and no duds or splits.
 */
export function bombOdds(blast: number, suddenDeath: boolean): BombOdds {
  if (suddenDeath) return { fuseMin: 4, fuseMax: 7, dudChance: 0, splitChance: 0 };
  const k = Math.max(0, blast);
  return {
    fuseMin: Math.max(4, 6 - k * 0.4),
    fuseMax: Math.max(7.5, 11 - k * 0.7),
    dudChance: Math.max(0.08, 0.2 - k * 0.03),
    splitChance: 0.15,
  };
}

export type BombKind = "live" | "dud" | "split";

export interface BombPlan {
  kind: BombKind;
  fuseS: number;
}

/** Roll a new bomb from the stage's odds. `allowDud`/`allowSplit` false forces "live" for that roll. */
export function planBomb(
  rng: Rng,
  odds: BombOdds,
  options: { allowDud?: boolean; allowSplit?: boolean } = {},
): BombPlan {
  const fuseS = rng.float(odds.fuseMin, odds.fuseMax);
  const roll = rng.next();
  let kind: BombKind = "live";
  if (roll < odds.dudChance) kind = (options.allowDud ?? true) ? "dud" : "live";
  else if (roll < odds.dudChance + odds.splitChance) kind = (options.allowSplit ?? true) ? "split" : "live";
  return { kind, fuseS };
}

/** Sudden death: exactly two players left and both on their last heart. */
export function isSuddenDeath(hearts: readonly number[]): boolean {
  const living = hearts.filter((h) => h > 0);
  return living.length === 2 && living.every((h) => h === 1);
}

// ---------------------------------------------------------------- charge (the signature twist)

/** Hold the bomb this long (while aiming) and your throw sticks to the catcher's hands. */
export const STICKY_AT_S = 1.5;
/** Hold this long and it is GLUE: the catcher is stuck twice as long. */
export const GLUE_AT_S = 3;
export const STICKY_S = 1.0;
export const GLUE_S = 2.0;
/** Players on their last heart charge this much faster (comeback edge). */
export const LAST_HEART_CHARGE_MULT = 1.5;
/** Each tap while stuck or frozen shaves this much off the timer. */
export const WIGGLE_S = 0.1;

export type ChargeTier = 0 | 1 | 2;

/** Charge progress in "effective seconds": held time scaled by the comeback multiplier. */
export function chargeSeconds(heldS: number, lastHeart: boolean): number {
  return heldS * (lastHeart ? LAST_HEART_CHARGE_MULT : 1);
}

export function chargeTier(chargeS: number): ChargeTier {
  if (chargeS >= GLUE_AT_S) return 2;
  if (chargeS >= STICKY_AT_S) return 1;
  return 0;
}

/** How long the catcher is stuck for a throw of this tier. */
export function stickFor(tier: ChargeTier): number {
  return tier === 2 ? GLUE_S : tier === 1 ? STICKY_S : 0;
}

/** Fraction [0,1] of the way to the next tier (full at GLUE). */
export function chargeFill(chargeS: number): number {
  return Math.min(1, chargeS / GLUE_AT_S);
}

// ---------------------------------------------------------------- ghosts

export const HAUNT_COOLDOWN_S = 4;
/** A haunted player's hands freeze this long. */
export const FREEZE_S = 0.8;
/** After a freeze ends the victim cannot be frozen again for this long. */
export const FREEZE_IMMUNE_S = 1.5;
/** A ghost gets the "spook" credit if its victim blows up within this long after the freeze ends. */
export const SPOOK_WINDOW_S = 1.2;

/** Can a ghost freeze this seat right now? */
export function canFreeze(frozenT: number, immuneT: number): boolean {
  return frozenT <= 0 && immuneT <= 0;
}

/** Did a ghost's haunt earn the spook: victim blew up while frozen or shortly after. */
export function spookEarned(frozenT: number, sinceThawS: number): boolean {
  return frozenT > 0 || sinceThawS <= SPOOK_WINDOW_S;
}

/** Seconds until a bot ghost haunts next. */
export function planBotHaunt(rng: Rng): number {
  return rng.float(3, 7);
}

// ---------------------------------------------------------------- targeting

/** Living seats other than `from`. */
export function otherLiving(alive: readonly boolean[], from: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < alive.length; i++) if (alive[i] && i !== from) out.push(i);
  return out;
}

/** A random living seat other than `from`, or -1 if there is none. */
export function pickTarget(alive: readonly boolean[], from: number, rng: Rng): number {
  const others = otherLiving(alive, from);
  return others.length === 0 ? -1 : rng.pick(others);
}

/** Smallest absolute difference between two angles, in [0, PI]. */
export function angleDiff(a: number, b: number): number {
  const tau = Math.PI * 2;
  let d = (a - b) % tau;
  if (d < 0) d += tau;
  return d > Math.PI ? tau - d : d;
}

/** The living seat (not `from`) whose ring angle is closest to the pointer. -1 if none. */
export function pointedSeat(
  aimAngle: number,
  seatAngles: readonly number[],
  alive: readonly boolean[],
  from: number,
): number {
  let best = -1;
  let bestDiff = Infinity;
  for (const i of otherLiving(alive, from)) {
    const d = angleDiff(aimAngle, seatAngles[i] ?? 0);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return best;
}

// ---------------------------------------------------------------- bots

export const BOT_HOLD_MIN_S = 0.4;
export const BOT_HOLD_MAX_S = 1.5;
export const BOT_AIM_CHANCE = 0.35;
/** Bots gamble on a sticky throw this often when the bomb is still young. */
export const BOT_CHARGE_CHANCE = 0.45;
/** A bomb older than this is "hot": bots will not charge on it... unless they blunder. */
export const BOT_YOUNG_BOMB_S = 3.5;
export const BOT_BLUNDER_CHANCE = 0.08;

export interface BotHoldPlan {
  holdS: number;
  /** What the bot is going for: a quick pass, a sticky, a glue, or a mistake (held too long). */
  intent: "quick" | "sticky" | "glue" | "blunder";
}

/**
 * How long a bot holds a bomb. On a young bomb it often charges a sticky (sometimes a glue);
 * on a hot bomb it throws fast; 8% of the time it freezes up and holds far too long.
 */
export function planBotHold(rng: Rng, bombAgeS: number, lastHeart: boolean): BotHoldPlan {
  if (rng.next() < BOT_BLUNDER_CHANCE) return { holdS: rng.float(2.5, 4), intent: "blunder" };
  const mult = lastHeart ? LAST_HEART_CHARGE_MULT : 1;
  if (bombAgeS < BOT_YOUNG_BOMB_S && rng.next() < BOT_CHARGE_CHANCE) {
    if (bombAgeS < 1.5 && rng.next() < 0.3) return { holdS: (GLUE_AT_S + rng.float(0.1, 0.4)) / mult, intent: "glue" };
    return { holdS: (STICKY_AT_S + rng.float(0.1, 0.5)) / mult, intent: "sticky" };
  }
  return { holdS: rng.float(BOT_HOLD_MIN_S, BOT_HOLD_MAX_S), intent: "quick" };
}

/**
 * Some of the time a bot aims at the living leader (most hearts, ties broken at random).
 * Returns null when the bot should just throw at random.
 */
export function botAimTarget(
  alive: readonly boolean[],
  from: number,
  hearts: readonly number[],
  rng: Rng,
  aimChance = BOT_AIM_CHANCE,
): number | null {
  if (rng.next() >= aimChance) return null;
  const others = otherLiving(alive, from);
  if (others.length === 0) return null;
  const top = Math.max(...others.map((i) => hearts[i] ?? 0));
  return rng.pick(others.filter((i) => (hearts[i] ?? 0) === top));
}

// ---------------------------------------------------------------- scoring

/**
 * Score = elimination order. First out scores 1, next 2, ... Survivors all get `seats`
 * (the winner is the single survivor when the match runs to the end).
 */
export function eliminationScores(order: readonly number[], seats: number): number[] {
  const scores = Array<number>(seats).fill(seats);
  order.forEach((seat, i) => {
    if (seat >= 0 && seat < seats) scores[seat] = i + 1;
  });
  return scores;
}

/** A throw this close to the blast counts as a near miss ("SO CLOSE"). */
export const NEAR_MISS_S = 0.7;

export function isNearMiss(sinceThrowS: number): boolean {
  return sinceThrowS >= 0 && sinceThrowS <= NEAR_MISS_S;
}

/** Nerve records are stored in tenths of a second so saveBest compares integers. */
export function nerveTenths(heldS: number): number {
  return Math.round(heldS * 10);
}

export function formatNerve(heldS: number): string {
  return `${(Math.round(heldS * 10) / 10).toFixed(1)}s`;
}

// ---------------------------------------------------------------- layout

export interface SeatZone {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where the character stands (pulled a little toward the middle of the screen). */
  cx: number;
  cy: number;
  /** Angle from the screen centre, used by the aim pointer. */
  angle: number;
}

/**
 * Touch zones around the screen: 2 = left/right halves, 3 = two top quadrants + bottom half,
 * 4 = quadrants. Characters stand inside their zone, shifted toward the centre so bombs fly
 * across a ring in the middle.
 */
export function seatLayout(n: number, width: number, height: number): SeatZone[] {
  let rects: { x: number; y: number; w: number; h: number }[];
  const hw = width / 2;
  const hh = height / 2;
  if (n <= 1) rects = [{ x: 0, y: 0, w: width, h: height }];
  else if (n === 2) rects = [{ x: 0, y: 0, w: hw, h: height }, { x: hw, y: 0, w: hw, h: height }];
  else if (n === 3) {
    rects = [
      { x: 0, y: 0, w: hw, h: hh },
      { x: hw, y: 0, w: hw, h: hh },
      { x: 0, y: hh, w: width, h: hh },
    ];
  } else {
    rects = [
      { x: 0, y: 0, w: hw, h: hh },
      { x: hw, y: 0, w: hw, h: hh },
      { x: 0, y: hh, w: hw, h: hh },
      { x: hw, y: hh, w: hw, h: hh },
    ];
  }
  return rects.slice(0, Math.max(1, n)).map((r) => {
    const zx = r.x + r.w / 2;
    const zy = r.y + r.h / 2;
    const cx = zx + (hw - zx) * 0.22;
    const cy = zy + (hh - zy) * 0.22;
    return { ...r, cx, cy, angle: Math.atan2(zy - hh, zx - hw) };
  });
}

export function inZone(z: SeatZone, x: number, y: number): boolean {
  return x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h;
}

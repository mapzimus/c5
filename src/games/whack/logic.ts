/**
 * Pure rules for Bonk. No canvas, no DOM, no randomness of its own: callers pass
 * rolls in [0, 1) so everything here is deterministic and unit-testable.
 */

export type MoleKind = "normal" | "golden" | "bomb" | "raider" | "thief";

/** Match length in seconds. */
export const DURATION = 50;
/** OVERDRIVE starts when this many seconds remain. */
export const OVERDRIVE_AT = 12;

/** A normal critter fattens through these stages while it stays up. */
export const STAGE_VALUES = [1, 2, 3, 5] as const;
/** During OVERDRIVE everything is fatter. */
export const OVERDRIVE_STAGE_VALUES = [2, 3, 5, 8] as const;
export const MAX_STAGE = STAGE_VALUES.length - 1;
/** Seconds up per fatten stage. */
export const STAGE_TIME = 0.42;
export const OVERDRIVE_STAGE_TIME = 0.32;
/** The critter wobbles and sweats for this long before ducking. */
export const TELL_TIME = 0.22;
/** Bonking a critter this close to its duck is a CLUTCH and pays a bonus. */
export const CLUTCH_WINDOW = 0.12;
export const CLUTCH_BONUS = 1;

export const GOLDEN_POINTS = 10;
export const GOLDEN_UP_TIME = 0.55;
export const BOMB_UP_TIME = 1.2;
export const BOMB_PENALTY = 5;
export const RAIDER_UP_TIME = 1.3;
export const THIEF_UP_TIME = 1.3;
export const THIEF_STEAL = 5;

/** Consecutive scoring hits needed to fill the combo meter and trigger FEVER. */
export const COMBO_TO_FEVER = 6;
export const FEVER_TIME = 5;
export const FEVER_SPAWN_SCALE = 0.4;
export const OVERDRIVE_SPAWN_SCALE = 0.7;

export const SPAWN_INTERVAL = 0.9;
export const SPAWN_MIN = 0.5;

const BOMB_CHANCE = 0.1;
const GOLDEN_CHANCE = 0.04;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Points a normal critter is worth at `stage` (0..MAX_STAGE). */
export function stageValue(stage: number, overdrive: boolean): number {
  const table = overdrive ? OVERDRIVE_STAGE_VALUES : STAGE_VALUES;
  const i = Math.max(0, Math.min(MAX_STAGE, Math.floor(stage)));
  return table[i] ?? 1;
}

/** Fatten stage of a critter that has been up for `upFor` seconds. */
export function stageAt(upFor: number, overdrive: boolean): number {
  const t = overdrive ? OVERDRIVE_STAGE_TIME : STAGE_TIME;
  return Math.max(0, Math.min(MAX_STAGE, Math.floor(upFor / t)));
}

/** Seconds a normal critter stays up before ducking. `roll` in [0, 1); the range shrinks as the match ramps. */
export function duckTime(roll: number, progress: number): number {
  const range = 1.5 - 0.6 * clamp01(progress);
  return 0.55 + clamp01(roll) * range;
}

/** Spawn interval at `progress` (0..1) before fever/overdrive scaling. */
export function spawnInterval(progress: number): number {
  return SPAWN_INTERVAL - (SPAWN_INTERVAL - SPAWN_MIN) * clamp01(progress);
}

/**
 * Chance that a seat's next spawn is a raider. Only players behind the leader get them;
 * the further behind, the more. The sole last place well behind gets the most.
 */
export function raidChance(index: number, scores: readonly number[]): number {
  const me = scores[index];
  if (me === undefined || scores.length < 2) return 0;
  let best = -Infinity;
  for (let i = 0; i < scores.length; i++) {
    const s = scores[i];
    if (i !== index && s !== undefined && s > best) best = s;
  }
  const gap = best - me;
  if (gap <= 0) return 0;
  const last = scores.every((s, i) => i === index || s >= me);
  if (last && gap >= 8) return 0.14;
  if (gap >= 4) return 0.07;
  return 0.035;
}

/** Who a raid from `index` hits: the highest-scoring other seat (lowest index on ties). */
export function raidTarget(index: number, scores: readonly number[]): number | null {
  let best: number | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < scores.length; i++) {
    const s = scores[i];
    if (i === index || s === undefined) continue;
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  return best;
}

/** Points a thief takes when it escapes: never more than the victim has. */
export function stealAmount(victimScore: number, amount = THIEF_STEAL): number {
  return Math.max(0, Math.min(victimScore, amount));
}

export function bombLoss(score: number): number {
  return Math.max(0, Math.min(score, BOMB_PENALTY));
}

/** Tapping an empty hole costs combo progress, not points. Spam-tapping is not a strategy. */
export function whiffCombo(combo: number): number {
  return Math.max(0, combo - 2);
}

/** Which critter a spawn roll in [0, 1) produces. */
export function rollKind(roll: number, opts: { fever: boolean; raid: number }): MoleKind {
  // Fewer bombs during FEVER so it feels like a reward, not a trap.
  const bomb = opts.fever ? BOMB_CHANCE * 0.5 : BOMB_CHANCE;
  if (roll < bomb) return "bomb";
  if (roll < bomb + GOLDEN_CHANCE) return "golden";
  if (roll < bomb + GOLDEN_CHANCE + Math.max(0, opts.raid)) return "raider";
  return "normal";
}

/** Points for a scoring hit before the FEVER doubler. */
export function hitValue(
  kind: MoleKind,
  stage: number,
  lifeLeft: number,
  overdrive: boolean,
): { points: number; clutch: boolean } {
  if (kind === "golden") return { points: GOLDEN_POINTS, clutch: false };
  if (kind === "raider") return { points: 1, clutch: false };
  if (kind !== "normal") return { points: 0, clutch: false };
  const clutch = lifeLeft <= CLUTCH_WINDOW;
  return { points: stageValue(stage, overdrive) + (clutch ? CLUTCH_BONUS : 0), clutch };
}

export function feverMultiplier(fever: number): number {
  return fever > 0 ? 2 : 1;
}

/** A bot's personality. Rates are per second. */
export interface BotBrain {
  /** Fatten stage the bot waits for before bonking a normal critter. */
  greed: number;
  /** Bonk rate once a critter is worth bonking (per second). */
  twitch: number;
  /** How reliably the bot reads the wobble tell and bonks before the duck. */
  tellRead: number;
  /** Per-second odds of slapping a bomb that's been up a while. Small on purpose. */
  bombSlip: number;
}

export function makeBrain(rand: () => number): BotBrain {
  const g = rand();
  return {
    greed: g < 0.3 ? 1 : g < 0.7 ? 2 : 3,
    twitch: 2.5 + rand() * 2.5,
    tellRead: 0.3 + rand() * 0.35,
    bombSlip: 0.08 + rand() * 0.1,
  };
}

export interface BotView {
  kind: MoleKind;
  stage: number;
  upFor: number;
  lifeLeft: number;
}

/** Does the bot bonk this critter during a frame of `dt` seconds? `roll` in [0, 1). */
export function botWantsBonk(brain: BotBrain, m: BotView, dt: number, roll: number): boolean {
  if (m.upFor < 0.12) return false; // nobody reacts instantly
  switch (m.kind) {
    case "bomb":
      return m.upFor > 0.5 && roll < brain.bombSlip * dt;
    case "golden":
      return roll < brain.twitch * 3 * dt;
    case "thief":
      return m.upFor > 0.25 && roll < brain.twitch * 1.5 * dt;
    case "raider":
      return roll < brain.twitch * dt;
    case "normal": {
      if (m.stage >= brain.greed) return roll < brain.twitch * dt;
      // Not fat enough yet: only the wobble tell makes the bot grab early, and not always.
      if (m.lifeLeft <= TELL_TIME) return roll < (brain.tellRead * 6) * dt;
      return false;
    }
  }
}

import type { Rng } from "../../core/rng";
import { STAT_RANGE, type Placeable, type RacerStats } from "./rules";

/**
 * Everything the single-race Derby adds on top of the bet: the traits on the cards,
 * the one cheer per backer, the halfway hedge, scoring for main + hedge picks, the bots'
 * instincts and the post-race recap. Pure functions only; the race itself is in world.ts.
 */

// ---------------------------------------------------------------- traits

export interface Trait {
  label: string;
  /** Whether the trait helps. Decides the pill colour. */
  good: boolean;
  /** -1..1: how far off the middle of the roll range the stat is. */
  z: number;
}

interface TraitSpec {
  key: keyof RacerStats;
  high: string;
  low: string;
  highGood: boolean;
}

const TRAIT_SPECS: readonly TraitSpec[] = [
  { key: "topSpeed", high: "QUICK", low: "PLODDER", highGood: true },
  { key: "accel", high: "FAST STARTER", low: "SLOW STARTER", highGood: true },
  { key: "jumpSkill", high: "JUMPER", low: "TRIPS A LOT", highGood: true },
  { key: "balance", high: "STEADY", low: "WOBBLY", highGood: true },
  { key: "getUp", high: "LIES THERE", low: "BOUNCES UP", highGood: false },
  { key: "fatigue", high: "FADES LATE", low: "BIG ENGINE", highGood: false },
];

/**
 * The two most pronounced tendencies of a runner, read straight off the stats rolled for
 * this race. True form, but chaos still decides the race.
 */
export function traitsOf(stats: RacerStats, count = 2): Trait[] {
  const all = TRAIT_SPECS.map((spec) => {
    const [lo, hi] = STAT_RANGE[spec.key];
    const z = ((stats[spec.key] - lo) / (hi - lo)) * 2 - 1;
    return { label: z >= 0 ? spec.high : spec.low, good: z >= 0 === spec.highGood, z };
  });
  return all.sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, count);
}

// ---------------------------------------------------------------- picks and scoring

export interface Picks {
  main: number;
  /** Second runner backed at the halfway bell, or null if the player never hedged. */
  hedge: number | null;
}

/** The main pick pays this many times what the hedge pays. */
export const MAIN_MULT = 2;

export interface PickPoints {
  main: number;
  hedge: number;
  total: number;
}

/** Points a runner at index `i` in the finishing order is worth: 6 for the winner down to 1. */
export function placePoints(order: readonly Placeable[], lane: number): number {
  const i = order.findIndex((r) => r.lane === lane);
  return i < 0 ? 0 : order.length - i;
}

/** Main pick pays double place points, the hedge pays single. */
export function pickPoints(order: readonly Placeable[], picks: Picks): PickPoints {
  const main = placePoints(order, picks.main) * MAIN_MULT;
  const hedge = picks.hedge === null ? 0 : placePoints(order, picks.hedge);
  return { main, hedge, total: main + hedge };
}

export function scorePicks(order: readonly Placeable[], picks: ReadonlyMap<string, Picks>): Map<string, number> {
  const scores = new Map<string, number>();
  for (const [playerId, p] of picks) scores.set(playerId, pickPoints(order, p).total);
  return scores;
}

/** Lanes a player may hedge on: everyone but their own runner, in lane order. */
export function hedgeOptions(ownLane: number, field = 6): number[] {
  return Array.from({ length: field }, (_, lane) => lane).filter((lane) => lane !== ownLane);
}

/** The halfway bell rings when the leader passes this fraction of the track. */
export const BELL_AT = 0.5;
/** Real seconds the hedge window stays open (the race runs in slow motion meanwhile). */
export const HEDGE_WINDOW_S = 5;
/** Race-time scale while the window is open. */
export const HEDGE_SLOWMO = 0.3;
/** The leader passing this fraction of the track starts the FINAL STRETCH. */
export const FINAL_STRETCH_AT = 0.74;
/** Random events come this much faster in the final stretch. */
export const FINAL_STRETCH_EVENTS = 1.6;

// ---------------------------------------------------------------- cheering

/**
 * How long a cheer boosts a runner: the further back they are, the louder the crowd.
 * Leader 2.2 s, last place 4.7 s.
 */
export function cheerSeconds(position: number, field: number): number {
  const back = field <= 1 ? 0 : Math.min(1, Math.max(0, position / (field - 1)));
  return 2.2 + 2.5 * back;
}

/** A cheer on a runner this far back is an UNDERDOG ROAR. */
export function isUnderdogCheer(position: number, field: number): boolean {
  return field >= 4 && position >= field - 2;
}

export interface BotCheerView {
  /** Own runner is fallen, asleep, carried off or otherwise not running. */
  down: boolean;
  /** Seconds they have been down. */
  downFor: number;
  /** Own runner's place, 0 = leading. */
  position: number;
  field: number;
  /** Leader's progress along the track, 0..1. */
  leaderProgress: number;
  /** The hedge window is open: bots hold their cheer, like the humans fiddling with chips. */
  windowOpen: boolean;
}

/**
 * Bot cheering instinct as a rate per second. Bots wake a runner who has been down a
 * while, save the cheer for the final stretch otherwise, and now and then just can't
 * help themselves.
 */
export function botCheerRate(v: BotCheerView): number {
  if (v.windowOpen) return 0;
  if (v.down && v.downFor > 1 && v.leaderProgress > 0.25) return 1.3;
  if (v.leaderProgress > 0.86) return 1.4;
  if (v.leaderProgress > 0.68 && v.position <= 2) return 0.6;
  if (v.leaderProgress > 0.4) return 0.03;
  return 0;
}

/**
 * A bot's hedge: mostly the front two, sometimes a mid-packer, never its own runner.
 * `running` is the current order, leader first.
 */
export function botHedgePick(running: readonly number[], ownLane: number, rng: Rng): number | null {
  const weights = [3, 3, 1.6, 1, 0.5, 0.4];
  const options = running.map((lane, i) => ({ lane, w: weights[i] ?? 0.3 })).filter((o) => o.lane !== ownLane);
  if (options.length === 0) return null;
  const total = options.reduce((a, o) => a + o.w, 0);
  let roll = rng.float(0, total);
  for (const o of options) {
    roll -= o.w;
    if (roll <= 0) return o.lane;
  }
  return options[options.length - 1]!.lane;
}

/** When in the window a bot taps, or null if it dithers and misses it. */
export function botHedgeDelay(rng: Rng): number | null {
  if (rng.next() < 0.12) return null;
  return rng.float(1.2, HEDGE_WINDOW_S - 1.2);
}

// ---------------------------------------------------------------- recap

export interface Incident {
  /** Race time it happened. */
  t: number;
  lane: number;
  kind: string;
  /** 0 mild, 1 medium, 2 severe. */
  severity: number;
  /** Victim's place at the time, 0 = leading. */
  position: number;
}

/**
 * The moment the race turned: the worst thing that happened to someone while they were
 * leading (latest first on a tie), or failing that to someone running second.
 * Null when the winner led all the way through the bad luck.
 */
export function decisiveIncident(log: readonly Incident[], winnerLane: number): Incident | null {
  const rank = (list: Incident[]): Incident | null =>
    list.sort((a, b) => b.severity - a.severity || b.t - a.t)[0] ?? null;
  const others = log.filter((i) => i.lane !== winnerLane);
  return rank(others.filter((i) => i.position === 0)) ?? rank(others.filter((i) => i.position === 1));
}

const VERBS: Readonly<Record<string, string>> = {
  anvil: "got flattened by an anvil",
  eagle: "got carried off by an eagle",
  ufo: "got abducted",
  lightning: "got struck by lightning",
  nap: "fell asleep",
  swap: "got swapped backwards",
  trip: "tripped",
  wrongway: "ran the wrong way",
  sneeze: "sneezed over",
  balloon: "floated off",
  hole: "fell down a hole",
  pie: "took a pie to the face",
  dance: "stopped to dance",
  shrink: "shrank",
  distracted: "got distracted",
  cramp: "got cramp",
  flattened: "got flattened by a boulder",
  banana: "slipped on a banana",
  fall: "fell over",
};

export function describeIncident(i: Incident, name: string): string {
  const verb = VERBS[i.kind] ?? "had a bad time";
  const where = i.position === 0 ? "while leading" : "in second";
  return `${name} ${verb} ${where} at ${i.t.toFixed(0)}s`;
}

// ---------------------------------------------------------------- layout

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One panel per seat in a row under the progress bar, all the same size, centred. */
export function panelLayout(seats: number, width: number, minTap: number, y = 72): Box[] {
  const gap = 12;
  const w = Math.min(304, Math.floor((width - 40 - gap * (seats - 1)) / seats));
  const h = Math.max(80, minTap + 12);
  const x0 = (width - (w * seats + gap * (seats - 1))) / 2;
  return Array.from({ length: seats }, (_, i) => ({ x: x0 + i * (w + gap), y, w, h }));
}

/** The CHEER button on the right of a panel. */
export function cheerBox(panel: Box, minTap: number): Box {
  const w = Math.max(minTap * 1.6, 92);
  const h = Math.max(minTap, 46);
  return { x: panel.x + panel.w - w - 8, y: panel.y + (panel.h - h) / 2, w, h };
}

/** Hedge chips under a panel: three per row, in the order of `lanes`. */
export function chipBoxes(panel: Box, lanes: readonly number[], minTap: number): { lane: number; box: Box }[] {
  const size = Math.max(minTap, 54);
  const gap = 8;
  const perRow = 3;
  const rowW = perRow * size + (perRow - 1) * gap;
  const x0 = panel.x + (panel.w - rowW) / 2;
  return lanes.map((lane, i) => ({
    lane,
    box: { x: x0 + (i % perRow) * (size + gap), y: panel.y + panel.h + 6 + Math.floor(i / perRow) * (size + gap), w: size, h: size },
  }));
}

export function inBox(x: number, y: number, b: Box): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

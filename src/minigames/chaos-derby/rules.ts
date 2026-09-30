import type { Rng } from "../../core/rng";

/**
 * Chaos Derby rules. Pure functions and plain state so the race can be simulated
 * headless in tests. Nothing here is skill-based on purpose: the only input a
 * player ever gives is which racer they bet on.
 */

export interface RacerSpec {
  id: string;
  name: string;
  emoji: string;
  color: string;
}

export const RACER_POOL: readonly RacerSpec[] = [
  { id: "turtle", name: "Sir Slowington", emoji: "🐢", color: "#4ade80" },
  { id: "duck", name: "Duck Norris", emoji: "🦆", color: "#facc15" },
  { id: "snail", name: "Escargo", emoji: "🐌", color: "#c084fc" },
  { id: "trex", name: "Tiny Arms", emoji: "🦖", color: "#34d399" },
  { id: "octopus", name: "Ink Diesel", emoji: "🐙", color: "#f472b6" },
  { id: "crab", name: "Crab Cake", emoji: "🦀", color: "#fb7185" },
  { id: "sloth", name: "Speedy", emoji: "🦥", color: "#a78bfa" },
  { id: "chicken", name: "Nugget", emoji: "🐔", color: "#fbbf24" },
  { id: "penguin", name: "Waddles", emoji: "🐧", color: "#93c5fd" },
  { id: "frog", name: "Leap Day", emoji: "🐸", color: "#86efac" },
  { id: "pig", name: "Ham Solo", emoji: "🐷", color: "#f9a8d4" },
  { id: "unicorn", name: "Glitterhoof", emoji: "🦄", color: "#e879f9" },
  { id: "ghost", name: "Boo Radley", emoji: "👻", color: "#e2e8f0" },
  { id: "potato", name: "Spud", emoji: "🥔", color: "#d6b98c" },
];

export const RACER_COUNT = 6;
/** Decoration only. The odds have no effect on anything. */
export const FAKE_ODDS = ["1:1", "2:1", "3:1", "5:1", "8:1", "13:1", "20:1", "50:1", "99:1", "∞:1"] as const;

export const PACE_MIN = 55;
export const PACE_MAX = 125;
export const BOOST_MULT = 3.2;
export const EVENT_GAP: readonly [number, number] = [0.5, 1.1];
/** Hard cap on race time. Anyone still running is ranked by distance. */
export const MAX_RACE_S = 40;

export interface Racer {
  spec: RacerSpec;
  lane: number;
  odds: string;
  /** Distance along the track, 0..trackLength. */
  x: number;
  pace: number;
  repace: number;
  stun: number;
  sleep: number;
  boost: number;
  reverse: number;
  finished: boolean;
  /** 1-based finishing place, 0 while still running. */
  place: number;
}

export interface RaceState {
  racers: Racer[];
  trackLength: number;
  time: number;
  nextEvent: number;
  finishedCount: number;
}

export type EventKind =
  | "banana"
  | "rocket"
  | "nap"
  | "reverse"
  | "teleport"
  | "swap"
  | "lightning"
  | "tornado"
  | "gust"
  | "underdog"
  | "tripped"
  | "wormhole"
  | "shortcut"
  | "moonwalk";

export interface RaceEvent {
  kind: EventKind;
  text: string;
  /** Lanes the event landed on, for particles and floating text. */
  lanes: number[];
  /** True for the whole-field events that deserve a big centre callout. */
  big: boolean;
}

const EVENT_WEIGHTS: readonly [EventKind, number][] = [
  ["banana", 10],
  ["rocket", 10],
  ["nap", 8],
  ["reverse", 8],
  ["teleport", 7],
  ["swap", 7],
  ["lightning", 6],
  ["underdog", 6],
  ["tripped", 6],
  ["gust", 5],
  ["shortcut", 4],
  ["moonwalk", 4],
  ["tornado", 3],
  ["wormhole", 3],
];

/** Six different racers from the pool, each with made-up odds. */
export function draftRacers(rng: Rng, count = RACER_COUNT): Racer[] {
  const pool = [...RACER_POOL];
  const racers: Racer[] = [];
  for (let lane = 0; lane < count && pool.length > 0; lane += 1) {
    const spec = pool.splice(rng.int(0, pool.length - 1), 1)[0]!;
    racers.push({
      spec,
      lane,
      odds: rng.pick(FAKE_ODDS),
      x: 0,
      pace: rng.float(PACE_MIN, PACE_MAX),
      repace: rng.float(0.4, 1.2),
      stun: 0,
      sleep: 0,
      boost: 0,
      reverse: 0,
      finished: false,
      place: 0,
    });
  }
  return racers;
}

export function createRace(racers: Racer[], trackLength: number, rng: Rng): RaceState {
  return { racers, trackLength, time: 0, nextEvent: rng.float(EVENT_GAP[0], EVENT_GAP[1]), finishedCount: 0 };
}

function running(state: RaceState): Racer[] {
  return state.racers.filter((r) => !r.finished);
}

function clampX(state: RaceState, x: number): number {
  return Math.max(0, Math.min(state.trackLength - 1, x));
}

function pickKind(rng: Rng): EventKind {
  const total = EVENT_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng.float(0, total);
  for (const [kind, weight] of EVENT_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return kind;
  }
  return EVENT_WEIGHTS[0]![0];
}

/** Fire one random event on the field. Null when nobody is left to torment. */
export function rollEvent(state: RaceState, rng: Rng, kind: EventKind = pickKind(rng)): RaceEvent | null {
  const field = running(state);
  if (field.length === 0) return null;
  const target = rng.pick(field);
  const name = target.spec.name;
  switch (kind) {
    case "banana":
      target.stun = 1.4;
      return { kind, text: `🍌 ${name} slipped on a banana!`, lanes: [target.lane], big: false };
    case "rocket":
      target.boost = 1.0;
      target.sleep = 0;
      target.stun = 0;
      return { kind, text: `🚀 ${name} found a rocket!`, lanes: [target.lane], big: false };
    case "nap":
      target.sleep = 2.0;
      return { kind, text: `💤 ${name} fell asleep.`, lanes: [target.lane], big: false };
    case "reverse":
      target.reverse = 1.2;
      return { kind, text: `🔄 ${name} is running the wrong way!`, lanes: [target.lane], big: false };
    case "teleport":
      target.x = clampX(state, rng.float(0, state.trackLength * 0.95));
      return { kind, text: `🌀 ${name} teleported!`, lanes: [target.lane], big: false };
    case "swap": {
      const others = field.filter((r) => r !== target);
      if (others.length === 0) return rollEvent(state, rng, "banana");
      const other = rng.pick(others);
      [target.x, other.x] = [other.x, target.x];
      return { kind, text: `🔁 ${name} and ${other.spec.name} swapped places!`, lanes: [target.lane, other.lane], big: false };
    }
    case "lightning":
      target.x = clampX(state, target.x - state.trackLength * 0.25);
      target.stun = 0.6;
      return { kind, text: `⚡ ${name} got struck by lightning!`, lanes: [target.lane], big: false };
    case "tornado": {
      const xs = field.map((r) => r.x);
      for (let i = xs.length - 1; i > 0; i -= 1) {
        const j = rng.int(0, i);
        [xs[i], xs[j]] = [xs[j]!, xs[i]!];
      }
      field.forEach((r, i) => {
        r.x = xs[i]!;
      });
      return { kind, text: "🌪️ TORNADO! Everyone's scrambled!", lanes: field.map((r) => r.lane), big: true };
    }
    case "gust":
      for (const r of field) r.x = clampX(state, r.x + rng.float(-140, 180));
      return { kind, text: "💨 A huge gust hits the track!", lanes: field.map((r) => r.lane), big: true };
    case "underdog": {
      const last = field.reduce((a, b) => (b.x < a.x ? b : a));
      last.boost = 1.6;
      last.sleep = 0;
      last.stun = 0;
      last.reverse = 0;
      return { kind, text: `🔥 ${last.spec.name} has a second wind!`, lanes: [last.lane], big: false };
    }
    case "tripped": {
      const lead = field.reduce((a, b) => (b.x > a.x ? b : a));
      lead.stun = 1.0;
      return { kind, text: `🪢 ${lead.spec.name} tripped over the lead!`, lanes: [lead.lane], big: false };
    }
    case "wormhole": {
      const lucky = rng.next() < 0.5;
      target.x = lucky ? state.trackLength * 0.92 : 0;
      return {
        kind,
        text: `🕳️ ${name} fell in a wormhole and came out ${lucky ? "by the finish!" : "at the start!"}`,
        lanes: [target.lane],
        big: true,
      };
    }
    case "shortcut":
      target.x = clampX(state, target.x + state.trackLength * 0.2);
      return { kind, text: `🛤️ ${name} took a shortcut!`, lanes: [target.lane], big: false };
    case "moonwalk":
      target.x = clampX(state, target.x - state.trackLength * 0.15);
      return { kind, text: `🕺 ${name} is moonwalking.`, lanes: [target.lane], big: false };
  }
}

/** Advance the race by `dt` seconds. Returns any events that fired this step. */
export function stepRace(state: RaceState, dt: number, rng: Rng): RaceEvent[] {
  const events: RaceEvent[] = [];
  state.time += dt;
  state.nextEvent -= dt;
  while (state.nextEvent <= 0) {
    const event = rollEvent(state, rng);
    if (event) events.push(event);
    state.nextEvent += rng.float(EVENT_GAP[0], EVENT_GAP[1]);
  }

  const crossed: Racer[] = [];
  for (const r of state.racers) {
    if (r.finished) continue;
    r.repace -= dt;
    if (r.repace <= 0) {
      r.pace = rng.float(PACE_MIN, PACE_MAX);
      r.repace = rng.float(0.4, 1.2);
    }
    r.x += racerVelocity(r) * dt;
    tickTimers(r, dt);
    if (r.x < 0) r.x = 0;
    if (r.x >= state.trackLength) crossed.push(r);
  }
  // Two racers crossing in the same frame: whoever overshot more got there first.
  crossed.sort((a, b) => b.x - a.x);
  for (const r of crossed) {
    r.finished = true;
    r.x = state.trackLength;
    state.finishedCount += 1;
    r.place = state.finishedCount;
    r.stun = r.sleep = r.boost = r.reverse = 0;
  }
  return events;
}

export function racerVelocity(r: Racer): number {
  if (r.stun > 0 || r.sleep > 0) return 0;
  let v = r.reverse > 0 ? -r.pace * 0.9 : r.pace;
  if (r.boost > 0 && v > 0) v *= BOOST_MULT;
  return v;
}

function tickTimers(r: Racer, dt: number): void {
  r.stun = Math.max(0, r.stun - dt);
  r.sleep = Math.max(0, r.sleep - dt);
  r.boost = Math.max(0, r.boost - dt);
  r.reverse = Math.max(0, r.reverse - dt);
}

/** The race is over once every racer someone bet on has crossed, everyone has, or time is up. */
export function raceOver(state: RaceState, betLanes: readonly number[]): boolean {
  if (state.time >= MAX_RACE_S) return true;
  if (state.racers.every((r) => r.finished)) return true;
  const watched = new Set(betLanes);
  if (watched.size === 0) return false;
  return state.racers.every((r) => !watched.has(r.lane) || r.finished);
}

/** Finishers by place, then everyone still running by distance. */
export function placings(state: RaceState): Racer[] {
  const done = state.racers.filter((r) => r.finished).sort((a, b) => a.place - b.place);
  const rest = state.racers.filter((r) => !r.finished).sort((a, b) => b.x - a.x);
  return [...done, ...rest];
}

/**
 * A bet on the racer that placed best wins. Score is how many racers your pick beat,
 * so backers of the winner top the table and two people on the same racer tie.
 * No bet scores 0.
 */
export function scoreBets(order: readonly Racer[], bets: ReadonlyMap<string, number>): Map<string, number> {
  const rank = new Map(order.map((r, i) => [r.lane, i]));
  const scores = new Map<string, number>();
  for (const [playerId, lane] of bets) {
    const i = rank.get(lane);
    scores.set(playerId, i === undefined ? 0 : order.length - i);
  }
  return scores;
}

/** Who backed the winner, in seat order. */
export function backersOf(lane: number, bets: ReadonlyMap<string, number>): string[] {
  return [...bets].filter(([, l]) => l === lane).map(([id]) => id);
}

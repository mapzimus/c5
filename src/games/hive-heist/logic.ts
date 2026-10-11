import type { Rng } from "../../core/rng";

/** Pure rules for Hive Heist. No canvas, no DOM. */

export type Item = { kind: "honey"; value: number } | { kind: "wasp" };

/** How many items at the front of the queue are revealed. */
export const VISIBLE = 3;
export const STING_PENALTY = 5;
export const HIVES = 2;
export const TURN_MS = 5000;
export const MIN_ITEMS = 14;
export const MAX_ITEMS = 20;
/** Wasps never sit in the first two slots, so the opening turn can't be a forced sting. */
export const SAFE_LEAD = 2;

/** Hive 1 hides 2-3 wasps, hive 2 hides 4. */
export function waspsForHive(hive: number, rng: Rng): number {
  return hive === 0 ? rng.int(2, 3) : 4;
}

/** A fresh queue of 14-20 items: honey worth 1-3 with wasps at random positions. Index 0 is next to the bear. */
export function buildHive(hive: number, rng: Rng): Item[] {
  const n = rng.int(MIN_ITEMS, MAX_ITEMS);
  const items: Item[] = [];
  for (let i = 0; i < n; i++) items.push({ kind: "honey", value: rng.int(1, 3) });
  const slots: number[] = [];
  for (let i = SAFE_LEAD; i < n; i++) slots.push(i);
  const wasps = waspsForHive(hive, rng);
  for (let w = 0; w < wasps && slots.length > 0; w++) {
    const k = rng.int(0, slots.length - 1);
    const idx = slots.splice(k, 1)[0]!;
    items[idx] = { kind: "wasp" };
  }
  return items;
}

export interface HiveState {
  /** Remaining items, front first. */
  queue: Item[];
  /** Seats stung out of this hive. */
  out: boolean[];
  /** Seat whose turn it is. */
  turn: number;
  /** True once the queue is empty or nobody is left in the hive. */
  done: boolean;
}

export function newHive(queue: readonly Item[], seats: number, firstTurn: number): HiveState {
  return { queue: [...queue], out: Array(seats).fill(false), turn: firstTurn % seats, done: queue.length === 0 };
}

/** Next seat after `from` that is still in the hive, or null when everyone is out. */
export function nextInHive(out: readonly boolean[], from: number): number | null {
  const n = out.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (!out[i]) return i;
  }
  return null;
}

export interface TakeResult {
  seat: number;
  taken: Item[];
  /** Honey collected from the honey items taken (before any sting penalty). */
  honey: number;
  stung: boolean;
}

/** The current seat takes `n` items from the front. Honey is kept even on a sting; a sting puts the seat out. */
export function take(s: HiveState, n: 1 | 2): TakeResult {
  const seat = s.turn;
  const taken = s.queue.splice(0, n);
  let honey = 0;
  let stung = false;
  for (const it of taken) {
    if (it.kind === "wasp") stung = true;
    else honey += it.value;
  }
  if (stung) s.out[seat] = true;
  const next = nextInHive(s.out, seat);
  if (s.queue.length === 0 || next === null) s.done = true;
  else s.turn = next;
  return { seat, taken, honey, stung };
}

export function visible(queue: readonly Item[]): Item[] {
  return queue.slice(0, VISIBLE);
}

/**
 * Bot policy from the visible window: a wasp 1st or 2nd means take 1 (1st is a forced sting),
 * a wasp 3rd means take 2 to hand it to the next player, otherwise take 2 when there are 2 to grab.
 * `blunder` is the chance of flipping the choice.
 */
export function botChoice(queue: readonly Item[], rng: Rng, blunder = 0.1): 1 | 2 {
  const v = visible(queue);
  const waspAt = v.findIndex((i) => i.kind === "wasp");
  let pick: 1 | 2;
  if (waspAt === 0 || waspAt === 1) pick = 1;
  else if (waspAt === 2) pick = 2;
  else pick = queue.length >= 2 ? 2 : 1;
  if (rng.next() < blunder) pick = pick === 1 ? 2 : 1;
  return pick;
}

/** Seats sharing the top honey total. */
export function leaders(scores: readonly number[]): number[] {
  const top = Math.max(...scores);
  const out: number[] = [];
  scores.forEach((s, i) => { if (s === top) out.push(i); });
  return out;
}

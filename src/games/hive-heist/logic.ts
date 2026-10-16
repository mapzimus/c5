import type { Rng } from "../../core/rng";

/** Pure rules for Hive Heist. No canvas, no DOM. */

export type Item =
  | { kind: "honey"; value: number; crown?: boolean }
  | { kind: "wasp"; owner?: number };

/** How many items at the front of the queue are revealed. */
export const VISIBLE = 3;
/** The underdog (lowest banked total, unique) sees one more comb on their turn. */
export const UNDERDOG_BONUS = 1;
export const TURN_MS = 5000;
/** Wasps and the crown never sit in the first two slots, so the opening turn can't be a forced sting. */
export const SAFE_LEAD = 2;
/** Paid to the swarm member whose released wasp lands a sting. */
export const BOUNTY = 3;

export interface HiveSpec {
  name: string;
  items: [number, number];
  wasps: number;
  honey: [number, number];
  /** Value of the crown comb (0 = none). Its slot is marked even while hidden. */
  crown: number;
}

/** Three hives with rising stakes. The last one is the royal hive. */
export const HIVE_SPECS: readonly HiveSpec[] = [
  { name: "SPRING HIVE", items: [12, 14], wasps: 2, honey: [1, 3], crown: 0 },
  { name: "SUMMER HIVE", items: [14, 16], wasps: 3, honey: [1, 4], crown: 6 },
  { name: "ROYAL HIVE", items: [15, 17], wasps: 4, honey: [2, 5], crown: 10 },
];
export const HIVES = HIVE_SPECS.length;

/** Smaller tables get longer hives so a match stays about the same length. */
export function extraCombs(seats: number): number {
  return Math.max(0, 4 - seats) * 3;
}

/** A fresh queue: honey at random values, wasps at random positions past the safe lead, the crown in the back half. */
export function buildHive(hive: number, rng: Rng, seats = 4): Item[] {
  const spec = HIVE_SPECS[Math.min(hive, HIVES - 1)]!;
  const n = rng.int(spec.items[0], spec.items[1]) + extraCombs(seats);
  const items: Item[] = [];
  for (let i = 0; i < n; i++) items.push({ kind: "honey", value: rng.int(spec.honey[0], spec.honey[1]) });
  const slots: number[] = [];
  for (let i = SAFE_LEAD; i < n; i++) slots.push(i);
  if (spec.crown > 0) {
    const back = slots.filter((i) => i >= Math.floor(n / 2));
    const idx = back[rng.int(0, back.length - 1)]!;
    items[idx] = { kind: "honey", value: spec.crown, crown: true };
    slots.splice(slots.indexOf(idx), 1);
  }
  for (let w = 0; w < spec.wasps && slots.length > 0; w++) {
    const k = rng.int(0, slots.length - 1);
    const idx = slots.splice(k, 1)[0]!;
    items[idx] = { kind: "wasp" };
  }
  return items;
}

export type SeatStatus = "in" | "banked" | "stung";

export interface HiveState {
  /** Remaining items, front first. */
  queue: Item[];
  status: SeatStatus[];
  /** Honey held this hive, lost entirely on a sting, kept when banked or when the hive empties. */
  paws: number[];
  /** Swarm members (banked or stung) each hold one wasp to release into the hidden combs. */
  wasp: boolean[];
  /** Seat whose turn it is. */
  turn: number;
  /** True once the queue is empty or nobody is left in the hive. */
  done: boolean;
}

export function newHive(queue: readonly Item[], seats: number, firstTurn: number): HiveState {
  return {
    queue: [...queue],
    status: Array(seats).fill("in"),
    paws: Array(seats).fill(0),
    wasp: Array(seats).fill(false),
    turn: firstTurn % seats,
    done: queue.length === 0,
  };
}

/** Next seat after `from` that is still in the hive, or null when everyone is out. */
export function nextInHive(status: readonly SeatStatus[], from: number): number | null {
  const n = status.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (status[i] === "in") return i;
  }
  return null;
}

/** A wasp at the front: the seat on turn has no escape. */
export function cornered(s: HiveState): boolean {
  return s.queue[0]?.kind === "wasp";
}

export interface TakeResult {
  seat: number;
  taken: Item[];
  /** Honey added to the paws (0 on a sting: the bite is lost with the paws). */
  honey: number;
  stung: boolean;
  /** Paw honey lost to the sting. */
  spilled: number;
  /** Swarm member paid for the sting, when the wasp was a released one. */
  bounty: number | null;
}

function leave(s: HiveState, seat: number, status: SeatStatus): void {
  s.status[seat] = status;
  s.wasp[seat] = true;
  const next = nextInHive(s.status, seat);
  if (next === null || s.queue.length === 0) s.done = true;
  else s.turn = next;
}

/** The current seat takes `n` items from the front. A sting spills the paws and puts the seat in the swarm. */
export function take(s: HiveState, n: 1 | 2): TakeResult {
  const seat = s.turn;
  const taken = s.queue.splice(0, n);
  let honey = 0;
  let bounty: number | null = null;
  let stung = false;
  for (const it of taken) {
    if (it.kind === "wasp") {
      stung = true;
      if (it.owner !== undefined && it.owner !== seat && bounty === null) bounty = it.owner;
    } else honey += it.value;
  }
  let spilled = 0;
  if (stung) {
    spilled = s.paws[seat] ?? 0;
    s.paws[seat] = 0;
    honey = 0;
    leave(s, seat, "stung");
  } else {
    s.paws[seat] = (s.paws[seat] ?? 0) + honey;
    const next = nextInHive(s.status, seat);
    if (s.queue.length === 0 || next === null) s.done = true;
    else s.turn = next;
  }
  return { seat, taken, honey, stung, spilled, bounty };
}

/** The current seat leaves the hive with its paws intact. Returns the honey banked. */
export function bankOut(s: HiveState): { seat: number; banked: number } {
  const seat = s.turn;
  const banked = s.paws[seat] ?? 0;
  s.paws[seat] = 0;
  leave(s, seat, "banked");
  return { seat, banked };
}

/** When the hive empties, everyone still in banks their paws. Returns the payouts. */
export function cashOut(s: HiveState): { seat: number; banked: number }[] {
  const out: { seat: number; banked: number }[] = [];
  s.status.forEach((st, seat) => {
    if (st !== "in") return;
    const banked = s.paws[seat] ?? 0;
    s.paws[seat] = 0;
    s.status[seat] = "banked";
    if (banked > 0) out.push({ seat, banked });
  });
  return out;
}

export function canRelease(s: HiveState, seat: number): boolean {
  return !s.done && s.status[seat] !== "in" && s.wasp[seat] === true;
}

/** A swarm member drops its wasp into a random hidden slot. When the queue is too short to hide it, append at the end. */
export function releaseWasp(s: HiveState, seat: number, rng: Rng): number | null {
  if (!canRelease(s, seat)) return null;
  const lo = Math.min(VISIBLE, s.queue.length);
  if (lo >= s.queue.length) {
    s.queue.push({ kind: "wasp", owner: seat });
    s.wasp[seat] = false;
    return s.queue.length - 1;
  }
  const idx = rng.int(lo, s.queue.length);
  s.queue.splice(idx, 0, { kind: "wasp", owner: seat });
  s.wasp[seat] = false;
  return idx;
}

export function visible(queue: readonly Item[], window = VISIBLE): Item[] {
  return queue.slice(0, window);
}

/** Wasps still hidden behind the window, and how many hidden combs there are. */
export function hiddenRisk(queue: readonly Item[], window = VISIBLE): { wasps: number; hidden: number; risk: number } {
  const hiddenItems = queue.slice(window);
  const wasps = hiddenItems.filter((it) => it.kind === "wasp").length;
  return { wasps, hidden: hiddenItems.length, risk: hiddenItems.length === 0 ? 0 : wasps / hiddenItems.length };
}

/**
 * Who ends up cornered if `seat` takes `k` with the nearest visible wasp at index `w`,
 * assuming everyone after plays the obvious shove (take 1 on a wasp 2nd, take 2 on a wasp 3rd).
 */
export function victimOf(status: readonly SeatStatus[], seat: number, w: number, k: 1 | 2): number | null {
  const left = w - k;
  const next = nextInHive(status, seat);
  if (next === null) return null;
  if (left === 0) return next;
  if (left === 1 || left === 2) return nextInHive(status, next);
  return null;
}

export type Choice = "take1" | "take2" | "bank";

/**
 * Bot policy. With a wasp in view it shoves it onto the richest victim it can reach (never onto itself
 * if it can help it); with nothing in view it grabs two, banking once the hidden risk times its paws
 * outweighs another bite. `nerve` < 1 banks earlier, > 1 later. `blunder` flips a take.
 */
export function botChoice(
  s: HiveState, seat: number, rng: Rng, options: { nerve?: number; blunder?: number; window?: number } = {},
): Choice {
  const nerve = options.nerve ?? 1;
  const blunder = options.blunder ?? 0.08;
  const window = options.window ?? VISIBLE;
  const q = s.queue;
  const paws = s.paws[seat] ?? 0;
  if (q.length < 2) return "take1";
  const v = visible(q, window);
  const w = v.findIndex((it) => it.kind === "wasp");
  let pick: Choice;
  if (w >= 1) {
    const candidates = ([2, 1] as const).filter((k) => k <= w);
    const safe = candidates.filter((k) => victimOf(s.status, seat, w, k) !== seat);
    if (safe.length === 0) {
      // Every shove comes back around: grab one more if the wasp is still two away, then cash out,
      // or bite up to the wasp when there is nothing to lose.
      pick = paws > 0 ? (w >= 2 ? "take1" : "bank") : w >= 2 ? "take2" : "take1";
    } else {
      let best: 1 | 2 = safe[0]!;
      let bestPaws = -1;
      for (const k of safe) {
        const victim = victimOf(s.status, seat, w, k);
        const vp = victim === null ? 0 : (s.paws[victim] ?? 0) + (w - k === 0 ? 0.5 : 0);
        if (vp > bestPaws) {
          bestPaws = vp;
          best = k;
        }
      }
      pick = best === 1 ? "take1" : "take2";
    }
  } else {
    const { risk, hidden } = hiddenRisk(q, window);
    if (hidden > 0 && paws > 0 && paws * risk > 4 * nerve) pick = "bank";
    else pick = "take2";
  }
  if (pick !== "bank" && rng.next() < blunder) {
    const flipped: Choice = pick === "take1" ? "take2" : "take1";
    // A blunder never walks straight into a visible wasp.
    const idx = flipped === "take2" ? 1 : 0;
    if (v[idx]?.kind !== "wasp") pick = flipped;
  }
  return pick;
}

/** Seats sharing the top honey total. */
export function leaders(scores: readonly number[]): number[] {
  const top = Math.max(...scores);
  const out: number[] = [];
  scores.forEach((s, i) => { if (s === top) out.push(i); });
  return out;
}

/** The unique lowest scorer, or null when the bottom is shared. */
export function underdog(scores: readonly number[]): number | null {
  if (scores.length < 2) return null;
  const low = Math.min(...scores);
  const idx = scores.filter((s) => s === low);
  return idx.length === 1 ? scores.indexOf(low) : null;
}

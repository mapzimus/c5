import type { Rng } from "../../core/rng";

/** Pure rules for High Noon (quick-draw). No canvas, no DOM. Times are ms from round start. */

export type FakeKind = "DRUM!" | "DRAWER!" | "DRAMA!" | "BRAW!" | "tumbleweed";
export const FAKE_KINDS: readonly FakeKind[] = ["DRUM!", "DRAWER!", "DRAMA!", "BRAW!", "tumbleweed"];

/** What a heckler yells when they throw a bottle. Shown in the heckler's colour, never gold. */
export const HECKLE_WORDS: readonly string[] = ["DRAW?", "NOW!", "GO GO!", "BANG!", "DRAW!!"];

export const ROUNDS = 7;
export const WINS_NEEDED = 4;
export const MIN_WAIT_MS = 1500;
/** If nobody taps this long after DRAW, the round is void. */
export const DRAW_TIMEOUT_MS = 3000;
export const FAKE_SHOW_MS = 650;
/** Taps this soon after the winner still count as a "late draw" and show their time. */
export const LATE_WINDOW_MS = 400;
/** Within this many ms of the winner a late draw is a near miss ("SO CLOSE"). */
export const SO_CLOSE_MS = 60;
/** Bottles a false-starter gets to throw for the rest of the round. */
export const HECKLES_PER_ROUND = 2;
const FAKE_GAP_MS = 550;

export interface Fake {
  atMs: number;
  kind: FakeKind;
}

export interface RoundPlan {
  waitMs: number;
  fakes: Fake[];
}

/** Longest possible wait for a round index (0-based): 3s, 3.5s ... 5s. */
export function maxWaitMs(round: number): number {
  return Math.min(5000, 3000 + round * 500);
}

/** Wait time and fake calls for round `round` (0-based). Later rounds: more fakes, longer waits. */
export function planRound(round: number, rng: Rng): RoundPlan {
  const waitMs = Math.round(rng.float(MIN_WAIT_MS, maxWaitMs(round)));
  const wanted = rng.int(round === 0 ? 0 : 1, 1 + round);
  const fakes: Fake[] = [];
  let t = 500;
  for (let i = 0; i < wanted; i++) {
    const latest = waitMs - FAKE_SHOW_MS - 150;
    if (t > latest) break;
    // Spread the remaining fakes over the remaining wait.
    const slot = (latest - t) / (wanted - i);
    const at = Math.round(t + rng.float(0, Math.max(0, slot)));
    fakes.push({ atMs: at, kind: rng.pick(FAKE_KINDS) });
    t = at + FAKE_SHOW_MS + FAKE_GAP_MS;
  }
  return { waitMs, fakes };
}

/** How a bot shoots: its reaction window and how often it freezes up like a human. */
export interface BotProfile {
  /** Fastest reaction in ms after DRAW. */
  base: number;
  /** Reaction spread above `base`. */
  spread: number;
  /** Chance per round of a hesitation (a much slower draw). */
  hesitate: number;
}

/** Each bot gets its own hand: a quick one, a steady one, a twitchy one. */
export function botProfile(rng: Rng): BotProfile {
  return { base: Math.round(rng.float(170, 250)), spread: Math.round(rng.float(130, 210)), hesitate: rng.float(0.06, 0.14) };
}

/** When a bot taps this round: bites a fake (~15% each) or reacts after DRAW (180-400ms without a profile). */
export function planBotTap(plan: RoundPlan, rng: Rng, biteChance = 0.15, profile?: BotProfile): number {
  for (const fake of plan.fakes) {
    if (rng.next() < biteChance) return fake.atMs + Math.round(rng.float(120, 300));
  }
  if (!profile) return plan.waitMs + Math.round(rng.float(180, 400));
  if (rng.next() < profile.hesitate) return plan.waitMs + Math.round(rng.float(480, 760));
  return plan.waitMs + Math.round(rng.float(profile.base, profile.base + profile.spread));
}

/** A live bot seeing a heckler's decoy: bites with `chance`, tapping 120-300ms after it appears. */
export function botBiteDecoy(decoyAtMs: number, rng: Rng, chance = 0.2): number | null {
  return rng.next() < chance ? decoyAtMs + Math.round(rng.float(120, 300)) : null;
}

/** Times (ms from round start) at which a bot that fell out at `outAtMs` throws its bottles. */
export function planBotHeckles(outAtMs: number, rng: Rng): number[] {
  const first = outAtMs + Math.round(rng.float(350, 1100));
  return [first, first + Math.round(rng.float(650, 1500))];
}

export type RoundPhase = "wait" | "draw" | "done";

export interface Decoy {
  atMs: number;
  seat: number;
  word: string;
}

export interface RoundState {
  plan: RoundPlan;
  t: number;
  phase: RoundPhase;
  /** Seats that false-started this round. */
  out: boolean[];
  /** Which heckler's decoy a seat bit on (null when they jumped a real fake or nothing). */
  baitedBy: (number | null)[];
  /** Bottles each seat still has to throw (only false-starters can throw). */
  bottles: number[];
  decoys: Decoy[];
  winner: number | null;
  reactionMs: number | null;
  /** Reaction of seats that drew after the winner, within LATE_WINDOW_MS. */
  lateMs: (number | null)[];
}

export function newRound(plan: RoundPlan, seats: number): RoundState {
  return {
    plan, t: 0, phase: "wait",
    out: Array(seats).fill(false), baitedBy: Array(seats).fill(null), bottles: Array(seats).fill(HECKLES_PER_ROUND),
    decoys: [], winner: null, reactionMs: null, lateMs: Array(seats).fill(null),
  };
}

export function advanceRound(s: RoundState, dtMs: number): void {
  if (s.phase === "done") return;
  s.t += dtMs;
  if (s.phase === "wait" && s.t >= s.plan.waitMs) s.phase = "draw";
  if (s.phase === "draw" && s.t >= s.plan.waitMs + DRAW_TIMEOUT_MS) s.phase = "done";
}

export type TapResult = "ignored" | "false-start" | "win" | "late";

/** Apply a tap from `seat` at the current round time. */
export function tap(s: RoundState, seat: number): TapResult {
  if (s.out[seat]) return "ignored";
  if (s.phase === "done") {
    // A draw just after the winner: no point, but the player learns by how much they missed.
    if (s.winner === null || s.winner === seat || s.lateMs[seat] !== null) return "ignored";
    const late = s.t - s.plan.waitMs;
    if (late - (s.reactionMs ?? 0) > LATE_WINDOW_MS) return "ignored";
    s.lateMs[seat] = Math.round(late);
    return "late";
  }
  if (s.phase === "wait") {
    s.out[seat] = true;
    const decoy = activeDecoy(s);
    if (decoy && decoy.seat !== seat) s.baitedBy[seat] = decoy.seat;
    if (s.out.every(Boolean)) s.phase = "done";
    return "false-start";
  }
  s.phase = "done";
  s.winner = seat;
  s.reactionMs = Math.max(0, Math.round(s.t - s.plan.waitMs));
  return "win";
}

/** Let the round clock keep running after it is done so late draws can be timed. */
export function tickDone(s: RoundState, dtMs: number): void {
  if (s.phase === "done") s.t += dtMs;
}

/**
 * A false-starter throws a bottle and yells a decoy. Only during the wait, only with bottles left,
 * and never on top of another call. Returns the decoy or null.
 */
export function heckle(s: RoundState, seat: number, word: string): Decoy | null {
  if (s.phase !== "wait" || !s.out[seat] || (s.bottles[seat] ?? 0) <= 0) return null;
  if (activeFake(s) || activeDecoy(s)) return null;
  s.bottles[seat] = (s.bottles[seat] ?? 0) - 1;
  const decoy = { atMs: s.t, seat, word };
  s.decoys.push(decoy);
  return decoy;
}

/** The fake on screen right now, if any. */
export function activeFake(s: RoundState): Fake | null {
  if (s.phase !== "wait") return null;
  return s.plan.fakes.find((f) => s.t >= f.atMs && s.t < f.atMs + FAKE_SHOW_MS) ?? null;
}

/** The heckler's decoy on screen right now, if any. */
export function activeDecoy(s: RoundState): Decoy | null {
  if (s.phase !== "wait") return null;
  return s.decoys.find((d) => s.t >= d.atMs && s.t < d.atMs + FAKE_SHOW_MS) ?? null;
}

/** Seats strictly behind everyone else double down for free. Nobody is an underdog while tied. */
export function underdogs(wins: readonly number[]): boolean[] {
  const low = Math.min(...wins);
  const high = Math.max(...wins);
  return wins.map((w) => w === low && low < high);
}

export interface Settlement {
  wins: number[];
  /** Change per seat: +1 win, +2 doubled win, -1 doubled false start. */
  deltas: number[];
}

/**
 * Score the round. A doubled winner takes 2 notches; a doubled false-starter loses one unless the
 * double was free (underdog). Nothing happens to seats that neither won nor jumped.
 */
export function settleRound(
  wins: readonly number[], r: RoundState, doubled: readonly boolean[], free: readonly boolean[],
): Settlement {
  const deltas = wins.map((w, i) => {
    if (r.winner === i) return doubled[i] ? 2 : 1;
    if (r.out[i] && doubled[i] && !free[i] && w > 0) return -1;
    return 0;
  });
  return { wins: wins.map((w, i) => w + (deltas[i] ?? 0)), deltas };
}

/** Whether a bot raises: behind -> often, free -> almost always, leading -> rarely; a hot hand adds. */
export function botWantsDouble(wins: readonly number[], seat: number, free: boolean, wonLast: boolean, rng: Rng): boolean {
  const mine = wins[seat] ?? 0;
  const best = Math.max(...wins);
  let p = free ? 0.8 : mine < best ? 0.5 : wins.every((w) => w === mine) ? 0.3 : 0.12;
  if (wonLast) p += 0.15;
  return rng.next() < p;
}

/** True when some seat can finish the match this round (a doubled seat needs one fewer). */
export function isMatchPoint(wins: readonly number[], doubled: readonly boolean[]): boolean {
  return wins.some((w, i) => w + (doubled[i] ? 2 : 1) >= WINS_NEEDED);
}

/** Match ends when someone reaches WINS_NEEDED or all ROUNDS are played. */
export function matchOver(wins: readonly number[], roundsPlayed: number): boolean {
  return wins.some((w) => w >= WINS_NEEDED) || roundsPlayed >= ROUNDS;
}

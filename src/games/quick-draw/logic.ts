import type { Rng } from "../../core/rng";

/** Pure rules for Quick Draw. No canvas, no DOM. Times are ms from round start. */

export type FakeKind = "DRUM!" | "DRAWER!" | "DRAMA!" | "BRAW!" | "tumbleweed";
export const FAKE_KINDS: readonly FakeKind[] = ["DRUM!", "DRAWER!", "DRAMA!", "BRAW!", "tumbleweed"];

export const ROUNDS = 5;
export const WINS_NEEDED = 3;
export const MIN_WAIT_MS = 1500;
/** If nobody taps this long after DRAW, the round is void. */
export const DRAW_TIMEOUT_MS = 3000;
export const FAKE_SHOW_MS = 650;
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

/** When a bot taps this round: bites a fake (~15% each) or reacts 180-400ms after DRAW. */
export function planBotTap(plan: RoundPlan, rng: Rng, biteChance = 0.15): number {
  for (const fake of plan.fakes) {
    if (rng.next() < biteChance) return fake.atMs + Math.round(rng.float(120, 300));
  }
  return plan.waitMs + Math.round(rng.float(180, 400));
}

export type RoundPhase = "wait" | "draw" | "done";

export interface RoundState {
  plan: RoundPlan;
  t: number;
  phase: RoundPhase;
  /** Seats that false-started this round. */
  out: boolean[];
  winner: number | null;
  reactionMs: number | null;
}

export function newRound(plan: RoundPlan, seats: number): RoundState {
  return { plan, t: 0, phase: "wait", out: Array(seats).fill(false), winner: null, reactionMs: null };
}

export function advanceRound(s: RoundState, dtMs: number): void {
  if (s.phase === "done") return;
  s.t += dtMs;
  if (s.phase === "wait" && s.t >= s.plan.waitMs) s.phase = "draw";
  if (s.phase === "draw" && s.t >= s.plan.waitMs + DRAW_TIMEOUT_MS) s.phase = "done";
}

export type TapResult = "ignored" | "false-start" | "win";

/** Apply a tap from `seat` at the current round time. */
export function tap(s: RoundState, seat: number): TapResult {
  if (s.phase === "done" || s.out[seat]) return "ignored";
  if (s.phase === "wait") {
    s.out[seat] = true;
    if (s.out.every(Boolean)) s.phase = "done";
    return "false-start";
  }
  s.phase = "done";
  s.winner = seat;
  s.reactionMs = Math.max(0, Math.round(s.t - s.plan.waitMs));
  return "win";
}

/** The fake on screen right now, if any. */
export function activeFake(s: RoundState): Fake | null {
  if (s.phase !== "wait") return null;
  return s.plan.fakes.find((f) => s.t >= f.atMs && s.t < f.atMs + FAKE_SHOW_MS) ?? null;
}

/** Match ends when someone reaches 3 wins or all 5 rounds are played. */
export function matchOver(wins: readonly number[], roundsPlayed: number): boolean {
  return wins.some((w) => w >= WINS_NEEDED) || roundsPlayed >= ROUNDS;
}

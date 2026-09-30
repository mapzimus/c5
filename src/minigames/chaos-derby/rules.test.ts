import { describe, expect, it } from "vitest";
import { Rng } from "../../core/rng";
import {
  BOOST_MULT,
  MAX_RACE_S,
  RACER_COUNT,
  backersOf,
  createRace,
  draftRacers,
  placings,
  raceOver,
  racerVelocity,
  rollEvent,
  scoreBets,
  stepRace,
  type RaceState,
} from "./rules";

const TRACK = 1000;

function race(seed = 7): { state: RaceState; rng: Rng } {
  const rng = new Rng(seed);
  const state = createRace(draftRacers(rng), TRACK, rng);
  return { state, rng };
}

function runUntil(state: RaceState, rng: Rng, done: () => boolean, maxSeconds = 120): number {
  let t = 0;
  while (!done() && t < maxSeconds) {
    stepRace(state, 1 / 60, rng);
    t += 1 / 60;
  }
  return t;
}

describe("chaos derby rules", () => {
  it("drafts six different racers with made-up odds", () => {
    const racers = draftRacers(new Rng(3));
    expect(racers).toHaveLength(RACER_COUNT);
    expect(new Set(racers.map((r) => r.spec.id)).size).toBe(RACER_COUNT);
    expect(racers.map((r) => r.lane)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const r of racers) expect(r.odds).toMatch(/:1$/);
  });

  it("runs every racer to the finish and hands out places in crossing order", () => {
    const { state, rng } = race();
    const t = runUntil(state, rng, () => state.racers.every((r) => r.finished));
    expect(t).toBeLessThan(MAX_RACE_S + 1);
    const places = state.racers.map((r) => r.place).sort((a, b) => a - b);
    expect(places).toEqual([1, 2, 3, 4, 5, 6]);
    expect(placings(state).map((r) => r.place)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("is a coin flip, not a form guide: different seeds crown different winners", () => {
    const winners = new Set<number>();
    for (let seed = 1; seed <= 40; seed += 1) {
      const { state, rng } = race(seed);
      runUntil(state, rng, () => state.finishedCount >= 1);
      winners.add(placings(state)[0]!.lane);
    }
    expect(winners.size).toBeGreaterThanOrEqual(4);
  });

  it("stops a banana victim, speeds up a rocket, and flips a reversed racer", () => {
    const { state, rng } = race();
    const r = state.racers[0]!;
    r.pace = 100;
    expect(racerVelocity(r)).toBe(100);
    r.stun = 1;
    expect(racerVelocity(r)).toBe(0);
    r.stun = 0;
    r.boost = 1;
    expect(racerVelocity(r)).toBeCloseTo(100 * BOOST_MULT);
    r.boost = 0;
    r.reverse = 1;
    expect(racerVelocity(r)).toBeLessThan(0);
    expect(rollEvent(state, rng, "banana")?.kind).toBe("banana");
  });

  it("keeps every jump on the track", () => {
    const kinds = ["teleport", "lightning", "shortcut", "moonwalk", "gust", "tornado", "wormhole", "swap"] as const;
    for (let seed = 1; seed <= 30; seed += 1) {
      const { state, rng } = race(seed);
      for (const r of state.racers) r.x = rng.float(0, TRACK - 1);
      for (const kind of kinds) {
        rollEvent(state, rng, kind);
        for (const r of state.racers) {
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.x).toBeLessThan(TRACK);
        }
      }
    }
  });

  it("swaps two racers and scrambles the field with a tornado", () => {
    const { state, rng } = race();
    state.racers.forEach((r, i) => {
      r.x = i * 100;
    });
    const before = state.racers.map((r) => r.x);
    const swap = rollEvent(state, rng, "swap")!;
    expect(swap.lanes).toHaveLength(2);
    const [a, b] = swap.lanes as [number, number];
    expect(state.racers[a]!.x).toBe(before[b]);
    expect(state.racers[b]!.x).toBe(before[a]);

    rollEvent(state, rng, "tornado");
    expect(state.racers.map((r) => r.x).sort((p, q) => p - q)).toEqual(before);
  });

  it("never fires an event at a racer who already finished", () => {
    const { state, rng } = race();
    for (const r of state.racers.slice(1)) {
      r.finished = true;
      r.x = TRACK;
      r.place = r.lane;
    }
    for (let i = 0; i < 40; i += 1) rollEvent(state, rng);
    for (const r of state.racers.slice(1)) expect(r.x).toBe(TRACK);
    expect(rollEvent(state, rng, "swap")?.kind).toBe("banana");
  });

  it("ends once every racer with money on it has crossed", () => {
    const { state, rng } = race();
    expect(raceOver(state, [2])).toBe(false);
    runUntil(state, rng, () => state.racers[2]!.finished);
    expect(raceOver(state, [2])).toBe(true);
    const stillRunning = state.racers.find((r) => !r.finished);
    if (stillRunning) expect(raceOver(state, [2, stillRunning.lane])).toBe(false);
  });

  it("calls time on a race that drags on", () => {
    const { state } = race();
    state.time = MAX_RACE_S;
    expect(raceOver(state, [0])).toBe(true);
    state.racers[3]!.x = 900;
    expect(placings(state)[0]!.lane).toBe(3);
  });

  it("pays the winner's backers most, ties players on the same racer, and lists who called it", () => {
    const { state } = race();
    state.racers.forEach((r, i) => {
      r.finished = true;
      r.place = 6 - i;
    });
    const order = placings(state);
    expect(order[0]!.lane).toBe(5);
    const bets = new Map([
      ["gale", 5],
      ["surge", 5],
      ["squall", 0],
      ["tempest", 2],
    ]);
    const scores = scoreBets(order, bets);
    expect(scores.get("gale")).toBe(6);
    expect(scores.get("surge")).toBe(6);
    expect(scores.get("squall")).toBe(1);
    expect(scores.get("tempest")).toBe(3);
    expect(backersOf(5, bets)).toEqual(["gale", "surge"]);
    expect(backersOf(1, bets)).toEqual([]);
  });
});

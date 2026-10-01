import { describe, expect, it } from "vitest";
import { Rng } from "../../core/rng";
import { MIN_COLOR_GAP, RACER_COUNT, RACER_POOL, backersOf, colorDistance, draftRacers, placings, scoreBets } from "./rules";
import { DerbyWorld, FINISH_X, MAX_RACE_S, severityOdds, type Runner } from "./world";

interface RaceLog {
  world: DerbyWorld;
  longestDown: number;
  deepest: number;
  finite: boolean;
}

function runRace(seed: number): RaceLog {
  const rng = new Rng(seed);
  const world = new DerbyWorld(draftRacers(rng), rng);
  const down = new Map<number, number>();
  let longestDown = 0;
  let deepest = -Infinity;
  let finite = true;
  while (!world.runners.every((r) => r.finished) && world.time < MAX_RACE_S) {
    world.step();
    for (const r of world.runners) {
      const d = r.mode === "fallen" || r.mode === "getup" ? (down.get(r.lane) ?? 0) + 1 / 60 : 0;
      down.set(r.lane, d);
      longestDown = Math.max(longestDown, d);
      deepest = Math.max(deepest, r.body.position.y + world.heightAt(r.body.position.x));
      if (!Number.isFinite(r.body.position.x) || !Number.isFinite(r.body.position.y)) finite = false;
    }
  }
  world.destroy();
  return { world, longestDown, deepest, finite };
}

const races = [3, 6, 9, 12].map(runRace);

describe("chaos derby world", () => {
  it("drafts six different runners into six lanes with hidden stats", () => {
    const racers = draftRacers(new Rng(3));
    expect(racers).toHaveLength(RACER_COUNT);
    expect(new Set(racers.map((r) => r.spec.id)).size).toBe(RACER_COUNT);
    expect(racers.map((r) => r.lane)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const r of racers) {
      expect(r.stats.topSpeed).toBeGreaterThan(200);
      expect(r.stats.jumpSkill).toBeLessThan(1);
    }
  });

  it("never puts two lookalike colours in the same race", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const racers = draftRacers(new Rng(seed));
      expect(racers).toHaveLength(RACER_COUNT);
      for (let i = 0; i < racers.length; i += 1) {
        for (let j = i + 1; j < racers.length; j += 1) {
          expect(colorDistance(racers[i]!.spec.color, racers[j]!.spec.color)).toBeGreaterThanOrEqual(MIN_COLOR_GAP);
        }
      }
    }
    expect(new Set(RACER_POOL.map((r) => r.color)).size).toBe(RACER_POOL.length);
  });

  it("runs a full race: everyone finishes, in order, inside the time cap", () => {
    for (const { world, finite } of races) {
      expect(finite).toBe(true);
      expect(world.time).toBeLessThan(MAX_RACE_S);
      const places = world.runners.map((r) => r.place).sort((a, b) => a - b);
      expect(places).toEqual([1, 2, 3, 4, 5, 6]);
      const order = placings(world.runners);
      for (let i = 1; i < order.length; i += 1) expect(order[i]!.finishTime).toBeGreaterThanOrEqual(order[i - 1]!.finishTime);
    }
  });

  it("makes races last a while", () => {
    const winTimes = races.map(({ world }) => placings(world.runners)[0]!.finishTime).sort((a, b) => a - b);
    const median = (winTimes[1]! + winTimes[2]!) / 2;
    expect(median).toBeGreaterThan(30);
    expect(median).toBeLessThan(80);
  });

  it("knocks runners over, and they always get back up", () => {
    for (const { world, longestDown, deepest } of races) {
      const falls = world.runners.reduce((n, r) => n + r.falls, 0);
      expect(falls).toBeGreaterThan(3);
      expect(longestDown).toBeLessThan(9);
      // bodies can squash into the track a little on a hard landing, never through it
      expect(deepest).toBeLessThan(40);
    }
  });

  it("is anyone's race: winners vary and the fastest runner often loses", () => {
    const winners = new Set<number>();
    let fastestWon = 0;
    const extra = [21, 22, 23, 24, 25, 26].map(runRace);
    for (const { world } of [...races, ...extra]) {
      const winner = placings(world.runners)[0]!;
      winners.add(winner.lane);
      const fastest = [...world.runners].sort((a, b) => b.stats.topSpeed - a.stats.topSpeed)[0]!;
      if (fastest === winner) fastestWon += 1;
    }
    expect(winners.size).toBeGreaterThanOrEqual(4);
    expect(fastestWon).toBeLessThanOrEqual(6);
  }, 60_000);

  it("makes bad luck more likely to be severe the further up the order you are", () => {
    const odds = [0, 1, 2, 3, 4, 5].map((p) => severityOdds(p, 6));
    for (const o of odds) expect(o[0] + o[1] + o[2]).toBeCloseTo(1);
    for (let p = 1; p < 6; p += 1) {
      expect(odds[p]![2]).toBeLessThan(odds[p - 1]![2]);
      expect(odds[p]![0]).toBeGreaterThan(odds[p - 1]![0]);
    }
    expect(odds[0]![2]).toBeGreaterThan(0.5);
    expect(odds[5]![2]).toBeLessThan(0.1);
    // a leader running away with it gets even more
    expect(severityOdds(0, 6, 900)[2]).toBeGreaterThan(odds[0]![2]);
    expect(severityOdds(1, 6, 900)[2]).toBe(odds[1]![2]);
  });

  it("lands the severe stuff on the front-runners in real races", () => {
    const severe = [0, 0, 0, 0, 0, 0];
    const mild = [0, 0, 0, 0, 0, 0];
    for (let seed = 40; seed < 64; seed += 1) {
      const rng = new Rng(seed);
      const world = new DerbyWorld(draftRacers(rng), rng);
      while (!world.runners.every((r) => r.finished) && world.time < MAX_RACE_S) {
        for (const e of world.step()) {
          if (e.position === undefined || e.kind === "fall") continue;
          if (e.severity === 2) severe[e.position]! += 1;
          if (e.severity === 0) mild[e.position]! += 1;
        }
      }
      world.destroy();
    }
    const front = (xs: number[]): number => xs[0]! + xs[1]!;
    const back = (xs: number[]): number => xs[4]! + xs[5]!;
    expect(front(severe)).toBeGreaterThan(back(severe) * 4);
    expect(back(mild)).toBeGreaterThan(front(mild));
  }, 60_000);

  it("gives no body shape a built-in edge", () => {
    const rel = new Map<string, number[]>();
    for (let seed = 1; seed <= 72; seed += 1) {
      const rng = new Rng(seed * 3571 + 11);
      const world = new DerbyWorld(draftRacers(rng), rng);
      while (!world.runners.every((r) => r.finished) && world.time < MAX_RACE_S) world.step();
      const times = world.runners.map((r) => (r.finished ? r.finishTime : MAX_RACE_S)).sort((a, b) => a - b);
      const median = (times[2]! + times[3]!) / 2;
      for (const r of world.runners) rel.set(r.spec.id, [...(rel.get(r.spec.id) ?? []), (r.finished ? r.finishTime : MAX_RACE_S) / median]);
      world.destroy();
    }
    expect(rel.size).toBe(RACER_POOL.length);
    for (const [, xs] of rel) {
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      expect(mean).toBeGreaterThan(0.94);
      expect(mean).toBeLessThan(1.06);
    }
  }, 120_000);

  it("slips a runner who steps on a banana", () => {
    const rng = new Rng(5);
    const world = new DerbyWorld(draftRacers(rng), rng, { events: false });
    world.patches.push({ kind: "banana", lane: 0, x: 240, w: 18, used: false });
    const runner = world.runners[0]!;
    let fell = false;
    for (let i = 0; i < 60 * 3 && !fell; i += 1) {
      world.step();
      fell = runner.mode === "fallen";
    }
    expect(fell).toBe(true);
    expect(world.patches.at(-1)!.used).toBe(true);
    world.destroy();
  });

  it("builds a track full of junk between start and finish", () => {
    const rng = new Rng(8);
    const world = new DerbyWorld(draftRacers(rng), rng, { events: false });
    expect(world.items.some((i) => i.kind === "hurdle")).toBe(true);
    expect(world.hills.length).toBeGreaterThan(0);
    for (const item of world.items) {
      expect(item.body.position.x).toBeGreaterThan(300);
      expect(item.body.position.x).toBeLessThan(FINISH_X);
    }
    world.destroy();
  });
});

describe("chaos derby betting", () => {
  const runner = (lane: number, place: number, x = 0): Pick<Runner, "lane" | "finished" | "place" | "x"> => ({
    lane,
    finished: place > 0,
    place,
    x,
  });

  it("ranks finishers by place, then the rest by distance", () => {
    const order = placings([runner(0, 0, 500), runner(1, 2), runner(2, 0, 900), runner(3, 1)]);
    expect(order.map((r) => r.lane)).toEqual([3, 1, 2, 0]);
  });

  it("pays the winner's backers most, ties players on the same runner, and lists who called it", () => {
    const order = placings([0, 1, 2, 3, 4, 5].map((lane) => runner(lane, 6 - lane)));
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

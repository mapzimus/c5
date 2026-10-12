import { describe, expect, it } from "vitest";
import { Rng } from "../../core/rng";
import {
  BELL_AT,
  FINAL_STRETCH_AT,
  HEDGE_WINDOW_S,
  MAIN_MULT,
  botCheerRate,
  botHedgeDelay,
  botHedgePick,
  cheerBox,
  cheerSeconds,
  chipBoxes,
  decisiveIncident,
  describeIncident,
  hedgeOptions,
  inBox,
  isUnderdogCheer,
  panelLayout,
  pickPoints,
  placePoints,
  scorePicks,
  traitsOf,
  type Incident,
} from "./logic";
import { STAT_RANGE, jitterStats, rollStats, type Placeable, type RacerStats } from "./rules";

const placed = (lane: number, place: number): Placeable => ({ lane, finished: place > 0, place, x: 0 });
/** Finishing order lane 5 first, lane 0 last. */
const ORDER = [5, 4, 3, 2, 1, 0].map((lane, i) => placed(lane, i + 1));

describe("traits", () => {
  const mid = (): RacerStats => {
    const s = {} as RacerStats;
    for (const key of Object.keys(STAT_RANGE) as (keyof RacerStats)[]) s[key] = (STAT_RANGE[key][0] + STAT_RANGE[key][1]) / 2;
    return s;
  };

  it("names the two most pronounced tendencies, good or bad", () => {
    const quickButClumsy = { ...mid(), topSpeed: STAT_RANGE.topSpeed[1], jumpSkill: STAT_RANGE.jumpSkill[0] };
    const traits = traitsOf(quickButClumsy);
    expect(traits.map((t) => t.label).sort()).toEqual(["QUICK", "TRIPS A LOT"]);
    expect(traits.find((t) => t.label === "QUICK")!.good).toBe(true);
    expect(traits.find((t) => t.label === "TRIPS A LOT")!.good).toBe(false);
  });

  it("reads 'gets up slowly' as bad and 'big engine' as good", () => {
    const sleepy = { ...mid(), getUp: STAT_RANGE.getUp[1], fatigue: STAT_RANGE.fatigue[0] };
    const labels = traitsOf(sleepy);
    expect(labels.find((t) => t.label === "LIES THERE")!.good).toBe(false);
    expect(labels.find((t) => t.label === "BIG ENGINE")!.good).toBe(true);
  });

  it("always returns two traits for any roll, and jittered stats stay in range", () => {
    const rng = new Rng(7);
    for (let i = 0; i < 50; i += 1) {
      const stats = rollStats(rng);
      expect(traitsOf(stats)).toHaveLength(2);
      const next = jitterStats(stats, rng);
      for (const key of Object.keys(STAT_RANGE) as (keyof RacerStats)[]) {
        expect(next[key]).toBeGreaterThanOrEqual(STAT_RANGE[key][0]);
        expect(next[key]).toBeLessThanOrEqual(STAT_RANGE[key][1]);
        expect(Math.abs(next[key] - stats[key])).toBeLessThanOrEqual(0.12 * (STAT_RANGE[key][1] - STAT_RANGE[key][0]) + 1e-9);
      }
    }
  });
});

describe("picks and scoring", () => {
  it("pays the main pick double and the hedge single, by place", () => {
    expect(placePoints(ORDER, 5)).toBe(6);
    expect(placePoints(ORDER, 0)).toBe(1);
    expect(placePoints(ORDER, 9)).toBe(0);
    expect(pickPoints(ORDER, { main: 5, hedge: null })).toEqual({ main: 12, hedge: 0, total: 12 });
    expect(pickPoints(ORDER, { main: 4, hedge: 5 })).toEqual({ main: 10, hedge: 6, total: 16 });
    expect(MAIN_MULT).toBe(2);
  });

  it("splits two players on the same runner by their hedge", () => {
    const scores = scorePicks(
      ORDER,
      new Map([
        ["gale", { main: 3, hedge: 5 }],
        ["surge", { main: 3, hedge: 0 }],
        ["squall", { main: 3, hedge: null }],
      ]),
    );
    expect(scores.get("gale")).toBe(8 + 6);
    expect(scores.get("surge")).toBe(8 + 1);
    expect(scores.get("squall")).toBe(8);
  });

  it("never lets you hedge on your own runner", () => {
    expect(hedgeOptions(2)).toEqual([0, 1, 3, 4, 5]);
    expect(hedgeOptions(0, 4)).toEqual([1, 2, 3]);
  });

  it("rings the bell at halfway and opens the final stretch in the last quarter", () => {
    expect(BELL_AT).toBe(0.5);
    expect(FINAL_STRETCH_AT).toBeGreaterThan(BELL_AT);
    expect(HEDGE_WINDOW_S).toBeGreaterThanOrEqual(4);
  });
});

describe("cheering", () => {
  it("gives the crowd more to shout about the further back the runner is", () => {
    expect(cheerSeconds(0, 6)).toBeCloseTo(2.2);
    expect(cheerSeconds(5, 6)).toBeCloseTo(4.7);
    expect(cheerSeconds(2, 6)).toBeGreaterThan(cheerSeconds(1, 6));
    expect(cheerSeconds(0, 1)).toBeCloseTo(2.2);
    expect(isUnderdogCheer(5, 6)).toBe(true);
    expect(isUnderdogCheer(4, 6)).toBe(true);
    expect(isUnderdogCheer(3, 6)).toBe(false);
  });

  it("bots wake a runner who has been down a while, otherwise save the cheer for the end", () => {
    const base = { down: false, downFor: 0, position: 3, field: 6, leaderProgress: 0.5, windowOpen: false };
    expect(botCheerRate({ ...base, down: true, downFor: 1.5 })).toBeGreaterThan(1);
    expect(botCheerRate({ ...base, down: true, downFor: 0.4 })).toBeLessThan(0.1);
    expect(botCheerRate({ ...base, down: true, downFor: 3, leaderProgress: 0.1 })).toBe(0);
    expect(botCheerRate({ ...base, leaderProgress: 0.9 })).toBeGreaterThan(1);
    expect(botCheerRate({ ...base, leaderProgress: 0.75, position: 1 })).toBeGreaterThan(0.5);
    expect(botCheerRate({ ...base, leaderProgress: 0.75, position: 4 })).toBeLessThan(0.1);
    expect(botCheerRate({ ...base, leaderProgress: 0.1 })).toBe(0);
    expect(botCheerRate({ ...base, down: true, downFor: 3, windowOpen: true })).toBe(0);
  });

  it("bots hedge on the front of the field, never on themselves, and sometimes dither", () => {
    const rng = new Rng(11);
    const counts = new Map<number, number>();
    let skipped = 0;
    for (let i = 0; i < 400; i += 1) {
      const pick = botHedgePick([4, 2, 0, 1, 3, 5], 4, rng);
      expect(pick).not.toBe(4);
      counts.set(pick!, (counts.get(pick!) ?? 0) + 1);
      const delay = botHedgeDelay(rng);
      if (delay === null) skipped += 1;
      else expect(delay).toBeGreaterThan(0.5);
    }
    expect(counts.get(2)!).toBeGreaterThan(counts.get(5)!);
    expect(counts.get(2)!).toBeGreaterThan(counts.get(3)!);
    expect(skipped).toBeGreaterThan(10);
    expect(skipped).toBeLessThan(120);
    expect(botHedgePick([2], 2, rng)).toBeNull();
  });
});

describe("recap", () => {
  const log: Incident[] = [
    { t: 5, lane: 1, kind: "trip", severity: 1, position: 0 },
    { t: 20, lane: 2, kind: "anvil", severity: 2, position: 0 },
    { t: 28, lane: 3, kind: "nap", severity: 2, position: 0 },
    { t: 30, lane: 4, kind: "banana", severity: 1, position: 1 },
    { t: 33, lane: 0, kind: "lightning", severity: 2, position: 3 },
  ];

  it("picks the worst thing that happened to a leader, latest on a tie", () => {
    const d = decisiveIncident(log, 5)!;
    expect(d.lane).toBe(3);
    expect(describeIncident(d, "Kevin")).toBe("Kevin fell asleep while leading at 28s");
  });

  it("ignores what happened to the winner, falls back to second place, else has nothing to say", () => {
    expect(decisiveIncident(log, 3)!.lane).toBe(2);
    const second = decisiveIncident([log[3]!, log[4]!], 5)!;
    expect(second.lane).toBe(4);
    expect(describeIncident(second, "Boo")).toContain("in second");
    expect(decisiveIncident([log[4]!], 5)).toBeNull();
    expect(decisiveIncident([], 0)).toBeNull();
  });
});

describe("layout", () => {
  it("fits four panels across the screen with tap-sized buttons and chips", () => {
    for (const seats of [2, 3, 4]) {
      for (const minTap of [44, 70]) {
        const panels = panelLayout(seats, 1280, minTap);
        expect(panels).toHaveLength(seats);
        expect(panels[0]!.x).toBeGreaterThanOrEqual(20);
        expect(panels[seats - 1]!.x + panels[seats - 1]!.w).toBeLessThanOrEqual(1260);
        for (let i = 1; i < seats; i += 1) expect(panels[i]!.x).toBeGreaterThan(panels[i - 1]!.x + panels[i - 1]!.w);
        for (const panel of panels) {
          const cheer = cheerBox(panel, minTap);
          expect(cheer.w).toBeGreaterThanOrEqual(minTap);
          expect(cheer.h).toBeGreaterThanOrEqual(minTap);
          expect(inBox(cheer.x + cheer.w / 2, cheer.y + cheer.h / 2, panel)).toBe(true);
          const chips = chipBoxes(panel, hedgeOptions(1), minTap);
          expect(chips).toHaveLength(5);
          for (const { box } of chips) {
            expect(box.w).toBeGreaterThanOrEqual(minTap);
            expect(box.x).toBeGreaterThanOrEqual(panel.x - 1);
            expect(box.x + box.w).toBeLessThanOrEqual(panel.x + panel.w + 1);
            expect(box.y).toBeGreaterThan(panel.y + panel.h);
          }
          expect(chips[3]!.box.y).toBeGreaterThan(chips[0]!.box.y);
        }
      }
    }
  });
});

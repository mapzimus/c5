import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { slotCars } from "./slot-cars";
import {
  botThrottle, buildTrack, danger, LAPS_TO_WIN, lanePos, minLimitAhead, newBotSkill, newCar, onPad, ordinal,
  pointsForPlace, rollBotNoise, SPIN_S, standings, stepCar, trackAt, TRACK_SHAPES, TURBO_BOOST, VMAX,
} from "./logic";

const track = (shape: (typeof TRACK_SHAPES)[number]) => buildTrack(shape, 640, 390, 1, 4);

describe("slot cars track", () => {
  it("builds every shape as a closed loop that fits the arena and never crosses itself", () => {
    for (const shape of TRACK_SHAPES) {
      const t = track(shape);
      const n = t.pts.length;
      expect(t.length).toBeGreaterThan(2000);
      for (const p of t.pts) {
        expect(p.x).toBeGreaterThan(100);
        expect(p.x).toBeLessThan(1180);
        expect(p.y).toBeGreaterThan(100);
        expect(p.y).toBeLessThan(700);
        expect(p.limit).toBeGreaterThan(150);
        expect(p.limit).toBeLessThanOrEqual(VMAX);
      }
      // Points far apart along the loop must be far apart in space (room for the road).
      const gap = Math.floor(n / 8);
      for (let i = 0; i < n; i += 3) {
        for (let j = i + gap; j < Math.min(n, i + n - gap); j += 3) {
          const d = Math.hypot(t.pts[i]!.x - t.pts[j]!.x, t.pts[i]!.y - t.pts[j]!.y);
          expect(d).toBeGreaterThan(t.roadWidth);
        }
      }
      // The pad sits on a straight away from the start line.
      expect(trackAt(t, (t.padStart + t.padEnd) / 2).limit).toBe(VMAX);
      const padMid = (t.padStart + t.padEnd) / 2;
      expect(padMid).toBeGreaterThan(t.length * 0.14);
      expect(padMid).toBeLessThan(t.length * 0.86);
      expect(onPad(t, (t.padStart + t.padEnd) / 2)).toBe(true);
      expect(onPad(t, 0)).toBe(false);
    }
  });

  it("wraps arc length and offsets lanes sideways", () => {
    const t = track("oval");
    const a = trackAt(t, 10);
    const b = trackAt(t, 10 + t.length);
    expect(a.x).toBeCloseTo(b.x, 3);
    expect(a.y).toBeCloseTo(b.y, 3);
    expect(t.laneOffsets).toHaveLength(4);
    const outer = lanePos(t, t.laneOffsets[0]!, 10);
    const inner = lanePos(t, t.laneOffsets[3]!, 10);
    expect(Math.hypot(outer.x - inner.x, outer.y - inner.y)).toBeCloseTo(t.laneOffsets[3]! - t.laneOffsets[0]!, 1);
  });

  it("has a tighter minimum limit on the hairpin than the oval", () => {
    const lim = (shape: (typeof TRACK_SHAPES)[number]) => Math.min(...track(shape).pts.map((p) => p.limit));
    expect(lim("hairpin")).toBeLessThan(lim("oval"));
  });
});

describe("slot cars rules", () => {
  it("accelerates while held, coasts when released and spins out over the limit", () => {
    const t = track("hairpin");
    const car = newCar();
    car.throttle = true;
    for (let i = 0; i < 60; i++) stepCar(car, t, 1 / 60, i / 60);
    expect(car.v).toBeGreaterThan(200);
    car.throttle = false;
    const v = car.v;
    stepCar(car, t, 1 / 60, 1);
    expect(car.v).toBeLessThan(v);

    // Teleport to the tightest bend at full speed.
    let tight = 0;
    t.pts.forEach((p, i) => { if (p.limit < t.pts[tight]!.limit) tight = i; });
    car.s = (tight / t.pts.length) * t.length;
    car.v = VMAX;
    expect(danger(car, t)).toBeGreaterThan(1);
    const events = stepCar(car, t, 1 / 60, 2);
    expect(events).toContain("spin");
    expect(car.spin).toBeCloseTo(SPIN_S, 5);
    expect(car.spinouts).toBe(1);
    expect(car.v).toBe(0);
    // Stays put while spinning, then resumes slowly.
    const s = car.s;
    stepCar(car, t, 0.5, 2.5);
    expect(car.s).toBe(s);
    stepCar(car, t, 1, 3.5);
    expect(car.spin).toBe(0);
    expect(car.v).toBeGreaterThan(0);
    expect(car.v).toBeLessThan(200);
  });

  it("boosts once per pad pass at full throttle and never spins on the straight", () => {
    const t = track("oval");
    const car = newCar();
    car.s = t.padStart - 1;
    car.v = VMAX;
    car.throttle = false;
    expect(stepCar(car, t, 1 / 60, 0)).not.toContain("turbo");
    car.throttle = true;
    car.v = VMAX;
    const ev = stepCar(car, t, 1 / 60, 0);
    expect(ev).toContain("turbo");
    expect(ev).not.toContain("spin");
    expect(car.v).toBeGreaterThan(VMAX);
    expect(car.v).toBeLessThanOrEqual(VMAX + TURBO_BOOST);
    expect(stepCar(car, t, 1 / 60, 0)).not.toContain("turbo");
  });

  it("counts laps, records the best lap and finishes after 3", () => {
    const t = track("oval");
    const car = newCar();
    car.s = t.length - 5;
    car.v = 300;
    car.throttle = false;
    let events = stepCar(car, t, 0.05, 10);
    expect(events).toContain("lap");
    expect(car.lap).toBe(1);
    expect(car.bestLap).toBeCloseTo(10, 5);
    car.s = t.length - 5;
    events = stepCar(car, t, 0.05, 16);
    expect(car.bestLap).toBeCloseTo(6, 5);
    car.s = t.length - 5;
    events = stepCar(car, t, 0.05, 30);
    expect(car.lap).toBe(LAPS_TO_WIN);
    expect(events).toContain("finish");
    expect(car.finished).toBe(true);
  });

  it("orders finished cars by place and the rest by progress", () => {
    const t = track("kidney");
    const a = newCar();
    const b = newCar();
    const c = newCar();
    b.finished = true;
    b.place = 1;
    a.lap = 1;
    a.s = 100;
    c.lap = 0;
    c.s = t.length - 10;
    expect(standings([a, b, c], t)).toEqual([1, 0, 2]);
    expect(pointsForPlace(1)).toBeGreaterThan(pointsForPlace(2));
    expect(pointsForPlace(0)).toBe(0);
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
  });

  it("bots floor it on straights and lift before a bend they're too fast for", () => {
    const skill = { margin: 0.9, noise: 0, lateBrake: false };
    const car = newCar();
    const oval = track("oval");
    car.s = oval.padStart;
    car.v = VMAX;
    expect(botThrottle(car, oval, skill)).toBe(true);
    const t = track("hairpin");
    let tight = 0;
    t.pts.forEach((p, i) => { if (p.limit < t.pts[tight]!.limit) tight = i; });
    car.s = (tight / t.pts.length) * t.length - 120;
    car.v = VMAX;
    expect(minLimitAhead(t, car.s, car.v * 0.5 + 40)).toBeLessThan(VMAX);
    expect(botThrottle(car, t, skill)).toBe(false);
    car.v = 100;
    expect(botThrottle(car, t, skill)).toBe(true);
  });

  it("bots finish every track and spin out now and then", () => {
    let spins = 0;
    for (const shape of TRACK_SHAPES) {
      const t = track(shape);
      for (let seed = 1; seed <= 6; seed++) {
        const rng = new Rng(seed);
        const car = newCar();
        const skill = newBotSkill(rng);
        let time = 0;
        let roll = 0;
        while (!car.finished && time < 90) {
          roll += 1 / 60;
          if (roll >= 0.3) {
            roll = 0;
            rollBotNoise(skill, rng);
          }
          car.throttle = botThrottle(car, t, skill);
          stepCar(car, t, 1 / 60, time);
          time += 1 / 60;
        }
        expect(car.finished).toBe(true);
        expect(time).toBeLessThan(60);
        spins += car.spinouts;
      }
    }
    expect(spins).toBeGreaterThan(0);
  });
});

describe("slot cars game", () => {
  const makeCtx = (seed: number, kinds: ("human" | "bot")[]) => {
    const listeners: Record<string, (e: unknown) => void> = {};
    const canvas = {
      style: {},
      addEventListener: vi.fn((name: string, fn: (e: unknown) => void) => { listeners[name] = fn; }),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    };
    const ctx = {
      width: 1280, height: 720, rng: new Rng(seed), minTap: 44,
      players: kinds.map((kind, slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind, slot })),
      canvas,
      input: { justPressed: () => false },
      sfx: new Proxy({}, { get: () => vi.fn() }),
    } as never;
    return { ctx, listeners };
  };

  it("an all-bot grid races to the end and hands out place points", () => {
    for (const seed of [3, 11, 27]) {
      const { ctx } = makeCtx(seed, ["bot", "bot", "bot", "bot"]);
      const game = slotCars.create(ctx);
      for (let f = 0; f < 60 * 120 && !game.isFinished(); f++) game.update(1 / 60);
      expect(game.isFinished()).toBe(true);
      const scores = game.getScores().map((s) => s.score).sort((a, b) => b - a);
      expect(scores).toEqual([5, 3, 2, 1]);
      const stats = game.getStats?.() ?? [];
      expect(stats.some((s) => s.label === "Best lap" && s.value !== "-")).toBe(true);
      game.destroy();
    }
  });

  it("a human who never touches the screen is placed last after the grace period", () => {
    const { ctx, listeners } = makeCtx(5, ["human", "bot"]);
    const game = slotCars.create(ctx);
    expect(listeners["pointerdown"]).toBeDefined();
    for (let f = 0; f < 60 * 120 && !game.isFinished(); f++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    const scores = game.getScores();
    expect(scores[0]!.score).toBe(3);
    expect(scores[1]!.score).toBe(5);
    game.destroy();
  });

  it("holding a zone drives that seat's car", () => {
    const { ctx, listeners } = makeCtx(8, ["human", "human"]);
    const game = slotCars.create(ctx);
    // Hold the left zone (seat 0) only.
    listeners["pointerdown"]!({ pointerId: 1, clientX: 200, clientY: 400, preventDefault: () => {} });
    for (let f = 0; f < 60 * 6; f++) game.update(1 / 60);
    const stats = game.getStats?.() ?? [];
    // Seat 0 has moved: it either spun out or is still driving; seat 1 hasn't moved at all.
    const g = game as unknown as { seats: { car: { s: number; v: number; throttle: boolean } }[] };
    expect(g.seats[0]!.car.s + g.seats[0]!.car.v).toBeGreaterThan(0);
    expect(g.seats[1]!.car.s).toBe(0);
    listeners["pointerup"]!({ pointerId: 1 });
    for (let f = 0; f < 60 * 3; f++) game.update(1 / 60);
    expect(g.seats[0]!.car.throttle).toBe(false);
    expect(stats.length).toBe(4);
    game.destroy();
  });
});

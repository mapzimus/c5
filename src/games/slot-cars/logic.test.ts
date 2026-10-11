import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { slotCars } from "./slot-cars";
import {
  botHop, botThrottle, botWantsOil, buildTrack, CAR_LEN, danger, dropOil, hopCar, laneCountFor, lanePos, lapFromScore,
  lapScore, lapsToWin, limitAt, minLimitAhead, NEAR_MISS, newBotSkill, newCar, newRace, occupied, OIL_GRIP, OIL_LIFE_S, onPad,
  ordinal, pointsForPlace, rollBotNoise, SPIN_S, standings, startLane, stepRace, trackAt, TRACK_SHAPES, TURBO_BOOST,
  VMAX, wrapDist, type Car, type Race, type TrackShape,
} from "./logic";

const track = (shape: TrackShape, lanes = 4) => buildTrack(shape, 640, 390, 1, lanes);
const race = (shape: TrackShape, cars: Car[], lanes = 4): Race => newRace(track(shape, lanes), cars);
/** Centerline index of the tightest bend. */
const tightest = (t: ReturnType<typeof track>): number => {
  let tight = 0;
  t.pts.forEach((p, i) => { if (p.limit < t.pts[tight]!.limit) tight = i; });
  return (tight / t.pts.length) * t.length;
};
/** Drive one bot car alone until it finishes; returns the race time. */
const soloBot = (r: Race, seed: number, maxS = 120): number => {
  const rng = new Rng(seed);
  const skill = newBotSkill(rng);
  let roll = 0;
  while (!r.cars[0]!.finished && r.time < maxS) {
    roll += 1 / 60;
    if (roll >= 0.3) {
      roll = 0;
      rollBotNoise(skill, rng);
      const dir = botHop(r, 0, skill);
      if (dir !== 0) hopCar(r, 0, dir);
    }
    r.cars[0]!.throttle = botThrottle(r, 0, skill);
    stepRace(r, 1 / 60);
  }
  return r.time;
};

describe("slot hop track", () => {
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
      let closest = Infinity;
      for (let i = 0; i < n; i += 3) {
        for (let j = i + gap; j < Math.min(n, i + n - gap); j += 3) {
          closest = Math.min(closest, Math.hypot(t.pts[i]!.x - t.pts[j]!.x, t.pts[i]!.y - t.pts[j]!.y));
        }
      }
      expect(closest).toBeGreaterThan(t.roadWidth);
      // The pad sits on a straight away from the start line.
      expect(trackAt(t, (t.padStart + t.padEnd) / 2).limit).toBe(VMAX);
      const padMid = (t.padStart + t.padEnd) / 2;
      expect(padMid).toBeGreaterThan(t.length * 0.14);
      expect(padMid).toBeLessThan(t.length * 0.86);
      expect(onPad(t, padMid)).toBe(true);
      expect(onPad(t, 0)).toBe(false);
    }
  });

  it("sorts slots shortest first, and each bend has a tight side and a wide side", () => {
    for (const shape of TRACK_SHAPES) {
      const t = track(shape);
      expect(t.laneCount).toBe(4);
      for (let l = 1; l < t.laneCount; l++) expect(t.laneLengths[l]!).toBeGreaterThan(t.laneLengths[l - 1]!);
      // A full loop turns 2*pi, so neighbouring slots differ by about 2*pi*LANE_GAP.
      expect(t.laneLengths[1]! - t.laneLengths[0]!).toBeCloseTo(Math.PI * 2 * 24, -1);
      const s = tightest(t);
      const lims = [0, 1, 2, 3].map((l) => limitAt(t, [], s, l).limit);
      const dir = Math.sign(lims[3]! - lims[0]!);
      expect(dir).not.toBe(0);
      for (let l = 1; l < 4; l++) expect(Math.sign(lims[l]! - lims[l - 1]!)).toBe(dir);
      expect(Math.min(...lims)).toBeGreaterThan(60);
      expect(Math.max(...lims) - Math.min(...lims)).toBeGreaterThan(40);
    }
    // On the oval every bend turns with the loop, so the short slot is the tight one.
    const oval = track("oval");
    expect(limitAt(oval, [], tightest(oval), 0).limit).toBeLessThan(limitAt(oval, [], tightest(oval), 3).limit);
  });

  it("wraps arc length, offsets slots sideways and measures wrapped distances", () => {
    const t = track("oval");
    const a = trackAt(t, 10);
    const b = trackAt(t, 10 + t.length);
    expect(a.x).toBeCloseTo(b.x, 3);
    expect(a.y).toBeCloseTo(b.y, 3);
    expect(t.laneOffsets).toHaveLength(4);
    const outer = lanePos(t, t.laneOffsets[0]!, 10);
    const inner = lanePos(t, t.laneOffsets[3]!, 10);
    expect(Math.hypot(outer.x - inner.x, outer.y - inner.y)).toBeCloseTo(Math.abs(t.laneOffsets[3]! - t.laneOffsets[0]!), 1);
    expect(wrapDist(t, 10, 30)).toBeCloseTo(20, 5);
    expect(wrapDist(t, 10, t.length - 10)).toBeCloseTo(-20, 5);
    expect(laneCountFor(2)).toBe(3);
    expect(laneCountFor(4)).toBe(4);
    expect([startLane(0, 2, 3), startLane(1, 2, 3)]).toEqual([0, 2]);
    expect([0, 1, 2, 3].map((i) => startLane(i, 4, 4))).toEqual([0, 1, 2, 3]);
    expect(lapsToWin("oval")).toBe(6);
    expect(lapsToWin("hairpin")).toBe(4);
  });
});

describe("slot hop rules", () => {
  it("accelerates while held, coasts when released and spins out over the limit", () => {
    const r = race("hairpin", [newCar(2)]);
    const t = r.track;
    const car = r.cars[0]!;
    car.throttle = true;
    for (let i = 0; i < 60; i++) stepRace(r, 1 / 60);
    expect(car.v).toBeGreaterThan(200);
    car.throttle = false;
    const v = car.v;
    stepRace(r, 1 / 60);
    expect(car.v).toBeLessThan(v);

    // Teleport to the tightest bend at full speed.
    car.s = tightest(t);
    car.v = VMAX;
    expect(danger(r, 0)).toBeGreaterThan(1);
    const events = stepRace(r, 1 / 60);
    expect(events.map((e) => e.type)).toContain("spin");
    expect(car.spin).toBeCloseTo(SPIN_S, 5);
    expect(car.spinouts).toBe(1);
    expect(car.v).toBe(0);
    // Stays put while spinning, then resumes slowly.
    const s = car.s;
    stepRace(r, 0.5);
    expect(car.s).toBe(s);
    stepRace(r, 1);
    expect(car.spin).toBe(0);
    expect(car.v).toBeGreaterThan(0);
    expect(car.v).toBeLessThan(200);
  });

  it("boosts once per pad pass at full throttle and never spins on the straight", () => {
    const r = race("oval", [newCar(1)]);
    const t = r.track;
    const car = r.cars[0]!;
    car.s = t.padStart - 1;
    car.v = VMAX;
    car.throttle = false;
    expect(stepRace(r, 1 / 60).map((e) => e.type)).not.toContain("turbo");
    car.throttle = true;
    car.v = VMAX;
    const ev = stepRace(r, 1 / 60).map((e) => e.type);
    expect(ev).toContain("turbo");
    expect(ev).not.toContain("spin");
    expect(car.v).toBeGreaterThan(VMAX);
    expect(car.v).toBeLessThanOrEqual(VMAX + TURBO_BOOST);
    expect(stepRace(r, 1 / 60).map((e) => e.type)).not.toContain("turbo");
    // Turbo on a straight never reads as danger.
    expect(danger(r, 0)).toBeLessThanOrEqual(0.5);
  });

  it("the inside slot gains progress faster for the same speed", () => {
    const t = track("oval");
    const s = tightest(t);
    const inner = newCar(0);
    const outer = newCar(3);
    inner.s = s;
    outer.s = s;
    inner.v = 150;
    outer.v = 150;
    inner.throttle = true;
    outer.throttle = true;
    const r = newRace(t, [inner, outer]);
    stepRace(r, 0.1);
    expect(inner.s - s).toBeGreaterThan((outer.s - s) * 1.3);
    expect(inner.s - s).toBeGreaterThan(15);
  });

  it("hops one slot in or out with a cooldown, and refuses when the slot is taken", () => {
    const r = race("oval", [newCar(1), newCar(2)]);
    const [a, b] = r.cars as [Car, Car];
    a.s = 500;
    b.s = 500 + CAR_LEN;
    expect(hopCar(r, 0, 1)).toBe("noroom");
    stepRace(r, 0.3);
    b.s = 900;
    expect(hopCar(r, 0, 1)).toBe("hop");
    expect(a.lane).toBe(2);
    expect(a.laneFrom).toBe(1);
    expect(a.hopT).toBeGreaterThan(0);
    expect(a.hops).toBe(1);
    expect(hopCar(r, 0, 1)).toBeNull();
    stepRace(r, 0.5);
    expect(a.hopT).toBe(0);
    expect(hopCar(r, 0, 1)).toBe("hop");
    expect(a.lane).toBe(3);
    stepRace(r, 0.5);
    expect(hopCar(r, 0, 1)).toBeNull();
    expect(a.lane).toBe(3);
    expect(occupied(r, 3, a.s, CAR_LEN, 0)).toBe(-1);
    expect(occupied(r, 3, a.s, CAR_LEN)).toBe(0);
  });

  it("hopping into the tighter slot mid-bend spins you; the wider one holds", () => {
    const t = track("hairpin");
    const s = tightest(t);
    const wide = limitAt(t, [], s, 1).limit > limitAt(t, [], s, 2).limit ? 1 : 2;
    const tight = wide === 1 ? 2 : 1;
    const r = newRace(t, [newCar(wide)]);
    const car = r.cars[0]!;
    car.s = s;
    car.v = (limitAt(t, [], s, wide).limit + limitAt(t, [], s, tight).limit) / 2;
    car.throttle = true;
    expect(stepRace(r, 1 / 60).map((e) => e.type)).not.toContain("spin");
    expect(hopCar(r, 0, tight > wide ? 1 : -1)).toBe("hop");
    expect(car.lane).toBe(tight);
    expect(stepRace(r, 1 / 60).map((e) => e.type)).toContain("spin");
  });

  it("cars in one slot can't pass: the one behind is held and shunts the one in front", () => {
    const r = race("oval", [newCar(1), newCar(1)]);
    const [back, front] = r.cars as [Car, Car];
    const s0 = r.track.padStart + 20;
    front.s = s0 + CAR_LEN + 2;
    front.v = 120;
    back.s = s0;
    back.v = 380;
    const types = stepRace(r, 1 / 60).map((e) => e.type);
    expect(types).toContain("bump");
    expect(wrapDist(r.track, back.s, front.s)).toBeCloseTo(CAR_LEN, 3);
    expect(front.v).toBeGreaterThan(120);
    expect(back.v).toBeLessThan(380);
    expect(front.v).toBeGreaterThan(back.v);
    // Only one bump event per contact burst.
    const again = stepRace(r, 1 / 60).map((e) => e.type);
    expect(again).not.toContain("bump");
  });

  it("marshals drop oil that cuts the limit, and oil wears off", () => {
    const r = race("oval", [newCar(0), newCar(1)]);
    const ghost = r.cars[0]!;
    const racer = r.cars[1]!;
    expect(dropOil(r, 0)).toBe(false);
    ghost.finished = true;
    ghost.s = r.track.padStart;
    expect(dropOil(r, 0)).toBe(true);
    expect(dropOil(r, 0)).toBe(false);
    expect(r.oils).toHaveLength(1);
    const { limit, straight } = limitAt(r.track, r.oils, ghost.s, 1);
    expect(limit).toBeCloseTo(VMAX * OIL_GRIP, 3);
    expect(straight).toBe(false);
    // A racer flat out through the oil spins even on a straight.
    racer.s = ghost.s - 5;
    racer.v = VMAX;
    expect(stepRace(r, 1 / 60).map((e) => e.type)).toContain("spin");
    stepRace(r, OIL_LIFE_S + 0.1);
    expect(r.oils).toHaveLength(0);
    // Bot marshals aim at an approaching car.
    ghost.oilCd = 0;
    racer.spin = 0;
    racer.s = ghost.s - 200;
    racer.v = 300;
    expect(botWantsOil(r, 0)).toBe(true);
    racer.s = ghost.s + 50;
    expect(botWantsOil(r, 0)).toBe(false);
  });

  it("counts laps, clean laps, near misses, records the best lap and finishes", () => {
    const r = race("hairpin", [newCar(2)]);
    const t = r.track;
    const car = r.cars[0]!;
    car.s = t.length - 5;
    car.v = 300;
    car.throttle = false;
    r.time = 10;
    let events = stepRace(r, 0.05).map((e) => e.type);
    expect(events).toContain("lap");
    expect(events).toContain("cleanlap");
    expect(car.lap).toBe(1);
    expect(car.cleanLaps).toBe(1);
    expect(car.bestLap).toBeCloseTo(10.05, 5);
    car.spunThisLap = true;
    car.s = t.length - 5;
    r.time = 16;
    events = stepRace(r, 0.05).map((e) => e.type);
    expect(events).not.toContain("cleanlap");
    expect(car.cleanLaps).toBe(0);
    expect(car.bestLap).toBeCloseTo(6, 5);
    expect(r.overdrive).toBe(false);
    // Starting the final lap triggers overdrive for everyone.
    car.s = t.length - 5;
    events = stepRace(r, 0.05).map((e) => e.type);
    expect(r.overdrive).toBe(true);
    expect(events).toContain("overdrive");
    car.s = t.length - 5;
    events = stepRace(r, 0.05).map((e) => e.type);
    expect(car.lap).toBe(lapsToWin("hairpin"));
    expect(events).toContain("finish");
    expect(car.finished).toBe(true);

    // Near miss: peak at 97% of the limit in the bend, then back off.
    const r2 = race("hairpin", [newCar(2)]);
    const c2 = r2.cars[0]!;
    c2.s = tightest(r2.track);
    c2.v = limitAt(r2.track, [], c2.s, 2).limit * 0.998;
    c2.throttle = false;
    expect(stepRace(r2, 1 / 240).map((e) => e.type)).not.toContain("spin");
    expect(c2.peak).toBeGreaterThanOrEqual(NEAR_MISS);
    c2.v = 50;
    expect(stepRace(r2, 1 / 60).map((e) => e.type)).toContain("nearmiss");
    expect(c2.nearMisses).toBe(1);
    expect(lapFromScore(lapScore(12.3))).toBeCloseTo(12.3, 5);
    expect(lapScore(10)).toBeGreaterThan(lapScore(12));
  });

  it("gives last place catch-up grip only when well behind", () => {
    const r = race("oval", [newCar(0), newCar(2)]);
    const [a, b] = r.cars as [Car, Car];
    a.lap = 1;
    b.lap = 1;
    b.s = 50;
    stepRace(r, 1 / 60);
    expect(a.catchUp).toBe(false);
    expect(b.catchUp).toBe(false);
    a.lap = 2;
    stepRace(r, 1 / 60);
    expect(b.catchUp).toBe(true);
    expect(a.catchUp).toBe(false);
    expect(limitAt(r.track, [], tightest(r.track), 2, { vmax: 1.08, grip: 1.08 }).limit)
      .toBeGreaterThan(limitAt(r.track, [], tightest(r.track), 2).limit);
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
    const skill = { margin: 0.9, noise: 0, lateBrake: false, greed: 0, greedy: false, willSave: false };
    const oval = race("oval", [newCar(1)]);
    const car = oval.cars[0]!;
    car.s = oval.track.padStart;
    car.v = VMAX;
    expect(botThrottle(oval, 0, skill)).toBe(true);
    const r = race("hairpin", [newCar(1)]);
    const c = r.cars[0]!;
    c.s = tightest(r.track) - 120;
    c.v = VMAX;
    expect(minLimitAhead(r.track, [], 1, c.s, c.v * 0.5 + 40)).toBeLessThan(VMAX);
    expect(botThrottle(r, 0, skill)).toBe(false);
    c.v = 100;
    expect(botThrottle(r, 0, skill)).toBe(true);
  });

  it("bots hop out from behind a slower car and dive inside on a clear straight", () => {
    const r = race("oval", [newCar(1), newCar(1)]);
    const [me, slow] = r.cars as [Car, Car];
    me.s = r.track.padStart + 20;
    me.v = 380;
    slow.s = me.s + 90;
    slow.v = 150;
    const skill = { margin: 0.93, noise: 0, lateBrake: false, greed: 0, greedy: false, willSave: false };
    expect(botHop(r, 0, skill)).not.toBe(0);
    slow.s = me.s + 1000;
    expect(botHop(r, 0, skill)).toBe(0);
    skill.greedy = true;
    expect(botHop(r, 0, skill)).toBe(-1);
  });

  it("bots finish every track in good time, spin out now and then and hop", () => {
    let spins = 0;
    let hops = 0;
    for (const shape of TRACK_SHAPES) {
      for (let seed = 1; seed <= 6; seed++) {
        const r = race(shape, [newCar(seed % 4)]);
        const time = soloBot(r, seed);
        expect(r.cars[0]!.finished).toBe(true);
        expect(time).toBeLessThan(75);
        spins += r.cars[0]!.spinouts;
        hops += r.cars[0]!.hops;
      }
    }
    expect(spins).toBeGreaterThan(0);
    expect(hops).toBeGreaterThan(0);
  });
});

describe("slot hop game", () => {
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
  type Peek = { race: Race; seats: { pointers: Map<number, unknown> }[] };

  it("an all-bot grid races to the end in party time and hands out place points", () => {
    for (const seed of [3, 11, 27, 42]) {
      const { ctx } = makeCtx(seed, ["bot", "bot", "bot", "bot"]);
      const game = slotCars.create(ctx);
      let frames = 0;
      for (; frames < 60 * 120 && !game.isFinished(); frames++) game.update(1 / 60);
      expect(game.isFinished()).toBe(true);
      expect(frames / 60).toBeGreaterThan(44);
      expect(frames / 60).toBeLessThan(100);
      const scores = game.getScores().map((s) => s.score).sort((a, b) => b - a);
      expect(scores).toEqual([5, 3, 2, 1]);
      const stats = game.getStats?.() ?? [];
      expect(stats.some((s) => s.label === "Best lap" && s.value !== "-")).toBe(true);
      expect((game as unknown as Peek).race.overdrive).toBe(true);
      game.destroy();
    }
  }, 30000);

  it("a human who never touches the screen is placed last after the grace period", () => {
    const { ctx, listeners } = makeCtx(5, ["human", "bot"]);
    const game = slotCars.create(ctx);
    expect(listeners["pointerdown"]).toBeDefined();
    expect((ctx as { canvas: { style: { touchAction?: string } } }).canvas.style.touchAction).toBe("none");
    for (let f = 0; f < 60 * 120 && !game.isFinished(); f++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    const scores = game.getScores();
    expect(scores[0]!.score).toBe(3);
    expect(scores[1]!.score).toBe(5);
    game.destroy();
  });

  it("holding a zone drives that seat's car, a quick tap hops it (top = out, bottom = in)", () => {
    const { ctx, listeners } = makeCtx(8, ["human", "human"]);
    const game = slotCars.create(ctx);
    const g = game as unknown as Peek;
    const [a, b] = g.race.cars as [Car, Car];
    for (let f = 0; f < 60 * 3.5; f++) game.update(1 / 60); // through the intro
    // Hold the left zone (seat 0) only.
    listeners["pointerdown"]!({ pointerId: 1, clientX: 200, clientY: 400, preventDefault: () => {} });
    for (let f = 0; f < 60 * 2; f++) game.update(1 / 60);
    expect(a.s + a.v).toBeGreaterThan(0);
    expect(b.s).toBe(0);
    listeners["pointerup"]!({ pointerId: 1 });
    for (let f = 0; f < 60 * 1; f++) game.update(1 / 60);
    expect(a.throttle).toBe(false);
    expect(a.hops).toBe(0);
    // Quick tap in the bottom half of the right zone: seat 1 hops in (from the outer slot 2 to 1).
    expect(b.lane).toBe(2);
    listeners["pointerdown"]!({ pointerId: 2, clientX: 900, clientY: 600, preventDefault: () => {} });
    game.update(1 / 60);
    listeners["pointerup"]!({ pointerId: 2 });
    expect(b.lane).toBe(1);
    expect(b.hops).toBe(1);
    for (let f = 0; f < 60; f++) game.update(1 / 60);
    // Quick tap in the top half: hops back out.
    listeners["pointerdown"]!({ pointerId: 3, clientX: 900, clientY: 100, preventDefault: () => {} });
    game.update(1 / 60);
    listeners["pointerup"]!({ pointerId: 3 });
    expect(b.lane).toBe(2);
    expect(g.seats[1]!.pointers.size).toBe(0);
    expect((game.getStats?.() ?? []).length).toBe(6);
    game.destroy();
  });

  it("a finished human taps to drop oil", () => {
    const { ctx, listeners } = makeCtx(9, ["human", "bot"]);
    const game = slotCars.create(ctx);
    const g = game as unknown as Peek;
    for (let f = 0; f < 60 * 3.5; f++) game.update(1 / 60);
    g.race.cars[0]!.finished = true;
    listeners["pointerdown"]!({ pointerId: 1, clientX: 200, clientY: 400, preventDefault: () => {} });
    listeners["pointerup"]!({ pointerId: 1 });
    expect(g.race.oils).toHaveLength(1);
    expect(g.race.cars[0]!.oilsDropped).toBe(1);
    game.destroy();
  });
});

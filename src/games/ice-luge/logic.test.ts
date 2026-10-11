import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { iceLuge } from "./ice-luge";
import {
  BOOST,
  botInput,
  chuteAt,
  HALF_END,
  HALF_START,
  LENGTH,
  makeCourse,
  MIN_V,
  newBotBrain,
  newSled,
  placeByDistance,
  pointsForPlace,
  ROCK_SPIN_S,
  SLED_HALF,
  stepSled,
  topSpeed,
  type Course,
} from "./logic";

const straight: Course = { waves: [], wobblePhase: 0, items: [] };

describe("ice luge course", () => {
  it("is deterministic per seed, stays in the lane and narrows", () => {
    const a = makeCourse(new Rng(7));
    const b = makeCourse(new Rng(7));
    expect(a).toEqual(b);
    expect(a.items.length).toBeGreaterThan(20);
    for (let d = 0; d <= LENGTH + 2000; d += 50) {
      const ch = chuteAt(a, d);
      expect(ch.center - ch.half).toBeGreaterThanOrEqual(-1);
      expect(ch.center + ch.half).toBeLessThanOrEqual(1);
    }
    expect(chuteAt(a, LENGTH - 10).half).toBeLessThan(chuteAt(a, 1000).half);
    expect(chuteAt(a, 0).half).toBeCloseTo(HALF_START, 1);
    expect(chuteAt(a, LENGTH).half).toBeCloseTo(HALF_END, 1);
    expect(chuteAt(a, 0).center).toBe(0);
    for (const item of a.items) {
      const ch = chuteAt(a, item.d);
      expect(Math.abs(item.x - ch.center)).toBeLessThan(ch.half);
    }
    const ds = a.items.map((i) => i.d);
    expect([...ds].sort((x, y) => x - y)).toEqual(ds);
  });

  it("winds: the centre line moves around", () => {
    const c = makeCourse(new Rng(3));
    let span = 0;
    for (let d = 2000; d < LENGTH; d += 100) span = Math.max(span, Math.abs(chuteAt(c, d).center));
    expect(span).toBeGreaterThan(0.2);
  });
});

describe("ice luge sled", () => {
  it("accelerates on its own toward a rising top speed", () => {
    const s = newSled();
    for (let i = 0; i < 300; i++) stepSled(s, 0, straight, 1 / 60);
    expect(s.v).toBeGreaterThan(0);
    expect(s.v).toBeLessThanOrEqual(topSpeed(s.d) + 1);
    expect(topSpeed(LENGTH)).toBeGreaterThan(topSpeed(0));
  });

  it("steers, clamps to the wall, slows while scraping and counts each scrape once", () => {
    const s = newSled();
    s.v = 400;
    let starts = 0;
    for (let i = 0; i < 120; i++) {
      const ev = stepSled(s, 1, straight, 1 / 60);
      if (ev.scrapeStart !== 0) starts += 1;
    }
    const ch = chuteAt(straight, s.d);
    expect(s.x).toBeCloseTo(ch.center + ch.half - SLED_HALF, 5);
    expect(s.scrapeSide).toBe(1);
    expect(s.scrapes).toBe(1);
    expect(starts).toBe(1);
    expect(s.v).toBeLessThan(400);
    expect(s.v).toBeGreaterThanOrEqual(MIN_V);
    for (let i = 0; i < 12; i++) stepSled(s, -1, straight, 1 / 60);
    expect(s.scrapeSide).toBe(0);
    expect(s.x).toBeLessThan(ch.center + ch.half - SLED_HALF);
  });

  it("crystals boost once, rocks spin you out and kill steering", () => {
    const course: Course = {
      waves: [], wobblePhase: 0,
      items: [{ id: 0, d: 200, x: 0, kind: "crystal" }, { id: 1, d: 600, x: 0, kind: "rock" }],
    };
    const s = newSled();
    s.v = 300;
    let boosts = 0;
    let rocks = 0;
    let vBefore = 0;
    for (let i = 0; i < 240; i++) {
      if (s.d < 200) vBefore = s.v;
      const ev = stepSled(s, 0, course, 1 / 60);
      boosts += ev.crystals.length;
      if (ev.crystals.length) expect(s.v).toBeGreaterThan(vBefore + BOOST * 0.9);
      if (ev.rock) {
        rocks += 1;
        expect(s.spin).toBe(ROCK_SPIN_S);
        const before = s.x;
        stepSled(s, 1, course, 1 / 60);
        expect(s.x).toBe(before);
      }
    }
    expect(boosts).toBe(1);
    expect(rocks).toBe(1);
    expect(s.crystals).toBe(1);
    expect(s.taken.size).toBe(2);
  });

  it("crosses the finish line once and places stragglers by distance", () => {
    const s = newSled();
    s.d = LENGTH - 5;
    s.v = 300;
    expect(stepSled(s, 0, straight, 1 / 60).crossed).toBe(true);
    expect(stepSled(s, 0, straight, 1 / 60).crossed).toBe(false);
    expect(s.finished).toBe(true);
    const a = newSled();
    const b = newSled();
    const c = newSled();
    a.d = 100; b.d = 900; c.place = 1; c.d = LENGTH;
    expect(placeByDistance([a, b, c], 2)).toBe(4);
    expect(b.place).toBe(2);
    expect(a.place).toBe(3);
    expect(pointsForPlace(1)).toBeGreaterThan(pointsForPlace(2));
    expect(pointsForPlace(null)).toBe(0);
  });

  it("bots steer toward the centre and reach the finish", () => {
    const rng = new Rng(5);
    const course = makeCourse(rng);
    const s = newSled();
    const brain = newBotBrain(rng);
    let t = 0;
    while (!s.finished && t < 120) {
      const input = botInput(s, course, brain, rng, 1 / 60);
      expect(Math.abs(input)).toBeLessThanOrEqual(1);
      stepSled(s, input, course, 1 / 60);
      t += 1 / 60;
    }
    expect(s.finished).toBe(true);
    expect(t).toBeLessThan(60);
  });
});

describe("ice luge game", () => {
  it("an all-bot table races to the end and ranks everyone", () => {
    const ctx = {
      width: 1280, height: 720, rng: new Rng(11), minTap: 44,
      players: [0, 1, 2, 3].map((slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
      canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      input: { justPressed: () => false },
      sfx: new Proxy({}, { get: () => vi.fn() }),
    } as never;
    const game = iceLuge.create(ctx);
    let frames = 0;
    for (; frames < 60 * 130 && !game.isFinished(); frames++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    expect(frames).toBeLessThan(60 * 70);
    const scores = game.getScores();
    expect(scores.filter((s) => s.score === 5)).toHaveLength(1);
    expect(new Set(scores.map((s) => s.score)).size).toBe(4);
    expect(game.getStats?.().some((s) => s.label === "Crystals")).toBe(true);
    game.destroy();
  });
});

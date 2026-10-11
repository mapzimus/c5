import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { mashDash } from "./mash-dash";
import {
  advanceLight, botOnLight, botSeesGo, collectHazard, newBot, newLight, newRunner, placeByDistance,
  placeFinishers, placePoints, planHazards, SPRING_BOOST, STEP, stepBonus, tapRunner, tickBot,
  TRIP_STUN_S, YELLOW_S, type Light,
} from "./logic";

const green = (late = false): Light => ({ phase: "green", t: 0, dur: 3, late });
const red = (late = false): Light => ({ phase: "red", t: 0, dur: 1.5, late });

describe("traffic light", () => {
  it("cycles green -> yellow -> red -> green early, skips yellow late", () => {
    const rng = new Rng(1);
    const l = newLight(rng);
    expect(l.phase).toBe("green");
    advanceLight(l, l.dur, rng);
    expect(l.phase).toBe("yellow");
    expect(l.dur).toBe(YELLOW_S);
    advanceLight(l, YELLOW_S, rng);
    expect(l.phase).toBe("red");
    expect(l.dur).toBeGreaterThanOrEqual(1.3);
    advanceLight(l, l.dur, rng);
    expect(l.phase).toBe("green");
    l.late = true;
    advanceLight(l, l.dur, rng);
    expect(l.phase).toBe("red");
    expect(l.dur).toBeLessThanOrEqual(1.1);
    advanceLight(l, l.dur, rng);
    expect(l.phase).toBe("green");
    expect(l.dur).toBeLessThanOrEqual(2.0);
  });
});

describe("runner", () => {
  it("steps on green, chains quick taps into a bonus", () => {
    const r = newRunner([]);
    expect(tapRunner(r, green(), 0)).toBe("step");
    expect(r.progress).toBeCloseTo(STEP);
    tapRunner(r, green(), 150);
    expect(r.chain).toBe(1);
    expect(r.progress).toBeCloseTo(STEP + STEP * stepBonus(1));
    tapRunner(r, green(), 1000);
    expect(r.chain).toBe(0);
    expect(r.taps).toBe(3);
  });

  it("trips on red: slides back, stunned, taps ignored until up again", () => {
    const r = newRunner([]);
    r.progress = 0.3;
    expect(tapRunner(r, red(), 0)).toBe("trip");
    expect(r.progress).toBeCloseTo(0.25);
    expect(r.trips).toBe(1);
    expect(r.stun).toBe(TRIP_STUN_S);
    expect(tapRunner(r, green(), 100)).toBe("ignored");
    r.stun = 0;
    expect(tapRunner(r, green(), 200)).toBe("step");
    r.progress = 0.01;
    tapRunner(r, red(), 300);
    expect(r.progress).toBe(0);
  });

  it("hazards: spring boosts, banana wastes the next tap", () => {
    const r = newRunner([
      { kind: "spring", at: 0.2, used: false },
      { kind: "banana", at: 0.5, used: false },
    ]);
    expect(collectHazard(r)).toBeNull();
    r.progress = 0.21;
    expect(collectHazard(r)?.kind).toBe("spring");
    expect(r.progress).toBeCloseTo(0.21 + SPRING_BOOST);
    expect(collectHazard(r)).toBeNull();
    r.progress = 0.5;
    expect(collectHazard(r)?.kind).toBe("banana");
    expect(tapRunner(r, green(), 0)).toBe("slip");
    expect(r.progress).toBe(0.5);
    expect(tapRunner(r, green(), 50)).toBe("step");
  });

  it("plans spaced hazards with one spring", () => {
    const rng = new Rng(5);
    for (let i = 0; i < 50; i++) {
      const hz = planHazards(rng);
      expect(hz.filter((h) => h.kind === "spring")).toHaveLength(1);
      expect(hz.length).toBeGreaterThanOrEqual(2);
      for (let k = 1; k < hz.length; k++) expect(hz[k]!.at - hz[k - 1]!.at).toBeGreaterThanOrEqual(0.1);
      for (const h of hz) {
        expect(h.at).toBeGreaterThanOrEqual(0.15);
        expect(h.at).toBeLessThanOrEqual(0.88);
      }
    }
  });

  it("places finishers in order, then the rest by distance", () => {
    const rs = [newRunner([]), newRunner([]), newRunner([]), newRunner([])];
    rs[1]!.progress = 1;
    let next = placeFinishers(rs, 1);
    expect(next).toBe(2);
    expect(rs[1]!.place).toBe(1);
    rs[0]!.progress = 0.4;
    rs[2]!.progress = 0.7;
    rs[3]!.progress = 0.7;
    next = placeByDistance(rs, next);
    expect(next).toBe(5);
    expect(rs.map((r) => r.place)).toEqual([4, 1, 2, 3]);
    expect(placePoints(1)).toBeGreaterThan(placePoints(2));
    expect(placePoints(4)).toBeGreaterThan(0);
  });
});

describe("bots", () => {
  it("tap at 6-9 Hz on green and stop after their reaction on red", () => {
    const rng = new Rng(7);
    const b = newBot(rng);
    expect(b.hz).toBeGreaterThanOrEqual(6);
    expect(b.hz).toBeLessThanOrEqual(9);
    const l = green();
    l.t = 1;
    let taps = 0;
    for (let i = 0; i < 600; i++) if (tickBot(b, l, 1 / 60, rng)) taps++;
    // 10s at 6-9 Hz with jitter and the odd stall.
    expect(taps).toBeGreaterThan(40);
    expect(taps).toBeLessThan(100);

    const r = red(true);
    b.reactS = 0.3;
    r.t = 0.1;
    expect(botSeesGo(b, r)).toBe(true);
    r.t = 0.35;
    expect(botSeesGo(b, r)).toBe(false);
  });

  it("reads a fresh red with a 150-400ms delay or stops clean", () => {
    const rng = new Rng(2);
    const b = newBot(rng);
    let slow = 0;
    for (let i = 0; i < 100; i++) {
      botOnLight(b, red(true), "green", rng);
      if (b.reactS > 0) {
        slow++;
        expect(b.reactS).toBeGreaterThanOrEqual(0.15);
        expect(b.reactS).toBeLessThanOrEqual(0.4);
      }
    }
    expect(slow).toBeGreaterThan(20);
    expect(slow).toBeLessThan(80);
  });
});

describe("mash dash game", () => {
  it("an all-bot race finishes with distinct places and stats", () => {
    const ctx = {
      width: 1280, height: 720, rng: new Rng(11), minTap: 44,
      players: [0, 1, 2, 3].map((slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
      canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      input: { justPressed: () => false },
      sfx: new Proxy({}, { get: () => vi.fn() }),
    } as never;
    const game = mashDash.create(ctx);
    let frames = 0;
    while (!game.isFinished() && frames < 60 * 180) {
      game.update(1 / 60);
      frames++;
    }
    expect(game.isFinished()).toBe(true);
    expect(frames).toBeLessThan(60 * 120);
    const scores = game.getScores().map((s) => s.score);
    expect(new Set(scores).size).toBe(4);
    expect(Math.max(...scores)).toBe(10);
    const stats = game.getStats?.() ?? [];
    expect(stats.some((s) => s.label === "Taps" && Number(s.value) > 50)).toBe(true);
    expect(stats.filter((s) => s.label === "Trips")).toHaveLength(4);
    game.destroy();
  });
});

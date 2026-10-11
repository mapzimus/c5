import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { mashDash } from "./mash-dash";
import {
  advanceLight, bankPot, botOnLight, botSeesGo, CLUTCH_BONUS, collectHazard, DARE_MULT, DARE_MULT_LATE, dareMult,
  HECKLE_COOLDOWN_S, newBot, newLight, newRunner, PEEL_LEAD, pickHeckleTarget, placeByDistance, placeFinishers,
  placePoints, planDare, planHazards, scoreTime, SPRING_BOOST, STEP, stepBonus, tapRunner, throwPeel, tickBot,
  tickHeckler, timeScore, TRIP_STUN_S, TURBO_GAP, TURBO_MULT, updateTurbo, type Light,
} from "./logic";

const green = (late = false): Light => ({ phase: "green", t: 0, dur: 3, late });
const yellow = (late = false): Light => ({ phase: "yellow", t: 0, dur: 1, late });
const red = (late = false): Light => ({ phase: "red", t: 0, dur: 1.5, late });

describe("traffic light", () => {
  it("cycles green -> yellow -> red -> green, everything shorter in overdrive", () => {
    const rng = new Rng(1);
    const l = newLight(rng);
    expect(l.phase).toBe("green");
    advanceLight(l, l.dur, rng);
    expect(l.phase).toBe("yellow");
    expect(l.dur).toBeGreaterThanOrEqual(0.5);
    expect(l.dur).toBeLessThanOrEqual(1.4);
    advanceLight(l, l.dur, rng);
    expect(l.phase).toBe("red");
    expect(l.dur).toBeGreaterThanOrEqual(1.2);
    advanceLight(l, l.dur, rng);
    expect(l.phase).toBe("green");
    l.late = true;
    advanceLight(l, l.dur, rng);
    expect(l.phase).toBe("yellow");
    expect(l.dur).toBeLessThanOrEqual(0.9);
    advanceLight(l, l.dur, rng);
    expect(l.phase).toBe("red");
    expect(l.dur).toBeLessThanOrEqual(1.0);
    advanceLight(l, l.dur, rng);
    expect(l.phase).toBe("green");
    expect(l.dur).toBeLessThanOrEqual(1.8);
    expect(dareMult(green())).toBe(DARE_MULT);
    expect(dareMult(green(true))).toBe(DARE_MULT_LATE);
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

  it("dare taps charge a pot instead of moving, paid out after the red", () => {
    const r = newRunner([]);
    r.progress = 0.2;
    expect(tapRunner(r, yellow(), 0)).toBe("dare");
    expect(tapRunner(r, yellow(), 100)).toBe("dare");
    expect(tapRunner(r, yellow(), 200)).toBe("dare");
    expect(r.progress).toBe(0.2);
    expect(r.potTaps).toBe(3);
    const expected = STEP * DARE_MULT * (stepBonus(0) + stepBonus(1) + stepBonus(2));
    expect(r.pot).toBeCloseTo(expected);
    // Red came 600ms after the last dare: no clutch.
    const pay = bankPot(r, 800);
    expect(pay).not.toBeNull();
    expect(pay!.clutch).toBe(false);
    expect(pay!.taps).toBe(3);
    expect(pay!.amount).toBeCloseTo(expected);
    expect(r.progress).toBeCloseTo(0.2 + expected);
    expect(r.banked).toBeCloseTo(expected);
    expect(r.pot).toBe(0);
    expect(bankPot(r, 900)).toBeNull();
  });

  it("a dare tap right before the red is a clutch and pays extra; late dares pay x4", () => {
    const r = newRunner([]);
    tapRunner(r, yellow(true), 0);
    expect(r.pot).toBeCloseTo(STEP * DARE_MULT_LATE);
    const pay = bankPot(r, 120);
    expect(pay!.clutch).toBe(true);
    expect(pay!.amount).toBeCloseTo(STEP * DARE_MULT_LATE * (1 + CLUTCH_BONUS));
    // A tap after the red started is never a clutch (it would have tripped anyway).
    const r2 = newRunner([]);
    tapRunner(r2, yellow(), 500);
    expect(bankPot(r2, 400)!.clutch).toBe(false);
  });

  it("a tap on red with a pot busts it: slide, stun and the pot is gone", () => {
    const r = newRunner([]);
    r.progress = 0.4;
    tapRunner(r, yellow(), 0);
    tapRunner(r, yellow(), 100);
    expect(r.pot).toBeGreaterThan(0);
    expect(tapRunner(r, red(), 1200)).toBe("bust");
    expect(r.pot).toBe(0);
    expect(r.potTaps).toBe(0);
    expect(r.busts).toBe(1);
    expect(r.trips).toBe(1);
    expect(r.progress).toBeCloseTo(0.35);
    expect(bankPot(r, 1000)).toBeNull();
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

  it("gives the sole trailing runner turbo, which makes steps bigger", () => {
    const rs = [newRunner([]), newRunner([]), newRunner([])];
    rs[0]!.progress = 0.5;
    rs[1]!.progress = 0.45;
    rs[2]!.progress = 0.3;
    updateTurbo(rs);
    expect(rs.map((r) => r.turbo)).toEqual([false, false, true]);
    expect(tapRunner(rs[2]!, green(), 0)).toBe("step");
    expect(rs[2]!.progress).toBeCloseTo(0.3 + STEP * TURBO_MULT);
    // Not far enough behind: no turbo. Tied last: nobody.
    rs[2]!.progress = 0.5 - TURBO_GAP + 0.01;
    updateTurbo(rs);
    expect(rs[2]!.turbo).toBe(false);
    rs[1]!.progress = 0.2;
    rs[2]!.progress = 0.2;
    updateTurbo(rs);
    expect(rs.some((r) => r.turbo)).toBe(false);
    // A finished leader still counts as the pace to chase.
    rs[0]!.place = 1;
    rs[0]!.progress = 1;
    rs[1]!.progress = 0.9;
    rs[2]!.progress = 0.3;
    updateTurbo(rs);
    expect(rs[2]!.turbo).toBe(true);
    // Only one runner left: nothing to chase.
    rs[1]!.place = 2;
    updateTurbo(rs);
    expect(rs[2]!.turbo).toBe(false);
  });

  it("benched runners lob peels ahead of a rival, with a cooldown", () => {
    const bench = newRunner([]);
    const target = newRunner([]);
    target.progress = 0.4;
    expect(throwPeel(bench, target)).toBeNull();
    bench.place = 1;
    const peel = throwPeel(bench, target);
    expect(peel?.kind).toBe("banana");
    expect(peel?.thrown).toBe(true);
    expect(peel?.at).toBeCloseTo(0.4 + PEEL_LEAD);
    expect(target.hazards).toContain(peel);
    expect(bench.heckleCd).toBe(HECKLE_COOLDOWN_S);
    expect(bench.peels).toBe(1);
    expect(throwPeel(bench, target)).toBeNull();
    bench.heckleCd = 0;
    target.place = 2;
    expect(throwPeel(bench, target)).toBeNull();
    target.place = null;
    target.progress = 0.99;
    expect(throwPeel(bench, target)!.at).toBeLessThanOrEqual(0.97);
    expect(pickHeckleTarget([bench, target])).toBe(1);
    target.place = 3;
    expect(pickHeckleTarget([bench, target])).toBe(-1);
  });

  it("places finishers in order with their time, then the rest by distance", () => {
    const rs = [newRunner([]), newRunner([]), newRunner([]), newRunner([])];
    rs[1]!.progress = 1;
    rs[1]!.pot = 0.1;
    let next = placeFinishers(rs, 1, 37.5);
    expect(next).toBe(2);
    expect(rs[1]!.place).toBe(1);
    expect(rs[1]!.finishS).toBe(37.5);
    expect(rs[1]!.pot).toBe(0);
    rs[0]!.progress = 0.4;
    rs[2]!.progress = 0.7;
    rs[3]!.progress = 0.7;
    next = placeByDistance(rs, next);
    expect(next).toBe(5);
    expect(rs.map((r) => r.place)).toEqual([4, 1, 2, 3]);
    expect(placePoints(1)).toBeGreaterThan(placePoints(2));
    expect(placePoints(4)).toBeGreaterThan(0);
  });

  it("stores a faster time as a higher record score", () => {
    expect(timeScore(30)).toBeGreaterThan(timeScore(45));
    expect(scoreTime(timeScore(38.2))).toBeCloseTo(38.2, 1);
    expect(scoreTime(0)).toBe(0);
  });
});

describe("bots", () => {
  it("tap at 6.5-9 Hz on green and stop after their reaction on red", () => {
    const rng = new Rng(7);
    const b = newBot(rng);
    expect(b.hz).toBeGreaterThanOrEqual(6.5);
    expect(b.hz).toBeLessThanOrEqual(9);
    const l = green();
    l.t = 1;
    let taps = 0;
    for (let i = 0; i < 600; i++) if (tickBot(b, l, 1 / 60, rng)) taps++;
    // 10s at 6.5-9 Hz with jitter and the odd stall.
    expect(taps).toBeGreaterThan(45);
    expect(taps).toBeLessThan(100);

    const r = red(true);
    b.reactS = 0.3;
    r.t = 0.1;
    expect(botSeesGo(b, r)).toBe(true);
    r.t = 0.35;
    expect(botSeesGo(b, r)).toBe(false);
  });

  it("dares a planned number of taps on yellow, then stands still", () => {
    const rng = new Rng(3);
    const b = newBot(rng);
    const y = yellow();
    botOnLight(b, y, "green", rng);
    b.dareTaps = 3;
    b.reactS = 0;
    let taps = 0;
    for (let i = 0; i < 120; i++) {
      y.t += 1 / 60;
      if (tickBot(b, y, 1 / 60, rng)) taps++;
    }
    expect(taps).toBe(3);
    expect(botSeesGo(b, y)).toBe(false);
    // A bot caught mid-dare reads the red late; one already stopped usually reads it clean.
    let caught = 0;
    let clean = 0;
    for (let i = 0; i < 100; i++) {
      b.dareTaps = 2;
      botOnLight(b, red(), "yellow", rng);
      if (b.reactS > 0) caught++;
      b.dareTaps = 0;
      botOnLight(b, red(), "yellow", rng);
      if (b.reactS === 0) clean++;
    }
    expect(caught).toBe(100);
    expect(clean).toBeGreaterThan(75);
  });

  it("spreads dare plans from timid to greedy", () => {
    const rng = new Rng(9);
    const counts = { none: 0, few: 0, many: 0, greedy: 0 };
    for (let i = 0; i < 400; i++) {
      const n = planDare(false, rng);
      if (n === 0) counts.none++;
      else if (n <= 3) counts.few++;
      else if (n <= 6) counts.many++;
      else counts.greedy++;
    }
    expect(counts.none).toBeGreaterThan(20);
    expect(counts.few).toBeGreaterThan(counts.many);
    expect(counts.many).toBeGreaterThan(counts.greedy);
    expect(counts.greedy).toBeGreaterThan(10);
    for (let i = 0; i < 50; i++) expect([0, 1, 2, 3, 4, 5, 99]).toContain(planDare(true, rng));
  });

  it("benched bots throw every 1.2-3.2s", () => {
    const rng = new Rng(4);
    const b = newBot(rng);
    const fires: number[] = [];
    let t = 0;
    for (let i = 0; i < 60 * 20; i++) {
      t += 1 / 60;
      if (tickHeckler(b, 1 / 60, rng)) fires.push(t);
    }
    expect(fires.length).toBeGreaterThan(5);
    for (let k = 1; k < fires.length; k++) {
      const gap = fires[k]! - fires[k - 1]!;
      expect(gap).toBeGreaterThan(1.1);
      expect(gap).toBeLessThan(3.3);
    }
  });
});

describe("dare dash game", () => {
  function botGame(n: number, seed: number) {
    const ctx = {
      width: 1280, height: 720, rng: new Rng(seed), minTap: 44,
      players: Array.from({ length: n }, (_, slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
      canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      input: { justPressed: () => false },
      sfx: new Proxy({}, { get: () => vi.fn() }),
    } as never;
    return mashDash.create(ctx);
  }

  it("an all-bot race finishes with distinct places and stats", () => {
    const game = botGame(4, 11);
    let frames = 0;
    while (!game.isFinished() && frames < 60 * 180) {
      game.update(1 / 60);
      frames++;
    }
    expect(game.isFinished()).toBe(true);
    expect(frames).toBeLessThan(60 * 100);
    expect(frames).toBeGreaterThan(60 * 30);
    const scores = game.getScores().map((s) => s.score);
    expect(new Set(scores).size).toBe(4);
    expect(Math.max(...scores)).toBe(10);
    const stats = game.getStats?.() ?? [];
    expect(stats.filter((s) => s.label === "Banked")).toHaveLength(4);
    expect(stats.some((s) => s.label === "Banked" && parseInt(s.value, 10) > 0)).toBe(true);
    expect(stats.filter((s) => s.label === "Trips")).toHaveLength(4);
    expect(stats.some((s) => s.label === "Time")).toBe(true);
    game.destroy();
  });

  it("two-bot races land inside the party window", () => {
    for (const seed of [1, 2, 3]) {
      const game = botGame(2, seed);
      let frames = 0;
      while (!game.isFinished() && frames < 60 * 180) {
        game.update(1 / 60);
        frames++;
      }
      expect(game.isFinished()).toBe(true);
      expect(frames / 60).toBeGreaterThan(30);
      expect(frames / 60).toBeLessThan(90);
      game.destroy();
    }
  });
});

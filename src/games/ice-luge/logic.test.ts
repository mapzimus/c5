import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { iceLuge } from "./ice-luge";
import {
  AVALANCHE_GAP,
  BOOST,
  botInput,
  buryCaught,
  chuteAt,
  DRAFT_FILL_S,
  HALF_END,
  HALF_START,
  LENGTH,
  makeCourse,
  MIN_V,
  newBotBrain,
  newSled,
  PERFECT_HEAT,
  placeByDistance,
  pointsForPlace,
  rankBehind,
  ROCK_SPIN_S,
  SLED_HALF,
  SLING_BOOST,
  SNOWBALL_FLIGHT_S,
  startAvalanche,
  stepAvalanche,
  stepSled,
  stepSnowballs,
  strayAhead,
  throwSnowball,
  topSpeed,
  TUCK_FULL_S,
  TUCK_MULT,
  type Course,
  type Sled,
} from "./logic";

const straight: Course = { waves: [], wobblePhase: 0, items: [] };
const DT = 1 / 60;
const coast = { steer: 0, tuck: false };
const tuck = { steer: 0, tuck: true };

function run(s: Sled, input: { steer: number; tuck: boolean }, course: Course, steps: number, rivals: readonly Sled[] = [], rank = 0): void {
  for (let i = 0; i < steps; i++) stepSled(s, input, course, DT, rivals, rank);
}

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

  it("winds: the centre line moves around, and strayAhead tells straights from bends", () => {
    const c = makeCourse(new Rng(3));
    let span = 0;
    for (let d = 2000; d < LENGTH; d += 100) span = Math.max(span, Math.abs(chuteAt(c, d).center));
    expect(span).toBeGreaterThan(0.2);
    expect(strayAhead(straight, 0, 1000, 1600)).toBe(0);
    let bendy = 0;
    for (let d = 2000; d < LENGTH; d += 200) bendy = Math.max(bendy, strayAhead(c, chuteAt(c, d).center, d, d + 600));
    expect(bendy).toBeGreaterThan(0.85);
  });
});

describe("ice luge sled", () => {
  it("accelerates on its own toward a rising top speed", () => {
    const s = newSled();
    run(s, coast, straight, 300);
    expect(s.v).toBeGreaterThan(0);
    expect(s.v).toBeLessThanOrEqual(topSpeed(s.d) + 1);
    expect(topSpeed(LENGTH)).toBeGreaterThan(topSpeed(0));
  });

  it("steers, clamps to the wall, slows while scraping and counts each scrape once", () => {
    const s = newSled();
    s.v = 400;
    let starts = 0;
    for (let i = 0; i < 120; i++) {
      const ev = stepSled(s, { steer: 1, tuck: false }, straight, DT);
      if (ev.scrapeStart !== 0) starts += 1;
    }
    const ch = chuteAt(straight, s.d);
    expect(s.x).toBeCloseTo(ch.center + ch.half - SLED_HALF, 5);
    expect(s.scrapeSide).toBe(1);
    expect(s.scrapes).toBe(1);
    expect(starts).toBe(1);
    expect(s.v).toBeLessThan(400);
    expect(s.v).toBeGreaterThanOrEqual(MIN_V);
    run(s, { steer: -1, tuck: false }, straight, 12);
    expect(s.scrapeSide).toBe(0);
    expect(s.x).toBeLessThan(ch.center + ch.half - SLED_HALF);
  });

  it("crystals boost once, rocks spin you out and kill steering, near misses count", () => {
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
      const ev = stepSled(s, coast, course, DT);
      boosts += ev.crystals.length;
      if (ev.crystals.length) expect(s.v).toBeGreaterThan(vBefore + BOOST * 0.9);
      if (ev.rock) {
        rocks += 1;
        expect(s.spin).toBe(ROCK_SPIN_S);
        const before = s.x;
        stepSled(s, { steer: 1, tuck: true }, course, DT);
        expect(s.x).toBe(before);
        expect(s.tucking).toBe(false);
      }
    }
    expect(boosts).toBe(1);
    expect(rocks).toBe(1);
    expect(s.crystals).toBe(1);
    expect(s.taken.size).toBe(2);

    const near = newSled();
    near.v = 300;
    near.x = SLED_HALF + 0.07 + 0.02;
    let misses = 0;
    for (let i = 0; i < 240; i++) if (stepSled(near, coast, course, DT).nearMiss) misses += 1;
    expect(misses).toBe(1);
    expect(near.nearMisses).toBe(1);
    expect(near.taken.size).toBe(0);
  });

  it("tuck: no steering, faster than top speed, heat builds to a meltdown, late release is perfect", () => {
    const s = newSled();
    s.d = 3000;
    s.v = topSpeed(3000);
    run(s, { steer: 1, tuck: true }, straight, 30);
    expect(s.x).toBe(0);
    expect(s.tucking).toBe(true);
    expect(s.v).toBeGreaterThan(topSpeed(s.d) + 50);
    expect(s.heat).toBeGreaterThan(0.1);
    let melted = false;
    let steps = 0;
    while (!melted && steps < 600) {
      melted = stepSled(s, tuck, straight, DT).meltdown;
      steps += 1;
    }
    expect(melted).toBe(true);
    expect(steps).toBeLessThan(TUCK_FULL_S * 60 + 2);
    expect(s.spin).toBeGreaterThan(0);
    expect(s.heat).toBe(0);
    expect(s.meltdowns).toBe(1);
    expect(s.v).toBeLessThan(topSpeed(s.d));

    const p = newSled();
    p.d = 3000;
    p.v = topSpeed(3000);
    while (p.heat < PERFECT_HEAT) stepSled(p, tuck, straight, DT);
    const vAtRelease = p.v;
    const ev = stepSled(p, coast, straight, DT);
    expect(ev.tuckRelease).toBeGreaterThanOrEqual(PERFECT_HEAT);
    expect(ev.perfectTuck).toBe(true);
    expect(p.v).toBeGreaterThan(vAtRelease + 50);
    expect(p.v).toBeLessThanOrEqual(topSpeed(p.d) * TUCK_MULT + 120);
    run(p, coast, straight, 200);
    expect(p.heat).toBe(0);

    const early = newSled();
    early.d = 3000;
    early.v = 400;
    run(early, tuck, straight, 10);
    expect(stepSled(early, coast, straight, DT).perfectTuck).toBe(false);
  });

  it("slipstream: sitting in a rival's wake fills the draft meter and fires a slingshot; last place fills faster", () => {
    const leader = newSled();
    leader.d = 2300;
    leader.v = 400;
    const s = newSled();
    s.d = 2000;
    s.v = 400;
    let fired = 0;
    let steps = 0;
    while (fired === 0 && steps < 600) {
      leader.d += 400 * DT;
      const ev = stepSled(s, coast, straight, DT, [leader], 1);
      if (ev.slingshot) fired += 1;
      steps += 1;
    }
    expect(fired).toBe(1);
    expect(s.slingshots).toBe(1);
    expect(s.draft).toBe(0);
    expect(s.v).toBeGreaterThan(topSpeed(s.d) + SLING_BOOST * 0.5);
    expect(steps).toBeLessThanOrEqual(DRAFT_FILL_S * 60 + 2);

    const last = newSled();
    last.d = 2000;
    last.v = 400;
    const ahead = newSled();
    ahead.d = 2300;
    ahead.v = 400;
    let lastSteps = 0;
    for (; lastSteps < 600; lastSteps++) {
      ahead.d += 400 * DT;
      if (stepSled(last, coast, straight, DT, [ahead], 3).slingshot) break;
    }
    expect(lastSteps).toBeLessThan(steps - 10);

    const early = newSled();
    early.d = 500;
    early.v = 400;
    const earlyLeader = newSled();
    earlyLeader.d = 700;
    run(early, coast, straight, 60, [earlyLeader], 1);
    expect(early.draft).toBe(0);
    const onTop = newSled();
    onTop.d = 2000;
    onTop.v = 400;
    const same = newSled();
    same.d = 2010;
    run(onTop, coast, straight, 10, [same], 1);
    expect(onTop.draft).toBe(0);

    const wide = newSled();
    wide.d = 2000;
    wide.v = 400;
    wide.x = 0.4;
    const far = newSled();
    far.d = 2300;
    far.v = 400;
    run(wide, coast, straight, 60, [far], 1);
    expect(wide.draft).toBe(0);
    expect(wide.drafting).toBe(false);

    const front = newSled();
    front.d = 5000;
    const back = newSled();
    back.d = 4000;
    expect(rankBehind(front, [front, back])).toBe(0);
    expect(rankBehind(back, [front, back])).toBe(1);
    expect(stepSled(back, coast, straight, DT, [front]).passed).toEqual([]);
    back.d = front.d - 1;
    back.v = 600;
    expect(stepSled(back, coast, straight, DT, [front]).passed).toEqual([front]);
  });

  it("crosses the finish line once and places stragglers by distance", () => {
    const s = newSled();
    s.d = LENGTH - 5;
    s.v = 300;
    expect(stepSled(s, tuck, straight, DT).crossed).toBe(true);
    expect(stepSled(s, tuck, straight, DT).crossed).toBe(false);
    expect(s.finished).toBe(true);
    expect(s.tucking).toBe(false);
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

  it("the avalanche starts behind the last racer, speeds up and buries whoever it reaches in order", () => {
    const done = newSled();
    done.d = LENGTH + 10;
    done.finished = true;
    done.place = 1;
    const a = newSled();
    a.d = 15000;
    const b = newSled();
    b.d = 12000;
    const sleds = [done, a, b];
    const av = startAvalanche(sleds);
    expect(av.d).toBe(12000 - AVALANCHE_GAP);
    const v0 = av.v;
    stepAvalanche(av, 1);
    expect(av.v).toBeGreaterThan(v0);
    expect(av.d).toBeGreaterThan(12000 - AVALANCHE_GAP);
    expect(buryCaught(sleds, av, 2).buried).toEqual([]);
    av.d = 15500;
    const res = buryCaught(sleds, av, 2);
    expect(res.buried).toEqual([a, b]);
    expect(a.place).toBe(2);
    expect(b.place).toBe(3);
    expect(b.buried).toBe(true);
    expect(res.nextPlace).toBe(4);
    expect(buryCaught(sleds, av, 4).buried).toEqual([]);
  });

  it("snowballs land on everyone still racing at that lateral spot", () => {
    const racer = newSled();
    racer.d = 5000;
    racer.v = 500;
    racer.x = 0.3;
    const dodger = newSled();
    dodger.d = 4000;
    dodger.x = -0.5;
    const done = newSled();
    done.finished = true;
    done.x = 0.3;
    const balls = [throwSnowball(0.32, 0), throwSnowball(-2, 1)];
    expect(balls[1]!.x).toBe(-1);
    const early = stepSnowballs(balls, [racer, dodger, done], DT);
    expect(early.landed).toEqual([]);
    expect(balls).toHaveLength(2);
    const res = stepSnowballs(balls, [racer, dodger, done], SNOWBALL_FLIGHT_S);
    expect(res.landed).toHaveLength(2);
    expect(balls).toHaveLength(0);
    expect(res.hits.map((h) => h.sled)).toEqual([racer]);
    expect(racer.v).toBeLessThan(500);
    expect(racer.splat).toBeGreaterThan(0);
    expect(racer.splats).toBe(1);
    expect(dodger.splats).toBe(0);
    expect(done.splats).toBe(0);
  });

  it("bots steer toward the centre, tuck on straights, and reach the finish", () => {
    const rng = new Rng(5);
    const course = makeCourse(rng);
    const s = newSled();
    const brain = newBotBrain(rng);
    let t = 0;
    let tucked = 0;
    while (!s.finished && t < 120) {
      const input = botInput(s, course, brain, rng, DT);
      expect(Math.abs(input.steer)).toBeLessThanOrEqual(1);
      stepSled(s, input, course, DT);
      if (s.tucking) tucked += DT;
      t += DT;
    }
    expect(s.finished).toBe(true);
    expect(t).toBeLessThan(60);
    expect(tucked).toBeGreaterThan(3);
    // A greedy bot that never lets go melts down; a careful one never does.
    const greedy = newBotBrain(rng);
    greedy.tuckGreed = 2;
    greedy.tuckSkill = 1;
    const g = newSled();
    g.d = 1000;
    for (let i = 0; i < 600 && g.meltdowns === 0; i++) stepSled(g, botInput(g, straight, greedy, rng, DT), straight, DT);
    expect(g.meltdowns).toBe(1);
    const careful = newBotBrain(rng);
    careful.tuckGreed = 0.7;
    careful.tuckSkill = 1;
    const c = newSled();
    c.d = 1000;
    for (let i = 0; i < 900; i++) stepSled(c, botInput(c, straight, careful, rng, DT), straight, DT);
    expect(c.meltdowns).toBe(0);
    expect(c.heat).toBeLessThan(0.72);
  });
});

describe("ice luge game", () => {
  function table(seed: number, n: number) {
    return {
      width: 1280, height: 720, rng: new Rng(seed), minTap: 44,
      players: [0, 1, 2, 3].slice(0, n).map((slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
      canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      input: { justPressed: () => false },
      sfx: new Proxy({}, { get: () => vi.fn() }),
    } as never;
  }

  it("an all-bot table races to the end in 45-100s and ranks everyone", () => {
    for (const [seed, n] of [[11, 4], [12, 2], [13, 3]] as const) {
      const game = iceLuge.create(table(seed, n));
      let frames = 0;
      for (; frames < 60 * 130 && !game.isFinished(); frames++) game.update(DT);
      expect(game.isFinished()).toBe(true);
      expect(frames).toBeGreaterThan(60 * 40);
      expect(frames).toBeLessThan(60 * 100);
      const scores = game.getScores();
      expect(scores.filter((s) => s.score === 5)).toHaveLength(1);
      expect(new Set(scores.map((s) => s.score)).size).toBe(n);
      const stats = game.getStats?.() ?? [];
      expect(stats.some((s) => s.label === "Time" && s.value.endsWith("s"))).toBe(true);
      expect(stats.some((s) => s.label === "Slingshots")).toBe(true);
      game.destroy();
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { hungryHoppers } from "./hungry-hoppers";
import {
  ARENA_R,
  ARENA_X,
  ARENA_Y,
  applyEat,
  BARF_CAP,
  barfMarbles,
  bellyMultiplier,
  botDecide,
  buzzerValue,
  chompExtension,
  CHOMP_TIME,
  DURATION_S,
  GOLD_MIN_SPEED,
  marblesInMouth,
  mouthCenter,
  nearMiss,
  rollKind,
  seatAngles,
  spawnMarble,
  stepMarbles,
  TILT_GAP,
  TILT_GRAVITY,
  tiltFor,
  zoneFor,
  type Marble,
  type MarbleKind,
} from "./logic";

describe("chomp logic", () => {
  it("sorts a mouthful into belly points and bombs", () => {
    const r = applyEat(["normal", "gold"]);
    expect(r).toMatchObject({ pts: 9, stunned: false, golds: 1, bombs: 0, eaten: 2 });
    expect(r.food).toEqual(["normal", "gold"]);
    const b = applyEat(["bomb", "normal"]);
    expect(b).toMatchObject({ pts: 1, stunned: true, bombs: 1 });
    expect(b.food).toEqual(["normal"]);
  });

  it("multiplies food by the belly multiplier and OVERDRIVE", () => {
    expect(applyEat(["normal", "normal"], 3).pts).toBe(6);
    expect(applyEat(["gold"], 2, 2).pts).toBe(32);
  });

  it("grows the multiplier every 4 marbles up to x4", () => {
    expect(bellyMultiplier(0)).toBe(1);
    expect(bellyMultiplier(3)).toBe(1);
    expect(bellyMultiplier(4)).toBe(2);
    expect(bellyMultiplier(8)).toBe(3);
    expect(bellyMultiplier(40)).toBe(4);
  });

  it("only half the belly survives the buzzer", () => {
    expect(buzzerValue(23)).toBe(11);
    expect(buzzerValue(0)).toBe(0);
  });

  it("maps taps to halves for 2 players and quadrants for 3-4", () => {
    expect(zoneFor(100, 600, 2)).toBe(0);
    expect(zoneFor(1200, 50, 2)).toBe(1);
    expect(zoneFor(100, 100, 4)).toBe(0);
    expect(zoneFor(1200, 100, 4)).toBe(1);
    expect(zoneFor(100, 600, 4)).toBe(2);
    expect(zoneFor(1200, 600, 4)).toBe(3);
    expect(zoneFor(1200, 600, 3)).toBe(-1);
  });

  it("lunges out and back within the chomp time", () => {
    expect(chompExtension(0)).toBe(0);
    expect(chompExtension(CHOMP_TIME / 2)).toBeCloseTo(1);
    expect(chompExtension(CHOMP_TIME)).toBe(0);
    const rest = mouthCenter(Math.PI, 0);
    const out = mouthCenter(Math.PI, 1);
    expect(out.x).toBeGreaterThan(rest.x);
  });

  it("finds marbles in the mouth and food just outside it", () => {
    const m = mouthCenter(0, 1);
    const marbles: Marble[] = [
      { x: m.x, y: m.y, vx: 0, vy: 0, kind: "normal" },
      { x: ARENA_X - 200, y: ARENA_Y, vx: 0, vy: 0, kind: "gold" },
    ];
    expect(marblesInMouth(marbles, m.x, m.y)).toEqual([0]);
    const close: Marble[] = [{ x: m.x - 70, y: m.y, vx: 0, vy: 0, kind: "normal" }];
    expect(nearMiss(close, 0)).toBe(true);
    const bombOnly: Marble[] = [{ x: m.x - 70, y: m.y, vx: 0, vy: 0, kind: "bomb" }];
    expect(nearMiss(bombOnly, 0)).toBe(false);
    expect(nearMiss([], 0)).toBe(false);
  });

  it("makes gold rare, more common in OVERDRIVE, and keeps it fast", () => {
    expect(rollKind(0.01)).toBe("gold");
    expect(rollKind(0.1)).toBe("bomb");
    expect(rollKind(0.5)).toBe("normal");
    expect(rollKind(0.1, 0.12, 0.12)).toBe("gold");
    expect(rollKind(0.2, 0.12, 0.12)).toBe("bomb");
    const gold = [spawnMarble(() => 0.5, "gold")];
    for (let i = 0; i < 600; i++) stepMarbles(gold, 1 / 60);
    expect(Math.hypot(gold[0]!.vx, gold[0]!.vy)).toBeGreaterThanOrEqual(GOLD_MIN_SPEED - 1);
  });

  it("keeps marbles inside the arena, even when the bowl tilts", () => {
    const marbles: Marble[] = [{ x: ARENA_X, y: ARENA_Y, vx: 900, vy: 300, kind: "normal" }];
    for (let i = 0; i < 600; i++) stepMarbles(marbles, 1 / 60, { gx: TILT_GRAVITY, gy: 0, speedScale: 1.4 });
    const m = marbles[0]!;
    expect(Math.hypot(m.x - ARENA_X, m.y - ARENA_Y)).toBeLessThanOrEqual(ARENA_R);
    expect(Math.hypot(m.vx, m.vy)).toBeGreaterThan(0);
  });

  it("rolls marbles downhill toward the trailing player", () => {
    const marbles: Marble[] = Array.from({ length: 12 }, (_, i) => ({
      x: ARENA_X, y: ARENA_Y, vx: Math.cos(i) * 150, vy: Math.sin(i) * 150, kind: "normal" as const,
    }));
    const tilt = tiltFor([60, 0], seatAngles(2));
    expect(tilt.seat).toBe(1);
    expect(tilt.strength).toBe(1);
    const bombs: Marble[] = Array.from({ length: 12 }, (_, i) => ({
      x: ARENA_X, y: ARENA_Y, vx: Math.cos(i) * 150, vy: Math.sin(i) * 150, kind: "bomb" as const,
    }));
    for (let i = 0; i < 240; i++) {
      stepMarbles(marbles, 1 / 60, tilt);
      stepMarbles(bombs, 1 / 60, tilt);
    }
    const meanX = marbles.reduce((s, m) => s + m.x, 0) / marbles.length;
    expect(meanX).toBeGreaterThan(ARENA_X + 60);
    const bombX = bombs.reduce((s, m) => s + m.x, 0) / bombs.length;
    expect(Math.abs(bombX - ARENA_X)).toBeLessThan(60); // bombs stay put
  });

  it("keeps the bowl level when the race is close or last place is tied", () => {
    expect(tiltFor([3, 0], seatAngles(2)).seat).toBe(-1);
    expect(tiltFor([30, 0, 0, 12], seatAngles(4)).seat).toBe(-1);
    const t = tiltFor([30, 5, 20, 12], seatAngles(4));
    expect(t.seat).toBe(1);
    expect(t.strength).toBeGreaterThan(0);
    expect(t.strength).toBeLessThan(1);
    expect(tiltFor([TILT_GAP, 0], seatAngles(2)).strength).toBe(0);
  });

  it("barfs the belly back toward the middle of the bowl, capped", () => {
    const m = mouthCenter(Math.PI, 0.5);
    const belly: MarbleKind[] = Array.from({ length: 40 }, (_, i) => (i % 5 === 0 ? "gold" : "normal"));
    const out = barfMarbles(belly, m.x, m.y, Math.PI, () => 0.5);
    expect(out.length).toBe(BARF_CAP);
    expect(out.filter((o) => o.kind === "gold").length).toBe(5);
    for (const o of out) expect(o.vx).toBeGreaterThan(0);
  });

  it("bots gulp when full or when the buzzer is near, chomp on food, rarely bite near bombs", () => {
    expect(botDecide({ read: "go", belly: 0, bankAt: 6, timeLeft: 30, roll: 0.5 })).toBe("chomp");
    expect(botDecide({ read: "wait", belly: 0, bankAt: 6, timeLeft: 30, roll: 0.5 })).toBe("hold");
    expect(botDecide({ read: "go", belly: 6, bankAt: 6, timeLeft: 30, roll: 0.5 })).toBe("chomp");
    expect(botDecide({ read: "wait", belly: 6, bankAt: 6, timeLeft: 30, roll: 0.5 })).toBe("hold");
    expect(botDecide({ read: "go", belly: 11, bankAt: 6, timeLeft: 30, roll: 0.5 })).toBe("hold");
    expect(botDecide({ read: "go", belly: 2, bankAt: 6, timeLeft: 1, roll: 0.5 })).toBe("hold");
    expect(botDecide({ read: "risky", belly: 0, bankAt: 6, timeLeft: 30, roll: 0.01 })).toBe("chomp");
    expect(botDecide({ read: "risky", belly: 0, bankAt: 6, timeLeft: 30, roll: 0.5 })).toBe("hold");
  });
});

function botContext(seed: number, n: number) {
  return {
    width: 1280, height: 720, rng: new Rng(seed), minTap: 44,
    players: [0, 1, 2, 3].slice(0, n).map((slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
    canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    input: { justPressed: () => false },
    sfx: new Proxy({}, { get: () => vi.fn() }),
  } as never;
}

describe("chomp game", () => {
  it("bots eat, gulp and bank points over a full round", () => {
    const game = hungryHoppers.create(botContext(3, 4));
    for (let f = 0; f < 60 * DURATION_S + 5; f++) game.update(1 / 60);
    expect(game.getScores().every((s) => s.score > 0)).toBe(true);
    const stats = game.getStats?.() ?? [];
    expect(stats.length).toBe(16);
    expect(stats.some((s) => s.label === "Biggest gulp" && Number(s.value) > 0)).toBe(true);
    game.destroy();
  });

  it("lasts the advertised 50 seconds and banks half the belly at the buzzer", () => {
    expect(hungryHoppers.durationMs).toBe(DURATION_S * 1000);
    const game = hungryHoppers.create(botContext(7, 2));
    for (let f = 0; f < 60 * DURATION_S + 5; f++) game.update(1 / 60);
    const first = game.getScores();
    for (let f = 0; f < 60; f++) game.update(1 / 60);
    expect(game.getScores()).toEqual(first); // nothing changes after the buzzer
    game.destroy();
  });
});

describe("chomp definition", () => {
  it("is called Chomp", () => {
    expect(hungryHoppers.name).toBe("Chomp");
    expect(hungryHoppers.id).toBe("hungry-hoppers");
  });
});

import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import { hungryHoppers } from "./hungry-hoppers";
import {
  ARENA_R,
  ARENA_X,
  ARENA_Y,
  applyEat,
  chompExtension,
  CHOMP_TIME,
  GOLD_MIN_SPEED,
  marblesInMouth,
  mouthCenter,
  nextStreak,
  rollKind,
  spawnMarble,
  stepMarbles,
  streakMultiplier,
  zoneFor,
  type Marble,
} from "./logic";

describe("chomp logic", () => {
  it("scores normal 1, gold 8, bomb -2 with a floor of 0", () => {
    expect(applyEat(0, ["normal", "gold"]).score).toBe(9);
    const r = applyEat(1, ["bomb"]);
    expect(r).toMatchObject({ score: 0, stunned: true, bombs: 1 });
    expect(applyEat(5, ["bomb", "normal"]).score).toBe(4);
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

  it("finds marbles in the mouth", () => {
    const m = mouthCenter(0, 1);
    const marbles: Marble[] = [
      { x: m.x, y: m.y, vx: 0, vy: 0, kind: "normal" },
      { x: ARENA_X - 200, y: ARENA_Y, vx: 0, vy: 0, kind: "gold" },
    ];
    expect(marblesInMouth(marbles, m.x, m.y)).toEqual([0]);
  });

  it("multiplies food by the streak but never bombs", () => {
    expect(applyEat(0, ["normal", "normal"], 3).score).toBe(6);
    expect(applyEat(10, ["bomb"], 4).score).toBe(8);
  });

  it("builds a streak on food and resets on whiffs and bombs", () => {
    expect(streakMultiplier(0)).toBe(1);
    expect(streakMultiplier(3)).toBe(2);
    expect(streakMultiplier(99)).toBe(4);
    expect(nextStreak(4, true, false)).toBe(5);
    expect(nextStreak(4, false, false)).toBe(0);
    expect(nextStreak(4, true, true)).toBe(0);
  });

  it("makes gold rare and keeps it fast", () => {
    expect(rollKind(0.01)).toBe("gold");
    expect(rollKind(0.1)).toBe("bomb");
    expect(rollKind(0.5)).toBe("normal");
    const gold = [spawnMarble(() => 0.5, "gold")];
    for (let i = 0; i < 600; i++) stepMarbles(gold, 1 / 60);
    expect(Math.hypot(gold[0]!.vx, gold[0]!.vy)).toBeGreaterThanOrEqual(GOLD_MIN_SPEED - 1);
  });

  it("keeps marbles inside the arena", () => {
    const marbles: Marble[] = [{ x: ARENA_X, y: ARENA_Y, vx: 900, vy: 300, kind: "normal" }];
    for (let i = 0; i < 600; i++) stepMarbles(marbles, 1 / 60);
    const m = marbles[0]!;
    expect(Math.hypot(m.x - ARENA_X, m.y - ARENA_Y)).toBeLessThanOrEqual(ARENA_R);
    expect(Math.hypot(m.vx, m.vy)).toBeGreaterThan(0);
  });
});

describe("chomp game", () => {
  it("bots eat marbles over a full round", () => {
    const ctx = {
      width: 1280, height: 720, rng: new Rng(3), minTap: 44,
      players: [0, 1, 2, 3].map((slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
      canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      input: { justPressed: () => false },
      sfx: new Proxy({}, { get: () => vi.fn() }),
    } as never;
    const game = hungryHoppers.create(ctx);
    for (let f = 0; f < 60 * 45; f++) game.update(1 / 60);
    expect(game.getScores().some((s) => s.score > 0)).toBe(true);
    expect(game.getStats?.().length).toBe(16);
    game.destroy();
  });
});

describe("chomp definition", () => {
  it("is called Chomp", () => {
    expect(hungryHoppers.name).toBe("Chomp");
    expect(hungryHoppers.id).toBe("hungry-hoppers");
  });
});

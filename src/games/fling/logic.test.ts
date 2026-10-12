import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import type { GameContext } from "../../core/types";
import { fling } from "./fling";
import {
  aimAt, applyFriction, BANK_MAX_MULT, BANK_STEP, bankMultiplier, bankPayout, botPlan, coinWaveInterval, comboMultiplier,
  crownAndUnderdog, FAT_POUCH, GAME_DURATION_S, HEIST_AT_S, HEIST_BONUS_MULT, isHeist, isNearMiss, launchPower, launchVelocity, MAX_POWER,
  MAX_SPILL, MIN_DRAG, NEAR_MISS_PX, nextVaultPos, pickCoinTarget, rampFraction, resolveCollision, RESTITUTION, spillCount,
  startPositions, STEAL_CAP, STEAL_FORCE, stepBody, stealAmount, TOTAL_MULT_CAP, UNDERDOG_GAP, v2, vaultRadius, vdist, vlen, WALL_BOUNCE,
} from "./logic";
import type { Body, BotView } from "./logic";

const body = (x: number, y: number, vx = 0, vy = 0, mass = 1): Body => ({ pos: v2(x, y), vel: v2(vx, vy), radius: 20, mass });
const bounds = { x0: 0, y0: 0, x1: 1280, y1: 720 };

describe("flinging", () => {
  it("pulls back and flies the other way, capped at max power", () => {
    expect(launchVelocity(v2(100, 100), v2(100 + MIN_DRAG - 1, 100))).toBeNull();
    const v = launchVelocity(v2(100, 100), v2(140, 100))!;
    expect(v.x).toBeLessThan(0);
    expect(v.y).toBeCloseTo(0);
    expect(vlen(v)).toBeCloseTo(40 * 5.5);
    const far = launchVelocity(v2(100, 100), v2(100, 900))!;
    expect(vlen(far)).toBeCloseTo(MAX_POWER);
    expect(far.y).toBeLessThan(0);
    expect(vlen(launchVelocity(v2(100, 100), v2(100, 900), true)!)).toBeCloseTo(MAX_POWER * 2);
    expect(launchPower(v2(0, 0), v2(0, 5000))).toBe(1);
  });

  it("bot aim heads at the target and never exceeds max power", () => {
    const v = aimAt(v2(0, 0), v2(300, 0), 0, 0);
    expect(v.x).toBeGreaterThan(0);
    expect(v.y).toBeCloseTo(0);
    expect(vlen(aimAt(v2(0, 0), v2(3000, 0), 0, 500))).toBeCloseTo(MAX_POWER);
    const wobbled = aimAt(v2(0, 0), v2(300, 0), 0.3, 0);
    expect(wobbled.y).toBeGreaterThan(0);
  });
});

describe("physics", () => {
  it("friction bleeds speed per second regardless of step size", () => {
    const whole = applyFriction(v2(100, 0), 1);
    let stepped = v2(100, 0);
    for (let i = 0; i < 60; i++) stepped = applyFriction(stepped, 1 / 60);
    expect(stepped.x).toBeCloseTo(whole.x, 3);
    expect(whole.x).toBeLessThan(50);
  });

  it("walls bounce the ball back inside with a loss of speed", () => {
    const b = body(10, 100, -300, 0);
    expect(stepBody(b, 0.1, bounds)).toBe(1);
    expect(b.pos.x).toBe(20);
    expect(b.vel.x).toBeCloseTo(300 * WALL_BOUNCE);
    const corner = body(1275, 715, 400, 400);
    expect(stepBody(corner, 0.1, bounds)).toBe(2);
    expect(corner.vel.x).toBeLessThan(0);
    expect(corner.vel.y).toBeLessThan(0);
    const free = body(600, 300, 50, 0);
    expect(stepBody(free, 0.1, bounds)).toBe(0);
    expect(free.pos.x).toBeCloseTo(605);
  });

  it("collisions exchange momentum, separate the balls and name the attacker", () => {
    const a = body(100, 100, 400, 0);
    const b = body(130, 100);
    const hit = resolveCollision(a, b);
    expect(hit.force).toBeCloseTo(400);
    expect(hit.attacker).toBe("b");
    expect(vdist(a.pos, b.pos)).toBeGreaterThanOrEqual(40 - 1e-6);
    expect(b.vel.x).toBeGreaterThan(a.vel.x);
    expect(b.vel.x).toBeCloseTo(400 * (1 + RESTITUTION) / 2);
    expect(resolveCollision(body(0, 0), body(500, 0)).force).toBe(0);
  });

  it("a soft touch steals nothing and separating balls are ignored", () => {
    const soft = resolveCollision(body(100, 100, STEAL_FORCE - 1, 0), body(130, 100));
    expect(soft.force).toBeGreaterThan(0);
    expect(soft.attacker).toBeNull();
    const apart = resolveCollision(body(100, 100, -100, 0), body(130, 100, 100, 0));
    expect(apart.force).toBe(0);
  });

  it("heavier balls shove lighter ones and a held ball gives no ground", () => {
    const heavy = body(100, 100, 300, 0, 2);
    const light = body(130, 100);
    resolveCollision(heavy, light);
    expect(light.vel.x).toBeGreaterThan(heavy.vel.x);
    expect(heavy.vel.x).toBeGreaterThan(0);
    const held = body(100, 100);
    const mover = body(130, 100, -200, 0);
    resolveCollision(held, mover, { aHeld: true });
    expect(held.pos.x).toBe(100);
    expect(mover.pos.x).toBeCloseTo(140);
  });

  it("a shield pops and flings the attacker away", () => {
    const a = body(100, 100, 400, 0);
    const b = body(130, 100);
    const hit = resolveCollision(a, b, { bShield: true });
    expect(hit.shieldPopped).toBe("b");
    expect(hit.attacker).toBeNull();
    expect(a.vel.x).toBeLessThan(0);
    expect(b.vel.x).toBe(0);
  });
});

describe("pouch and vault", () => {
  it("multiplier steps with the pouch, caps, favours the underdog and climbs in the heist", () => {
    expect(bankMultiplier(0)).toBe(1);
    expect(bankMultiplier(BANK_STEP - 1)).toBe(1);
    expect(bankMultiplier(BANK_STEP)).toBe(2);
    expect(bankMultiplier(BANK_STEP * 2)).toBe(BANK_MAX_MULT);
    expect(bankMultiplier(BANK_STEP * 9)).toBe(BANK_MAX_MULT);
    expect(bankMultiplier(0, { underdog: true })).toBe(2);
    expect(bankMultiplier(BANK_STEP, { heist: true })).toBe(2 + HEIST_BONUS_MULT);
    expect(bankMultiplier(BANK_STEP * 3, { underdog: true, heist: true })).toBe(TOTAL_MULT_CAP);
    expect(bankMultiplier(0, { underdog: true, heist: true })).toBe(2 + HEIST_BONUS_MULT);
    expect(bankPayout(10)).toBe(20);
    expect(bankPayout(-3)).toBe(0);
  });

  it("steals take half the pouch, more from the crown, never more than the cap or the pouch", () => {
    expect(stealAmount(0, false)).toBe(0);
    expect(stealAmount(7, false)).toBe(4);
    expect(stealAmount(7, true)).toBe(6);
    expect(stealAmount(1, true)).toBe(1);
    expect(stealAmount(100, false)).toBe(STEAL_CAP);
    expect(stealAmount(100, true)).toBe(STEAL_CAP);
  });

  it("hard hits spill loose coins, capped", () => {
    expect(spillCount(0)).toBe(0);
    expect(spillCount(299)).toBe(0);
    expect(spillCount(300)).toBe(1);
    expect(spillCount(5000)).toBe(MAX_SPILL);
  });

  it("combo multiplier climbs every three pickups to x4", () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(2)).toBe(1);
    expect(comboMultiplier(3)).toBe(2);
    expect(comboMultiplier(9)).toBe(4);
    expect(comboMultiplier(30)).toBe(4);
  });

  it("crown goes to a unique leader, underdog to a unique trailing last place", () => {
    expect(crownAndUnderdog([0, 0])).toEqual({ leader: -1, underdog: -1 });
    expect(crownAndUnderdog([5, 5, 3])).toEqual({ leader: -1, underdog: -1 });
    expect(crownAndUnderdog([5, 2])).toEqual({ leader: 0, underdog: -1 });
    expect(crownAndUnderdog([UNDERDOG_GAP, 0])).toEqual({ leader: 0, underdog: 1 });
    expect(crownAndUnderdog([30, 20, 0, 0])).toEqual({ leader: 0, underdog: -1 });
    expect(crownAndUnderdog([30, 20, 20, 4])).toEqual({ leader: 0, underdog: 3 });
    expect(crownAndUnderdog([7])).toEqual({ leader: -1, underdog: -1 });
  });

  it("near miss needs loot aboard and a stop just outside the rim", () => {
    const vaultR = 40;
    const ballR = 20;
    expect(isNearMiss(vaultR + ballR + 10, vaultR, ballR, FAT_POUCH)).toBe(true);
    expect(isNearMiss(vaultR + ballR + NEAR_MISS_PX + 1, vaultR, ballR, FAT_POUCH)).toBe(false);
    expect(isNearMiss(vaultR + ballR - 1, vaultR, ballR, FAT_POUCH)).toBe(false);
    expect(isNearMiss(vaultR + ballR + 10, vaultR, ballR, FAT_POUCH - 1)).toBe(false);
  });

  it("vault relocates away from the balls and inside the arena", () => {
    const rng = new Rng(7);
    const balls = [v2(100, 100), v2(1180, 620)];
    for (let i = 0; i < 20; i++) {
      const p = nextVaultPos(rng, bounds, balls, 50, 250);
      expect(p.x).toBeGreaterThanOrEqual(70);
      expect(p.x).toBeLessThanOrEqual(1210);
      expect(p.y).toBeGreaterThanOrEqual(70);
      expect(p.y).toBeLessThanOrEqual(650);
      expect(Math.min(...balls.map((b) => vdist(p, b)))).toBeGreaterThanOrEqual(250);
    }
    // When every spot is crowded it still returns something in bounds.
    const crowd = nextVaultPos(rng, bounds, [v2(640, 360)], 50, 5000);
    expect(crowd.x).toBeGreaterThan(0);
    expect(crowd.y).toBeGreaterThan(0);
  });
});

describe("escalation", () => {
  it("heist starts in the last stretch and the ramp tops out", () => {
    expect(isHeist(HEIST_AT_S + 1)).toBe(false);
    expect(isHeist(HEIST_AT_S)).toBe(true);
    expect(rampFraction(0)).toBe(0);
    expect(rampFraction(1000)).toBe(1);
    expect(coinWaveInterval(0, false)).toBeGreaterThan(coinWaveInterval(40, false));
    expect(coinWaveInterval(1000, false)).toBeCloseTo(1.2);
    expect(coinWaveInterval(0, true)).toBeLessThan(coinWaveInterval(1000, false));
    expect(vaultRadius(20, 0)).toBeGreaterThan(vaultRadius(20, 1000));
    expect(HEIST_AT_S).toBeLessThan(GAME_DURATION_S);
  });

  it("start positions sit in the four corners", () => {
    const spots = startPositions(bounds, 80);
    expect(spots).toHaveLength(4);
    expect(spots[0]).toEqual(v2(80, 80));
    expect(spots[3]).toEqual(v2(1200, 640));
  });
});

describe("bots", () => {
  const view = (over: Partial<BotView> = {}): BotView => ({
    pos: v2(100, 100), pouch: 0, bankAt: 12, vault: v2(1000, 600),
    rivals: [], coins: [{ pos: v2(300, 100), value: 1 }], heist: false, timeLeft: 40, roll: 0.9, ...over,
  });

  it("chases the best coin when there is nothing better to do, wanders when there are none", () => {
    const plan = botPlan(view({ coins: [{ pos: v2(300, 100), value: 1 }, { pos: v2(400, 100), value: 10 }] }));
    expect(plan.kind).toBe("coin");
    expect(plan.target).toEqual(v2(400, 100));
    expect(botPlan(view({ coins: [] })).kind).toBe("wander");
    expect(pickCoinTarget(v2(0, 0), [])).toBeNull();
  });

  it("banks a fat pouch, a pouch near the vault, or anything when time is nearly up", () => {
    expect(botPlan(view({ pouch: 12 })).kind).toBe("bank");
    expect(botPlan(view({ pouch: FAT_POUCH, vault: v2(250, 100) })).kind).toBe("bank");
    expect(botPlan(view({ pouch: 1, timeLeft: 5 })).kind).toBe("bank");
    expect(botPlan(view({ pouch: 0, timeLeft: 5 })).kind).toBe("coin");
    expect(botPlan(view({ pouch: FAT_POUCH, heist: true, roll: 0.1 })).kind).toBe("bank");
    expect(botPlan(view({ pouch: 5 })).kind).toBe("coin");
  });

  it("rams a nearby fat pouch when in the mood, never a thin or far one", () => {
    const rich = { pos: v2(300, 100), pouch: 10, crowned: false };
    const ram = botPlan(view({ rivals: [rich], roll: 0.2 }));
    expect(ram.kind).toBe("ram");
    expect(ram.kind === "ram" && ram.rival).toBe(0);
    expect(botPlan(view({ rivals: [rich], roll: 0.8 })).kind).toBe("coin");
    expect(botPlan(view({ rivals: [{ ...rich, pouch: 2 }], roll: 0.2 })).kind).toBe("coin");
    expect(botPlan(view({ rivals: [{ ...rich, pos: v2(900, 100) }], roll: 0.2 })).kind).toBe("coin");
    const crownPlan = botPlan(view({ rivals: [rich, { pos: v2(300, 140), pouch: 10, crowned: true }], roll: 0.2 }));
    expect(crownPlan.kind === "ram" && crownPlan.rival).toBe(1);
  });
});

describe("whole match", () => {
  function context(kind: "human" | "bot", count: number): GameContext {
    return {
      width: 1280, height: 720, rng: new Rng(3), minTap: 44,
      players: Array.from({ length: count }, (_, slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind, slot })),
      canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) },
      input: { consumeClick: () => null, justPressed: () => false },
      sfx: new Proxy({}, { get: () => vi.fn() }),
    } as unknown as GameContext;
  }

  it("ends on time with idle humans; events can still roll them over loot", () => {
    const game = fling.create(context("human", 2));
    let frames = 0;
    while (!game.isFinished() && frames < 60 * 200) { game.update(1 / 60); frames++; }
    expect(game.isFinished()).toBe(true);
    expect(frames / 60).toBeGreaterThan(GAME_DURATION_S - 1);
    expect(frames / 60).toBeLessThan(GAME_DURATION_S + 5);
    const scores = game.getScores().map((s) => s.score);
    expect(scores).toHaveLength(2);
    for (const s of scores) expect(s).toBeGreaterThanOrEqual(0);
    game.destroy();
  });

  it("four bots bank, steal and finish inside the duration", () => {
    const game = fling.create(context("bot", 4));
    let frames = 0;
    while (!game.isFinished() && frames < 60 * 200) { game.update(1 / 60); frames++; }
    expect(game.isFinished()).toBe(true);
    const scores = game.getScores().map((s) => s.score);
    expect(scores).toHaveLength(4);
    expect(Math.max(...scores)).toBeGreaterThan(0);
    const stats = game.getStats!();
    expect(stats.some((s) => s.label === "Banked" && Number(s.value) > 0)).toBe(true);
    expect(stats.some((s) => s.label === "Best bank")).toBe(true);
    game.destroy();
  });
});

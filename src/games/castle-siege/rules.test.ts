import Matter from "matter-js";
import { describe, expect, it } from "vitest";
import { Rng } from "../../core/rng";
import {
  AMMO_WEIGHTS,
  BASE_AMMO_WEIGHTS,
  BREATH_MAX,
  BREATH_REGAIN,
  DECREES,
  FINAL_SUDDEN_DEATH_AFTER,
  GOLDEN_ODDS,
  GUST_STRENGTH,
  NEAR_MISS_PX,
  PIECE_SPECS,
  QUEUE_LENGTH,
  SUDDEN_DEATH_AFTER,
  WIND_MAX,
  botPick,
  comboCallout,
  dealOffers,
  dealQueue,
  gustFactor,
  impactDamage,
  isFinalRound,
  matchWinner,
  pieceHp,
  refillBreath,
  rollAmmo,
  rollDecree,
  rollWind,
  suddenDeathAfter,
  teamOf,
  type Decree,
} from "./rules";
import { SiegeWorld, ZONES, lotOf } from "./world";

describe("castle siege rules", () => {
  it("deals the same queue from the same seed", () => {
    expect(dealQueue(new Rng(7))).toHaveLength(QUEUE_LENGTH);
    expect(dealQueue(new Rng(7))).toEqual(dealQueue(new Rng(7)));
  });

  it("goes all bombs in sudden death", () => {
    const rng = new Rng(1);
    for (let i = 0; i < 20; i += 1) expect(rollAmmo(rng, SUDDEN_DEATH_AFTER)).toBe("bomb");
  });

  it("ammo odds sum to 1, keep the common proportions, and golden is rollable", () => {
    const total = Object.values(AMMO_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(AMMO_WEIGHTS.golden).toBeCloseTo(GOLDEN_ODDS, 10);
    expect(AMMO_WEIGHTS.ball / AMMO_WEIGHTS.boulder).toBeCloseTo(BASE_AMMO_WEIGHTS.ball / BASE_AMMO_WEIGHTS.boulder, 10);
    expect(AMMO_WEIGHTS.bomb / AMMO_WEIGHTS.triple).toBeCloseTo(BASE_AMMO_WEIGHTS.bomb / BASE_AMMO_WEIGHTS.triple, 10);
    const rng = new Rng(11);
    const rolls = Array.from({ length: 5000 }, () => rollAmmo(rng, 0));
    const golden = rolls.filter((a) => a === "golden").length / rolls.length;
    expect(golden).toBeGreaterThan(0.03);
    expect(golden).toBeLessThan(0.09);
  });

  it("keeps wind whole and inside ±max", () => {
    const rng = new Rng(3);
    const winds = Array.from({ length: 2000 }, () => rollWind(rng));
    expect(winds.every((w) => Number.isInteger(w) && Math.abs(w) <= WIND_MAX)).toBe(true);
  });

  it("ignores soft bumps and hurts hard hits more", () => {
    expect(impactDamage(2, false)).toBe(0);
    expect(impactDamage(6, false)).toBe(1);
    expect(impactDamage(16, false)).toBeGreaterThan(impactDamage(6, false));
    expect(impactDamage(6, true)).toBe(2);
  });

  it("alternates seats into teams and ends the match at two round wins", () => {
    expect([0, 1, 2, 3].map(teamOf)).toEqual([0, 1, 0, 1]);
    expect(matchWinner([1, 1])).toBeNull();
    expect(matchWinner([2, 1])).toBe(0);
    expect(matchWinner([0, 2])).toBe(1);
  });

  it("calls out combos", () => {
    expect(comboCallout(1)).toBeNull();
    expect(comboCallout(2)).toBe("DOUBLE SMASH!");
    expect(comboCallout(9)).toBe("DEMOLITION!");
  });

  it("deals two different public offers, and only bombs in sudden death", () => {
    const rng = new Rng(5);
    for (let i = 0; i < 200; i += 1) {
      const [a, b] = dealOffers(rng, 0);
      expect(a).not.toBe(b);
    }
    expect(dealOffers(rng, SUDDEN_DEATH_AFTER)).toEqual(["bomb", "bomb"]);
    const seen = new Set(Array.from({ length: 400 }, () => dealOffers(rng, 0)).flat());
    expect(seen.has("golden")).toBe(true);
    expect(seen.size).toBe(5);
  });

  it("goes to bombs sooner in the deciding round", () => {
    expect(isFinalRound(1)).toBe(false);
    expect(isFinalRound(3)).toBe(true);
    expect(suddenDeathAfter(1)).toBe(SUDDEN_DEATH_AFTER);
    expect(suddenDeathAfter(3)).toBe(FINAL_SUDDEN_DEATH_AFTER);
    expect(FINAL_SUDDEN_DEATH_AFTER).toBeLessThan(SUDDEN_DEATH_AFTER);
  });

  it("bots take golden, lean heavy against full lungs and bombs for a finish", () => {
    const calm = { blocks: 5, kingHp: 3, wind: 0, breath: 0 };
    expect(botPick(["ball", "golden"], calm)).toBe(1);
    expect(botPick(["golden", "bomb"], calm)).toBe(0);
    expect(botPick(["bomb", "boulder"], { ...calm, breath: 1 })).toBe(1);
    expect(botPick(["ball", "bomb"], { ...calm, kingHp: 1 })).toBe(1);
  });

  it("keeps round 1 classic and never repeats a decree while fresh ones remain", () => {
    const rng = new Rng(9);
    expect(rollDecree(rng, 1, [])).toBe("none");
    const used: Decree[] = [];
    for (let round = 2; round <= 5; round += 1) {
      const d = rollDecree(rng, round, used);
      expect(d).not.toBe("none");
      expect(used).not.toContain(d);
      used.push(d);
    }
    expect(rollDecree(rng, 6, used)).not.toBe("none");
  });

  it("decrees stay symmetric: same queue for both, brittle pieces, tall order kinds, shorter builds", () => {
    expect(pieceHp("plank", "none")).toBe(PIECE_SPECS.plank.hp);
    expect(pieceHp("plank", "brittle")).toBe(1);
    expect(pieceHp("block", "brittle")).toBe(2);
    const tall = dealQueue(new Rng(3), DECREES.tall.length, DECREES.tall.kinds);
    expect(tall.every((kind) => DECREES.tall.kinds.includes(kind))).toBe(true);
    expect(dealQueue(new Rng(3), DECREES.bulk.length, DECREES.bulk.kinds)).toHaveLength(6);
    for (const key of Object.keys(DECREES) as Decree[]) {
      if (key !== "none") expect(DECREES[key].buildSeconds).toBeLessThan(DECREES.none.buildSeconds);
    }
    expect(DECREES.narrow.lot).toBeLessThan(1);
  });

  it("bellows: heavy ammo resists the gust, breath refills a bit or fully for the underdog", () => {
    expect(gustFactor("golden")).toBeLessThan(gustFactor("boulder"));
    expect(gustFactor("boulder")).toBeLessThan(gustFactor("ball"));
    expect(gustFactor("bomb")).toBeGreaterThanOrEqual(gustFactor("ball"));
    expect(GUST_STRENGTH).toBeGreaterThan(WIND_MAX);
    expect(refillBreath(0, false)).toBeCloseTo(BREATH_REGAIN);
    expect(refillBreath(BREATH_MAX, false)).toBe(BREATH_MAX);
    expect(refillBreath(0, true)).toBe(BREATH_MAX);
  });
});

describe("castle siege world", () => {
  const cx = (ZONES[1].x0 + ZONES[1].x1) / 2;
  const run = (world: SiegeWorld, steps: number) => {
    for (let i = 0; i < steps; i += 1) world.step(1 / 60);
  };

  it("drops pieces from the sky without hurting anything while building", () => {
    const world = new SiegeWorld();
    world.placeKing(1, cx);
    expect(world.spawnPiece("block", cx, 1, 0)).toBe(true);
    run(world, 180);
    expect(world.kings[1]?.hp).toBe(3);
    expect(world.pieces).toHaveLength(2);
    world.destroyWorld();
  });

  it("narrow lots clamp kings and drops into the middle of the zone", () => {
    const world = new SiegeWorld();
    world.reset(0.5);
    const lot = lotOf(1, 0.5);
    expect(lot.x1 - lot.x0).toBeCloseTo((ZONES[1].x1 - ZONES[1].x0) / 2);
    const king = world.placeKing(1, ZONES[1].x0);
    expect(king.body.position.x).toBeGreaterThanOrEqual(lot.x0);
    const body = world.dropBody("cube", ZONES[1].x1, 1, 0);
    expect(body).not.toBeNull();
    expect(body!.bounds.max.x).toBeLessThanOrEqual(lot.x1 + 1);
    world.destroyWorld();
  });

  it("the defender's gust pushes a light ball back further than a boulder", () => {
    const flight = (ammo: "ball" | "boulder", gust: number) => {
      const world = new SiegeWorld();
      world.gust = [0, gust];
      world.fire(0, ammo, 22, -12);
      run(world, 40);
      const x = world.balls[0]!.body.position.x;
      world.destroyWorld();
      return x;
    };
    const plain = flight("ball", 0);
    const blown = flight("ball", GUST_STRENGTH);
    const boulder = flight("boulder", GUST_STRENGTH);
    expect(blown).toBeLessThan(plain - 60);
    expect(boulder).toBeGreaterThan(blown + 30);
    expect(boulder).toBeLessThan(plain);
  });

  it("reports a near miss when a shot whistles past the king without touching it", () => {
    const world = new SiegeWorld();
    const king = world.placeKing(1, cx);
    run(world, 30);
    world.damageOn = true;
    world.fire(0, "ball", 0, 0);
    const ball = world.balls[0]!;
    // Drop it just beside the king so it lands on the ground without touching him.
    Matter.Body.setPosition(ball.body, { x: king.body.position.x + NEAR_MISS_PX - 6, y: king.body.position.y - 120 });
    Matter.Body.setVelocity(ball.body, { x: 0, y: 4 });
    run(world, 90);
    const events = world.drainEvents();
    expect(events.some((e) => e.type === "nearMiss" && e.team === 0)).toBe(true);
    expect(king.hp).toBe(3);
    world.destroyWorld();
  });

  it("a bomb next to the king knocks it out of HP", () => {
    const world = new SiegeWorld();
    const king = world.placeKing(1, cx);
    run(world, 30);
    world.damageOn = true;
    world.fire(0, "bomb", 0, 0);
    const bomb = world.balls[0]!;
    // Drop the bomb right onto the king.
    Matter.Body.setPosition(bomb.body, { x: king.body.position.x, y: king.body.position.y - 60 });
    Matter.Body.setVelocity(bomb.body, { x: 0, y: 2 });
    run(world, 60);
    const events = world.drainEvents();
    expect(events.some((e) => e.type === "boom")).toBe(true);
    expect(king.hp).toBeLessThan(3);
    world.destroyWorld();
  });
});

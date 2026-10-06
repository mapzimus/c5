import Matter from "matter-js";
import { describe, expect, it } from "vitest";
import { Rng } from "../../core/rng";
import {
  AMMO_WEIGHTS,
  BASE_AMMO_WEIGHTS,
  GOLDEN_ODDS,
  QUEUE_LENGTH,
  SUDDEN_DEATH_AFTER,
  WIND_MAX,
  comboCallout,
  dealQueue,
  impactDamage,
  matchWinner,
  rollAmmo,
  rollWind,
  teamOf,
} from "./rules";
import { SiegeWorld, ZONES } from "./world";

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

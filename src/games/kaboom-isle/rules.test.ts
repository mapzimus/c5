import { describe, expect, it } from "vitest";
import { Rng } from "../../core/rng";
import { chooseTarget, planShot } from "./bots";
import { PERSONAS, QUIPS, personaFor, quip } from "./quips";
import { bountyReward, bountyTarget, hitCallout, koCallouts, pickEvent, suddenDeathTurn, underdogLuck } from "./rules";
import { World, weaponById, type Fighter } from "./world";

function fighter(index: number, hp: number, kos = 0, alive = true): Fighter {
  return { index, x: 0, y: 0, vx: 0, vy: 0, hp, alive, grounded: true, diedOnTurn: -1, killedBy: null, damageDealt: 0, kos, bestHit: 0, hurt: 0, crates: 0 };
}

describe("Kaboom Isle rules", () => {
  it("puts a bounty on a clear leader only", () => {
    expect(bountyTarget([fighter(0, 100), fighter(1, 95)])).toBeNull();
    expect(bountyTarget([fighter(0, 60), fighter(1, 90)])).toBe(1);
    // KOs count toward the lead.
    expect(bountyTarget([fighter(0, 70, 1), fighter(1, 90), fighter(2, 80)])).toBe(0);
    expect(bountyTarget([fighter(0, 100), fighter(1, 10, 0, false)])).toBeNull();
    expect(bountyReward(30, false)).toBe(15);
    expect(bountyReward(0, true)).toBe(25);
  });

  it("gives underdog luck to whoever is clearly behind", () => {
    const fs = [fighter(0, 100), fighter(1, 30), fighter(2, 90)];
    expect(underdogLuck(fs, 0)).toBe(0);
    expect(underdogLuck(fs, 2)).toBe(0);
    expect(underdogLuck(fs, 1)).toBeGreaterThan(0.5);
    expect(underdogLuck(fs, 1)).toBeLessThanOrEqual(1);
  });

  it("holds off chaos events for the first two rounds and never repeats back to back", () => {
    const rng = new Rng(2);
    for (let i = 0; i < 200; i++) {
      expect(pickEvent(rng, 1, null)).toBeNull();
      expect(pickEvent(rng, 2, null)).toBeNull();
      expect(pickEvent(rng, 5, "quake")).not.toBe("quake");
    }
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(String(pickEvent(rng, 4, null)));
    expect(seen.size).toBe(7); // six events + null
  });

  it("announces self-owns, multi-kills, revenge, bounties and first blood", () => {
    const base = { shooter: 0, victim: 1, koThisTurn: 1, firstBlood: false, revenge: false, bounty: false };
    expect(koCallouts({ ...base, shooter: 1 })).toEqual(["SELF-OWN!"]);
    expect(koCallouts({ ...base, koThisTurn: 2 })).toEqual(["DOUBLE KILL!"]);
    expect(koCallouts({ ...base, koThisTurn: 3, bounty: true })).toEqual(["TRIPLE KILL!", "BOUNTY CLAIMED!"]);
    expect(koCallouts({ ...base, revenge: true, firstBlood: true })).toEqual(["REVENGE!", "FIRST BLOOD!"]);
    expect(koCallouts({ ...base, shooter: null, firstBlood: true })).toEqual([]);
    expect(hitCallout(20)).toBeNull();
    expect(hitCallout(45)).toBe("DIRECT HIT!");
    expect(hitCallout(60)).toBe("OBLITERATED!");
  });

  it("starts sudden death after six rounds, capped for big tables", () => {
    expect(suddenDeathTurn(2)).toBe(12);
    expect(suddenDeathTurn(4)).toBe(24);
  });

  it("quips and personas are well formed", () => {
    const rng = new Rng(1);
    for (const kind of Object.keys(QUIPS) as (keyof typeof QUIPS)[]) expect(QUIPS[kind]).toContain(quip(kind, rng));
    expect(new Set([0, 1, 2, 3].map(personaFor)).size).toBe(4);
    for (const p of Object.values(PERSONAS)) expect(p.turnLines.length).toBeGreaterThan(2);
  });
});

describe("Kaboom Isle bots", () => {
  it("snipers hunt the bounty and grudges hunt their nemesis", () => {
    const world = new World(1280, 720, new Rng(8), 4);
    const me = world.fighters[0]!;
    const rng = new Rng(1);
    expect(chooseTarget("sniper", me, world, { nemesis: null, bounty: 2 }, rng)).toBe(world.fighters[2]);
    expect(chooseTarget("grudge", me, world, { nemesis: 3, bounty: null }, rng)).toBe(world.fighters[3]);
    world.fighters[3]!.alive = false;
    const t = chooseTarget("grudge", me, world, { nemesis: 3, bounty: null }, rng);
    expect(t).not.toBe(world.fighters[3]);
  });

  it("aims a bomb near the target and a teleporter at solid ground", () => {
    const world = new World(1280, 720, new Rng(8), 2);
    const [me, foe] = world.fighters as [Fighter, Fighter];
    const shot = planShot(world, me, weaponById("bomb"), foe, "sniper", new Rng(3), 0);
    const land = world.predict(0, shot.angle, shot.power);
    expect(Math.hypot(land.x - foe.x, land.y - foe.y)).toBeLessThan(120);
    const tp = planShot(world, me, weaponById("teleport"), foe, "sniper", new Rng(3), 0);
    const spot = world.predict(0, tp.angle, tp.power);
    expect(spot.y).toBeLessThan(world.lava - 50);
    expect(world.solidAt(spot.x, spot.y)).toBe(true);
  });
});

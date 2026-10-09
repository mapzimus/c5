import { describe, expect, it } from "vitest";
import { Rng } from "../../core/rng";
import { WEAPONS, World, rollWeapon } from "./world";

describe("Kaboom Isle world", () => {
  it("spawns every fighter standing on ground above the lava", () => {
    for (let seed = 1; seed < 30; seed++) {
      const world = new World(1280, 720, new Rng(seed), 4);
      for (let i = 0; i < 120; i++) world.step(1 / 60, 0);
      if (world.alive().length !== 4) throw new Error(`seed ${seed}: ${JSON.stringify(world.fighters.map((f) => [f.alive, Math.round(f.x), Math.round(f.y), f.hp]))}`);
      for (const f of world.fighters) expect(f.y).toBeLessThan(world.lava);
    }
  });

  it("a bomb blast carves terrain and hurts nearby fighters", () => {
    const world = new World(1280, 720, new Rng(3), 2);
    const f = world.fighters[1]!;
    const before = world.tiles.reduce((s, t) => s + t, 0);
    world.blast(f.x, f.y + 10, 52, 34, 520, WEAPONS[0]!, 0, 1);
    expect(world.tiles.reduce((s, t) => s + t, 0)).toBeLessThan(before);
    expect(f.hp).toBeLessThan(100);
    expect(world.fighters[0]!.damageDealt).toBeGreaterThan(0);
  });

  it("weapon rolls hit every weapon including the jackpot", () => {
    const rng = new Rng(7);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(rollWeapon(rng).id);
    expect(seen.size).toBe(WEAPONS.length);
  });
});

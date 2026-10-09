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

  it("teleporter moves the shooter to where it lands", () => {
    const world = new World(1280, 720, new Rng(5), 2);
    const tp = WEAPONS.find((w) => w.id === "teleport")!;
    const me = world.fighters[0]!;
    const startX = me.x;
    world.fire(0, me.x < 640 ? 0.9 : Math.PI - 0.9, 0.45, tp);
    for (let i = 0; i < 300 && world.shots.length > 0; i++) world.step(1 / 60, 1);
    if (me.alive) expect(Math.abs(me.x - startX)).toBeGreaterThan(30);
    expect(world.events.some((e) => e.type === "teleport") || !me.alive || world.ghosts[0]).toBeTruthy();
  });

  it("black hole pulls fighters in, then pops", () => {
    const world = new World(1280, 720, new Rng(9), 2);
    const f = world.fighters[1]!;
    world.vortices.push({ x: f.x + 120, y: f.y - 40, life: 1.6, owner: 0, dmgMul: 1 });
    const x0 = f.x;
    let popped = false;
    let maxX = x0;
    for (let i = 0; i < 120; i++) {
      popped ||= world.step(1 / 60, 1).length > 0;
      if (!popped) maxX = Math.max(maxX, f.x);
    }
    expect(maxX).toBeGreaterThan(x0 + 20);
    expect(popped).toBe(true);
    expect(world.vortices.length).toBe(0);
  });

  it("crates land and are grabbed by touch; double damage doubles the next shot", () => {
    const world = new World(1280, 720, new Rng(4), 2);
    const f = world.fighters[0]!;
    world.crates.push({ x: f.x, y: f.y - 60, kind: "double", landed: false, dead: false });
    for (let i = 0; i < 120; i++) world.step(1 / 60, 1);
    expect(world.crates.length).toBe(0);
    expect(f.doubleDamage).toBe(true);
    world.fire(0, Math.PI / 2, 0.3, WEAPONS[0]!);
    expect(world.shots[0]!.dmgMul).toBe(2);
    expect(f.doubleDamage).toBe(false);
  });

  it("shield halves one hit", () => {
    const world = new World(1280, 720, new Rng(3), 2);
    const f = world.fighters[1]!;
    f.shield = true;
    world.blast(f.x, f.y, 52, 40, 0, WEAPONS[0]!, 0, 1);
    expect(f.hp).toBe(80);
    expect(f.shield).toBe(false);
  });

  it("perks change the fighters they belong to", () => {
    const world = new World(1280, 720, new Rng(6), 2, [["tough", "tough"], ["heavy"]]);
    expect(world.fighters[0]!.hp).toBe(160);
    expect(world.fighters[1]!.hp).toBe(100);
    const a = world.fighters[1]!;
    const vx0 = a.vx;
    world.blast(a.x - 30, a.y, 60, 0, 1000, WEAPONS[0]!, 0, 1);
    expect(a.vx - vx0).toBeLessThan(700);
  });

  it("fireproof bounces you out of the lava once", () => {
    const world = new World(1280, 720, new Rng(8), 2, [["fireproof"], []]);
    const f = world.fighters[0]!;
    // Far left edge has no ground, only lava.
    f.x = 20;
    f.y = world.lava + 5;
    world.step(1 / 60, 1);
    expect(f.alive).toBe(true);
    expect(f.vy).toBeLessThan(0);
    f.x = 20;
    f.y = world.lava + 20;
    f.vx = 0;
    f.vy = 0;
    world.step(1 / 60, 1);
    expect(f.alive).toBe(false);
  });
});

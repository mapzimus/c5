import { describe, expect, it } from "vitest";
import { Rng } from "../../core/rng";
import { SWAT_MUL, SWAT_WINDOW, UNDERDOG_MUL, WEAPONS, World, rollWeapon } from "./world";

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

  it("a bomb flying close opens a swat window; swatting sends it back at the shooter, harder", () => {
    const world = new World(1280, 720, new Rng(3), 2);
    const me = world.fighters[1]!;
    const them = world.fighters[0]!;
    // Hang a slow bomb just outside swat range, drifting at us.
    world.shots.push({ x: me.x - 150, y: me.y - 10, vx: 120, vy: 0, weapon: WEAPONS[0]!, owner: 0, age: 1, mini: false, dead: false, trail: [], dmgMul: 1, drilling: 0 });
    world.gravity = 0;
    expect(me.swatWindow).toBe(0);
    let opened = false;
    for (let i = 0; i < 60 && !opened; i++) {
      world.step(1 / 60, 1);
      opened = world.events.some((e) => e.type === "swatWindow" && e.index === 1);
    }
    expect(opened).toBe(true);
    expect(me.swatWindow).toBeGreaterThan(0);
    expect(me.swatWindow).toBeLessThanOrEqual(SWAT_WINDOW);
    const shot = world.swat(1);
    expect(shot).not.toBeNull();
    expect(shot!.owner).toBe(1);
    expect(shot!.dmgMul).toBe(SWAT_MUL);
    expect(shot!.swatted).toBe(true);
    // Heads back toward the shooter, not toward us.
    expect(Math.sign(shot!.vx)).toBe(Math.sign(them.x - me.x));
    expect(me.swats).toBe(0);
    expect(world.swat(1)).toBeNull();
    expect(world.events.some((e) => e.type === "swat" && e.owner === 0)).toBe(true);
  });

  it("a swat spent is spent: the window never reopens without a charge", () => {
    const world = new World(1280, 720, new Rng(3), 2);
    const me = world.fighters[1]!;
    me.swats = 0;
    world.gravity = 0;
    world.shots.push({ x: me.x - 100, y: me.y, vx: 60, vy: 0, weapon: WEAPONS[0]!, owner: 0, age: 1, mini: false, dead: false, trail: [], dmgMul: 1, drilling: 0 });
    for (let i = 0; i < 30; i++) world.step(1 / 60, 1);
    expect(me.swatWindow).toBe(0);
    expect(world.events.some((e) => e.type === "swatWindow")).toBe(false);
  });

  it("only ghosts can gust; a gust shifts the wind, is capped, and marks shots in flight for haunt credit", () => {
    const world = new World(1280, 720, new Rng(5), 3);
    world.wind = 0;
    expect(world.gust(0, 1)).toBe(false);
    world.kill(world.fighters[0]!, 1, null);
    world.shots.push({ x: 300, y: 100, vx: 0, vy: 0, weapon: WEAPONS[0]!, owner: 1, age: 0, mini: false, dead: false, trail: [], dmgMul: 1, drilling: 0 });
    expect(world.gust(0, 1)).toBe(true);
    expect(world.wind).toBeCloseTo(0.45);
    expect(world.shots[0]!.gusted).toBe(0);
    for (let i = 0; i < 10; i++) world.gust(0, 1);
    expect(world.wind).toBeLessThanOrEqual(1.6);
    world.gust(0, -1);
    expect(world.wind).toBeCloseTo(1.15);
    // A gusted shot that hurts someone credits the ghost.
    const victim = world.fighters[2]!;
    world.blast(victim.x, victim.y, 52, 34, 0, WEAPONS[0]!, 1, 1, { gusted: 0 });
    expect(world.fighters[0]!.haunts).toBe(1);
    expect(world.events.some((e) => e.type === "haunt" && e.index === 0)).toBe(true);
  });

  it("heat and the underdog bonus scale damage", () => {
    const world = new World(1280, 720, new Rng(3), 3);
    const target = world.fighters[1]!;
    world.blast(target.x, target.y, 52, 40, 0, WEAPONS[0]!, 0, 1);
    expect(target.hp).toBe(60);
    world.damageMul = 1.5;
    world.blast(target.x, target.y, 52, 40, 0, WEAPONS[0]!, 0, 1);
    expect(target.hp).toBe(0);
    expect(target.alive).toBe(false);
    // The lowest survivor by a clear margin becomes the underdog and hits harder.
    const low = world.fighters[2]!;
    low.hp = 30;
    expect(world.markUnderdog()).toBe(2);
    expect(low.underdog).toBe(true);
    world.damageMul = 1;
    const foe = world.fighters[0]!;
    world.blast(foe.x, foe.y, 52, 40, 0, WEAPONS[0]!, 2, 1);
    expect(foe.hp).toBe(100 - Math.round(40 * UNDERDOG_MUL));
    foe.hp = 40;
    expect(world.markUnderdog()).toBeNull();
    expect(low.underdog).toBe(false);
  });

  it("a fighter resting a foot on a ledge edge stays grounded so the world settles", () => {
    for (let seed = 1; seed < 12; seed++) {
      const world = new World(1280, 616, new Rng(seed), 4);
      for (let i = 0; i < 90; i++) world.step(1 / 60, 0);
      // Nudge everyone sideways onto whatever edge is nearby, then let them come to rest.
      for (const f of world.fighters) f.vx = seed % 2 ? 90 : -90;
      for (let i = 0; i < 240; i++) world.step(1 / 60, 0);
      let settledFrames = 0;
      for (let i = 0; i < 30; i++) {
        world.step(1 / 60, 0);
        if (world.settled()) settledFrames++;
      }
      expect(settledFrames).toBe(30);
    }
  });
});

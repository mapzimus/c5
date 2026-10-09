import { describe, expect, it } from "vitest";
import { Rng } from "../../core/rng";
import { WEAPONS, World, rollWeapon, weaponById, type Blast, type Fighter } from "./world";

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

function settle(world: World, max = 900): Blast[] {
  const all: Blast[] = [];
  for (let i = 0; i < max; i++) {
    all.push(...world.step(1 / 60, 1));
    if (i > 5 && world.shots.length === 0) break;
  }
  return all;
}

describe("Kaboom Isle new toys", () => {
  it("crates parachute down, land, and a blast pops them for the shooter", () => {
    const world = new World(1280, 720, new Rng(5), 2);
    const target = world.fighters[1]!;
    const x = target.x + 70;
    const crate = world.dropCrate("health", x);
    for (let i = 0; i < 60 * 15 && !crate.landed; i++) world.step(1 / 60, 0);
    expect(crate.landed).toBe(true);
    expect(crate.y).toBeLessThan(world.lava);
    world.fighters[0]!.hp = 40;
    world.blast(crate.x, crate.y, 30, 0, 0, weaponById("chicken"), 0, 1);
    expect(world.pickups).toHaveLength(1);
    expect(world.pickups[0]!.by).toBe(0);
    expect(world.fighters[0]!.hp).toBe(75);
    expect(world.fighters[0]!.crates).toBe(1);
  });

  it("booby-trap crates explode without crediting anyone a KO", () => {
    const world = new World(1280, 720, new Rng(5), 2);
    const f = world.fighters[1]!;
    f.hp = 5;
    const crate = world.dropCrate("trap", f.x);
    crate.y = f.y - 30;
    crate.landed = true;
    world.blast(crate.x, crate.y - 10, 20, 0, 0, weaponById("chicken"), 0, 1);
    expect(f.alive).toBe(false);
    expect(f.killedBy).toBeNull();
    expect(world.fighters[0]!.kos).toBe(0);
  });

  it("teleporter beams the shooter where it lands, and swaps on a direct hit", () => {
    const world = new World(1280, 720, new Rng(9), 2);
    const [a, b] = world.fighters as [Fighter, Fighter];
    const ax = a.x;
    const bx = b.x;
    world.shots.push({ x: b.x, y: b.y - 40, vx: 0, vy: 200, weapon: weaponById("teleport"), owner: 0, age: 1, mini: false, dead: false, trail: [] });
    const blasts = settle(world, 120);
    const tp = blasts.find((x) => x.teleport);
    expect(tp?.teleport?.swapped).toBe(1);
    expect(Math.abs(a.x - bx)).toBeLessThan(30);
    expect(Math.abs(b.x - ax)).toBeLessThan(30);
  });

  it("teleporting into the lava is a self-KO", () => {
    const world = new World(1280, 720, new Rng(9), 2);
    world.shots.push({ x: 640, y: world.lava - 5, vx: 0, vy: 300, weapon: weaponById("teleport"), owner: 0, age: 1, mini: false, dead: false, trail: [] });
    const blasts = settle(world, 30);
    expect(blasts.some((x) => x.teleport?.lava)).toBe(true);
    expect(world.fighters[0]!.alive).toBe(false);
    expect(world.fighters[1]!.kos).toBe(0);
  });

  it("the drill burrows into the ground before it blows", () => {
    const world = new World(1280, 720, new Rng(4), 2);
    const x = (world.fighters[0]!.x + world.fighters[1]!.x) / 2;
    let surface = world.surfaceY(x);
    let col = x;
    for (let dx = 0; surface === null && dx < 600; dx += 8) {
      col = x + dx;
      surface = world.surfaceY(col);
    }
    world.shots.push({ x: col, y: surface! - 60, vx: 0, vy: 300, weapon: weaponById("drill"), owner: 0, age: 1, mini: false, dead: false, trail: [] });
    const blasts = settle(world, 300).filter((b) => b.weapon.id === "drill" && !b.splash);
    expect(blasts).toHaveLength(1);
    expect(blasts[0]!.y).toBeGreaterThan(surface! + 60);
  });

  it("an airstrike flare calls in a line of bombs from the sky", () => {
    const world = new World(1280, 720, new Rng(4), 2);
    world.shots.push({ x: 640, y: 50, vx: 0, vy: 50, weapon: weaponById("airstrike"), owner: 0, age: 1, mini: false, dead: false, trail: [] });
    let flare: Blast | undefined;
    for (let i = 0; i < 600 && !flare; i++) flare = world.step(1 / 60, 1).find((b) => b.flare);
    expect(flare).toBeDefined();
    const bombers = world.shots.filter((s) => s.mini && s.weapon.id === "airstrike");
    expect(bombers).toHaveLength(5);
    expect(bombers.every((s) => s.y < 0)).toBe(true);
  });

  it("the homing sheep hunts down an enemy", () => {
    const world = new World(1280, 720, new Rng(6), 2);
    const enemy = world.fighters[1]!;
    world.shots.push({ x: enemy.x - 260, y: 60, vx: 0, vy: -100, weapon: weaponById("sheep"), owner: 0, age: 0, mini: false, dead: false, trail: [] });
    const blasts = settle(world, 600).filter((b) => b.weapon.id === "sheep");
    expect(blasts.some((b) => b.hits.some((h) => h.index === 1))).toBe(true);
  });

  it("a banana bomb splits into five banana bomblets", () => {
    const world = new World(1280, 720, new Rng(6), 2);
    world.shots.push({ x: 640, y: 40, vx: 0, vy: 0, weapon: weaponById("banana"), owner: 0, age: 2.19, mini: false, dead: false, trail: [] });
    world.step(1 / 60, 1);
    expect(world.shots.filter((s) => s.mini && s.weapon.id === "banana")).toHaveLength(5);
  });

  it("meteors and earthquakes never credit KOs and keep the world sane", () => {
    const world = new World(1280, 720, new Rng(12), 3);
    world.fighters.forEach((f) => (f.hp = 1));
    world.meteorShower(20);
    world.quake();
    settle(world, 900);
    expect(world.fighters.every((f) => f.kos === 0)).toBe(true);
  });

  it("the island split cuts a gap to the lava away from every blob", () => {
    const world = new World(1280, 720, new Rng(3), 2);
    const x = world.split();
    expect(x).not.toBeNull();
    for (let y = 0; y < world.lava; y += 8) expect(world.solidAt(x!, y)).toBe(false);
    for (const f of world.fighters) expect(Math.abs(f.x - x!)).toBeGreaterThanOrEqual(70);
  });

  it("underdog luck makes jackpot weapons more common", () => {
    const count = (luck: number) => {
      const rng = new Rng(11);
      let rare = 0;
      for (let i = 0; i < 3000; i++) if (rollWeapon(rng, luck).rare) rare++;
      return rare;
    };
    expect(count(1)).toBeGreaterThan(count(0) * 1.6);
  });
});

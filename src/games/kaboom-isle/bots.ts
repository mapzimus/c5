import type { Rng } from "../../core/rng";
import { PERSONAS, type Persona } from "./quips";
import type { Fighter, Weapon, World } from "./world";

export const AIM_MIN = 0.1;
export const AIM_MAX = Math.PI - 0.1;

export interface BotMemory {
  /** Who last hit this bot. */
  nemesis: number | null;
  bounty: number | null;
}

/** Who (or what) a bot wants to hit, by personality. */
export function chooseTarget(persona: Persona, me: Fighter, world: World, memory: BotMemory, rng: Rng): { x: number; y: number } | null {
  const enemies = world.alive().filter((f) => f.index !== me.index);
  if (enemies.length === 0) return null;
  const dist = (f: { x: number; y: number }) => Math.hypot(f.x - me.x, f.y - me.y);
  const nearest = [...enemies].sort((a, b) => dist(a) - dist(b))[0]!;
  switch (persona) {
    case "hothead":
      return nearest;
    case "sniper": {
      const bounty = enemies.find((f) => f.index === memory.bounty);
      if (bounty) return bounty;
      return [...enemies].sort((a, b) => a.hp - b.hp)[0]!;
    }
    case "clown": {
      const crates = world.crates.filter((c) => c.landed);
      if (crates.length > 0 && rng.next() < 0.35) return rng.pick(crates);
      return rng.pick(enemies);
    }
    case "grudge": {
      const nemesis = enemies.find((f) => f.index === memory.nemesis);
      return nemesis ?? nearest;
    }
  }
}

/**
 * Search angles/powers for a good shot with this weapon, then fumble it by personality.
 * `rust` > 1 widens the fumble (bots warm up over the first round).
 */
export function planShot(world: World, me: Fighter, weapon: Weapon, target: { x: number; y: number } | null, persona: Persona, rng: Rng, rust = 1): { angle: number; power: number } {
  const info = PERSONAS[persona];
  const goal = target ?? { x: world.width / 2, y: world.height / 2 };
  let best = { angle: Math.PI / 2, power: 0.5, score: Infinity };
  if (weapon.id === "sheep") {
    // The sheep does its own hunting: just lob it toward the target's side.
    best = { angle: goal.x >= me.x ? 1.15 : Math.PI - 1.15, power: 0.6, score: 0 };
  } else {
    const enemies = world.alive().filter((f) => f.index !== me.index);
    const danger = weapon.id === "airstrike" ? 130 : (weapon.child?.radius ?? 0) + weapon.radius + 12;
    for (let a = AIM_MIN + 0.05; a < AIM_MAX - 0.05; a += 0.06) {
      for (let p = 0.2; p <= 1; p += 0.05) {
        const land = world.predict(me.index, a, p);
        let score: number;
        if (weapon.id === "teleport") {
          const onGround = land.y < world.lava - 50 && land.x > 20 && land.x < world.width - 20 && world.solidAt(land.x, land.y);
          score = onGround ? land.y + (enemies.some((e) => Math.hypot(e.x - land.x, e.y - land.y) < 90) ? 250 : 0) : 1e6;
        } else {
          score = Math.hypot(goal.x - land.x, goal.y - land.y);
          if (weapon.id === "airstrike") score = Math.abs(goal.x - land.x) + (land.y > world.lava ? 200 : 0);
          if (Math.hypot(me.x - land.x, me.y - land.y) < danger) score += 400;
        }
        if (score < best.score) best = { angle: a, power: p, score };
      }
    }
  }
  return {
    angle: Math.min(AIM_MAX, Math.max(AIM_MIN, best.angle + rng.float(-info.aimError, info.aimError) * rust)),
    power: Math.min(1, Math.max(0.02, best.power + rng.float(-info.powerError, info.powerError) * rust)),
  };
}

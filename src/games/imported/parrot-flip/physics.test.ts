import { describe, expect, it } from "vitest";
import { Rng } from "../../../core/rng";
import { ParrotPhysics } from "./physics";
import { botFlick } from "./rules";

function median(xs: number[]): number {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  return a[Math.floor(a.length / 2)]!;
}

function flight(physics: ParrotPhysics, w: number, h: number, inset: number, vx: number, vy: number) {
  physics.init(w, h, inset);
  const startY = physics.getBottle()!.position.y;
  const startA = physics.getBottle()!.angle;
  const groundY = physics.getGroundY();
  physics.applyFlick(vx, vy);
  let minY = startY;
  let landTurns: number | null = null;
  for (let i = 0; i < 240; i += 1) {
    physics.step(1 / 60);
    const b = physics.getBottle()!;
    minY = Math.min(minY, b.position.y);
    if (landTurns == null && i > 8 && b.position.y >= groundY - 88 && b.velocity.y > 0) {
      landTurns = Math.abs(b.angle - startA) / (2 * Math.PI);
    }
  }
  return { peak: startY - minY, minY, landTurns };
}

function verdict(physics: ParrotPhysics, vy: number): string {
  physics.init(390, 844, 170);
  physics.applyFlick(0, vy);
  for (let i = 0; i < 360; i += 1) {
    physics.step(1 / 60);
    const result = physics.checkLanding();
    if (result) return result;
  }
  return "NONE";
}

describe("parrot physics", () => {
  it("sends a mid flick high enough for about one turn on a phone", () => {
    const physics = new ParrotPhysics(() => 0.5);
    const mid = [];
    for (let i = 0; i < 7; i += 1) {
      mid.push(flight(new ParrotPhysics(() => 0.5 + i * 0.01), 390, 844, 170, 0, -2100));
    }
    const peak = median(mid.map((f) => f.peak));
    const minY = median(mid.map((f) => f.minY));
    const turns = median(mid.map((f) => f.landTurns ?? NaN));
    expect(peak).toBeGreaterThanOrEqual(330);
    expect(minY).toBeGreaterThan(120);
    expect(turns).toBeGreaterThanOrEqual(0.88);
    expect(turns).toBeLessThanOrEqual(1.28);
    physics.destroy();
  });

  it("keeps a soft flick under-rotated", () => {
    const flights = [];
    for (let i = 0; i < 7; i += 1) {
      flights.push(flight(new ParrotPhysics(() => 0.45 + i * 0.02), 390, 844, 170, 0, -900));
    }
    const turns = median(flights.map((f) => f.landTurns ?? NaN));
    expect(turns).toBeLessThan(0.98);
  });

  it("makes a sweet-spot flick usually, not always", () => {
    // Seeded so the sampled make rate is repeatable; unseeded, 40 samples drift
    // outside the bounds below about one run in twenty.
    const rng = new Rng(1);
    const physics = new ParrotPhysics(() => rng.next());
    let makes = 0;
    const n = 40;
    for (let i = 0; i < n; i += 1) {
      if (verdict(physics, -2100) === "MAKE") makes += 1;
    }
    const rate = makes / n;
    expect(rate).toBeGreaterThanOrEqual(0.4);
    expect(rate).toBeLessThanOrEqual(0.75);
    physics.destroy();
  });
});

describe("parrot landings always resolve", () => {
  it("every bot flick on the party table gets a verdict within four seconds", () => {
    const rng = new Rng(21);
    const physics = new ParrotPhysics(() => rng.next());
    physics.init(1280, 720, 8);
    let longest = 0;
    for (let i = 0; i < 200; i += 1) {
      physics.resetBottle();
      const aim = rng.next() < 0.45 ? { dx: rng.sign() * rng.float(120, 230), skill: rng.float(0.2, 0.8) } : null;
      const flick = botFlick(rng, aim);
      physics.applyFlick(flick.vx, flick.vy);
      let t = 0;
      let result: string | null = null;
      while (t < 8 && !result) {
        physics.step(1 / 60);
        t += 1 / 60;
        result = physics.checkLanding();
      }
      expect(result).not.toBeNull();
      longest = Math.max(longest, t);
    }
    expect(longest).toBeLessThan(4);
    physics.destroy();
  });
});

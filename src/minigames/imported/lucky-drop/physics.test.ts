import { describe, expect, it } from "vitest";
import { Rng } from "../../../core/rng";
import { DropWorld } from "./physics";
import { botAim } from "./rules";

function advance(world: DropWorld, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 120); i++) world.step(1 / 120);
}

describe("Lucky Drop physics", () => {
  it("rolls the advertised 65/25/10 probability boundaries", () => {
    for (const [roll, tier] of [[0, 0], [0.6499, 0], [0.65, 1], [0.8999, 1], [0.9, 2], [0.9999, 2]]) {
      expect(new DropWorld(() => roll).next).toBe(tier);
    }
  });

  it("merges two dropped ones into a two and scores the collision", () => {
    const world = new DropWorld(() => 0.1);
    expect(world.drop(240)).toBe(true);
    expect(world.drop(240)).toBe(false);
    advance(world, 1.5);
    expect(world.drop(240)).toBe(true);
    advance(world, 2);
    expect(world.balls).toHaveLength(1);
    expect(world.balls[0].tier).toBe(1);
    expect(world.score).toBe(20);
    expect(world.charge).toBe(1);
  });

  it("resolves different-number collisions without merging", () => {
    const world = new DropWorld(() => 0.1);
    world.add(0, 200, 590);
    world.add(1, 233, 590);
    advance(world, 2);
    expect(world.balls).toHaveLength(2);
    expect(world.score).toBe(0);
    expect(Math.hypot(world.balls[0].x - world.balls[1].x, world.balls[0].y - world.balls[1].y)).toBeGreaterThan(39);
  });

  it("uses each orb in at most one simultaneous merge", () => {
    const world = new DropWorld(() => 0.1);
    world.time = 1;
    for (const x of [200, 231, 262]) world.add(0, x, 603).born = 0;
    world.step(1 / 120);
    expect(world.balls.map(ball => ball.tier).sort()).toEqual([0, 1]);
    expect(world.merges).toBe(1);
  });

  it("caps quick chain multipliers at five and resets after a pause", () => {
    const world = new DropWorld(() => 0.1);
    const pair = () => {
      world.balls = [];
      world.add(0, 200, 603).born = -10;
      world.add(0, 233, 603).born = -10;
      world.step(1 / 120);
    };
    for (let i = 0; i < 8; i++) pair();
    expect(world.chain).toBe(5);
    expect(world.charge).toBe(6);
    advance(world, 2);
    pair();
    expect(world.chain).toBe(1);
  });

  it("awards 1,000 at 128 and keeps the board", () => {
    const world = new DropWorld(() => 0.1);
    world.add(0, 40, 600);
    world.add(6, 170, 550);
    world.add(6, 303, 550);
    advance(world, 1);
    expect(world.balls.map(ball => ball.tier).sort()).toEqual([0, 7]);
    expect(world.score).toBe(2280);
    expect(world.events.some(event => event.type === "burst")).toBe(true);
    expect(world.over).toBe(false);
  });

  it("requires six merges worth of charge and does not reroll drops when shaking", () => {
    const make = () => {
      const drops = new Rng(17), shakes = new Rng(50);
      return new DropWorld(() => drops.next(), () => shakes.next());
    };
    const a = make(), b = make();
    expect(a.shake()).toBe(false);
    a.add(0, 240, 600);
    a.charge = 6;
    expect(a.shake()).toBe(true);
    expect(a.charge).toBe(0);
    expect(a.balls[0].vy).toBeLessThan(0);
    a.drop(100); b.drop(100);
    expect([a.next, a.queued]).toEqual([b.next, b.queued]);
  });

  it("allows more than 30 drops and clamps aim inside the walls", () => {
    const world = new DropWorld(() => 0.1);
    for (let i = 0; i < 100; i++) {
      // Isolate the drop limit from overflow: simulate a board cleared between drops.
      world.balls = [];
      expect(world.drop(i % 2 ? -1000 : 1000)).toBe(true);
      const ball = world.balls[0];
      expect(ball.x - ball.radius).toBeGreaterThanOrEqual(8);
      expect(ball.x + ball.radius).toBeLessThanOrEqual(472);
      advance(world, 0.5);
    }
    expect(world.drops).toBe(100);
    expect(world.over).toBe(false);
  });

  it("ignores new falling orbs and ends after three seconds of settled overflow", () => {
    const world = new DropWorld(() => 0.1);
    world.drop(240);
    advance(world, 1);
    expect(world.danger).toBe(0);
    const ball = world.balls[0];
    ball.born = -10;
    // Hold an orb at the height/velocity of a supported stack top.
    for (let i = 0; i < 359; i++) { ball.y = 100; ball.vy = 0; world.step(1 / 120); }
    expect(world.over).toBe(false);
    for (let i = 0; i < 3; i++) { ball.y = 100; ball.vy = 0; world.step(1 / 120); }
    expect(world.over).toBe(true);
    expect(world.drop(240)).toBe(false);
    expect(world.events.filter(event => event.type === "over")).toHaveLength(1);
  });

  it("keeps bot simulations finite and deterministic", () => {
    const simulate = () => {
      const rng = new Rng(42);
      const world = new DropWorld(() => rng.next());
      for (let i = 0; i < 80 && !world.over; i++) {
        world.drop(botAim(world));
        advance(world, 0.9);
        expect(world.balls.every(ball => [ball.x, ball.y, ball.vx, ball.vy].every(Number.isFinite))).toBe(true);
      }
      return { score: world.score, balls: world.balls, drops: world.drops };
    };
    expect(simulate()).toEqual(simulate());
  });

  it("does not merge two 128s", () => {
    const world = new DropWorld(() => 0.1);
    world.add(7, 150, 540);
    world.add(7, 311, 540);
    advance(world, 1);
    expect(world.balls.filter(ball => ball.tier === 7)).toHaveLength(2);
  });
});

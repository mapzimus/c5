import { describe, expect, it, vi } from "vitest";
import { Rng } from "../core/rng";
import type { GameContext } from "../core/types";
import { eyeOfTheStorm } from "./eye-of-the-storm/eye-of-the-storm";
import { bootyHaul } from "./imported/booty-haul/booty-haul";
import { shipPos } from "./imported/booty-haul/rules";
import { KaboomIsle } from "./kaboom-isle/kaboom-isle";

function context(): GameContext {
  return {
    width: 1280, height: 720, rng: new Rng(19),
    players: [0, 1].map((slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "human", slot })),
    canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) },
    input: { consumeClick: () => null, justPressed: () => false },
    sfx: new Proxy({}, { get: () => vi.fn() }),
  } as unknown as GameContext;
}

describe("replay loops", () => {
  it("Storm finishes all three volleys even when nobody shoots", () => {
    const game = eyeOfTheStorm.create(context());
    for (let frame = 0; frame < 90 * 60 && !game.isFinished(); frame++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    expect(game.getScores().map((p) => p.score)).toEqual([0, 0]);
    game.destroy();
  });

  it("Booty Haul rewards a raid once, blocks repeats, and recharges movement", () => {
    const game = bootyHaul.create(context());
    // Inspect the live fleet to place the player beside an actual vessel.
    const state = game as any;
    state.park("p0", shipPos(state.ships[0], state.lanes));
    state.raid("p0");
    const score = game.getScores()[0]!.score;
    expect(score).toBeGreaterThan(0);
    state.raid("p0");
    expect(game.getScores()[0]!.score).toBe(score);
    state.park("p0", [0, 0]);
    state.park("p0", [1, 1]);
    expect(state.playerStates.get("p0").reparks).toBe(0);
    for (let i = 0; i < 7 * 60; i++) game.update(1 / 60);
    expect(state.playerStates.get("p0").reparks).toBe(1);
    game.destroy();
  });

  it("Kaboom Isle plays a whole match to a finish when nobody taps", () => {
    const game = new KaboomIsle(context());
    for (let frame = 0; frame < 60 * 60 * 120 && !game.isFinished(); frame++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    expect(game.island).toBeGreaterThan(1);
    expect(Math.max(...game.wins)).toBeGreaterThanOrEqual(1);
    game.destroy();
  }, 120_000);

  it("Kaboom Isle bots finish a four-way brawl", () => {
    const ctx = context();
    ctx.players = [0, 1, 2, 3].map((slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })) as GameContext["players"];
    const game = new KaboomIsle(ctx);
    for (let frame = 0; frame < 60 * 60 * 120 && !game.isFinished(); frame++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    const stats = game.getStats().filter((s) => s.label === "Damage");
    expect(stats.some((s) => Number(s.value) > 0)).toBe(true);
    expect(Math.max(...game.wins)).toBe(2);
    expect(game.perks.some((p) => p.length > 0)).toBe(true);
    game.destroy();
  }, 120_000);
});

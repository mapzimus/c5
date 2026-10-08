import { describe, expect, it, vi } from "vitest";
import { Rng } from "../core/rng";
import type { GameContext } from "../core/types";
import { eyeOfTheStorm } from "./eye-of-the-storm/eye-of-the-storm";
import { bootyHaul } from "./imported/booty-haul/booty-haul";
import { shipPos } from "./imported/booty-haul/rules";
import { KnockaboutGame } from "./imported/knockabout";

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

  it("Knockabout allows every human to aim and never stalls on missing shots", () => {
    const game = new KnockaboutGame(context(), 3);
    const state = game as any;
    for (let i = 0; i < 75; i++) game.update(1 / 60);
    expect(state.phase).toBe("plan");
    const disc = state.world.aliveDiscs(1)[0];
    expect(state.findGrabbableDisc(disc.x, disc.y)?.owner).toBe(1);
    for (let i = 0; i < 11 * 60; i++) game.update(1 / 60);
    expect(state.turn).toBeGreaterThan(1);
    game.destroy();
  });
});

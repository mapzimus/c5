import { describe, expect, it } from "vitest";
import { allGames, createRegistry } from "./index";

describe("game catalog", () => {
  const EXPECTED_IDS = [
    "pairs", "parrot-flip", "castle-siege", "lucky-drop", "eye-of-the-storm",
    "booty-haul", "chaos-derby", "bug-wars", "kaboom-isle", "fling", "whack",
    "flappy-race", "connect-four", "curve-clash", "tower-topple", "quick-draw",
    "rope-skip", "hungry-hoppers", "block-brawl", "mash-dash", "big-blast",
    "hot-potato", "flag-flash", "sumo-rings", "stampede", "hot-tiles",
    "slot-cars", "scribble-race", "mug-match", "ice-luge", "hive-heist",
    "micro-mayhem",
  ];

  it("lists registered games for the main menu", () => {
    const ids = allGames.map((game) => game.id);
    for (const id of EXPECTED_IDS) {
      expect(ids, `missing game: ${id}`).toContain(id);
    }
    expect(ids.length).toBe(EXPECTED_IDS.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("registry lookups work", () => {
    const registry = createRegistry();
    expect(registry.get("pairs").name).toBe("Flag Snap");
    expect(registry.get("parrot-flip").name).toBe("Parrot Flip");
    expect(registry.get("lucky-drop").durationMs).toBe(0);
    expect(registry.get("chaos-derby").durationMs).toBe(0);
  });

  it("ids are safe to use as ?game= deep links", () => {
    for (const game of allGames) {
      expect(game.id, game.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});

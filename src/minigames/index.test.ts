import { describe, expect, it } from "vitest";
import { allMinigames, createRegistry } from "./index";

describe("minigame catalog", () => {
  it("ships unique playable ids", () => {
    const ids = allMinigames.map((game) => game.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    for (const game of allMinigames) {
      expect(game.durationMs).toBeGreaterThan(0);
      expect(game.name.length).toBeGreaterThan(0);
    }
  });

  it("loads into the registry", () => {
    const registry = createRegistry();
    expect(registry.list()).toHaveLength(allMinigames.length);
    expect(registry.get("storm-surge").name).toBe("Storm Surge");
  });
});

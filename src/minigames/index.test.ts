import { describe, expect, it } from "vitest";
import { allMinigames, createRegistry } from "./index";

describe("minigame catalog", () => {
  it("starts empty and ready to register games", () => {
    expect(allMinigames).toEqual([]);
    expect(createRegistry().list()).toEqual([]);
  });

  it("keeps registered ids unique", () => {
    const ids = allMinigames.map((game) => game.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

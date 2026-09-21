import { describe, expect, it } from "vitest";
import { allMinigames, createRegistry } from "./index";

describe("minigame catalog", () => {
  it("lists registered games for the main menu", () => {
    const ids = allMinigames.map((game) => game.id);
    expect(ids).toContain("pairs");
    expect(ids).toContain("parrot-flip");
    expect(new Set(ids).size).toBe(ids.length);
    expect(createRegistry().get("pairs").name).toBe("Pairs");
    expect(createRegistry().get("parrot-flip").name).toBe("Parrot Flip");
  });
});

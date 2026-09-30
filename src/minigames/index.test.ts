import { describe, expect, it } from "vitest";
import { allMinigames, createRegistry } from "./index";

describe("minigame catalog", () => {
  it("lists registered games for the main menu", () => {
    const ids = allMinigames.map((game) => game.id);
    expect(ids).toContain("pairs");
    expect(ids).toContain("parrot-flip");
    expect(ids).toContain("castle-siege");
    expect(ids).toContain("lucky-drop");
    expect(ids).toContain("eye-of-the-storm");
    expect(ids).toContain("booty-haul");
    expect(ids).toContain("chaos-derby");
    expect(new Set(ids).size).toBe(ids.length);
    expect(createRegistry().get("pairs").name).toBe("Pairs");
    expect(createRegistry().get("parrot-flip").name).toBe("Parrot Flip");
    expect(createRegistry().get("lucky-drop").durationMs).toBe(0);
    expect(createRegistry().get("chaos-derby").durationMs).toBe(0);
  });
});

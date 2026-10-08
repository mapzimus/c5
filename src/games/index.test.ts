import { describe, expect, it } from "vitest";
import { allGames, createRegistry } from "./index";

describe("game catalog", () => {
  it("lists registered games for the main menu", () => {
    const ids = allGames.map((game) => game.id);
    expect(ids).toContain("pairs");
    expect(ids).toContain("parrot-flip");
    expect(ids).toContain("castle-siege");
    expect(ids).toContain("lucky-drop");
    expect(ids).toContain("eye-of-the-storm");
    expect(ids).toContain("booty-haul");
    expect(ids).toContain("chaos-derby");
    expect(ids).toContain("bug-wars");
    expect(new Set(ids).size).toBe(ids.length);
    expect(createRegistry().get("pairs").name).toBe("Pairs");
    expect(createRegistry().get("parrot-flip").name).toBe("Parrot Flip");
    expect(createRegistry().get("lucky-drop").durationMs).toBe(0);
    expect(createRegistry().get("chaos-derby").durationMs).toBe(0);
  });
});

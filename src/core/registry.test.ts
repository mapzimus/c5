import { describe, expect, it } from "vitest";
import { MinigameRegistry } from "./registry";
import type { MinigameDefinition } from "./types";

const stub: MinigameDefinition = {
  id: "stub",
  name: "Stub",
  tagline: "test",
  description: "test",
  durationMs: 1000,
  controls: "none",
  create: () => {
    throw new Error("not used");
  },
};

describe("MinigameRegistry", () => {
  it("registers and lists games", () => {
    const registry = new MinigameRegistry();
    registry.register(stub);
    expect(registry.ids()).toEqual(["stub"]);
    expect(registry.get("stub").name).toBe("Stub");
  });

  it("rejects duplicate ids", () => {
    const registry = new MinigameRegistry();
    registry.register(stub);
    expect(() => registry.register(stub)).toThrow(/already registered/);
  });

  it("throws on unknown ids", () => {
    const registry = new MinigameRegistry();
    expect(() => registry.get("nope")).toThrow(/Unknown minigame/);
  });
});

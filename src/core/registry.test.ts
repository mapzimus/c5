import { describe, expect, it } from "vitest";
import { GameRegistry } from "./registry";
import type { GameDefinition } from "./types";

const stub: GameDefinition = {
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

describe("GameRegistry", () => {
  it("registers and lists games", () => {
    const registry = new GameRegistry();
    registry.register(stub);
    expect(registry.ids()).toEqual(["stub"]);
    expect(registry.get("stub").name).toBe("Stub");
  });

  it("rejects duplicate ids", () => {
    const registry = new GameRegistry();
    registry.register(stub);
    expect(() => registry.register(stub)).toThrow(/already registered/);
  });

  it("throws on unknown ids", () => {
    const registry = new GameRegistry();
    expect(() => registry.get("nope")).toThrow(/Unknown game/);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import type { GameContext } from "../../core/types";
import { curveClash } from "./curve-clash";

function context(n: number, seed: number): GameContext {
  return {
    width: 1280,
    height: 720,
    minTap: 60,
    rng: new Rng(seed),
    players: Array.from({ length: n }, (_, slot) => ({
      id: `p${slot}`,
      name: `P${slot}`,
      color: "#3EE0FF",
      kind: "bot",
      slot,
    })),
    canvas: {
      style: {},
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    },
    input: { axis: () => ({ x: 0, y: 0 }) },
    sfx: new Proxy({}, { get: () => vi.fn() }),
  } as unknown as GameContext;
}

describe("curve clash match", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("bots play whole matches to a winner, grabbing power-ups and skimming lines", () => {
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => null }),
    });
    let grabs = 0;
    let skims = 0;
    for (const [n, seed] of [
      [2, 1],
      [4, 2],
      [3, 5],
    ] as const) {
      const game = curveClash.create(context(n, seed));
      let frames = 0;
      for (; frames < 60 * 60 * 10 && !game.isFinished(); frames++) game.update(1 / 60);
      expect(game.isFinished()).toBe(true);
      const stats = game.getStats?.() ?? [];
      const wins = stats.filter((s) => s.label === "Rounds won").map((s) => Number(s.value));
      expect(Math.max(...wins)).toBe(n >= 3 ? 2 : 3);
      grabs += stats.filter((s) => s.label === "Power-ups").reduce((a, s) => a + Number(s.value), 0);
      skims += stats.filter((s) => s.label === "Near misses").reduce((a, s) => a + Number(s.value), 0);
      game.destroy();
    }
    expect(grabs).toBeGreaterThan(0);
    expect(skims).toBeGreaterThan(0);
  }, 60_000);
});

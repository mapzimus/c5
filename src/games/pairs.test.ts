import { describe, expect, it, vi } from "vitest";
import { Rng } from "../core/rng";
import type { GameContext, PlayerKind } from "../core/types";
import { pairs } from "./pairs";

/** Canvas stub: every method is a no-op that returns another stub. */
function stubCanvas(): CanvasRenderingContext2D {
  const handler: ProxyHandler<object> = {
    get: (_target, key) => {
      if (key === "measureText") return () => ({ width: 100 });
      return stub;
    },
    set: () => true,
  };
  const stub: unknown = new Proxy(function () {
    return stub;
  }, { ...handler, apply: () => stub });
  return stub as CanvasRenderingContext2D;
}

function context(kinds: PlayerKind[], seed: number, width = 1280, height = 720): GameContext {
  return {
    width,
    height,
    rng: new Rng(seed),
    minTap: 44,
    players: kinds.map((kind, slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind, slot })),
    canvas: {} as HTMLCanvasElement,
    input: { consumeClick: () => null, justPressed: () => false, actionPressed: () => false, hover: null },
    sfx: new Proxy({}, { get: () => vi.fn() }),
  } as unknown as GameContext;
}

function play(ctx: GameContext, maxSeconds: number): { finished: boolean; seconds: number; game: ReturnType<typeof pairs.create> } {
  const game = pairs.create(ctx);
  const g = stubCanvas();
  let frame = 0;
  for (; frame < maxSeconds * 60 && !game.isFinished(); frame++) {
    game.update(1 / 60);
    if (frame % 20 === 0) game.render(g);
  }
  return { finished: game.isFinished(), seconds: frame / 60, game };
}

describe("pairs full games", () => {
  it.each([
    [["bot"], 3],
    [["bot", "bot"], 7],
    [["bot", "bot", "bot"], 11],
    [["bot", "bot", "bot", "bot"], 23],
  ] as [PlayerKind[], number][])("bots-only %j finishes", (kinds, seed) => {
    const { finished, game } = play(context(kinds, seed), 600);
    expect(finished).toBe(true);
    const scores = game.getScores();
    expect(scores).toHaveLength(kinds.length);
    expect(scores.some((s) => s.score > 0)).toBe(true);
    expect(game.getStats?.().length).toBeGreaterThan(0);
    game.destroy();
  });

  it("idle humans are carried along by the shot clock", () => {
    const { finished, seconds } = play(context(["human", "bot", "human"], 5, 390, 844), 1000);
    expect(seconds).toBeLessThan(600);
    expect(finished).toBe(true);
  });

  it("finishes across many seeds", () => {
    for (let seed = 100; seed < 112; seed++) {
      expect(play(context(["bot", "bot"], seed), 600).finished).toBe(true);
    }
  });
});

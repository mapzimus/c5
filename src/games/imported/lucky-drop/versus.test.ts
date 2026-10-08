import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../../core/rng";
import type { GameContext } from "../../../core/types";
import { LuckyDropVersus, versusHeats } from "./versus";
import type { DropWorld } from "./physics";

function setup(kinds: ("human" | "bot")[]) {
  const listeners = new Map<string, (event: Partial<PointerEvent>) => void>();
  const canvas = {
    style: { touchAction: "pan-y" },
    addEventListener: vi.fn((name: string, handler: (event: Partial<PointerEvent>) => void) => listeners.set(name, handler)),
    removeEventListener: vi.fn((name: string) => listeners.delete(name)),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    setPointerCapture: vi.fn(),
  };
  const ctx = {
    canvas, width: 1280, height: 720,
    players: kinds.map((kind, i) => ({ id: `p${i}`, name: `P${i}`, color: "#fff", kind, slot: i })),
    rng: new Rng(42),
    input: { consumeClick: () => null, isDown: () => false, axis: () => ({ x: 0, y: 0 }), justPressed: () => false, actionPressed: () => false },
    sfx: { streak: vi.fn(), win: vi.fn(), tick: vi.fn(), hit: vi.fn(), miss: vi.fn() },
  } as unknown as GameContext;
  const game = new LuckyDropVersus(ctx);
  const panes = (game as unknown as { panes: { world: DropWorld }[] }).panes;
  const tick = (n = 1) => { for (let i = 0; i < n; i++) game.update(1 / 60); };
  const pointer = (type: string, id: number, x: number, y: number) =>
    listeners.get(type)!({ type, pointerId: id, clientX: x, clientY: y, preventDefault: () => {} } as Partial<PointerEvent>);
  return { game, panes, tick, pointer, listeners };
}

describe("Lucky Drop Versus", () => {
  it("pairs players into heats", () => {
    expect(versusHeats(2)).toEqual([[0, 1]]);
    expect(versusHeats(3)).toEqual([[0, 1], [2, null]]);
    expect(versusHeats(4)).toEqual([[0, 1], [2, 3]]);
  });

  it("two touches at once each drop on their own board", () => {
    const { panes, tick, pointer } = setup(["human", "human"]);
    tick();
    pointer("pointerdown", 1, 200, 300);
    pointer("pointerdown", 2, 1000, 300);
    pointer("pointerup", 1, 200, 300);
    pointer("pointerup", 2, 1000, 300);
    tick();
    expect(panes[0]!.world.drops).toBe(1);
    expect(panes[1]!.world.drops).toBe(1);
    expect(panes[0]!.world.balls[0]!.x).toBeCloseTo(160, 0);
    expect(panes[1]!.world.balls[0]!.x).toBeCloseTo(240, 0);
  });

  it("both boards get the same drop sequence", () => {
    const { panes } = setup(["human", "human"]);
    expect([panes[0]!.world.next, panes[0]!.world.queued]).toEqual([panes[1]!.world.next, panes[1]!.world.queued]);
  });

  it("a bot heat plays out and hands scores to the right players", () => {
    const { game, tick } = setup(["bot", "bot", "bot"]);
    let guard = 0;
    while (!game.isFinished() && guard++ < 60 * 60 * 30) tick();
    expect(game.isFinished()).toBe(true);
    const scores = game.getScores();
    expect(scores.map((s) => s.playerId)).toEqual(["p0", "p1", "p2"]);
    expect(scores.every((s) => s.score > 0)).toBe(true);
  }, 30_000); // simulates whole 3-bot game; ~5s, too close to vitest's default limit

  it("cleans up its listeners", () => {
    const { game, listeners } = setup(["human", "bot"]);
    game.destroy();
    expect(listeners.size).toBe(0);
  });
});

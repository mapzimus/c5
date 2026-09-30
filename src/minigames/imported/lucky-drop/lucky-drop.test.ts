import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../../core/rng";
import type { MinigameContext } from "../../../core/types";
import { LuckyDropGame } from "./lucky-drop";
import type { DropWorld } from "./physics";

function setup(kinds: ("human" | "bot")[] = ["human", "bot"]) {
  const listeners = new Map<string, (event: PointerEvent) => void>();
  const keys = new Set<string>();
  let click: { x: number; y: number } | null = null;
  const canvas = {
    style: { touchAction: "pan-y" },
    addEventListener: vi.fn((name: string, handler: (event: PointerEvent) => void) => listeners.set(name, handler)),
    removeEventListener: vi.fn((name: string) => listeners.delete(name)),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn(),
  };
  const ctx = {
    canvas, width: 1280, height: 720,
    players: kinds.map((kind, i) => ({ id: `p${i}`, name: `P${i}`, color: "#fff", kind, slot: i })),
    rng: new Rng(123),
    input: { consumeClick: () => { const value = click; click = null; return value; },
      isDown: () => false, axis: () => ({ x: 0, y: 0 }), justPressed: (key: string) => keys.has(key), actionPressed: () => false },
    sfx: { streak: vi.fn(), win: vi.fn(), tick: vi.fn(), hit: vi.fn(), miss: vi.fn() },
  } as unknown as MinigameContext;
  const game = new LuckyDropGame(ctx);
  // Inspect the adapter's world solely to arrange end-of-run/input integration states.
  const state = game as unknown as { world: DropWorld };
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { game.update(1 / 60); keys.clear(); } };
  return { game, state, tick, keys, canvas, listeners, setClick: (value: typeof click) => { click = value; } };
}

describe("Lucky Drop C5 adapter", () => {
  it("keeps human runs unlimited and hands each finished score to the right player", () => {
    const { game, state, tick, keys } = setup(["human", "human"]);
    for (let i = 0; i < 35; i++) {
      state.world.balls = [];
      keys.add("Space"); tick(); tick(30);
    }
    expect(state.world.drops).toBe(35);
    expect(game.isFinished()).toBe(false);
    state.world.score = 420;
    state.world.over = true;
    tick(153);
    expect(game.getScores()).toEqual([{ playerId: "p0", score: 420 }, { playerId: "p1", score: 0 }]);
    expect(state.world.drops).toBe(0);
    state.world.score = 100;
    state.world.over = true;
    tick(153);
    expect(game.isFinished()).toBe(true);
    expect(game.getScores()[1]).toEqual({ playerId: "p1", score: 100 });
    game.destroy();
  });

  it("drops on pointer release, cancels interrupted gestures and removes its handlers", () => {
    const { game, state, tick, listeners, canvas } = setup(["human"]);
    const event = { button: 0, isPrimary: true, pointerId: 1, clientX: 640, clientY: 200, preventDefault: vi.fn() } as unknown as PointerEvent;
    listeners.get("pointerdown")!(event); tick();
    expect(state.world.drops).toBe(0);
    listeners.get("pointercancel")!(event);
    listeners.get("pointerup")!(event); tick();
    expect(state.world.drops).toBe(0);
    listeners.get("pointerdown")!(event);
    listeners.get("pointerup")!(event); tick();
    expect(state.world.drops).toBe(1);
    game.destroy();
    expect(listeners.size).toBe(0);
    expect(canvas.style.touchAction).toBe("pan-y");
    expect(canvas.removeEventListener).toHaveBeenCalledTimes(4);
  });

  it("supports the shake button without dropping and lets bots play independently", () => {
    const human = setup(["human"]);
    human.state.world.charge = 6;
    human.setClick({ x: 1060, y: 324 }); human.tick();
    expect(human.state.world.charge).toBe(0);
    expect(human.state.world.drops).toBe(0);
    human.game.destroy();
    const bot = setup(["bot"]);
    bot.keys.add("Space"); bot.tick();
    expect(bot.state.world.drops).toBe(0);
    bot.tick(120);
    expect(bot.state.world.drops).toBeGreaterThan(0);
    bot.game.destroy();
  });

  it("drops on its own when the shot clock runs out", () => {
    const { state, tick } = setup(["human"]);
    tick(60 * 7);
    expect(state.world.drops).toBe(0);
    tick(60 * 1.2);
    expect(state.world.drops).toBe(1);
  });
});

import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../../core/rng";
import type { GameContext } from "../../../core/types";
import { LuckyDropSprint } from "./sprint";
import type { DropWorld } from "./physics";
import { SPRINT, STAGES, layout } from "./sprint-rules";

interface PaneView { world: DropWorld; banked: number; busts: number; dropped: boolean; aim: number }

function setup(kinds: ("human" | "bot")[]) {
  const listeners = new Map<string, (event: Partial<PointerEvent>) => void>();
  const keys = new Set<string>();
  const canvas = {
    style: { touchAction: "pan-y" },
    addEventListener: vi.fn((name: string, handler: (event: Partial<PointerEvent>) => void) => listeners.set(name, handler)),
    removeEventListener: vi.fn((name: string) => listeners.delete(name)),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    setPointerCapture: vi.fn(),
  };
  const ctx = {
    canvas, width: 1280, height: 720, minTap: 44,
    players: kinds.map((kind, i) => ({ id: `p${i}`, name: `P${i}`, color: "#fff", kind, slot: i })),
    rng: new Rng(42),
    input: { consumeClick: () => null, isDown: () => false, axis: () => ({ x: 0, y: 0 }),
      justPressed: (key: string) => keys.has(key), actionPressed: (slot: number) => keys.has(`action${slot}`) },
    sfx: { streak: vi.fn(), win: vi.fn(), tick: vi.fn(), hit: vi.fn(), miss: vi.fn(), collect: vi.fn(), countdown: vi.fn(), go: vi.fn() },
  } as unknown as GameContext;
  const game = new LuckyDropSprint(ctx);
  const inner = game as unknown as { panes: PaneView[]; t: number; beatIndex: number; phase: string };
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { game.update(1 / 60); keys.clear(); } };
  const pointer = (type: string, id: number, x: number, y: number) =>
    listeners.get(type)!({ type, pointerId: id, clientX: x, clientY: y, preventDefault: () => {} } as Partial<PointerEvent>);
  return { game, inner, tick, keys, pointer, listeners, canvas, ctx };
}

describe("Lucky Drop Sprint", () => {
  it("everyone gets the same orb each beat and the undecided drop when the beat ends", () => {
    const { inner, tick, pointer } = setup(["human", "human", "human"]);
    const [a, b, c] = inner.panes as [PaneView, PaneView, PaneView];
    expect([a.world.next, b.world.next, c.world.next]).toEqual([a.world.next, a.world.next, a.world.next]);
    const lay = layout(3, 1280, 720, 44);
    pointer("pointerdown", 7, lay.xs[0]! + 60, lay.boardY + 200);
    pointer("pointerup", 7, lay.xs[0]! + 60, lay.boardY + 200);
    tick();
    expect(a.world.drops).toBe(1);
    expect(a.dropped).toBe(true);
    expect(b.world.drops).toBe(0);
    expect(a.world.balls[0]!.x).toBeCloseTo(a.world.clampAim(60 / lay.scale), 0);
    // Nobody else decides: the beat runs out and they drop where they aim.
    tick(Math.ceil(STAGES[0]!.beat * 60) + 1);
    expect(inner.beatIndex).toBe(1);
    expect([a.world.drops, b.world.drops, c.world.drops]).toEqual([1, 1, 1]);
    expect([a.dropped, b.dropped, c.dropped]).toEqual([false, false, false]);
    expect([a.world.next, b.world.next, c.world.next]).toEqual([a.world.next, a.world.next, a.world.next]);
  });

  it("moves on early once everyone has dropped, but never within the minimum beat", () => {
    const { inner, tick, keys } = setup(["human", "human"]);
    keys.add("action0"); keys.add("action1");
    tick();
    expect(inner.panes.every(p => p.world.drops === 1)).toBe(true);
    expect(inner.beatIndex).toBe(0);
    tick(Math.ceil(SPRINT.minBeat * 60) + 1);
    expect(inner.beatIndex).toBe(1);
  });

  it("a bust costs a quarter of the board, gives a fresh board on the shared deck, and keeps playing", () => {
    const { inner, tick, game } = setup(["human", "bot"]);
    const human = inner.panes[0]!, bot = inner.panes[1]!;
    tick(60 * 6);
    const before = human.world;
    before.score = 1_000;
    before.add(4, 240, 50).born = -10;
    before.over = true;
    tick();
    expect(human.busts).toBe(1);
    expect(human.banked).toBe(750);
    expect(human.world).not.toBe(before);
    expect(human.world.over).toBe(false);
    expect(human.world.balls).toHaveLength(0);
    expect(human.world.dangerLimit).toBe(SPRINT.dangerLimit);
    expect(human.world.dangerLine).toBe(SPRINT.dangerLine);
    expect(game.getScores()[0]).toEqual({ playerId: "p0", score: 750 });
    expect(game.isFinished()).toBe(false);
    // Still in lockstep with the bot's board.
    expect(human.world.next).toBe(bot.world.next);
  });

  it("shake costs four merges when behind and six when leading; the footer button works", () => {
    const { inner, tick, pointer } = setup(["human", "human"]);
    const [a, b] = inner.panes as [PaneView, PaneView];
    const lay = layout(2, 1280, 720, 44);
    a.world.add(0, 240, 600);
    a.world.charge = 4;
    b.world.score = 500;
    tick();
    pointer("pointerdown", 1, lay.xs[0]! + lay.boardW / 2, lay.boardY + lay.boardH + lay.footerH - 10);
    expect(a.world.charge).toBe(0);
    expect(a.world.drops).toBe(0);
    b.world.charge = 4;
    pointer("pointerdown", 2, lay.xs[1]! + lay.boardW / 2, lay.boardY + lay.boardH + lay.footerH - 10);
    expect(b.world.charge).toBe(4);
  });

  it("runs 90 seconds of beats, settles, then finishes with every seat's total and stats", () => {
    const { game, inner, tick } = setup(["bot", "bot", "bot", "bot"]);
    let guard = 0;
    while (!game.isFinished() && guard++ < 60 * 120) tick();
    expect(game.isFinished()).toBe(true);
    expect(guard / 60).toBeGreaterThan(SPRINT.duration + SPRINT.settle);
    expect(guard / 60).toBeLessThan(SPRINT.duration + SPRINT.settle + 3);
    const scores = game.getScores();
    expect(scores.map(s => s.playerId)).toEqual(["p0", "p1", "p2", "p3"]);
    expect(scores.every(s => s.score > 0)).toBe(true);
    expect(inner.panes.every(p => p.world.multiplier === 2)).toBe(true);
    const drops = inner.panes.map(p => p.world.drops + p.busts);
    expect(Math.max(...drops) - Math.min(...drops)).toBeLessThanOrEqual(1);
    const stats = game.getStats();
    expect(stats.filter(s => s.label === "Longest chain")).toHaveLength(4);
    expect(stats.filter(s => s.label === "Busts")).toHaveLength(4);
  }, 30_000);

  it("ignores input and busts once time is up, and cleans up its listeners", () => {
    const { game, inner, tick, keys, listeners, canvas } = setup(["human", "human"]);
    inner.t = SPRINT.duration - 0.01;
    tick(2);
    expect(inner.phase).toBe("settle");
    const drops = inner.panes[0]!.world.drops;
    keys.add("action0");
    tick();
    expect(inner.panes[0]!.world.drops).toBe(drops);
    inner.panes[0]!.world.over = true;
    tick();
    expect(inner.panes[0]!.busts).toBe(0);
    game.destroy();
    expect(listeners.size).toBe(0);
    expect(canvas.style.touchAction).toBe("pan-y");
  });
});

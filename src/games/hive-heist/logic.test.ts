import { describe, expect, it, vi, type Mock } from "vitest";
import { Rng } from "../../core/rng";
import type { GameContext } from "../../core/types";
import { hiveHeist } from "./hive-heist";
import {
  botChoice, buildHive, leaders, MAX_ITEMS, MIN_ITEMS, newHive, nextInHive, SAFE_LEAD, take, VISIBLE, type Item,
} from "./logic";

const honey = (value: number): Item => ({ kind: "honey", value });
const wasp: Item = { kind: "wasp" };

describe("hive heist logic", () => {
  it("builds hives of 14-20 items with 2-3 wasps then 4, never in the first two slots", () => {
    const rng = new Rng(5);
    for (let i = 0; i < 100; i++) {
      for (const hive of [0, 1]) {
        const q = buildHive(hive, rng);
        expect(q.length).toBeGreaterThanOrEqual(MIN_ITEMS);
        expect(q.length).toBeLessThanOrEqual(MAX_ITEMS);
        const wasps = q.filter((it) => it.kind === "wasp").length;
        if (hive === 0) {
          expect(wasps).toBeGreaterThanOrEqual(2);
          expect(wasps).toBeLessThanOrEqual(3);
        } else {
          expect(wasps).toBe(4);
        }
        for (let k = 0; k < SAFE_LEAD; k++) expect(q[k]!.kind).toBe("honey");
        for (const it of q) {
          if (it.kind === "honey") {
            expect(it.value).toBeGreaterThanOrEqual(1);
            expect(it.value).toBeLessThanOrEqual(3);
          }
        }
      }
    }
  });

  it("taking collects honey and rotates the turn", () => {
    const s = newHive([honey(2), honey(3), honey(1), wasp, honey(1)], 3, 0);
    const r = take(s, 2);
    expect(r).toMatchObject({ seat: 0, honey: 5, stung: false });
    expect(s.turn).toBe(1);
    expect(s.queue.length).toBe(3);
    expect(s.done).toBe(false);
  });

  it("a wasp stings the taker out, keeps the honey from the same grab, and skips them afterwards", () => {
    const s = newHive([honey(3), wasp, honey(1), honey(1), honey(1), honey(1)], 3, 1);
    const r = take(s, 2);
    expect(r).toMatchObject({ seat: 1, honey: 3, stung: true });
    expect(s.out).toEqual([false, true, false]);
    expect(s.turn).toBe(2);
    take(s, 1);
    expect(s.turn).toBe(0);
    take(s, 1);
    expect(s.turn).toBe(2);
  });

  it("the hive ends when the queue empties or everyone is out", () => {
    const empty = newHive([honey(1), honey(1)], 2, 0);
    take(empty, 2);
    expect(empty.done).toBe(true);

    const stung = newHive([wasp, wasp, honey(1)], 2, 0);
    take(stung, 1);
    expect(stung.done).toBe(false);
    take(stung, 1);
    expect(stung.done).toBe(true);
    expect(stung.queue.length).toBe(1);
  });

  it("nextInHive walks past stung seats and returns null when nobody is left", () => {
    expect(nextInHive([false, true, false], 0)).toBe(2);
    expect(nextInHive([true, true, false], 2)).toBe(2);
    expect(nextInHive([true, true], 0)).toBeNull();
  });

  it("bots take 1 on a wasp 1st or 2nd, 2 on a wasp 3rd, otherwise grab 2", () => {
    const rng = new Rng(1);
    expect(botChoice([wasp, honey(1), honey(1), honey(1)], rng, 0)).toBe(1);
    expect(botChoice([honey(1), wasp, honey(1), honey(1)], rng, 0)).toBe(1);
    expect(botChoice([honey(1), honey(1), wasp, honey(1)], rng, 0)).toBe(2);
    expect(botChoice([honey(1), honey(1), honey(1), wasp], rng, 0)).toBe(2);
    expect(botChoice([honey(1)], rng, 0)).toBe(1);
    expect(botChoice([honey(1), honey(1), honey(1)], rng, 1)).toBe(1);
    expect(VISIBLE).toBe(3);
  });

  it("leaders share the top honey total", () => {
    expect(leaders([4, 9, 9, -2])).toEqual([1, 2]);
    expect(leaders([-5, -1])).toEqual([1]);
  });
});

function context(kind: "human" | "bot", seed: number): GameContext {
  return {
    width: 1280, height: 720, rng: new Rng(seed), minTap: 44,
    players: [0, 1, 2, 3].map((slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind, slot })),
    canvas: {
      style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    },
    input: { justPressed: () => false },
    sfx: new Proxy({}, { get: () => vi.fn() }),
  } as unknown as GameContext;
}

describe("hive heist game", () => {
  it("an all-bot table plays two hives to the end", () => {
    const game = hiveHeist.create(context("bot", 11));
    for (let f = 0; f < 60 * 180 && !game.isFinished(); f++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    expect(game.getScores()).toHaveLength(4);
    const stats = game.getStats?.() ?? [];
    expect(stats.every((s) => s.label === "Stings")).toBe(true);
    expect(stats).toHaveLength(4);
    game.destroy();
  });

  it("humans who never tap time out with TAKE 1 and the game still finishes", () => {
    const game = hiveHeist.create(context("human", 3));
    for (let f = 0; f < 60 * 400 && !game.isFinished(); f++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    game.destroy();
  });

  it("a human tapping TAKE 2 takes two items off the front", () => {
    const ctx = context("human", 7);
    const game = hiveHeist.create(ctx);
    const add = ctx.canvas.addEventListener as unknown as Mock;
    const down = add.mock.calls.find((c) => c[0] === "pointerdown")![1] as (e: unknown) => void;
    for (let f = 0; f < 60 * 3; f++) game.update(1 / 60);
    const state = game as unknown as { hive: { queue: Item[] } };
    const before = state.hive.queue.length;
    down({ clientX: 1280 * 0.73, clientY: 720 * 0.84, pointerId: 1, preventDefault: () => undefined });
    expect(state.hive.queue.length).toBe(before - 2);
    // Not this seat's turn any more: a second tap during the chomp beat is ignored.
    down({ clientX: 1280 * 0.27, clientY: 720 * 0.84, pointerId: 2, preventDefault: () => undefined });
    expect(state.hive.queue.length).toBe(before - 2);
    game.destroy();
    expect((ctx.canvas.removeEventListener as unknown as Mock).mock.calls.length).toBe(3);
  });
});

import { describe, expect, it, vi, type Mock } from "vitest";
import { Rng } from "../../core/rng";
import type { GameContext } from "../../core/types";
import { hiveHeist } from "./hive-heist";
import {
  bankOut, botChoice, buildHive, canRelease, cashOut, cornered, extraCombs, hiddenRisk, HIVE_SPECS, HIVES, leaders, newHive,
  nextInHive, releaseWasp, SAFE_LEAD, take, underdog, victimOf, VISIBLE, type HiveState, type Item,
} from "./logic";

const honey = (value: number): Item => ({ kind: "honey", value });
const wasp: Item = { kind: "wasp" };
const H = honey(1);

describe("hive heist logic", () => {
  it("builds each hive to its spec: wasps past the safe lead, the crown in the back half", () => {
    const rng = new Rng(5);
    for (let i = 0; i < 100; i++) {
      for (let hive = 0; hive < HIVES; hive++) {
        const spec = HIVE_SPECS[hive]!;
        const seats = 2 + (i % 3);
        const q = buildHive(hive, rng, seats);
        expect(q.length).toBeGreaterThanOrEqual(spec.items[0] + extraCombs(seats));
        expect(q.length).toBeLessThanOrEqual(spec.items[1] + extraCombs(seats));
        expect(q.filter((it) => it.kind === "wasp").length).toBe(spec.wasps);
        for (let k = 0; k < SAFE_LEAD; k++) expect(q[k]!.kind).toBe("honey");
        const crowns = q.map((it, idx) => ({ it, idx })).filter((e) => e.it.kind === "honey" && e.it.crown);
        if (spec.crown > 0) {
          expect(crowns).toHaveLength(1);
          const c = crowns[0]!;
          expect(c.idx).toBeGreaterThanOrEqual(Math.floor(q.length / 2));
          expect(c.it.kind === "honey" && c.it.value).toBe(spec.crown);
        } else expect(crowns).toHaveLength(0);
        for (const it of q) {
          if (it.kind === "honey" && !it.crown) {
            expect(it.value).toBeGreaterThanOrEqual(spec.honey[0]);
            expect(it.value).toBeLessThanOrEqual(spec.honey[1]);
          }
        }
      }
    }
  });

  it("taking puts honey in the paws and rotates the turn", () => {
    const s = newHive([honey(2), honey(3), H, wasp, H], 3, 0);
    const r = take(s, 2);
    expect(r).toMatchObject({ seat: 0, honey: 5, stung: false, spilled: 0, bounty: null });
    expect(s.paws).toEqual([5, 0, 0]);
    expect(s.turn).toBe(1);
    expect(s.queue.length).toBe(3);
    expect(s.done).toBe(false);
  });

  it("a sting spills the paws, keeps nothing from the bite, and puts the seat in the swarm with a wasp", () => {
    const s = newHive([honey(3), wasp, H, H, H, H], 3, 1);
    s.paws[1] = 7;
    const r = take(s, 2);
    expect(r).toMatchObject({ seat: 1, honey: 0, stung: true, spilled: 7 });
    expect(s.paws[1]).toBe(0);
    expect(s.status).toEqual(["in", "stung", "in"]);
    expect(s.wasp).toEqual([false, true, false]);
    expect(canRelease(s, 1)).toBe(true);
    expect(canRelease(s, 0)).toBe(false);
    expect(s.turn).toBe(2);
    take(s, 1);
    expect(s.turn).toBe(0);
    take(s, 1);
    expect(s.turn).toBe(2);
  });

  it("cornered means a wasp at the front", () => {
    expect(cornered(newHive([wasp, H], 2, 0))).toBe(true);
    expect(cornered(newHive([H, wasp], 2, 0))).toBe(false);
  });

  it("banking out leaves with the paws and ends the hive once everyone is out", () => {
    const s = newHive([H, H, H, H], 2, 0);
    s.paws[0] = 6;
    expect(bankOut(s)).toEqual({ seat: 0, banked: 6 });
    expect(s.status[0]).toBe("banked");
    expect(s.wasp[0]).toBe(true);
    expect(s.turn).toBe(1);
    expect(s.done).toBe(false);
    bankOut(s);
    expect(s.done).toBe(true);
    expect(s.queue.length).toBe(4);
  });

  it("the hive ends when the queue empties and cashOut banks the paws of everyone still in", () => {
    const s = newHive([honey(2), honey(3)], 3, 0);
    s.status[2] = "stung";
    take(s, 2);
    expect(s.done).toBe(true);
    s.paws[1] = 4;
    expect(cashOut(s)).toEqual([{ seat: 0, banked: 5 }, { seat: 1, banked: 4 }]);
    expect(s.paws).toEqual([0, 0, 0]);
    expect(s.status).toEqual(["banked", "banked", "stung"]);
  });

  it("nextInHive walks past seats out of the hive and returns null when nobody is left", () => {
    expect(nextInHive(["in", "stung", "in"], 0)).toBe(2);
    expect(nextInHive(["banked", "stung", "in"], 2)).toBe(2);
    expect(nextInHive(["stung", "banked"], 0)).toBeNull();
  });

  it("a swarm member releases one owned wasp into the hidden combs, and its sting pays a bounty", () => {
    const rng = new Rng(3);
    const s = newHive([H, H, H, H, H, H], 3, 0);
    expect(releaseWasp(s, 0, rng)).toBeNull();
    s.status[2] = "banked";
    s.wasp[2] = true;
    for (let i = 0; i < 20; i++) {
      const t: HiveState = { ...s, queue: [...s.queue], wasp: [...s.wasp] };
      const idx = releaseWasp(t, 2, rng);
      expect(idx).not.toBeNull();
      expect(idx!).toBeGreaterThanOrEqual(VISIBLE);
      expect(idx!).toBeLessThanOrEqual(6);
      expect(t.queue[idx!]).toEqual({ kind: "wasp", owner: 2 });
      expect(t.queue.length).toBe(7);
      expect(canRelease(t, 2)).toBe(false);
      expect(releaseWasp(t, 2, rng)).toBeNull();
    }
    // A short queue gets the wasp appended at the end (never spliced into the visible window).
    const short = newHive([H, H], 2, 0);
    short.status[1] = "stung";
    short.wasp[1] = true;
    expect(releaseWasp(short, 1, rng)).toBe(2);
    expect(short.queue.length).toBe(3);
    expect(short.queue[2]).toEqual({ kind: "wasp", owner: 1 });
    take(short, 2);
    expect(short.turn).toBe(0);
    const r = take(short, 1);
    expect(r.stung).toBe(true);
    expect(r.bounty).toBe(1);
  });

  it("hiddenRisk counts wasps behind the window", () => {
    expect(hiddenRisk([H, wasp, H, wasp, H, wasp])).toEqual({ wasps: 2, hidden: 3, risk: 2 / 3 });
    expect(hiddenRisk([H, H])).toEqual({ wasps: 0, hidden: 0, risk: 0 });
    expect(hiddenRisk([H, H, H, wasp], 4).wasps).toBe(0);
  });

  it("victimOf follows the shove chain", () => {
    const four: HiveState["status"] = ["in", "in", "in", "in"];
    expect(victimOf(four, 0, 2, 2)).toBe(1);
    expect(victimOf(four, 0, 2, 1)).toBe(2);
    expect(victimOf(four, 0, 1, 1)).toBe(1);
    expect(victimOf(["in", "in"], 0, 2, 1)).toBe(0);
    expect(victimOf(["in", "stung"], 0, 2, 2)).toBe(0);
  });

  it("bots shove visible wasps onto the richest paws and never onto themselves when they can help it", () => {
    const rng = new Rng(1);
    const two = newHive([H, wasp, H, H, H], 2, 0);
    expect(botChoice(two, 0, rng, { blunder: 0 })).toBe("take1");
    const twoFar = newHive([H, H, wasp, H, H], 2, 0);
    expect(botChoice(twoFar, 0, rng, { blunder: 0 })).toBe("take2");
    const four = newHive([H, H, wasp, H, H], 4, 0);
    four.paws = [0, 2, 9, 0];
    expect(botChoice(four, 0, rng, { blunder: 0 })).toBe("take1");
    four.paws = [0, 9, 2, 0];
    expect(botChoice(four, 0, rng, { blunder: 0 })).toBe("take2");
    // Alone with a wasp in view every shove comes back around: grab one more, bank the paws,
    // or bite up to it with nothing to lose.
    const alone = newHive([H, H, wasp, H], 3, 0);
    alone.status = ["in", "banked", "stung"];
    alone.paws[0] = 5;
    expect(botChoice(alone, 0, rng, { blunder: 0 })).toBe("take1");
    take(alone, 1);
    expect(botChoice(alone, 0, rng, { blunder: 0 })).toBe("bank");
    alone.paws[0] = 0;
    expect(botChoice(alone, 0, rng, { blunder: 0 })).toBe("take1");
    const alone2 = newHive([H, H, wasp, H], 3, 0);
    alone2.status = ["in", "banked", "stung"];
    expect(botChoice(alone2, 0, rng, { blunder: 0 })).toBe("take2");
  });

  it("bots grab two when nothing is in view and bank once the hidden risk outweighs another bite", () => {
    const rng = new Rng(2);
    const calm = newHive([H, H, H, H, H, H, H, H, wasp], 2, 0);
    calm.paws[0] = 3;
    expect(botChoice(calm, 0, rng, { blunder: 0 })).toBe("take2");
    const hot = newHive([H, H, H, wasp, wasp, H], 2, 0);
    hot.paws[0] = 9;
    expect(botChoice(hot, 0, rng, { blunder: 0, nerve: 1 })).toBe("bank");
    expect(botChoice(hot, 0, rng, { blunder: 0, nerve: 2 })).toBe("take2");
    expect(botChoice(newHive([H], 2, 0), 0, rng, { blunder: 0 })).toBe("take1");
  });

  it("a blunder never walks straight into a visible wasp", () => {
    const rng = new Rng(9);
    const s = newHive([H, wasp, H, H, H], 2, 0);
    for (let i = 0; i < 50; i++) expect(botChoice(s, 0, rng, { blunder: 1 })).toBe("take1");
    const open = newHive([H, H, H, H, H], 2, 0);
    expect(botChoice(open, 0, rng, { blunder: 1 })).toBe("take1");
  });

  it("smaller tables get longer hives", () => {
    expect(extraCombs(2)).toBe(6);
    expect(extraCombs(3)).toBe(3);
    expect(extraCombs(4)).toBe(0);
  });

  it("leaders share the top total and the underdog is the unique lowest", () => {
    expect(leaders([4, 9, 9, -2])).toEqual([1, 2]);
    expect(leaders([-5, -1])).toEqual([1]);
    expect(underdog([4, 2, 9])).toBe(1);
    expect(underdog([2, 2, 9])).toBeNull();
    expect(underdog([5])).toBeNull();
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

type Internals = { hive: HiveState; seats: { banked: number }[] };
const tap = (down: (e: unknown) => void, x: number, y: number, id: number): void =>
  down({ clientX: x, clientY: y, pointerId: id, preventDefault: () => undefined });

describe("hive heist game", () => {
  it("an all-bot table plays three hives to the end", () => {
    const game = hiveHeist.create(context("bot", 11));
    for (let f = 0; f < 60 * 180 && !game.isFinished(); f++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    expect(game.getScores()).toHaveLength(4);
    const stats = game.getStats?.() ?? [];
    expect(stats.every((s) => s.label === "Best haul")).toBe(true);
    expect(stats).toHaveLength(4);
    game.destroy();
  });

  it("humans who never tap time out with TAKE 1 and the game still finishes", () => {
    const game = hiveHeist.create(context("human", 3));
    for (let f = 0; f < 60 * 400 && !game.isFinished(); f++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    game.destroy();
  });

  it("humans take two, bank their paws, then release a wasp from the swarm", () => {
    const ctx = context("human", 7);
    const game = hiveHeist.create(ctx);
    const add = ctx.canvas.addEventListener as unknown as Mock;
    const down = add.mock.calls.find((c) => c[0] === "pointerdown")![1] as (e: unknown) => void;
    const state = game as unknown as Internals;
    state.hive.queue = Array.from({ length: 10 }, () => honey(2));
    for (let f = 0; f < 60 * 2; f++) game.update(1 / 60);
    tap(down, 1280 * 0.5, 720 * 0.82, 1);
    expect(state.hive.queue.length).toBe(8);
    expect(state.hive.paws[0]).toBe(4);
    // Not this seat's turn any more: a second tap during the chomp beat is ignored.
    tap(down, 1280 * 0.18, 720 * 0.82, 2);
    expect(state.hive.queue.length).toBe(8);
    // Bank is dimmed with empty paws: P1 taps it, nothing happens, then takes one.
    for (let f = 0; f < 60; f++) game.update(1 / 60);
    tap(down, 1280 * 0.81, 720 * 0.82, 3);
    expect(state.hive.status[1]).toBe("in");
    tap(down, 1280 * 0.18, 720 * 0.82, 4);
    expect(state.hive.queue.length).toBe(7);
    for (const id of [5, 6]) {
      for (let f = 0; f < 60; f++) game.update(1 / 60);
      tap(down, 1280 * 0.18, 720 * 0.82, id);
    }
    expect(state.hive.queue.length).toBe(5);
    for (let f = 0; f < 60; f++) game.update(1 / 60);
    expect(state.hive.turn).toBe(0);
    tap(down, 1280 * 0.81, 720 * 0.82, 7);
    expect(state.hive.status[0]).toBe("banked");
    expect(state.seats[0]!.banked).toBe(4);
    // In the swarm: tapping the own card drops a wasp into the hidden combs, once.
    for (let f = 0; f < 60; f++) game.update(1 / 60);
    tap(down, 185, 80, 8);
    expect(state.hive.queue.length).toBe(6);
    expect(state.hive.queue.filter((it) => it.kind === "wasp" && it.owner === 0)).toHaveLength(1);
    tap(down, 185, 80, 9);
    expect(state.hive.queue.length).toBe(6);
    game.destroy();
    expect((ctx.canvas.removeEventListener as unknown as Mock).mock.calls.length).toBe(3);
  });
});

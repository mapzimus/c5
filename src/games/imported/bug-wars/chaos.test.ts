import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../../core/rng";
import type { GameContext, PlayerKind } from "../../../core/types";
import { bugWars } from "./bug-wars";
import {
  CHAOS_KINDS,
  MAX_ITEMS_ON_BOARD,
  PERSONAS,
  addStash,
  applyChaos,
  attackBonuses,
  battleHeadline,
  isLastStand,
  leaderSeat,
  personaFor,
  personaOptions,
  pickChaos,
  planChaos,
  spawnItems,
  trailingSeat,
  triggerItem,
  underdogBonus,
} from "./chaos";
import {
  BOT_BATTLE_SPEED,
  MAX_BUGS,
  MAX_ROUNDS,
  STASH_MAX,
  type Board,
  botPickAttack,
  endTurnIncome,
  generateBoard,
  judgeBattle,
  playbackSpeed,
  rollBattle,
  winChance,
} from "./rules";

function line(owners: number[], bugs: number[]): Board {
  return {
    cols: owners.length,
    rows: 1,
    holes: new Set(),
    tiles: owners.map((owner, id) => ({ id, col: id, row: 0, owner, bugs: bugs[id]!, item: null })),
    adjacency: owners.map((_, id) => [id - 1, id + 1].filter((n) => n >= 0 && n < owners.length)),
  };
}

describe("jackpots and bonus dice", () => {
  it("three matching attack dice auto-win even on a lower sum", () => {
    const b = judgeBattle(0, 1, 0, 1, [1, 1, 1], [6, 6]);
    expect(b.jackpot).toBe("attack");
    expect(b.captured).toBe(true);
  });

  it("a defending jackpot beats an attacking one", () => {
    const b = judgeBattle(0, 1, 0, 1, [6, 6, 6], [2, 2, 2]);
    expect(b.jackpot).toBe("defend");
    expect(b.captured).toBe(false);
  });

  it("two matching dice are not a jackpot", () => {
    const b = judgeBattle(0, 1, 0, 1, [6, 6], [1, 1]);
    expect(b.jackpot).toBeNull();
    expect(b.captured).toBe(true);
  });

  it("rollBattle adds bonus dice", () => {
    const board = line([0, 1], [3, 2]);
    const b = rollBattle(board, 0, 1, new Rng(3), { attackDice: 2, defendDice: 1 });
    expect(b.attackRolls).toHaveLength(5);
    expect(b.defendRolls).toHaveLength(3);
  });

  it("winChance is sane", () => {
    expect(winChance(8, 1)).toBeGreaterThan(0.99);
    expect(winChance(1, 8)).toBeLessThan(0.01);
    expect(winChance(3, 3)).toBeLessThan(0.5);
    expect(winChance(4, 3)).toBeGreaterThan(winChance(3, 3));
  });

  it("revenge, pepper, frenzy and last stand stack up", () => {
    const board = line([0, 1, 1], [5, 3, 3]);
    const bonus = attackBonuses(board, 0, 1, { grudge: 1, pepper: 2, round: MAX_ROUNDS });
    expect(bonus.attackDice).toBe(4);
    expect(bonus.defendDice).toBe(1);
    expect(bonus.labels).toEqual(["+1 REVENGE", "+2 HOT PEPPER", "+1 FRENZY", "+1 LAST STAND"]);
    expect(attackBonuses(board, 0, 1, { grudge: -1, pepper: 0, round: 1 }).labels).toEqual(["+1 LAST STAND"]);
    expect(isLastStand(board, 1)).toBe(true);
  });
});

describe("items", () => {
  it("spawns on free tiles and never over the cap", () => {
    const board = generateBoard(new Rng(5), 4);
    spawnItems(board, new Rng(6), 50);
    expect(board.tiles.filter((t) => t.item).length).toBe(MAX_ITEMS_ON_BOARD);
  });

  it("cake adds bugs, capped", () => {
    const board = line([0, 1], [3, 7]);
    board.tiles[1]!.item = "cake";
    const fx = triggerItem(board, 1, 1)!;
    expect(fx.kind).toBe("cake");
    expect(board.tiles[1]!.bugs).toBe(MAX_BUGS);
    expect(board.tiles[1]!.item).toBeNull();
    expect(triggerItem(board, 1, 1)).toBeNull();
  });

  it("firecracker halves enemy neighbours only", () => {
    const board = line([1, 0, 1, 2], [6, 2, 5, 8]);
    board.tiles[1]!.item = "firecracker";
    triggerItem(board, 1, 0);
    expect(board.tiles[0]!.bugs).toBe(3);
    expect(board.tiles[2]!.bugs).toBe(3);
    expect(board.tiles[3]!.bugs).toBe(8);
  });

  it("egg, pepper and trap", () => {
    const board = line([0, 1, 1], [3, 5, 5]);
    board.tiles[0]!.item = "egg";
    board.tiles[1]!.item = "pepper";
    board.tiles[2]!.item = "trap";
    expect(triggerItem(board, 0, 0)!.stashGain).toBe(5);
    expect(triggerItem(board, 1, 1)!.pepperDice).toBe(2);
    triggerItem(board, 2, 1);
    expect(board.tiles[2]!.bugs).toBe(1);
    expect(addStash(STASH_MAX - 1, 5)).toBe(STASH_MAX);
  });
});

describe("comebacks", () => {
  it("leader and trailer", () => {
    const board = line([0, 0, 0, 1], [2, 2, 2, 2]);
    expect(leaderSeat(board, 2)).toBe(0);
    expect(trailingSeat(board, 2)).toBe(1);
  });

  it("underdog bonus grows with the gap and caps at 4", () => {
    const owners = [...Array(20).fill(0), 1];
    const board = line(owners, owners.map(() => 1));
    expect(underdogBonus(board, 1, 2)).toBe(4);
    expect(underdogBonus(board, 0, 2)).toBe(0);
    const close = line([0, 0, 1], [1, 1, 1]);
    expect(underdogBonus(close, 1, 2)).toBe(0);
  });

  it("endTurnIncome includes the bonus", () => {
    const board = line([0, 0, 1], [1, 1, 1]);
    expect(endTurnIncome(board, 0, 0, new Rng(1), 3).income).toBe(5);
  });
});

describe("backyard chaos", () => {
  it("never repeats the previous event", () => {
    const rng = new Rng(9);
    for (let i = 0; i < 40; i++) expect(pickChaos(rng, "shoe")).not.toBe("shoe");
  });

  it("the shoe stomps the leader's biggest stack to 1", () => {
    const board = line([0, 0, 0, 1], [2, 8, 3, 6]);
    const plan = planChaos(board, 2, "shoe", new Rng(1));
    expect(plan.tiles).toEqual([1]);
    const res = applyChaos(board, plan, new Rng(1));
    expect(board.tiles[1]!.bugs).toBe(1);
    expect(res.squashed).toBe(7);
  });

  it("ladybug helps last place", () => {
    const board = line([0, 0, 0, 1], [2, 2, 2, 2]);
    const plan = planChaos(board, 2, "ladybug", new Rng(1));
    expect(plan.seat).toBe(1);
    applyChaos(board, plan, new Rng(1));
    expect(board.tiles[3]!.bugs).toBe(6);
  });

  it("every event keeps owners and leaves at least 1 bug", () => {
    for (const kind of CHAOS_KINDS) {
      const board = generateBoard(new Rng(11), 3);
      const owners = board.tiles.map((t) => t.owner);
      applyChaos(board, planChaos(board, 3, kind, new Rng(2)), new Rng(2));
      expect(board.tiles.map((t) => t.owner)).toEqual(owners);
      for (const t of board.tiles) {
        expect(t.bugs).toBeGreaterThanOrEqual(1);
        expect(t.bugs).toBeLessThanOrEqual(MAX_BUGS);
      }
    }
  });
});

describe("bot personas", () => {
  it("every slot gets a persona", () => {
    const kinds = new Set([0, 1, 2, 3].map((slot) => personaFor(slot, 1).kind));
    expect(kinds.size).toBe(4);
  });

  it("careful bots skip thin edges, reckless ones go for it", () => {
    const board = line([0, 1], [4, 3]);
    const ctx = { grudge: -1, pepper: 0, round: 1 };
    expect(botPickAttack(board, 0, new Rng(1), personaOptions(board, 0, 2, PERSONAS.careful, ctx))).toBeNull();
    const even = line([0, 1, 1, 1], [3, 3, 3, 3]);
    expect(botPickAttack(even, 0, new Rng(1), personaOptions(even, 0, 2, PERSONAS.reckless, ctx))).not.toBeNull();
  });

  it("bots count pepper dice when judging a fight", () => {
    const board = line([0, 1], [3, 4]);
    const plain = personaOptions(board, 0, 2, PERSONAS.careful, { grudge: -1, pepper: 0, round: 1 });
    const spicy = personaOptions(board, 0, 2, PERSONAS.careful, { grudge: -1, pepper: 2, round: 1 });
    expect(botPickAttack(board, 0, new Rng(1), plain)).toBeNull();
    // 3 bugs + 2 pepper vs 4 bugs with last stand +1 = edge 0, still too thin for careful
    expect(botPickAttack(board, 0, new Rng(1), spicy)).toBeNull();
    const reckless = personaOptions(board, 0, 2, PERSONAS.reckless, { grudge: -1, pepper: 2, round: 1 });
    expect(botPickAttack(board, 0, new Rng(1), reckless)).not.toBeNull();
  });
});

describe("headlines", () => {
  it("calls out upsets and jackpots", () => {
    expect(battleHeadline(2, 6, true, null, 3)).toBe("UPSET!");
    expect(battleHeadline(3, 3, true, "attack", -4)).toBe("JACKPOT! AUTO-WIN!");
    expect(battleHeadline(8, 2, false, null, -2)).toBe("EPIC FAIL!");
    expect(battleHeadline(5, 4, true, null, 6)).toBeNull();
  });
});

function context(kinds: PlayerKind[], seed: number): GameContext {
  return {
    width: 1280,
    height: 720,
    rng: new Rng(seed),
    minTap: 44,
    players: kinds.map((kind, slot) => ({ id: `p${slot}`, name: `P${slot}`, color: ["#3EE0FF", "#FF3D7A", "#FFB020", "#B8FF3D"][slot]!, kind, slot })),
    canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    input: { consumeClick: () => null, justPressed: () => false, isDown: () => false, hover: null },
    sfx: new Proxy({}, { get: () => vi.fn() }),
  } as unknown as GameContext;
}

/** A 2D context that accepts every call, so render paths get exercised headlessly. */
function fakeCanvas(): CanvasRenderingContext2D {
  const noop = () => undefined;
  return new Proxy({} as Record<string, unknown>, {
    get: (target, prop) => {
      if (prop in target) return target[prop as string];
      if (prop === "measureText") return () => ({ width: 40 });
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => ({ addColorStop: noop });
      return noop;
    },
    set: (target, prop, value) => {
      target[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

describe("full game", () => {
  for (const [label, kinds] of [
    ["2 bots", ["bot", "bot"]],
    ["4 bots", ["bot", "bot", "bot", "bot"]],
    ["idle humans + bots", ["human", "bot", "human"]],
  ] as [string, PlayerKind[]][]) {
    it(`${label} always finishes`, () => {
      for (const seed of [1, 7, 42]) {
        const game = bugWars.create(context(kinds, seed));
        let frames = 0;
        const limit = 60 * 60 * 30; // 30 simulated minutes at 30 fps
        while (!game.isFinished() && frames < limit) {
          game.update(1 / 30);
          if (frames % 45 === 0) game.render(fakeCanvas());
          frames++;
        }
        expect(game.isFinished()).toBe(true);
        const scores = game.getScores();
        expect(scores).toHaveLength(kinds.length);
        expect(scores.reduce((s, p) => s + p.score, 0)).toBeGreaterThan(0);
        game.getStats?.();
        game.destroy();
      }
    });
  }
});

describe("pacing with bots", () => {
  it("humans' own fights play at full speed, bot fights zip, and a tap skips further", () => {
    expect(playbackSpeed({ humanTurn: true })).toBe(1);
    expect(playbackSpeed({ humanTurn: true, skipping: true })).toBe(1);
    const vsHuman = playbackSpeed({ humanTurn: false, humanDefending: true });
    expect(vsHuman).toBeGreaterThan(1);
    expect(vsHuman).toBeLessThan(BOT_BATTLE_SPEED);
    expect(playbackSpeed({ humanTurn: false })).toBe(BOT_BATTLE_SPEED);
    expect(playbackSpeed({ humanTurn: false, skipping: true })).toBeGreaterThan(BOT_BATTLE_SPEED);
  });

  /** Seconds a human (seat 0, passing instantly) waits between turns against three bots. */
  function averageWait(seed: number, tapDuringBots: boolean): number {
    let tap = false;
    const ctx = context(["human", "bot", "bot", "bot"], seed);
    ctx.input.consumeClick = () => (tap ? { x: 10, y: 10 } : null);
    const game = bugWars.create(ctx);
    const state = game as any;
    const waits: number[] = [];
    let waitStart = -1;
    let t = 0;
    for (let f = 0; f < 60 * 60 * 20 && !game.isFinished() && waits.length < 6; f++) {
      tap = tapDuringBots && waitStart >= 0 && f % 20 === 0;
      game.update(1 / 60);
      t += 1 / 60;
      if (state.currentSeat === 0 && (state.phase === "pick" || state.phase === "target")) {
        expect(state.skipping).toBe(false);
        if (waitStart >= 0) waits.push(t - waitStart);
        state.advanceTurn();
        waitStart = t;
      }
    }
    game.destroy();
    expect(waits.length).toBeGreaterThan(2);
    return waits.reduce((a, b) => a + b, 0) / waits.length;
  }

  it("a human waits well under 20s between turns with three bots, and tapping cuts it further", () => {
    for (const seed of [1, 2, 3]) {
      const normal = averageWait(seed, false);
      const skipped = averageWait(seed, true);
      expect(normal).toBeLessThan(12);
      expect(skipped).toBeLessThan(normal * 0.7);
    }
  });
});

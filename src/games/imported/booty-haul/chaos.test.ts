import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../../core/rng";
import type { GameContext } from "../../../core/types";
import { buildLanes } from "./geo";
import { bootyHaul } from "./booty-haul";
import {
  advanceGhost,
  assignPersonas,
  bark,
  BARKS,
  BOARD_PAIR_COOLDOWN_S,
  BOARD_STEAL,
  boardPairBlocked,
  boardPairKey,
  REVENGE_BONUS,
  WANTED_STEAL,
  boardingSteal,
  botBoardTarget,
  canStartEvent,
  collectChests,
  cursedRaid,
  findBoardingVictim,
  ghostClaimant,
  ghostPos,
  inFinalStretch,
  krakenTarget,
  krakenToll,
  krakenVictims,
  pickEvent,
  PERSONAS,
  spawnChests,
  spawnGhost,
  stretchMultiplier,
  wantedId,
  type Anchorage,
} from "./chaos";
import { GAME_DURATION_S } from "./rules";

const lanes = buildLanes();
const anchor = (id: string, ll: [number, number], score: number, extra: Partial<Anchorage> = {}): Anchorage => ({
  id, parked: true, ll, score, shield: 0, ...extra,
});

describe("Booty Haul boarding", () => {
  it("steals a flat, capped haul (no snowballing with the victim's score)", () => {
    expect(boardingSteal(0, false)).toBe(0);
    expect(boardingSteal(5, false)).toBe(5);
    expect(boardingSteal(50, false)).toBe(BOARD_STEAL);
    expect(boardingSteal(1000, false)).toBe(BOARD_STEAL);
    expect(boardingSteal(100000, false)).toBe(BOARD_STEAL);
    expect(boardingSteal(1000, true)).toBe(WANTED_STEAL);
    expect(boardingSteal(1000, false, true)).toBe(BOARD_STEAL + REVENGE_BONUS);
    expect(boardingSteal(1000, true, true)).toBeLessThanOrEqual(100);
  });

  it("blocks the same boarder from re-boarding the same victim during the pair cooldown", () => {
    const history = new Map<string, number>([[boardPairKey("a", "b"), 10]]);
    expect(boardPairBlocked(history, "a", "b", 11)).toBe(true);
    expect(boardPairBlocked(history, "a", "b", 10 + BOARD_PAIR_COOLDOWN_S)).toBe(false);
    // Revenge (the other direction) is a different pair and stays open.
    expect(boardPairBlocked(history, "b", "a", 11)).toBe(false);
    const fleet = [anchor("me", [51, 1.4], 0), anchor("b", [51.5, 1.4], 100)];
    expect(findBoardingVictim("me", [51, 1.4], fleet, (id) => id === "b")).toBeNull();
    expect(botBoardTarget("me", fleet, null, (id) => id === "b")).toBeNull();
  });

  it("finds the nearest unshielded rival within range", () => {
    const fleet = [
      anchor("me", [51, 1.4], 0),
      anchor("near", [51.5, 1.4], 100),
      anchor("shielded", [51.1, 1.4], 100, { shield: 2 }),
      anchor("far", [10, 10], 100),
    ];
    expect(findBoardingVictim("me", [51, 1.4], fleet)?.id).toBe("near");
    expect(findBoardingVictim("me", [0, 0], fleet)).toBeNull();
  });

  it("marks a runaway leader WANTED, and bots hunt them", () => {
    expect(wantedId([{ id: "a", score: 100 }, { id: "b", score: 90 }])).toBeNull();
    expect(wantedId([{ id: "a", score: 300 }, { id: "b", score: 100 }])).toBe("a");
    expect(wantedId([{ id: "a", score: 300 }])).toBeNull();
    const fleet = [anchor("bot", [0, 0], 10), anchor("rich", [5, 5], 500), anchor("w", [6, 6], 200)];
    expect(botBoardTarget("bot", fleet, "w")?.id).toBe("w");
    expect(botBoardTarget("bot", fleet, null)?.id).toBe("rich");
  });
});

describe("Booty Haul sea events", () => {
  it("never repeats the same event twice in a row and stops near the end", () => {
    const rng = new Rng(3);
    let last = pickEvent(rng, null);
    for (let i = 0; i < 40; i++) {
      const next = pickEvent(rng, last);
      expect(next).not.toBe(last);
      last = next;
    }
    expect(canStartEvent(10)).toBe(true);
    expect(canStartEvent(GAME_DURATION_S - 1)).toBe(false);
  });

  it("kraken surfaces near the WANTED captain and only hits anchors in its circle", () => {
    const fleet = [anchor("a", [20, 20], 100), anchor("b", [-40, 100], 100)];
    const c = krakenTarget(new Rng(1), fleet, "a", [0, 0]);
    expect(Math.abs(c[0] - 20)).toBeLessThanOrEqual(2);
    expect(krakenVictims(c, fleet).map((v) => v.id)).toEqual(["a"]);
    expect(krakenToll(200)).toBe(30);
  });

  it("treasure chests go to the nearest anchor in range, once", () => {
    const chests = spawnChests(new Rng(5), lanes, 5, [40, -40]);
    expect(chests).toHaveLength(5);
    expect(chests[0]!.value).toBe(30);
    for (const c of chests.slice(1)) expect(c.value).toBeLessThanOrEqual(15);
    const target = chests[1]!.ll;
    const fleet = [anchor("a", [target[0], target[1]], 0), anchor("b", [target[0] + 1, target[1]], 0)];
    const got = collectChests(chests, fleet);
    expect(got.some((g) => g.chest === chests[1] && g.playerId === "a")).toBe(true);
    expect(collectChests(chests, fleet)).toHaveLength(0);
  });

  it("ghost ship sails fast, stays on its lane, and can be claimed", () => {
    const ghost = spawnGhost(new Rng(9), lanes, [30, 0]);
    for (let i = 0; i < 600; i++) advanceGhost(ghost, lanes, 0.1);
    expect(ghost.km).toBeGreaterThanOrEqual(0);
    expect(ghost.km).toBeLessThanOrEqual(lanes[ghost.laneIdx]!.lengthKm);
    const gp = ghostPos(ghost, lanes);
    expect(ghostClaimant(gp, [anchor("x", [gp[0], gp[1]], 0)])).toBe("x");
    expect(ghostClaimant(gp, [anchor("x", [gp[0] + 30, gp[1]], 0)])).toBeNull();
  });

  it("cursed raids either triple or cost the raid", () => {
    const rng = new Rng(11);
    let cursed = 0;
    for (let i = 0; i < 200; i++) {
      const r = cursedRaid(rng, 10);
      if (r.cursed) { cursed++; expect(r.delta).toBe(-10); } else expect(r.delta).toBe(30);
    }
    expect(cursed).toBeGreaterThan(20);
    expect(cursed).toBeLessThan(120);
  });

  it("LAST CALL doubles everything in the final 15 seconds", () => {
    expect(stretchMultiplier(10)).toBe(1);
    expect(inFinalStretch(GAME_DURATION_S - 5)).toBe(true);
    expect(stretchMultiplier(GAME_DURATION_S - 5)).toBe(2);
  });
});

describe("Booty Haul flavour", () => {
  it("fills barks with names", () => {
    const line = bark(new Rng(2), "board", "Ace", "Blitz");
    expect(line).not.toMatch(/\{a\}|\{b\}/);
    for (const lines of Object.values(BARKS)) expect(lines.length).toBeGreaterThan(0);
  });

  it("gives bots distinct personalities", () => {
    const ps = assignPersonas(new Rng(4), 3);
    expect(new Set(ps.map((p) => p.key)).size).toBe(3);
    expect(assignPersonas(new Rng(4), 6)).toHaveLength(6);
    expect(PERSONAS.length).toBeGreaterThanOrEqual(3);
  });
});

function botContext(seed: number, kinds: ("human" | "bot")[]): GameContext {
  return {
    width: 1280, height: 720, rng: new Rng(seed), minTap: 44,
    players: kinds.map((kind, slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind, slot })),
    canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) },
    input: { consumeClick: () => null, justPressed: () => false, hover: null },
    sfx: new Proxy({}, { get: () => vi.fn() }),
  } as unknown as GameContext;
}

describe("Booty Haul game loop", () => {
  it("a four-bot game finishes with chaos: events, boardings and non-negative scores", () => {
    for (const seed of [1, 7, 42]) {
      const game = bootyHaul.create(botContext(seed, ["bot", "bot", "bot", "bot"]));
      const state = game as any;
      const kinds = new Set<string>();
      let frames = 0;
      while (!game.isFinished() && frames < 120 * 60) {
        game.update(1 / 60);
        if (state.event) kinds.add(state.event.kind);
        frames++;
      }
      expect(game.isFinished()).toBe(true);
      expect(kinds.size).toBeGreaterThanOrEqual(2);
      const scores = game.getScores();
      expect(scores).toHaveLength(4);
      for (const s of scores) {
        expect(s.score).toBeGreaterThanOrEqual(0);
        // Human-readable booty: hundreds, not tens of thousands.
        expect(s.score).toBeLessThan(2000);
      }
      expect(scores.some((s) => s.score > 0)).toBe(true);
      expect(game.getStats!().length).toBe(8);
      game.destroy();
    }
  });

  it("anchoring on a rival boards them: booty moves, victim gets a shield and a free move", () => {
    const game = bootyHaul.create(botContext(3, ["human", "human"]));
    const state = game as any;
    state.park("p1", [51, 1.4]);
    state.playerStates.get("p1").score = 500;
    state.park("p0", [51.2, 1.5]);
    const [a, b] = game.getScores();
    expect(a!.score).toBe(BOARD_STEAL);
    expect(b!.score).toBe(500 - BOARD_STEAL);
    expect(state.playerStates.get("p1").shield).toBeGreaterThan(0);
    // Shielded: an immediate re-board does nothing.
    state.park("p0", [51, 1.4]);
    expect(game.getScores()[1]!.score).toBe(500 - BOARD_STEAL);
    // Revenge pays extra (capped at what the boarder holds).
    state.playerStates.get("p0").score = 100;
    state.park("p1", [51.05, 1.45]);
    expect(game.getScores()[0]!.score).toBe(100 - BOARD_STEAL - REVENGE_BONUS);
    game.destroy();
  });

  it("boarding can't ping-pong: the same pair is locked out for the cooldown", () => {
    const game = bootyHaul.create(botContext(3, ["human", "human"]));
    const state = game as any;
    state.park("p1", [51, 1.4]);
    state.playerStates.get("p1").score = 500;
    state.park("p0", [51.2, 1.5]);
    expect(game.getScores()[0]!.score).toBe(BOARD_STEAL);
    // Shield expires, but p0 still can't board p1 again until the pair cooldown ends.
    state.playerStates.get("p1").shield = 0;
    state.playerStates.get("p0").reparks = 2;
    state.park("p0", [51.1, 1.4]);
    expect(game.getScores()[0]!.score).toBe(BOARD_STEAL);
    state.elapsed += BOARD_PAIR_COOLDOWN_S;
    state.playerStates.get("p0").reparks = 2;
    state.park("p0", [51.05, 1.4]);
    expect(game.getScores()[0]!.score).toBe(BOARD_STEAL * 2);
    game.destroy();
  });
});

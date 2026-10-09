import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import type { GameContext } from "../../core/types";
import { eyeOfTheStorm } from "./eye-of-the-storm";
import { PUCK_RADIUS, blast, collideKinematic, collidePucks, isResting, slideDistance, stepWorld, type Puck, type World } from "./physics";
import {
  CATCH_UP_GAP,
  PUCK_SPECS,
  BULLY_MIN_POINTS,
  botShot,
  bullyTarget,
  catchUpPlayers,
  clearShot,
  launchVelocity,
  leaderOf,
  lightningTarget,
  padPositions,
  puckPoints,
  pullForDistance,
  ringPoints,
  rollMagazine,
  scoreBoard,
  splitVelocities,
  matchRemaining,
  volleyRemaining,
} from "./rules";

const W = 1280;
const H = 720;
const center = { x: W / 2, y: H / 2 };

function puck(owner: string, x: number, y: number, extra: Partial<Puck> = {}): Puck {
  return { id: Math.random(), owner, x, y, vx: 0, vy: 0, r: PUCK_RADIUS, ...extra };
}

function world(pucks: Puck[]): World {
  return { width: W, height: H, pucks, pegs: [], swirl: { ...center, radius: 300, spin: 0 } };
}

function settle(w: World): void {
  for (let i = 0; i < 600 && !w.pucks.every(isResting); i += 1) stepWorld(w, 1 / 60);
}

describe("special pucks", () => {
  it("a heavy puck barely slows when it rams a normal one", () => {
    const heavy = puck("a", 100, 100, { vx: 600, mass: 3 });
    const light = puck("b", 100 + PUCK_RADIUS * 2 - 1, 100);
    collidePucks(heavy, light);
    expect(light.vx).toBeGreaterThan(heavy.vx);
    expect(heavy.vx).toBeGreaterThan(200);
  });

  it("an anchored sticky puck can't be shoved by pucks, but a blast unsticks it", () => {
    const sticky = puck("a", 640, 360, { anchored: true, kind: "sticky" });
    const w = world([puck("b", 400, 360, { vx: 900 }), sticky]);
    settle(w);
    expect(sticky.x).toBe(640);
    blast(w.pucks, 600, 360, 150, 900);
    expect(sticky.anchored).toBe(false);
    expect(sticky.vx).toBeGreaterThan(0);
  });

  it("a blast pushes neighbours outward, harder up close, and skips the bomb", () => {
    const near = puck("a", 650, 360);
    const far = puck("b", 760, 360);
    const away = puck("c", 1000, 360);
    const bomb = puck("d", 640, 360, { id: 99 });
    const hit = blast([near, far, away, bomb], 640, 360, 150, 900, 99);
    expect(hit).toEqual([near, far]);
    expect(near.vx).toBeGreaterThan(far.vx);
    expect(away.vx).toBe(0);
    expect(bomb.vx).toBe(0);
  });

  it("a flying cow bats pucks out of its way", () => {
    const p = puck("a", 640, 360);
    const impact = collideKinematic(p, { x: 610, y: 360, vx: 520, vy: 0, r: 36 });
    expect(impact).toBeGreaterThan(0);
    expect(p.vx).toBeGreaterThan(500);
  });

  it("splitter shards fan out around the original heading", () => {
    const parts = splitVelocities(1000, 0);
    expect(parts).toHaveLength(3);
    expect(parts[0]!.vy).toBeLessThan(0);
    expect(parts[1]!.vy).toBeCloseTo(0);
    expect(parts[2]!.vy).toBeGreaterThan(0);
  });

  it("shards score half (rounded up) and bombs score nothing", () => {
    expect(puckPoints(puck("a", center.x, center.y, { kind: "mini" }), center)).toBe(5);
    expect(puckPoints(puck("a", center.x + 130, center.y, { kind: "mini" }), center)).toBe(1);
    expect(puckPoints(puck("a", center.x, center.y, { kind: "bomb" }), center)).toBe(0);
    expect(puckPoints(puck("a", center.x, center.y, { kind: "heavy" }), center)).toBe(10);
    const scores = scoreBoard([puck("a", center.x, center.y, { kind: "mini" }), puck("a", center.x, center.y)], ["a"], center);
    expect(scores.get("a")).toBe(15);
  });

  it("magazines hold the right number of specials and never lead with one", () => {
    for (let seed = 1; seed < 40; seed += 1) {
      const mag = rollMagazine(new Rng(seed), 6, 3);
      expect(mag).toHaveLength(6);
      expect(mag[0]).toBe("normal");
      expect(mag.filter((k) => k !== "normal")).toHaveLength(3);
    }
    expect(rollMagazine(new Rng(1), 6, 0).every((k) => k === "normal")).toBe(true);
    expect(PUCK_SPECS.heavy.mass).toBeGreaterThan(PUCK_SPECS.normal.mass);
  });
});

describe("standings and the storm", () => {
  it("names a single leader, or nobody on a tie or empty board", () => {
    expect(leaderOf(new Map([["a", 10], ["b", 4]]))).toBe("a");
    expect(leaderOf(new Map([["a", 10], ["b", 10]]))).toBeNull();
    expect(leaderOf(new Map([["a", 0], ["b", 0]]))).toBeNull();
  });

  it("gives storm luck only to players far behind", () => {
    expect(catchUpPlayers(new Map([["a", 30], ["b", 30 - CATCH_UP_GAP], ["c", 25]]))).toEqual(["b"]);
    expect(catchUpPlayers(new Map([["a", 0], ["b", 0]]))).toEqual([]);
  });

  it("lightning hunts the leader's best resting puck", () => {
    const best = puck("a", center.x, center.y);
    const pucks = [puck("a", center.x + 130, center.y), best, puck("b", center.x + 5, center.y + 5)];
    expect(lightningTarget(pucks, new Map([["a", 12], ["b", 10]]), center)).toBe(best);
    expect(lightningTarget(pucks, new Map([["a", 10], ["b", 10]]), center)).toBeNull();
  });
});

describe("bots with personality", () => {
  it("slideDistance and pullForDistance agree with the simulation", () => {
    const pad = { x: 100, y: 360 };
    for (const d of [300, 500, 700]) {
      const pull = pullForDistance(d);
      const v = launchVelocity(pad, { x: pad.x - pull, y: pad.y })!;
      const w = world([puck("a", pad.x, pad.y, { vx: v.vx })]);
      settle(w);
      expect(Math.abs(w.pucks[0]!.x - pad.x - d)).toBeLessThan(25);
      expect(slideDistance(v.vx)).toBeCloseTo(d, 0);
    }
  });

  it("the sniper usually lands in the rings from every corner", () => {
    const rng = new Rng(3);
    let scored = 0;
    let shots = 0;
    for (const pad of padPositions(W, H)) {
      for (let i = 0; i < 10; i += 1) {
        const v = launchVelocity(pad, botShot(rng, "sniper", pad, center, [], "bot"))!;
        const w = world([puck("bot", pad.x, pad.y, v)]);
        settle(w);
        shots += 1;
        if (ringPoints(w.pucks[0]!.x, w.pucks[0]!.y, center) > 0) scored += 1;
      }
    }
    expect(scored / shots).toBeGreaterThan(0.7);
  });

  it("the bully aims at the best enemy puck, not the bullseye", () => {
    const pad = padPositions(W, H)[0]!;
    const enemy = puck("rival", center.x + 60, center.y + 40);
    const release = botShot(new Rng(5), "bully", pad, center, [enemy], "bot");
    const shot = Math.atan2(pad.y - release.y, pad.x - release.x);
    const toEnemy = Math.atan2(enemy.y - pad.y, enemy.x - pad.x);
    expect(Math.abs(shot - toEnemy)).toBeLessThan(0.15);
  });
});

function context(kinds: ("human" | "bot")[], seed: number): GameContext {
  return {
    width: W, height: H, rng: new Rng(seed), minTap: 44,
    players: kinds.map((kind, slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind, slot })),
    canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }) },
    input: { consumeClick: () => null, justPressed: () => false },
    sfx: new Proxy({}, { get: () => vi.fn() }),
  } as unknown as GameContext;
}

describe("the Bully is a real threat", () => {
  it("only targets enemy pucks worth a takeout with a clear lane", () => {
    const pad = padPositions(W, H)[0]!;
    const juicy = puck("rival", center.x, center.y);
    const outer = puck("rival", center.x + 140, center.y);
    expect(ringPoints(outer.x, outer.y, center)).toBeLessThan(BULLY_MIN_POINTS);
    expect(bullyTarget(pad, center, [outer], "bot")).toBeNull();
    expect(bullyTarget(pad, center, [outer, juicy], "bot")).toBe(juicy);
    // A blocker sitting on the line protects the bullseye puck.
    const mid = { x: (pad.x + juicy.x) / 2, y: (pad.y + juicy.y) / 2 };
    const blocker = puck("other", mid.x, mid.y);
    expect(clearShot(pad, juicy, [juicy, blocker])).toBe(false);
    expect(bullyTarget(pad, center, [juicy, blocker], "bot")).toBeNull();
    // Never its own puck.
    expect(bullyTarget(pad, center, [puck("bot", center.x, center.y)], "bot")).toBeNull();
  });

  it("knocks a bullseye puck out of the 10 most of the time, from every corner", () => {
    const rng = new Rng(8);
    let hits = 0;
    let shots = 0;
    for (const pad of padPositions(W, H)) {
      for (let i = 0; i < 8; i += 1) {
        const enemy = puck("rival", center.x + rng.float(-25, 25), center.y + rng.float(-25, 25));
        const v = launchVelocity(pad, botShot(rng, "bully", pad, center, [enemy], "bot"))!;
        const w = world([enemy, puck("bot", pad.x, pad.y, v)]);
        settle(w);
        shots += 1;
        if (ringPoints(enemy.x, enemy.y, center) < 10) hits += 1;
      }
    }
    expect(hits / shots).toBeGreaterThan(0.6);
  });
});

describe("match clock", () => {
  it("the volley bar drains with pucks fired, or the volley clock, whichever is closer to empty", () => {
    expect(volleyRemaining(24, 24, 0, 24)).toBe(1);
    expect(volleyRemaining(12, 24, 2, 24)).toBe(0.5);
    expect(volleyRemaining(24, 24, 18, 24)).toBe(0.25);
    expect(volleyRemaining(0, 24, 3, 24)).toBe(0);
  });

  it("the match bar spans three volleys and empties with the final puck", () => {
    expect(matchRemaining(1, 1)).toBe(1);
    expect(matchRemaining(2, 1)).toBeCloseTo(2 / 3);
    expect(matchRemaining(3, 0.5)).toBeCloseTo(1 / 6);
    expect(matchRemaining(3, 0)).toBe(0);
  });

  it("has no fixed engine timer and counts down a settle before the end", () => {
    expect(eyeOfTheStorm.durationMs).toBe(0);
    const game = eyeOfTheStorm.create(context(["bot", "bot"], 4));
    const state = game as any;
    let frames = 0;
    // Run until the very last puck of the match has left a pad.
    while (!(state.volley === 3 && state.seats.every((s: any) => s.mag.length === 0)) && frames < 120 * 60) {
      game.update(1 / 60);
      frames++;
    }
    expect(game.isFinished()).toBe(false);
    for (let i = 0; i < 2.5 * 60; i++) game.update(1 / 60);
    expect(game.isFinished()).toBe(false);
    for (let i = 0; i < 20 * 60 && !game.isFinished(); i++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    expect(state.finalSettle).toBeGreaterThanOrEqual(3);
    game.destroy();
  });
});

describe("whole game", () => {
  it.each([1, 2, 3, 4, 5])("four bots always finish (seed %i) and score something", (seed) => {
    const game = eyeOfTheStorm.create(context(["bot", "bot", "bot", "bot"], seed));
    let frames = 0;
    for (; frames < 120 * 60 && !game.isFinished(); frames++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    expect(frames / 60).toBeLessThan(100);
    const scores = game.getScores();
    expect(scores).toHaveLength(4);
    expect(scores.some((s) => s.score > 0)).toBe(true);
    expect(game.getStats?.().some((s) => s.label === "Bot style")).toBe(true);
    game.destroy();
  });

  it("a human who never shoots next to a bot still lets the game end", () => {
    const game = eyeOfTheStorm.create(context(["human", "bot"], 11));
    for (let frame = 0; frame < 120 * 60 && !game.isFinished(); frame++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    expect(game.getScores()[0]!.score).toBe(0);
  });
});

import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import type { GameContext } from "../../core/types";
import { COMBO_TO_FEVER, whack } from "./whack";
import { DURATION, MAX_STAGE, OVERDRIVE_AT, STAGE_TIME, THIEF_STEAL, type MoleKind } from "./logic";

function context(kind: "human" | "bot", seed = 7, count = 2): GameContext {
  return {
    width: 1280, height: 720, rng: new Rng(seed), minTap: 44,
    players: [...Array(count)].map((_, slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind, slot })),
    canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) },
    input: { consumeClick: () => null, justPressed: () => false },
    sfx: new Proxy({}, { get: () => vi.fn() }),
  } as unknown as GameContext;
}

function mole(kind: MoleKind, stage = 0, life = 1) {
  // upFor is set past the stage's threshold so update() recomputes the same stage.
  const upFor = Math.max(1 - life, stage * STAGE_TIME + 0.01);
  return { x: 100, y: 100, kind, life, maxLife: 1, upFor, stage, whacked: false, whackFlash: 0, whackedBy: null, points: 0, from: -1 };
}

describe("Bonk", () => {
  it("keeps the whack id under the new name", () => {
    expect(whack.id).toBe("whack");
    expect(whack.name).toBe("Bonk");
    expect(whack.durationMs).toBe(DURATION * 1000);
  });

  it("fat critters pay 5, thin ones 1, and a last-moment bonk is a CLUTCH", () => {
    const game = whack.create(context("human")) as any;
    const seat = game.seats[0];
    game.whackMole(seat, mole("normal", 0));
    expect(seat.score).toBe(1);
    game.whackMole(seat, mole("normal", MAX_STAGE));
    expect(seat.score).toBe(6);
    expect(seat.fatHits).toBe(1);
    game.whackMole(seat, mole("normal", 1, 0.05));
    expect(seat.score).toBe(6 + 2 + 1);
    game.destroy();
  });

  it("fills the combo meter into FEVER, which doubles points", () => {
    const game = whack.create(context("human")) as any;
    const seat = game.seats[0];
    for (let i = 0; i < COMBO_TO_FEVER; i++) game.whackMole(seat, mole("normal"));
    expect(seat.score).toBe(COMBO_TO_FEVER);
    expect(seat.fever).toBeGreaterThan(0);
    expect(seat.fevers).toBe(1);
    game.whackMole(seat, mole("normal"));
    expect(seat.score).toBe(COMBO_TO_FEVER + 2);
    game.whackMole(seat, mole("golden"));
    expect(seat.score).toBe(COMBO_TO_FEVER + 2 + 20);
    game.destroy();
  });

  it("bombs cost points, wipe the combo and end FEVER", () => {
    const game = whack.create(context("human")) as any;
    const seat = game.seats[0];
    for (let i = 0; i < 3; i++) game.whackMole(seat, mole("normal"));
    expect(seat.combo).toBe(3);
    seat.fever = 2;
    seat.score = 12;
    game.whackMole(seat, mole("bomb"));
    expect(seat.score).toBe(7);
    expect(seat.combo).toBe(0);
    expect(seat.fever).toBe(0);
    seat.score = 2;
    game.whackMole(seat, mole("bomb"));
    expect(seat.score).toBe(0);
    game.destroy();
  });

  it("an escaped critter resets the combo; a fat escape is SO CLOSE", () => {
    const game = whack.create(context("human")) as any;
    const seat = game.seats[0];
    for (let i = 0; i < 3; i++) game.whackMole(seat, mole("normal"));
    const m = mole("normal", MAX_STAGE, 0.001);
    seat.moles.push(m);
    game.update(1 / 60);
    expect(seat.combo).toBe(0);
    expect(seat.misses).toBe(1);
    expect(game.floaters.some((f: { text: string }) => f.text === "SO CLOSE")).toBe(true);
    game.destroy();
  });

  it("bonking a raider sends a thief to the leader, who loses 5 if it escapes and nothing if blocked", () => {
    const game = whack.create(context("human", 3, 3)) as any;
    const [a, b, c] = game.seats;
    a.score = 2;
    b.score = 20;
    c.score = 9;
    game.whackMole(a, mole("raider"));
    expect(a.score).toBe(3);
    expect(b.pendingThieves).toEqual([0]);
    game.update(1 / 60);
    const thief = b.moles.find((m: { kind: string }) => m.kind === "thief");
    expect(thief).toBeDefined();
    expect(thief.from).toBe(0);
    thief.life = 0.001;
    game.update(1 / 60);
    expect(b.score).toBe(20 - THIEF_STEAL);
    expect(a.score).toBe(3 + THIEF_STEAL);
    expect(a.stolen).toBe(THIEF_STEAL);
    expect(b.robbed).toBe(THIEF_STEAL);

    // Blocked thief: no points move, combo untouched.
    b.combo = 2;
    const blocked = mole("thief");
    blocked.from = 0;
    game.whackMole(b, blocked);
    expect(b.score).toBe(20 - THIEF_STEAL);
    expect(b.combo).toBe(2);

    // A thief can't take what the victim doesn't have.
    b.score = 2;
    const poor = mole("thief", 0, 0.001);
    poor.from = 0;
    b.moles.push(poor);
    game.update(1 / 60);
    expect(b.score).toBe(0);
    expect(a.score).toBe(3 + THIEF_STEAL + 2);
    game.destroy();
  });

  it("a tap on an empty hole is a whiff that costs combo, a tap on a critter bonks it", () => {
    const game = whack.create(context("human")) as any;
    const seat = game.seats[0];
    for (let i = 0; i < 4; i++) game.whackMole(seat, mole("normal"));
    const hole = seat.holes[4];
    game.tap(hole.x, hole.y);
    expect(seat.combo).toBe(2);
    game.tap(hole.x + 300, seat.zoneY + 5); // HUD area: not a hole, nothing happens
    expect(seat.combo).toBe(2);
    const m = { ...mole("normal", 2), x: hole.x, y: hole.y };
    seat.moles.push(m);
    game.tap(hole.x + 10, hole.y - 10);
    expect(m.whacked).toBe(true);
    expect(seat.score).toBe(4 + 3);
    game.destroy();
  });

  it("OVERDRIVE starts with 12 seconds left", () => {
    const game = whack.create(context("bot", 2)) as any;
    const frames = Math.ceil((DURATION - OVERDRIVE_AT - 0.5) * 60);
    for (let f = 0; f < frames; f++) game.update(1 / 60);
    expect(game.overdrive).toBe(false);
    for (let f = 0; f < 60; f++) game.update(1 / 60);
    expect(game.overdrive).toBe(true);
    game.destroy();
  });

  it("bots play a full round, score, fatten, raid and occasionally hit bombs", () => {
    let bombHits = 0;
    let fevers = 0;
    let fat = 0;
    let stolen = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const game = whack.create(context("bot", seed, seed % 2 ? 2 : 4));
      let frames = 0;
      for (; frames < 90 * 60 && !game.isFinished(); frames++) game.update(1 / 60);
      expect(game.isFinished()).toBe(true);
      expect(frames).toBeGreaterThanOrEqual(DURATION * 60 - 2);
      expect(frames).toBeLessThanOrEqual(DURATION * 60 + 2);
      for (const s of game.getScores()) {
        expect(s.score).toBeGreaterThan(20);
        expect(s.score).toBeLessThan(400);
      }
      const stats = game.getStats?.() ?? [];
      const sum = (label: string) => stats.filter((s) => s.label === label).reduce((a, s) => a + Number(s.value), 0);
      bombHits += sum("Bombs hit");
      fevers += sum("Fevers");
      fat += sum("Fat bonks");
      stolen += sum("Stolen");
      game.destroy();
    }
    expect(bombHits).toBeGreaterThan(0);
    expect(fevers).toBeGreaterThan(0);
    expect(fat).toBeGreaterThan(0);
    expect(stolen).toBeGreaterThan(0);
  });
});

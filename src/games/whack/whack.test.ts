import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import type { GameContext } from "../../core/types";
import { COMBO_TO_FEVER, whack } from "./whack";

function context(kind: "human" | "bot", seed = 7): GameContext {
  return {
    width: 1280, height: 720, rng: new Rng(seed),
    players: [0, 1].map((slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind, slot })),
    canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) },
    input: { consumeClick: () => null, justPressed: () => false },
    sfx: new Proxy({}, { get: () => vi.fn() }),
  } as unknown as GameContext;
}

function mole(kind: "normal" | "golden" | "bomb") {
  return { x: 100, y: 100, kind, life: 1, maxLife: 1, whacked: false, whackFlash: 0, whackedBy: null, points: 0 };
}

describe("Bonk", () => {
  it("keeps the whack id under the new name", () => {
    expect(whack.id).toBe("whack");
    expect(whack.name).toBe("Bonk");
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

  it("bots play a full round, score, and occasionally hit bombs", () => {
    let bombHits = 0;
    let fevers = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const game = whack.create(context("bot", seed));
      for (let f = 0; f < 60 * 60 && !game.isFinished(); f++) game.update(1 / 60);
      expect(game.isFinished()).toBe(true);
      for (const s of game.getScores()) expect(s.score).toBeGreaterThan(0);
      const stats = game.getStats?.() ?? [];
      bombHits += stats.filter((s) => s.label === "Bombs hit").reduce((a, s) => a + Number(s.value), 0);
      fevers += stats.filter((s) => s.label === "Fevers").reduce((a, s) => a + Number(s.value), 0);
      game.destroy();
    }
    expect(bombHits).toBeGreaterThan(0);
    expect(fevers).toBeGreaterThan(0);
  });
});

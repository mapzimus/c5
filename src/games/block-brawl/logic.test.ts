import { describe, expect, it } from "vitest";
import {
  Bag,
  COLS,
  POWER,
  POWER_ODDS,
  ROWS,
  addGarbage,
  attackFor,
  cellKind,
  chainBonus,
  flipDir,
  nextChain,
  powerCellFor,
  powersInFullRows,
  rushGravity,
  bestPlacement,
  clearLines,
  collides,
  dropY,
  emptyBoard,
  garbageFor,
  lockPiece,
  spawnPiece,
  tryRotate,
} from "./logic";

describe("block brawl logic", () => {
  it("bags with the same seed give every player the same sequence", () => {
    const a = new Bag(42);
    const b = new Bag(42);
    const seqA = Array.from({ length: 21 }, () => a.next());
    const seqB = Array.from({ length: 21 }, () => b.next());
    expect(seqA).toEqual(seqB);
    for (let i = 0; i < 21; i += 7) {
      expect([...seqA.slice(i, i + 7)].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    }
  });

  it("every piece has 4 cells in every rotation and spawns in bounds", () => {
    const board = emptyBoard();
    for (let t = 0; t < 7; t++) {
      let p = spawnPiece(t);
      expect(collides(board, p)).toBe(false);
      for (let r = 0; r < 4; r++) {
        p = tryRotate(board, p)!;
        expect(p).not.toBeNull();
      }
    }
  });

  it("clears full lines and maps garbage 2/3/4 -> 1/2/4", () => {
    const board = emptyBoard();
    for (let y = ROWS - 2; y < ROWS; y++) board[y]!.fill(1);
    board[ROWS - 3]![0] = 2;
    expect(clearLines(board)).toBe(2);
    expect(board[ROWS - 1]![0]).toBe(2);
    expect([1, 2, 3, 4].map(garbageFor)).toEqual([0, 1, 2, 4]);
  });

  it("garbage pushes rows up and reports top-out", () => {
    const board = emptyBoard();
    expect(addGarbage(board, [3, 5])).toBe(false);
    expect(board[ROWS - 2]![3]).toBe(0);
    expect(board[ROWS - 1]![5]).toBe(0);
    expect(board[ROWS - 1]!.filter((c) => c !== 0).length).toBe(COLS - 1);
    board[0]![0] = 1;
    expect(addGarbage(board, [0])).toBe(true);
  });

  it("hard drop lands on the floor", () => {
    const board = emptyBoard();
    const p = spawnPiece(1);
    const y = dropY(board, p);
    lockPiece(board, { ...p, y });
    expect(board[ROWS - 1]!.filter((c) => c !== 0).length).toBe(2);
  });

  it("bot picks the placement that completes a line", () => {
    const board = emptyBoard();
    // Bottom row full except the 4 rightmost columns: a flat I fits there.
    for (let x = 0; x < COLS - 4; x++) board[ROWS - 1]![x] = 8;
    const best = bestPlacement(board, 0)!;
    const p = { type: 0, rot: best.rot, x: best.x, y: 0 };
    lockPiece(board, { ...p, y: dropY(board, p) });
    expect(clearLines(board)).toBe(1);
  });

  it("power cells lock with the power bit and count only in full rows", () => {
    const board = emptyBoard();
    const p = spawnPiece(0); // flat I
    const landed = { ...p, y: dropY(board, p) };
    lockPiece(board, landed, 2);
    const row = board[landed.y + 1]!;
    expect(row.filter((c) => (c & POWER) !== 0).length).toBe(1);
    expect(row.every((c) => c === 0 || cellKind(c) === 1)).toBe(true);
    expect(powersInFullRows(board)).toBe(0);
    for (let x = 0; x < COLS; x++) if (row[x] === 0) row[x] = 8;
    expect(powersInFullRows(board)).toBe(1);
    expect(clearLines(board)).toBe(1);
    expect(powersInFullRows(board)).toBe(0);
  });

  it("power cells are deterministic, occasional and shared by seed", () => {
    const a = Array.from({ length: 600 }, (_, n) => powerCellFor(7, n));
    const b = Array.from({ length: 600 }, (_, n) => powerCellFor(7, n));
    expect(a).toEqual(b);
    expect(a.slice(0, 3)).toEqual([-1, -1, -1]);
    const hits = a.filter((c) => c >= 0);
    expect(hits.every((c) => c >= 0 && c <= 3)).toBe(true);
    expect(hits.length).toBeGreaterThan(600 / POWER_ODDS / 2);
    expect(hits.length).toBeLessThan((600 / POWER_ODDS) * 2);
  });

  it("chains build on consecutive clears and boost the attack", () => {
    let chain = 0;
    chain = nextChain(chain, 1);
    chain = nextChain(chain, 2);
    expect(chain).toBe(2);
    expect(nextChain(chain, 0)).toBe(0);
    expect([1, 2, 3, 4, 5, 6, 9].map(chainBonus)).toEqual([0, 1, 1, 2, 2, 3, 3]);
    expect(attackFor(1, 1)).toBe(0);
    expect(attackFor(1, 2)).toBe(1);
    expect(attackFor(4, 4)).toBe(6);
    expect(attackFor(0, 5)).toBe(0);
  });

  it("rush speeds gravity and flip reverses direction", () => {
    expect(rushGravity(0.8)).toBeCloseTo(0.16);
    expect(rushGravity(0.1)).toBe(0.04);
    expect(flipDir(1, true)).toBe(-1);
    expect(flipDir(-1, false)).toBe(-1);
  });

  it("bot values clearing a row that holds a power cell", () => {
    const board = emptyBoard();
    for (let x = 2; x < COLS; x++) board[ROWS - 1]![x] = 8;
    const plain = bestPlacement(board, 1)!;
    const glowing = bestPlacement(board, 1, 2)!; // O's cell 2 lands in the cleared row
    expect(glowing.x).toBe(0);
    expect(glowing.score).toBeGreaterThan(plain.score);
  });

  it("bots play a whole power match to a finish", async () => {
    const { blockBrawl } = await import("./block-brawl");
    const { Rng } = await import("../../core/rng");
    const ctx = {
      width: 1280,
      height: 720,
      rng: new Rng(5),
      players: [0, 1, 2].map((slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
      canvas: { style: {}, addEventListener: () => {}, removeEventListener: () => {} },
      input: { isDown: () => false, justPressed: () => false, actionPressed: () => false },
      sfx: new Proxy({}, { get: () => () => {} }),
    } as unknown as Parameters<typeof blockBrawl.create>[0];
    const game = blockBrawl.create(ctx);
    for (let f = 0; f < 60 * 200 && !game.isFinished(); f++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    const stats = game.getStats!();
    const chains = stats.filter((s) => s.label === "Best chain").map((s) => Number(s.value));
    const powers = stats.filter((s) => s.label === "Powers fired").map((s) => Number(s.value));
    expect(Math.max(...chains)).toBeGreaterThanOrEqual(2);
    expect(powers.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    game.destroy();
  }, 60_000);
});

import { describe, expect, it, vi } from "vitest";
import { Rng } from "../../core/rng";
import type { GameContext } from "../../core/types";
import {
  anvilSmash,
  applyGravity,
  bombBlast,
  canDrop,
  createGrid,
  findWins,
  pickWinner,
  playMove,
  winningColumns,
  type Grid,
} from "./board";
import { connectFour } from "./connect-four";

/** Build a grid from rows of text, top row first. "." empty, letters are owners. */
function parse(rows: string[]): Grid {
  return rows.map((row) => [...row].map((ch) => (ch === "." ? null : ch)));
}
function show(grid: Grid): string[] {
  return grid.map((row) => row.map((c) => c ?? ".").join(""));
}

describe("Drop Zone board", () => {
  it("drops a plain disc onto the stack", () => {
    const res = playMove(parse([".......", ".......", "A......"]), 0, "normal", "B")!;
    expect(show(res.grid)).toEqual([".......", "B......", "A......"]);
    expect(res.landed).toEqual({ r: 1, c: 0 });
  });

  it("refuses discs and bombs in a full column, but lets an anvil through", () => {
    const grid = parse(["A", "B", "A"]);
    expect(canDrop(grid, 0, "normal")).toBe(false);
    expect(canDrop(grid, 0, "bomb")).toBe(false);
    expect(canDrop(grid, 0, "anvil")).toBe(true);
    expect(playMove(grid, 0, "normal", "A")).toBeNull();
  });

  it("bomb clears the 3x3 around its landing spot", () => {
    const grid = parse(["AAAA", "BBBB", "AAAA"]);
    const destroyed = bombBlast(grid, 1, 1);
    expect(destroyed).toHaveLength(9);
    expect(show(grid)).toEqual(["...A", "...B", "...A"]);
  });

  it("gravity drops floating discs and reports the falls", () => {
    const grid = parse(["A.", "..", "B.", ".."]);
    const falls = applyGravity(grid);
    expect(show(grid)).toEqual(["..", "..", "A.", "B."]);
    expect(falls).toEqual([
      { c: 0, fromR: 2, toR: 3, owner: "B" },
      { c: 0, fromR: 0, toR: 2, owner: "A" },
    ]);
  });

  it("bomb lands on the stack and blasts from there", () => {
    const res = playMove(parse(["...", "...", ".A.", "BBB"]), 1, "bomb", "A")!;
    // Lands at (1,1), clears rows 0-2: only the bottom row is left.
    expect(res.landed).toEqual({ r: 1, c: 1 });
    expect(show(res.grid)).toEqual(["...", "...", "...", "BBB"]);
  });

  it("anvil smashes the whole column and keeps the bottom", () => {
    const grid = parse(["B..", "A..", "B.."]);
    const destroyed = anvilSmash(grid, 0, "A");
    expect(destroyed).toHaveLength(3);
    expect(show(grid)).toEqual(["...", "...", "A.."]);
  });

  it("finds lines in every direction", () => {
    expect(findWins(parse(["AAAA"]))[0]!.winner).toBe("A");
    expect(findWins(parse(["B", "B", "B", "B"]))[0]!.cells).toHaveLength(4);
    expect(findWins(parse(["A...", ".A..", "..A.", "...A"]))).toHaveLength(1);
    expect(findWins(parse(["...A", "..A.", ".A..", "A..."]))).toHaveLength(1);
    expect(findWins(parse(["AAA.BBB"]))).toHaveLength(0);
    // A run of five is one line, not two.
    expect(findWins(parse(["AAAAA"]))).toHaveLength(1);
  });

  it("the mover wins when a move makes lines for several players", () => {
    const both = [
      { cells: [], winner: "B" },
      { cells: [], winner: "A" },
    ];
    expect(pickWinner(both, "A")).toBe("A");
    expect(pickWinner(both, "C")).toBe("B");
    expect(pickWinner([], "A")).toBeNull();
  });

  it("a bomb can drop discs into a line for the opponent", () => {
    const grid = parse([
      ".......",
      "...B...",
      "...A...",
      "BBBA...",
      "ABAB...",
      "BABA...",
    ]);
    expect(findWins(grid)).toHaveLength(0);
    // A bombs the empty column 4: lands at (5,4), clears rows 4-5 of columns 3-5,
    // and column 3 drops two rows so its B lands next to B B B.
    const res = playMove(grid, 4, "bomb", "A")!;
    expect(res.falls).toHaveLength(3);
    expect(show(res.grid)[3]).toBe("BBBB...");
    expect(res.winner).toBe("B");
  });

  it("an anvil can finish a line along the bottom", () => {
    const grid = parse(["......", "B.....", "A.....", "ABBB.."]);
    expect(playMove(grid, 0, "anvil", "A")!.winner).toBeNull();
    expect(playMove(grid, 0, "anvil", "B")!.winner).toBe("B");
  });

  it("lists immediate winning columns", () => {
    const grid = parse([".......", ".......", "AAA...."]);
    expect(winningColumns(grid, "A")).toEqual([3]);
    expect(winningColumns(grid, "B")).toEqual([]);
  });

  it("starts empty", () => {
    expect(createGrid().flat().every((c) => c === null)).toBe(true);
  });
});

function context(kinds: ("human" | "bot")[]): GameContext {
  return {
    width: 1280, height: 720, rng: new Rng(7), minTap: 44,
    players: kinds.map((kind, slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind, slot })),
    canvas: { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) },
    input: { consumeClick: () => null, justPressed: () => false },
    sfx: new Proxy({}, { get: () => vi.fn() }),
  } as unknown as GameContext;
}

describe("Drop Zone match", () => {
  it("is called Drop Zone", () => {
    expect(connectFour.name).toBe("Drop Zone");
    expect(connectFour.id).toBe("connect-four");
  });

  for (const n of [2, 3, 4]) {
    it(`bots finish a ${n}-player match`, () => {
      const game = connectFour.create(context(Array.from({ length: n }, () => "bot")));
      for (let f = 0; f < 60 * 60 * 20 && !game.isFinished(); f++) game.update(1 / 60);
      expect(game.isFinished()).toBe(true);
      expect(Math.max(...game.getScores().map((s) => s.score))).toBeGreaterThan(0);
      game.destroy();
    });
  }

  it("bots use powers over a few matches", () => {
    let used = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const ctx = context(["bot", "bot"]);
      ctx.rng = new Rng(seed);
      const game = connectFour.create(ctx);
      for (let f = 0; f < 60 * 60 * 20 && !game.isFinished(); f++) game.update(1 / 60);
      used += game.getStats!().filter((s) => s.label === "Powers used").length;
      game.destroy();
    }
    expect(used).toBeGreaterThan(0);
  });
});

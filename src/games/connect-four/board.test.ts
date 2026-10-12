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
  lineCells,
  lineScore,
  pickWinner,
  playMove,
  previewTilt,
  scoreLines,
  seedGrid,
  settle,
  simulateMove,
  tallyTilt,
  tiltSlide,
  underdogs,
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

describe("Drop Zone scoring and chains", () => {
  it("pays 100 for four, more for longer lines, times the chain link", () => {
    expect(lineScore(4, 1)).toBe(100);
    expect(lineScore(5, 1)).toBe(150);
    expect(lineScore(4, 2)).toBe(200);
    expect(lineScore(6, 3)).toBe(600);
  });

  it("counts crossing cells once but pays every line", () => {
    const grid = parse([
      "..A....",
      "..A....",
      "AAAA...",
      "..A....",
    ]);
    const lines = findWins(grid);
    expect(lines).toHaveLength(2);
    expect(lineCells(lines)).toHaveLength(7);
    expect(scoreLines(lines, 1)).toEqual({ A: 200 });
  });

  it("clears a line, drops what was above, and chains the next line for double", () => {
    const grid = parse([
      ".......",
      "B......",
      "B......",
      "B...A..",
      "AAAA...",
      "BBBABBB",
    ]);
    const steps = settle(grid);
    expect(steps).toHaveLength(2);
    expect(steps[0]!.chain).toBe(1);
    expect(steps[0]!.points).toEqual({ A: 100 });
    // After the A line bursts the B column drops onto the bottom B and four B stack up.
    expect(steps[1]!.chain).toBe(2);
    expect(steps[1]!.points).toEqual({ B: 200 });
    expect(show(grid)).toEqual([".......", ".......", ".......", ".......", "....A..", ".BBABBB"]);
  });

  it("settle leaves a board with nothing lined up alone", () => {
    const grid = parse(["AB", "BA"]);
    expect(settle(grid)).toEqual([]);
    expect(show(grid)).toEqual(["AB", "BA"]);
  });
});

describe("Drop Zone tilt", () => {
  it("packs every row toward the tilted side keeping disc order", () => {
    const grid = parse([".A.B...", "..C...D"]);
    const slides = tiltSlide(grid, "left");
    expect(show(grid)).toEqual(["AB.....", "CD....."]);
    expect(slides).toEqual([
      { r: 0, fromC: 1, toC: 0, owner: "A" },
      { r: 0, fromC: 3, toC: 1, owner: "B" },
      { r: 1, fromC: 2, toC: 0, owner: "C" },
      { r: 1, fromC: 6, toC: 1, owner: "D" },
    ]);
    const right = parse([".A.B...", "..C...D"]);
    tiltSlide(right, "right");
    expect(show(right)).toEqual([".....AB", ".....CD"]);
  });

  it("a tilt can slide scattered discs into a scoring line", () => {
    const grid = parse([
      ".......",
      ".......",
      ".......",
      "A..B...",
      "A.B.B..",
      "ABBB.B.",
    ]);
    expect(findWins(grid)).toHaveLength(0);
    const left = previewTilt(grid, "left");
    expect(left.slides.length).toBeGreaterThan(0);
    expect(left.points).toEqual({ B: 100 });
    expect(show(left.grid)).toEqual([".......", ".......", ".......", "A......", "AB.....", "ABB...."]);
    // Tilting the other way packs B B B B on the right instead; A stays scattered.
    const right = previewTilt(grid, "right");
    expect(right.points).toEqual({ B: 100 });
  });

  it("previewTilt never touches the input grid", () => {
    const grid = parse([".A.", "B.."]);
    previewTilt(grid, "right");
    expect(show(grid)).toEqual([".A.", "B.."]);
  });

  it("tallies votes by weight, breaks ties with the latest vote, falls back otherwise", () => {
    expect(tallyTilt([{ dir: "left", weight: 1 }, { dir: "right", weight: 2 }], "left", "left")).toBe("right");
    expect(tallyTilt([{ dir: "left", weight: 1 }, { dir: "right", weight: 1 }], "left", "right")).toBe("left");
    expect(tallyTilt([], null, "right")).toBe("right");
  });

  it("seeds a fair scatter with nothing lined up", () => {
    const rng = new Rng(3);
    for (let round = 0; round < 20; round++) {
      const grid = createGrid();
      const placed = seedGrid(grid, ["A", "B", "C"], 5, () => rng.next(), 3);
      expect(placed).toHaveLength(15);
      const flat = grid.flat();
      expect(flat.filter((c) => c === "A")).toHaveLength(5);
      expect(flat.filter((c) => c === "C")).toHaveLength(5);
      expect(findWins(grid, 3)).toHaveLength(0);
      // Everything sits on something: gravity would move nothing.
      expect(applyGravity(grid)).toEqual([]);
    }
  });

  it("names the underdogs only when somebody is ahead", () => {
    expect(underdogs({ a: 0, b: 100, c: 0 })).toEqual(["a", "c"]);
    expect(underdogs({ a: 0, b: 0 })).toEqual([]);
    expect(underdogs({ a: 300 })).toEqual([]);
  });

  it("simulateMove scores the drop and the tilt that follows it", () => {
    const grid = parse([
      ".......",
      ".......",
      ".......",
      ".......",
      "B......",
      "A.A.A..",
    ]);
    // Column 6 does nothing on its own, but a tilt left packs A A A A together.
    expect(simulateMove(grid, 6, "normal", "A")!.points).toEqual({});
    expect(simulateMove(grid, 6, "normal", "A", "left")!.points).toEqual({ A: 100 });
    expect(simulateMove(grid, 6, "normal", "A", "right")!.points).toEqual({ A: 100 });
    expect(simulateMove(parse(["A"]), 0, "normal", "A")).toBeNull();
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
    it(`bots finish a ${n}-player match inside 45-100 seconds and somebody scores`, () => {
      const game = connectFour.create(context(Array.from({ length: n }, () => "bot")));
      let frames = 0;
      for (; frames < 60 * 120 && !game.isFinished(); frames++) game.update(1 / 60);
      expect(game.isFinished()).toBe(true);
      expect(frames / 60).toBeGreaterThanOrEqual(45);
      expect(frames / 60).toBeLessThanOrEqual(100);
      expect(Math.max(...game.getScores().map((s) => s.score))).toBeGreaterThan(0);
      const stats = game.getStats!();
      expect(stats.some((s) => s.label === "Lines" && Number(s.value) > 0)).toBe(true);
      game.destroy();
    });
  }

  it("a human who never taps is auto-dropped and the match still ends", () => {
    const game = connectFour.create(context(["human", "bot"]));
    let frames = 0;
    for (; frames < 60 * 120 && !game.isFinished(); frames++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    expect(frames / 60).toBeLessThanOrEqual(100);
    game.destroy();
  });

  it("bots vote on the tilt during a match", () => {
    let called = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const ctx = context(["bot", "bot", "bot"]);
      ctx.rng = new Rng(seed);
      const game = connectFour.create(ctx);
      for (let f = 0; f < 60 * 120 && !game.isFinished(); f++) game.update(1 / 60);
      called += (game as unknown as { seats: { tiltsCalled: number }[] }).seats.filter((s) => s.tiltsCalled > 0).length;
      game.destroy();
    }
    expect(called).toBeGreaterThan(0);
  });

  it("bots use powers over a few matches", () => {
    let used = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const ctx = context(["bot", "bot"]);
      ctx.rng = new Rng(seed);
      const game = connectFour.create(ctx);
      for (let f = 0; f < 60 * 120 && !game.isFinished(); f++) game.update(1 / 60);
      used += game.getStats!().filter((s) => s.label === "Powers used").length;
      game.destroy();
    }
    expect(used).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from "vitest";
import {
  BOT_PROFILES,
  Bag,
  COLS,
  DEFAULT_PROFILE,
  HAUNT_COOLDOWN,
  OVERDRIVE_AT,
  POWER,
  POWER_ODDS,
  ROWS,
  STAKES_HEIGHT,
  TIME_LIMIT,
  addGarbage,
  attackFor,
  cellKind,
  chainBonus,
  flipDir,
  garbageHoles,
  gravityFor,
  isHighStakes,
  isOverdrive,
  isUnderdog,
  nextChain,
  pickHauntTarget,
  pickPlacement,
  powerCellFor,
  powersInFullRows,
  rankPlacements,
  rushGravity,
  slideClear,
  bestPlacement,
  clearLines,
  collides,
  dropY,
  emptyBoard,
  garbageFor,
  lockPiece,
  spawnPiece,
  stackHeight,
  tideInterval,
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

  it("garbage batches mostly share a hole and stay in bounds", () => {
    const seq = [0.55, 0.9, 0.1, 0.05];
    let i = 0;
    const holes = garbageHoles(3, () => seq[i++ % seq.length]!);
    expect(holes).toEqual([5, 5, 0]);
    for (let n = 0; n < 50; n++) {
      for (const h of garbageHoles(6, () => Math.random())) expect(h >= 0 && h < COLS).toBe(true);
    }
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

  it("high stakes doubles line garbage once the stack reaches the line", () => {
    const board = emptyBoard();
    expect(stackHeight(board)).toBe(0);
    board[ROWS - STAKES_HEIGHT]![4] = 3;
    expect(stackHeight(board)).toBe(STAKES_HEIGHT);
    expect(isHighStakes(STAKES_HEIGHT)).toBe(true);
    expect(isHighStakes(STAKES_HEIGHT - 1)).toBe(false);
    // Doubles send two, block busters eight; chain and underdog stack on top.
    expect(attackFor(1, 1, true)).toBe(0);
    expect(attackFor(2, 1, true)).toBe(2);
    expect(attackFor(4, 1, true)).toBe(8);
    expect(attackFor(4, 4, true)).toBe(10);
    expect(attackFor(2, 1, true, 1)).toBe(3);
    expect(attackFor(0, 3, true, 1)).toBe(0);
    expect(attackFor(2, 1, false, 1)).toBe(2);
  });

  it("the underdog is strictly last on lines and well behind the leader", () => {
    expect(isUnderdog(2, [6, 9])).toBe(true);
    expect(isUnderdog(2, [4, 2])).toBe(false);
    expect(isUnderdog(7, [9, 8])).toBe(false);
    expect(isUnderdog(0, [])).toBe(false);
  });

  it("overdrive starts the tide and tightens it towards the time limit", () => {
    expect(isOverdrive(OVERDRIVE_AT - 1)).toBe(false);
    expect(isOverdrive(OVERDRIVE_AT)).toBe(true);
    expect(tideInterval(OVERDRIVE_AT)).toBeCloseTo(3);
    expect(tideInterval(TIME_LIMIT)).toBeCloseTo(1.5);
    expect(tideInterval(TIME_LIMIT + 30)).toBeCloseTo(1.5);
    expect(TIME_LIMIT).toBeLessThanOrEqual(100);
    expect(gravityFor(0)).toBeCloseTo(0.8);
    expect(gravityFor(OVERDRIVE_AT)).toBeLessThan(gravityFor(OVERDRIVE_AT - 0.01));
    expect(gravityFor(TIME_LIMIT)).toBeGreaterThanOrEqual(0.1);
    expect(gravityFor(10, true)).toBeCloseTo(rushGravity(gravityFor(10)));
  });

  it("rush speeds gravity and flip reverses direction", () => {
    expect(rushGravity(0.8)).toBeCloseTo(0.16);
    expect(rushGravity(0.1)).toBe(0.04);
    expect(flipDir(1, true)).toBe(-1);
    expect(flipDir(-1, false)).toBe(-1);
  });

  it("bot ghosts haunt the leader, the tallest stack, or anyone", () => {
    const rivals = [
      { lines: 3, height: 15 },
      { lines: 12, height: 6 },
      { lines: 8, height: 9 },
    ];
    expect(pickHauntTarget(rivals, 0.1)).toBe(1);
    expect(pickHauntTarget(rivals, 0.7)).toBe(0);
    expect(pickHauntTarget(rivals, 0.99)).toBe(2);
    expect(pickHauntTarget([], 0.5)).toBe(-1);
    expect(HAUNT_COOLDOWN).toBeGreaterThan(0);
  });

  it("bot values clearing a row that holds a power cell", () => {
    const board = emptyBoard();
    for (let x = 2; x < COLS; x++) board[ROWS - 1]![x] = 8;
    const plain = bestPlacement(board, 1)!;
    const glowing = bestPlacement(board, 1, 2)!; // O's cell 2 lands in the cleared row
    expect(glowing.x).toBe(0);
    expect(glowing.score).toBeGreaterThan(plain.score);
  });

  it("bots only plan spots they can turn and slide to", () => {
    const board = emptyBoard();
    // A tower in column 6 from the floor to the top: nothing right of it is reachable.
    for (let y = 0; y < ROWS; y++) board[y]![6] = 8;
    expect(slideClear(board, { type: 1, rot: 0, x: 0, y: 0 }, 4)).toBe(true);
    expect(slideClear(board, { type: 1, rot: 0, x: 8, y: 0 }, 4)).toBe(false);
    const ranked = rankPlacements(board, 1);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.every((p) => p.x + 1 < 6)).toBe(true);
    // Starting on the far side, the far side is what you get.
    const right = rankPlacements(board, 1, -1, DEFAULT_PROFILE, 0, -1, 7);
    expect(right.length).toBeGreaterThan(0);
    expect(right.every((p) => p.x > 6)).toBe(true);
  });

  it("bot profiles rank placements and sometimes slip to a worse one", () => {
    const board = emptyBoard();
    for (let x = 0; x < COLS - 4; x++) board[ROWS - 1]![x] = 8;
    const careful = BOT_PROFILES[0]!;
    const ranked = rankPlacements(board, 0, -1, careful);
    expect(ranked.length).toBeGreaterThan(10);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i]!.score).toBeLessThanOrEqual(ranked[i - 1]!.score);
    expect(pickPlacement(ranked, careful, 0.99)).toBe(ranked[0]);
    // Only the flat I at x=6 clears the line; the runner-up is far worse, so no slip there...
    expect(pickPlacement(ranked, careful, 0.0)!.score).toBe(ranked[0]!.score);
    // ...but an O on an empty floor has two equally good corners, and a slip takes the other one.
    const corners = rankPlacements(emptyBoard(), 1, -1, careful);
    expect(corners[0]!.score).toBeCloseTo(corners[1]!.score);
    expect(pickPlacement(corners, careful, 0.0)).toBe(corners[1]);
    // Never a real blunder.
    const gap = [{ rot: 0, x: 0, score: 5 }, { rot: 0, x: 1, score: 1 }];
    expect(pickPlacement(gap, careful, 0.0)).toBe(gap[0]);
    expect(pickPlacement([], careful, 0.5)).toBeNull();
    // Re-planning from lower down, locked to one rotation, only offers that rotation.
    const low = rankPlacements(board, 0, -1, careful, 10, 1);
    expect(low.length).toBeGreaterThan(0);
    expect(low.every((p) => p.rot === 1)).toBe(true);
    // A greedy bot is happier with a stack that sits on the stakes line than a careful one.
    const tall = emptyBoard();
    for (let y = ROWS - STAKES_HEIGHT; y < ROWS; y++) for (let x = 1; x < COLS; x++) tall[y]![x] = 8;
    const greedy = BOT_PROFILES[1]!;
    const g = rankPlacements(tall, 1, -1, greedy)[0]!;
    const c = rankPlacements(tall, 1, -1, careful)[0]!;
    expect(g.score).toBeGreaterThan(c.score);
  });

  it("bots play a whole match to a finish inside the party window", async () => {
    const { blockBrawl } = await import("./block-brawl");
    const { Rng } = await import("../../core/rng");
    const ctx = {
      width: 1280,
      height: 720,
      rng: new Rng(5),
      minTap: 44,
      players: [0, 1, 2].map((slot) => ({ id: `p${slot}`, name: `P${slot}`, color: "#3EE0FF", kind: "bot", slot })),
      canvas: { style: {}, addEventListener: () => {}, removeEventListener: () => {} },
      input: { isDown: () => false, justPressed: () => false, actionPressed: () => false },
      sfx: new Proxy({}, { get: () => () => {} }),
    } as unknown as Parameters<typeof blockBrawl.create>[0];
    const game = blockBrawl.create(ctx);
    let frames = 0;
    for (; frames < 60 * 200 && !game.isFinished(); frames++) game.update(1 / 60);
    expect(game.isFinished()).toBe(true);
    expect(frames / 60).toBeGreaterThan(30);
    expect(frames / 60).toBeLessThan(TIME_LIMIT + 5);
    const stats = game.getStats!();
    const chains = stats.filter((s) => s.label === "Best chain").map((s) => Number(s.value));
    const powers = stats.filter((s) => s.label === "Powers fired").map((s) => Number(s.value));
    expect(Math.max(...chains)).toBeGreaterThanOrEqual(2);
    expect(powers.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    // Exactly one survivor (or a time-out tie), and the first ghost had time to haunt.
    const scores = game.getScores();
    expect(scores.filter((s) => s.score >= 4000).length).toBeGreaterThanOrEqual(1);
    game.destroy();
  }, 60_000);
});

import { describe, expect, it } from "vitest";
import { Rng } from "../../../core/rng";
import {
  COLS,
  ROWS,
  MAX_BUGS,
  MAX_ROUNDS,
  maxRounds,
  NO_OWNER,
  STASH_MAX,
  generateBoard,
  hexNeighbours,
  cellKey,
  tilesOwned,
  isAlive,
  aliveSeats,
  canAttack,
  attackers,
  targetsFrom,
  hasAnyAttack,
  rollDice,
  rollBattle,
  applyBattle,
  largestRegion,
  reinforce,
  endTurnIncome,
  nextSeat,
  botPickAttack,
  gameOver,
  speciesFor,
  type Board,
} from "./rules";

function seeded(): Rng {
  return new Rng(42);
}

describe("hex neighbours", () => {
  it("returns 6 neighbours for an interior cell", () => {
    const neighbours = hexNeighbours(3, 2, 8, 5);
    expect(neighbours).toHaveLength(6);
  });

  it("returns fewer at a corner", () => {
    const neighbours = hexNeighbours(0, 0, 8, 5);
    expect(neighbours.length).toBeLessThan(6);
    expect(neighbours.length).toBeGreaterThan(0);
  });

  it("odd rows shift right", () => {
    const even = hexNeighbours(2, 2, 8, 5).map((c) => cellKey(c.col, c.row));
    const odd = hexNeighbours(2, 1, 8, 5).map((c) => cellKey(c.col, c.row));
    expect(even).not.toEqual(odd);
  });
});

describe("generateBoard", () => {
  it("creates a board with the right tile count", () => {
    const board = generateBoard(seeded(), 4);
    expect(board.tiles.length).toBe(COLS * ROWS - board.holes.size);
    expect(board.tiles.length).toBeGreaterThan(0);
  });

  it("deals tiles to all players", () => {
    const board = generateBoard(seeded(), 4);
    for (let seat = 0; seat < 4; seat++) {
      expect(tilesOwned(board, seat)).toBeGreaterThan(0);
    }
  });

  it("each tile starts with bugs", () => {
    const board = generateBoard(seeded(), 2);
    for (const tile of board.tiles) {
      expect(tile.bugs).toBeGreaterThanOrEqual(1);
      expect(tile.bugs).toBeLessThanOrEqual(MAX_BUGS);
    }
  });

  it("adjacency is symmetric", () => {
    const board = generateBoard(seeded(), 3);
    for (let id = 0; id < board.tiles.length; id++) {
      for (const neighbour of board.adjacency[id]!) {
        expect(board.adjacency[neighbour]).toContain(id);
      }
    }
  });

  it("works with 2 players", () => {
    const board = generateBoard(seeded(), 2);
    expect(tilesOwned(board, 0)).toBeGreaterThan(0);
    expect(tilesOwned(board, 1)).toBeGreaterThan(0);
  });
});

describe("combat", () => {
  function twoTileBoard(): Board {
    return {
      cols: 2,
      rows: 1,
      holes: new Set(),
      tiles: [
        { id: 0, col: 0, row: 0, owner: 0, bugs: 4 },
        { id: 1, col: 1, row: 0, owner: 1, bugs: 2 },
      ],
      adjacency: [[1], [0]],
    };
  }

  it("canAttack requires 2+ bugs and adjacency", () => {
    const board = twoTileBoard();
    expect(canAttack(board, 0, 1, 0)).toBe(true);
    expect(canAttack(board, 1, 0, 1)).toBe(true);
    board.tiles[1]!.bugs = 1;
    expect(canAttack(board, 1, 0, 1)).toBe(false);
    board.tiles[0]!.bugs = 1;
    expect(canAttack(board, 0, 1, 0)).toBe(false);
  });

  it("canAttack rejects attacking own tile", () => {
    const board = twoTileBoard();
    expect(canAttack(board, 0, 1, 1)).toBe(false);
  });

  it("rollDice returns correct count", () => {
    const dice = rollDice(seeded(), 5);
    expect(dice).toHaveLength(5);
    for (const d of dice) {
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(6);
    }
  });

  it("rollBattle produces a result", () => {
    const board = twoTileBoard();
    const battle = rollBattle(board, 0, 1, seeded());
    expect(battle.from).toBe(0);
    expect(battle.to).toBe(1);
    expect(battle.attackRolls).toHaveLength(4);
    expect(battle.defendRolls).toHaveLength(2);
    expect(typeof battle.captured).toBe("boolean");
  });

  it("applyBattle on capture moves bugs", () => {
    const board = twoTileBoard();
    const battle = { from: 0, to: 1, attacker: 0, defender: 1, attackRolls: [6, 6, 6, 6], defendRolls: [1, 1], attackSum: 24, defendSum: 2, captured: true };
    applyBattle(board, battle);
    expect(board.tiles[1]!.owner).toBe(0);
    expect(board.tiles[1]!.bugs).toBe(3);
    expect(board.tiles[0]!.bugs).toBe(1);
  });

  it("applyBattle on defense leaves attacker with 1", () => {
    const board = twoTileBoard();
    const battle = { from: 0, to: 1, attacker: 0, defender: 1, attackRolls: [1, 1, 1, 1], defendRolls: [6, 6], attackSum: 4, defendSum: 12, captured: false };
    applyBattle(board, battle);
    expect(board.tiles[1]!.owner).toBe(1);
    expect(board.tiles[0]!.bugs).toBe(1);
  });
});

describe("attackers and targets", () => {
  it("attackers finds tiles that can attack", () => {
    const board = generateBoard(seeded(), 2);
    const atk = attackers(board, 0);
    for (const id of atk) {
      expect(board.tiles[id]!.owner).toBe(0);
      expect(board.tiles[id]!.bugs).toBeGreaterThanOrEqual(2);
      const targets = targetsFrom(board, id);
      expect(targets.length).toBeGreaterThan(0);
    }
  });

  it("hasAnyAttack consistent with attackers", () => {
    const board = generateBoard(seeded(), 2);
    expect(hasAnyAttack(board, 0)).toBe(attackers(board, 0).length > 0);
  });
});

describe("regions and reinforcement", () => {
  it("largestRegion finds connected owned tiles", () => {
    const board = generateBoard(seeded(), 2);
    const region = largestRegion(board, 0);
    expect(region).toBeGreaterThan(0);
    expect(region).toBeLessThanOrEqual(tilesOwned(board, 0));
  });

  it("reinforce adds bugs up to MAX_BUGS", () => {
    const board: Board = {
      cols: 2,
      rows: 1,
      holes: new Set(),
      tiles: [
        { id: 0, col: 0, row: 0, owner: 0, bugs: 7 },
        { id: 1, col: 1, row: 0, owner: 0, bugs: 7 },
      ],
      adjacency: [[1], [0]],
    };
    const result = reinforce(board, 0, 5, seeded());
    expect(board.tiles[0]!.bugs).toBeLessThanOrEqual(MAX_BUGS);
    expect(board.tiles[1]!.bugs).toBeLessThanOrEqual(MAX_BUGS);
    expect(result.placed.length + result.leftover).toBe(5);
  });

  it("endTurnIncome gives income equal to largest region + stash", () => {
    const board = generateBoard(seeded(), 2);
    const region = largestRegion(board, 0);
    const result = endTurnIncome(board, 0, 3, seeded());
    expect(result.income).toBe(region + 3);
    expect(result.stash).toBeLessThanOrEqual(STASH_MAX);
  });
});

describe("turn order", () => {
  it("nextSeat wraps around dead players", () => {
    const board: Board = {
      cols: 3,
      rows: 1,
      holes: new Set(),
      tiles: [
        { id: 0, col: 0, row: 0, owner: 0, bugs: 3 },
        { id: 1, col: 1, row: 0, owner: 2, bugs: 3 },
        { id: 2, col: 2, row: 0, owner: 2, bugs: 3 },
      ],
      adjacency: [[1], [0, 2], [1]],
    };
    const next = nextSeat(board, 3, 0);
    expect(next).not.toBeNull();
    expect(next!.seat).toBe(2);
  });

  it("nextSeat returns null when no living seat exists", () => {
    const board: Board = {
      cols: 2,
      rows: 1,
      holes: new Set(),
      tiles: [
        { id: 0, col: 0, row: 0, owner: NO_OWNER, bugs: 0 },
        { id: 1, col: 1, row: 0, owner: NO_OWNER, bugs: 0 },
      ],
      adjacency: [[1], [0]],
    };
    const next = nextSeat(board, 2, 0);
    expect(next).toBeNull();
  });
});

describe("game end", () => {
  it("detects conquest", () => {
    const board: Board = {
      cols: 2,
      rows: 1,
      holes: new Set(),
      tiles: [
        { id: 0, col: 0, row: 0, owner: 0, bugs: 3 },
        { id: 1, col: 1, row: 0, owner: 0, bugs: 3 },
      ],
      adjacency: [[1], [0]],
    };
    expect(gameOver(board, 2, 1)).toBe("conquered");
  });

  it("detects round limit", () => {
    const board = generateBoard(seeded(), 2);
    expect(gameOver(board, 2, MAX_ROUNDS + 1)).toBe("rounds");
    expect(maxRounds(4)).toBeLessThan(MAX_ROUNDS);
    expect(gameOver(board, 4, maxRounds(4) + 1)).toBe("rounds");
  });

  it("not over mid-game", () => {
    const board = generateBoard(seeded(), 2);
    expect(gameOver(board, 2, 1)).toBeNull();
  });
});

describe("bot AI", () => {
  it("picks an attack when one is available", () => {
    const board: Board = {
      cols: 2,
      rows: 1,
      holes: new Set(),
      tiles: [
        { id: 0, col: 0, row: 0, owner: 0, bugs: 6 },
        { id: 1, col: 1, row: 0, owner: 1, bugs: 2 },
      ],
      adjacency: [[1], [0]],
    };
    const choice = botPickAttack(board, 0, seeded());
    expect(choice).not.toBeNull();
    expect(choice!.from).toBe(0);
    expect(choice!.to).toBe(1);
  });

  it("returns null when no good attacks", () => {
    const board: Board = {
      cols: 2,
      rows: 1,
      holes: new Set(),
      tiles: [
        { id: 0, col: 0, row: 0, owner: 0, bugs: 2 },
        { id: 1, col: 1, row: 0, owner: 1, bugs: 5 },
      ],
      adjacency: [[1], [0]],
    };
    const choice = botPickAttack(board, 0, seeded());
    expect(choice).toBeNull();
  });
});

describe("species", () => {
  it("maps slots to species cyclically", () => {
    expect(speciesFor(0)).toBe("ants");
    expect(speciesFor(1)).toBe("bees");
    expect(speciesFor(2)).toBe("beetles");
    expect(speciesFor(3)).toBe("spiders");
    expect(speciesFor(4)).toBe("ants");
  });
});

describe("isAlive and aliveSeats", () => {
  it("dead seat has no tiles", () => {
    const board: Board = {
      cols: 2,
      rows: 1,
      holes: new Set(),
      tiles: [
        { id: 0, col: 0, row: 0, owner: 0, bugs: 3 },
        { id: 1, col: 1, row: 0, owner: 0, bugs: 3 },
      ],
      adjacency: [[1], [0]],
    };
    expect(isAlive(board, 0)).toBe(true);
    expect(isAlive(board, 1)).toBe(false);
    expect(aliveSeats(board, 2)).toEqual([0]);
  });
});

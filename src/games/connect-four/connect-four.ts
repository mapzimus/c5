import { fillArena } from "../../core/draw";
import { Callouts, Juice } from "../../fx/juice";
import type {
  GameContext,
  GameDefinition,
  GameInstance,
  GameStat,
  Player,
} from "../../core/types";

export const connectFour: GameDefinition = {
  id: "connect-four",
  name: "Connect Four",
  tagline: "Drop discs. Line up four.",
  description:
    "Classic two-player strategy on a 7×6 grid. Tap a column to drop your disc. " +
    "First to connect four in a row — horizontal, vertical, or diagonal — wins the round. " +
    "With 3–4 players, take turns and the board gets chaotic fast. " +
    "Best of 3 rounds. If the board fills up, nobody scores.",
  durationMs: 0,
  controls: "Tap a column to drop",
  create: (ctx) => new ConnectFourGame(ctx),
};

const COLS = 7;
const ROWS = 6;
const BEST_OF = 3;

type Cell = string | null;

interface WinLine {
  cells: { r: number; c: number }[];
  winner: string;
}

interface DropAnim {
  col: number;
  row: number;
  owner: string;
  y: number;
  targetY: number;
  vy: number;
  settled: boolean;
}

class ConnectFourGame implements GameInstance {
  private grid: Cell[][] = [];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private time = 0;
  private turnIndex = 0;
  private round = 1;
  private wins = new Map<string, number>();
  private winLine: WinLine | null = null;
  private roundOver = false;
  private roundTimer = 0;
  private gameOver = false;
  private gameOverTimer = 0;
  private drop: DropAnim | null = null;
  private hoverCol = -1;
  private moveCount = 0;
  private readonly turnCounts = new Map<string, number>();

  private boardX = 0;
  private boardY = 0;
  private cellSize = 0;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    for (const p of ctx.players) this.wins.set(p.id, 0);
    this.layoutBoard();
    this.resetGrid();

    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);

    this.callouts.show("ROUND 1", "#3EE0FF", { size: 56, life: 1 });
  }

  private layoutBoard(): void {
    const { width, height } = this.ctx;
    const maxCellW = (width - 120) / COLS;
    const maxCellH = (height - 140) / ROWS;
    this.cellSize = Math.min(maxCellW, maxCellH, 80);
    const bw = this.cellSize * COLS;
    const bh = this.cellSize * ROWS;
    this.boardX = (width - bw) / 2;
    this.boardY = (height - bh) / 2 + 30;
  }

  private resetGrid(): void {
    this.grid = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => null),
    );
    this.winLine = null;
    this.roundOver = false;
    this.roundTimer = 0;
    this.drop = null;
    this.hoverCol = -1;
    this.moveCount = 0;
  }

  private currentPlayer(): Player {
    return this.ctx.players[this.turnIndex % this.ctx.players.length]!;
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += dt;

    if (this.drop && !this.drop.settled) {
      this.drop.vy += 2800 * dt;
      this.drop.y += this.drop.vy * dt;
      if (this.drop.y >= this.drop.targetY) {
        this.drop.y = this.drop.targetY;
        this.drop.settled = true;
        this.grid[this.drop.row]![this.drop.col] = this.drop.owner;
        this.juice.shake(0.12);
        this.ctx.sfx.hit();

        const line = this.checkWin(this.drop.row, this.drop.col);
        if (line) {
          this.winLine = line;
          this.roundOver = true;
          this.roundTimer = 2.5;
          const w = this.wins.get(line.winner) ?? 0;
          this.wins.set(line.winner, w + 1);
          const p = this.ctx.players.find((pl) => pl.id === line.winner)!;
          this.callouts.show(`${p.name} CONNECTS!`, p.color, { size: 56 });
          this.juice.shake(0.3);
          this.ctx.sfx.win();
          for (const cell of line.cells) {
            const cx = this.boardX + (cell.c + 0.5) * this.cellSize;
            const cy = this.boardY + (cell.r + 0.5) * this.cellSize;
            this.juice.burst(cx, cy, [p.color, "#ffffff"], {
              count: 12,
              speed: 200,
              gravity: 0,
              life: 0.6,
            });
          }
        } else if (this.isBoardFull()) {
          this.roundOver = true;
          this.roundTimer = 2;
          this.callouts.show("DRAW!", "#F4F7FB", { size: 56 });
          this.ctx.sfx.miss();
        } else {
          this.turnIndex++;
          this.ctx.sfx.tick();
        }
        this.drop = null;
      }
      return;
    }

    if (this.roundOver) {
      this.roundTimer -= realDt;
      if (this.roundTimer <= 0) {
        const maxWins = Math.max(...this.wins.values());
        if (maxWins >= Math.ceil(BEST_OF / 2) || this.round >= BEST_OF) {
          this.gameOver = true;
          this.gameOverTimer = 1.5;
          const winner = this.ctx.players.find(
            (p) => (this.wins.get(p.id) ?? 0) === maxWins,
          );
          if (winner) {
            this.callouts.show(
              `${winner.name} WINS THE MATCH!`,
              winner.color,
              { size: 48 },
            );
            this.ctx.sfx.win();
          }
        } else {
          this.round++;
          this.resetGrid();
          this.callouts.show(`ROUND ${this.round}`, "#3EE0FF", {
            size: 56,
            life: 1,
          });
        }
      }
      return;
    }

    if (this.gameOver) {
      this.gameOverTimer -= realDt;
      return;
    }

    const cp = this.currentPlayer();
    if (cp.kind === "bot" && !this.drop) this.botMove(dt);
  }

  private botMove(_dt: number): void {
    if (this.ctx.rng.next() < 0.92) return;
    const cp = this.currentPlayer();

    for (let c = 0; c < COLS; c++) {
      const r = this.topRow(c);
      if (r < 0) continue;
      this.grid[r]![c] = cp.id;
      if (this.checkWin(r, c)) {
        this.grid[r]![c] = null;
        this.dropDisc(c);
        return;
      }
      this.grid[r]![c] = null;
    }

    for (const opp of this.ctx.players) {
      if (opp.id === cp.id) continue;
      for (let c = 0; c < COLS; c++) {
        const r = this.topRow(c);
        if (r < 0) continue;
        this.grid[r]![c] = opp.id;
        if (this.checkWin(r, c)) {
          this.grid[r]![c] = null;
          this.dropDisc(c);
          return;
        }
        this.grid[r]![c] = null;
      }
    }

    const available = [];
    for (let c = 0; c < COLS; c++) if (this.topRow(c) >= 0) available.push(c);
    if (available.length > 0) {
      const weights = available.map((c) => {
        const dist = Math.abs(c - 3);
        return 4 - dist;
      });
      const total = weights.reduce((a, b) => a + b, 0);
      let roll = this.ctx.rng.float(0, total);
      for (let i = 0; i < available.length; i++) {
        roll -= weights[i]!;
        if (roll <= 0) {
          this.dropDisc(available[i]!);
          return;
        }
      }
      this.dropDisc(available[available.length - 1]!);
    }
  }

  private topRow(col: number): number {
    for (let r = ROWS - 1; r >= 0; r--) {
      if (!this.grid[r]![col]) return r;
    }
    return -1;
  }

  private dropDisc(col: number): void {
    const row = this.topRow(col);
    if (row < 0) return;
    const cp = this.currentPlayer();
    this.moveCount++;
    this.turnCounts.set(cp.id, (this.turnCounts.get(cp.id) ?? 0) + 1);

    this.drop = {
      col,
      row,
      owner: cp.id,
      y: this.boardY - this.cellSize,
      targetY: this.boardY + (row + 0.5) * this.cellSize,
      vy: 0,
      settled: false,
    };
  }

  private checkWin(row: number, col: number): WinLine | null {
    const owner = this.grid[row]![col];
    if (!owner) return null;

    const dirs: [number, number][] = [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, -1],
    ];

    for (const [dr, dc] of dirs) {
      const cells: { r: number; c: number }[] = [{ r: row, c: col }];
      for (let d = 1; d < 4; d++) {
        const nr = row + dr * d;
        const nc = col + dc * d;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) break;
        if (this.grid[nr]![nc] !== owner) break;
        cells.push({ r: nr, c: nc });
      }
      for (let d = 1; d < 4; d++) {
        const nr = row - dr * d;
        const nc = col - dc * d;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) break;
        if (this.grid[nr]![nc] !== owner) break;
        cells.push({ r: nr, c: nc });
      }
      if (cells.length >= 4) return { cells, winner: owner };
    }
    return null;
  }

  private isBoardFull(): boolean {
    for (let c = 0; c < COLS; c++) if (this.topRow(c) >= 0) return false;
    return true;
  }

  private colFromX(px: number): number {
    const rel = px - this.boardX;
    if (rel < 0 || rel >= this.cellSize * COLS) return -1;
    return Math.floor(rel / this.cellSize);
  }

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (this.roundOver || this.gameOver || this.drop) return;
    const cp = this.currentPlayer();
    if (cp.kind !== "human") return;

    const p = this.toLogical(e);
    const col = this.colFromX(p.x);
    if (col < 0 || this.topRow(col) < 0) return;
    e.preventDefault();
    this.dropDisc(col);
  };

  private readonly onMove = (e: PointerEvent): void => {
    const p = this.toLogical(e);
    this.hoverCol = this.colFromX(p.x);
  };

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);

    this.drawBoard(g);
    this.drawHeader(g);
    this.drawScoreboard(g);

    this.juice.end(g);
    this.callouts.draw(g, width, height);
  }

  private drawHeader(g: CanvasRenderingContext2D): void {
    const { width } = this.ctx;
    const cp = this.currentPlayer();

    if (!this.roundOver && !this.gameOver) {
      g.fillStyle = cp.color;
      g.font = "700 22px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "top";
      g.fillText(`${cp.name}'S TURN`, width / 2, 8);
    }

    g.fillStyle = "rgba(244,247,251,0.5)";
    g.font = "600 14px Outfit, sans-serif";
    g.textAlign = "center";
    g.fillText(`Round ${this.round} of ${BEST_OF}`, width / 2, 32);
  }

  private drawScoreboard(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    const n = this.ctx.players.length;
    const sbW = 90;
    const totalW = n * sbW;
    const sx = (width - totalW) / 2;
    const sy = height - 42;

    for (let i = 0; i < n; i++) {
      const p = this.ctx.players[i]!;
      const w = this.wins.get(p.id) ?? 0;
      const cx = sx + i * sbW + sbW / 2;

      g.fillStyle = p.color;
      g.font = "600 15px Outfit, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "top";
      g.fillText(p.name, cx, sy);

      for (let j = 0; j < Math.ceil(BEST_OF / 2); j++) {
        g.beginPath();
        g.arc(cx - 12 + j * 16, sy + 22, 5, 0, Math.PI * 2);
        g.fillStyle = j < w ? p.color : "rgba(244,247,251,0.15)";
        g.fill();
      }
    }
  }

  private drawBoard(g: CanvasRenderingContext2D): void {
    const { boardX: bx, boardY: by, cellSize: cs } = this;

    g.fillStyle = "#0d1f4a";
    const pad = 6;
    g.beginPath();
    g.roundRect(bx - pad, by - pad, cs * COLS + pad * 2, cs * ROWS + pad * 2, 12);
    g.fill();

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cx = bx + (c + 0.5) * cs;
        const cy = by + (r + 0.5) * cs;
        const radius = cs * 0.38;

        const owner = this.grid[r]![c];
        if (owner) {
          const p = this.ctx.players.find((pl) => pl.id === owner);
          const col = p?.color ?? "#ffffff";
          const isWin =
            this.winLine?.cells.some((wc) => wc.r === r && wc.c === c) ?? false;

          g.save();
          if (isWin) {
            g.shadowColor = col;
            g.shadowBlur = 20 + Math.sin(this.time * 6) * 8;
          }
          g.beginPath();
          g.arc(cx, cy, radius, 0, Math.PI * 2);
          g.fillStyle = col;
          g.fill();
          g.shadowBlur = 0;

          g.beginPath();
          g.arc(cx - radius * 0.2, cy - radius * 0.25, radius * 0.45, 0, Math.PI * 2);
          g.fillStyle = "rgba(255,255,255,0.18)";
          g.fill();
          g.restore();
        } else {
          g.beginPath();
          g.arc(cx, cy, radius, 0, Math.PI * 2);
          g.fillStyle = "#070b14";
          g.fill();
        }
      }
    }

    if (this.drop && !this.drop.settled) {
      const p = this.ctx.players.find((pl) => pl.id === this.drop!.owner);
      const col = p?.color ?? "#ffffff";
      const cx = bx + (this.drop.col + 0.5) * cs;
      g.save();
      g.shadowColor = col;
      g.shadowBlur = 14;
      g.beginPath();
      g.arc(cx, this.drop.y, cs * 0.38, 0, Math.PI * 2);
      g.fillStyle = col;
      g.fill();
      g.restore();
    }

    if (
      !this.roundOver &&
      !this.gameOver &&
      !this.drop &&
      this.hoverCol >= 0 &&
      this.currentPlayer().kind === "human" &&
      this.topRow(this.hoverCol) >= 0
    ) {
      const cp = this.currentPlayer();
      const cx = bx + (this.hoverCol + 0.5) * cs;
      g.save();
      g.globalAlpha = 0.4;
      g.shadowColor = cp.color;
      g.shadowBlur = 12;
      g.beginPath();
      g.arc(cx, by - cs * 0.5, cs * 0.32, 0, Math.PI * 2);
      g.fillStyle = cp.color;
      g.fill();
      g.restore();

      g.save();
      g.globalAlpha = 0.08;
      g.fillStyle = cp.color;
      g.fillRect(bx + this.hoverCol * cs, by, cs, cs * ROWS);
      g.restore();
    }
  }

  isFinished(): boolean {
    return this.gameOver && this.gameOverTimer <= 0;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.ctx.players.map((p) => ({
      playerId: p.id,
      score: (this.wins.get(p.id) ?? 0) * 100,
    }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const p of this.ctx.players) {
      const w = this.wins.get(p.id) ?? 0;
      const t = this.turnCounts.get(p.id) ?? 0;
      out.push({ playerId: p.id, label: "Rounds won", value: String(w) });
      if (t > 0) out.push({ playerId: p.id, label: "Discs played", value: String(t) });
    }
    return out;
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener("pointerdown", this.onDown);
    this.ctx.canvas.removeEventListener("pointermove", this.onMove);
  }
}

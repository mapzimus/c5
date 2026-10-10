import { fillArena } from "../../core/draw";
import { Callouts, Juice } from "../../fx/juice";
import type {
  GameContext,
  GameDefinition,
  GameInstance,
  GameStat,
  Player,
} from "../../core/types";
import {
  COLS,
  ROWS,
  anvilSmash,
  applyGravity,
  bombBlast,
  canDrop,
  createGrid,
  findWins,
  isFull,
  pickWinner,
  playMove,
  topRow,
  winningColumns,
  type DiscKind,
  type Grid,
  type WinLine,
} from "./board";

export const connectFour: GameDefinition = {
  id: "connect-four",
  name: "Drop Zone",
  tagline: "Get four in a row. Blow up theirs.",
  description:
    "Take turns dropping discs into the grid. Get four of yours in a row — across, " +
    "up, or diagonal — to take the round. Everyone also gets one Bomb, which clears " +
    "the 3×3 around where it lands, and one Anvil, which smashes a whole column and " +
    "keeps the bottom spot. Pieces fall after a blast, so a lucky drop can hand " +
    "anyone a line. First to 2 rounds wins.",
  durationMs: 0,
  controls: "Tap a column to drop · pick Disc, Bomb or Anvil on the left (or keys 1–3)",
  create: (ctx) => new DropZoneGame(ctx),
};

const BEST_OF = 3;
const KINDS: DiscKind[] = ["normal", "bomb", "anvil"];
const KIND_LABEL: Record<DiscKind, string> = { normal: "DISC", bomb: "BOMB", anvil: "ANVIL" };
const KEYS: Record<string, DiscKind> = { Digit1: "normal", Digit2: "bomb", Digit3: "anvil" };

interface Powers {
  bomb: number;
  anvil: number;
}

interface DropAnim {
  col: number;
  row: number;
  owner: string;
  kind: DiscKind;
  y: number;
  targetY: number;
  vy: number;
}

interface FallAnim {
  c: number;
  r: number;
  y: number;
  targetY: number;
  vy: number;
}

interface Button {
  kind: DiscKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

class DropZoneGame implements GameInstance {
  private grid: Grid = createGrid();
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private time = 0;
  private turnIndex = 0;
  private round = 1;
  private wins = new Map<string, number>();
  private powers = new Map<string, Powers>();
  private selected: DiscKind = "normal";
  private winLine: WinLine | null = null;
  private roundOver = false;
  private roundTimer = 0;
  private gameOver = false;
  private gameOverTimer = 0;
  private drop: DropAnim | null = null;
  private falling: FallAnim[] = [];
  private hoverCol = -1;
  private readonly turnCounts = new Map<string, number>();
  private readonly powersUsed = new Map<string, number>();

  private boardX = 0;
  private boardY = 0;
  private cellSize = 0;
  private buttons: Button[] = [];

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

    const h = Math.max(this.ctx.minTap || 0, 64);
    const w = Math.min(160, this.boardX - 40);
    const x = this.boardX - 24 - w;
    this.buttons = KINDS.map((kind, i) => ({ kind, x, y: this.boardY + i * (h + 14), w, h }));
  }

  private resetGrid(): void {
    this.grid = createGrid();
    this.winLine = null;
    this.roundOver = false;
    this.roundTimer = 0;
    this.drop = null;
    this.falling = [];
    this.hoverCol = -1;
    this.selected = "normal";
    // Powers refill every round so each round has its own big moments.
    for (const p of this.ctx.players) this.powers.set(p.id, { bomb: 1, anvil: 1 });
  }

  private currentPlayer(): Player {
    return this.ctx.players[this.turnIndex % this.ctx.players.length]!;
  }

  private playerColor(id: string): string {
    return this.ctx.players.find((pl) => pl.id === id)?.color ?? "#ffffff";
  }

  private cellCenter(r: number, c: number): { x: number; y: number } {
    return {
      x: this.boardX + (c + 0.5) * this.cellSize,
      y: this.boardY + (r + 0.5) * this.cellSize,
    };
  }

  private hasPower(id: string, kind: DiscKind): boolean {
    if (kind === "normal") return true;
    return (this.powers.get(id)?.[kind] ?? 0) > 0;
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += dt;

    if (this.drop) {
      this.stepDrop(dt);
      return;
    }

    if (this.falling.length > 0) {
      let busy = false;
      for (const f of this.falling) {
        if (f.y >= f.targetY) continue;
        f.vy += 2800 * dt;
        f.y = Math.min(f.targetY, f.y + f.vy * dt);
        busy ||= f.y < f.targetY;
      }
      if (!busy) {
        this.falling = [];
        this.ctx.sfx.hit();
        this.juice.shake(0.1);
        this.resolveTurn();
      }
      return;
    }

    if (this.roundOver) {
      this.roundTimer -= realDt;
      if (this.roundTimer <= 0) this.nextRound();
      return;
    }

    if (this.gameOver) {
      this.gameOverTimer -= realDt;
      return;
    }

    const cp = this.currentPlayer();
    if (cp.kind === "bot") {
      this.botMove();
    } else {
      for (const [code, kind] of Object.entries(KEYS)) {
        if (this.ctx.input.justPressed(code)) this.select(kind);
      }
    }
  }

  private stepDrop(dt: number): void {
    const d = this.drop!;
    d.vy += (d.kind === "anvil" ? 4200 : 2800) * dt;
    d.y = Math.min(d.targetY, d.y + d.vy * dt);

    if (d.kind === "anvil") {
      // Smash discs as the anvil reaches them.
      for (let r = 0; r < ROWS; r++) {
        const owner = this.grid[r]![d.col];
        if (!owner) continue;
        const { x, y } = this.cellCenter(r, d.col);
        if (d.y + this.cellSize * 0.4 < y) continue;
        this.grid[r]![d.col] = null;
        this.juice.burst(x, y, [this.playerColor(owner), "#9aa3b5"], { count: 14, speed: 260, life: 0.5 });
        this.juice.shake(0.15);
        this.ctx.sfx.hit();
      }
    }

    if (d.y < d.targetY) return;
    this.drop = null;
    const { x, y } = this.cellCenter(d.row, d.col);

    if (d.kind === "normal") {
      this.grid[d.row]![d.col] = d.owner;
      this.juice.shake(0.12);
      this.ctx.sfx.hit();
      this.resolveTurn();
    } else if (d.kind === "anvil") {
      anvilSmash(this.grid, d.col, d.owner);
      this.juice.shake(0.35);
      this.juice.burst(x, y + this.cellSize * 0.3, ["#9aa3b5", "#ffffff"], { count: 20, speed: 320, life: 0.5, angle: -Math.PI / 2, spread: 2 });
      this.callouts.show("ANVIL!", this.playerColor(d.owner), { size: 44, life: 0.8 });
      this.resolveTurn();
    } else {
      const destroyed = bombBlast(this.grid, d.row, d.col);
      for (const { cell, owner } of destroyed) {
        const p = this.cellCenter(cell.r, cell.c);
        this.juice.burst(p.x, p.y, [this.playerColor(owner), "#FFB020"], { count: 10, speed: 240, life: 0.5 });
      }
      this.juice.burst(x, y, ["#FFB020", "#FF3D7A", "#ffffff"], { count: 40, speed: 420, life: 0.7, gravity: 0 });
      this.juice.shake(0.5);
      this.juice.hitStop(0.06);
      this.ctx.sfx.whoosh();
      this.callouts.show("BOOM!", "#FFB020", { size: 56, life: 0.8 });
      const falls = applyGravity(this.grid);
      this.falling = falls.map((f) => ({
        c: f.c,
        r: f.toR,
        y: this.cellCenter(f.fromR, f.c).y,
        targetY: this.cellCenter(f.toR, f.c).y,
        vy: 0,
      }));
      if (this.falling.length === 0) this.resolveTurn();
    }
  }

  /** After everything has landed: check lines for everyone, then pass the turn. */
  private resolveTurn(): void {
    const cp = this.currentPlayer();
    const lines = findWins(this.grid);
    const winner = pickWinner(lines, cp.id);
    if (winner) {
      const cells = lines.filter((l) => l.winner === winner).flatMap((l) => l.cells);
      this.winLine = { cells, winner };
      this.roundOver = true;
      this.roundTimer = 2.5;
      this.wins.set(winner, (this.wins.get(winner) ?? 0) + 1);
      const p = this.ctx.players.find((pl) => pl.id === winner)!;
      this.callouts.show(winner === cp.id ? `${p.name} SCORES!` : `GIFT FOR ${p.name}!`, p.color, { size: 56 });
      this.juice.shake(0.3);
      this.ctx.sfx.win();
      for (const cell of cells) {
        const { x, y } = this.cellCenter(cell.r, cell.c);
        this.juice.burst(x, y, [p.color, "#ffffff"], { count: 12, speed: 200, gravity: 0, life: 0.6 });
      }
    } else if (isFull(this.grid)) {
      this.roundOver = true;
      this.roundTimer = 2;
      this.callouts.show("DRAW!", "#F4F7FB", { size: 56 });
      this.ctx.sfx.miss();
    } else {
      this.turnIndex++;
      this.selected = "normal";
      this.ctx.sfx.tick();
    }
  }

  private nextRound(): void {
    const maxWins = Math.max(...this.wins.values());
    if (maxWins >= Math.ceil(BEST_OF / 2) || this.round >= BEST_OF) {
      this.roundOver = false;
      this.gameOver = true;
      this.gameOverTimer = 1.5;
      const winner = this.ctx.players.find((p) => (this.wins.get(p.id) ?? 0) === maxWins);
      if (winner) {
        this.callouts.show(`${winner.name} WINS THE MATCH!`, winner.color, { size: 48 });
        this.ctx.sfx.win();
      }
    } else {
      this.round++;
      this.turnIndex = this.round - 1; // rotate who opens each round
      this.resetGrid();
      this.callouts.show(`ROUND ${this.round}`, "#3EE0FF", { size: 56, life: 1 });
    }
  }

  private select(kind: DiscKind): void {
    const cp = this.currentPlayer();
    if (!this.hasPower(cp.id, kind)) {
      this.ctx.sfx.miss();
      return;
    }
    // Tapping the active power again switches back to a plain disc.
    this.selected = this.selected === kind ? "normal" : kind;
    this.ctx.sfx.select();
  }

  private botMove(): void {
    if (this.ctx.rng.next() < 0.92) return;
    const move = this.chooseBotMove();
    if (move) this.dropDisc(move.col, move.kind);
  }

  private chooseBotMove(): { col: number; kind: DiscKind } | null {
    const me = this.currentPlayer().id;
    const opps = this.ctx.players.filter((p) => p.id !== me).map((p) => p.id);
    const kinds = KINDS.filter((k) => this.hasPower(me, k));
    const powers = kinds.filter((k) => k !== "normal");
    const threatCount = (g: Grid): number =>
      opps.reduce((n, o) => n + winningColumns(g, o).length, 0);

    // 1. Take a win, plain disc first, then with a power.
    for (const kind of kinds) {
      for (let c = 0; c < COLS; c++) {
        if (playMove(this.grid, c, kind, me)?.winner === me) return { col: c, kind };
      }
    }

    // 2. Break opponent threats. Prefer a plain block; use a power if that's not enough.
    if (threatCount(this.grid) > 0) {
      let best: { col: number; kind: DiscKind; threats: number } | null = null;
      for (const kind of kinds) {
        for (let c = 0; c < COLS; c++) {
          const res = playMove(this.grid, c, kind, me);
          if (!res || res.winner) continue;
          const threats = threatCount(res.grid);
          if (!best || threats < best.threats) best = { col: c, kind, threats };
        }
      }
      if (best) return best;
    }

    // 3. Now and then, cash in a power that wrecks more of theirs than ours.
    if (powers.length > 0 && this.ctx.rng.next() < 0.3) {
      for (const kind of powers) {
        for (let c = 0; c < COLS; c++) {
          const res = playMove(this.grid, c, kind, me);
          if (!res || res.winner || threatCount(res.grid) > 0) continue;
          const theirs = res.destroyed.filter((d) => d.owner !== me).length;
          const mine = res.destroyed.length - theirs;
          if (theirs - mine >= 3) return { col: c, kind };
        }
      }
    }

    // 4. Plain disc, centre-weighted, avoiding columns that set up an opponent win.
    const legal: number[] = [];
    for (let c = 0; c < COLS; c++) if (topRow(this.grid, c) >= 0) legal.push(c);
    const safe = legal.filter((c) => {
      const res = playMove(this.grid, c, "normal", me);
      return res !== null && threatCount(res.grid) === 0;
    });
    const pool = safe.length > 0 ? safe : legal;
    if (pool.length === 0) return powers.includes("anvil") ? { col: this.ctx.rng.int(0, COLS - 1), kind: "anvil" } : null;
    const weights = pool.map((c) => 4 - Math.abs(c - 3));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = this.ctx.rng.float(0, total);
    for (let i = 0; i < pool.length; i++) {
      roll -= weights[i]!;
      if (roll <= 0) return { col: pool[i]!, kind: "normal" };
    }
    return { col: pool[pool.length - 1]!, kind: "normal" };
  }

  private dropDisc(col: number, kind: DiscKind): void {
    const cp = this.currentPlayer();
    if (!this.hasPower(cp.id, kind) || !canDrop(this.grid, col, kind)) return;
    const row = kind === "anvil" ? ROWS - 1 : topRow(this.grid, col);
    this.turnCounts.set(cp.id, (this.turnCounts.get(cp.id) ?? 0) + 1);
    if (kind !== "normal") {
      this.powers.get(cp.id)![kind]--;
      this.powersUsed.set(cp.id, (this.powersUsed.get(cp.id) ?? 0) + 1);
      this.ctx.sfx.whoosh();
    }
    this.selected = "normal";
    this.drop = {
      col,
      row,
      owner: cp.id,
      kind,
      y: this.boardY - this.cellSize,
      targetY: this.cellCenter(row, col).y,
      vy: 0,
    };
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

  private busy(): boolean {
    return this.roundOver || this.gameOver || this.drop !== null || this.falling.length > 0;
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (this.busy()) return;
    const cp = this.currentPlayer();
    if (cp.kind !== "human") return;

    const p = this.toLogical(e);
    const btn = this.buttons.find((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
    if (btn) {
      e.preventDefault();
      this.select(btn.kind);
      return;
    }
    const col = this.colFromX(p.x);
    if (!canDrop(this.grid, col, this.selected)) return;
    e.preventDefault();
    this.hoverCol = col;
    this.dropDisc(col, this.selected);
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
    this.drawPicker(g);
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
    g.textBaseline = "top";
    g.fillText(`Round ${this.round} of ${BEST_OF}`, width / 2, 32);
  }

  private drawPicker(g: CanvasRenderingContext2D): void {
    if (this.gameOver) return;
    const cp = this.currentPlayer();
    const human = cp.kind === "human";
    const powers = this.powers.get(cp.id);

    g.save();
    g.fillStyle = "rgba(244,247,251,0.5)";
    g.font = "600 13px Outfit, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "bottom";
    g.fillText(human ? "DROP WHAT?" : `${cp.name.toUpperCase()} HAS`, this.buttons[0]!.x, this.buttons[0]!.y - 6);

    this.buttons.forEach((b, i) => {
      const left = b.kind === "normal" ? -1 : (powers?.[b.kind] ?? 0);
      const usable = left !== 0;
      const active = human && this.selected === b.kind;
      g.globalAlpha = usable ? 1 : 0.3;
      g.beginPath();
      g.roundRect(b.x, b.y, b.w, b.h, 12);
      g.fillStyle = active ? cp.color : "rgba(13,31,74,0.9)";
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = active ? "#ffffff" : "rgba(244,247,251,0.18)";
      g.stroke();

      const iy = b.y + b.h / 2;
      const ix = b.x + 30;
      const ink = active ? "#070b14" : "#F4F7FB";
      this.drawPiece(g, ix, iy, 16, b.kind, active ? "#ffffff" : cp.color);

      g.fillStyle = ink;
      g.font = "700 22px Bebas Neue, Impact, sans-serif";
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillText(KIND_LABEL[b.kind], b.x + 56, iy - 7);
      g.font = "600 12px Outfit, sans-serif";
      g.globalAlpha *= 0.75;
      g.fillText(left < 0 ? `${i + 1} · unlimited` : `${i + 1} · ${left} left`, b.x + 56, iy + 13);
    });
    g.restore();
  }

  private drawScoreboard(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    const n = this.ctx.players.length;
    const sbW = 120;
    const totalW = n * sbW;
    const sx = (width - totalW) / 2;
    const sy = height - 44;

    for (let i = 0; i < n; i++) {
      const p = this.ctx.players[i]!;
      const w = this.wins.get(p.id) ?? 0;
      const pw = this.powers.get(p.id);
      const cx = sx + i * sbW + sbW / 2;

      g.fillStyle = p.color;
      g.font = "600 15px Outfit, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "top";
      g.fillText(p.name, cx, sy);

      for (let j = 0; j < Math.ceil(BEST_OF / 2); j++) {
        g.beginPath();
        g.arc(cx - 34 + j * 14, sy + 26, 5, 0, Math.PI * 2);
        g.fillStyle = j < w ? p.color : "rgba(244,247,251,0.15)";
        g.fill();
      }
      g.save();
      g.globalAlpha = pw && pw.bomb > 0 ? 1 : 0.2;
      this.drawPiece(g, cx + 12, sy + 26, 8, "bomb", p.color);
      g.globalAlpha = pw && pw.anvil > 0 ? 1 : 0.2;
      this.drawPiece(g, cx + 34, sy + 26, 8, "anvil", p.color);
      g.restore();
    }
  }

  /** A disc in the owner's colour; powers get a mark so you can tell them apart. */
  private drawPiece(g: CanvasRenderingContext2D, x: number, y: number, radius: number, kind: DiscKind, color: string): void {
    g.save();
    if (kind === "anvil") {
      g.fillStyle = "#9aa3b5";
      g.beginPath();
      g.moveTo(x - radius, y - radius * 0.7);
      g.lineTo(x + radius, y - radius * 0.7);
      g.lineTo(x + radius * 0.55, y);
      g.lineTo(x + radius * 0.75, y + radius * 0.8);
      g.lineTo(x - radius * 0.75, y + radius * 0.8);
      g.lineTo(x - radius * 0.55, y);
      g.closePath();
      g.fill();
      g.fillStyle = color;
      g.fillRect(x - radius * 0.75, y + radius * 0.5, radius * 1.5, radius * 0.3);
    } else {
      g.beginPath();
      g.arc(x, y, radius, 0, Math.PI * 2);
      g.fillStyle = kind === "bomb" ? "#1a1d26" : color;
      g.fill();
      if (kind === "bomb") {
        g.lineWidth = Math.max(2, radius * 0.18);
        g.strokeStyle = color;
        g.stroke();
        g.beginPath();
        g.moveTo(x + radius * 0.5, y - radius * 0.8);
        g.lineTo(x + radius * 0.9, y - radius * 1.3);
        g.strokeStyle = "#FFB020";
        g.stroke();
      } else {
        g.beginPath();
        g.arc(x - radius * 0.2, y - radius * 0.25, radius * 0.45, 0, Math.PI * 2);
        g.fillStyle = "rgba(255,255,255,0.18)";
        g.fill();
      }
    }
    g.restore();
  }

  private drawBoard(g: CanvasRenderingContext2D): void {
    const { boardX: bx, boardY: by, cellSize: cs } = this;
    const radius = cs * 0.38;

    g.fillStyle = "#0d1f4a";
    const pad = 6;
    g.beginPath();
    g.roundRect(bx - pad, by - pad, cs * COLS + pad * 2, cs * ROWS + pad * 2, 12);
    g.fill();

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const { x: cx, y: cy } = this.cellCenter(r, c);
        g.beginPath();
        g.arc(cx, cy, radius, 0, Math.PI * 2);
        g.fillStyle = "#070b14";
        g.fill();

        const owner = this.grid[r]![c];
        if (!owner) continue;
        const fall = this.falling.find((f) => f.r === r && f.c === c);
        const y = fall ? fall.y : cy;
        const col = this.playerColor(owner);
        const isWin = this.winLine?.cells.some((wc) => wc.r === r && wc.c === c) ?? false;

        g.save();
        if (isWin) {
          g.shadowColor = col;
          g.shadowBlur = 20 + Math.sin(this.time * 6) * 8;
        }
        this.drawPiece(g, cx, y, radius, "normal", col);
        g.restore();
      }
    }

    if (this.drop) {
      const col = this.playerColor(this.drop.owner);
      const cx = bx + (this.drop.col + 0.5) * cs;
      g.save();
      g.shadowColor = col;
      g.shadowBlur = 14;
      this.drawPiece(g, cx, this.drop.y, radius, this.drop.kind, col);
      g.restore();
    }

    const cp = this.currentPlayer();
    if (this.busy() || this.hoverCol < 0 || cp.kind !== "human" || !canDrop(this.grid, this.hoverCol, this.selected)) return;

    const cx = bx + (this.hoverCol + 0.5) * cs;
    g.save();
    g.globalAlpha = 0.55;
    g.shadowColor = cp.color;
    g.shadowBlur = 12;
    this.drawPiece(g, cx, by - cs * 0.5, cs * 0.32, this.selected, cp.color);
    g.restore();

    // Preview what gets hit.
    g.save();
    if (this.selected === "bomb") {
      const row = topRow(this.grid, this.hoverCol);
      g.globalAlpha = 0.2 + Math.sin(this.time * 8) * 0.05;
      g.fillStyle = "#FFB020";
      const c0 = Math.max(0, this.hoverCol - 1);
      const c1 = Math.min(COLS - 1, this.hoverCol + 1);
      const r0 = Math.max(0, row - 1);
      const r1 = Math.min(ROWS - 1, row + 1);
      g.fillRect(bx + c0 * cs, by + r0 * cs, (c1 - c0 + 1) * cs, (r1 - r0 + 1) * cs);
    } else {
      g.globalAlpha = this.selected === "anvil" ? 0.2 : 0.08;
      g.fillStyle = this.selected === "anvil" ? "#FF3D7A" : cp.color;
      g.fillRect(bx + this.hoverCol * cs, by, cs, cs * ROWS);
    }
    g.restore();
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
      const u = this.powersUsed.get(p.id) ?? 0;
      out.push({ playerId: p.id, label: "Rounds won", value: String(w) });
      if (t > 0) out.push({ playerId: p.id, label: "Drops", value: String(t) });
      if (u > 0) out.push({ playerId: p.id, label: "Powers used", value: String(u) });
    }
    return out;
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener("pointerdown", this.onDown);
    this.ctx.canvas.removeEventListener("pointermove", this.onMove);
  }
}

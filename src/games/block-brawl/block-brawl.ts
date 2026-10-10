import { fillArena } from "../../core/draw";
import { PLAYER_BINDS as BINDS } from "../../core/input";
import { Callouts, Juice } from "../../fx/juice";
import type {
  GameContext,
  GameDefinition,
  GameInstance,
  GameStat,
  Player,
} from "../../core/types";
import {
  Bag,
  COLS,
  GARBAGE,
  ROTATIONS,
  ROWS,
  addGarbage,
  bestPlacement,
  clearLines,
  collides,
  dropY,
  emptyBoard,
  garbageFor,
  lockPiece,
  pieceCells,
  spawnPiece,
  tryRotate,
  type Board,
  type Piece,
  type Placement,
} from "./logic";

export const blockBrawl: GameDefinition = {
  id: "block-brawl",
  name: "Block Brawl",
  tagline: "Stack, clear, bury your rivals.",
  description:
    "Everyone drops the same falling blocks into their own well at once. " +
    "Clear 2, 3 or 4 lines to send 1, 2 or 4 garbage lines to a random rival. " +
    "Stack to the top and you're out. Last one standing wins; after 3 minutes, most lines wins. " +
    "Blocks fall faster as time goes on.",
  durationMs: 0,
  controls: "In your lane: tap = rotate, drag left/right = move, swipe down = drop",
  create: (ctx) => new BlockBrawl(ctx),
};

const HEADER = 56;
const TIME_LIMIT = 180;
const GRAVITY_START = 0.8;
const GRAVITY_MIN = 0.1;
const BOT_STEP = 0.14;
const COLORS = ["#3EE0FF", "#FFD23E", "#B05CFF", "#4CE36B", "#FF4D5E", "#3E7BFF", "#FF9A3E", "#5A6378"];

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  anchorX: number;
  startT: number;
  moved: boolean;
  dropped: boolean;
}

interface Well {
  player: Player;
  laneX: number;
  laneW: number;
  wellX: number;
  wellY: number;
  cell: number;
  board: Board;
  bag: Bag;
  piece: Piece | null;
  fallTimer: number;
  alive: boolean;
  deathTime: number;
  lines: number;
  sent: number;
  pendingGarbage: number;
  drag: Drag | null;
  botTarget: Placement | null;
  botTimer: number;
}

class BlockBrawl implements GameInstance {
  private readonly wells: Well[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private time = 0;
  private finished = false;
  private finishTimer = 0;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    const n = ctx.players.length;
    const laneW = ctx.width / n;
    const cell = Math.floor(Math.min((ctx.height - HEADER - 8) / ROWS, (laneW - 16) / COLS));
    const seed = ctx.rng.int(1, 0x7fffffff);

    this.wells = ctx.players.map((player, i) => {
      const laneX = i * laneW;
      const well: Well = {
        player,
        laneX,
        laneW,
        wellX: Math.round(laneX + (laneW - cell * COLS) / 2),
        wellY: HEADER,
        cell,
        board: emptyBoard(),
        bag: new Bag(seed),
        piece: null,
        fallTimer: 0,
        alive: true,
        deathTime: 0,
        lines: 0,
        sent: 0,
        pendingGarbage: 0,
        drag: null,
        botTarget: null,
        botTimer: 0,
      };
      return well;
    });
    for (const w of this.wells) this.spawn(w);

    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onCancel);
  }

  private gravity(): number {
    return Math.max(GRAVITY_MIN, GRAVITY_START - this.time / 240);
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);

    if (this.finished) {
      this.finishTimer -= realDt;
      return;
    }
    this.time += dt;

    for (const w of this.wells) {
      if (!w.alive || !w.piece) continue;
      if (w.player.kind === "bot") this.botTick(w, dt);
      else this.keyboard(w);
      if (!w.alive || !w.piece) continue;

      const softDrop = w.player.kind === "human" && this.ctx.input.isDown(bindDown(w.player.slot));
      w.fallTimer += softDrop ? dt * 8 : dt;
      const interval = this.gravity();
      while (w.fallTimer >= interval && w.piece) {
        w.fallTimer -= interval;
        const down: Piece = { ...w.piece, y: w.piece.y + 1 };
        if (collides(w.board, down)) {
          this.lock(w);
          break;
        }
        w.piece = down;
      }
    }

    this.checkEnd();
  }

  private checkEnd(): void {
    const alive = this.wells.filter((w) => w.alive);
    const minAlive = this.wells.length === 1 ? 0 : 1;
    if (alive.length <= minAlive) {
      this.finish(alive);
    } else if (this.time >= TIME_LIMIT) {
      const top = Math.max(...alive.map((w) => w.lines));
      this.finish(alive.filter((w) => w.lines === top));
    }
  }

  private finish(winners: Well[]): void {
    this.finished = true;
    this.finishTimer = 2;
    if (winners.length === 1) {
      const w = winners[0]!;
      this.callouts.show(`${w.player.name} WINS!`, w.player.color, { size: 64 });
      this.ctx.sfx.win();
    } else if (winners.length > 1) {
      this.callouts.show("TIME! TIE!", "#F4F7FB", { size: 64 });
      this.ctx.sfx.win();
    } else {
      this.callouts.show("GAME OVER", "#FF3D7A", { size: 64 });
      this.ctx.sfx.miss();
    }
  }

  private spawn(w: Well): void {
    if (w.pendingGarbage > 0) {
      const holes = Array.from({ length: w.pendingGarbage }, () => this.ctx.rng.int(0, COLS - 1));
      w.pendingGarbage = 0;
      const over = addGarbage(w.board, holes);
      this.ctx.sfx.hit();
      this.juice.shake(0.25);
      if (over) {
        this.knockOut(w);
        return;
      }
    }
    const p = spawnPiece(w.bag.next());
    w.fallTimer = 0;
    w.botTarget = null;
    if (collides(w.board, p)) {
      w.piece = null;
      this.knockOut(w);
      return;
    }
    w.piece = p;
  }

  private knockOut(w: Well): void {
    w.alive = false;
    w.piece = null;
    w.drag = null;
    w.deathTime = this.time;
    this.juice.shake(0.4);
    this.juice.burst(w.wellX + (w.cell * COLS) / 2, w.wellY + w.cell * 4, [w.player.color, "#FF3D7A", "#ffffff"], {
      count: 40,
      speed: 320,
      gravity: 500,
      life: 0.7,
    });
    this.ctx.sfx.miss();
    this.callouts.show(`${w.player.name} OUT!`, "#FF3D7A", { size: 48, life: 0.9 });
  }

  private lock(w: Well): void {
    if (!w.piece) return;
    lockPiece(w.board, w.piece);
    const cleared = clearLines(w.board);
    if (cleared > 0) {
      w.lines += cleared;
      this.juice.burst(w.wellX + (w.cell * COLS) / 2, w.wellY + w.cell * (ROWS - 2), [w.player.color, "#ffffff"], {
        count: 10 * cleared,
        speed: 260,
        gravity: 400,
        life: 0.5,
      });
      if (cleared >= 4) this.ctx.sfx.streak(3);
      else this.ctx.sfx.collect();
      const send = garbageFor(cleared);
      if (send > 0) this.sendGarbage(w, send, cleared);
    }
    w.piece = null;
    this.spawn(w);
  }

  private sendGarbage(from: Well, count: number, cleared: number): void {
    const targets = this.wells.filter((t) => t !== from && t.alive);
    if (targets.length === 0) return;
    const target = this.ctx.rng.pick(targets);
    target.pendingGarbage += count;
    from.sent += count;
    const label = cleared >= 4 ? "BLOCK BUSTER!" : `${cleared} LINES!`;
    this.callouts.show(`${label} +${count} → ${target.player.name}`, from.player.color, { size: 36, life: 0.9 });
  }

  // ---- moves ----

  private move(w: Well, dx: number): boolean {
    if (!w.piece) return false;
    const cand = { ...w.piece, x: w.piece.x + dx };
    if (collides(w.board, cand)) return false;
    w.piece = cand;
    return true;
  }

  private rotate(w: Well): boolean {
    if (!w.piece) return false;
    const r = tryRotate(w.board, w.piece);
    if (!r) return false;
    w.piece = r;
    this.ctx.sfx.tick();
    return true;
  }

  private hardDrop(w: Well): void {
    if (!w.piece) return;
    w.piece = { ...w.piece, y: dropY(w.board, w.piece) };
    this.ctx.sfx.whoosh();
    this.lock(w);
  }

  private keyboard(w: Well): void {
    const input = this.ctx.input;
    const slot = w.player.slot;
    const b = BINDS[slot]!;
    if (input.justPressed(b.left)) this.move(w, -1);
    if (input.justPressed(b.right)) this.move(w, 1);
    if (input.justPressed(b.up)) this.rotate(w);
    if (input.actionPressed(slot)) this.hardDrop(w);
  }

  private botTick(w: Well, dt: number): void {
    if (!w.piece) return;
    if (!w.botTarget) {
      w.botTarget = bestPlacement(w.board, w.piece.type) ?? { rot: 0, x: w.piece.x, score: 0 };
      w.botTimer = -0.2;
    }
    w.botTimer += dt;
    if (w.botTimer < BOT_STEP) return;
    w.botTimer = this.ctx.rng.float(-0.04, 0.03);
    const t = w.botTarget;
    if (w.piece.rot !== t.rot) {
      if (!this.rotate(w)) this.hardDrop(w);
    } else if (w.piece.x !== t.x) {
      if (!this.move(w, Math.sign(t.x - w.piece.x))) this.hardDrop(w);
    } else {
      this.hardDrop(w);
    }
  }

  // ---- touch ----

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private wellForPointer(id: number): Well | undefined {
    return this.wells.find((w) => w.drag?.pointerId === id);
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (this.finished) return;
    const p = this.toLogical(e);
    for (const w of this.wells) {
      if (w.player.kind !== "human" || !w.alive) continue;
      if (p.x >= w.laneX && p.x < w.laneX + w.laneW) {
        e.preventDefault();
        w.drag = {
          pointerId: e.pointerId,
          startX: p.x,
          startY: p.y,
          anchorX: p.x,
          startT: performance.now(),
          moved: false,
          dropped: false,
        };
        try {
          this.ctx.canvas.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        return;
      }
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    const w = this.wellForPointer(e.pointerId);
    if (!w || !w.drag || !w.alive) return;
    const d = w.drag;
    if (d.dropped) return;
    const p = this.toLogical(e);
    const step = Math.max(w.cell, 24);
    while (p.x - d.anchorX >= step) {
      d.anchorX += step;
      d.moved = true;
      this.move(w, 1);
    }
    while (d.anchorX - p.x >= step) {
      d.anchorX -= step;
      d.moved = true;
      this.move(w, -1);
    }
    const dy = p.y - d.startY;
    const dx = Math.abs(p.x - d.startX);
    if (dy > Math.max(70, w.cell * 2.5) && dy > dx * 1.5) {
      d.dropped = true;
      this.hardDrop(w);
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    const w = this.wellForPointer(e.pointerId);
    if (!w || !w.drag) return;
    const d = w.drag;
    w.drag = null;
    if (!w.alive || d.dropped || d.moved) return;
    const p = this.toLogical(e);
    const dist = Math.hypot(p.x - d.startX, p.y - d.startY);
    if (dist < 20 && performance.now() - d.startT < 400) this.rotate(w);
  };

  private readonly onCancel = (e: PointerEvent): void => {
    const w = this.wellForPointer(e.pointerId);
    if (w) w.drag = null;
  };

  // ---- render ----

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);
    for (const w of this.wells) this.drawWell(g, w);
    this.juice.end(g);

    const left = Math.max(0, Math.ceil(TIME_LIMIT - this.time));
    g.fillStyle = "rgba(244,247,251,0.6)";
    g.font = "700 18px Bebas Neue, Impact, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "bottom";
    g.fillText(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`, width / 2, height - 2);

    this.callouts.draw(g, width, height);
  }

  private drawCell(g: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, alpha = 1): void {
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.fillRect(x + 1, y + 1, size - 2, size - 2);
    g.fillStyle = "rgba(255,255,255,0.22)";
    g.fillRect(x + 1, y + 1, size - 2, Math.max(2, size * 0.18));
    g.globalAlpha = 1;
  }

  private drawWell(g: CanvasRenderingContext2D, w: Well): void {
    const { cell, wellX, wellY, player } = w;
    const ww = cell * COLS;
    const wh = cell * ROWS;

    if (w.laneX > 0) {
      g.strokeStyle = "rgba(244,247,251,0.06)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(w.laneX, 0);
      g.lineTo(w.laneX, this.ctx.height);
      g.stroke();
    }

    g.fillStyle = "rgba(7,11,20,0.7)";
    g.fillRect(wellX, wellY, ww, wh);
    g.strokeStyle = w.alive ? player.color : "rgba(244,247,251,0.2)";
    g.lineWidth = 2;
    g.strokeRect(wellX - 1, wellY - 1, ww + 2, wh + 2);

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const v = w.board[y]![x]!;
        if (v === 0) continue;
        const color = w.alive ? COLORS[v - 1]! : "#3a3f4e";
        this.drawCell(g, wellX + x * cell, wellY + y * cell, cell, v === GARBAGE ? COLORS[7]! : color);
      }
    }

    if (w.piece) {
      const ghost = { ...w.piece, y: dropY(w.board, w.piece) };
      for (const [x, y] of pieceCells(ghost)) {
        if (y >= 0) this.drawCell(g, wellX + x * cell, wellY + y * cell, cell, COLORS[w.piece.type]!, 0.2);
      }
      for (const [x, y] of pieceCells(w.piece)) {
        if (y >= 0) this.drawCell(g, wellX + x * cell, wellY + y * cell, cell, COLORS[w.piece.type]!);
      }
    }

    // incoming garbage meter
    if (w.pendingGarbage > 0) {
      const mh = Math.min(ROWS, w.pendingGarbage) * cell;
      g.fillStyle = "#FF3D7A";
      g.fillRect(wellX - 7, wellY + wh - mh, 4, mh);
    }

    // header
    g.textBaseline = "top";
    g.textAlign = "left";
    g.fillStyle = player.color;
    g.font = "700 22px Bebas Neue, Impact, sans-serif";
    g.fillText(player.name, wellX, 6);
    g.fillStyle = "#F4F7FB";
    g.font = "700 18px Bebas Neue, Impact, sans-serif";
    g.fillText(`LINES ${w.lines}`, wellX, 30);

    // next block preview
    if (w.alive) {
      const next = w.bag.peek();
      const mini = Math.min(11, Math.floor(cell * 0.4));
      const cells = ROTATIONS[next]![0]!;
      const px = wellX + ww - mini * 4;
      g.fillStyle = "rgba(244,247,251,0.5)";
      g.font = "700 12px Bebas Neue, Impact, sans-serif";
      g.textAlign = "right";
      g.fillText("NEXT", px - 4, 10);
      for (const [cx, cy] of cells) this.drawCell(g, px + cx * mini, 8 + cy * mini, mini, COLORS[next]!);
    }

    if (!w.alive) {
      g.fillStyle = "rgba(244,247,251,0.35)";
      g.font = "700 48px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("OUT", wellX + ww / 2, wellY + wh / 2);
    }
  }

  isFinished(): boolean {
    return this.finished && this.finishTimer <= 0;
  }

  getScores(): { playerId: string; score: number }[] {
    const n = this.wells.length;
    // Alive players outrank everyone (lines break the time-out tie); the
    // knocked-out rank by how long they survived.
    return this.wells.map((w) => {
      const tier = w.alive ? n + 1 : this.wells.filter((o) => !o.alive && o.deathTime < w.deathTime).length;
      return { playerId: w.player.id, score: tier * 1000 + Math.min(999, w.lines) };
    });
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const w of this.wells) {
      out.push({ playerId: w.player.id, label: "Lines", value: String(w.lines) });
      out.push({ playerId: w.player.id, label: "Garbage sent", value: String(w.sent) });
    }
    return out;
  }

  destroy(): void {
    const c = this.ctx.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onCancel);
  }
}

function bindDown(slot: 0 | 1 | 2 | 3): string {
  return BINDS[slot]!.down;
}

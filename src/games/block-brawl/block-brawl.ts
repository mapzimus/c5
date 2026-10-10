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
  POWER,
  POWERS,
  POWER_LABEL,
  POWER_TIME,
  ROTATIONS,
  ROWS,
  addGarbage,
  attackFor,
  bestPlacement,
  cellKind,
  clearLines,
  collides,
  dropY,
  emptyBoard,
  flipDir,
  lockPiece,
  nextChain,
  pieceCells,
  powerCellFor,
  powersInFullRows,
  rushGravity,
  spawnPiece,
  tryRotate,
  type Board,
  type Piece,
  type Placement,
  type PowerKind,
} from "./logic";

export const blockBrawl: GameDefinition = {
  id: "block-brawl",
  name: "Block Brawl",
  tagline: "Chain clears. Pop power cells. Bury everyone.",
  description:
    "Everyone drops the same blocks into their own well at once. Clear 2+ lines to dump garbage on a rival. " +
    "Clear on back-to-back drops to build a CHAIN: every 2 links adds +1 garbage. " +
    "Some blocks carry a glowing power cell. Clear its row to hit every rival with INK (blind), " +
    "RUSH (turbo gravity) or FLIP (controls reversed). Top out and you're out. Last one standing wins; " +
    "after 3 minutes, most lines wins.",
  durationMs: 0,
  controls: "In your lane: tap = rotate, drag = move, swipe down = drop. Clear glowing cells to fire powers.",
  create: (ctx) => new BlockBrawl(ctx),
};

const HEADER = 56;
const TIME_LIMIT = 180;
const GRAVITY_START = 0.8;
const GRAVITY_MIN = 0.1;
const BOT_STEP = 0.14;
const POWER_COLOR: Record<PowerKind, string> = { ink: "#9AA3FF", rush: "#FF9A3E", flip: "#FF4DE1" };
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
  /** Pieces dealt so far (index into the shared sequence). */
  dealt: number;
  /** Glowing cell index of the current piece, or -1. */
  power: number;
  chain: number;
  bestChain: number;
  powersFired: number;
  effects: Record<PowerKind, number>;
  inkBlots: { x: number; y: number; r: number }[];
}

class BlockBrawl implements GameInstance {
  private readonly wells: Well[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private time = 0;
  private clock = 0;
  private readonly seed: number;
  private finished = false;
  private finishTimer = 0;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    const n = ctx.players.length;
    const laneW = ctx.width / n;
    const cell = Math.floor(Math.min((ctx.height - HEADER - 8) / ROWS, (laneW - 16) / COLS));
    const seed = ctx.rng.int(1, 0x7fffffff);
    this.seed = seed;

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
        dealt: 0,
        power: -1,
        chain: 0,
        bestChain: 0,
        powersFired: 0,
        effects: { ink: 0, rush: 0, flip: 0 },
        inkBlots: [],
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

  private gravity(w: Well): number {
    const base = Math.max(GRAVITY_MIN, GRAVITY_START - this.time / 240);
    return w.effects.rush > 0 ? rushGravity(base) : base;
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.clock += realDt;

    if (this.finished) {
      this.finishTimer -= realDt;
      return;
    }
    this.time += dt;

    for (const w of this.wells) {
      for (const k of POWERS) w.effects[k] = Math.max(0, w.effects[k] - dt);
      if (!w.alive || !w.piece) continue;
      if (w.player.kind === "bot") this.botTick(w, dt);
      else this.keyboard(w);
      if (!w.alive || !w.piece) continue;

      const softDrop = w.player.kind === "human" && this.ctx.input.isDown(bindDown(w.player.slot));
      w.fallTimer += softDrop ? dt * 8 : dt;
      const interval = this.gravity(w);
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
    w.power = powerCellFor(this.seed, w.dealt++);
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
    lockPiece(w.board, w.piece, w.power);
    const powers = powersInFullRows(w.board);
    const cleared = clearLines(w.board);
    const prevChain = w.chain;
    w.chain = nextChain(w.chain, cleared);
    w.bestChain = Math.max(w.bestChain, w.chain);
    if (cleared === 0 && prevChain >= 3) {
      this.callouts.show(`${w.player.name} CHAIN BROKE`, "rgba(244,247,251,0.7)", { size: 26, life: 0.7, y: 0.8 });
    }
    if (cleared > 0) {
      w.lines += cleared;
      this.juice.burst(w.wellX + (w.cell * COLS) / 2, w.wellY + w.cell * (ROWS - 2), [w.player.color, "#ffffff"], {
        count: 10 * cleared,
        speed: 260,
        gravity: 400,
        life: 0.5,
      });
      if (cleared >= 4) this.ctx.sfx.streak(3);
      else if (w.chain >= 2) this.ctx.sfx.streak(Math.min(3, w.chain - 1));
      else this.ctx.sfx.collect();
      if (w.chain >= 2) {
        const c = w.chain;
        this.juice.shake(Math.min(0.5, 0.08 * c));
        this.juice.burst(w.wellX + (w.cell * COLS) / 2, w.wellY + w.cell * 6, [w.player.color, "#FFD23E", "#ffffff"], {
          count: Math.min(60, 8 * c),
          speed: 220 + 40 * c,
          gravity: 300,
          life: 0.6,
        });
      }
      const send = attackFor(cleared, w.chain);
      if (send > 0) this.sendGarbage(w, send, cleared);
      for (let i = 0; i < powers; i++) this.firePower(w);
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
    const label = from.chain >= 2 ? `CHAIN x${from.chain}!` : cleared >= 4 ? "BLOCK BUSTER!" : `${cleared} LINES!`;
    const size = Math.min(64, 36 + Math.max(0, from.chain - 1) * 6);
    this.callouts.show(`${label} +${count} → ${target.player.name}`, from.player.color, { size, life: 0.9 });
  }

  /** A cleared power cell hits every living rival with a random power. */
  private firePower(from: Well): void {
    const targets = this.wells.filter((t) => t !== from && t.alive);
    if (targets.length === 0) return;
    const kind = this.ctx.rng.pick(POWERS);
    from.powersFired++;
    for (const t of targets) {
      t.effects[kind] = POWER_TIME[kind];
      if (kind === "ink") {
        t.inkBlots = Array.from({ length: 5 }, () => ({
          x: this.ctx.rng.float(1, COLS - 1),
          y: this.ctx.rng.float(6, ROWS - 2),
          r: this.ctx.rng.float(1.6, 2.8),
        }));
      }
      this.juice.burst(t.wellX + (t.cell * COLS) / 2, t.wellY + t.cell * 4, [POWER_COLOR[kind], "#ffffff"], {
        count: 24,
        speed: 300,
        gravity: 200,
        life: 0.6,
      });
    }
    this.juice.shake(0.3);
    this.ctx.sfx.whoosh();
    this.callouts.show(`${from.player.name}: ${POWER_LABEL[kind]}`, POWER_COLOR[kind], { size: 72, life: 1.1, y: 0.5 });
  }

  // ---- moves ----

  private move(w: Well, dx: number): boolean {
    if (!w.piece) return false;
    const cand = { ...w.piece, x: w.piece.x + dx };
    if (collides(w.board, cand)) return false;
    w.piece = cand;
    return true;
  }

  private rotate(w: Well, dir = 1): boolean {
    if (!w.piece) return false;
    const r = tryRotate(w.board, w.piece, dir);
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
    const flipped = w.effects.flip > 0;
    if (input.justPressed(b.left)) this.move(w, flipDir(-1, flipped));
    if (input.justPressed(b.right)) this.move(w, flipDir(1, flipped));
    if (input.justPressed(b.up)) this.rotate(w, flipDir(1, flipped));
    if (input.actionPressed(slot)) this.hardDrop(w);
  }

  private botTick(w: Well, dt: number): void {
    if (!w.piece) return;
    if (!w.botTarget) {
      w.botTarget = bestPlacement(w.board, w.piece.type, w.power) ?? { rot: 0, x: w.piece.x, score: 0 };
      w.botTimer = -0.2;
    }
    w.botTimer += dt;
    // Bots fumble under powers too: slower hands while blinded or flipped.
    const step = w.effects.ink > 0 || w.effects.flip > 0 ? BOT_STEP * 1.8 : BOT_STEP;
    if (w.botTimer < step) return;
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
    const flipped = w.effects.flip > 0;
    while (p.x - d.anchorX >= step) {
      d.anchorX += step;
      d.moved = true;
      this.move(w, flipDir(1, flipped));
    }
    while (d.anchorX - p.x >= step) {
      d.anchorX -= step;
      d.moved = true;
      this.move(w, flipDir(-1, flipped));
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
    if (dist < 20 && performance.now() - d.startT < 400) this.rotate(w, flipDir(1, w.effects.flip > 0));
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
        const kind = cellKind(v);
        const color = w.alive ? COLORS[kind - 1]! : "#3a3f4e";
        this.drawCell(g, wellX + x * cell, wellY + y * cell, cell, kind === GARBAGE ? COLORS[7]! : color);
        if (w.alive && (v & POWER) !== 0) this.drawPowerGlow(g, wellX + x * cell, wellY + y * cell, cell);
      }
    }

    if (w.piece) {
      const ghost = { ...w.piece, y: dropY(w.board, w.piece) };
      for (const [x, y] of pieceCells(ghost)) {
        if (y >= 0) this.drawCell(g, wellX + x * cell, wellY + y * cell, cell, COLORS[w.piece.type]!, 0.2);
      }
      pieceCells(w.piece).forEach(([x, y], i) => {
        if (y < 0) return;
        this.drawCell(g, wellX + x * cell, wellY + y * cell, cell, COLORS[w.piece!.type]!);
        if (i === w.power) this.drawPowerGlow(g, wellX + x * cell, wellY + y * cell, cell);
      });
    }

    // ink blots
    if (w.alive && w.effects.ink > 0) {
      g.globalAlpha = Math.min(1, w.effects.ink / 0.6) * 0.94;
      g.fillStyle = "#0A0C18";
      for (const b of w.inkBlots) {
        g.beginPath();
        g.arc(wellX + b.x * cell, wellY + b.y * cell, b.r * cell, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }

    // active power effects: tinted border + label
    if (w.alive) {
      let row = 0;
      for (const k of POWERS) {
        const left = w.effects[k];
        if (left <= 0) continue;
        g.strokeStyle = POWER_COLOR[k];
        g.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(this.clock * 8));
        g.lineWidth = 3;
        g.strokeRect(wellX - 3 - row * 3, wellY - 3 - row * 3, ww + 6 + row * 6, wh + 6 + row * 6);
        g.globalAlpha = 1;
        g.fillStyle = POWER_COLOR[k];
        g.font = "700 20px Bebas Neue, Impact, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "top";
        g.fillText(`${k.toUpperCase()} ${left.toFixed(1)}`, wellX + ww / 2, wellY + 4 + row * 22);
        row++;
      }
    }

    // chain counter
    if (w.alive && w.chain >= 2) {
      const pulse = 1 + 0.08 * Math.sin(this.clock * 10);
      const size = Math.min(cell * 3, (22 + w.chain * 6) * pulse);
      g.globalAlpha = 0.85;
      g.fillStyle = w.chain >= 4 ? "#FFD23E" : player.color;
      g.font = `700 ${Math.round(size)}px Bebas Neue, Impact, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(`CHAIN x${w.chain}`, wellX + ww / 2, wellY + wh * 0.3);
      g.globalAlpha = 1;
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

    // next block preview (hidden while inked)
    if (w.alive) {
      const mini = Math.min(11, Math.floor(cell * 0.4));
      const px = wellX + ww - mini * 4;
      g.fillStyle = "rgba(244,247,251,0.5)";
      g.font = "700 12px Bebas Neue, Impact, sans-serif";
      g.textAlign = "right";
      g.fillText("NEXT", px - 4, 10);
      if (w.effects.ink > 0) {
        g.fillStyle = "#0A0C18";
        g.fillRect(px, 8, mini * 4, mini * 4);
        g.fillStyle = POWER_COLOR.ink;
        g.textAlign = "center";
        g.fillText("?", px + mini * 2, 8 + mini);
      } else {
        const next = w.bag.peek();
        const nextPower = powerCellFor(this.seed, w.dealt);
        ROTATIONS[next]![0]!.forEach(([cx, cy], i) => {
          this.drawCell(g, px + cx * mini, 8 + cy * mini, mini, COLORS[next]!);
          if (i === nextPower) this.drawPowerGlow(g, px + cx * mini, 8 + cy * mini, mini);
        });
      }
    }

    if (!w.alive) {
      g.fillStyle = "rgba(244,247,251,0.35)";
      g.font = "700 48px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("OUT", wellX + ww / 2, wellY + wh / 2);
    }
  }

  private drawPowerGlow(g: CanvasRenderingContext2D, x: number, y: number, size: number): void {
    const t = 0.5 + 0.5 * Math.sin(this.clock * 9);
    g.save();
    g.shadowColor = "#ffffff";
    g.shadowBlur = 6 + 8 * t;
    g.fillStyle = `rgba(255,255,255,${0.55 + 0.35 * t})`;
    const inset = size * 0.28;
    g.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
    g.restore();
    g.strokeStyle = `rgba(255,255,255,${0.6 + 0.4 * t})`;
    g.lineWidth = 2;
    g.strokeRect(x + 2, y + 2, size - 4, size - 4);
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
      out.push({ playerId: w.player.id, label: "Best chain", value: String(w.bestChain) });
      out.push({ playerId: w.player.id, label: "Powers fired", value: String(w.powersFired) });
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

import { fillArena } from "../../core/draw";
import { Callouts, Juice, saveBest } from "../../fx/juice";
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
  clearCells,
  createGrid,
  findWins,
  isFull,
  lineCells,
  lineLengthFor,
  previewTilt,
  scoreLines,
  seedGrid,
  simulateMove,
  tallyTilt,
  tiltSlide,
  topRow,
  underdogs,
  winningColumns,
  type DiscKind,
  type Fall,
  type Grid,
  type Pos,
  type Slide,
  type TiltDir,
  type WinLine,
} from "./board";

export const connectFour: GameDefinition = {
  id: "connect-four",
  name: "Drop Zone",
  tagline: "Four in a row scores. Then the board tilts.",
  description:
    "Take turns dropping discs. Four in a row bursts and scores, whatever falls into " +
    "place afterwards chains for double, triple... Every seven drops the whole board " +
    "TILTS sideways and everything slides: the players waiting their turn vote which way " +
    "it goes, and whoever is losing gets a double vote and a fresh Bomb. One Bomb and one " +
    "Anvil each. 70 seconds, the last 20 are OVERDRIVE at double points, then a FINAL TILT " +
    "decides it.",
  durationMs: 0,
  controls: "Tap a column to drop · Disc, Bomb or Anvil on the left (keys 1–3) · ◀ ▶ on your seat to steer the tilt",
  create: (ctx) => new DropZoneGame(ctx),
};

const MATCH_SECONDS = 70;
const OVERDRIVE_AT = 20;
// Tilt cadence shares no factor with the seat count, so the last drop before a tilt rotates fairly.
const TILT_EVERY = 7;
const TILT_EVERY_OVERDRIVE = 5;
const TILT_EVERY_CROWD = 5;
const TILT_EVERY_CROWD_OVERDRIVE = 3;
const SHOT_CLOCK = 7;
const SHOT_CLOCK_OVERDRIVE = 4.5;
const CLEAR_FLASH = 0.36;
const BEST_VERSION = "v2-tilt";
const KINDS: DiscKind[] = ["normal", "bomb", "anvil"];
const KIND_LABEL: Record<DiscKind, string> = { normal: "DISC", bomb: "BOMB", anvil: "ANVIL" };
const KEYS: Record<string, DiscKind> = { Digit1: "normal", Digit2: "bomb", Digit3: "anvil" };
const GOLD = "#FFB020";
const PINK = "#FF3D7A";
const CYAN = "#3EE0FF";
const INK = "#070b14";
const PAPER = "#F4F7FB";

type Phase = "turn" | "drop" | "clear" | "fall" | "tilt" | "over";

interface Seat {
  player: Player;
  score: number;
  bomb: number;
  anvil: number;
  lines: number;
  bestChain: number;
  drops: number;
  powersUsed: number;
  tiltsCalled: number;
  vote: TiltDir | null;
  /** Bots: seconds until they cast (or reconsider) their tilt vote. */
  voteTimer: number;
  label: { text: string; color: string; life: number; maxLife: number } | null;
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

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Button extends Rect {
  kind: DiscKind;
}

interface SeatBox extends Rect {
  left: Rect;
  right: Rect;
}

interface Pop {
  r: number;
  c: number;
  t: number;
}

const hit = (p: { x: number; y: number }, r: Rect): boolean =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

class DropZoneGame implements GameInstance {
  private grid: Grid = createGrid();
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly seats: Seat[];
  private time = 0;
  private timeLeft = MATCH_SECONDS;
  private overdrive = false;
  private phase: Phase = "turn";
  private turnIndex = 0;
  private selected: DiscKind = "normal";
  private shotClock = SHOT_CLOCK;
  private hoverCol = -1;
  private readonly pointers = new Map<number, number>();

  // Bots
  private botTimer = 0;
  private botPlan: { col: number; kind: DiscKind } | null = null;
  private botHover = -1;
  private botHoverTimer = 0;

  // Animations
  private drop: DropAnim | null = null;
  private falling: FallAnim[] = [];
  private afterFall: (() => void) | null = null;
  private clearing: { lines: WinLine[]; cells: Pos[]; chain: number; t: number } | null = null;
  private pops: Pop[] = [];
  private slides: Slide[] = [];
  private tiltT = 0;
  private tiltAngle = 0;
  private tiltDirNow: TiltDir = "left";
  private tiltFinal = false;
  private overTimer = 0;

  // The Tilt
  private tiltIn = TILT_EVERY;
  private lockedDir: TiltDir | null = null;
  private defaultDir: TiltDir = "left";
  private lastVote: TiltDir | null = null;
  private tiltGains = new Map<string, number>();
  private inTilt = false;
  private afterTiltCheck = false;
  private finalStarted = false;
  private tiltCount = 0;
  private tiltPoints = new Map<string, number>();

  private readonly needed: number;
  private readonly tiltEvery: number;
  private boardX = 0;
  private boardY = 0;
  private cellSize = 0;
  private buttons: Button[] = [];
  private seatBoxes: SeatBox[] = [];
  private tiltPanel: Rect = { x: 0, y: 0, w: 0, h: 0 };

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    this.needed = lineLengthFor(ctx.players.length);
    // Four colours jam the board and line up less, so four seats tilt more often.
    this.tiltEvery = ctx.players.length >= 4 ? TILT_EVERY_CROWD : TILT_EVERY;
    this.tiltIn = this.tiltEvery;
    this.seats = ctx.players.map((player) => ({
      player,
      score: 0,
      bomb: 1,
      anvil: 1,
      lines: 0,
      bestChain: 0,
      drops: 0,
      powersUsed: 0,
      tiltsCalled: 0,
      vote: null,
      voteTimer: ctx.rng.float(0.6, 2.4),
      label: null,
    }));
    this.defaultDir = ctx.rng.next() < 0.5 ? "left" : "right";
    this.layout();

    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);

    // The zone never starts empty: a fair scatter rains in, then the first player drops.
    const perPlayer = Math.max(3, Math.round(14 / ctx.players.length));
    const seeded = seedGrid(this.grid, ctx.players.map((p) => p.id), perPlayer, () => ctx.rng.next(), this.needed);
    this.startFalls(
      seeded.map((cell, i) => ({ c: cell.c, fromR: -1 - (i % 3) - cell.r * 0.4, toR: cell.r, owner: this.grid[cell.r]![cell.c]! })),
      () => this.startTurn(false),
    );
    this.callouts.show("DROP ZONE", CYAN, { size: 60, life: 1.1 });
    const word = this.needed === 3 ? "THREE" : "FOUR";
    this.callouts.show(`${word} in a row scores · the board tilts every ${this.tiltEvery} drops`, PAPER, { size: 24, y: 0.42, life: 2.4 });
  }

  // ---------------------------------------------------------------- layout

  private layout(): void {
    const { width, height } = this.ctx;
    const n = this.seats.length;
    const seatH = Math.max(this.ctx.minTap + 70, 128);
    const top = 80;
    this.cellSize = Math.min((width - 440) / COLS, (height - top - seatH - 30) / ROWS, 74);
    const bw = this.cellSize * COLS;
    const bh = this.cellSize * ROWS;
    this.boardX = (width - bw) / 2;
    this.boardY = top;

    const h = Math.max(this.ctx.minTap, 58);
    const w = Math.min(156, this.boardX - 40);
    const x = this.boardX - 22 - w;
    this.buttons = KINDS.map((kind, i) => ({ kind, x, y: this.boardY + 16 + i * (h + 12), w, h }));

    this.tiltPanel = { x: this.boardX + bw + 22, y: this.boardY, w: Math.min(170, width - (this.boardX + bw) - 40), h: bh };

    const seatY = this.boardY + bh + 18;
    const seatW = Math.min(300, (width - 40 - (n - 1) * 12) / n);
    const totalW = n * seatW + (n - 1) * 12;
    const sx = (width - totalW) / 2;
    const btnH = Math.max(this.ctx.minTap, 48);
    const btnW = (seatW - 36) / 2;
    this.seatBoxes = this.seats.map((_, i) => {
      const bx = sx + i * (seatW + 12);
      const by = seatY + seatH - btnH - 12;
      return {
        x: bx, y: seatY, w: seatW, h: seatH,
        left: { x: bx + 12, y: by, w: btnW, h: btnH },
        right: { x: bx + 24 + btnW, y: by, w: btnW, h: btnH },
      };
    });
  }

  // ---------------------------------------------------------------- helpers

  private currentSeat(): Seat {
    return this.seats[this.turnIndex % this.seats.length]!;
  }

  private seatOf(id: string): Seat | undefined {
    return this.seats.find((s) => s.player.id === id);
  }

  private playerColor(id: string): string {
    return this.seatOf(id)?.player.color ?? "#ffffff";
  }

  private cellCenter(r: number, c: number): { x: number; y: number } {
    return {
      x: this.boardX + (c + 0.5) * this.cellSize,
      y: this.boardY + (r + 0.5) * this.cellSize,
    };
  }

  private hasPower(seat: Seat, kind: DiscKind): boolean {
    if (kind === "normal") return true;
    return seat[kind] > 0;
  }

  private scores(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const s of this.seats) out[s.player.id] = s.score;
    return out;
  }

  private underdogIds(): Set<string> {
    return new Set(underdogs(this.scores()));
  }

  private multiplier(): number {
    return this.overdrive ? 2 : 1;
  }

  private tiltPeriod(): number {
    if (!this.overdrive) return this.tiltEvery;
    return this.seats.length >= 4 ? TILT_EVERY_CROWD_OVERDRIVE : TILT_EVERY_OVERDRIVE;
  }

  /** Which way the next tilt goes right now. */
  private tiltDir(): TiltDir {
    if (this.lockedDir) return this.lockedDir;
    const dogs = this.underdogIds();
    const votes = this.seats
      .filter((s) => s.vote !== null)
      .map((s) => ({ dir: s.vote!, weight: dogs.has(s.player.id) ? 2 : 1 }));
    return tallyTilt(votes, this.lastVote, this.defaultDir);
  }

  private label(seat: Seat, text: string, color: string, life = 1.5): void {
    seat.label = { text, color, life, maxLife: life };
  }

  private busy(): boolean {
    return this.phase !== "turn";
  }

  // ---------------------------------------------------------------- update

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += dt;
    for (const s of this.seats) if (s.label && (s.label.life -= realDt) <= 0) s.label = null;
    for (const p of this.pops) p.t += dt;
    this.pops = this.pops.filter((p) => p.t < 0.3);

    if (this.phase === "over") {
      this.overTimer -= realDt;
      return;
    }

    if (!this.finalStarted) {
      this.timeLeft = Math.max(0, this.timeLeft - realDt);
      if (!this.overdrive && this.timeLeft <= OVERDRIVE_AT) this.startOverdrive();
    }

    this.updateBotVotes(dt);

    switch (this.phase) {
      case "drop":
        this.stepDrop(dt);
        break;
      case "fall":
        this.stepFall(dt);
        break;
      case "clear":
        this.stepClear(dt);
        break;
      case "tilt":
        this.stepTilt(dt);
        break;
      case "turn":
        this.stepTurn(dt);
        break;
    }
  }

  private stepTurn(dt: number): void {
    const seat = this.currentSeat();
    if (seat.player.kind === "bot") {
      this.botTimer -= dt;
      this.botHoverTimer -= dt;
      if (this.botHoverTimer <= 0 && this.botPlan) {
        // Hesitate: hover over a couple of columns before settling on the real one.
        this.botHoverTimer = this.ctx.rng.float(0.18, 0.36);
        this.botHover = this.botTimer < 0.35 || this.ctx.rng.next() < 0.45
          ? this.botPlan.col
          : this.ctx.rng.int(0, COLS - 1);
      }
      if (this.botTimer <= 0 && this.botPlan) {
        const plan = this.botPlan;
        this.botPlan = null;
        if (!this.dropDisc(plan.col, plan.kind)) this.autoDrop();
      }
      return;
    }
    for (const [code, kind] of Object.entries(KEYS)) {
      if (this.ctx.input.justPressed(code)) this.select(kind);
    }
    this.shotClock -= dt;
    if (this.shotClock <= 0) {
      this.callouts.show("TOO SLOW!", seat.player.color, { size: 44, life: 0.8 });
      this.ctx.sfx.miss();
      this.autoDrop();
    }
  }

  private startTurn(advance: boolean): void {
    if (advance) this.turnIndex++;
    this.phase = "turn";
    this.selected = "normal";
    this.shotClock = this.overdrive ? SHOT_CLOCK_OVERDRIVE : SHOT_CLOCK;
    const seat = this.currentSeat();
    if (seat.player.kind === "bot") {
      this.botPlan = this.chooseBotMove(seat);
      this.botTimer = this.overdrive ? this.ctx.rng.float(0.3, 0.8) : this.ctx.rng.float(0.4, 1.1);
      this.botHoverTimer = 0;
      this.botHover = -1;
    }
    if (advance) this.ctx.sfx.tick();
  }

  private startOverdrive(): void {
    this.overdrive = true;
    this.callouts.show("OVERDRIVE!", PINK, { size: 64, life: 1.3 });
    this.callouts.show("double points · faster tilts", PAPER, { size: 24, y: 0.42, life: 1.6 });
    this.ctx.sfx.go();
    this.juice.shake(0.35);
    if (this.tiltIn > this.tiltPeriod() && !this.lockedDir) this.tiltIn = this.tiltPeriod();
    if (this.phase === "turn") this.shotClock = Math.min(this.shotClock, SHOT_CLOCK_OVERDRIVE);
  }

  // ---------------------------------------------------------------- dropping

  private autoDrop(): void {
    const legal: number[] = [];
    for (let c = 0; c < COLS; c++) if (topRow(this.grid, c) >= 0) legal.push(c);
    if (legal.length === 0) {
      this.startTilt(false);
      return;
    }
    this.dropDisc(legal[this.ctx.rng.int(0, legal.length - 1)]!, "normal");
  }

  private dropDisc(col: number, kind: DiscKind): boolean {
    const seat = this.currentSeat();
    if (!this.hasPower(seat, kind) || !canDrop(this.grid, col, kind)) return false;
    const row = kind === "anvil" ? ROWS - 1 : topRow(this.grid, col);
    seat.drops++;
    if (kind !== "normal") {
      seat[kind]--;
      seat.powersUsed++;
      this.ctx.sfx.whoosh();
    }
    this.selected = "normal";
    this.phase = "drop";
    this.drop = {
      col,
      row,
      owner: seat.player.id,
      kind,
      y: this.boardY - this.cellSize * 0.6,
      targetY: this.cellCenter(row, col).y,
      vy: kind === "anvil" ? 300 : 120,
    };
    return true;
  }

  private stepDrop(dt: number): void {
    const d = this.drop!;
    d.vy += (d.kind === "anvil" ? 5200 : 3600) * dt;
    d.y = Math.min(d.targetY, d.y + d.vy * dt);

    if (d.kind === "anvil") {
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
      this.pops.push({ r: d.row, c: d.col, t: 0 });
      this.juice.shake(0.1);
      this.juice.burst(x, y + this.cellSize * 0.3, [this.playerColor(d.owner)], { count: 6, speed: 120, life: 0.3, size: 3, angle: -Math.PI / 2, spread: 2.4 });
      this.ctx.sfx.hit();
      this.afterLanding();
    } else if (d.kind === "anvil") {
      anvilSmash(this.grid, d.col, d.owner);
      this.pops.push({ r: ROWS - 1, c: d.col, t: 0 });
      this.juice.shake(0.4);
      this.juice.hitStop(0.04);
      this.juice.burst(x, y + this.cellSize * 0.3, ["#9aa3b5", "#ffffff"], { count: 22, speed: 340, life: 0.5, angle: -Math.PI / 2, spread: 2 });
      this.callouts.show("ANVIL!", this.playerColor(d.owner), { size: 48, life: 0.8 });
      this.afterLanding();
    } else {
      const destroyed = bombBlast(this.grid, d.row, d.col);
      for (const { cell, owner } of destroyed) {
        const p = this.cellCenter(cell.r, cell.c);
        this.juice.burst(p.x, p.y, [this.playerColor(owner), GOLD], { count: 10, speed: 240, life: 0.5 });
      }
      this.juice.burst(x, y, [GOLD, PINK, "#ffffff"], { count: 44, speed: 440, life: 0.7, gravity: 0 });
      this.juice.shake(0.55);
      this.juice.hitStop(0.07);
      this.ctx.sfx.whoosh();
      this.callouts.show("BOOM!", GOLD, { size: 60, life: 0.8 });
      this.startFalls(applyGravity(this.grid), () => this.afterLanding());
    }
  }

  /** The drop (and any blast) has come to rest: count it toward the tilt, then clear what lined up. */
  private afterLanding(): void {
    this.tiltIn--;
    if (this.tiltIn === 1 && !this.lockedDir) {
      this.lockedDir = this.tiltDir();
      this.ctx.sfx.select();
    }
    this.settleStep(1);
  }

  // ---------------------------------------------------------------- clearing & chains

  private settleStep(chain: number): void {
    const lines = findWins(this.grid, this.needed);
    if (lines.length === 0) {
      this.afterSettle();
      return;
    }
    this.phase = "clear";
    this.clearing = { lines, cells: lineCells(lines), chain, t: 0 };
    if (chain >= 2) this.juice.hitStop(0.05);
    this.ctx.sfx.streak(chain);
  }

  private stepClear(dt: number): void {
    const cl = this.clearing!;
    cl.t += dt;
    if (cl.t < CLEAR_FLASH) return;
    this.clearing = null;

    const pts = scoreLines(cl.lines, cl.chain, this.needed);
    const owners = Object.keys(pts);
    for (const id of owners) {
      const seat = this.seatOf(id);
      if (!seat) continue;
      const gained = (pts[id] ?? 0) * this.multiplier();
      seat.score += gained;
      seat.lines += cl.lines.filter((l) => l.winner === id).length;
      seat.bestChain = Math.max(seat.bestChain, cl.chain);
      if (this.inTilt) {
        this.tiltGains.set(id, (this.tiltGains.get(id) ?? 0) + gained);
        this.tiltPoints.set(id, (this.tiltPoints.get(id) ?? 0) + gained);
      }
      this.label(seat, `+${gained}`, seat.player.color, 1.4);
    }
    const first = this.seatOf(owners[0] ?? "");
    const color = owners.length > 1 ? PAPER : first?.player.color ?? PAPER;
    const total = owners.reduce((n, id) => n + (pts[id] ?? 0) * this.multiplier(), 0);
    const who = owners.length > 1 ? "SPLIT LINES!" : this.inTilt ? `${first?.player.name.toUpperCase()} CASHES IN!` : `${first?.player.name.toUpperCase()} LINE!`;
    if (cl.chain >= 2) {
      this.callouts.show(`CHAIN ×${cl.chain}!  +${total}`, color, { size: 60, life: 1 });
      this.juice.shake(0.3 + cl.chain * 0.1);
      this.juice.hitStop(0.05);
    } else {
      this.callouts.show(`${who}  +${total}`, color, { size: 46, life: 0.9 });
      this.juice.shake(0.22);
    }
    this.ctx.sfx.collect();
    for (const cell of cl.cells) {
      const { x, y } = this.cellCenter(cell.r, cell.c);
      const owner = this.grid[cell.r]![cell.c];
      this.juice.burst(x, y, [owner ? this.playerColor(owner) : PAPER, "#ffffff"], { count: 14, speed: 240, gravity: 300, life: 0.6 });
    }
    clearCells(this.grid, cl.cells);
    const next = cl.chain + 1;
    this.startFalls(applyGravity(this.grid), () => this.settleStep(next));
  }

  private startFalls(falls: Fall[], then: () => void): void {
    if (falls.length === 0) {
      then();
      return;
    }
    this.falling = falls.map((f) => ({
      c: f.c,
      r: f.toR,
      y: this.cellCenter(f.fromR, f.c).y,
      targetY: this.cellCenter(f.toR, f.c).y,
      vy: 0,
    }));
    this.afterFall = then;
    this.phase = "fall";
  }

  private stepFall(dt: number): void {
    let busy = false;
    for (const f of this.falling) {
      if (f.y >= f.targetY) continue;
      f.vy += 3400 * dt;
      f.y = Math.min(f.targetY, f.y + f.vy * dt);
      if (f.y >= f.targetY) this.pops.push({ r: f.r, c: f.c, t: 0 });
      busy ||= f.y < f.targetY;
    }
    if (this.tiltAngle !== 0) this.tiltAngle *= Math.pow(0.001, dt);
    if (busy) return;
    this.falling = [];
    this.tiltAngle = 0;
    this.ctx.sfx.hit();
    this.juice.shake(0.08);
    const then = this.afterFall;
    this.afterFall = null;
    then?.();
  }

  /** Nothing left to clear. Decide between a tilt, the final tilt, the end, or the next turn. */
  private afterSettle(): void {
    if (this.afterTiltCheck) {
      this.afterTiltCheck = false;
      this.inTilt = false;
      this.celebrateTilt();
      if (isFull(this.grid)) {
        this.purgeBottomRow();
        return;
      }
    } else if (this.tiltIn <= 0 || isFull(this.grid)) {
      if (this.tiltIn > 0) this.callouts.show("JAMMED! EARLY TILT", GOLD, { size: 40, life: 0.9 });
      this.startTilt(false);
      return;
    }
    if (this.finalStarted) {
      this.finish();
      return;
    }
    if (this.timeLeft <= 0) {
      this.finalStarted = true;
      this.startTilt(true);
      return;
    }
    this.startTurn(true);
  }

  private purgeBottomRow(): void {
    const cells: Pos[] = [];
    for (let c = 0; c < COLS; c++) if (this.grid[ROWS - 1]![c]) cells.push({ r: ROWS - 1, c });
    for (const cell of cells) {
      const { x, y } = this.cellCenter(cell.r, cell.c);
      this.juice.burst(x, y, ["#9aa3b5", PAPER], { count: 8, speed: 200, life: 0.4 });
    }
    clearCells(this.grid, cells);
    this.callouts.show("PURGE!", "#9aa3b5", { size: 40, life: 0.8 });
    this.ctx.sfx.miss();
    this.startFalls(applyGravity(this.grid), () => this.settleStep(1));
  }

  // ---------------------------------------------------------------- the tilt

  private startTilt(final: boolean): void {
    this.tiltDirNow = this.tiltDir();
    this.tiltFinal = final;
    this.tiltCount++;
    this.inTilt = true;
    this.tiltGains.clear();
    this.phase = "tilt";
    this.tiltT = 0;
    this.slides = [];

    // Comeback: whoever is behind gets a bomb back when the board tilts.
    for (const id of this.underdogIds()) {
      const seat = this.seatOf(id);
      if (seat && seat.bomb === 0) {
        seat.bomb = 1;
        this.label(seat, "UNDERDOG · +BOMB", GOLD, 1.8);
      }
    }
    for (const s of this.seats) if (s.vote === this.tiltDirNow) s.tiltsCalled++;

    const arrow = this.tiltDirNow === "left" ? "◀" : "▶";
    if (final) {
      this.callouts.show(`FINAL TILT ${arrow}`, GOLD, { size: 68, life: 1.4 });
      this.juice.slowMo(0.5, 0.55);
      this.ctx.sfx.go();
    } else {
      this.callouts.show(`TILT ${arrow}`, CYAN, { size: 58, life: 0.9 });
      this.ctx.sfx.whoosh();
    }
    this.juice.shake(0.25);
  }

  private stepTilt(dt: number): void {
    const prev = this.tiltT;
    this.tiltT += dt;
    const sign = this.tiltDirNow === "left" ? -1 : 1;
    const lean = 0.17;
    if (this.tiltT < 0.32) {
      this.tiltAngle = sign * lean * easeInOut(this.tiltT / 0.32);
      return;
    }
    if (prev < 0.32) {
      // Board is leaning: let everything slide.
      this.slides = tiltSlide(this.grid, this.tiltDirNow);
      this.ctx.sfx.whoosh();
      this.juice.shake(0.2);
    }
    const slideT = Math.min(1, (this.tiltT - 0.32) / 0.42);
    this.tiltAngle = sign * lean;
    if (slideT < 1) return;
    // Slid: rock back and let the stacks drop.
    this.slides = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const owner = this.grid[r]![c];
        if (owner && (this.tiltDirNow === "left" ? c === 0 : c === COLS - 1)) {
          const { x, y } = this.cellCenter(r, c);
          this.juice.burst(x + sign * this.cellSize * 0.35, y, [this.playerColor(owner)], { count: 4, speed: 140, life: 0.35, size: 3 });
        }
      }
    }
    this.ctx.sfx.hit();
    this.juice.shake(0.3);
    this.afterTiltCheck = true;
    const falls = applyGravity(this.grid);
    if (falls.length === 0) this.tiltAngle = 0;
    this.startFalls(falls, () => this.settleStep(1));
  }

  /** The tilt has fully settled: reward the people who steered it, then rearm the meter. */
  private celebrateTilt(): void {
    for (const s of this.seats) {
      const gain = this.tiltGains.get(s.player.id) ?? 0;
      if (gain > 0 && s.vote === this.tiltDirNow) this.label(s, "CALLED IT!", GOLD, 1.8);
    }
    this.tiltIn = this.tiltPeriod();
    this.lockedDir = null;
    this.lastVote = null;
    this.defaultDir = this.ctx.rng.next() < 0.5 ? "left" : "right";
    for (const s of this.seats) {
      s.vote = null;
      s.voteTimer = this.ctx.rng.float(0.6, 2.4);
    }
  }

  private slideProgress(): number {
    return easeOut(Math.max(0, Math.min(1, (this.tiltT - 0.32) / 0.42)));
  }

  // ---------------------------------------------------------------- voting

  private vote(seat: Seat, dir: TiltDir): void {
    if (this.lockedDir || this.phase === "over") {
      this.ctx.sfx.miss();
      return;
    }
    if (seat.vote === dir) return;
    seat.vote = dir;
    this.lastVote = dir;
    this.ctx.sfx.select();
  }

  private updateBotVotes(dt: number): void {
    if (this.lockedDir || this.tiltIn > 3) return;
    for (const s of this.seats) {
      if (s.player.kind !== "bot" || s.vote !== null) continue;
      s.voteTimer -= dt;
      if (s.voteTimer > 0) continue;
      const me = s.player.id;
      // Bots vote for the side that pays them; they only vote against a rival when it costs them nothing.
      const value = (dir: TiltDir): number => {
        const pts = previewTilt(this.grid, dir, this.needed).points;
        const mine = pts[me] ?? 0;
        const theirs = Math.max(0, ...Object.entries(pts).filter(([id]) => id !== me).map(([, p]) => p));
        return mine * 2 - theirs * 0.25;
      };
      const left = value("left");
      const right = value("right");
      let dir: TiltDir = left === right ? this.ctx.rng.next() < 0.5 ? "left" : "right" : left > right ? "left" : "right";
      // Bots misjudge the tilt now and then, like everyone else.
      if (this.ctx.rng.next() < 0.3) dir = this.ctx.rng.next() < 0.5 ? "left" : "right";
      this.vote(s, dir);
    }
  }

  // ---------------------------------------------------------------- bots

  private chooseBotMove(seat: Seat): { col: number; kind: DiscKind } | null {
    const me = seat.player.id;
    const opps = this.seats.filter((s) => s !== seat).map((s) => s.player.id);
    // The last drop before a tilt is planned around it, most of the time.
    const tiltNext = this.tiltIn === 1 && this.ctx.rng.next() < 0.7 ? this.tiltDir() : null;
    const rng = this.ctx.rng;
    let best: { col: number; kind: DiscKind; value: number } | null = null;
    const plain: { col: number; value: number }[] = [];
    // Bots do not always spot a threat; the crowd makes them sloppier.
    const blockWeight = rng.next() < (opps.length > 1 ? 0.3 : 0.2) ? 0 : 65;

    for (const kind of KINDS) {
      if (!this.hasPower(seat, kind)) continue;
      for (let col = 0; col < COLS; col++) {
        const sim = simulateMove(this.grid, col, kind, me, tiltNext, this.needed);
        if (!sim) continue;
        let value = sim.points[me] ?? 0;
        for (const o of opps) value -= (sim.points[o] ?? 0) * 0.8;
        let threats = 0;
        for (const o of opps) threats += winningColumns(sim.grid, o, this.needed).length;
        value -= Math.min(2, threats) * blockWeight;
        value += winningColumns(sim.grid, me, this.needed).length * 30;
        value += (3 - Math.abs(col - 3)) * 4;
        for (const d of sim.destroyed) value += d.owner === me ? -12 : 8;
        if (kind === "bomb") value -= this.overdrive ? 15 : 70;
        if (kind === "anvil") value -= this.overdrive ? 25 : 90;
        value += rng.float(0, 24);
        if (kind === "normal") plain.push({ col, value });
        if (!best || value > best.value) best = { col, kind, value };
      }
    }
    if (!best) return null;
    // Human-like slips: now and then a decent-looking plain drop instead of the best one.
    if (rng.next() < 0.12 && plain.length > 1) {
      const ok = plain.filter((p) => p.value > best!.value - 120);
      const pick = ok[rng.int(0, ok.length - 1)];
      if (pick) return { col: pick.col, kind: "normal" };
    }
    return { col: best.col, kind: best.kind };
  }

  // ---------------------------------------------------------------- finish

  private finish(): void {
    this.phase = "over";
    this.overTimer = 2.6;
    const top = Math.max(...this.seats.map((s) => s.score));
    const winners = this.seats.filter((s) => s.score === top);
    if (winners.length === 1) {
      const w = winners[0]!;
      this.callouts.show(`${w.player.name.toUpperCase()} WINS!`, w.player.color, { size: 64, life: 2.4 });
      this.juice.burst(this.ctx.width / 2, this.ctx.height * 0.32, [w.player.color, "#ffffff", GOLD], { count: 60, speed: 420, life: 1, gravity: 300 });
    } else {
      this.callouts.show("DEAD HEAT!", PAPER, { size: 64, life: 2.4 });
    }
    this.ctx.sfx.win();
    this.juice.shake(0.3);
    let record = false;
    for (const s of this.seats) {
      if (s.player.kind === "human" && s.score > 0 && saveBest(connectFour.id, s.score, BEST_VERSION)) {
        this.label(s, "NEW RECORD!", GOLD, 2.6);
        record = true;
      }
    }
    if (record) this.callouts.show("NEW RECORD!", GOLD, { size: 40, y: 0.45, life: 2.4 });
  }

  // ---------------------------------------------------------------- input

  private select(kind: DiscKind): void {
    const seat = this.currentSeat();
    if (!this.hasPower(seat, kind)) {
      this.ctx.sfx.miss();
      return;
    }
    this.selected = this.selected === kind ? "normal" : kind;
    this.ctx.sfx.select();
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
    const p = this.toLogical(e);
    // Seat buttons work for every human at any time: steering the tilt is the waiting game.
    for (let i = 0; i < this.seats.length; i++) {
      const seat = this.seats[i]!;
      const box = this.seatBoxes[i]!;
      if (seat.player.kind !== "human") continue;
      if (hit(p, box.left) || hit(p, box.right)) {
        e.preventDefault();
        this.vote(seat, hit(p, box.left) ? "left" : "right");
        return;
      }
    }
    if (this.busy()) return;
    const seat = this.currentSeat();
    if (seat.player.kind !== "human") return;

    const btn = this.buttons.find((b) => hit(p, b));
    if (btn) {
      e.preventDefault();
      this.select(btn.kind);
      return;
    }
    const col = this.colFromX(p.x);
    if (p.y < this.boardY - this.cellSize || p.y > this.boardY + this.cellSize * ROWS + 10) return;
    if (!canDrop(this.grid, col, this.selected)) return;
    e.preventDefault();
    this.pointers.set(e.pointerId, col);
    this.hoverCol = col;
    this.dropDisc(col, this.selected);
  };

  private readonly onMove = (e: PointerEvent): void => {
    const p = this.toLogical(e);
    const col = this.colFromX(p.x);
    this.pointers.set(e.pointerId, col);
    this.hoverCol = col;
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (e.pointerType === "touch" && this.pointers.size === 0) this.hoverCol = -1;
  };

  // ---------------------------------------------------------------- render

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    if (this.overdrive) this.drawOverdriveGlow(g);
    this.juice.begin(g);

    this.drawBoard(g);
    this.drawPicker(g);
    this.drawTiltPanel(g);
    this.drawHeader(g);
    this.drawSeats(g);

    this.juice.end(g);
    this.callouts.draw(g, width, height);
  }

  private drawOverdriveGlow(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    const pulse = 0.14 + Math.sin(this.time * 5) * 0.05;
    const grad = g.createRadialGradient(width / 2, height / 2, height * 0.35, width / 2, height / 2, height * 0.9);
    grad.addColorStop(0, "rgba(255,61,122,0)");
    grad.addColorStop(1, `rgba(255,61,122,${pulse.toFixed(3)})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, width, height);
  }

  private drawHeader(g: CanvasRenderingContext2D): void {
    const { width } = this.ctx;
    const t = this.timeLeft / MATCH_SECONDS;
    const barX = 40;
    const barW = width - 80;
    g.fillStyle = "rgba(7,11,20,0.55)";
    g.fillRect(barX, 12, barW, 8);
    g.fillStyle = this.overdrive ? PINK : CYAN;
    g.fillRect(barX, 12, barW * t, 8);
    // Overdrive marker.
    g.fillStyle = "rgba(244,247,251,0.5)";
    g.fillRect(barX + barW * (OVERDRIVE_AT / MATCH_SECONDS) - 1, 8, 2, 16);

    g.textAlign = "left";
    g.textBaseline = "top";
    g.font = "700 22px Bebas Neue, Impact, sans-serif";
    g.fillStyle = this.overdrive ? PINK : PAPER;
    g.fillText(this.finalStarted ? "FINAL" : `${Math.ceil(this.timeLeft)}s`, barX, 24);
    if (this.overdrive && !this.finalStarted) {
      g.fillStyle = PINK;
      g.globalAlpha = 0.7 + Math.sin(this.time * 9) * 0.3;
      g.fillText("OVERDRIVE ×2", barX + 56, 24);
      g.globalAlpha = 1;
    }

    g.textAlign = "right";
    g.fillStyle = "rgba(244,247,251,0.45)";
    g.font = "600 13px Outfit, sans-serif";
    g.fillText(`${this.needed === 3 ? "THREE" : "FOUR"} IN A ROW SCORES`, width - barX, 26);
  }

  private drawPicker(g: CanvasRenderingContext2D): void {
    if (this.phase === "over") return;
    const seat = this.currentSeat();
    const human = seat.player.kind === "human";
    const b0 = this.buttons[0]!;

    g.save();
    g.fillStyle = "rgba(244,247,251,0.5)";
    g.font = "600 13px Outfit, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "bottom";
    g.fillText(human ? "DROP WHAT?" : `${seat.player.name.toUpperCase()} HAS`, b0.x, b0.y - 6);

    this.buttons.forEach((b, i) => {
      const left = b.kind === "normal" ? -1 : seat[b.kind];
      const usable = left !== 0;
      const active = human && this.selected === b.kind;
      g.globalAlpha = usable ? 1 : 0.3;
      g.beginPath();
      g.roundRect(b.x, b.y, b.w, b.h, 12);
      g.fillStyle = active ? seat.player.color : "rgba(13,31,74,0.9)";
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = active ? "#ffffff" : "rgba(244,247,251,0.18)";
      g.stroke();

      const iy = b.y + b.h / 2;
      this.drawPiece(g, b.x + 28, iy, 15, b.kind, active ? "#ffffff" : seat.player.color);
      g.fillStyle = active ? INK : PAPER;
      g.font = "700 22px Bebas Neue, Impact, sans-serif";
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillText(KIND_LABEL[b.kind], b.x + 52, iy - 7);
      g.font = "600 12px Outfit, sans-serif";
      g.globalAlpha *= 0.75;
      g.fillText(left < 0 ? `${i + 1} · unlimited` : `${i + 1} · ${left} left`, b.x + 52, iy + 13);
    });
    g.restore();
  }

  private drawTiltPanel(g: CanvasRenderingContext2D): void {
    const { x, y, w } = this.tiltPanel;
    const cx = x + w / 2;
    const dir = this.tiltDir();
    const locked = this.lockedDir !== null;
    const soon = this.tiltIn <= 2 && !this.inTilt;

    g.save();
    g.textAlign = "center";
    g.textBaseline = "top";
    g.fillStyle = "rgba(244,247,251,0.5)";
    g.font = "600 13px Outfit, sans-serif";
    g.fillText(this.finalStarted ? "FINAL TILT" : "NEXT TILT", cx, y);

    // Count-down number.
    const n = Math.max(0, this.tiltIn);
    g.fillStyle = soon ? GOLD : PAPER;
    g.font = "700 64px Bebas Neue, Impact, sans-serif";
    const bob = soon ? 1 + Math.sin(this.time * 10) * 0.05 : 1;
    g.save();
    g.translate(cx, y + 50);
    g.scale(bob, bob);
    g.fillText(this.inTilt ? "!" : String(n), 0, -32);
    g.restore();
    g.fillStyle = "rgba(244,247,251,0.6)";
    g.font = "600 13px Outfit, sans-serif";
    g.fillText(this.inTilt ? "tilting" : n === 1 ? "drop to go" : "drops to go", cx, y + 82);

    // The arrow: which way the board will tilt.
    const ay = y + 150;
    const s = 34;
    const sign = dir === "left" ? -1 : 1;
    const pulse = locked ? 1 + Math.sin(this.time * 8) * 0.06 : 1;
    g.save();
    g.translate(cx, ay);
    g.scale(pulse * sign, pulse);
    g.shadowColor = locked ? GOLD : CYAN;
    g.shadowBlur = locked ? 24 : 12;
    g.fillStyle = locked ? GOLD : CYAN;
    g.beginPath();
    g.moveTo(s, 0);
    g.lineTo(0, -s * 0.8);
    g.lineTo(0, -s * 0.35);
    g.lineTo(-s, -s * 0.35);
    g.lineTo(-s, s * 0.35);
    g.lineTo(0, s * 0.35);
    g.lineTo(0, s * 0.8);
    g.closePath();
    g.fill();
    g.restore();

    g.fillStyle = locked ? GOLD : "rgba(244,247,251,0.6)";
    g.font = "700 16px Bebas Neue, Impact, sans-serif";
    g.fillText(locked ? "LOCKED" : "VOTE ON YOUR SEAT", cx, ay + 36);

    // Votes as coloured dots on the left and right of the arrow.
    const dogs = this.underdogIds();
    let li = 0;
    let ri = 0;
    for (const seat of this.seats) {
      if (!seat.vote) continue;
      const isLeft = seat.vote === "left";
      const i = isLeft ? li++ : ri++;
      const vx = isLeft ? cx - 62 : cx + 62;
      const vy = ay - 24 + i * 18;
      const weight = dogs.has(seat.player.id) ? 2 : 1;
      g.beginPath();
      g.arc(vx, vy, weight === 2 ? 8 : 6, 0, Math.PI * 2);
      g.fillStyle = seat.player.color;
      g.fill();
      if (weight === 2) {
        g.fillStyle = INK;
        g.font = "700 10px Outfit, sans-serif";
        g.textBaseline = "middle";
        g.fillText("2", vx, vy + 0.5);
        g.textBaseline = "top";
      }
    }

    // Who is steering and the standing rule.
    const underdogNames = this.seats.filter((s) => dogs.has(s.player.id)).map((s) => s.player.name);
    g.fillStyle = "rgba(244,247,251,0.45)";
    g.font = "600 12px Outfit, sans-serif";
    g.textBaseline = "top";
    const ly = ay + 62;
    if (underdogNames.length > 0 && underdogNames.length < this.seats.length) {
      g.fillStyle = GOLD;
      g.fillText("UNDERDOG ×2 VOTE", cx, ly);
      g.fillStyle = "rgba(244,247,251,0.6)";
      g.fillText(underdogNames.join(", ").slice(0, 22), cx, ly + 16);
    }
    g.fillStyle = "rgba(244,247,251,0.35)";
    g.fillText("last place also", cx, this.tiltPanel.y + this.tiltPanel.h - 34);
    g.fillText("gets a bomb back", cx, this.tiltPanel.y + this.tiltPanel.h - 18);
    g.restore();
  }

  private drawSeats(g: CanvasRenderingContext2D): void {
    const dogs = this.underdogIds();
    const current = this.phase === "over" ? null : this.currentSeat();
    for (let i = 0; i < this.seats.length; i++) {
      const seat = this.seats[i]!;
      const box = this.seatBoxes[i]!;
      const p = seat.player;
      const active = seat === current;
      const compact = box.w < 230;

      g.save();
      g.beginPath();
      g.roundRect(box.x, box.y, box.w, box.h, 14);
      g.fillStyle = active ? "rgba(13,31,74,0.95)" : "rgba(13,31,74,0.55)";
      g.fill();
      g.lineWidth = active ? 3 : 1.5;
      g.strokeStyle = active ? p.color : "rgba(244,247,251,0.14)";
      if (active) {
        g.shadowColor = p.color;
        g.shadowBlur = 16;
      }
      g.stroke();
      g.shadowBlur = 0;

      // Name, powers, score.
      g.textAlign = "left";
      g.textBaseline = "top";
      g.fillStyle = p.color;
      g.font = `700 ${compact ? 20 : 24}px Bebas Neue, Impact, sans-serif`;
      g.fillText(p.name.toUpperCase().slice(0, 12), box.x + 14, box.y + 10);

      // Whose turn, and the shot clock for humans.
      if (active) {
        const max = this.overdrive ? SHOT_CLOCK_OVERDRIVE : SHOT_CLOCK;
        const frac = this.phase === "turn" ? Math.max(0, this.shotClock / max) : 1;
        const human = p.kind === "human";
        g.fillStyle = human && frac < 0.3 ? PINK : p.color;
        g.font = "700 14px Bebas Neue, Impact, sans-serif";
        const tx = box.x + 64;
        g.fillText(human ? (this.phase === "turn" ? `YOUR TURN · ${Math.ceil(this.shotClock)}` : "DROPPING") : "THINKING…", tx, box.y + 42);
        if (human) {
          const bw = box.w - 64 - 14 - (compact ? 44 : 60);
          g.fillStyle = "rgba(7,11,20,0.6)";
          g.fillRect(tx, box.y + 60, bw, 4);
          g.fillStyle = frac < 0.3 ? PINK : p.color;
          g.fillRect(tx, box.y + 60, bw * frac, 4);
        }
      } else if (dogs.has(p.id) && dogs.size < this.seats.length) {
        g.fillStyle = GOLD;
        g.font = "700 11px Outfit, sans-serif";
        g.fillText("UNDERDOG", box.x + 64, box.y + 42);
      }
      g.save();
      g.globalAlpha = seat.bomb > 0 ? 1 : 0.2;
      this.drawPiece(g, box.x + 22, box.y + 48, 8, "bomb", p.color);
      g.globalAlpha = seat.anvil > 0 ? 1 : 0.2;
      this.drawPiece(g, box.x + 46, box.y + 48, 8, "anvil", p.color);
      g.restore();
      g.textAlign = "right";
      g.fillStyle = PAPER;
      g.font = `700 ${compact ? 30 : 36}px Bebas Neue, Impact, sans-serif`;
      g.fillText(String(seat.score), box.x + box.w - 14, box.y + 6);

      // Tilt vote buttons.
      const locked = this.lockedDir !== null;
      for (const [dir, r] of [["left", box.left], ["right", box.right]] as const) {
        const voted = seat.vote === dir;
        g.globalAlpha = locked && !voted ? 0.35 : 1;
        g.beginPath();
        g.roundRect(r.x, r.y, r.w, r.h, 10);
        g.fillStyle = voted ? p.color : "rgba(7,11,20,0.6)";
        g.fill();
        g.lineWidth = 1.5;
        g.strokeStyle = voted ? "#ffffff" : "rgba(244,247,251,0.2)";
        g.stroke();
        g.fillStyle = voted ? INK : "rgba(244,247,251,0.8)";
        g.font = `700 ${compact ? 15 : 17}px Bebas Neue, Impact, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(dir === "left" ? "◀ TILT" : "TILT ▶", r.x + r.w / 2, r.y + r.h / 2 + 1);
        g.globalAlpha = 1;
      }

      if (seat.label) {
        const t = 1 - seat.label.life / seat.label.maxLife;
        g.globalAlpha = Math.min(1, seat.label.life / 0.4);
        g.fillStyle = seat.label.color;
        g.font = "700 22px Bebas Neue, Impact, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "bottom";
        g.lineWidth = 5;
        g.strokeStyle = "rgba(7,11,20,0.8)";
        const ly = box.y - 4 - t * 22;
        g.strokeText(seat.label.text, box.x + box.w / 2, ly);
        g.fillText(seat.label.text, box.x + box.w / 2, ly);
      }
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
        g.strokeStyle = GOLD;
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
    const bw = cs * COLS;
    const bh = cs * ROWS;

    g.save();
    if (this.tiltAngle !== 0) {
      g.translate(bx + bw / 2, by + bh / 2);
      g.rotate(this.tiltAngle);
      g.translate(-(bx + bw / 2), -(by + bh / 2));
    }

    g.fillStyle = "#0d1f4a";
    const pad = 8;
    g.beginPath();
    g.roundRect(bx - pad, by - pad, bw + pad * 2, bh + pad * 2, 14);
    g.fill();
    if (this.inTilt) {
      g.lineWidth = 3;
      g.strokeStyle = this.tiltFinal ? GOLD : CYAN;
      g.stroke();
    }

    const slideT = this.slideProgress();
    const now = this.time;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const { x: cx, y: cy } = this.cellCenter(r, c);
        g.beginPath();
        g.arc(cx, cy, radius, 0, Math.PI * 2);
        g.fillStyle = INK;
        g.fill();

        const owner = this.grid[r]![c];
        if (!owner) continue;
        const fall = this.falling.find((f) => f.r === r && f.c === c);
        const slide = this.slides.length > 0 ? this.slides.find((s) => s.r === r && s.toC === c) : undefined;
        const y = fall ? fall.y : cy;
        const x = slide ? this.cellCenter(r, slide.fromC).x + (cx - this.cellCenter(r, slide.fromC).x) * slideT : cx;
        const col = this.playerColor(owner);
        const clearing = this.clearing?.cells.some((wc) => wc.r === r && wc.c === c) ?? false;
        const pop = this.pops.find((p) => p.r === r && p.c === c);

        g.save();
        if (pop) {
          const k = 0.22 * (1 - pop.t / 0.3);
          g.translate(x, y + radius);
          g.scale(1 + k, 1 - k);
          g.translate(-x, -(y + radius));
        }
        if (clearing) {
          const t = this.clearing!.t / CLEAR_FLASH;
          const flash = 0.5 + 0.5 * Math.sin(now * 40);
          g.shadowColor = "#ffffff";
          g.shadowBlur = 24;
          const s = 1 + 0.18 * Math.sin(t * Math.PI);
          g.translate(x, y);
          g.scale(s, s);
          g.translate(-x, -y);
          this.drawPiece(g, x, y, radius, "normal", col);
          g.globalAlpha = 0.65 * flash;
          g.beginPath();
          g.arc(x, y, radius, 0, Math.PI * 2);
          g.fillStyle = "#ffffff";
          g.fill();
        } else {
          this.drawPiece(g, x, y, radius, "normal", col);
        }
        g.restore();
      }
    }

    if (this.drop) {
      const col = this.playerColor(this.drop.owner);
      const cx = bx + (this.drop.col + 0.5) * cs;
      g.save();
      g.shadowColor = col;
      g.shadowBlur = 14;
      // Stretch a little while falling fast.
      const stretch = Math.min(0.2, this.drop.vy / 6000);
      g.translate(cx, this.drop.y);
      g.scale(1 - stretch * 0.5, 1 + stretch);
      g.translate(-cx, -this.drop.y);
      this.drawPiece(g, cx, this.drop.y, radius, this.drop.kind, col);
      g.restore();
    }

    this.drawHover(g, radius);
    g.restore();
  }

  private drawHover(g: CanvasRenderingContext2D, radius: number): void {
    if (this.phase !== "turn") return;
    const { boardX: bx, boardY: by, cellSize: cs } = this;
    const seat = this.currentSeat();
    const bot = seat.player.kind === "bot";
    const col = bot ? this.botHover : this.hoverCol;
    const kind = bot ? this.botPlan?.kind ?? "normal" : this.selected;
    if (col < 0 || !canDrop(this.grid, col, kind)) return;
    const color = seat.player.color;

    const cx = bx + (col + 0.5) * cs;
    g.save();
    g.globalAlpha = bot ? 0.4 : 0.6;
    g.shadowColor = color;
    g.shadowBlur = 12;
    this.drawPiece(g, cx, by - cs * 0.5, radius * 0.85, kind, color);
    g.restore();

    g.save();
    if (kind === "bomb") {
      const row = topRow(this.grid, col);
      g.globalAlpha = 0.2 + Math.sin(this.time * 8) * 0.05;
      g.fillStyle = GOLD;
      const c0 = Math.max(0, col - 1);
      const c1 = Math.min(COLS - 1, col + 1);
      const r0 = Math.max(0, row - 1);
      const r1 = Math.min(ROWS - 1, row + 1);
      g.fillRect(bx + c0 * cs, by + r0 * cs, (c1 - c0 + 1) * cs, (r1 - r0 + 1) * cs);
    } else {
      g.globalAlpha = kind === "anvil" ? 0.2 : 0.08;
      g.fillStyle = kind === "anvil" ? PINK : color;
      g.fillRect(bx + col * cs, by, cs, cs * ROWS);
    }
    // Landing spot + a hint when this drop makes a line.
    if (!bot && kind === "normal") {
      const row = topRow(this.grid, col);
      const sim = simulateMove(this.grid, col, "normal", seat.player.id, null, this.needed);
      const pts = sim?.points[seat.player.id] ?? 0;
      g.globalAlpha = 0.35;
      g.strokeStyle = pts > 0 ? GOLD : color;
      g.lineWidth = 3;
      g.setLineDash([6, 6]);
      g.beginPath();
      g.arc(bx + (col + 0.5) * cs, by + (row + 0.5) * cs, radius, 0, Math.PI * 2);
      g.stroke();
      if (pts > 0) {
        g.setLineDash([]);
        g.globalAlpha = 0.9;
        g.fillStyle = GOLD;
        g.font = "700 18px Bebas Neue, Impact, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(`+${pts * this.multiplier()}`, bx + (col + 0.5) * cs, by + (row + 0.5) * cs);
      }
    }
    g.restore();
  }

  // ---------------------------------------------------------------- results

  isFinished(): boolean {
    return this.phase === "over" && this.overTimer <= 0;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({ playerId: s.player.id, score: s.score }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const s of this.seats) {
      out.push({ playerId: s.player.id, label: "Lines", value: String(s.lines) });
      if (s.bestChain >= 2) out.push({ playerId: s.player.id, label: "Best chain", value: `×${s.bestChain}` });
      const fromTilts = this.tiltPoints.get(s.player.id) ?? 0;
      if (fromTilts > 0) out.push({ playerId: s.player.id, label: "From tilts", value: String(fromTilts) });
      if (s.powersUsed > 0) out.push({ playerId: s.player.id, label: "Powers used", value: String(s.powersUsed) });
    }
    return out;
  }

  destroy(): void {
    const c = this.ctx.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
  }
}

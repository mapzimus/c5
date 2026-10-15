import { fillArena } from "../../core/draw";
import { PLAYER_BINDS as BINDS } from "../../core/input";
import { Callouts, Juice, loadBest, saveBest } from "../../fx/juice";
import type {
  GameContext,
  GameDefinition,
  GameInstance,
  GameStat,
  Player,
} from "../../core/types";
import {
  BOT_PROFILES,
  Bag,
  COLS,
  GARBAGE,
  HAUNT_COOLDOWN,
  OVERDRIVE_AT,
  PANIC_HEIGHT,
  PANIC_PROFILE,
  POWER,
  POWERS,
  POWER_LABEL,
  POWER_TIME,
  ROTATIONS,
  ROWS,
  STAKES_HEIGHT,
  TIME_LIMIT,
  addGarbage,
  attackFor,
  cellKind,
  clearLines,
  collides,
  dropY,
  emptyBoard,
  flipDir,
  garbageHoles,
  gravityFor,
  isHighStakes,
  isOverdrive,
  isUnderdog,
  lockPiece,
  nextChain,
  pickHauntTarget,
  pickPlacement,
  pieceCells,
  powerCellFor,
  powersInFullRows,
  rankPlacements,
  spawnPiece,
  stackHeight,
  tideInterval,
  tryRotate,
  type Board,
  type BotProfile,
  type Piece,
  type Placement,
  type PowerKind,
} from "./logic";

export const blockBrawl: GameDefinition = {
  id: "block-brawl",
  name: "Block Brawl",
  tagline: "Stack high, hit hard. Haunt them when you're out.",
  description:
    "Everyone drops the same blocks into their own well at once. Clear 2+ lines to dump garbage on a rival; " +
    "chain clears on back-to-back drops for extra rows. Stack past the glowing STAKES line and every clear " +
    "hits twice as hard, but you're one bad drop from the top. Glowing power cells hit every rival with INK, " +
    "RUSH or FLIP. At 50s the TIDE rises for everyone. Topped out? You're a GHOST: tap a rival to drop " +
    "garbage on them. Last one standing wins.",
  durationMs: 0,
  controls: "In your lane: tap = rotate, drag = move, swipe down = drop. Out? Tap a rival's name to haunt them.",
  create: (ctx) => new BlockBrawl(ctx),
};

const HEADER = 56;
/** Seconds a grounded piece waits before it locks. */
const LOCK_DELAY = 0.3;
const POWER_COLOR: Record<PowerKind, string> = { ink: "#9AA3FF", rush: "#FF9A3E", flip: "#FF4DE1" };
const COLORS = ["#3EE0FF", "#FFD23E", "#B05CFF", "#4CE36B", "#FF4D5E", "#3E7BFF", "#FF9A3E", "#5A6378"];
const STAKES_COLOR = "#FFD23E";
const GHOST_COLOR = "#B9C7FF";
const BEST_KEY = "v2-sent";
const TAUNTS = ["EAT THAT", "TOO EASY", "NOT TODAY", "GOTCHA", "DIG OUT OF THAT", "BURIED!"];
const FONT = "Bebas Neue, Impact, sans-serif";

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  anchorX: number;
  startT: number;
  moved: boolean;
  dropped: boolean;
}

interface Label {
  text: string;
  color: string;
  life: number;
  maxLife: number;
  size: number;
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
  lockTimer: number;
  alive: boolean;
  deathTime: number;
  lines: number;
  sent: number;
  pendingGarbage: number;
  drag: Drag | null;
  botTarget: Placement | null;
  botTimer: number;
  profile: BotProfile;
  /** Pieces dealt so far (index into the shared sequence). */
  dealt: number;
  /** Glowing cell index of the current piece, or -1. */
  power: number;
  chain: number;
  bestChain: number;
  powersFired: number;
  effects: Record<PowerKind, number>;
  inkBlots: { x: number; y: number; r: number }[];
  /** Stack currently reaches the stakes line (display only). */
  stakes: boolean;
  underdog: boolean;
  label: Label | null;
  flash: number;
  tideFlash: number;
  trail: { cells: [number, number][]; type: number; life: number } | null;
  /** Ghost console: seconds until the next haunt is ready. */
  hauntTimer: number;
  haunts: number;
  /** Ghost console: keyboard-selected rival (index into living rivals). */
  ghostSel: number;
  best: number;
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
  private overdrive = false;
  private tideTimer = 0;

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
        lockTimer: 0,
        alive: true,
        deathTime: 0,
        lines: 0,
        sent: 0,
        pendingGarbage: 0,
        drag: null,
        botTarget: null,
        botTimer: 0,
        profile: BOT_PROFILES[i % BOT_PROFILES.length]!,
        dealt: 0,
        power: -1,
        chain: 0,
        bestChain: 0,
        powersFired: 0,
        effects: { ink: 0, rush: 0, flip: 0 },
        inkBlots: [],
        stakes: false,
        underdog: false,
        label: null,
        flash: 0,
        tideFlash: 0,
        trail: null,
        hauntTimer: HAUNT_COOLDOWN * 0.6,
        haunts: 0,
        ghostSel: 0,
        best: player.kind === "human" ? loadBest("block-brawl", BEST_KEY) : 0,
      };
      return well;
    });
    // Bots get a shuffled temperament so two bots never mirror each other.
    const profiles = [...BOT_PROFILES];
    for (const w of this.wells) {
      if (w.player.kind !== "bot") continue;
      if (profiles.length === 0) profiles.push(...BOT_PROFILES);
      w.profile = profiles.splice(ctx.rng.int(0, profiles.length - 1), 1)[0]!;
    }
    for (const w of this.wells) this.spawn(w);

    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onCancel);
  }

  private alive(): Well[] {
    return this.wells.filter((w) => w.alive);
  }

  private rivals(of: Well): Well[] {
    return this.wells.filter((t) => t !== of && t.alive);
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.clock += realDt;
    for (const w of this.wells) {
      if (w.label) {
        w.label.life -= realDt;
        if (w.label.life <= 0) w.label = null;
      }
      w.flash = Math.max(0, w.flash - realDt);
      w.tideFlash = Math.max(0, w.tideFlash - realDt);
      if (w.trail) {
        w.trail.life -= realDt;
        if (w.trail.life <= 0) w.trail = null;
      }
    }

    if (this.finished) {
      this.finishTimer -= realDt;
      return;
    }
    this.time += dt;

    if (!this.overdrive && isOverdrive(this.time)) {
      this.overdrive = true;
      this.tideTimer = tideInterval(this.time);
      this.callouts.show("OVERDRIVE! THE TIDE RISES", "#FF3D7A", { size: 60, life: 1.6, y: 0.4 });
      this.juice.shake(0.5);
      this.ctx.sfx.streak(3);
    }
    if (this.overdrive) {
      this.tideTimer -= dt;
      if (this.tideTimer <= 0) {
        this.tideTimer = tideInterval(this.time);
        this.tide();
      }
    }

    for (const w of this.wells) {
      for (const k of POWERS) w.effects[k] = Math.max(0, w.effects[k] - dt);
      if (!w.alive) {
        this.ghostTick(w, dt);
        continue;
      }
      const rivalLines = this.rivals(w).map((r) => r.lines);
      w.underdog = isUnderdog(w.lines, rivalLines);
      if (!w.piece) continue;
      if (w.player.kind === "bot") this.botTick(w, dt);
      else this.keyboard(w);
      if (!w.alive || !w.piece) continue;

      const softDrop = w.player.kind === "human" && this.ctx.input.isDown(bindDown(w.player.slot));
      w.fallTimer += softDrop ? dt * 8 : dt;
      const interval = gravityFor(this.time, w.effects.rush > 0);
      while (w.fallTimer >= interval && w.piece) {
        w.fallTimer -= interval;
        const down: Piece = { ...w.piece, y: w.piece.y + 1 };
        if (collides(w.board, down)) {
          w.fallTimer = 0;
          break;
        }
        w.piece = down;
      }
      // Grounded pieces get a short lock delay so a last slide or turn still counts.
      if (w.piece && collides(w.board, { ...w.piece, y: w.piece.y + 1 })) {
        w.lockTimer += dt;
        if (w.lockTimer >= LOCK_DELAY || softDrop) this.lock(w);
      } else {
        w.lockTimer = 0;
      }
    }

    this.checkEnd();
  }

  /** Overdrive: one garbage row pushes into every living well at once. */
  private tide(): void {
    this.juice.shake(0.2);
    this.ctx.sfx.hit();
    for (const w of this.alive()) {
      const over = addGarbage(w.board, [this.ctx.rng.int(0, COLS - 1)]);
      w.tideFlash = 0.5;
      if (over) {
        this.knockOut(w, "SWEPT AWAY");
        continue;
      }
      if (w.piece && collides(w.board, w.piece)) {
        const up = { ...w.piece, y: w.piece.y - 1 };
        if (collides(w.board, up)) this.lock(w);
        else w.piece = up;
      }
      this.afterGarbage(w);
    }
  }

  private checkEnd(): void {
    const alive = this.alive();
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
    this.finishTimer = 2.2;
    if (winners.length === 1) {
      const w = winners[0]!;
      this.callouts.show(`${w.player.name} WINS!`, w.player.color, { size: 64 });
      this.juice.burst(w.wellX + (w.cell * COLS) / 2, w.wellY + w.cell * 8, [w.player.color, STAKES_COLOR, "#ffffff"], {
        count: 70,
        speed: 360,
        gravity: 300,
        life: 1,
      });
      this.ctx.sfx.win();
    } else if (winners.length > 1) {
      this.callouts.show("TIME! TIE!", "#F4F7FB", { size: 64 });
      this.ctx.sfx.win();
    } else {
      this.callouts.show("GAME OVER", "#FF3D7A", { size: 64 });
      this.ctx.sfx.miss();
    }
    for (const w of this.wells) {
      if (w.player.kind !== "human" || w.sent <= 0) continue;
      if (saveBest("block-brawl", w.sent, BEST_KEY)) {
        w.best = w.sent;
        this.callouts.show(`NEW RECORD: ${w.player.name} SENT ${w.sent}`, STAKES_COLOR, { size: 34, life: 2.2, y: 0.62 });
      }
    }
  }

  private spawn(w: Well): void {
    if (w.pendingGarbage > 0) {
      const holes = garbageHoles(w.pendingGarbage, () => this.ctx.rng.next());
      w.pendingGarbage = 0;
      const over = addGarbage(w.board, holes);
      this.ctx.sfx.hit();
      this.juice.shake(0.25);
      if (over) {
        this.knockOut(w, "BURIED");
        return;
      }
      this.afterGarbage(w);
    }
    const p = spawnPiece(w.bag.next());
    w.power = powerCellFor(this.seed, w.dealt++);
    w.fallTimer = 0;
    w.lockTimer = 0;
    w.botTarget = null;
    if (collides(w.board, p)) {
      w.piece = null;
      this.knockOut(w, "TOPPED OUT");
      return;
    }
    w.piece = p;
  }

  /** Near-miss feedback after garbage lands without topping out. */
  private afterGarbage(w: Well): void {
    const h = stackHeight(w.board);
    w.stakes = h >= STAKES_HEIGHT;
    if (h >= ROWS - 2 && w.label?.text !== "SO CLOSE!") this.say(w, "SO CLOSE!", "#FF3D7A", 30, 0.8);
  }

  private say(w: Well, text: string, color: string, size = 28, life = 0.9): void {
    w.label = { text, color, life, maxLife: life, size };
  }

  private knockOut(w: Well, how: string): void {
    w.alive = false;
    w.piece = null;
    w.drag = null;
    w.deathTime = this.time;
    w.stakes = false;
    w.underdog = false;
    w.hauntTimer = HAUNT_COOLDOWN * 0.5;
    w.ghostSel = 0;
    this.juice.shake(0.45);
    this.juice.hitStop(0.1);
    this.juice.burst(w.wellX + (w.cell * COLS) / 2, w.wellY + w.cell * 4, [w.player.color, "#FF3D7A", "#ffffff"], {
      count: 48,
      speed: 340,
      gravity: 500,
      life: 0.8,
    });
    this.ctx.sfx.miss();
    const left = this.alive().length;
    const tail = left > 1 ? " NOW A GHOST" : "";
    this.callouts.show(`${w.player.name} ${how}!${tail}`, "#FF3D7A", { size: 44, life: 1.1 });
    w.label = null;
  }

  private lock(w: Well): void {
    if (!w.piece) return;
    lockPiece(w.board, w.piece, w.power);
    const height = stackHeight(w.board);
    const stakes = isHighStakes(height);
    const powers = powersInFullRows(w.board);
    const cleared = clearLines(w.board);
    const prevChain = w.chain;
    w.chain = nextChain(w.chain, cleared);
    w.bestChain = Math.max(w.bestChain, w.chain);
    w.stakes = stackHeight(w.board) >= STAKES_HEIGHT;
    if (cleared === 0 && prevChain >= 3) this.say(w, "CHAIN BROKE", "rgba(244,247,251,0.75)", 26, 0.7);
    if (cleared > 0) {
      w.lines += cleared;
      w.flash = cleared >= 3 || stakes ? 0.3 : 0.15;
      if (cleared >= 3) this.juice.hitStop(cleared >= 4 ? 0.08 : 0.04);
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
        this.juice.burst(w.wellX + (w.cell * COLS) / 2, w.wellY + w.cell * 6, [w.player.color, STAKES_COLOR, "#ffffff"], {
          count: Math.min(60, 8 * c),
          speed: 220 + 40 * c,
          gravity: 300,
          life: 0.6,
        });
      }
      if (height >= ROWS - 3) this.say(w, "CLUTCH!", STAKES_COLOR, 32, 0.9);
      const send = attackFor(cleared, w.chain, stakes, w.underdog ? 1 : 0);
      if (send > 0) this.sendGarbage(w, send, cleared, stakes);
      for (let i = 0; i < powers; i++) this.firePower(w);
    }
    w.piece = null;
    this.spawn(w);
  }

  private sendGarbage(from: Well, count: number, cleared: number, stakes: boolean): void {
    const targets = this.rivals(from);
    if (targets.length === 0) return;
    const target = this.ctx.rng.pick(targets);
    target.pendingGarbage += count;
    from.sent += count;
    const tags: string[] = [];
    if (stakes) tags.push("HIGH STAKES x2");
    if (from.chain >= 2) tags.push(`CHAIN x${from.chain}`);
    if (from.underdog) tags.push("UNDERDOG +1");
    if (tags.length === 0) tags.push(cleared >= 4 ? "BLOCK BUSTER" : `${cleared} LINES`);
    const size = Math.min(60, 34 + Math.max(0, count - 1) * 5);
    if (count >= 2 || stakes) {
      this.callouts.show(`${tags.join(" + ")}! +${count} → ${target.player.name}`, stakes ? STAKES_COLOR : from.player.color, {
        size,
        life: 0.9,
      });
    } else {
      this.say(from, `+${count} → ${target.player.name}`, from.player.color, 26, 0.8);
    }
    if (from.player.kind === "bot" && count >= 3 && this.ctx.rng.next() < 0.5) {
      this.say(target, this.ctx.rng.pick(TAUNTS), from.player.color, 24, 1);
    }
  }

  /** A cleared power cell hits every living rival with a random power. */
  private firePower(from: Well): void {
    const targets = this.rivals(from);
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

  // ---- ghosts ----

  private haunt(ghost: Well, target: Well): void {
    if (ghost.alive || !target.alive || ghost.hauntTimer > 0) return;
    ghost.hauntTimer = HAUNT_COOLDOWN;
    ghost.haunts++;
    target.pendingGarbage += 1;
    this.juice.burst(target.wellX + (target.cell * COLS) / 2, target.wellY + target.cell * 3, [GHOST_COLOR, ghost.player.color], {
      count: 22,
      speed: 240,
      gravity: 120,
      life: 0.7,
    });
    this.ctx.sfx.whoosh();
    this.say(target, `HAUNTED BY ${ghost.player.name}`, GHOST_COLOR, 24, 1);
    this.say(ghost, "BOO!", ghost.player.color, 40, 0.7);
  }

  private ghostTick(w: Well, dt: number): void {
    w.hauntTimer = Math.max(0, w.hauntTimer - dt);
    const rivals = this.rivals(w);
    if (rivals.length <= 1) return; // one survivor left: the match is over anyway
    if (w.ghostSel >= rivals.length) w.ghostSel = 0;
    if (w.player.kind === "bot") {
      if (w.hauntTimer > 0) return;
      // Hesitate a little, then pick someone with a grudge.
      if (this.ctx.rng.next() > dt * 1.5) return;
      const i = pickHauntTarget(
        rivals.map((r) => ({ lines: r.lines, height: stackHeight(r.board) })),
        this.ctx.rng.next(),
      );
      const target = rivals[i];
      if (target) this.haunt(w, target);
      return;
    }
    const input = this.ctx.input;
    const b = BINDS[w.player.slot]!;
    if (input.justPressed(b.left)) w.ghostSel = (w.ghostSel + rivals.length - 1) % rivals.length;
    if (input.justPressed(b.right)) w.ghostSel = (w.ghostSel + 1) % rivals.length;
    if (input.actionPressed(w.player.slot)) {
      const target = rivals[w.ghostSel];
      if (target) this.haunt(w, target);
    }
  }

  /** Tap buttons for a ghost's living rivals, laid out inside the dead well. */
  private ghostButtons(w: Well): { target: Well; x: number; y: number; w: number; h: number }[] {
    const rivals = this.rivals(w);
    const ww = w.cell * COLS;
    const h = Math.max(this.ctx.minTap ?? 44, Math.min(72, w.cell * 2.2));
    const gap = 10;
    const startY = w.wellY + w.cell * ROWS * 0.42;
    return rivals.map((target, i) => ({ target, x: w.wellX + 14, y: startY + i * (h + gap), w: ww - 28, h }));
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
    const from = w.piece;
    const landed = { ...w.piece, y: dropY(w.board, w.piece) };
    if (landed.y - from.y >= 2) {
      const cells: [number, number][] = [];
      for (let y = from.y; y < landed.y; y++) for (const [cx, cy] of pieceCells({ ...from, y })) cells.push([cx, cy]);
      w.trail = { cells, type: from.type, life: 0.18 };
    }
    w.piece = landed;
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
    const height = stackHeight(w.board);
    const profile = height >= PANIC_HEIGHT ? PANIC_PROFILE : w.profile;
    if (!w.botTarget) {
      const ranked = rankPlacements(w.board, w.piece.type, w.power, profile);
      w.botTarget = pickPlacement(ranked, profile, this.ctx.rng.next()) ?? { rot: 0, x: w.piece.x, score: 0 };
      // Think a moment (visible hesitation), longer when the well is tall, less in overdrive or a RUSH.
      const tall = height >= STAKES_HEIGHT + 2 ? 0.1 : 0;
      const hurry = w.effects.rush > 0 ? 0.4 : this.overdrive ? 0.6 : 1;
      w.botTimer = -(0.22 + tall) * hurry;
    }
    w.botTimer += dt;
    // Bots feel powers too: slower hands while blinded or flipped, frantic ones under RUSH.
    const fumble = w.effects.ink > 0 || w.effects.flip > 0 ? 1.6 : 1;
    const step = (profile.step * fumble) / (w.effects.rush > 0 ? 1.6 : 1);
    if (w.botTimer < step) return;
    w.botTimer = this.ctx.rng.float(-0.04, 0.03);
    const t = w.botTarget;
    if (w.piece.rot !== t.rot) {
      if (!this.rotate(w)) this.replan(w, profile);
    } else if (w.piece.x !== t.x) {
      if (!this.move(w, Math.sign(t.x - w.piece.x))) this.replan(w, profile);
    } else {
      this.hardDrop(w);
    }
  }

  /** The piece fell too far to reach its target: pick the best spot still reachable in this rotation, or drop. */
  private replan(w: Well, profile: BotProfile): void {
    const p = w.piece;
    if (!p) return;
    const next = rankPlacements(w.board, p.type, w.power, profile, p.y, p.rot, p.x)[0];
    if (!next || (next.x === w.botTarget?.x && next.rot === w.botTarget.rot)) {
      this.hardDrop(w);
      return;
    }
    w.botTarget = next;
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
      if (w.player.kind !== "human") continue;
      if (p.x < w.laneX || p.x >= w.laneX + w.laneW) continue;
      e.preventDefault();
      if (!w.alive) {
        for (const b of this.ghostButtons(w)) {
          if (p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h) this.haunt(w, b.target);
        }
        return;
      }
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
    for (const w of this.wells) this.drawLabel(g, w);

    const left = Math.max(0, Math.ceil(TIME_LIMIT - this.time));
    g.textAlign = "center";
    g.textBaseline = "bottom";
    if (this.overdrive) {
      const pulse = 0.6 + 0.4 * Math.abs(Math.sin(this.clock * 6));
      g.fillStyle = `rgba(255,61,122,${pulse})`;
      g.font = `700 20px ${FONT}`;
      g.fillText(`OVERDRIVE  ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}  TIDE IN ${Math.max(0, this.tideTimer).toFixed(1)}`, width / 2, height - 2);
    } else {
      const soon = OVERDRIVE_AT - this.time;
      g.fillStyle = soon < 10 ? "#FF9A3E" : "rgba(244,247,251,0.6)";
      g.font = `700 18px ${FONT}`;
      const tail = soon < 10 ? `  ·  OVERDRIVE IN ${Math.ceil(soon)}` : "";
      g.fillText(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}${tail}`, width / 2, height - 2);
    }

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

  private drawLabel(g: CanvasRenderingContext2D, w: Well): void {
    const l = w.label;
    if (!l) return;
    const t = 1 - l.life / l.maxLife;
    const pop = t < 0.15 ? 0.7 + (t / 0.15) * 0.4 : 1.1 - Math.min(0.1, (t - 0.15) * 0.3);
    const ww = w.cell * COLS;
    g.save();
    g.globalAlpha = Math.min(1, l.life / (l.maxLife * 0.35));
    g.translate(w.wellX + ww / 2, w.wellY + w.cell * ROWS * 0.5);
    g.scale(pop, pop);
    g.font = `700 ${Math.min(l.size, ww / 7)}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 6;
    g.strokeStyle = "rgba(7,11,20,0.85)";
    g.strokeText(l.text, 0, 0);
    g.fillStyle = l.color;
    g.fillText(l.text, 0, 0);
    g.restore();
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

    // stakes band: everything above the line is "hit twice as hard" territory
    const stakesY = wellY + (ROWS - STAKES_HEIGHT) * cell;
    if (w.alive) {
      const hot = w.stakes ? 0.5 + 0.5 * Math.abs(Math.sin(this.clock * 7)) : 0;
      if (w.stakes) {
        g.fillStyle = `rgba(255,210,62,${0.05 + 0.06 * hot})`;
        g.fillRect(wellX, wellY, ww, stakesY - wellY);
      }
      g.save();
      g.setLineDash([6, 6]);
      g.strokeStyle = w.stakes ? STAKES_COLOR : "rgba(255,210,62,0.35)";
      g.lineWidth = w.stakes ? 2 : 1;
      g.beginPath();
      g.moveTo(wellX, stakesY);
      g.lineTo(wellX + ww, stakesY);
      g.stroke();
      g.restore();
    }

    g.strokeStyle = w.alive ? (w.stakes ? STAKES_COLOR : player.color) : "rgba(185,199,255,0.3)";
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

    if (w.alive) {
      g.font = `700 ${Math.min(w.stakes ? 16 : 12, Math.floor(ww * 0.055))}px ${FONT}`;
      g.textAlign = "right";
      g.textBaseline = "bottom";
      g.lineWidth = 4;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      const tag = w.stakes ? "HIGH STAKES x2" : "STAKES x2";
      g.strokeText(tag, wellX + ww - 4, stakesY - 2);
      g.fillStyle = w.stakes ? STAKES_COLOR : "rgba(255,210,62,0.6)";
      g.fillText(tag, wellX + ww - 4, stakesY - 2);
    }

    if (w.trail) {
      const a = (w.trail.life / 0.18) * 0.35;
      for (const [x, y] of w.trail.cells) {
        if (y >= 0) this.drawCell(g, wellX + x * cell, wellY + y * cell, cell, COLORS[w.trail.type]!, a);
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

    // tide wash at the floor
    if (w.tideFlash > 0) {
      const a = w.tideFlash / 0.5;
      const grad = g.createLinearGradient(0, wellY + wh - cell * 4, 0, wellY + wh);
      grad.addColorStop(0, "rgba(62,224,255,0)"); // TIDE wash
      grad.addColorStop(1, `rgba(62,224,255,${0.55 * a})`);
      g.fillStyle = grad;
      g.fillRect(wellX, wellY + wh - cell * 4, ww, cell * 4);
    }

    // clear flash
    if (w.flash > 0) {
      g.fillStyle = `rgba(255,255,255,${(w.flash / 0.3) * 0.25})`;
      g.fillRect(wellX, wellY, ww, wh);
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
        g.font = `700 20px ${FONT}`;
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
      g.fillStyle = w.chain >= 4 ? STAKES_COLOR : player.color;
      g.font = `700 ${Math.round(size)}px ${FONT}`;
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
    const nameSize = Math.min(22, Math.floor(ww * 0.08));
    const statSize = Math.min(18, Math.floor(ww * 0.065));
    g.textBaseline = "top";
    g.textAlign = "left";
    g.fillStyle = w.alive ? player.color : GHOST_COLOR;
    g.font = `700 ${nameSize}px ${FONT}`;
    g.fillText(w.alive ? player.name : `${player.name} (GHOST)`, wellX, 6);
    g.fillStyle = "#F4F7FB";
    g.font = `700 ${statSize}px ${FONT}`;
    let hx = wellX;
    g.fillText(`LINES ${w.lines}`, hx, 30);
    hx += g.measureText(`LINES ${w.lines}`).width + 10;
    if (w.player.kind === "human" && w.best > 0) {
      g.fillStyle = "rgba(244,247,251,0.55)";
      g.fillText(`BEST ${w.best}`, hx, 30);
      hx += g.measureText(`BEST ${w.best}`).width + 10;
    }
    if (w.underdog) {
      g.fillStyle = STAKES_COLOR;
      g.fillText("UNDERDOG +1", hx, 30);
    }

    // next block preview (hidden while inked)
    if (w.alive) {
      const mini = Math.min(11, Math.floor(cell * 0.4));
      const px = wellX + ww - mini * 4;
      g.fillStyle = "rgba(244,247,251,0.5)";
      g.font = `700 12px ${FONT}`;
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
    } else {
      this.drawGhostConsole(g, w);
    }
  }

  private drawGhostConsole(g: CanvasRenderingContext2D, w: Well): void {
    const { cell, wellX, wellY } = w;
    const ww = cell * COLS;
    const wh = cell * ROWS;
    const cx = wellX + ww / 2;
    g.fillStyle = "rgba(7,11,20,0.55)";
    g.fillRect(wellX, wellY, ww, wh);

    // a drifting ghost
    const bob = Math.sin(this.clock * 2.2) * 6;
    const gy = wellY + wh * 0.17 + bob;
    const r = Math.min(34, ww * 0.12);
    g.fillStyle = GHOST_COLOR;
    g.globalAlpha = 0.85;
    g.beginPath();
    g.arc(cx, gy, r, Math.PI, 0);
    g.lineTo(cx + r, gy + r * 1.2);
    for (let i = 0; i < 4; i++) {
      const sx = cx + r - ((i + 0.5) * r) / 2;
      g.lineTo(sx, gy + r * (i % 2 === 0 ? 0.9 : 1.2));
    }
    g.lineTo(cx - r, gy + r * 1.2);
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
    g.fillStyle = "#0c1628";
    g.beginPath();
    g.arc(cx - r * 0.35, gy - r * 0.1, r * 0.16, 0, Math.PI * 2);
    g.arc(cx + r * 0.35, gy - r * 0.1, r * 0.16, 0, Math.PI * 2);
    g.fill();

    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = GHOST_COLOR;
    g.font = `700 ${Math.min(30, ww / 9)}px ${FONT}`;
    g.fillText("YOU'RE A GHOST", cx, wellY + wh * 0.3);
    g.fillStyle = "rgba(244,247,251,0.7)";
    g.font = `700 ${Math.min(16, ww / 17)}px ${FONT}`;
    g.fillText(w.player.kind === "human" ? "TAP A RIVAL TO HAUNT (+1 ROW)" : "HAUNTING THE LIVING", cx, wellY + wh * 0.3 + 24);

    const ready = w.hauntTimer <= 0;
    const buttons = this.ghostButtons(w);
    buttons.forEach((b, i) => {
      const selected = w.player.kind === "human" && i === w.ghostSel;
      g.globalAlpha = ready ? 1 : 0.45;
      g.fillStyle = b.target.player.color;
      g.fillRect(b.x, b.y, b.w, b.h);
      if (selected) {
        g.strokeStyle = "#ffffff";
        g.lineWidth = 3;
        g.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
      }
      g.fillStyle = "#070b14";
      g.font = `700 ${Math.min(24, b.h * 0.45)}px ${FONT}`;
      g.fillText(`HAUNT ${b.target.player.name}`, b.x + b.w / 2, b.y + b.h / 2);
      g.globalAlpha = 1;
    });

    // cooldown meter
    const my = buttons.length > 0 ? buttons[buttons.length - 1]!.y + buttons[buttons.length - 1]!.h + 18 : wellY + wh * 0.5;
    const mw = ww - 28;
    g.fillStyle = "rgba(244,247,251,0.15)";
    g.fillRect(wellX + 14, my, mw, 8);
    g.fillStyle = ready ? GHOST_COLOR : "rgba(185,199,255,0.6)";
    g.fillRect(wellX + 14, my, mw * (1 - w.hauntTimer / HAUNT_COOLDOWN), 8);
    g.fillStyle = "rgba(244,247,251,0.7)";
    g.font = `700 14px ${FONT}`;
    g.textBaseline = "top";
    g.fillText(ready ? "HAUNT READY" : `RECHARGING ${w.hauntTimer.toFixed(1)}`, cx, my + 12);
    g.fillText(`HAUNTS ${w.haunts}`, cx, my + 30);
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
      if (w.haunts > 0) out.push({ playerId: w.player.id, label: "Haunts", value: String(w.haunts) });
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

import { drawPlayerOrb, drawTimerBar } from "../../core/draw";
import { Callouts, Juice } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  applyRound,
  botTarget,
  fallers,
  finalScores,
  gridShape,
  matchOver,
  MAX_PLAYS,
  planBot,
  planRound,
  resolveShoves,
  shuffle,
  tileAtPoint,
  tileCenter,
  tileRect,
  TILE_COLORS,
  TILE_COUNT,
  type BotPlan,
  type GridLayout,
  type RoundPlan,
} from "./logic";

export const hotTiles: GameDefinition = {
  id: "hot-tiles",
  name: "Hot Tiles",
  tagline: "Get on the colour or get cooked.",
  description:
    "Twenty coloured tiles float over lava. A colour is called: drag your token onto a tile of that " +
    "colour before the window closes, because every other tile drops into the lava and takes whoever " +
    "is standing on it. The window shrinks every round, the tiles reshuffle, and from round 4 only a " +
    "couple of tiles match. Tokens shove each other, so a nudge off the edge counts. Last token standing wins.",
  durationMs: 0,
  controls: "Drag your token onto a tile of the called colour.",
  fillsScreen: true,
  create: (ctx) => new HotTiles(ctx),
};

const FONT = "Bebas Neue, Impact, sans-serif";
const INTRO_S = 1.0;
const WAIT_S = 1.2;
const DROP_S = 1.1;
const RESULT_S = 1.3;
const FINAL_S = 2.2;
const RISE_S = 0.5;
const SAVE_SNAPSHOT_MS = 350;
const LAVA_COLORS = ["#FF6A00", "#FFB020", "#FF3D1F", "#FFE28A"] as const;

type Phase = "intro" | "wait" | "call" | "drop" | "result" | "final";

interface Token {
  player: Player;
  x: number;
  y: number;
  alive: boolean;
  /** Seconds since this token started falling, or -1. */
  fall: number;
  splashed: boolean;
  bot: BotPlan | null;
  aimX: number;
  aimY: number;
  heldBy: number | null;
  survived: number;
  saves: number;
  safeEarly: boolean;
  score: number;
}

class HotTiles implements GameInstance {
  private readonly tokens: Token[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly layout: GridLayout;
  private readonly radius: number;
  private readonly botSpeed: number;
  private phase: Phase = "intro";
  private timer = INTRO_S;
  private time = 0;
  private roundIndex = 0;
  private plays = 0;
  private plan: RoundPlan;
  private callT = 0;
  private riseT = 0;
  private dropT = 0;
  private readonly dropDelay: number[] = [];
  private dropping = false;
  private eliminated = 0;
  private replay = false;
  private snapshotDone = false;
  private resultText = "";
  private resultColor = "#F4F7FB";
  private finished = false;
  private over = false;
  private readonly drags = new Map<number, number>();

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    const { width, height } = ctx;
    const { cols, rows } = gridShape(width, height);
    const hud = Math.round(Math.min(width, height) * 0.1);
    const pad = Math.round(Math.min(width, height) * 0.04);
    this.layout = {
      x: pad, y: hud, w: width - pad * 2, h: height - hud - pad, cols, rows,
      gap: Math.max(6, Math.round(Math.min(width, height) * 0.014)),
    };
    const tile = tileRect(this.layout, 0);
    const tileMin = Math.min(tile.w, tile.h);
    this.radius = Math.max(ctx.minTap * 0.55, Math.min(tileMin * 0.24, tileMin * 0.4));
    this.botSpeed = Math.hypot(this.layout.w, this.layout.h) / 1.1;

    const spots = shuffle(Array.from({ length: TILE_COUNT }, (_, i) => i), ctx.rng);
    this.tokens = ctx.players.map((player, i) => {
      const c = tileCenter(this.layout, spots[i % spots.length]!);
      return {
        player, x: c.x, y: c.y, alive: true, fall: -1, splashed: false, bot: null, aimX: 0, aimY: 0,
        heldBy: null, survived: 0, saves: 0, safeEarly: false, score: 0,
      };
    });
    this.plan = planRound(0, ctx.rng);
    this.callouts.show("ROUND 1", "#F4F7FB", { size: 72, life: INTRO_S, y: 0.45 });

    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
  }

  // ---------------------------------------------------------------- update

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += realDt;
    this.stepFalls(realDt);
    if (this.finished) return;

    switch (this.phase) {
      case "intro":
        this.riseT = Math.min(RISE_S, this.riseT + dt);
        this.timer -= dt;
        if (this.timer <= 0) {
          this.phase = "wait";
          this.timer = WAIT_S;
          this.ctx.sfx.tick();
        }
        break;
      case "wait":
        this.riseT = Math.min(RISE_S, this.riseT + dt);
        this.timer -= dt;
        this.shove();
        if (this.timer <= 0) this.startCall();
        break;
      case "call":
        this.callT += dt;
        this.stepBots(dt);
        this.shove();
        if (!this.snapshotDone && this.callT * 1000 >= this.plan.windowMs - SAVE_SNAPSHOT_MS) {
          this.snapshotDone = true;
          for (const t of this.tokens) t.safeEarly = this.onMatching(t);
        }
        if (this.callT * 1000 >= this.plan.windowMs) this.closeWindow();
        break;
      case "drop":
        this.dropT += dt;
        if (this.dropT >= DROP_S) this.afterDrop();
        break;
      case "result":
        this.timer -= dt;
        if (this.timer <= 0) this.nextRound();
        break;
      case "final":
        this.timer -= dt;
        if (this.timer <= 0) this.finished = true;
        break;
    }
  }

  private startCall(): void {
    this.phase = "call";
    this.callT = 0;
    this.snapshotDone = false;
    for (const t of this.tokens) {
      if (!t.alive) continue;
      if (t.player.kind === "bot") {
        t.bot = planBot(this.plan, this.ctx.rng);
        const tile = tileRect(this.layout, 0);
        t.aimX = (this.ctx.rng.next() - 0.5) * tile.w * 0.3;
        t.aimY = (this.ctx.rng.next() - 0.5) * tile.h * 0.3;
      }
    }
    const col = TILE_COLORS[this.plan.color]!;
    this.callouts.show(`${col.name}!`, col.hex, { size: 150, life: this.plan.windowMs / 1000 + 0.2, y: 0.5 });
    this.juice.shake(0.25);
    this.ctx.sfx.go();
  }

  private stepBots(dt: number): void {
    for (const t of this.tokens) {
      if (!t.alive || t.bot === null) continue;
      const target = botTarget(t.bot, this.callT * 1000);
      if (target === null) continue;
      const c = tileCenter(this.layout, target);
      const dx = c.x + t.aimX - t.x;
      const dy = c.y + t.aimY - t.y;
      const d = Math.hypot(dx, dy);
      const step = this.botSpeed * dt;
      if (d <= step) {
        t.x = c.x + t.aimX;
        t.y = c.y + t.aimY;
      } else {
        t.x += (dx / d) * step;
        t.y += (dy / d) * step;
      }
    }
  }

  private shove(): void {
    const live = this.tokens.filter((t) => t.alive);
    resolveShoves(live, this.radius, live.map((t) => t.heldBy !== null));
    const { width, height } = this.ctx;
    for (const t of live) {
      t.x = Math.max(this.radius, Math.min(width - this.radius, t.x));
      t.y = Math.max(this.layout.y, Math.min(height - this.radius, t.y));
    }
  }

  private onMatching(t: Token): boolean {
    const tile = tileAtPoint(this.layout, t.x, t.y);
    return tile >= 0 && this.plan.tiles[tile] === this.plan.color;
  }

  private closeWindow(): void {
    this.phase = "drop";
    this.dropT = 0;
    this.dropping = true;
    this.drags.clear();
    for (const t of this.tokens) t.heldBy = null;
    for (let i = 0; i < TILE_COUNT; i++) this.dropDelay[i] = this.ctx.rng.float(0, 0.22);

    const tileOf = this.tokens.map((t) => tileAtPoint(this.layout, t.x, t.y));
    const alive = this.tokens.map((t) => t.alive);
    const fell = fallers(tileOf, this.plan, alive);
    const scores = this.tokens.map((t) => t.score);
    const res = applyRound(alive, scores, fell, this.eliminated);
    this.replay = res.outcome === "replay";
    this.eliminated = res.eliminated;

    let close = false;
    for (let i = 0; i < this.tokens.length; i++) {
      const t = this.tokens[i]!;
      t.bot = null;
      if (fell.includes(i)) {
        t.fall = 0;
        t.splashed = false;
        if (!this.replay) {
          t.alive = false;
          t.score = scores[i]!;
        }
      } else if (t.alive) {
        t.survived += 1;
        if (!t.safeEarly) {
          t.saves += 1;
          if (!close) this.callouts.show("CLOSE!", t.player.color, { size: 44, life: 0.9, y: 0.72 });
          close = true;
        }
      }
    }

    const names = fell.map((i) => this.tokens[i]!.player.name);
    if (this.replay) {
      this.resultText = "EVERYONE FELL! AGAIN!";
      this.resultColor = "#FFB020";
    } else if (fell.length === 0) {
      this.resultText = "ALL SAFE!";
      this.resultColor = "#B8FF3D";
    } else {
      this.resultText = `${names.join(" & ")} ${fell.length > 1 ? "ARE" : "IS"} TOAST!`;
      this.resultColor = "#FF3D7A";
    }
    this.juice.hitStop(0.06);
    this.juice.shake(0.6);
    this.ctx.sfx.hit();
  }

  private afterDrop(): void {
    this.plays += 1;
    const alive = this.tokens.map((t) => t.alive);
    if ((!this.replay && matchOver(alive, this.plays)) || this.plays >= MAX_PLAYS) {
      this.endMatch();
      return;
    }
    this.phase = "result";
    this.timer = RESULT_S;
    this.callouts.show(this.resultText, this.resultColor, { size: 56, life: RESULT_S, y: 0.45 });
    if (this.replay) this.ctx.sfx.miss();
    else this.ctx.sfx.collect();
  }

  /** Survivors share the win (a lone survivor takes it outright). */
  private endMatch(): void {
    this.over = true;
    const alive = this.tokens.map((t) => t.alive);
    const scores = finalScores(alive, this.tokens.map((t) => t.score), this.eliminated);
    this.tokens.forEach((t, i) => { t.score = scores[i]!; });
    const winners = this.tokens.filter((t) => t.alive);
    const text = winners.length === 0 ? "NOBODY SURVIVED" : winners.map((t) => t.player.name).join(" & ") + " WINS!";
    this.callouts.show(text, winners.length === 1 ? winners[0]!.player.color : "#F4F7FB", {
      size: 72, life: FINAL_S + 0.5, y: 0.45,
    });
    this.phase = "final";
    this.timer = FINAL_S;
    this.ctx.sfx.win();
  }

  private nextRound(): void {
    if (this.replay) {
      // Same difficulty, the survivors from before get back up on random tiles.
      const spots = shuffle(Array.from({ length: TILE_COUNT }, (_, i) => i), this.ctx.rng);
      let k = 0;
      for (const t of this.tokens) {
        if (!t.alive) continue;
        const c = tileCenter(this.layout, spots[k++ % spots.length]!);
        t.x = c.x;
        t.y = c.y;
        t.fall = -1;
      }
    } else {
      this.roundIndex += 1;
    }
    this.plan = planRound(this.roundIndex, this.ctx.rng);
    this.dropping = false;
    this.riseT = 0;
    this.phase = "intro";
    this.timer = INTRO_S;
    for (const t of this.tokens) t.safeEarly = false;
    this.callouts.show(`ROUND ${this.roundIndex + 1}`, "#F4F7FB", { size: 72, life: INTRO_S, y: 0.45 });
    this.ctx.sfx.whoosh();
  }

  private stepFalls(dt: number): void {
    for (const t of this.tokens) {
      if (t.fall < 0) continue;
      t.fall += dt;
      if (!t.splashed && t.fall >= 0.38) {
        t.splashed = true;
        const y = t.y + this.fallOffset(t.fall);
        this.juice.burst(t.x, y, LAVA_COLORS, { count: 26, speed: 320, angle: -Math.PI / 2, spread: 1.6, gravity: 700, size: 6, life: 0.8 });
        this.juice.shake(0.25);
        this.ctx.sfx.miss();
      }
      if (t.fall > 2) t.fall = -1;
    }
  }

  private fallOffset(fall: number): number {
    const f = Math.min(fall, 0.38) / 0.38;
    return f * f * this.ctx.height * 0.12;
  }

  // ---------------------------------------------------------------- input

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (this.phase !== "wait" && this.phase !== "call" && this.phase !== "intro") return;
    const p = this.toLogical(e);
    const grab = Math.max(this.ctx.minTap, this.radius * 2.2);
    let best = -1;
    let bestD = grab;
    for (let i = 0; i < this.tokens.length; i++) {
      const t = this.tokens[i]!;
      if (!t.alive || t.player.kind !== "human" || t.heldBy !== null) continue;
      const d = Math.hypot(t.x - p.x, t.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return;
    e.preventDefault();
    this.drags.set(e.pointerId, best);
    this.tokens[best]!.heldBy = e.pointerId;
    try { this.ctx.canvas.setPointerCapture(e.pointerId); } catch { /* optional */ }
    this.ctx.sfx.select();
  };

  private readonly onMove = (e: PointerEvent): void => {
    const i = this.drags.get(e.pointerId);
    if (i === undefined) return;
    const t = this.tokens[i]!;
    if (!t.alive || (this.phase !== "wait" && this.phase !== "call" && this.phase !== "intro")) return;
    e.preventDefault();
    const p = this.toLogical(e);
    t.x = p.x;
    t.y = p.y;
  };

  private readonly onUp = (e: PointerEvent): void => {
    const i = this.drags.get(e.pointerId);
    if (i === undefined) return;
    this.drags.delete(e.pointerId);
    const t = this.tokens[i]!;
    if (t.heldBy === e.pointerId) t.heldBy = null;
  };

  // ---------------------------------------------------------------- render

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    this.drawLava(g, width, height);
    this.juice.begin(g);
    this.drawTiles(g);
    this.drawTokens(g);
    this.juice.end(g);
    this.drawBorder(g, width, height);
    this.drawHud(g, width);
    if (this.phase === "wait") this.drawDots(g, width, height);
    this.callouts.draw(g, width, height);
  }

  private drawLava(g: CanvasRenderingContext2D, width: number, height: number): void {
    const base = g.createLinearGradient(0, 0, 0, height);
    base.addColorStop(0, "#4a0d06");
    base.addColorStop(0.5, "#7a1c08");
    base.addColorStop(1, "#3a0804");
    g.fillStyle = base;
    g.fillRect(0, 0, width, height);
    const r = Math.min(width, height) * 0.32;
    for (let k = 0; k < 7; k++) {
      const x = width * (0.5 + 0.48 * Math.sin(this.time * 0.31 + k * 1.9));
      const y = height * (0.5 + 0.46 * Math.cos(this.time * 0.24 + k * 2.4));
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, "rgba(255,150,30,0.45)");
      grad.addColorStop(0.5, "rgba(255,80,10,0.22)");
      grad.addColorStop(1, "rgba(255,60,0,0)");
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Bubbles.
    g.fillStyle = "rgba(255,210,90,0.5)";
    for (let k = 0; k < 10; k++) {
      const p = (this.time * 0.5 + k * 0.37) % 1;
      const x = ((k * 191) % width) + Math.sin(this.time + k) * 12;
      const y = height * (1 - p);
      g.globalAlpha = (1 - p) * 0.6;
      g.beginPath();
      g.arc(x, y, 3 + (k % 3) * 2, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  private roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.lineTo(x + w - rr, y);
    g.quadraticCurveTo(x + w, y, x + w, y + rr);
    g.lineTo(x + w, y + h - rr);
    g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    g.lineTo(x + rr, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - rr);
    g.lineTo(x, y + rr);
    g.quadraticCurveTo(x, y, x + rr, y);
    g.closePath();
  }

  private drawTiles(g: CanvasRenderingContext2D): void {
    const rise = this.riseT / RISE_S;
    const called = this.phase === "call" || this.phase === "drop" || this.phase === "result" || this.phase === "final";
    for (let i = 0; i < TILE_COUNT; i++) {
      const rect = tileRect(this.layout, i);
      const colorIdx = this.plan.tiles[i] ?? 0;
      const col = TILE_COLORS[colorIdx]!;
      const matching = colorIdx === this.plan.color;
      let alpha = 1;
      let dy = 0;
      let scale = 1;
      if (this.dropping && !matching) {
        const t = Math.max(0, Math.min(1, (this.dropT - (this.dropDelay[i] ?? 0)) / 0.7));
        if (t >= 1) continue;
        alpha = 1 - t;
        dy = t * t * this.ctx.height * 0.5;
        scale = 1 - t * 0.35;
      } else if (rise < 1) {
        const e = 1 - (1 - rise) * (1 - rise);
        alpha = e;
        dy = (1 - e) * 160;
      }
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2 + dy;
      g.save();
      g.globalAlpha = alpha;
      g.translate(cx, cy);
      g.scale(scale, scale);
      // Thickness underneath.
      g.fillStyle = "rgba(20,5,0,0.55)";
      this.roundRect(g, -rect.w / 2, -rect.h / 2 + 10, rect.w, rect.h, 14);
      g.fill();
      g.fillStyle = col.hex;
      this.roundRect(g, -rect.w / 2, -rect.h / 2, rect.w, rect.h, 14);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.18)";
      this.roundRect(g, -rect.w / 2 + 6, -rect.h / 2 + 6, rect.w - 12, rect.h * 0.3, 10);
      g.fill();
      if (called && matching) {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 14);
        g.lineWidth = 6;
        g.strokeStyle = `rgba(255,255,255,${0.35 + pulse * 0.55})`;
        this.roundRect(g, -rect.w / 2 + 3, -rect.h / 2 + 3, rect.w - 6, rect.h - 6, 12);
        g.stroke();
      }
      g.restore();
    }
  }

  private drawTokens(g: CanvasRenderingContext2D): void {
    for (const t of this.tokens) {
      if (!t.alive && t.fall < 0) continue;
      let scale = t.heldBy !== null ? 1.12 : 1;
      let alpha = 1;
      let dy = 0;
      let sink = 0;
      if (t.fall >= 0) {
        dy = this.fallOffset(t.fall);
        if (t.fall > 0.38) {
          sink = Math.min(1, (t.fall - 0.38) / 0.7);
          scale = 1 - sink * 0.8;
          alpha = 1 - sink;
        }
      }
      g.save();
      g.globalAlpha = alpha;
      g.translate(t.x, t.y + dy);
      g.scale(scale, scale);
      // Shadow on the tile.
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.beginPath();
      g.ellipse(0, this.radius * 0.9, this.radius * 1.05, this.radius * 0.45, 0, 0, Math.PI * 2);
      g.fill();
      // Contrast ring so tokens read on every tile colour.
      g.lineWidth = 5;
      g.strokeStyle = "#F4F7FB";
      g.beginPath();
      g.arc(0, 0, this.radius + 3, 0, Math.PI * 2);
      g.stroke();
      drawPlayerOrb(g, 0, 0, this.radius, t.player);
      if (sink > 0) {
        g.fillStyle = `rgba(255,120,20,${sink * 0.8})`;
        g.beginPath();
        g.arc(0, 0, this.radius + 4, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
  }

  private drawBorder(g: CanvasRenderingContext2D, width: number, height: number): void {
    if (this.phase !== "call" && this.phase !== "drop") return;
    const col = TILE_COLORS[this.plan.color]!;
    const flash = this.phase === "call" ? 0.45 + 0.55 * Math.abs(Math.sin(this.time * 16)) : 0.4;
    const lw = Math.round(Math.min(width, height) * 0.035);
    g.save();
    g.globalAlpha = flash;
    g.lineWidth = lw;
    g.strokeStyle = col.hex;
    g.shadowColor = col.hex;
    g.shadowBlur = lw * 1.5;
    g.strokeRect(lw / 2, lw / 2, width - lw, height - lw);
    g.restore();
  }

  private drawHud(g: CanvasRenderingContext2D, width: number): void {
    const hud = this.layout.y;
    g.save();
    if (this.phase === "call") drawTimerBar(g, width, this.plan.windowMs - this.callT * 1000, this.plan.windowMs);
    g.font = `700 ${Math.round(hud * 0.46)}px ${FONT}`;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.lineWidth = 6;
    g.strokeStyle = "rgba(7,11,20,0.8)";
    const label = `ROUND ${this.roundIndex + 1}`;
    g.strokeText(label, 20, hud * 0.62);
    g.fillStyle = "#F4F7FB";
    g.fillText(label, 20, hud * 0.62);

    const r = Math.max(10, hud * 0.2);
    let x = width - 20 - r;
    for (let i = this.tokens.length - 1; i >= 0; i--) {
      const t = this.tokens[i]!;
      g.globalAlpha = t.alive ? 1 : 0.35;
      drawPlayerOrb(g, x, hud * 0.62, r, t.player, t.alive ? {} : { stunned: true });
      if (!t.alive) {
        g.strokeStyle = "#FF3D7A";
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(x - r, hud * 0.62 - r);
        g.lineTo(x + r, hud * 0.62 + r);
        g.moveTo(x + r, hud * 0.62 - r);
        g.lineTo(x - r, hud * 0.62 + r);
        g.stroke();
      }
      x -= r * 2.6;
    }
    g.restore();
  }

  private drawDots(g: CanvasRenderingContext2D, width: number, height: number): void {
    const n = 1 + Math.floor(((WAIT_S - this.timer) / WAIT_S) * 3);
    g.save();
    g.font = `700 ${Math.round(Math.min(width, height) * 0.2)}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 10;
    g.strokeStyle = "rgba(7,11,20,0.85)";
    const text = ".".repeat(Math.max(1, Math.min(3, n)));
    g.strokeText(text, width / 2, height * 0.5);
    g.fillStyle = "#F4F7FB";
    g.fillText(text, width / 2, height * 0.5);
    g.restore();
  }

  // ---------------------------------------------------------------- lifecycle

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    const alive = this.tokens.map((t) => t.alive);
    const scores = this.over
      ? this.tokens.map((t) => t.score)
      : finalScores(alive, this.tokens.map((t) => t.score), this.eliminated);
    return this.tokens.map((t, i) => ({ playerId: t.player.id, score: scores[i]! }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const t of this.tokens) {
      out.push({ playerId: t.player.id, label: "Rounds survived", value: String(t.survived) });
      out.push({ playerId: t.player.id, label: "Last-second saves", value: String(t.saves) });
    }
    return out;
  }

  destroy(): void {
    const c = this.ctx.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
    this.drags.clear();
  }
}

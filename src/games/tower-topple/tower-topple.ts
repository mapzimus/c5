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
  DROPS_EACH,
  FIRE_STREAK,
  START_LIVES,
  START_WIDTH,
  dropScore,
  isOver,
  nextSeat,
  perfectWidth,
  regrow,
  sliceDrop,
  swingSpeed,
  wobbleKick,
  type Seat,
  type Span,
} from "./rules";

export const towerTopple: GameDefinition = {
  id: "tower-topple",
  name: "Tower Topple",
  tagline: "One tower. Everyone stacks. Nobody's safe.",
  description:
    "Take turns dropping a swinging block onto one shared tower. Whatever hangs over the edge " +
    "gets sliced off, so you inherit the mess the last player left. +1 per landed block, +2 for a " +
    "PERFECT drop. Chain perfects to grow the block back and score 3, 4, 5... Sloppy drops make " +
    "the tower wobble. Miss and you lose one of 3 lives. The swing speeds up as " +
    `the tower grows. Ends when one player has lives left or after ${DROPS_EACH} drops each.`,
  durationMs: 0,
  controls: "Tap anywhere (or Space) to drop",
  create: (ctx) => new TowerTopple(ctx),
};

const BLOCK_H = 40;
const GROUND_SCREEN = 680;
const TOP_SCREEN = 450;
const PIVOT_X = 640;
const PIVOT_Y = 46;
const ROPE = 290;
const SWING_AMP = 0.68;
const GRAVITY = 2200;
const SETTLE_TIME = 0.6;
const TURN_GRACE = 0.3;
const BASE_COLOR = "#5b6478";

interface Block extends Span {
  color: string;
}

interface Debris {
  x: number;
  y: number;
  w: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  color: string;
  bounces: number;
  rest: number;
}

interface Seating extends Seat {
  player: Player;
  score: number;
  perfects: number;
  bestStreak: number;
}

type Phase = "swing" | "falling" | "settle" | "over";

class TowerTopple implements GameInstance {
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly seats: Seating[];
  private readonly stack: Block[] = [{ x: PIVOT_X, w: START_WIDTH, color: BASE_COLOR }];
  private debris: Debris[] = [];
  private turn = 0;
  private phase: Phase = "swing";
  private phaseTime = 0;
  private swingPhase: number;
  private camY = -GROUND_SCREEN;
  /** The dropped block, in world coords (center x, center y). */
  private fall = { x: 0, y: 0, vy: 0, w: 0 };
  private botTarget = 0;
  private botWait = 0;
  private lastSwingX = PIVOT_X;
  private finishTimer = 0;
  /** Perfects in a row on the shared tower (any player keeps it alive). */
  private streak = 0;
  /** Tower wobble: lean angle (rad) and angular velocity, a damped spring. */
  private lean = 0;
  private leanVel = 0;
  private flash = 0;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    this.seats = ctx.players.map((player) => ({
      player,
      lives: START_LIVES,
      drops: 0,
      score: 0,
      perfects: 0,
      bestStreak: 0,
    }));
    this.swingPhase = ctx.rng.float(0, Math.PI * 2);
    this.startTurn(0);

    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
  }

  private get top(): Block {
    return this.stack[this.stack.length - 1]!;
  }

  private get topY(): number {
    return -this.stack.length * BLOCK_H;
  }

  private get current(): Seating {
    return this.seats[this.turn]!;
  }

  private swingPos(): { x: number; y: number; angle: number } {
    const angle = SWING_AMP * Math.sin(this.swingPhase);
    return {
      x: PIVOT_X + ROPE * Math.sin(angle),
      y: PIVOT_Y + ROPE * Math.cos(angle),
      angle,
    };
  }

  private startTurn(index: number): void {
    this.turn = index;
    this.phase = "swing";
    this.phaseTime = 0;
    this.lastSwingX = this.swingPos().x;
    const seat = this.current;
    if (seat.player.kind === "bot") {
      const rng = this.ctx.rng;
      const skill = rng.next() < 0.2 ? 3 : rng.float(6, 34);
      this.botTarget = this.top.x + rng.float(-1, 1) * skill;
      this.botWait = rng.float(0.5, 1.3);
    }
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.phaseTime += dt;

    const camTarget = Math.min(-GROUND_SCREEN, this.topY - TOP_SCREEN);
    this.camY += (camTarget - this.camY) * Math.min(1, dt * 4);

    this.updateDebris(dt);
    this.flash = Math.max(0, this.flash - realDt * 3);
    // Damped spring back to upright; taller towers are floppier.
    const stiff = 40 / (1 + this.stack.length * 0.05);
    this.leanVel += (-this.lean * stiff - this.leanVel * 4) * dt;
    this.lean += this.leanVel * dt;

    if (this.phase === "over") {
      this.finishTimer -= realDt;
      return;
    }

    if (this.phase === "swing") {
      this.swingPhase += swingSpeed(this.stack.length - 1) * dt;
      const x = this.swingPos().x;
      if (this.ctx.input.justPressed("Space") && this.current.player.kind === "human") this.drop();
      else if (this.current.player.kind === "bot") this.botTick(x);
      this.lastSwingX = x;
      return;
    }

    if (this.phase === "falling") {
      this.fall.vy += GRAVITY * dt;
      this.fall.y += this.fall.vy * dt;
      if (this.fall.y + BLOCK_H / 2 >= this.topY) this.land();
      return;
    }

    if (this.phase === "settle" && this.phaseTime >= SETTLE_TIME) {
      if (isOver(this.seats)) {
        this.endGame();
        return;
      }
      const next = nextSeat(this.seats, this.turn);
      if (next < 0) this.endGame();
      else this.startTurn(next);
    }
  }

  private botTick(x: number): void {
    if (this.phaseTime < this.botWait) return;
    const t = this.botTarget;
    const crossed = (this.lastSwingX - t) * (x - t) <= 0;
    if (crossed || this.phaseTime > 6) this.drop();
  }

  private drop(): void {
    if (this.phase !== "swing" || this.phaseTime < TURN_GRACE) return;
    const p = this.swingPos();
    // The tower's lean shifts where the top actually is when the block arrives.
    this.fall = { x: p.x, y: p.y + this.camY, vy: 0, w: this.top.w };
    this.phase = "falling";
    this.phaseTime = 0;
    this.ctx.sfx.whoosh();
  }

  private land(): void {
    const seat = this.current;
    seat.drops++;
    // A leaning tower moves its top: a wobble left by the last player can ruin your drop.
    const shift = Math.sin(this.lean) * this.stack.length * BLOCK_H;
    const raw = sliceDrop({ x: this.top.x + shift, w: this.top.w }, this.fall.x, this.fall.w);
    const result =
      raw.kind === "miss" ? raw
      : raw.kind === "perfect" ? { ...raw, block: { x: raw.block.x - shift, w: raw.block.w } }
      : { ...raw, block: { x: raw.block.x - shift, w: raw.block.w }, cut: { x: raw.cut.x - shift, w: raw.cut.w } };
    const color = seat.player.color;
    const landY = this.topY - BLOCK_H / 2;
    const textY = 0.22;

    if (result.kind === "miss") {
      seat.lives--;
      this.streak = 0;
      this.debris.push({
        x: this.fall.x, y: this.fall.y, w: this.fall.w,
        vx: (this.fall.x - this.top.x) * 0.8, vy: this.fall.vy * 0.5,
        rot: 0, vr: Math.sign(this.fall.x - this.top.x || 1) * 4, color, bounces: 0, rest: 0,
      });
      const grown = regrow(this.top);
      this.top.x = grown.x;
      this.top.w = grown.w;
      this.leanVel += Math.sign(this.fall.x - this.top.x || 1) * 0.9;
      this.juice.shake(0.5);
      this.juice.slowMo(0.45, 0.3);
      this.ctx.sfx.hit();
      this.callouts.show(
        seat.lives > 0 ? `MISS! ${seat.lives} ${seat.lives === 1 ? "LIFE" : "LIVES"} LEFT` : `${seat.player.name} IS OUT!`,
        "#FF3D7A",
        { size: 52, y: textY },
      );
    } else {
      const sy = landY - this.camY;
      if (result.kind === "perfect") {
        this.streak++;
        seat.perfects++;
        seat.bestStreak = Math.max(seat.bestStreak, this.streak);
        const pts = dropScore(result, this.streak);
        seat.score += pts;
        const w = perfectWidth(result.block.w, this.streak);
        this.stack.push({ x: result.block.x, w, color });
        const fire = this.streak >= FIRE_STREAK;
        this.juice.burst(result.block.x, sy + BLOCK_H / 2, [color, "#ffffff", "#FFB020"], {
          count: fire ? 48 : 26, speed: fire ? 420 : 320, gravity: 400, life: 0.6,
        });
        // Width regrow shows as a shockwave of sparks sideways.
        this.juice.burst(result.block.x - w / 2, sy, "#FFB020", { count: 8, angle: Math.PI, spread: 0.6, speed: 260, gravity: 200 });
        this.juice.burst(result.block.x + w / 2, sy, "#FFB020", { count: 8, angle: 0, spread: 0.6, speed: 260, gravity: 200 });
        this.juice.hitStop(fire ? 0.09 : 0.05);
        this.flash = fire ? 1 : 0.5;
        this.ctx.sfx.streak(Math.min(6, this.streak));
        const label = this.streak === 1 ? `PERFECT! +${pts}` : fire ? `ON FIRE x${this.streak}! +${pts}` : `PERFECT x${this.streak}! +${pts}`;
        this.callouts.show(label, fire ? "#FF3D7A" : "#FFB020", { size: fire ? 68 : 60, y: textY });
      } else {
        this.streak = 0;
        seat.score += dropScore(result);
        this.stack.push({ x: result.block.x, w: result.block.w, color });
        const dir = Math.sign(result.cut.x - result.block.x);
        this.debris.push({
          x: result.cut.x, y: landY, w: result.cut.w,
          vx: dir * (90 + result.cut.w * 1.5), vy: -60,
          rot: 0, vr: dir * 3, color, bounces: 0, rest: 0,
        });
        // Dust puffs out from the seam on the side that took the hit.
        this.juice.burst(result.block.x - dir * result.block.w / 2, sy + BLOCK_H / 2, "rgba(244,247,251,0.6)", {
          count: 10, angle: dir > 0 ? Math.PI : 0, spread: 1.2, speed: 160, gravity: 150, size: 5, life: 0.5,
        });
        const kick = wobbleKick(result, this.stack.length);
        this.leanVel += dir * kick;
        this.juice.shake(0.12 + kick * 0.15);
        if (kick > 0.6) this.callouts.show("WOBBLY!", "#9AA4B8", { size: 40, y: textY, life: 0.8 });
        this.ctx.sfx.tick();
      }
    }

    this.phase = "settle";
    this.phaseTime = 0;
  }

  private updateDebris(dt: number): void {
    const groundTop = -BLOCK_H / 2;
    for (const d of this.debris) {
      if (d.rest > 0) {
        d.rest += dt;
        continue;
      }
      d.vy += GRAVITY * 0.6 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.rot += d.vr * dt;
      // Bounce off the ground beside the tower (not under it), then come to rest.
      const base = this.stack[0]!;
      const underTower = Math.abs(d.x - base.x) < base.w / 2 + d.w / 2;
      if (d.y >= groundTop && d.vy > 0 && !underTower) {
        d.y = groundTop;
        d.bounces++;
        d.vy = -d.vy * 0.45;
        d.vx *= 0.7;
        d.vr = d.vr * -0.5;
        if (Math.abs(d.vy) < 120 || d.bounces > 2) {
          d.vy = 0;
          d.vx = 0;
          d.vr = 0;
          d.rot = Math.round(d.rot / (Math.PI / 2)) * (Math.PI / 2);
          d.rest = 0.001;
        } else {
          this.juice.burst(d.x, 0, "rgba(244,247,251,0.5)", { count: 6, speed: 90, gravity: 100, size: 4, life: 0.4, angle: -Math.PI / 2, spread: 2 });
          this.ctx.sfx.tick();
        }
      }
    }
    const floor = this.camY + this.ctx.height + 200;
    this.debris = this.debris.filter((d) => d.y < floor && d.rest < 6);
  }

  private endGame(): void {
    this.phase = "over";
    this.finishTimer = 2.2;
    const best = Math.max(...this.seats.map((s) => s.score));
    const winners = this.seats.filter((s) => s.score === best);
    if (winners.length === 1) {
      this.callouts.show(`${winners[0]!.player.name} WINS!`, winners[0]!.player.color, { size: 72, life: 2.2 });
    } else {
      this.callouts.show("TIE!", "#F4F7FB", { size: 72, life: 2.2 });
    }
    this.ctx.sfx.win();
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (this.current.player.kind !== "human") return;
    e.preventDefault();
    this.drop();
  };

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);

    // Ground.
    const groundY = -this.camY;
    if (groundY < height) {
      g.fillStyle = "#1b2436";
      g.fillRect(0, groundY, width, height - groundY + 40);
    }

    // The tower leans as one body, pivoting on its base: higher blocks swing further.
    const base = this.stack[0]!;
    for (let i = 0; i < this.stack.length; i++) {
      const b = this.stack[i]!;
      const h = (i + 0.5) * BLOCK_H;
      const sway = Math.sin(this.lean) * h;
      const y = -h - this.camY + (1 - Math.cos(this.lean)) * h;
      this.drawBlock(g, b.x + sway + (b.x - base.x) * (Math.cos(this.lean) - 1), y, b.w, b.color, this.lean);
    }

    for (const d of this.debris) this.drawBlock(g, d.x, d.y - this.camY, d.w, d.color, d.rot);

    if (this.phase === "swing") {
      const p = this.swingPos();
      g.strokeStyle = "rgba(244,247,251,0.55)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(PIVOT_X, PIVOT_Y);
      g.lineTo(p.x, p.y - BLOCK_H / 2);
      g.stroke();
      g.fillStyle = "#F4F7FB";
      g.beginPath();
      g.arc(PIVOT_X, PIVOT_Y, 5, 0, Math.PI * 2);
      g.fill();
      this.drawBlock(g, p.x, p.y, this.top.w, this.current.player.color, p.angle * 0.4);
    } else if (this.phase === "falling") {
      this.drawBlock(g, this.fall.x, this.fall.y - this.camY, this.fall.w, this.current.player.color, 0);
    }

    this.juice.end(g);
    if (this.flash > 0) {
      g.fillStyle = `rgba(255,255,255,${this.flash * 0.18})`;
      g.fillRect(0, 0, width, height);
    }
    this.drawHud(g);
    this.callouts.draw(g, width, height);
  }

  private drawBlock(
    g: CanvasRenderingContext2D, cx: number, cy: number, w: number, color: string, rot: number,
  ): void {
    g.save();
    g.translate(cx, cy);
    g.rotate(rot);
    g.fillStyle = color;
    g.fillRect(-w / 2, -BLOCK_H / 2, w, BLOCK_H);
    g.fillStyle = "rgba(255,255,255,0.22)";
    g.fillRect(-w / 2, -BLOCK_H / 2, w, 6);
    g.fillStyle = "rgba(7,11,20,0.25)";
    g.fillRect(-w / 2, BLOCK_H / 2 - 6, w, 6);
    g.strokeStyle = "rgba(7,11,20,0.6)";
    g.lineWidth = 2;
    g.strokeRect(-w / 2, -BLOCK_H / 2, w, BLOCK_H);
    g.restore();
  }

  private drawHud(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;

    if (this.phase !== "over") {
      const cp = this.current.player;
      g.fillStyle = cp.color;
      g.font = "700 30px Bebas Neue, Impact, sans-serif";
      g.textAlign = "left";
      g.textBaseline = "top";
      g.fillText(`${cp.name}'S TURN`, 20, 12);
    }

    g.fillStyle = "rgba(244,247,251,0.7)";
    g.font = "700 26px Bebas Neue, Impact, sans-serif";
    g.textAlign = "right";
    g.textBaseline = "top";
    g.fillText(`HEIGHT ${this.stack.length - 1}`, width - 20, 12);
    if (this.streak > 0) {
      const fire = this.streak >= FIRE_STREAK;
      g.fillStyle = fire ? "#FF3D7A" : "#FFB020";
      g.font = `700 ${fire ? 30 : 24}px Bebas Neue, Impact, sans-serif`;
      g.fillText(fire ? `ON FIRE x${this.streak}` : `PERFECT x${this.streak}`, width - 20, 44);
    }

    const n = this.seats.length;
    const sbW = 170;
    const sx = (width - n * sbW) / 2;
    const sy = height - 58;
    g.fillStyle = "rgba(7,11,20,0.55)";
    g.fillRect(sx - 10, sy - 8, n * sbW + 20, 62);
    for (let i = 0; i < n; i++) {
      const s = this.seats[i]!;
      const cx = sx + i * sbW + sbW / 2;
      const active = i === this.turn && this.phase !== "over";
      g.globalAlpha = s.lives > 0 ? 1 : 0.4;
      g.fillStyle = s.player.color;
      g.font = `${active ? 700 : 600} 16px Outfit, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "top";
      g.fillText(`${active ? "▶ " : ""}${s.player.name}  ${s.score}`, cx, sy);
      for (let j = 0; j < START_LIVES; j++) {
        g.beginPath();
        g.arc(cx - 40 + j * 14, sy + 32, 5, 0, Math.PI * 2);
        g.fillStyle = j < s.lives ? "#FF3D7A" : "rgba(244,247,251,0.15)";
        g.fill();
      }
      g.fillStyle = "rgba(244,247,251,0.6)";
      g.font = "600 13px Outfit, sans-serif";
      g.textAlign = "left";
      g.fillText(`${DROPS_EACH - s.drops} left`, cx + 6, sy + 25);
      g.globalAlpha = 1;
    }
  }

  isFinished(): boolean {
    return this.phase === "over" && this.finishTimer <= 0;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({ playerId: s.player.id, score: s.score }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const s of this.seats) {
      out.push({ playerId: s.player.id, label: "Perfects", value: String(s.perfects) });
      out.push({ playerId: s.player.id, label: "Best streak", value: String(s.bestStreak) });
      out.push({ playerId: s.player.id, label: "Lives left", value: String(s.lives) });
    }
    return out;
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener("pointerdown", this.onDown);
  }
}

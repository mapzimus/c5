import { drawWindStreaks, fillArena } from "../../core/draw";
import { PLAYER_BINDS } from "../../core/input";
import { Callouts, Juice, loadBest, saveBest } from "../../fx/juice";
import type {
  GameContext,
  GameDefinition,
  GameInstance,
  GameStat,
  Player,
} from "../../core/types";
import {
  FINAL_MULT,
  FIRE_STREAK,
  GUST_FALL,
  GUST_SWING,
  PERFECT_TOLERANCE,
  SHOT_CLOCK,
  START_LIVES,
  START_WIDTH,
  TOPPLE_LEAN,
  UNDERDOG_TOLERANCE,
  breathRate,
  dropScore,
  dropsEach,
  gustLeanKick,
  isFinalRound,
  isNearMiss,
  isOver,
  nextSeat,
  perfectWidth,
  regrow,
  sliceDrop,
  swingSpeed,
  toppleCount,
  toppleLosses,
  underdogs,
  wobbleKick,
  type Seat,
  type Span,
} from "./rules";

export const towerTopple: GameDefinition = {
  id: "tower-topple",
  name: "Tower Topple",
  tagline: "One tower. Everyone stacks. Everyone blows.",
  description:
    "Take turns dropping a swinging block onto one shared tower; the overhang gets sliced off, so you " +
    "inherit the mess the last player left. +1 per block, +2 for a PERFECT, chain perfects for 3, 4, 5... " +
    "While you wait, tap your BELLOWS to blow a gust that jerks the swing and rocks the tower. Lean it too " +
    "far and it TOPPLES: fallen blocks cost their owners a point each. Miss and lose one of 3 lives. " +
    "The last round pays double. Ends when one player is left or everyone has used their drops.",
  durationMs: 0,
  controls: "Your turn: tap anywhere (or Space) to drop. Waiting: tap your pad to blow",
  create: (ctx) => new TowerTopple(ctx),
};

const BLOCK_H = 40;
const GROUND_SCREEN = 600;
const TOP_SCREEN = 400;
const PIVOT_X = 640;
const PIVOT_Y = 36;
const ROPE = 265;
const SWING_AMP = 0.68;
const GRAVITY = 2200;
const SETTLE_TIME = 0.5;
const TURN_GRACE = 0.3;
const BASE_COLOR = "#5b6478";
const PAD_Y = 614;
const PAD_H = 98;
const PAD_GAP = 12;
const BEST_KEY = "v2-gusts";
const TAUNTS = ["PUFF!", "WHOOSH!", "HA!", "WOBBLE!", "TIMBER!"] as const;

interface Block extends Span {
  color: string;
  /** Seat index that dropped it, -1 for the base. */
  owner: number;
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
  gusts: number;
  /** 0..1, one gust when full. */
  breath: number;
  /** Pad highlight after a gust. */
  gustFlash: number;
  /** Bot: turn time at which it plans to blow this turn. */
  blowAt: number;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  size: number;
}

type Phase = "swing" | "falling" | "settle" | "over";

class TowerTopple implements GameInstance {
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly seats: Seating[];
  private readonly limit: number;
  private readonly stack: Block[] = [{ x: PIVOT_X, w: START_WIDTH, color: BASE_COLOR, owner: -1 }];
  private debris: Debris[] = [];
  private floaters: Floater[] = [];
  private turn = 0;
  private phase: Phase = "swing";
  private phaseTime = 0;
  /** Time since this turn started (swing + fall + settle). */
  private turnTime = 0;
  private time = 0;
  private swingPhase: number;
  private camY = -GROUND_SCREEN;
  /** The dropped block, in world coords (center x, center y). */
  private fall = { x: 0, y: 0, vx: 0, vy: 0, w: 0 };
  private botTarget = 0;
  private botWait = 0;
  private lastSwingX = PIVOT_X;
  private finishTimer = 0;
  /** Perfects in a row on the shared tower (any player keeps it alive). */
  private streak = 0;
  /** Tower wobble: lean angle (rad) and angular velocity, a damped spring. */
  private lean = 0;
  private leanVel = 0;
  /** Extra pendulum angle from gusts, another damped spring on top of the swing. */
  private gustAngle = 0;
  private gustVel = 0;
  private wind = { dir: 1, strength: 0 };
  private lastGust = { seat: -1, t: -10 };
  private flash = 0;
  private finalRound = false;
  private topples = 0;
  private readonly best: number;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    this.limit = dropsEach(ctx.players.length);
    this.seats = ctx.players.map((player) => ({
      player,
      lives: START_LIVES,
      drops: 0,
      score: 0,
      perfects: 0,
      bestStreak: 0,
      gusts: 0,
      breath: 0.6,
      gustFlash: 0,
      blowAt: Infinity,
    }));
    this.best = ctx.players.some((p) => p.kind === "human") ? loadBest(towerTopple.id, BEST_KEY) : 0;
    this.swingPhase = ctx.rng.float(0, Math.PI * 2);
    this.startTurn(0);

    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
  }

  private get top(): Block {
    return this.stack[this.stack.length - 1]!;
  }

  private get height(): number {
    return this.stack.length - 1;
  }

  private get topY(): number {
    return -this.stack.length * BLOCK_H;
  }

  private get current(): Seating {
    return this.seats[this.turn]!;
  }

  private swingPos(): { x: number; y: number; angle: number } {
    const angle = SWING_AMP * Math.sin(this.swingPhase) + this.gustAngle;
    return {
      x: PIVOT_X + ROPE * Math.sin(angle),
      y: PIVOT_Y + ROPE * Math.cos(angle),
      angle,
    };
  }

  // ---- pads (the per-seat bellows / scoreboard tiles) ----

  private padW(): number {
    const n = this.seats.length;
    return Math.min(300, Math.floor((this.ctx.width - 40 - (n - 1) * PAD_GAP) / n));
  }

  private padX(i: number): number {
    const n = this.seats.length;
    const w = this.padW();
    const total = n * w + (n - 1) * PAD_GAP;
    return (this.ctx.width - total) / 2 + i * (w + PAD_GAP);
  }

  /** Which side a seat's wind blows from: left pads blow right, right pads blow left. */
  private padDir(i: number): number {
    const cx = this.padX(i) + this.padW() / 2;
    const mid = this.ctx.width / 2;
    if (Math.abs(cx - mid) < 1) return i % 2 ? -1 : 1;
    return cx < mid ? 1 : -1;
  }

  private padAt(x: number, y: number): number {
    if (y < PAD_Y || y > PAD_Y + PAD_H) return -1;
    const w = this.padW();
    for (let i = 0; i < this.seats.length; i++) {
      const px = this.padX(i);
      if (x >= px && x <= px + w) return i;
    }
    return -1;
  }

  private isUnderdog(i: number): boolean {
    return underdogs(this.seats.map((s) => s.score), this.seats.map((s) => s.lives > 0))[i] ?? false;
  }

  private startTurn(index: number): void {
    this.turn = index;
    this.phase = "swing";
    this.phaseTime = 0;
    this.turnTime = 0;
    this.lastSwingX = this.swingPos().x;
    if (!this.finalRound && isFinalRound(this.seats, this.limit)) {
      this.finalRound = true;
      this.callouts.show(`FINAL ROUND · ${FINAL_MULT}X POINTS`, "#FF3D7A", { size: 60, y: 0.22, life: 1.6 });
      this.ctx.sfx.go();
    }
    const rng = this.ctx.rng;
    const seat = this.current;
    if (seat.player.kind === "bot") {
      // Mostly decent aim, sometimes sharp, and one drop in twelve is a real blunder.
      const roll = rng.next();
      const skill = roll < 0.2 ? 3 : roll < 0.92 ? rng.float(6, 34) : rng.float(55, 95);
      this.botTarget = this.top.x + rng.float(-1, 1) * skill;
      this.botWait = rng.float(0.4, 1.1);
    }
    // Waiting bots decide whether to blow this turn: less keen when the top of the tower is theirs.
    const zone = toppleCount(this.height);
    const topOwners = this.stack.slice(this.stack.length - zone).map((b) => b.owner);
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (i === index || s.player.kind !== "bot") {
        s.blowAt = Infinity;
        continue;
      }
      const own = topOwners.filter((o) => o === i).length / Math.max(1, zone);
      let chance = 0.75 - own * 0.45;
      if (this.finalRound) chance += 0.2;
      if (s.lives <= 0) chance = 0.9;
      s.blowAt = rng.next() < chance ? rng.float(0.3, 2.2) : Infinity;
    }
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    for (const f of this.floaters) f.life -= realDt;
    this.floaters = this.floaters.filter((f) => f.life > 0);
    const dt = this.juice.update(realDt);
    this.phaseTime += dt;
    this.turnTime += dt;
    this.time += realDt;

    const camTarget = Math.min(-GROUND_SCREEN, this.topY - TOP_SCREEN);
    this.camY += (camTarget - this.camY) * Math.min(1, dt * 4);

    this.updateDebris(dt);
    this.flash = Math.max(0, this.flash - realDt * 3);
    this.wind.strength = Math.max(0, this.wind.strength - realDt * 2);
    for (const s of this.seats) s.gustFlash = Math.max(0, s.gustFlash - realDt * 2);
    // Damped spring back to upright; taller towers are floppier.
    const stiff = 40 / (1 + this.stack.length * 0.05);
    this.leanVel += (-this.lean * stiff - this.leanVel * 4) * dt;
    this.lean += this.leanVel * dt;
    // Gust spring on the pendulum.
    this.gustVel += (-this.gustAngle * 50 - this.gustVel * 3.5) * dt;
    this.gustAngle = Math.max(-0.4, Math.min(0.4, this.gustAngle + this.gustVel * dt));

    if (this.phase === "over") {
      this.finishTimer -= realDt;
      return;
    }

    for (const s of this.seats) s.breath = Math.min(1, s.breath + breathRate(s, this.finalRound) * dt);
    if (Math.abs(this.lean) > TOPPLE_LEAN && toppleCount(this.height) > 0) this.topple();

    this.readKeys();
    this.botGusts();

    if (this.phase === "swing") {
      this.swingPhase += swingSpeed(this.height, this.finalRound) * dt;
      const x = this.swingPos().x;
      if (this.current.player.kind === "bot") this.botTick(x);
      if (this.phase === "swing" && this.phaseTime >= SHOT_CLOCK) {
        this.callouts.show("TIME!", "#9AA4B8", { size: 40, y: 0.22, life: 0.7 });
        this.drop();
      }
      this.lastSwingX = x;
      return;
    }

    if (this.phase === "falling") {
      this.fall.vy += GRAVITY * dt;
      this.fall.x += this.fall.vx * dt;
      this.fall.y += this.fall.vy * dt;
      if (this.fall.y + BLOCK_H / 2 >= this.topY) this.land();
      return;
    }

    if (this.phase === "settle" && this.phaseTime >= SETTLE_TIME) {
      if (isOver(this.seats, this.limit)) {
        this.endGame();
        return;
      }
      const next = nextSeat(this.seats, this.turn, this.limit);
      if (next < 0) this.endGame();
      else this.startTurn(next);
    }
  }

  private readKeys(): void {
    const input = this.ctx.input;
    const humanTurn = this.current.player.kind === "human";
    if (humanTurn && this.phase === "swing" && input.justPressed("Space")) this.drop();
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (i === this.turn || s.player.kind !== "human") continue;
      const key = PLAYER_BINDS[s.player.slot]?.action ?? "";
      if (key === "Space" && humanTurn) continue;
      if (key && input.justPressed(key)) this.gust(i);
    }
  }

  private botGusts(): void {
    if (this.phase === "settle") return;
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (i === this.turn || s.player.kind !== "bot" || this.turnTime < s.blowAt || s.breath < 1) continue;
      s.blowAt = Infinity;
      this.gust(i);
    }
  }

  private botTick(x: number): void {
    if (this.phaseTime < this.botWait) return;
    const t = this.botTarget;
    const crossed = (this.lastSwingX - t) * (x - t) <= 0;
    if (crossed) this.drop();
  }

  /** Seat `i` blows: the swing jerks, a falling block drifts, the tower rocks. */
  private gust(i: number): void {
    const s = this.seats[i]!;
    if (this.phase === "over" || s.breath < 1) return;
    s.breath = 0;
    s.gusts++;
    s.gustFlash = 1;
    const dir = this.padDir(i);
    this.wind = { dir, strength: 1 };
    this.gustVel += dir * GUST_SWING;
    if (this.phase === "falling") this.fall.vx += dir * GUST_FALL;
    this.leanVel += dir * gustLeanKick(this.height);
    this.lastGust = { seat: i, t: this.time };
    const p = this.swingPos();
    const edgeX = dir > 0 ? -10 : this.ctx.width + 10;
    const y = this.phase === "falling" ? this.fall.y - this.camY : p.y;
    this.juice.burst(edgeX, y, [s.player.color, "rgba(244,247,251,0.8)"], {
      count: 22, angle: dir > 0 ? 0 : Math.PI, spread: 0.5, speed: 900, gravity: 0, size: 5, life: 0.5,
    });
    this.juice.shake(0.08);
    const taunt = s.player.kind === "bot" ? TAUNTS[this.ctx.rng.int(0, TAUNTS.length - 1)]! : "PUFF!";
    this.floater(i, taunt, s.player.color, 30);
    this.ctx.sfx.whoosh();
  }

  private floater(seat: number, text: string, color: string, size = 26): void {
    const x = this.padX(seat) + this.padW() / 2;
    this.floaters.push({ x, y: PAD_Y - 10, text, color, life: 0.9, maxLife: 0.9, size });
  }

  private drop(): void {
    if (this.phase !== "swing" || this.phaseTime < TURN_GRACE) return;
    const p = this.swingPos();
    this.fall = { x: p.x, y: p.y + this.camY, vx: 0, vy: 0, w: this.top.w };
    this.phase = "falling";
    this.phaseTime = 0;
    this.ctx.sfx.whoosh();
  }

  private land(): void {
    const seat = this.current;
    seat.drops++;
    const mult = this.finalRound ? FINAL_MULT : 1;
    const tolerance = this.isUnderdog(this.turn) ? UNDERDOG_TOLERANCE : PERFECT_TOLERANCE;
    // A leaning tower moves its top: a wobble left by the last player can ruin your drop.
    const shift = Math.sin(this.lean) * this.stack.length * BLOCK_H;
    const shiftedTop = { x: this.top.x + shift, w: this.top.w };
    const raw = sliceDrop(shiftedTop, this.fall.x, this.fall.w, tolerance);
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
        vx: (this.fall.x - this.top.x) * 0.8 + this.fall.vx, vy: this.fall.vy * 0.5,
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
      if (seat.lives <= 0) {
        this.callouts.show("GHOST WIND: KEEP BLOWING", "#9AA4B8", { size: 34, y: 0.3, life: 1.6 });
      }
    } else {
      const sy = landY - this.camY;
      let pts = 0;
      if (result.kind === "perfect") {
        this.streak++;
        seat.perfects++;
        seat.bestStreak = Math.max(seat.bestStreak, this.streak);
        pts = dropScore(result, this.streak, mult);
        seat.score += pts;
        const w = perfectWidth(result.block.w, this.streak);
        this.stack.push({ x: result.block.x, w, color, owner: this.turn });
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
        pts = dropScore(result, 1, mult);
        seat.score += pts;
        this.stack.push({ x: result.block.x, w: result.block.w, color, owner: this.turn });
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
        if (isNearMiss(shiftedTop, this.fall.x, tolerance)) {
          this.callouts.show(`SO CLOSE! +${pts}`, "#F4F7FB", { size: 44, y: textY, life: 0.9 });
        } else if (kick > 0.6) {
          this.callouts.show("WOBBLY!", "#9AA4B8", { size: 40, y: textY, life: 0.8 });
        }
        this.ctx.sfx.tick();
      }
      this.floater(this.turn, `+${pts}`, color);
    }

    this.phase = "settle";
    this.phaseTime = 0;
  }

  /** The tower leaned too far: its top sheds as debris and every fallen block costs its owner a point. */
  private topple(): void {
    const count = toppleCount(this.height);
    const dir = Math.sign(this.lean) || 1;
    const fallen = this.stack.splice(this.stack.length - count, count);
    const base = this.stack.length;
    fallen.forEach((b, k) => {
      const h = (base + k + 0.5) * BLOCK_H;
      this.debris.push({
        x: b.x + Math.sin(this.lean) * h, y: -h, w: b.w,
        vx: dir * (140 + k * 70 + this.ctx.rng.float(0, 60)), vy: -90 - k * 40,
        rot: this.lean, vr: dir * (2 + k * 0.8), color: b.color, bounces: 0, rest: 0,
      });
    });
    const losses = toppleLosses(fallen.map((b) => b.owner));
    for (const [owner, n] of losses) {
      const s = this.seats[owner];
      if (!s) continue;
      const lost = Math.min(s.score, n);
      s.score -= lost;
      if (lost > 0) this.floater(owner, `-${lost}`, "#FF3D7A", 34);
    }
    this.topples++;
    this.lean = 0;
    this.leanVel = 0;
    this.streak = 0;
    const grown = regrow(this.top);
    this.top.w = grown.w;
    this.juice.shake(0.9);
    this.juice.hitStop(0.08);
    this.juice.slowMo(0.5, 0.35);
    this.flash = 0.8;
    this.ctx.sfx.hit();
    const g = this.lastGust;
    const blower = g.seat >= 0 && this.time - g.t < 1.5 ? this.seats[g.seat] : undefined;
    const label = blower ? `TOPPLED BY ${blower.player.name}!` : "TOPPLE!";
    this.callouts.show(label, blower ? blower.player.color : "#FF3D7A", { size: 66, y: 0.22, life: 1.4 });
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
      const underTower = this.phase !== "over" && Math.abs(d.x - base.x) < base.w / 2 + d.w / 2;
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
    this.finishTimer = 3;
    const best = Math.max(...this.seats.map((s) => s.score));
    const winners = this.seats.filter((s) => s.score === best);
    // The whole tower comes down as the win beat, falling toward the winner's side of the table.
    const winnerIdx = this.seats.indexOf(winners[0]!);
    const dir = winners.length === 1 ? -this.padDir(winnerIdx) : 1;
    const fallen = this.stack.splice(1);
    fallen.forEach((b, k) => {
      const h = (k + 1.5) * BLOCK_H;
      this.debris.push({
        x: b.x, y: -h, w: b.w,
        vx: dir * (60 + k * 28) * (k % 2 ? 1 : 0.6), vy: -40 - k * 12,
        rot: 0, vr: dir * (1.5 + k * 0.4), color: b.color, bounces: 0, rest: 0,
      });
    });
    this.lean = 0;
    this.leanVel = 0;
    this.juice.shake(1);
    this.juice.slowMo(0.6, 0.4);
    if (winners.length === 1) {
      this.callouts.show(`${winners[0]!.player.name} WINS!`, winners[0]!.player.color, { size: 72, life: 3 });
    } else {
      this.callouts.show("TIE!", "#F4F7FB", { size: 72, life: 3 });
    }
    for (const s of this.seats) {
      if (s.player.kind === "human" && saveBest(towerTopple.id, s.score, BEST_KEY)) {
        this.callouts.show(`${s.player.name}: NEW RECORD ${s.score}`, "#B8FF3D", { size: 44, y: 0.46, life: 2.6 });
        break;
      }
    }
    this.ctx.sfx.win();
  }

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  /** Each pointer (finger) is one tap; taps are stateless so no per-pointerId tracking is needed. */
  private readonly onDown = (e: PointerEvent): void => {
    e.preventDefault();
    if (this.phase === "over") return;
    const p = this.toLogical(e);
    const pad = this.padAt(p.x, p.y);
    if (pad >= 0 && pad !== this.turn) {
      if (this.seats[pad]!.player.kind === "human") this.gust(pad);
      return;
    }
    if (this.current.player.kind === "human") this.drop();
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
    // Danger glow when the lean nears a topple.
    const danger = Math.min(1, Math.abs(this.lean) / TOPPLE_LEAN);
    if (danger > 0.55 && this.phase !== "over") {
      const t = this.top;
      g.save();
      g.globalAlpha = (danger - 0.55) / 0.45 * (0.5 + 0.5 * Math.sin(this.time * 18));
      g.strokeStyle = "#FF3D7A";
      g.lineWidth = 4;
      const h = (this.stack.length - 0.5) * BLOCK_H;
      g.strokeRect(t.x + Math.sin(this.lean) * h - t.w / 2 - 4, -h - this.camY - BLOCK_H / 2 - 4, t.w + 8, BLOCK_H + 8);
      g.restore();
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
      // Landing guide: where the top is right now (lean included).
      const th = this.stack.length * BLOCK_H;
      const gx = this.top.x + Math.sin(this.lean) * th;
      g.fillStyle = "rgba(244,247,251,0.18)";
      g.fillRect(gx - this.top.w / 2, this.topY - this.camY - 3, this.top.w, 3);
    } else if (this.phase === "falling") {
      this.drawBlock(g, this.fall.x, this.fall.y - this.camY, this.fall.w, this.current.player.color, 0);
    }

    this.juice.end(g);
    if (this.wind.strength > 0) drawWindStreaks(g, width, PAD_Y, this.wind.dir, this.wind.strength * 0.9, this.time);
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
    const { width } = this.ctx;
    const font = "Bebas Neue, Impact, sans-serif";

    if (this.phase !== "over") {
      const cp = this.current.player;
      g.fillStyle = cp.color;
      g.font = `700 30px ${font}`;
      g.textAlign = "left";
      g.textBaseline = "top";
      g.fillText(`${cp.name}'S TURN`, 20, 12);
      // Shot clock.
      const t = this.phase === "swing" ? Math.max(0, 1 - this.phaseTime / SHOT_CLOCK) : 0;
      g.fillStyle = "rgba(7,11,20,0.55)";
      g.fillRect(20, 48, 200, 8);
      g.fillStyle = t < 0.25 ? "#FF3D7A" : cp.color;
      g.fillRect(20, 48, 200 * t, 8);
    }

    // Round banner.
    g.textAlign = "center";
    g.textBaseline = "top";
    if (this.finalRound) {
      const pulse = 0.75 + 0.25 * Math.sin(this.time * 8);
      g.fillStyle = `rgba(255,61,122,${pulse})`;
      g.font = `700 32px ${font}`;
      g.fillText(`FINAL ROUND · ${FINAL_MULT}X POINTS`, width / 2, 10);
    } else {
      const alive = this.seats.filter((s) => s.lives > 0);
      const round = alive.length ? Math.min(...alive.map((s) => s.drops)) + 1 : this.limit;
      g.fillStyle = "rgba(244,247,251,0.5)";
      g.font = `700 24px ${font}`;
      g.fillText(`ROUND ${Math.min(round, this.limit)} / ${this.limit}`, width / 2, 12);
    }

    g.fillStyle = "rgba(244,247,251,0.7)";
    g.font = `700 26px ${font}`;
    g.textAlign = "right";
    g.fillText(`HEIGHT ${this.height}`, width - 20, 12);
    let ry = 44;
    if (this.streak > 0) {
      const fire = this.streak >= FIRE_STREAK;
      g.fillStyle = fire ? "#FF3D7A" : "#FFB020";
      g.font = `700 ${fire ? 30 : 24}px ${font}`;
      g.fillText(fire ? `ON FIRE x${this.streak}` : `PERFECT x${this.streak}`, width - 20, ry);
      ry += 30;
    }
    if (this.best > 0) {
      g.fillStyle = "rgba(244,247,251,0.45)";
      g.font = `700 20px ${font}`;
      g.fillText(`BEST ${this.best}`, width - 20, ry);
    }

    // Floating pad texts.
    for (const f of this.floaters) {
      const t = 1 - f.life / f.maxLife;
      g.save();
      g.globalAlpha = Math.min(1, f.life / 0.3);
      g.font = `700 ${f.size}px ${font}`;
      g.textAlign = "center";
      g.textBaseline = "bottom";
      g.lineWidth = 5;
      g.strokeStyle = "rgba(7,11,20,0.8)";
      g.strokeText(f.text, f.x, f.y - t * 36);
      g.fillStyle = f.color;
      g.fillText(f.text, f.x, f.y - t * 36);
      g.restore();
    }

    this.drawPads(g);
  }

  private drawPads(g: CanvasRenderingContext2D): void {
    const w = this.padW();
    const font = "Bebas Neue, Impact, sans-serif";
    // Solid table edge so the scrolled-off base of the tower never bleeds through the pads.
    g.fillStyle = "#0a111c";
    g.fillRect(0, PAD_Y - 10, this.ctx.width, this.ctx.height - PAD_Y + 10);
    g.fillStyle = "rgba(244,247,251,0.08)";
    g.fillRect(0, PAD_Y - 10, this.ctx.width, 2);
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      const x = this.padX(i);
      const active = i === this.turn && this.phase !== "over";
      const out = s.lives <= 0;
      const dir = this.padDir(i);
      const ready = s.breath >= 1 && !active && this.phase !== "over";
      const underdog = this.isUnderdog(i) && !out && this.phase !== "over";

      g.save();
      g.globalAlpha = out ? 0.75 : 1;
      g.fillStyle = s.gustFlash > 0 ? `rgba(244,247,251,${0.1 + s.gustFlash * 0.25})` : "rgba(7,11,20,0.6)";
      g.fillRect(x, PAD_Y, w, PAD_H);
      g.lineWidth = active ? 3 : 2;
      g.strokeStyle = active
        ? s.player.color
        : ready ? `rgba(244,247,251,${0.35 + 0.3 * Math.sin(this.time * 6)})` : "rgba(244,247,251,0.15)";
      g.strokeRect(x + 1, PAD_Y + 1, w - 2, PAD_H - 2);

      // Name + score.
      g.fillStyle = s.player.color;
      g.font = `700 20px Outfit, sans-serif`;
      g.textAlign = "left";
      g.textBaseline = "top";
      g.fillText(`${active ? "▶ " : ""}${s.player.name}`, x + 12, PAD_Y + 10);
      g.font = `700 36px ${font}`;
      g.textAlign = "right";
      g.fillText(String(s.score), x + w - 12, PAD_Y + 4);

      // Lives + drops.
      for (let j = 0; j < START_LIVES; j++) {
        g.beginPath();
        g.arc(x + 18 + j * 14, PAD_Y + 46, 5, 0, Math.PI * 2);
        g.fillStyle = j < s.lives ? "#FF3D7A" : "rgba(244,247,251,0.15)";
        g.fill();
      }
      g.fillStyle = "rgba(244,247,251,0.6)";
      g.font = "600 13px Outfit, sans-serif";
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillText(out ? "OUT" : `${this.limit - s.drops} drops left`, x + 66, PAD_Y + 46);
      if (underdog) {
        g.fillStyle = "#FFB020";
        g.font = "700 12px Outfit, sans-serif";
        g.textAlign = "right";
        g.fillText("UNDERDOG · WIDE AIM", x + w - 12, PAD_Y + 46);
      }

      // Breath meter + action label.
      const my = PAD_Y + PAD_H - 30;
      g.fillStyle = "rgba(244,247,251,0.12)";
      g.fillRect(x + 12, my, w - 24, 8);
      if (!active) {
        g.fillStyle = ready ? "#F4F7FB" : s.player.color;
        g.fillRect(x + 12, my, (w - 24) * s.breath, 8);
      }
      g.textAlign = "center";
      g.textBaseline = "top";
      g.font = `700 16px ${font}`;
      if (this.phase === "over") {
        g.fillStyle = "rgba(244,247,251,0.4)";
        g.fillText(`${s.gusts} GUSTS`, x + w / 2, my + 11);
      } else if (active) {
        g.fillStyle = s.player.color;
        g.fillText(s.player.kind === "human" ? "TAP ANYWHERE TO DROP" : "DROPPING...", x + w / 2, my + 11);
      } else if (ready) {
        g.fillStyle = "#F4F7FB";
        g.fillText(dir > 0 ? `${out ? "GHOST WIND · " : ""}TAP TO BLOW  →` : `←  TAP TO BLOW${out ? " · GHOST WIND" : ""}`, x + w / 2, my + 11);
      } else {
        g.fillStyle = "rgba(244,247,251,0.45)";
        g.fillText(out ? "GHOST WIND REFILLING..." : "BREATH REFILLING...", x + w / 2, my + 11);
      }
      g.restore();
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
      out.push({ playerId: s.player.id, label: "Gusts", value: String(s.gusts) });
    }
    return out;
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener("pointerdown", this.onDown);
  }
}

import { fillArena } from "../../core/draw";
import { Callouts, Juice } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  blowUp, FUSE_MS, matchOver, newMatch, planBotPress, press, PLUNGERS, randomPlunger, scores,
  survivors, tension, TURN_MS, unpressed, type BotPlan, type MatchState,
} from "./logic";

export const bigBlast: GameDefinition = {
  id: "big-blast",
  name: "Big Blast",
  tagline: "Five plungers. One goes KABOOM.",
  description:
    "A giant bomb, five detonator plungers, one of them live. Take turns pressing a plunger: a dud " +
    "clicks and passes the turn, the live one blows you up and out. Survivors get a fresh bomb. " +
    "Last one standing wins. Pure luck, pure sweat.",
  durationMs: 0,
  controls: "On your turn, tap any un-pressed plunger. 4s or it's picked for you.",
  create: (ctx) => new BigBlast(ctx),
};

const FONT = "Bebas Neue, Impact, sans-serif";
const INTRO_S = 1.3;
const PHEW_S = 0.75;
const RESULT_S = 2.2;
const FINAL_S = 2.2;
const BOOM_COLORS = ["#FFE14D", "#FFB020", "#FF5A1F", "#ffffff"] as const;

type Phase = "intro" | "turn" | "phew" | "fuse" | "boom" | "final";

interface Seat {
  player: Player;
  index: number;
}

interface Plunger {
  x: number;
  y: number;
  /** 0 = up, 1 = fully sunk. */
  sink: number;
  wobble: number;
}

class BigBlast implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private match: MatchState;
  private phase: Phase = "intro";
  private timer = INTRO_S;
  private turnT = 0;
  private time = 0;
  private finished = false;
  private plungers: Plunger[] = [];
  private botPlan: BotPlan | null = null;
  private hoverDone = 0;
  private cursor = { x: 0, y: 0, tx: 0, ty: 0, press: 0, shown: false };
  private flash = 0;
  private swell = 0;
  private twitch = 0;
  private twitchT = 0;
  private hissT = 0;
  private sparkT = 0;
  private exploded = false;
  private victim: number | null = null;
  /** Seat shown as "current" during the phew beat (the turn has already passed on). */
  private presser = 0;
  private readonly s: number;
  private readonly bombX: number;
  private readonly bombY: number;
  private readonly bombR: number;
  private readonly slotW: number;
  private readonly rowY: number;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    this.seats = ctx.players.map((player, index) => ({ player, index }));
    this.match = newMatch(this.seats.length, ctx.rng);
    this.s = Math.min(1, ctx.height / 720);
    this.bombX = ctx.width / 2;
    this.bombY = ctx.height * 0.4;
    this.bombR = 125 * this.s;
    this.slotW = Math.min(210 * this.s, ctx.width / 5.4);
    this.rowY = ctx.height * 0.82;
    this.buildPlungers();
    this.cursor.x = this.cursor.tx = this.bombX;
    this.cursor.y = this.cursor.ty = this.rowY - 160 * this.s;
    this.callouts.show(`BOMB ${this.match.round}`, "#F4F7FB", { size: 80, life: INTRO_S, y: 0.3 });
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
  }

  private buildPlungers(): void {
    this.plungers = [];
    for (let i = 0; i < PLUNGERS; i++) {
      this.plungers.push({ x: this.bombX + (i - (PLUNGERS - 1) / 2) * this.slotW, y: this.rowY, sink: 0, wobble: 0 });
    }
  }

  private get active(): Seat {
    return this.seats[this.match.turn]!;
  }

  /** Seat the screen is framed for: the presser while a dud or boom plays out, else whose turn it is. */
  private get shown(): Seat {
    const i = this.phase === "phew" ? this.presser : this.phase === "boom" || this.phase === "fuse" ? (this.victim ?? this.presser) : this.match.turn;
    return this.seats[i]!;
  }

  // ---- flow ----------------------------------------------------------------

  private startTurn(): void {
    this.phase = "turn";
    this.turnT = 0;
    this.hoverDone = 0;
    this.botPlan = null;
    this.cursor.shown = false;
    this.cursor.press = 0;
    const seat = this.active;
    if (seat.player.kind === "bot") {
      this.botPlan = planBotPress(this.match.bomb, this.ctx.rng);
      this.cursor.shown = true;
      this.cursor.x = this.cursor.tx = this.bombX + (this.ctx.rng.next() - 0.5) * 200 * this.s;
      this.cursor.y = this.cursor.ty = this.rowY - 220 * this.s;
    }
    this.ctx.sfx.select();
  }

  private pressPlunger(plunger: number, forced = false): void {
    if (this.phase !== "turn") return;
    const seat = this.active;
    const res = press(this.match, seat.index, plunger);
    if (res === "ignored") return;
    this.presser = seat.index;
    const p = this.plungers[plunger]!;
    p.sink = 1;
    this.cursor.press = 1;
    this.cursor.tx = p.x;
    this.cursor.ty = p.y - 110 * this.s;
    this.ctx.sfx.select();
    this.juice.burst(p.x, p.y - 70 * this.s, [seat.player.color, "#F4F7FB"], {
      count: 8, speed: 160, gravity: 500, size: 4, life: 0.4, angle: -Math.PI / 2, spread: 1.6,
    });
    if (forced) this.callouts.show("TIME'S UP!", "#FF3D7A", { size: 48, life: 0.9, y: 0.55 });

    if (res === "dud") {
      this.phase = "phew";
      this.timer = PHEW_S;
      this.juice.shake(0.12);
      this.ctx.sfx.tick();
      // Fuse crackle.
      this.sparkBurst(14, 260);
      this.callouts.show("phew...", seat.player.color, { size: 40, life: PHEW_S, y: 0.6 });
    } else {
      this.phase = "fuse";
      this.timer = FUSE_MS / 1000;
      this.swell = 0;
      this.hissT = 0;
      this.victim = seat.index;
      this.ctx.sfx.whoosh();
    }
  }

  private detonate(): void {
    const seat = this.seats[this.victim ?? this.match.turn]!;
    this.phase = "boom";
    this.timer = RESULT_S;
    this.exploded = true;
    this.flash = 1;
    this.swell = 0;
    this.juice.shake(1);
    this.juice.hitStop(0.14);
    this.juice.burst(this.bombX, this.bombY, BOOM_COLORS, { count: 90, speed: 900, gravity: 300, size: 10, life: 1.1 });
    this.juice.burst(this.bombX, this.bombY, [seat.player.color, "#ffffff"], { count: 40, speed: 700, gravity: 500, size: 7, life: 1 });
    this.juice.burst(this.bombX, this.bombY, ["#1b1f2a", "#3a3f4b", "#5a5f6b"], { count: 50, speed: 300, gravity: -120, size: 18, life: 1.6 });
    for (const p of this.plungers) p.wobble = 1;
    this.ctx.sfx.hit();
    this.ctx.sfx.whoosh();
    this.ctx.sfx.hit();
    this.callouts.show("KABOOM!", "#FFB020", { size: 150, life: 1.1, y: 0.4 });
    this.callouts.show(`${seat.player.name} IS TOAST!`, seat.player.color, { size: 60, life: RESULT_S, y: 0.62 });
    blowUp(this.match, seat.index, this.ctx.rng);
  }

  private afterBoom(): void {
    if (matchOver(this.match)) {
      this.phase = "final";
      this.timer = FINAL_S + RESULT_S;
      const left = survivors(this.match);
      const winner = left.length === 1 ? this.seats[left[0]!] : null;
      this.callouts.show(winner ? `${winner.player.name} WINS!` : "NOBODY WINS", winner?.player.color ?? "#F4F7FB", {
        size: 84, life: FINAL_S + RESULT_S, y: 0.3,
      });
      this.ctx.sfx.win();
      return;
    }
    this.exploded = false;
    this.victim = null;
    this.buildPlungers();
    this.phase = "intro";
    this.timer = INTRO_S;
    this.callouts.show(`BOMB ${this.match.round}`, "#F4F7FB", { size: 80, life: INTRO_S, y: 0.3 });
    this.ctx.sfx.countdown();
  }

  // ---- update --------------------------------------------------------------

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += realDt;
    this.stepProps(realDt);
    if (this.finished) return;

    switch (this.phase) {
      case "intro":
        this.timer -= dt;
        if (this.timer <= 0) this.startTurn();
        return;
      case "turn":
        this.stepTurn(dt);
        return;
      case "phew":
        this.timer -= dt;
        if (this.timer <= 0) this.startTurn();
        return;
      case "fuse":
        this.timer -= dt;
        this.swell = 1 - Math.max(0, this.timer) / (FUSE_MS / 1000);
        this.hissT += dt;
        if (this.hissT >= 0.07) {
          this.hissT = 0;
          this.ctx.sfx.tick();
          this.sparkBurst(6, 320);
        }
        this.juice.shake(dt * 1.2);
        if (this.timer <= 0) this.detonate();
        return;
      case "boom":
        this.timer -= dt;
        if (this.timer <= 0) this.afterBoom();
        return;
      case "final":
        this.timer -= dt;
        if (this.timer <= 0) this.finished = true;
        return;
    }
  }

  private stepTurn(dt: number): void {
    this.turnT += dt * 1000;
    const plan = this.botPlan;
    if (plan) {
      while (this.hoverDone < plan.hovers.length && this.turnT >= plan.hovers[this.hoverDone]!.atMs) {
        const h = plan.hovers[this.hoverDone]!;
        this.hoverDone += 1;
        const p = this.plungers[h.plunger]!;
        this.cursor.tx = p.x + (this.ctx.rng.next() - 0.5) * 20;
        this.cursor.ty = p.y - 130 * this.s;
        p.wobble = 1;
        this.ctx.sfx.tick();
      }
      if (this.turnT >= plan.atMs) {
        this.pressPlunger(plan.target);
        return;
      }
      if (this.hoverDone === plan.hovers.length && this.turnT >= plan.atMs - 260) {
        const p = this.plungers[plan.target]!;
        this.cursor.tx = p.x;
        this.cursor.ty = p.y - 130 * this.s;
      }
    }
    if (this.turnT >= TURN_MS) this.pressPlunger(randomPlunger(this.match.bomb, this.ctx.rng), true);
  }

  private stepProps(dt: number): void {
    this.flash = Math.max(0, this.flash - dt * 2.2);
    const c = this.cursor;
    const k = Math.min(1, dt * 9);
    c.x += (c.tx - c.x) * k;
    c.y += (c.ty - c.y) * k;
    c.press = Math.max(0, c.press - dt * 3);
    for (const p of this.plungers) p.wobble = Math.max(0, p.wobble - dt * 2.5);

    // Nervous bomb: twitches and sparks more the fewer plungers remain.
    const t = this.exploded ? 0 : tension(this.match.bomb);
    this.twitch = Math.max(0, this.twitch - dt * 6);
    if (!this.exploded && (this.phase === "turn" || this.phase === "phew")) {
      this.twitchT += dt;
      if (this.twitchT >= 1.4 - t * 1.0) {
        this.twitchT = 0;
        this.twitch = 0.5 + t * 0.8;
        if (t > 0.5) this.ctx.sfx.tick();
      }
      this.sparkT += dt;
      const gap = 1 / (3 + t * 28);
      if (this.sparkT >= gap) {
        this.sparkT = 0;
        this.sparkBurst(1 + Math.round(t * 3), 120 + t * 160);
      }
    }
  }

  private fuseTip(): { x: number; y: number } {
    const r = this.bombR * (1 + this.swell * 0.35);
    return { x: this.bombX + r * 0.25, y: this.bombY - r - 48 * this.s };
  }

  private sparkBurst(count: number, speed: number): void {
    const tip = this.fuseTip();
    this.juice.burst(tip.x, tip.y, ["#FFE14D", "#FFB020", "#ffffff"], {
      count, speed, gravity: 350, size: 4, life: 0.4,
    });
  }

  // ---- input ---------------------------------------------------------------

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (this.phase !== "turn" || this.active.player.kind !== "human") return;
    const p = this.toLogical(e);
    const halfW = Math.max(this.ctx.minTap, this.slotW) / 2;
    const top = this.rowY - Math.max(this.ctx.minTap, 150 * this.s);
    const bottom = this.rowY + 60 * this.s;
    if (p.y < top || p.y > bottom) return;
    for (let i = 0; i < this.plungers.length; i++) {
      const pl = this.plungers[i]!;
      if (this.match.bomb.pressed[i] || Math.abs(p.x - pl.x) > halfW) continue;
      e.preventDefault();
      this.pressPlunger(i);
      return;
    }
  };

  // ---- render --------------------------------------------------------------

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.drawFloor(g);
    this.juice.begin(g);
    if (this.exploded) this.drawCrater(g);
    else this.drawBomb(g);
    this.drawPlungers(g);
    if (this.cursor.shown && this.phase === "turn") this.drawHand(g);
    this.juice.end(g);
    this.drawFrame(g);
    this.drawHud(g);
    if (this.flash > 0) {
      g.fillStyle = `rgba(255,240,200,${Math.min(1, this.flash) * 0.85})`;
      g.fillRect(0, 0, width, height);
    }
    this.callouts.draw(g, width, height);
  }

  private drawFloor(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    g.fillStyle = "rgba(60,48,40,0.5)";
    g.fillRect(0, this.rowY, width, height - this.rowY);
    g.fillStyle = "rgba(244,247,251,0.08)";
    g.fillRect(0, this.rowY, width, 3);
  }

  private drawBomb(g: CanvasRenderingContext2D): void {
    const s = this.s;
    const t = tension(this.match.bomb);
    const scale = 1 + this.swell * 0.35 + (this.phase === "fuse" ? Math.sin(this.time * 60) * 0.03 : 0);
    const jx = this.twitch * (this.ctx.rng.next() - 0.5) * 16 * s;
    const jy = this.twitch * (this.ctx.rng.next() - 0.5) * 10 * s;
    g.save();
    g.translate(this.bombX + jx, this.bombY + jy);
    g.rotate(this.twitch * Math.sin(this.time * 40) * 0.08);
    g.scale(scale, scale);
    const r = this.bombR;

    // Glow builds with tension; red-hot during the fuse.
    const glowA = 0.15 + t * 0.35 + this.swell * 0.5;
    g.shadowColor = this.phase === "fuse" ? "#FF5A1F" : "#FFB020";
    g.shadowBlur = (20 + t * 30 + this.swell * 60) * s;
    g.fillStyle = this.phase === "fuse" ? `rgb(${40 + this.swell * 160},${20 + this.swell * 30},${30})` : "#161a24";
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    g.globalAlpha = glowA * 0.5;
    g.fillStyle = "#FFB020";
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;

    // Shine.
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.beginPath();
    g.ellipse(-r * 0.35, -r * 0.4, r * 0.28, r * 0.16, -0.6, 0, Math.PI * 2);
    g.fill();

    // Cap and fuse.
    g.fillStyle = "#8a8f9a";
    g.fillRect(-r * 0.2, -r - 22 * s, r * 0.4, 30 * s);
    g.strokeStyle = "#c9a26b";
    g.lineWidth = 6 * s;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(0, -r - 20 * s);
    g.quadraticCurveTo(r * 0.05, -r - 60 * s, r * 0.25, -r - 48 * s);
    g.stroke();
    const sparkR = (6 + t * 6 + this.swell * 10) * s * (0.8 + 0.4 * Math.abs(Math.sin(this.time * 30)));
    g.fillStyle = "#FFE14D";
    g.shadowColor = "#FFB020";
    g.shadowBlur = 20 * s;
    g.beginPath();
    g.arc(r * 0.25, -r - 48 * s, sparkR, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;

    // A worried face. Eyes widen as tension climbs.
    const ey = -r * 0.1;
    const er = r * (0.09 + t * 0.06);
    g.fillStyle = "#F4F7FB";
    for (const dx of [-0.3, 0.3]) {
      g.beginPath();
      g.ellipse(r * dx, ey, er, er * 1.25, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "#070b14";
    for (const dx of [-0.3, 0.3]) {
      g.beginPath();
      g.arc(r * dx + (this.twitch * 4 * s), ey + er * 0.2, er * 0.45, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = "#F4F7FB";
    g.lineWidth = 5 * s;
    g.beginPath();
    if (this.phase === "fuse") {
      g.ellipse(0, r * 0.32, r * 0.16, r * (0.1 + this.swell * 0.15), 0, 0, Math.PI * 2);
    } else {
      g.moveTo(-r * 0.2, r * 0.35 + t * r * 0.05);
      g.quadraticCurveTo(0, r * (0.2 + t * 0.3), r * 0.2, r * 0.35 + t * r * 0.05);
    }
    g.stroke();
    g.restore();
  }

  private drawCrater(g: CanvasRenderingContext2D): void {
    const r = this.bombR;
    g.save();
    g.translate(this.bombX, this.bombY + r * 0.6);
    g.fillStyle = "rgba(10,8,8,0.8)";
    g.beginPath();
    g.ellipse(0, 0, r * 1.5, r * 0.45, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(255,90,31,0.35)";
    g.lineWidth = 4;
    g.stroke();
    g.restore();
  }

  private drawPlungers(g: CanvasRenderingContext2D): void {
    const s = this.s;
    const bomb = this.match.bomb;
    const active = this.active;
    const myTurn = this.phase === "turn";
    const boxW = this.slotW * 0.62;
    const boxH = 56 * s;
    const rod = 70 * s;
    for (let i = 0; i < this.plungers.length; i++) {
      const p = this.plungers[i]!;
      const pressed = bomb.pressed[i] ?? false;
      const open = !pressed && !this.exploded;
      const wob = p.wobble * Math.sin(this.time * 28) * 0.08;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(wob);
      if (!open) g.globalAlpha = 0.55;

      // Base box.
      g.fillStyle = "#2a2f3c";
      g.fillRect(-boxW / 2, -boxH, boxW, boxH);
      g.fillStyle = pressed ? "#4b5160" : active.player.color;
      if (!myTurn) g.fillStyle = pressed ? "#4b5160" : "#8a8f9a";
      g.fillRect(-boxW / 2, -boxH, boxW, 8 * s);
      g.strokeStyle = "rgba(7,11,20,0.8)";
      g.lineWidth = 3 * s;
      g.strokeRect(-boxW / 2, -boxH, boxW, boxH);

      // Rod and T-handle.
      const sink = pressed ? 1 : 0;
      const rodH = rod * (1 - sink * 0.85);
      g.fillStyle = "#b9bec9";
      g.fillRect(-7 * s, -boxH - rodH, 14 * s, rodH);
      g.fillStyle = pressed ? "#5a2a2a" : "#c0392b";
      const hy = -boxH - rodH - 16 * s;
      g.beginPath();
      g.roundRect(-boxW * 0.42, hy, boxW * 0.84, 18 * s, 8 * s);
      g.fill();
      g.strokeStyle = "rgba(7,11,20,0.8)";
      g.stroke();

      if (open && myTurn) {
        // Pulsing ring so the live tap targets are obvious.
        const pulse = 0.4 + 0.3 * Math.sin(this.time * 6 + i);
        g.strokeStyle = active.player.color;
        g.globalAlpha = pulse;
        g.lineWidth = 4 * s;
        g.beginPath();
        g.roundRect(-this.slotW * 0.45, -boxH - rod - 30 * s, this.slotW * 0.9, boxH + rod + 44 * s, 14 * s);
        g.stroke();
        g.globalAlpha = 1;
      }
      // Number label.
      g.fillStyle = pressed ? "rgba(244,247,251,0.3)" : "#F4F7FB";
      g.font = `700 ${Math.round(26 * s)}px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(i + 1), 0, -boxH / 2 + 4 * s);
      g.restore();
    }
  }

  private drawHand(g: CanvasRenderingContext2D): void {
    const s = this.s;
    const c = this.cursor;
    const color = this.active.player.color;
    g.save();
    g.translate(c.x, c.y + c.press * 50 * s + Math.sin(this.time * 5) * 4 * s);
    g.shadowColor = "rgba(0,0,0,0.5)";
    g.shadowBlur = 10 * s;
    g.fillStyle = color;
    g.strokeStyle = "#070b14";
    g.lineWidth = 4 * s;
    // Palm.
    g.beginPath();
    g.roundRect(-26 * s, -8 * s, 52 * s, 50 * s, 16 * s);
    g.fill();
    g.stroke();
    // Pointing finger (down toward the plungers).
    g.beginPath();
    g.roundRect(-9 * s, 20 * s, 18 * s, 48 * s, 9 * s);
    g.fill();
    g.stroke();
    // Thumb.
    g.beginPath();
    g.roundRect(-40 * s, 0, 22 * s, 16 * s, 8 * s);
    g.fill();
    g.stroke();
    g.restore();
  }

  private drawFrame(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    if (this.phase === "intro" || this.phase === "final") return;
    const seat = this.shown;
    const pulse = 0.65 + 0.35 * Math.sin(this.time * (this.phase === "fuse" ? 30 : 5));
    g.save();
    g.lineWidth = 22 * this.s;
    g.strokeStyle = seat.player.color;
    g.shadowColor = seat.player.color;
    g.shadowBlur = 30 * this.s;
    g.globalAlpha = 0.55 + 0.45 * pulse;
    g.strokeRect(0, 0, width, height);
    g.restore();
    const grad = g.createRadialGradient(width / 2, height / 2, height * 0.3, width / 2, height / 2, height * 0.95);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, hexAlpha(seat.player.color, 0.22 * pulse));
    g.fillStyle = grad;
    g.fillRect(0, 0, width, height);
  }

  private drawHud(g: CanvasRenderingContext2D): void {
    const { width } = this.ctx;
    const s = this.s;
    // Roster: living players in colour, blown-up ones blackened.
    const orbR = 26 * s;
    for (const seat of this.seats) {
      const x = 34 * s + orbR + seat.index * (orbR * 2 + 18 * s);
      const y = 34 * s + orbR;
      const alive = this.match.alive[seat.index] ?? false;
      g.save();
      if (alive && (this.phase === "turn" || this.phase === "phew" || this.phase === "fuse") && seat.index === this.shown.index) {
        g.strokeStyle = "#F4F7FB";
        g.lineWidth = 4 * s;
        g.beginPath();
        g.arc(x, y, orbR + 6 * s, 0, Math.PI * 2);
        g.stroke();
      }
      g.beginPath();
      g.arc(x, y, orbR, 0, Math.PI * 2);
      g.fillStyle = alive ? seat.player.color : "#15161a";
      g.fill();
      if (!alive) {
        g.strokeStyle = "#3a3d47";
        g.lineWidth = 3 * s;
        g.stroke();
        g.strokeStyle = "#8a8f9a";
        g.lineWidth = 4 * s;
        for (const dx of [-0.4, 0.4]) {
          g.beginPath();
          g.moveTo(x + (dx - 0.18) * orbR, y - orbR * 0.4);
          g.lineTo(x + (dx + 0.18) * orbR, y);
          g.moveTo(x + (dx + 0.18) * orbR, y - orbR * 0.4);
          g.lineTo(x + (dx - 0.18) * orbR, y);
          g.stroke();
        }
      } else {
        g.fillStyle = "#070b14";
        g.font = `700 ${Math.round(orbR)}px ${FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(seat.player.name[0] ?? "?", x, y + 1);
      }
      g.restore();
    }

    // Whose turn, and the turn clock.
    if (this.phase === "turn" || this.phase === "phew" || this.phase === "fuse") {
      const seat = this.shown;
      g.save();
      g.textAlign = "center";
      g.textBaseline = "top";
      g.font = `700 ${Math.round(54 * s)}px ${FONT}`;
      g.lineWidth = 8 * s;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      const label = this.phase === "fuse" ? "UH OH..." : `${seat.player.name.toUpperCase()}'S TURN`;
      g.strokeText(label, width / 2, 22 * s);
      g.fillStyle = seat.player.color;
      g.fillText(label, width / 2, 22 * s);
      if (this.phase === "turn") {
        const left = Math.max(0, TURN_MS - this.turnT) / TURN_MS;
        const bw = 320 * s;
        const by = 88 * s;
        g.fillStyle = "rgba(7,11,20,0.55)";
        g.fillRect(width / 2 - bw / 2, by, bw, 12 * s);
        g.fillStyle = left < 0.25 ? "#FF3D7A" : seat.player.color;
        g.fillRect(width / 2 - bw / 2, by, bw * left, 12 * s);
        if (seat.player.kind === "human") {
          g.font = `700 ${Math.round(26 * s)}px ${FONT}`;
          g.fillStyle = "rgba(244,247,251,0.6)";
          g.fillText("TAP A PLUNGER", width / 2, by + 20 * s);
        }
      }
      // Odds readout under the bomb.
      const open = unpressed(this.match.bomb).length;
      g.font = `700 ${Math.round(28 * s)}px ${FONT}`;
      g.fillStyle = open <= 2 ? "#FF3D7A" : "rgba(244,247,251,0.55)";
      g.textBaseline = "middle";
      g.fillText(`1 IN ${open} GOES BOOM`, width / 2, this.bombY + this.bombR + 42 * s);
      g.restore();
    }
  }

  // ---- lifecycle -----------------------------------------------------------

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    const sc = scores(this.match);
    return this.seats.map((seat) => ({ playerId: seat.player.id, score: sc[seat.index] ?? 0 }));
  }

  getStats(): GameStat[] {
    return this.seats.map((seat) => ({
      playerId: seat.player.id,
      label: "Survived blasts",
      value: String(this.match.survived[seat.index] ?? 0),
    }));
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener("pointerdown", this.onDown);
  }
}

/** "#RRGGBB" to "rgba(r,g,b,a)". Non-hex colours pass through unchanged. */
function hexAlpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}

import { drawPlayerOrb, fillArena } from "../../core/draw";
import { Callouts, Juice } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  applySteer,
  BAR_HALF_W,
  botSteer,
  collidePair,
  FALL_S,
  FRICTION,
  ICE_FRICTION,
  ICE_TRACTION,
  inRect,
  integrate,
  makeBall,
  matchOver,
  outside,
  padZones,
  planHazards,
  SHRINK_EVERY_S,
  SHRINK_FACTOR,
  SPIN_RATE,
  spinnerCollide,
  startPositions,
  stick,
  STICK_MAX,
  WIND_ACCEL,
  WINS_NEEDED,
  type Ball,
  type Hazard,
  type Rect,
  type Vec,
} from "./logic";

export const sumoRings: GameDefinition = {
  id: "sumo-rings",
  name: "Sumo Rings",
  tagline: "Bump them off the platform.",
  description:
    "Heavy balls on a round platform. Drag anywhere in your corner pad to steer; momentum does the rest. " +
    "Barge opponents off the edge: a ball whose centre leaves the platform falls. Every 10s the platform " +
    "SHRINKS. Each round has a hazard: ICE (no grip), SPINNER (a bar whirls through the middle) or GUST " +
    "(wind shoves everyone). Last ball standing wins the round, first to 2 rounds takes the match.",
  durationMs: 0,
  controls: "Drag in your pad to steer",
  create: (ctx) => new SumoRings(ctx),
};

const INTRO_S = 1.5;
const RESULT_S = 2.0;
const FINAL_S = 2.2;
const FONT = "Bebas Neue, Impact, sans-serif";
const PHYS_STEP = 1 / 120;
const GUST_WARN_S = 0.7;
const GUST_ON_S = 1.5;
const GUST_GAP_S = 2.2;
const BOT_THINK_S = 0.15;
const BOT_HESITATE_S = 0.3;
const HAZARD_LABEL: Record<Hazard, string> = { ice: "ICE", spinner: "SPINNER", gust: "GUST" };
const HAZARD_COLOR: Record<Hazard, string> = { ice: "#9ad9ff", spinner: "#FF3D7A", gust: "#B8FF3D" };

type Phase = "intro" | "round" | "result" | "final";

interface Stick {
  pointerId: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
}

interface Seat {
  player: Player;
  zone: Rect;
  /** Where the pad hint is drawn (a corner of the zone, away from the platform). */
  hint: Vec;
  ball: Ball;
  stick: Stick | null;
  /** Bot steering: current heading and force. */
  botDir: Vec;
  botForce: number;
  botThink: number;
  botHesitate: number;
  wins: number;
  knockouts: number;
  falls: number;
  lastHitBy: number;
  lastHitAt: number;
}

class SumoRings implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly hazards: Hazard[];
  private readonly cx: number;
  private readonly cy: number;
  private readonly ringStart: number;
  private ringR: number;
  private ringTarget: number;
  private phase: Phase = "intro";
  private timer = INTRO_S;
  private roundIndex = 0;
  private roundT = 0;
  private time = 0;
  private shrinkIn = SHRINK_EVERY_S;
  private shrinks = 0;
  private spinAngle = 0;
  private gustT = 0;
  private gustAngle = 0;
  private gustState: "gap" | "warn" | "on" = "gap";
  private resultText = "";
  private resultColor = "#F4F7FB";
  private finished = false;
  private goShown = false;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    this.cx = ctx.width / 2;
    this.cy = ctx.height / 2;
    this.ringStart = Math.min(ctx.width, ctx.height) * 0.42;
    this.ringR = this.ringStart;
    this.ringTarget = this.ringStart;
    this.hazards = planHazards(ctx.rng);
    const n = ctx.players.length;
    const zones = padZones(n, ctx.width, ctx.height);
    this.seats = ctx.players.map((player, i) => {
      const zone = zones[i]!;
      const left = zone.x + zone.w / 2 < this.cx;
      const top = zone.y + zone.h / 2 < this.cy;
      const hint = { x: left ? zone.x + 150 : zone.x + zone.w - 150, y: top ? zone.y + 150 : zone.y + zone.h - 150 };
      return {
        player, zone, hint, ball: makeBall(0, 0), stick: null,
        botDir: { x: 0, y: 0 }, botForce: 0, botThink: ctx.rng.float(0, BOT_THINK_S), botHesitate: 0,
        wins: 0, knockouts: 0, falls: 0, lastHitBy: -1, lastHitAt: -10,
      };
    });
    this.startRound();
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
  }

  private get hazard(): Hazard {
    return this.hazards[this.roundIndex] ?? "ice";
  }

  private startRound(): void {
    this.ringR = this.ringStart;
    this.ringTarget = this.ringStart;
    this.roundT = 0;
    this.shrinkIn = SHRINK_EVERY_S;
    this.shrinks = 0;
    this.spinAngle = this.ctx.rng.float(0, Math.PI * 2);
    this.gustState = "gap";
    this.gustT = GUST_GAP_S * 0.6;
    this.goShown = false;
    const spots = startPositions(this.seats.length, this.cx, this.cy, this.ringStart);
    this.seats.forEach((s, i) => {
      const p = spots[i]!;
      s.ball = makeBall(p.x, p.y);
      s.stick = null;
      s.botForce = 0;
      s.botHesitate = 0;
      s.lastHitBy = -1;
      s.lastHitAt = -10;
    });
    this.phase = "intro";
    this.timer = INTRO_S;
    this.callouts.show(`ROUND ${this.roundIndex + 1}`, "#F4F7FB", { size: 80, y: 0.3, life: INTRO_S });
    this.callouts.show(`HAZARD: ${HAZARD_LABEL[this.hazard]}`, HAZARD_COLOR[this.hazard], { size: 48, y: 0.42, life: INTRO_S });
    this.ctx.sfx.countdown();
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += realDt;
    if (this.finished) return;

    // Falling balls animate in every phase.
    for (const s of this.seats) {
      if (!s.ball.alive && s.ball.fall < 1) {
        s.ball.fall = Math.min(1, s.ball.fall + dt / FALL_S);
        s.ball.vy += 300 * dt;
        integrate(s.ball, dt);
      }
    }

    if (this.phase === "intro") {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = "round";
        if (!this.goShown) {
          this.goShown = true;
          this.callouts.show("GO!", "#FFB020", { size: 110, y: 0.35, life: 0.7 });
          this.ctx.sfx.go();
        }
      }
      return;
    }
    if (this.phase === "result" || this.phase === "final") {
      this.timer -= dt;
      if (this.timer > 0) return;
      if (this.phase === "final") {
        this.finished = true;
        return;
      }
      this.roundIndex += 1;
      this.startRound();
      return;
    }

    this.stepRound(dt);
  }

  private stepRound(dt: number): void {
    this.roundT += dt;

    // Platform shrink.
    this.shrinkIn -= dt;
    if (this.shrinkIn <= 0) {
      this.shrinkIn += SHRINK_EVERY_S;
      this.shrinks += 1;
      this.ringTarget *= SHRINK_FACTOR;
      this.callouts.show("SHRINK!", "#FF3D7A", { size: 72, y: 0.3, life: 1.1 });
      this.juice.shake(0.3);
      this.ctx.sfx.countdown();
    }
    const gap = this.ringTarget - this.ringR;
    this.ringR += gap * Math.min(1, dt * 7);

    // Hazard state.
    const hz = this.hazard;
    if (hz === "spinner") this.spinAngle += SPIN_RATE * dt;
    if (hz === "gust") this.stepGust(dt);

    // Bots think.
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (s.player.kind !== "bot" || !s.ball.alive) continue;
      this.botTick(s, dt);
    }

    // Physics in fixed substeps.
    const friction = hz === "ice" ? ICE_FRICTION : FRICTION;
    const traction = hz === "ice" ? ICE_TRACTION : 1;
    let remaining = Math.min(dt, 0.05);
    while (remaining > 0) {
      const h = Math.min(PHYS_STEP, remaining);
      remaining -= h;
      this.physicsStep(h, friction, traction);
    }

    // Fall checks.
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (s.ball.alive && outside(s.ball, this.cx, this.cy, this.ringR)) this.knockOut(i);
    }

    const alive = this.seats.filter((s) => s.ball.alive);
    if (alive.length <= 1 || this.roundT > 60) this.endRound(alive.length === 1 ? alive[0]! : null);
  }

  private physicsStep(h: number, friction: number, traction: number): void {
    const balls = this.seats.map((s) => s.ball);
    for (const s of this.seats) {
      if (!s.ball.alive) continue;
      if (s.stick) {
        const st = stick(s.stick.ox, s.stick.oy, s.stick.x, s.stick.y);
        applySteer(s.ball, st.dir, st.force, h, traction);
      } else if (s.player.kind === "bot") {
        applySteer(s.ball, s.botDir, s.botForce, h, traction);
      }
      if (this.hazard === "gust" && this.gustState === "on") {
        s.ball.vx += Math.cos(this.gustAngle) * WIND_ACCEL * h;
        s.ball.vy += Math.sin(this.gustAngle) * WIND_ACCEL * h;
      }
    }
    for (const b of balls) if (b.alive) integrate(b, h, friction);
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i]!;
        const b = balls[j]!;
        const impulse = collidePair(a, b);
        if (impulse > 0) this.onBump(i, j, impulse);
      }
    }
    if (this.hazard === "spinner") {
      const halfLen = this.ringR * 0.8;
      for (let i = 0; i < balls.length; i++) {
        const b = balls[i]!;
        if (spinnerCollide(b, this.cx, this.cy, this.spinAngle, halfLen)) {
          const s = this.seats[i]!;
          s.lastHitBy = -1;
          this.juice.burst(b.x, b.y, ["#FF3D7A", "#ffffff"], { count: 10, speed: 260, gravity: 0, life: 0.35, size: 5 });
          this.juice.shake(0.12);
          this.ctx.sfx.whoosh();
        }
      }
    }
  }

  private onBump(i: number, j: number, impulse: number): void {
    const a = this.seats[i]!;
    const b = this.seats[j]!;
    a.lastHitBy = j;
    b.lastHitBy = i;
    a.lastHitAt = this.roundT;
    b.lastHitAt = this.roundT;
    // impulse ~ mass * speed; normalise by mass so 1 = a 1px/s nudge.
    const strength = impulse / a.ball.mass;
    if (strength < 60) return;
    const mx = (a.ball.x + b.ball.x) / 2;
    const my = (a.ball.y + b.ball.y) / 2;
    const big = strength > 320;
    this.juice.burst(mx, my, [a.player.color, b.player.color, "#ffffff"], {
      count: big ? 18 : 8, speed: big ? 320 : 180, gravity: 0, life: 0.4, size: big ? 6 : 4,
    });
    this.juice.shake(big ? 0.3 : 0.12);
    if (big) this.juice.hitStop(0.04);
    this.ctx.sfx.hit();
  }

  private knockOut(i: number): void {
    const s = this.seats[i]!;
    s.ball.alive = false;
    s.ball.fall = 0;
    s.falls += 1;
    // Keep it sliding off the edge.
    const sp = Math.hypot(s.ball.vx, s.ball.vy);
    if (sp < 120) {
      const ax = s.ball.x - this.cx;
      const ay = s.ball.y - this.cy;
      const d = Math.hypot(ax, ay) || 1;
      s.ball.vx = (ax / d) * 160;
      s.ball.vy = (ay / d) * 160;
    }
    const by = s.lastHitBy >= 0 && this.roundT - s.lastHitAt < 2 ? this.seats[s.lastHitBy] : undefined;
    if (by && by.ball.alive) {
      by.knockouts += 1;
      this.callouts.show(`${by.player.name} BUMPS ${s.player.name}!`, by.player.color, { size: 52, y: 0.22, life: 1.2 });
    } else {
      this.callouts.show(`${s.player.name} FALLS!`, s.player.color, { size: 52, y: 0.22, life: 1.2 });
    }
    this.juice.burst(s.ball.x, s.ball.y, [s.player.color, "#ffffff"], { count: 22, speed: 300, gravity: 400, size: 6 });
    this.juice.shake(0.45);
    this.juice.hitStop(0.06);
    this.ctx.sfx.miss();
  }

  private endRound(winner: Seat | null): void {
    if (this.phase !== "round") return;
    if (winner) {
      winner.wins += 1;
      this.resultText = `${winner.player.name} HOLDS THE RING`;
      this.resultColor = winner.player.color;
      this.ctx.sfx.collect();
    } else {
      this.resultText = "EVERYONE FELL! NO POINT";
      this.resultColor = "#FF3D7A";
    }
    const wins = this.seats.map((s) => s.wins);
    if (matchOver(wins, this.roundIndex + 1)) {
      this.phase = "final";
      this.timer = RESULT_S + FINAL_S;
      const top = Math.max(...wins);
      const leaders = this.seats.filter((s) => s.wins === top);
      const text = top === 0 ? "NO WINNER" : leaders.map((s) => s.player.name).join(" & ") + " WINS!";
      this.callouts.show(text, leaders.length === 1 && top > 0 ? leaders[0]!.player.color : "#F4F7FB", {
        size: 84, life: RESULT_S + FINAL_S, y: 0.3,
      });
      this.ctx.sfx.win();
    } else {
      this.phase = "result";
      this.timer = RESULT_S;
      this.callouts.show(this.resultText, this.resultColor, { size: 60, y: 0.3, life: RESULT_S });
    }
  }

  private stepGust(dt: number): void {
    this.gustT -= dt;
    if (this.gustT > 0) return;
    if (this.gustState === "gap") {
      this.gustState = "warn";
      this.gustT = GUST_WARN_S;
      this.gustAngle = this.ctx.rng.float(0, Math.PI * 2);
      this.ctx.sfx.tick();
    } else if (this.gustState === "warn") {
      this.gustState = "on";
      this.gustT = GUST_ON_S;
      this.callouts.show("GUST!", "#B8FF3D", { size: 64, y: 0.3, life: 0.9 });
      this.juice.shake(0.2);
      this.ctx.sfx.whoosh();
    } else {
      this.gustState = "gap";
      this.gustT = GUST_GAP_S + this.ctx.rng.float(-0.5, 0.8);
    }
  }

  private botTick(s: Seat, dt: number): void {
    if (s.botHesitate > 0) {
      s.botHesitate -= dt;
      s.botForce = 0;
      return;
    }
    s.botThink -= dt;
    if (s.botThink > 0) return;
    s.botThink = BOT_THINK_S + this.ctx.rng.float(-0.05, 0.08);
    const rng = this.ctx.rng;
    if (rng.next() < 0.07) {
      s.botHesitate = BOT_HESITATE_S;
      s.botForce = 0;
      return;
    }
    const others = this.seats.map((o) => o.ball);
    s.botDir = botSteer(s.ball, others, this.cx, this.cy, this.ringR, rng);
    // Lean into the wind a little while it blows.
    if (this.hazard === "gust" && this.gustState !== "gap") {
      s.botDir = {
        x: s.botDir.x - Math.cos(this.gustAngle) * 0.8,
        y: s.botDir.y - Math.sin(this.gustAngle) * 0.8,
      };
      const d = Math.hypot(s.botDir.x, s.botDir.y) || 1;
      s.botDir = { x: s.botDir.x / d, y: s.botDir.y / d };
    }
    s.botForce = rng.float(0.6, 1);
  }

  // Input -------------------------------------------------------------------

  private toLogical(e: PointerEvent): Vec {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private readonly onDown = (e: PointerEvent): void => {
    const p = this.toLogical(e);
    for (const s of this.seats) {
      if (s.player.kind !== "human" || s.stick) continue;
      if (inRect(p, s.zone)) {
        e.preventDefault();
        s.stick = { pointerId: e.pointerId, ox: p.x, oy: p.y, x: p.x, y: p.y };
        try { this.ctx.canvas.setPointerCapture(e.pointerId); } catch { /* optional */ }
        return;
      }
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    const s = this.seats.find((seat) => seat.stick?.pointerId === e.pointerId);
    if (!s || !s.stick) return;
    e.preventDefault();
    const p = this.toLogical(e);
    s.stick.x = p.x;
    s.stick.y = p.y;
  };

  private readonly onUp = (e: PointerEvent): void => {
    const s = this.seats.find((seat) => seat.stick?.pointerId === e.pointerId);
    if (!s) return;
    s.stick = null;
  };

  // Render ------------------------------------------------------------------

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.drawPads(g);
    this.juice.begin(g);
    this.drawPlatform(g);
    if (this.hazard === "gust" && this.gustState !== "gap") this.drawGust(g);
    this.drawBalls(g);
    this.juice.end(g);
    this.drawSticks(g);
    this.drawHud(g);
    this.callouts.draw(g, width, height);
  }

  private drawPads(g: CanvasRenderingContext2D): void {
    for (const s of this.seats) {
      const z = s.zone;
      g.save();
      g.globalAlpha = s.ball.alive ? 0.07 : 0.03;
      g.fillStyle = s.player.color;
      g.fillRect(z.x, z.y, z.w, z.h);
      g.globalAlpha = s.ball.alive ? 0.6 : 0.25;
      // Pad hint ring.
      g.strokeStyle = s.player.color;
      g.lineWidth = 3;
      g.setLineDash([10, 8]);
      g.beginPath();
      g.arc(s.hint.x, s.hint.y, STICK_MAX, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
      g.restore();
    }
  }

  private drawPlatform(g: CanvasRenderingContext2D): void {
    const { cx, cy, ringR } = this;
    const hz = this.hazard;
    g.save();
    // Drop shadow into the void.
    g.fillStyle = "rgba(0,0,0,0.45)";
    g.beginPath();
    g.ellipse(cx, cy + 26, ringR * 1.04, ringR * 0.98, 0, 0, Math.PI * 2);
    g.fill();
    // Rim.
    g.fillStyle = hz === "ice" ? "#5f86a8" : "#5a3a24";
    g.beginPath();
    g.arc(cx, cy, ringR + 14, 0, Math.PI * 2);
    g.fill();
    // Deck.
    const grad = g.createRadialGradient(cx - ringR * 0.3, cy - ringR * 0.3, ringR * 0.1, cx, cy, ringR);
    if (hz === "ice") {
      grad.addColorStop(0, "#e8f7ff");
      grad.addColorStop(1, "#8fc8ee");
    } else {
      grad.addColorStop(0, "#e9b97c");
      grad.addColorStop(1, "#b9793f");
    }
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, ringR, 0, Math.PI * 2);
    g.fill();
    // Concentric rings.
    g.strokeStyle = hz === "ice" ? "rgba(40,90,140,0.25)" : "rgba(60,30,10,0.28)";
    g.lineWidth = 3;
    for (const k of [0.33, 0.66]) {
      g.beginPath();
      g.arc(cx, cy, ringR * k, 0, Math.PI * 2);
      g.stroke();
    }
    g.lineWidth = 6;
    g.beginPath();
    g.arc(cx, cy, ringR - 4, 0, Math.PI * 2);
    g.stroke();
    if (hz === "ice") {
      // Sparkles.
      g.fillStyle = "rgba(255,255,255,0.8)";
      for (let i = 0; i < 14; i++) {
        const a = i * 2.4 + this.time * 0.1;
        const d = ringR * (0.2 + ((i * 37) % 70) / 100);
        const tw = 0.5 + 0.5 * Math.sin(this.time * 3 + i);
        g.globalAlpha = tw * 0.8;
        g.fillRect(cx + Math.cos(a) * d - 2, cy + Math.sin(a) * d - 2, 4, 4);
      }
      g.globalAlpha = 1;
    }
    // Shrink warning pulse on the edge.
    if (this.phase === "round" && this.shrinkIn < 1.5) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 18);
      g.strokeStyle = `rgba(255,61,122,${0.3 + pulse * 0.6})`;
      g.lineWidth = 8;
      g.beginPath();
      g.arc(cx, cy, ringR + 6, 0, Math.PI * 2);
      g.stroke();
    }
    if (hz === "spinner") this.drawSpinner(g);
    g.restore();
  }

  private drawSpinner(g: CanvasRenderingContext2D): void {
    const halfLen = this.ringR * 0.8;
    g.save();
    g.translate(this.cx, this.cy);
    g.rotate(this.spinAngle);
    g.fillStyle = "#2a1d3a";
    g.fillRect(-halfLen, -BAR_HALF_W, halfLen * 2, BAR_HALF_W * 2);
    g.fillStyle = "#FF3D7A";
    const stripe = 28;
    for (let x = -halfLen; x < halfLen; x += stripe * 2) {
      g.fillRect(x, -BAR_HALF_W + 3, Math.min(stripe, halfLen - x), BAR_HALF_W * 2 - 6);
    }
    g.fillStyle = "#F4F7FB";
    g.beginPath();
    g.arc(0, 0, 20, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  private drawGust(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    const on = this.gustState === "on";
    const alpha = on ? 0.55 : 0.25 + 0.2 * Math.sin(this.time * 20);
    const ux = Math.cos(this.gustAngle);
    const uy = Math.sin(this.gustAngle);
    g.save();
    g.globalAlpha = alpha;
    g.strokeStyle = "#B8FF3D";
    g.fillStyle = "#B8FF3D";
    g.lineWidth = 5;
    g.lineCap = "round";
    const spacing = 150;
    const speed = on ? 420 : 120;
    const off = (this.time * speed) % spacing;
    const diag = Math.hypot(width, height);
    const px = -uy;
    const py = ux;
    for (let a = -diag / 2; a <= diag / 2; a += spacing) {
      for (let b = -diag / 2 - spacing + off; b <= diag / 2; b += spacing) {
        const x = this.cx + ux * b + px * a;
        const y = this.cy + uy * b + py * a;
        g.beginPath();
        g.moveTo(x - ux * 30, y - uy * 30);
        g.lineTo(x + ux * 30, y + uy * 30);
        g.stroke();
        g.beginPath();
        g.moveTo(x + ux * 30, y + uy * 30);
        g.lineTo(x + ux * 12 + px * 14, y + uy * 12 + py * 14);
        g.lineTo(x + ux * 12 - px * 14, y + uy * 12 - py * 14);
        g.closePath();
        g.fill();
      }
    }
    g.restore();
  }

  private drawBalls(g: CanvasRenderingContext2D): void {
    for (const s of this.seats) {
      const b = s.ball;
      if (!b.alive && b.fall >= 1) continue;
      const scale = b.alive ? 1 : 1 - b.fall * 0.85;
      g.save();
      g.globalAlpha = b.alive ? 1 : 1 - b.fall;
      // Ground shadow.
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.beginPath();
      g.ellipse(b.x + 6, b.y + 10, b.r * scale, b.r * 0.8 * scale, 0, 0, Math.PI * 2);
      g.fill();
      drawPlayerOrb(g, b.x, b.y, b.r * scale, s.player);
      // Motion streak.
      const sp = Math.hypot(b.vx, b.vy);
      if (b.alive && sp > 200) {
        g.strokeStyle = s.player.color;
        g.globalAlpha = Math.min(0.5, (sp - 200) / 600);
        g.lineWidth = 6;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(b.x, b.y);
        g.lineTo(b.x - (b.vx / sp) * Math.min(90, sp * 0.15), b.y - (b.vy / sp) * Math.min(90, sp * 0.15));
        g.stroke();
      }
      g.restore();
    }
  }

  private drawSticks(g: CanvasRenderingContext2D): void {
    for (const s of this.seats) {
      let ox: number;
      let oy: number;
      let dir: Vec;
      let force: number;
      if (s.stick) {
        const st = stick(s.stick.ox, s.stick.oy, s.stick.x, s.stick.y);
        ox = s.stick.ox;
        oy = s.stick.oy;
        dir = st.dir;
        force = st.force;
      } else if (s.player.kind === "bot" && this.phase === "round" && s.ball.alive) {
        ox = s.hint.x;
        oy = s.hint.y;
        dir = s.botDir;
        force = s.botForce;
      } else {
        continue;
      }
      g.save();
      g.globalAlpha = 0.85;
      g.strokeStyle = s.player.color;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(ox, oy, STICK_MAX, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = s.player.color;
      g.beginPath();
      g.arc(ox + dir.x * force * STICK_MAX, oy + dir.y * force * STICK_MAX, 32, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }

  private drawHud(g: CanvasRenderingContext2D): void {
    g.save();
    g.textBaseline = "middle";
    for (const s of this.seats) {
      const z = s.zone;
      const left = z.x + z.w / 2 < this.cx;
      const top = z.y + z.h / 2 < this.cy;
      const x = left ? z.x + 24 : z.x + z.w - 24;
      const y = top ? z.y + 36 : z.y + z.h - 36;
      g.textAlign = left ? "left" : "right";
      g.font = `700 34px ${FONT}`;
      g.fillStyle = s.ball.alive ? s.player.color : "rgba(244,247,251,0.35)";
      g.fillText(s.player.kind === "bot" ? `${s.player.name} (BOT)` : s.player.name, x, y);
      // Win pips.
      const pipY = top ? y + 32 : y - 32;
      for (let k = 0; k < WINS_NEEDED; k++) {
        const px = left ? x + 12 + k * 30 : x - 12 - k * 30;
        g.beginPath();
        g.arc(px, pipY, 10, 0, Math.PI * 2);
        g.fillStyle = k < s.wins ? s.player.color : "rgba(244,247,251,0.15)";
        g.fill();
      }
      if (s.player.kind === "human" && this.phase === "round" && s.ball.alive && !s.stick) {
        g.textAlign = "center";
        g.font = `700 22px ${FONT}`;
        g.fillStyle = "rgba(244,247,251,0.45)";
        g.fillText("DRAG HERE", s.hint.x, s.hint.y);
      }
    }
    // Shrink countdown and hazard tag at the top centre.
    if (this.phase === "round") {
      g.textAlign = "center";
      g.font = `700 28px ${FONT}`;
      g.fillStyle = HAZARD_COLOR[this.hazard];
      g.fillText(HAZARD_LABEL[this.hazard], this.cx, 26);
      g.font = `700 22px ${FONT}`;
      g.fillStyle = this.shrinkIn < 3 ? "#FF3D7A" : "rgba(244,247,251,0.6)";
      g.fillText(`SHRINK IN ${Math.ceil(this.shrinkIn)}`, this.cx, 54);
    }
    g.restore();
  }

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({ playerId: s.player.id, score: s.wins }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const s of this.seats) {
      out.push({ playerId: s.player.id, label: "Bump-offs", value: String(s.knockouts) });
      out.push({ playerId: s.player.id, label: "Falls", value: String(s.falls) });
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

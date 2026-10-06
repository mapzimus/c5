import { Rng } from "../../../core/rng";
import type { GameContext, GameDefinition, GameInstance } from "../../../core/types";
import { BOARD, COLORS, DropWorld, RADII } from "./physics";
import { UI, display, drawOrb, label } from "./draw";
import { fillArena } from "../../../core/draw";
import { LEVELS, levelIndex, shotClock } from "./levels";
import { botAim } from "./rules";
import { Callouts, Juice } from "../../../fx/juice";
import { ModePicker } from "../../mode-picker";
import { LuckyDropVersus } from "./versus";

export const luckyDrop: GameDefinition = {
  id: "lucky-drop",
  name: "Lucky Drop",
  tagline: "Drop, match, multiply. A little skill. A little luck.",
  description: "Unlimited drops, but a shot clock drops for you if you wait too long, and it speeds up as your score climbs. Bigger orbs (8s, 16s) start dropping too. Match identical orbs, build chains, and shake the board. Make 128 for a 1,000-point bonus; every size up doubles it, all the way to 4096. Take turns on fresh boards, or play Versus: two boards side by side on the same drops, at the same time. Highest score wins when every board overflows.",
  durationMs: 0,
  controls: "Pick Turns or Versus · Drag and release to drop · Arrows/A-D to aim · Space/seat action to drop · S or Shake to nudge",
  create: ctx => new ModePicker(ctx, "LUCKY DROP", [
    { title: "TAKE TURNS", line1: "One board, one player", line2: "at a time.", color: LIME, create: c => new LuckyDropGame(c) },
    { title: "VERSUS", line1: "Two boards at once,", line2: "same drops. Beat their score.", color: "#FF3D7A", create: c => new LuckyDropVersus(c) },
  ], ctx.players.length < 2 || ctx.players.every(p => p.kind === "bot")),
};

const LIME = UI.lime;
const BX = 400, BY = 48;
const SHAKE = { x: 950, y: 290, w: 220, h: 68 };
interface Floater { x: number; y: number; text: string; color: string; life: number }
interface Ring { x: number; y: number; radius: number; color: string; life: number }

/** Runs inside C5's canvas, input, audio and results lifecycle. No extra animation loop. */
export class LuckyDropGame implements GameInstance {
  private world: DropWorld;
  private readonly seed: number;
  private readonly scores: { playerId: string; score: number }[];
  private turn = 0;
  private aim = 240;
  private accumulator = 0;
  private botWait = 0.9;
  /** Seconds left before the current orb drops on its own. */
  private shotLeft = shotClock(0);
  private intermission = 0;
  private done = false;
  private pointerId: number | null = null;
  private pendingDrop = false;
  private floaters: Floater[] = [];
  private rings: Ring[] = [];
  private best = 0;
  /** Best at the start of the current run: the bar to beat for the live "NEW BEST!". */
  private runBest = 0;
  private bestAnnounced = false;
  private level = 0;
  private flash = 0;
  private heartbeat = 0;
  private pulse = 0;
  private chainPop = 0;
  private readonly juice = new Juice();
  private readonly callouts = new Callouts();
  private readonly oldTouchAction: string;

  constructor(private readonly ctx: GameContext) {
    this.seed = ctx.rng.int(1, 0x7fffffff);
    this.world = this.newWorld();
    this.scores = ctx.players.map(player => ({ playerId: player.id, score: 0 }));
    this.oldTouchAction = ctx.canvas.style.touchAction;
    ctx.canvas.style.touchAction = "none";
    ctx.canvas.addEventListener("pointerdown", this.pointerDown);
    ctx.canvas.addEventListener("pointermove", this.pointerMove);
    ctx.canvas.addEventListener("pointerup", this.pointerUp);
    ctx.canvas.addEventListener("pointercancel", this.pointerCancel);
    try { this.best = Number(localStorage.getItem("c5-lucky-drop-best")) || 0; } catch { /* Storage is optional. */ }
    this.runBest = this.best;
  }

  private newWorld(): DropWorld {
    // Shake randomness is separate, so everyone gets the same unlimited drop sequence.
    const drops = new Rng(this.seed), shakes = new Rng(this.seed ^ 0x5f3759df);
    return new DropWorld(() => drops.next(), () => shakes.next());
  }

  private point(event: PointerEvent): { x: number; y: number } {
    const rect = this.ctx.canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * this.ctx.width / Math.max(1, rect.width),
      y: (event.clientY - rect.top) * this.ctx.height / Math.max(1, rect.height) };
  }

  private onBoard(p: { x: number; y: number }): boolean {
    return p.x >= BX && p.x <= BX + BOARD.width && p.y >= BY && p.y <= BY + BOARD.height;
  }

  private readonly pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary || this.ctx.players[this.turn]?.kind !== "human" || this.intermission > 0 || this.done) return;
    const p = this.point(event);
    if (!this.onBoard(p)) return;
    event.preventDefault();
    this.aim = this.world.clampAim(p.x - BX);
    this.pointerId = event.pointerId;
    this.ctx.canvas.setPointerCapture(event.pointerId);
  };

  private readonly pointerMove = (event: PointerEvent): void => {
    if (!event.isPrimary || this.ctx.players[this.turn]?.kind !== "human") return;
    const p = this.point(event);
    if (this.onBoard(p) || this.pointerId === event.pointerId) this.aim = this.world.clampAim(p.x - BX);
  };

  private readonly pointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.aim = this.world.clampAim(this.point(event).x - BX);
    this.pendingDrop = true;
    this.releasePointer();
  };

  private readonly pointerCancel = (): void => { this.releasePointer(); this.pendingDrop = false; };

  private releasePointer(): void {
    if (this.pointerId !== null && this.ctx.canvas.hasPointerCapture(this.pointerId)) {
      this.ctx.canvas.releasePointerCapture(this.pointerId);
    }
    this.pointerId = null;
  }

  update(dt: number): void {
    if (this.done) return;
    dt = Math.min(dt, 0.05);
    const click = this.ctx.input.consumeClick();
    // Hit-stop only freezes the physics; clocks and turns keep real time.
    const simDt = this.juice.update(dt);
    this.callouts.update(dt);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.pulse = Math.max(0, this.pulse - dt * 4);
    this.chainPop = Math.max(0, this.chainPop - dt * 5);
    for (const item of this.floaters) { item.life -= dt; item.y -= dt * 26; }
    for (const item of this.rings) item.life -= dt;
    this.floaters = this.floaters.filter(item => item.life > 0);
    this.rings = this.rings.filter(item => item.life > 0);

    if (this.intermission > 0) {
      this.pendingDrop = false;
      this.intermission -= dt;
      if (this.intermission <= 0) {
        this.turn++;
        if (this.turn >= this.ctx.players.length) { this.done = true; return; }
        this.world = this.newWorld();
        this.aim = 240;
        this.accumulator = 0;
        this.botWait = 0.9;
        this.shotLeft = shotClock(0);
        this.floaters = [];
        this.rings = [];
        this.runBest = this.best;
        this.bestAnnounced = false;
        this.level = 0;
        this.heartbeat = 0;
      }
      return;
    }

    const player = this.ctx.players[this.turn];
    if (player.kind === "bot") {
      this.pendingDrop = false;
      this.botWait -= dt;
      if (this.botWait <= 0) {
        if (this.world.charge === 6 && this.world.balls.some(ball => ball.y < 260)) this.shake();
        this.aim = botAim(this.world);
        this.drop();
        this.botWait = 0.85;
      }
    } else {
      const input = this.ctx.input;
      const left = input.isDown("ArrowLeft") || input.isDown("KeyA") || input.axis(player.slot).x < 0;
      const right = input.isDown("ArrowRight") || input.isDown("KeyD") || input.axis(player.slot).x > 0;
      this.aim = this.world.clampAim(this.aim + (Number(right) - Number(left)) * dt * 300);
      if (this.pendingDrop || input.justPressed("Space") || input.actionPressed(player.slot)) this.drop();
      const before = this.shotLeft;
      this.shotLeft -= dt;
      // Last two seconds: tick on each whole second.
      if ((before > 2 && this.shotLeft <= 2) || (before > 1 && this.shotLeft <= 1)) this.ctx.sfx.tick();
      if (this.shotLeft <= 0) {
        // Out of time: drop wherever the aim is now.
        this.releasePointer();
        this.drop();
      }
      if (input.justPressed("KeyS") || (click && click.x >= SHAKE.x && click.x <= SHAKE.x + SHAKE.w &&
        click.y >= SHAKE.y && click.y <= SHAKE.y + SHAKE.h)) this.shake();
      this.pendingDrop = false;
    }

    this.accumulator += simDt;
    while (this.accumulator >= 1 / 120) {
      this.world.step(1 / 120);
      this.accumulator -= 1 / 120;
    }
    for (const event of this.world.events) {
      if (event.type === "merge") {
        const color = COLORS[event.tier];
        this.floaters.push({ x: event.x, y: event.y, text: `+${event.points}`, color, life: 1 });
        this.rings.push({ x: event.x, y: event.y, radius: RADII[event.tier], color, life: 0.45 });
        this.ctx.sfx.streak(event.chain);
        const t = event.tier;
        this.juice.burst(event.x, event.y, [color, "#ffffff"], { count: 6 + t * 3, speed: 140 + t * 28, size: 3 + t * 0.5, life: 0.45 + t * 0.04, gravity: 380 });
        this.juice.shake(t >= 7 ? 0.35 + (t - 7) * 0.1 : 0.02 + t * 0.025);
        if (event.chain >= 2) this.chainPop = 1;
        if (event.chain === 3) this.callouts.show("CHAIN ×3!", COLORS[5], { size: 52, y: 0.44, life: 0.9 });
        else if (event.chain === 5) this.callouts.show("MAX CHAIN ×5!", COLORS[8], { size: 64, y: 0.44, life: 1.1 });
      } else if (event.type === "burst") {
        this.floaters.push({ x: 240, y: 280, text: `${2 ** event.tier}! +${event.bonus.toLocaleString()}`, color: COLORS[event.tier], life: 2 });
        this.ctx.sfx.win();
        this.juice.burst(event.x, event.y, [COLORS[event.tier], LIME, "#ffffff"], { count: 40 + (event.tier - 7) * 12, speed: 420, size: 7, life: 1.1 });
        this.juice.shake(0.5);
        this.juice.hitStop(0.05);
      }
    }
    this.world.events = [];
    this.scores[this.turn].score = this.world.score;
    const level = levelIndex(this.world.score);
    if (level > this.level) this.levelUp(level);
    if (!this.bestAnnounced && this.runBest > 0 && this.world.score > this.runBest) {
      this.bestAnnounced = true;
      this.callouts.show("NEW BEST!", LIME, { size: 72, y: 0.2, life: 1.6 });
      this.juice.burst(240, 120, [LIME, "#ffe071", "#ffffff"], { count: 36, speed: 360, size: 6, life: 1 });
      this.ctx.sfx.win();
    }
    this.heartbeatStep(dt);
    if (this.world.score > this.best) {
      this.best = this.world.score;
      try { localStorage.setItem("c5-lucky-drop-best", String(this.best)); } catch { /* Storage is optional. */ }
    }
    if (this.world.over) {
      this.releasePointer();
      this.pendingDrop = false;
      this.intermission = 2.5;
      this.ctx.sfx.miss();
    }
  }

  private levelUp(level: number): void {
    const prev = LEVELS[this.level]!, next = LEVELS[level]!;
    this.level = level;
    const news = next.odds[4] && !prev.odds[4] ? " · 16s NOW DROP" : next.odds[3] && !prev.odds[3] ? " · 8s NOW DROP" : "";
    this.callouts.show(`LEVEL ${level + 1}${news}`, LIME, { size: 56, y: 0.3, life: 1.8 });
    this.callouts.show(`${next.shot}s SHOT CLOCK`, "#ffb478", { size: 34, y: 0.38, life: 1.8 });
    this.flash = 1;
    this.juice.shake(0.25);
    this.ctx.sfx.win();
  }

  /** While an orb sits above the line, a tick heartbeat that quickens toward the 3s limit. */
  private heartbeatStep(dt: number): void {
    if (this.world.danger <= 0.1 || this.world.over) { this.heartbeat = 0; return; }
    this.heartbeat -= dt;
    if (this.heartbeat <= 0) {
      const t = Math.min(1, this.world.danger / 3);
      this.heartbeat = 0.7 - t * 0.5;
      this.pulse = 1;
      this.ctx.sfx.tick();
    }
  }

  private drop(): void {
    if (!this.world.drop(this.aim)) return;
    this.ctx.sfx.tick();
    this.shotLeft = shotClock(this.world.score);
  }
  private shake(): void { if (this.world.shake()) this.ctx.sfx.hit(); }
  isFinished(): boolean { return this.done; }
  getScores(): { playerId: string; score: number }[] { return this.scores.map(score => ({ ...score })); }

  destroy(): void {
    this.releasePointer();
    this.pendingDrop = false;
    this.ctx.canvas.removeEventListener("pointerdown", this.pointerDown);
    this.ctx.canvas.removeEventListener("pointermove", this.pointerMove);
    this.ctx.canvas.removeEventListener("pointerup", this.pointerUp);
    this.ctx.canvas.removeEventListener("pointercancel", this.pointerCancel);
    this.ctx.canvas.style.touchAction = this.oldTouchAction;
  }

  render(g: CanvasRenderingContext2D): void {
    g.save();
    fillArena(g, this.ctx.width, this.ctx.height);
    const player = this.ctx.players[Math.min(this.turn, this.ctx.players.length - 1)];

    // Left: who's playing, the score, the best to beat.
    display(g, player.name.toUpperCase(), 60, 110, 40, player.color);
    display(g, this.world.score.toLocaleString(), 60, 200, 92);
    const beat = this.runBest > 0 && this.world.score > this.runBest;
    label(g, beat ? "NEW BEST" : `BEST ${this.best.toLocaleString()}`, 62, 236, 18, beat ? UI.lime : UI.muted);
    if (this.runBest > 0 && !beat) {
      g.fillStyle = UI.line; g.fillRect(62, 250, 260, 4);
      g.fillStyle = UI.muted; g.fillRect(62, 250, 260 * Math.min(1, this.world.score / this.runBest), 4);
    }
    label(g, `LEVEL ${levelIndex(this.world.score) + 1}`, 62, 300, 18, UI.muted);
    if (this.ctx.players.length > 1) {
      this.scores.forEach((score, index) => {
        const p = this.ctx.players[index];
        const y = 560 + index * 34;
        label(g, p.name, 62, y, 20, index === this.turn ? p.color : UI.dim);
        label(g, score.score.toLocaleString(), 330, y, 20, index === this.turn ? UI.text : UI.dim, "right");
      });
    }

    // Board.
    const ox = this.juice.offsetX, oy = this.juice.offsetY;
    g.translate(BX + ox, BY + oy);
    g.fillStyle = UI.panel;
    g.beginPath();
    g.roundRect(0, 0, BOARD.width, BOARD.height, 18);
    g.fill();
    g.strokeStyle = UI.line;
    g.lineWidth = 2;
    g.stroke();
    g.save();
    g.clip();
    const danger = this.world.danger > 0.1 && !this.world.over;
    if (danger) {
      const a = Math.min(1, this.world.danger / 3) * (0.35 + 0.65 * this.pulse);
      const glow = g.createRadialGradient(240, 315, 180, 240, 315, 420);
      glow.addColorStop(0, "rgba(255,61,122,0)");
      glow.addColorStop(1, `rgba(255,61,122,${(0.45 * a).toFixed(3)})`);
      g.fillStyle = glow; g.fillRect(0, 0, BOARD.width, BOARD.height);
    }
    g.strokeStyle = danger ? UI.hot : UI.line;
    g.lineWidth = danger ? 1 + this.pulse * 3 : 2;
    g.setLineDash([6, 8]);
    g.beginPath(); g.moveTo(14, BOARD.danger); g.lineTo(466, BOARD.danger); g.stroke();
    g.setLineDash([]);
    g.lineWidth = 1;
    if (!this.world.over) {
      const x = this.world.clampAim(this.aim);
      let bottom = BOARD.floor - RADII[this.world.next];
      for (const ball of this.world.balls) {
        const dx = Math.abs(x - ball.x), radius = ball.radius + RADII[this.world.next];
        if (dx < radius) bottom = Math.min(bottom, ball.y - Math.sqrt(radius * radius - dx * dx));
      }
      g.strokeStyle = COLORS[this.world.next] + "50";
      g.setLineDash([3, 8]);
      g.beginPath(); g.moveTo(x, 72); g.lineTo(x, Math.max(76, bottom)); g.stroke();
      g.setLineDash([]);
      drawOrb(g, x, 45, this.world.next, this.world.time - this.world.lastDrop < 0.48 ? 0.35 : 0.85);
      if (player.kind === "human") {
        // Shot clock across the top of the board; red for the last 1.5s.
        const t = Math.max(0, Math.min(1, this.shotLeft / shotClock(this.world.score)));
        g.fillStyle = UI.line; g.fillRect(14, 8, 452, 6);
        g.fillStyle = this.shotLeft < 1.5 ? UI.hot : player.color; g.fillRect(14, 8, 452 * t, 6);
      }
    }
    for (const ball of this.world.balls) drawOrb(g, ball.x, ball.y, ball.tier);
    for (const ring of this.rings) {
      g.globalAlpha = ring.life / 0.45;
      g.strokeStyle = ring.color;
      g.lineWidth = 2;
      g.beginPath(); g.arc(ring.x, ring.y, ring.radius + (1 - ring.life / 0.45) * 20, 0, Math.PI * 2); g.stroke();
    }
    g.globalAlpha = 1;
    for (const item of this.floaters) {
      g.globalAlpha = Math.min(1, item.life * 2);
      display(g, item.text, item.x, item.y, 30, item.color, "center");
    }
    g.globalAlpha = 1;
    this.juice.drawParticles(g);
    if (!this.world.drops && player.kind === "human") label(g, "Drag, then let go", 240, 320, 20, UI.muted, "center");
    if (this.world.over) {
      g.fillStyle = "rgba(7,11,20,0.85)"; g.fillRect(0, 0, 480, 630);
      display(g, this.world.score.toLocaleString(), 240, 300, 80, UI.text, "center");
      const next = this.turn + 1 < this.ctx.players.length ? this.ctx.players[this.turn + 1] : null;
      label(g, next ? `${next.name} is next` : "Results…", 240, 350, 22, next?.color ?? UI.muted, "center");
    }
    g.restore();
    g.translate(-BX - ox, -BY - oy);
    if (this.flash > 0) {
      g.fillStyle = `rgba(184,255,61,${(0.25 * this.flash).toFixed(3)})`;
      g.fillRect(0, 0, this.ctx.width, this.ctx.height);
    }
    if (this.world.time - this.world.lastMerge < 1.5 && this.world.chain > 1) {
      const chain = this.world.chain;
      const size = Math.round((26 + chain * 4) * (1 + this.chainPop * 0.35));
      display(g, `×${chain}`, SHAKE.x + SHAKE.w / 2, 560, size * 1.6, chain >= 5 ? COLORS[8] : chain >= 3 ? UI.warn : UI.lime, "center");
    }

    // Right: next orbs and the shake button. Nothing else.
    label(g, "NEXT", 960, 110, 16, UI.muted);
    drawOrb(g, 1010, 165, this.world.next, 1, 40);
    drawOrb(g, 1100, 175, this.world.queued, 0.6, 26);
    const ready = this.world.charge >= 6 && !this.world.over;
    g.fillStyle = ready ? player.color : UI.panel;
    g.strokeStyle = ready ? player.color : UI.line;
    g.lineWidth = 2;
    g.beginPath(); g.roundRect(SHAKE.x, SHAKE.y, SHAKE.w, SHAKE.h, 16); g.fill(); g.stroke();
    display(g, "SHAKE", SHAKE.x + SHAKE.w / 2, SHAKE.y + 46, 34, ready ? "#070b14" : UI.dim, "center");
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.arc(SHAKE.x + SHAKE.w / 2 - 50 + i * 20, SHAKE.y + SHAKE.h + 22, 5, 0, Math.PI * 2);
      g.fillStyle = i < this.world.charge ? player.color : UI.line;
      g.fill();
    }
    this.callouts.draw(g, this.ctx.width, this.ctx.height);
    g.restore();
  }
}

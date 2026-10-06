import { PLAYER_BINDS } from "../../../core/input";
import { Rng } from "../../../core/rng";
import type { GameContext, GameInstance, Player } from "../../../core/types";
import { Callouts, Juice } from "../../../fx/juice";
import { levelFor, levelIndex, shotClock } from "./levels";
import { UI, display, drawOrb, label } from "./draw";
import { fillArena } from "../../../core/draw";
import { BOARD, COLORS, DropWorld, RADII } from "./physics";
import { botAim } from "./rules";

const LIME = UI.lime, MUTED = UI.muted;
const BY = 78;
const BOARD_X = [40, 760] as const;
const HEADER_H = 64;
const SHAKE_W = 150, SHAKE_H = 40;
const INTERMISSION_S = 2.5;
const BEST_KEY = "c5-lucky-drop-best";

interface Pane {
  readonly index: 0 | 1;
  readonly x: number;
  player: Player | null;
  world: DropWorld;
  aim: number;
  accumulator: number;
  shotLeft: number;
  botWait: number;
  pointerId: number | null;
  pendingDrop: boolean;
  level: number;
  pulse: number;
  floaters: { x: number; y: number; text: string; color: string; life: number }[];
}

/** Heat pairs: players 1v2, then 3v4 (an odd player out plays a heat alone). */
export function versusHeats(count: number): [number, number | null][] {
  const heats: [number, number | null][] = [];
  for (let i = 0; i < count; i += 2) heats.push([i, i + 1 < count ? i + 1 : null]);
  return heats;
}

/**
 * Lucky Drop Versus: two boards side by side, played at the same time with the same
 * drop sequence. Each board has its own shot clock, level and shake. The heat ends when
 * both boards overflow; everyone's final score goes to the results.
 */
export class LuckyDropVersus implements GameInstance {
  private readonly seed: number;
  private readonly heats: [number, number | null][];
  private heat = 0;
  private readonly panes: [Pane, Pane];
  private readonly scores: { playerId: string; score: number }[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private intermission = 0;
  private done = false;
  private best = 0;
  private bestAnnounced = false;
  private readonly oldTouchAction: string;

  constructor(private readonly ctx: GameContext) {
    this.seed = ctx.rng.int(1, 0x7fffffff);
    this.heats = versusHeats(ctx.players.length);
    this.juice = new Juice(() => ctx.rng.next());
    this.scores = ctx.players.map((p) => ({ playerId: p.id, score: 0 }));
    this.panes = [this.makePane(0), this.makePane(1)];
    this.startHeat();
    try { this.best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch { /* Storage is optional. */ }
    this.oldTouchAction = ctx.canvas.style.touchAction;
    ctx.canvas.style.touchAction = "none";
    ctx.canvas.addEventListener("pointerdown", this.pointerDown);
    ctx.canvas.addEventListener("pointermove", this.pointerMove);
    ctx.canvas.addEventListener("pointerup", this.pointerUp);
    ctx.canvas.addEventListener("pointercancel", this.pointerUp);
  }

  private newWorld(): DropWorld {
    // Same seed on both boards: identical drop sequences, so only skill and merges differ.
    const drops = new Rng(this.seed), shakes = new Rng(this.seed ^ 0x5f3759df);
    return new DropWorld(() => drops.next(), () => shakes.next());
  }

  private makePane(index: 0 | 1): Pane {
    return {
      index, x: BOARD_X[index], player: null, world: this.newWorld(), aim: 240, accumulator: 0,
      shotLeft: shotClock(0), botWait: 0.9, pointerId: null, pendingDrop: false, level: 0, pulse: 0, floaters: [],
    };
  }

  private startHeat(): void {
    const [a, b] = this.heats[this.heat]!;
    this.panes.forEach((pane, i) => {
      const seat = i === 0 ? a : b;
      Object.assign(pane, this.makePane(pane.index));
      pane.player = seat === null ? null : this.ctx.players[seat] ?? null;
      if (!pane.player) pane.world.over = true;
    });
    const names = this.panes.map((p) => p.player?.name).filter(Boolean).join(" vs ");
    this.callouts.show(names.toUpperCase(), LIME, { size: 56, y: 0.45, life: 1.6 });
  }

  // ---- input -------------------------------------------------------------

  private point(event: PointerEvent): { x: number; y: number } {
    const rect = this.ctx.canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * this.ctx.width / Math.max(1, rect.width),
      y: (event.clientY - rect.top) * this.ctx.height / Math.max(1, rect.height) };
  }

  private paneAt(p: { x: number; y: number }): Pane | undefined {
    return this.panes.find((pane) => p.x >= pane.x && p.x <= pane.x + BOARD.width && p.y >= BY - HEADER_H && p.y <= BY + BOARD.height);
  }

  private onShake(pane: Pane, p: { x: number; y: number }): boolean {
    const sx = pane.x + BOARD.width - SHAKE_W, sy = BY - HEADER_H + 8;
    return p.x >= sx && p.x <= sx + SHAKE_W && p.y >= sy && p.y <= sy + SHAKE_H;
  }

  private readonly pointerDown = (event: PointerEvent): void => {
    if (this.done || this.intermission > 0) return;
    const p = this.point(event);
    const pane = this.paneAt(p);
    if (!pane || pane.player?.kind !== "human" || pane.world.over) return;
    event.preventDefault();
    if (this.onShake(pane, p)) { this.shake(pane); return; }
    if (pane.pointerId !== null) return;
    pane.pointerId = event.pointerId;
    pane.aim = pane.world.clampAim(p.x - pane.x);
    try { this.ctx.canvas.setPointerCapture(event.pointerId); } catch { /* optional */ }
  };

  private readonly pointerMove = (event: PointerEvent): void => {
    const pane = this.panes.find((p) => p.pointerId === event.pointerId);
    if (!pane) return;
    pane.aim = pane.world.clampAim(this.point(event).x - pane.x);
  };

  private readonly pointerUp = (event: PointerEvent): void => {
    const pane = this.panes.find((p) => p.pointerId === event.pointerId);
    if (!pane) return;
    pane.pointerId = null;
    if (event.type === "pointerup") {
      pane.aim = pane.world.clampAim(this.point(event).x - pane.x);
      pane.pendingDrop = true;
    }
  };

  // ---- loop --------------------------------------------------------------

  update(dt: number): void {
    if (this.done) return;
    dt = Math.min(dt, 0.05);
    const simDt = this.juice.update(dt);
    this.callouts.update(dt);

    if (this.intermission > 0) {
      this.intermission -= dt;
      if (this.intermission <= 0) {
        this.heat += 1;
        if (this.heat >= this.heats.length) { this.done = true; return; }
        this.startHeat();
      }
      return;
    }

    for (const pane of this.panes) this.updatePane(pane, dt, simDt);

    if (this.panes.every((p) => p.world.over)) {
      this.intermission = INTERMISSION_S;
      const [a, b] = this.panes;
      if (a.player && b.player) {
        const winner = a.world.score === b.world.score ? null : a.world.score > b.world.score ? a : b;
        this.callouts.show(winner ? `${winner.player!.name} WINS THE HEAT` : "DEAD HEAT", winner?.player?.color ?? LIME, { size: 60, y: 0.45, life: 2.2 });
      }
      this.ctx.sfx.win();
    }
  }

  private updatePane(pane: Pane, dt: number, simDt: number): void {
    pane.pulse = Math.max(0, pane.pulse - dt * 4);
    for (const f of pane.floaters) { f.life -= dt; f.y -= dt * 26; }
    pane.floaters = pane.floaters.filter((f) => f.life > 0);
    const player = pane.player;
    if (!player || pane.world.over) { pane.pendingDrop = false; return; }

    if (player.kind === "bot") {
      pane.botWait -= dt;
      if (pane.botWait <= 0) {
        if (pane.world.charge === 6 && pane.world.balls.some((ball) => ball.y < 260)) this.shake(pane);
        pane.aim = botAim(pane.world);
        this.drop(pane);
        pane.botWait = 0.85;
      }
    } else {
      const input = this.ctx.input;
      const bind = PLAYER_BINDS[pane.index]!;
      const axis = input.axis(pane.index).x;
      pane.aim = pane.world.clampAim(pane.aim + axis * dt * 300);
      if (pane.pendingDrop || input.justPressed(bind.action)) this.drop(pane);
      if (input.justPressed(bind.down)) this.shake(pane);
      const before = pane.shotLeft;
      pane.shotLeft -= dt;
      if ((before > 2 && pane.shotLeft <= 2) || (before > 1 && pane.shotLeft <= 1)) this.ctx.sfx.tick();
      if (pane.shotLeft <= 0) {
        pane.pointerId = null;
        this.drop(pane);
      }
    }
    pane.pendingDrop = false;

    pane.accumulator += simDt;
    while (pane.accumulator >= 1 / 120) {
      pane.world.step(1 / 120);
      pane.accumulator -= 1 / 120;
    }
    for (const event of pane.world.events) {
      if (event.type === "merge") {
        const color = COLORS[event.tier];
        pane.floaters.push({ x: event.x, y: event.y, text: `+${event.points}`, color, life: 1 });
        this.ctx.sfx.streak(event.chain);
        const t = event.tier;
        this.juice.burst(pane.x + event.x, BY + event.y, [color, "#ffffff"], { count: 6 + t * 3, speed: 140 + t * 28, size: 3 + t * 0.5, life: 0.45 + t * 0.04, gravity: 380 });
        if (t >= 7) this.juice.shake(0.2 + (t - 7) * 0.06);
      } else if (event.type === "burst") {
        pane.floaters.push({ x: 240, y: 280, text: `${2 ** event.tier}! +${event.bonus.toLocaleString()}`, color: COLORS[event.tier], life: 2 });
        this.callouts.show(`${player.name}: ${2 ** event.tier}!`, COLORS[event.tier], { size: 52, y: 0.3, life: 1.4 });
        this.juice.burst(pane.x + event.x, BY + event.y, [COLORS[event.tier], LIME, "#ffffff"], { count: 40, speed: 420, size: 7, life: 1.1 });
        this.juice.hitStop(0.04);
        this.ctx.sfx.win();
      }
    }
    pane.world.events = [];
    this.scores[this.ctx.players.indexOf(player)]!.score = pane.world.score;

    const level = levelIndex(pane.world.score);
    if (level > pane.level) {
      pane.level = level;
      pane.floaters.push({ x: 240, y: 200, text: `LEVEL ${level + 1} · ${levelFor(pane.world.score).shot}s`, color: LIME, life: 1.8 });
      this.ctx.sfx.win();
    }
    if (pane.world.danger > 0.1 && Math.floor(pane.world.time * 3) !== Math.floor((pane.world.time - simDt) * 3)) pane.pulse = 1;

    if (player.kind === "human" && pane.world.score > this.best) {
      const hadBest = this.best > 0;
      this.best = pane.world.score;
      try { localStorage.setItem(BEST_KEY, String(this.best)); } catch { /* Storage is optional. */ }
      if (hadBest && !this.bestAnnounced) {
        this.bestAnnounced = true;
        this.callouts.show(`NEW BEST · ${player.name}`, LIME, { size: 52, y: 0.2, life: 1.6 });
      }
    }
    if (pane.world.over) {
      pane.pointerId = null;
      this.ctx.sfx.miss();
      this.juice.shake(0.3);
    }
  }

  private drop(pane: Pane): void {
    if (!pane.world.drop(pane.aim)) return;
    this.ctx.sfx.tick();
    pane.shotLeft = shotClock(pane.world.score);
  }

  private shake(pane: Pane): void {
    if (pane.world.shake()) this.ctx.sfx.hit();
  }

  isFinished(): boolean { return this.done; }
  getScores(): { playerId: string; score: number }[] { return this.scores.map((s) => ({ ...s })); }

  destroy(): void {
    this.ctx.canvas.removeEventListener("pointerdown", this.pointerDown);
    this.ctx.canvas.removeEventListener("pointermove", this.pointerMove);
    this.ctx.canvas.removeEventListener("pointerup", this.pointerUp);
    this.ctx.canvas.removeEventListener("pointercancel", this.pointerUp);
    this.ctx.canvas.style.touchAction = this.oldTouchAction;
  }

  // ---- drawing -----------------------------------------------------------

  render(g: CanvasRenderingContext2D): void {
    g.save();
    fillArena(g, this.ctx.width, this.ctx.height);
    g.translate(this.juice.offsetX, this.juice.offsetY);
    for (const pane of this.panes) this.drawPane(g, pane);
    this.juice.drawParticles(g);
    g.restore();
    this.drawCenter(g);
    this.callouts.draw(g, this.ctx.width, this.ctx.height);
  }

  private drawCenter(g: CanvasRenderingContext2D): void {
    const cx = 640;
    display(g, "VS", cx, 130, 56, UI.dim, "center");
    const [a, b] = this.panes;
    const lead = a.player && b.player && a.world.score !== b.world.score ? (a.world.score > b.world.score ? a : b) : null;
    this.panes.forEach((pane, i) => {
      if (!pane.player) return;
      const y = 240 + i * 150;
      label(g, pane.player.name, cx, y, 20, pane.player.color, "center");
      display(g, pane.world.score.toLocaleString(), cx, y + 52, 52, lead === pane ? UI.text : UI.muted, "center");
      if (pane.world.over) label(g, "OUT", cx, y + 78, 14, UI.hot, "center");
    });
    if (this.heats.length > 1) label(g, `HEAT ${this.heat + 1}/${this.heats.length}`, cx, 640, 14, UI.dim, "center");
  }

  private drawPane(g: CanvasRenderingContext2D, pane: Pane): void {
    const { world, player } = pane;
    g.save();
    g.translate(pane.x, BY);

    // Header: name, next orbs, shake button.
    if (player) {
      display(g, player.name.toUpperCase(), 0, -HEADER_H + 36, 30, player.color);
      drawOrb(g, 200, -HEADER_H + 26, world.next, 1, 16);
      drawOrb(g, 232, -HEADER_H + 30, world.queued, 0.6, 11);
      const ready = world.charge >= 6 && !world.over;
      const sx = BOARD.width - SHAKE_W, sy = -HEADER_H + 8;
      g.fillStyle = ready ? player.color : UI.panel;
      g.strokeStyle = ready ? player.color : UI.line;
      g.lineWidth = 2;
      g.beginPath(); g.roundRect(sx, sy, SHAKE_W, SHAKE_H, 12); g.fill(); g.stroke();
      display(g, "SHAKE", sx + SHAKE_W / 2, sy + 30, 24, ready ? "#070b14" : UI.dim, "center");
      g.fillStyle = UI.line; g.fillRect(sx, sy + SHAKE_H + 4, SHAKE_W, 3);
      g.fillStyle = player.color; g.fillRect(sx, sy + SHAKE_H + 4, SHAKE_W * world.charge / 6, 3);
    }

    g.fillStyle = UI.panel;
    g.beginPath();
    g.roundRect(0, 0, BOARD.width, BOARD.height, 18);
    g.fill();
    g.strokeStyle = player ? player.color + "66" : UI.line;
    g.lineWidth = 2;
    g.stroke();
    g.save();
    g.clip();
    if (!player) {
      label(g, "—", 240, 320, 40, MUTED, "center");
      g.restore();
      g.restore();
      return;
    }
    const danger = world.danger > 0.1 && !world.over;
    if (danger) {
      g.fillStyle = `rgba(255,61,122,${(0.12 + 0.18 * pane.pulse).toFixed(3)})`;
      g.fillRect(0, 0, BOARD.width, BOARD.danger);
    }
    g.strokeStyle = danger ? UI.hot : UI.line;
    g.lineWidth = 2;
    g.setLineDash([6, 8]);
    g.beginPath(); g.moveTo(14, BOARD.danger); g.lineTo(466, BOARD.danger); g.stroke();
    g.lineWidth = 1;
    g.setLineDash([]);
    if (!world.over) {
      const x = world.clampAim(pane.aim);
      let bottom = BOARD.floor - RADII[world.next];
      for (const ball of world.balls) {
        const dx = Math.abs(x - ball.x), radius = ball.radius + RADII[world.next];
        if (dx < radius) bottom = Math.min(bottom, ball.y - Math.sqrt(radius * radius - dx * dx));
      }
      g.strokeStyle = COLORS[world.next] + "50";
      g.setLineDash([3, 8]);
      g.beginPath(); g.moveTo(x, 72); g.lineTo(x, Math.max(76, bottom)); g.stroke();
      g.setLineDash([]);
      drawOrb(g, x, 45, world.next, world.time - world.lastDrop < 0.48 ? 0.35 : 0.85);
      if (player.kind === "human") {
        const t = Math.max(0, Math.min(1, pane.shotLeft / shotClock(world.score)));
        g.fillStyle = UI.line; g.fillRect(14, 8, 452, 6);
        g.fillStyle = pane.shotLeft < 1.5 ? UI.hot : player.color; g.fillRect(14, 8, 452 * t, 6);
      }
    }
    for (const ball of world.balls) drawOrb(g, ball.x, ball.y, ball.tier);
    for (const f of pane.floaters) {
      g.globalAlpha = Math.min(1, f.life * 2);
      display(g, f.text, f.x, f.y, 28, f.color, "center");
    }
    g.globalAlpha = 1;
    if (!world.drops && player.kind === "human") label(g, "Drag, then let go", 240, 320, 20, MUTED, "center");
    if (world.over) {
      g.fillStyle = "rgba(7,11,20,0.85)"; g.fillRect(0, 0, 480, 630);
      display(g, world.score.toLocaleString(), 240, 300, 72, UI.text, "center");
      label(g, "OVERFLOW", 240, 345, 20, UI.hot, "center");
    }
    g.restore();
    g.restore();
  }
}

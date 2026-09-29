import { Rng } from "../../../core/rng";
import type { MinigameContext, MinigameDefinition, MinigameInstance } from "../../../core/types";
import { BOARD, COLORS, DropWorld, RADII } from "./physics";
import { LEVELS, levelFor, levelIndex, shotClock } from "./levels";
import { botAim } from "./rules";

export const luckyDrop: MinigameDefinition = {
  id: "lucky-drop",
  name: "Lucky Drop",
  tagline: "Drop, match, multiply. A little skill. A little luck.",
  description: "Unlimited drops, but a shot clock drops for you if you wait too long, and it speeds up as your score climbs. Bigger orbs (8s, 16s) start dropping too. Match identical orbs, build chains, and shake the board. Make 128 for a 1,000-point bonus; every size up doubles it, all the way to 4096. Take turns on fresh boards; highest score wins when every board overflows.",
  durationMs: 0,
  controls: "Drag and release to drop · Arrows/A-D to aim · Space/seat action to drop · S or Shake to nudge",
  create: ctx => new LuckyDropGame(ctx),
};

const LIME = "#c9f65b", MUTED = "#9ba395";
const BX = 400, BY = 48;
const SHAKE = { x: 930, y: 338, w: 292, h: 54 };
interface Floater { x: number; y: number; text: string; color: string; life: number }
interface Ring { x: number; y: number; radius: number; color: string; life: number }

/** Runs inside C5's canvas, input, audio and results lifecycle. No extra animation loop. */
export class LuckyDropGame implements MinigameInstance {
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
  private readonly oldTouchAction: string;

  constructor(private readonly ctx: MinigameContext) {
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
      this.shotLeft -= dt;
      if (this.shotLeft <= 0) {
        // Out of time: drop wherever the aim is now.
        this.releasePointer();
        this.drop();
      }
      if (input.justPressed("KeyS") || (click && click.x >= SHAKE.x && click.x <= SHAKE.x + SHAKE.w &&
        click.y >= SHAKE.y && click.y <= SHAKE.y + SHAKE.h)) this.shake();
      this.pendingDrop = false;
    }

    this.accumulator += dt;
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
      } else if (event.type === "burst") {
        this.floaters.push({ x: 240, y: 280, text: `${2 ** event.tier}! +${event.bonus.toLocaleString()}`, color: COLORS[event.tier], life: 2 });
        this.ctx.sfx.win();
      }
    }
    this.world.events = [];
    this.scores[this.turn].score = this.world.score;
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
    g.fillStyle = "#141714";
    g.fillRect(0, 0, this.ctx.width, this.ctx.height);
    label(g, "LUCKY DROP", 48, 58, 22, LIME);
    label(g, "Make", 48, 143, 58);
    label(g, "your own", 48, 203, 58);
    label(g, "luck.", 48, 263, 58, LIME);
    const player = this.ctx.players[Math.min(this.turn, this.ctx.players.length - 1)];
    label(g, `${player.name}${player.kind === "bot" ? " · BOT" : " · YOUR RUN"}`, 48, 316, 22, player.color);
    label(g, "SCORE", 48, 355, 14, MUTED);
    label(g, this.world.score.toLocaleString(), 48, 416, 60);
    label(g, `PERSONAL BEST  ${this.best.toLocaleString()}`, 48, 446, 14, LIME);
    label(g, "1   Aim, then drop an orb.", 48, 508, 18, MUTED);
    label(g, "2   Match pairs to multiply.", 48, 539, 18, MUTED);
    label(g, "3   Stay below the dotted line.", 48, 570, 18, MUTED);
    label(g, `LEVEL ${levelIndex(this.world.score) + 1} / ${LEVELS.length}  ·  ${levelFor(this.world.score).shot}s SHOT CLOCK`, 48, 655, 16, LIME);

    g.translate(BX, BY);
    g.fillStyle = "#20271b";
    g.beginPath();
    g.roundRect(0, 0, BOARD.width, BOARD.height, 18);
    g.fill();
    g.strokeStyle = "#566044";
    g.lineWidth = 1;
    g.stroke();
    g.save();
    g.clip();
    g.fillStyle = "#d1ed9320";
    for (let x = 24; x < 480; x += 24) for (let y = 20; y < 630; y += 24) {
      g.beginPath(); g.arc(x, y, 0.8, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = this.world.danger > 0.1 ? "#ffb478" : "#a2b88b55";
    g.setLineDash([4, 7]);
    g.beginPath(); g.moveTo(18, BOARD.danger); g.lineTo(462, BOARD.danger); g.stroke();
    g.setLineDash([]);
    label(g, "KEEP IT BELOW", 20, 93, 12, MUTED);
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
        // Shot clock bar across the top of the board; red for the last 1.5s.
        const total = shotClock(this.world.score);
        const t = Math.max(0, Math.min(1, this.shotLeft / total));
        g.fillStyle = "#313929";
        g.fillRect(18, 8, 444, 6);
        g.fillStyle = this.shotLeft < 1.5 ? "#ff7a7a" : LIME;
        g.fillRect(18, 8, 444 * t, 6);
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
      label(g, item.text, item.x, item.y, 24, item.color, "center");
    }
    g.globalAlpha = 1;
    if (!this.world.drops) label(g, player.kind === "bot" ? "WATCH THE LUCK UNFOLD" : "DRAG TO AIM · RELEASE TO DROP", 240, 310, 17, MUTED, "center");
    if (this.world.danger > 0.2 && !this.world.over) label(g, `MAKE ROOM · ${Math.max(1, Math.ceil(3 - this.world.danger))}s`, 240, 135, 20, "#ffb478", "center");
    if (this.world.over) {
      g.fillStyle = "#172010ee"; g.fillRect(0, 0, 480, 630);
      label(g, "GOOD RUN!", 240, 240, 44, LIME, "center");
      label(g, `${this.world.score.toLocaleString()} points`, 240, 296, 30, "#f0f2e9", "center");
      label(g, `${this.world.merges} merges · best chain ×${this.world.maxChain}`, 240, 340, 19, MUTED, "center");
      label(g, this.turn + 1 < this.ctx.players.length ? `${this.ctx.players[this.turn + 1].name} is up next` : "Here come the results…", 240, 408, 21, LIME, "center");
    }
    g.restore();
    g.translate(-BX, -BY);
    label(g, `DROP ${this.world.drops}`, BX, 30, 14, MUTED);
    if (this.world.time - this.world.lastMerge < 1.5) label(g, `CHAIN ×${this.world.chain}`, BX + 480, 30, 16, LIME, "right");
    label(g, "← → / A D  Aim    SPACE  Drop    S  Shake", 640, 704, 15, MUTED, "center");

    label(g, "ON DECK", 930, 65, 16, MUTED);
    drawOrb(g, 989, 123, this.world.next, 1, 34);
    label(g, "THEN", 1060, 111, 14, MUTED);
    drawOrb(g, 1146, 121, this.world.queued, 1, 23);
    label(g, ["A small beginning.", "A lucky little head start.", "Ooh. A rare one.", "Big one incoming.", "A monster. Make room."][this.world.next] ?? "", 930, 190, 18, MUTED);
    label(g, "Shake things up", 930, 258, 23);
    label(g, "Six merges earn a board shake.", 930, 289, 17, MUTED);
    g.fillStyle = "#313929"; g.fillRect(930, 312, 292, 5);
    g.fillStyle = LIME; g.fillRect(930, 312, 292 * this.world.charge / 6, 5);
    const ready = this.world.charge >= 6 && !this.world.over;
    g.fillStyle = ready ? LIME : "#29331f";
    g.beginPath(); g.roundRect(SHAKE.x, SHAKE.y, SHAKE.w, SHAKE.h, 9); g.fill();
    label(g, ready ? "SHAKE THE BOARD · S" : `CHARGING  ${this.world.charge} / 6`, 1076, 373, 19, ready ? "#1c2812" : MUTED, "center");
    label(g, "THE LUCK OF THE DROP", 930, 438, 16, MUTED);
    levelFor(this.world.score).odds.forEach((odds, tier) => {
      if (!odds) return;
      drawOrb(g, 944 + tier * 60, 478, tier, 1, 15);
      label(g, `${odds}%`, 944 + tier * 60, 510, 14, "#f0f2e9", "center");
    });
    label(g, "Make 128 for +1,000.", 930, 541, 22, COLORS[7]);
    label(g, "Each size up doubles it. 4096 = +32,000.", 930, 570, 17, MUTED);
    if (this.ctx.players.length > 1) {
      label(g, `RUN ${Math.min(this.turn + 1, this.ctx.players.length)} / ${this.ctx.players.length}`, 930, 615, 14, MUTED);
      this.scores.forEach((score, index) => {
        label(g, `${this.ctx.players[index].name}: ${score.score}`, 930 + (index % 2) * 150, 644 + Math.floor(index / 2) * 25, 16, this.ctx.players[index].color);
      });
    }
    g.restore();
  }
}

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number,
  color = "#f0f2e9", align: CanvasTextAlign = "left"): void {
  g.fillStyle = color;
  g.font = `600 ${size}px Outfit, sans-serif`;
  g.textAlign = align;
  g.textBaseline = "alphabetic";
  g.fillText(text, x, y);
}

function drawOrb(g: CanvasRenderingContext2D, x: number, y: number, tier: number, alpha = 1, radius: number = RADII[tier]): void {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = COLORS[tier];
  g.shadowColor = "#0b160943";
  g.shadowBlur = 8;
  g.shadowOffsetY = 5;
  g.beginPath(); g.arc(x, y, radius, 0, Math.PI * 2); g.fill();
  g.shadowColor = "transparent";
  g.strokeStyle = "#ffffff32";
  g.lineWidth = 2;
  g.beginPath(); g.arc(x, y, radius - 4, 0, Math.PI * 2); g.stroke();
  g.fillStyle = "#183021";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const text = String(2 ** tier);
  g.font = `700 ${Math.max(15, Math.min(radius * 0.78, (radius * 2.6) / text.length))}px Outfit, sans-serif`;
  g.fillText(text, x, y + 1);
  g.restore();
}

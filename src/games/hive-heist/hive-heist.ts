import { drawTimerBar, fillArena } from "../../core/draw";
import { Callouts, Juice } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  botChoice, buildHive, HIVES, leaders, newHive, STING_PENALTY, take, TURN_MS, VISIBLE,
  type HiveState, type Item,
} from "./logic";

export const hiveHeist: GameDefinition = {
  id: "hive-heist",
  name: "Hive Heist",
  tagline: "Count the combs. Dodge the wasps.",
  description:
    "A honeycomb conveyor feeds one very hungry bear. On your turn take 1 or 2 items from the front: " +
    "honey drops are worth 1-3 points, but angry wasps hide in the queue and only the next 3 items are " +
    "visible. Grab a wasp and you're stung: lose 5 and you're out of that hive. Two hives, the second " +
    "with 4 wasps. Most honey wins.",
  durationMs: 0,
  controls: "On your turn tap TAKE 1 or TAKE 2",
  create: (ctx) => new HiveHeist(ctx),
};

const FONT = "Bebas Neue, Impact, sans-serif";
const INTRO_S = 1.6;
const CHOMP_S = 0.75;
const STING_S = 1.4;
const HIVE_END_S = 2.2;
const FINAL_S = 2.4;
const FLY_S = 0.4;
const HONEY = "#FFB020";
const HONEY_LIGHT = "#FFE08A";
const WASP_YELLOW = "#F5D020";
const DANGER = "#FF3D7A";
const INK = "#070b14";
const PALE = "#F4F7FB";

type Phase = "intro" | "turn" | "chomp" | "hiveEnd" | "final";

interface Seat {
  player: Player;
  honey: number;
  stings: number;
}

interface Flyer {
  item: Item;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
}

interface Floater {
  text: string;
  x: number;
  y: number;
  color: string;
  life: number;
}

interface Btn {
  n: 1 | 2;
  x: number;
  y: number;
  w: number;
  h: number;
}

class HiveHeist implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private phase: Phase = "intro";
  private timer = INTRO_S;
  private hiveIndex = 0;
  private hive: HiveState;
  /** Seat whose turn is being played or resolved (hive.turn moves on as soon as a take lands). */
  private active = 0;
  private turnLeft = TURN_MS / 1000;
  private botAt: number | null = null;
  private slide = 0;
  private chomp = 0;
  private stingFlash = 0;
  private time = 0;
  private flyers: Flyer[] = [];
  private floaters: Floater[] = [];
  private lastLine = "";
  private finished = false;
  private readonly pressed = new Map<number, 1 | 2>();
  private readonly buttons: Btn[];
  private readonly cell: number;
  private readonly queueX: number;
  private readonly laneY: number;
  private readonly bearX: number;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    this.seats = ctx.players.map((player) => ({ player, honey: 0, stings: 0 }));
    const { width: w, height: h } = ctx;
    this.cell = Math.min(w * 0.075, 96);
    this.bearX = w * 0.12;
    this.queueX = w * 0.27;
    this.laneY = h * 0.43;
    const bw = w * 0.4;
    const bh = Math.max(ctx.minTap * 2, h * 0.24);
    const by = h * 0.72;
    this.buttons = [
      { n: 1, x: w * 0.07, y: by, w: bw, h: bh },
      { n: 2, x: w * 0.53, y: by, w: bw, h: bh },
    ];
    this.hive = this.startHive();
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
  }

  private startHive(): HiveState {
    const queue = buildHive(this.hiveIndex, this.ctx.rng);
    const wasps = queue.filter((it) => it.kind === "wasp").length;
    this.slide = 0;
    this.flyers = [];
    this.botAt = null;
    this.lastLine = "";
    this.phase = "intro";
    this.timer = INTRO_S;
    this.callouts.show(`HIVE ${this.hiveIndex + 1}`, HONEY, { size: 88, life: INTRO_S, y: 0.3 });
    this.callouts.show(`${wasps} WASPS HIDDEN`, DANGER, { size: 46, life: INTRO_S, y: 0.43 });
    this.ctx.sfx.countdown();
    const hive = newHive(queue, this.seats.length, this.hiveIndex);
    this.active = hive.turn;
    return hive;
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += realDt;
    this.stepFx(realDt);
    if (this.finished) return;

    switch (this.phase) {
      case "intro":
        this.timer -= dt;
        if (this.timer <= 0) this.beginTurn();
        return;
      case "turn":
        this.turnLeft -= dt;
        if (this.botAt !== null) {
          this.botAt -= dt;
          if (this.botAt <= 0) {
            this.botAt = null;
            this.act(botChoice(this.hive.queue, this.ctx.rng));
            return;
          }
        }
        // Dithering costs you: the bear eats one anyway.
        if (this.turnLeft <= 0) this.act(1);
        return;
      case "chomp":
        this.timer -= dt;
        if (this.timer > 0) return;
        if (this.hive.done) this.endHive();
        else this.beginTurn();
        return;
      case "hiveEnd":
        this.timer -= dt;
        if (this.timer > 0) return;
        this.hiveIndex += 1;
        if (this.hiveIndex < HIVES) this.hive = this.startHive();
        else this.finish();
        return;
      case "final":
        this.timer -= dt;
        if (this.timer <= 0) this.finished = true;
        return;
    }
  }

  private beginTurn(): void {
    this.phase = "turn";
    this.active = this.hive.turn;
    this.turnLeft = TURN_MS / 1000;
    const seat = this.seats[this.active]!;
    this.botAt = seat.player.kind === "bot" ? this.ctx.rng.float(0.7, 1.8) : null;
    this.ctx.sfx.select();
  }

  private act(n: 1 | 2): void {
    if (this.phase !== "turn") return;
    const seatIndex = this.hive.turn;
    const seat = this.seats[seatIndex]!;
    const res = take(this.hive, n);
    const mouth = this.bearMouth();
    const card = this.cardCenter(seatIndex);
    res.taken.forEach((item, i) => {
      const wasp = item.kind === "wasp";
      this.flyers.push({
        item, x0: this.queueX + i * this.cell, y0: this.laneY,
        x1: wasp ? card.x : mouth.x, y1: wasp ? card.y : mouth.y, t: 0,
      });
    });
    this.slide = res.taken.length * this.cell;
    this.botAt = null;
    seat.honey += res.honey;
    if (res.honey > 0) {
      this.floaters.push({ text: `+${res.honey}`, x: card.x, y: card.y + 34, color: HONEY, life: 1.1 });
      this.chomp = 1;
      this.ctx.sfx.collect();
    }
    if (res.stung) {
      seat.honey -= STING_PENALTY;
      seat.stings += 1;
      this.floaters.push({ text: `-${STING_PENALTY}`, x: card.x, y: card.y + 64, color: DANGER, life: 1.3 });
      this.callouts.show(`${seat.player.name} STUNG!`, DANGER, { size: 76, life: STING_S, y: 0.58 });
      this.lastLine = `${seat.player.name} is out of this hive`;
      this.juice.hitStop(0.1);
      this.juice.shake(0.6);
      this.stingFlash = 1;
      this.ctx.sfx.miss();
      this.timer = STING_S;
    } else {
      this.lastLine = res.honey > 0 ? `${seat.player.name} grabs ${res.honey} honey` : "";
      this.juice.shake(0.12);
      this.timer = CHOMP_S;
    }
    this.phase = "chomp";
  }

  private endHive(): void {
    this.phase = "hiveEnd";
    this.timer = HIVE_END_S;
    const empty = this.hive.queue.length === 0;
    this.callouts.show(empty ? "HIVE EMPTY!" : "EVERYONE STUNG!", empty ? HONEY : DANGER, {
      size: 78, life: HIVE_END_S, y: 0.43,
    });
    this.lastLine = "";
    this.ctx.sfx.whoosh();
  }

  private finish(): void {
    this.phase = "final";
    this.timer = FINAL_S;
    const lead = leaders(this.seats.map((s) => s.honey));
    const names = lead.map((i) => this.seats[i]!.player.name).join(" & ");
    const color = lead.length === 1 ? this.seats[lead[0]!]!.player.color : PALE;
    this.callouts.show(`${names} WINS!`, color, { size: 84, life: FINAL_S, y: 0.43 });
    this.ctx.sfx.win();
  }

  private stepFx(dt: number): void {
    this.chomp = Math.max(0, this.chomp - dt * 2.2);
    this.stingFlash = Math.max(0, this.stingFlash - dt * 2.5);
    this.slide *= Math.pow(0.002, dt / 0.4);
    if (this.slide < 0.5) this.slide = 0;

    for (const f of this.flyers) f.t += dt / FLY_S;
    const landed = this.flyers.filter((f) => f.t >= 1);
    this.flyers = this.flyers.filter((f) => f.t < 1);
    for (const f of landed) {
      if (f.item.kind === "wasp") {
        this.juice.burst(f.x1, f.y1, [DANGER, WASP_YELLOW, "#15120a"], { count: 24, speed: 340, gravity: 300, size: 5 });
        this.ctx.sfx.hit();
      } else {
        this.juice.burst(f.x1, f.y1, [HONEY, HONEY_LIGHT], { count: 10, speed: 170, gravity: 420, size: 4, life: 0.5 });
      }
    }

    for (const fl of this.floaters) {
      fl.y -= 42 * dt;
      fl.life -= dt;
    }
    this.floaters = this.floaters.filter((fl) => fl.life > 0);
  }

  // ---- input ----

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private hitButton(p: { x: number; y: number }): Btn | null {
    return this.buttons.find((b) => p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h) ?? null;
  }

  private readonly onDown = (e: PointerEvent): void => {
    const b = this.hitButton(this.toLogical(e));
    if (!b) return;
    e.preventDefault();
    this.pressed.set(e.pointerId, b.n);
    if (this.phase !== "turn") return;
    if (this.seats[this.active]!.player.kind !== "human") return;
    if (b.n === 2 && this.hive.queue.length < 2) return;
    this.act(b.n);
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.pressed.delete(e.pointerId);
  };

  // ---- render ----

  private activeSeat(): Seat | null {
    return this.phase === "turn" || this.phase === "chomp" ? this.seats[this.active] ?? null : null;
  }

  render(g: CanvasRenderingContext2D): void {
    const { width: w, height: h } = this.ctx;
    fillArena(g, w, h);
    const active = this.activeSeat();
    if (active) {
      g.save();
      g.globalAlpha = 0.14;
      g.fillStyle = active.player.color;
      g.fillRect(0, 0, w, h);
      g.restore();
    }
    this.juice.begin(g);
    this.drawConveyor(g);
    this.drawBear(g);
    this.drawFlyers(g);
    this.juice.end(g);
    if (this.stingFlash > 0) {
      g.fillStyle = `rgba(255,61,122,${this.stingFlash * 0.35})`;
      g.fillRect(0, 0, w, h);
    }
    this.drawScoreboard(g);
    this.drawButtons(g);
    this.drawPrompt(g);
    this.drawFloaters(g);
    if (this.phase === "turn") drawTimerBar(g, w, this.turnLeft, TURN_MS / 1000);
    this.callouts.draw(g, w, h);
  }

  private drawHex(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke: string): void {
    g.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + (k * Math.PI) / 3;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (k === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.strokeStyle = stroke;
    g.lineWidth = 3;
    g.stroke();
  }

  private drawConveyor(g: CanvasRenderingContext2D): void {
    const { width: w } = this.ctx;
    const y = this.laneY;
    const cell = this.cell;
    const r = cell * 0.5;
    const q = this.hive.queue;
    g.save();
    // Belt.
    g.fillStyle = "rgba(255,176,32,0.07)";
    g.fillRect(this.queueX - cell, y - r * 1.3, w, r * 2.6);
    g.fillStyle = "rgba(255,176,32,0.18)";
    g.fillRect(this.queueX - cell, y + r * 1.3, w, 4);
    // Comb cells, front first. Hidden ones are dark with a "?".
    for (let i = 0; i < q.length; i++) {
      const x = this.queueX + i * cell + this.slide;
      if (x > w + cell) break;
      const item = q[i]!;
      const revealed = i < VISIBLE;
      this.drawHex(
        g, x, y, r * 0.96,
        revealed ? "rgba(255,176,32,0.2)" : "rgba(244,247,251,0.05)",
        revealed ? HONEY : "rgba(244,247,251,0.2)",
      );
      if (revealed) this.drawItem(g, item, x, y, r * 0.6);
      else {
        g.fillStyle = "rgba(244,247,251,0.4)";
        g.font = `700 ${Math.round(r * 1.1)}px ${FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("?", x, y + 2);
      }
    }
    // Fog over the unknown.
    const fog = g.createLinearGradient(this.queueX + cell * (VISIBLE - 0.5), 0, this.queueX + cell * (VISIBLE + 1.5), 0);
    fog.addColorStop(0, "rgba(12,22,40,0)");
    fog.addColorStop(1, "rgba(12,22,40,0.45)");
    g.fillStyle = fog;
    g.fillRect(this.queueX + cell * (VISIBLE - 0.5), y - r * 1.3, w, r * 2.6);

    g.fillStyle = "rgba(244,247,251,0.55)";
    g.font = `700 26px ${FONT}`;
    g.textAlign = "right";
    g.textBaseline = "bottom";
    g.fillText(`${q.length} IN THE HIVE`, w - 40, y - r * 1.4);
    g.restore();
  }

  private drawItem(g: CanvasRenderingContext2D, item: Item, x: number, y: number, r: number): void {
    if (item.kind === "honey") this.drawHoney(g, x, y, r, item.value);
    else this.drawWasp(g, x, y, r);
  }

  private drawHoney(g: CanvasRenderingContext2D, x: number, y: number, r: number, value: number): void {
    g.save();
    g.translate(x, y);
    g.beginPath();
    g.moveTo(0, -r * 1.25);
    g.quadraticCurveTo(r * 0.95, -r * 0.25, r * 0.72, r * 0.35);
    g.arc(0, r * 0.35, r * 0.72, 0, Math.PI, false);
    g.quadraticCurveTo(-r * 0.95, -r * 0.25, 0, -r * 1.25);
    g.closePath();
    const grad = g.createLinearGradient(0, -r, 0, r);
    grad.addColorStop(0, HONEY_LIGHT);
    grad.addColorStop(1, "#D98A00");
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = "#8a5200";
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.4)";
    g.beginPath();
    g.ellipse(-r * 0.28, 0, r * 0.14, r * 0.3, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = INK;
    g.font = `700 ${Math.round(r * 1.1)}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(value), r * 0.08, r * 0.38);
    g.restore();
  }

  private drawWasp(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    g.save();
    g.translate(x, y + Math.sin(this.time * 22 + x) * 2.5);
    const flap = Math.sin(this.time * 40 + x) * 0.25;
    // Wings.
    g.fillStyle = "rgba(244,247,251,0.55)";
    for (const side of [-1, 1]) {
      g.beginPath();
      g.ellipse(side * r * 0.25, -r * 0.7, r * 0.55, r * 0.26, side * (0.5 + flap), 0, Math.PI * 2);
      g.fill();
    }
    // Striped body.
    g.beginPath();
    g.ellipse(r * 0.1, 0, r * 0.95, r * 0.6, 0, 0, Math.PI * 2);
    g.fillStyle = WASP_YELLOW;
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = "#15120a";
    for (let k = -1; k <= 1; k++) g.fillRect(k * r * 0.5 - r * 0.1, -r, r * 0.22, r * 2);
    g.restore();
    // Stinger (points away from the bear).
    g.fillStyle = "#15120a";
    g.beginPath();
    g.moveTo(r * 1.0, -r * 0.1);
    g.lineTo(r * 1.45, 0);
    g.lineTo(r * 1.0, r * 0.1);
    g.closePath();
    g.fill();
    // Head with angry red eyes.
    g.beginPath();
    g.arc(-r * 0.95, 0, r * 0.38, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = DANGER;
    g.beginPath();
    g.arc(-r * 1.08, -r * 0.12, r * 0.11, 0, Math.PI * 2);
    g.arc(-r * 0.86, -r * 0.12, r * 0.11, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  private bearScale(): number {
    return this.cell / 96;
  }

  private bearMouth(): { x: number; y: number } {
    const s = this.bearScale();
    return { x: this.bearX + 30 * s, y: this.laneY + 28 * s };
  }

  private drawBear(g: CanvasRenderingContext2D): void {
    const s = this.bearScale();
    const open = this.chomp;
    g.save();
    g.translate(this.bearX, this.laneY - open * 6 * s);
    g.scale(s, s);
    const fur = "#7a4a22";
    const muzzle = "#c9955a";
    // Body.
    g.fillStyle = fur;
    g.beginPath();
    g.ellipse(0, 78, 72, 62, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = muzzle;
    g.beginPath();
    g.ellipse(8, 86, 36, 38, 0, 0, Math.PI * 2);
    g.fill();
    // Ears.
    for (const side of [-1, 1]) {
      g.fillStyle = fur;
      g.beginPath();
      g.arc(side * 46, -62, 21, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = muzzle;
      g.beginPath();
      g.arc(side * 46, -62, 10, 0, Math.PI * 2);
      g.fill();
    }
    // Head.
    g.fillStyle = fur;
    g.beginPath();
    g.arc(0, -10, 62, 0, Math.PI * 2);
    g.fill();
    // Muzzle, facing the conveyor.
    g.fillStyle = muzzle;
    g.beginPath();
    g.ellipse(22, 16, 38, 30, 0, 0, Math.PI * 2);
    g.fill();
    // Mouth opens on a chomp.
    g.fillStyle = "#2a0e0e";
    g.beginPath();
    g.ellipse(30, 28, 16 + open * 8, 4 + open * 18, 0, 0, Math.PI * 2);
    g.fill();
    if (open > 0.3) {
      g.fillStyle = PALE;
      g.fillRect(20, 20 + open * 4, 7, 7);
      g.fillRect(34, 20 + open * 4, 7, 7);
    }
    // Nose.
    g.fillStyle = "#1a0d08";
    g.beginPath();
    g.ellipse(40, 2, 12, 8, 0, 0, Math.PI * 2);
    g.fill();
    // Eyes.
    for (const ex of [-14, 24]) {
      g.fillStyle = "#1a0d08";
      g.beginPath();
      g.arc(ex, -26, 6.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = PALE;
      g.beginPath();
      g.arc(ex + 2, -28, 2, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  private drawFlyers(g: CanvasRenderingContext2D): void {
    for (const f of this.flyers) {
      const t = Math.min(1, f.t);
      const e = 1 - (1 - t) * (1 - t);
      const x = f.x0 + (f.x1 - f.x0) * e;
      const y = f.y0 + (f.y1 - f.y0) * e - Math.sin(t * Math.PI) * 90;
      const r = this.cell * 0.3 * (1 - t * 0.5);
      this.drawItem(g, f.item, x, y, r);
    }
  }

  private cardRect(i: number): { x: number; y: number; w: number; h: number } {
    const n = this.seats.length;
    const gap = 12;
    const cw = (this.ctx.width - 80 - (n - 1) * gap) / n;
    return { x: 40 + i * (cw + gap), y: 38, w: cw, h: 72 };
  }

  private cardCenter(i: number): { x: number; y: number } {
    const c = this.cardRect(i);
    return { x: c.x + c.w / 2, y: c.y + c.h / 2 };
  }

  private drawScoreboard(g: CanvasRenderingContext2D): void {
    g.save();
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      const c = this.cardRect(i);
      const isActive = this.activeSeat() === s;
      const out = this.hive.out[i] ?? false;
      g.globalAlpha = out && !isActive ? 0.5 : 1;
      g.fillStyle = "rgba(7,11,20,0.6)";
      this.roundRect(g, c.x, c.y, c.w, c.h, 14);
      g.fill();
      if (isActive) {
        g.strokeStyle = s.player.color;
        g.lineWidth = 4 + Math.sin(this.time * 8) * 1.5;
        this.roundRect(g, c.x, c.y, c.w, c.h, 14);
        g.stroke();
      }
      g.textBaseline = "middle";
      g.textAlign = "left";
      g.fillStyle = s.player.color;
      g.font = `700 28px ${FONT}`;
      g.fillText(s.player.name, c.x + 16, c.y + 24);
      g.fillStyle = "rgba(244,247,251,0.6)";
      g.font = `700 18px ${FONT}`;
      g.fillText(out ? "OUT OF THIS HIVE" : s.stings > 0 ? `STINGS ${s.stings}` : "", c.x + 16, c.y + 52);
      g.textAlign = "right";
      g.fillStyle = s.honey < 0 ? DANGER : HONEY;
      g.font = `700 44px ${FONT}`;
      g.fillText(String(s.honey), c.x + c.w - 16, c.y + c.h / 2 + 2);
    }
    g.restore();
  }

  private roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  }

  private drawButtons(g: CanvasRenderingContext2D): void {
    const active = this.activeSeat();
    const live = this.phase === "turn" && active !== null && active.player.kind === "human";
    g.save();
    for (const b of this.buttons) {
      const can = b.n === 1 || this.hive.queue.length >= 2;
      const held = [...this.pressed.values()].includes(b.n);
      const sc = held ? 0.96 : 1;
      g.save();
      g.translate(b.x + b.w / 2, b.y + b.h / 2);
      g.scale(sc, sc);
      g.globalAlpha = live && can ? 1 : 0.28;
      g.fillStyle = active ? active.player.color : "rgba(244,247,251,0.3)";
      this.roundRect(g, -b.w / 2, -b.h / 2, b.w, b.h, 22);
      g.fill();
      g.fillStyle = INK;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `700 ${Math.round(b.h * 0.46)}px ${FONT}`;
      g.fillText(`TAKE ${b.n}`, 0, -b.h * 0.08);
      g.font = `700 ${Math.round(b.h * 0.16)}px ${FONT}`;
      g.globalAlpha *= 0.7;
      g.fillText(b.n === 1 ? "THE NEXT ONE" : "THE NEXT TWO", 0, b.h * 0.26);
      g.restore();
    }
    g.restore();
  }

  private drawPrompt(g: CanvasRenderingContext2D): void {
    const { width: w, height: h } = this.ctx;
    const active = this.activeSeat();
    let text = "";
    let color = PALE;
    if (this.phase === "turn" && active) {
      text = active.player.kind === "human" ? `${active.player.name}: TAKE 1 OR 2?` : `${active.player.name} IS COUNTING...`;
      color = active.player.color;
    } else if (this.phase === "chomp") {
      text = this.lastLine;
      color = active ? active.player.color : PALE;
    }
    if (!text) return;
    g.save();
    g.font = `700 40px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 8;
    g.strokeStyle = "rgba(7,11,20,0.8)";
    g.strokeText(text, w / 2, h * 0.63);
    g.fillStyle = color;
    g.fillText(text, w / 2, h * 0.63);
    g.restore();
  }

  private drawFloaters(g: CanvasRenderingContext2D): void {
    g.save();
    g.font = `700 40px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const fl of this.floaters) {
      g.globalAlpha = Math.min(1, fl.life / 0.4);
      g.lineWidth = 6;
      g.strokeStyle = "rgba(7,11,20,0.8)";
      g.strokeText(fl.text, fl.x, fl.y);
      g.fillStyle = fl.color;
      g.fillText(fl.text, fl.x, fl.y);
    }
    g.restore();
  }

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({ playerId: s.player.id, score: s.honey }));
  }

  getStats(): GameStat[] {
    return this.seats.map((s) => ({ playerId: s.player.id, label: "Stings", value: String(s.stings) }));
  }

  destroy(): void {
    const c = this.ctx.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
  }
}

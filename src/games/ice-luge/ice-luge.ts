import { drawTimerBar, fillArena } from "../../core/draw";
import { Callouts, Juice } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  botInput,
  chuteAt,
  FINISH_GRACE_S,
  LENGTH,
  makeCourse,
  newBotBrain,
  newSled,
  ordinal,
  placeByDistance,
  pointsForPlace,
  RACE_CAP_S,
  ROCK_SPIN_S,
  RUNOUT,
  SLED_HALF,
  stepSled,
  V0,
  V1,
  type BotBrain,
  type Course,
  type Sled,
} from "./logic";

export const iceLuge: GameDefinition = {
  id: "ice-luge",
  name: "Ice Luge",
  tagline: "Lean. Don't hit the rocks.",
  description:
    "Everyone sleds down the same winding ice chute at once, one lane each. Sleds speed up on " +
    "their own; you only steer. Hold the left or right half of your lane to lean. Grab ice " +
    "crystals for a boost, scrape a wall and you slow down, hit a rock and you spin out. The " +
    "chute gets faster and narrower on the way down. First across the finish line wins; " +
    "stragglers get 8 seconds after the winner before they're placed by distance.",
  durationMs: 0,
  controls: "Hold left / right half of your lane to steer",
  create: (ctx) => new IceLuge(ctx),
};

const INTRO_S = 2.2;
const FINAL_S = 2.4;
const FONT = "Bebas Neue, Impact, sans-serif";
const ROW_STEP = 18;
const SPRAY_EVERY = 0.045;

type Phase = "intro" | "race" | "final";

interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
}

interface Seat {
  player: Player;
  x: number;
  w: number;
  cx: number;
  laneHalf: number;
  sled: Sled;
  brain: BotBrain | null;
  floats: FloatText[];
  sprayT: number;
  flash: number;
}

interface Touch {
  seat: number;
  side: -1 | 1;
}

class IceLuge implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly course: Course;
  private readonly pointers = new Map<number, Touch>();
  private readonly sledY: number;
  private phase: Phase = "intro";
  private timer = INTRO_S;
  private raceT = 0;
  private winnerT: number | null = null;
  private nextPlace = 1;
  private countdownDone = false;
  private time = 0;
  private finished = false;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    this.course = makeCourse(ctx.rng);
    this.sledY = ctx.height * 0.74;
    const w = ctx.width / ctx.players.length;
    this.seats = ctx.players.map((player, i) => ({
      player,
      x: i * w,
      w,
      cx: i * w + w / 2,
      laneHalf: Math.min(w / 2 - 14, 220),
      sled: newSled(),
      brain: player.kind === "bot" ? newBotBrain(ctx.rng) : null,
      floats: [],
      sprayT: 0,
      flash: 0,
    }));
    this.callouts.show("READY?", "#F4F7FB", { size: 80, life: 1.4, y: 0.3 });
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += realDt;
    for (const s of this.seats) {
      s.flash = Math.max(0, s.flash - realDt * 3);
      for (const f of s.floats) {
        f.life -= realDt;
        f.y -= 40 * realDt;
      }
      s.floats = s.floats.filter((f) => f.life > 0);
    }
    if (this.finished) return;

    if (this.phase === "intro") {
      this.timer -= dt;
      if (!this.countdownDone && this.timer <= 0.8) {
        this.countdownDone = true;
        this.ctx.sfx.countdown();
      }
      if (this.timer <= 0) {
        this.phase = "race";
        this.callouts.show("GO!", "#FFB020", { size: 120, life: 0.9, y: 0.3 });
        this.ctx.sfx.go();
        this.juice.shake(0.2);
      }
      return;
    }
    if (this.phase === "final") {
      this.timer -= dt;
      if (this.timer <= 0) this.finished = true;
      return;
    }

    this.raceT += dt;
    let maxFrac = 0;
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      const sled = s.sled;
      const input = s.brain ? botInput(sled, this.course, s.brain, this.ctx.rng, dt) : this.seatInput(i);
      const ev = stepSled(sled, input, this.course, dt);
      const sx = s.cx + sled.x * s.laneHalf;

      if (ev.scraping !== 0) {
        s.sprayT -= dt;
        if (s.sprayT <= 0) {
          s.sprayT = SPRAY_EVERY;
          const wx = sx + ev.scraping * SLED_HALF * s.laneHalf;
          this.juice.burst(wx, this.sledY + 10, ["#ffffff", "#d8efff"], {
            count: 3, speed: 240, angle: ev.scraping < 0 ? Math.PI * 0.75 : Math.PI * 0.25, spread: 0.9,
            gravity: 0, size: 4, life: 0.35,
          });
        }
      }
      if (ev.scrapeStart !== 0) {
        this.ctx.sfx.tick();
        this.juice.shake(0.08);
      }
      if (ev.rock) {
        this.ctx.sfx.hit();
        this.juice.shake(0.35);
        this.juice.hitStop(0.05);
        this.juice.burst(sx, this.sledY, ["#8a93a3", "#ffffff", "#3b4453"], { count: 18, speed: 300, gravity: 500, size: 5 });
        s.floats.push({ x: s.cx, y: this.sledY - 60, text: "SPIN OUT!", color: "#FF3D7A", life: 0.9 });
        s.flash = 0.8;
      }
      for (const _crystal of ev.crystals) {
        this.ctx.sfx.collect();
        this.juice.burst(sx, this.sledY - 10, ["#9ff3ff", "#ffffff", s.player.color], { count: 14, speed: 260, gravity: 100, size: 5, life: 0.5 });
        s.floats.push({ x: s.cx, y: this.sledY - 60, text: "+BOOST", color: "#9ff3ff", life: 0.8 });
      }
      if (ev.crossed) this.cross(s);
      if (!sled.finished) maxFrac = Math.max(maxFrac, (sled.v - V0) / (V1 - V0));
    }
    this.juice.shake(Math.max(0, maxFrac) ** 2 * 0.7 * dt);

    const allDone = this.seats.every((s) => s.sled.finished);
    const graceUp = this.winnerT !== null && this.raceT - this.winnerT >= FINISH_GRACE_S;
    if (allDone || graceUp || this.raceT >= RACE_CAP_S) this.endRace();
  }

  private cross(s: Seat): void {
    const place = this.nextPlace++;
    s.sled.place = place;
    s.flash = 1;
    const label = `${s.player.name} ${ordinal(place)}!`;
    this.callouts.show(label, s.player.color, { size: 60, life: 1.3, y: 0.45 });
    this.juice.burst(s.cx, this.sledY, [s.player.color, "#ffffff", "#9ff3ff"], { count: 30, speed: 340, gravity: 300, size: 6, life: 0.9 });
    if (place === 1) {
      this.winnerT = this.raceT;
      this.ctx.sfx.win();
      this.juice.shake(0.35);
    } else {
      this.ctx.sfx.streak(5 - Math.min(4, place));
    }
  }

  private endRace(): void {
    if (this.phase !== "race") return;
    this.nextPlace = placeByDistance(this.seats.map((s) => s.sled), this.nextPlace);
    const winner = this.seats.find((s) => s.sled.place === 1);
    this.phase = "final";
    this.timer = FINAL_S;
    if (winner) {
      this.callouts.show(`${winner.player.name} WINS!`, winner.player.color, { size: 76, life: FINAL_S, y: 0.3 });
      this.ctx.sfx.win();
      this.juice.shake(0.3);
    }
  }

  private seatInput(i: number): number {
    let l = 0;
    let r = 0;
    for (const t of this.pointers.values()) {
      if (t.seat !== i) continue;
      if (t.side < 0) l = 1;
      else r = 1;
    }
    return r - l;
  }

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private touchAt(x: number): Touch | null {
    const i = Math.max(0, Math.min(this.seats.length - 1, Math.floor(x / this.seats[0]!.w)));
    const s = this.seats[i]!;
    if (s.player.kind !== "human") return null;
    return { seat: i, side: x < s.cx ? -1 : 1 };
  }

  private readonly onDown = (e: PointerEvent): void => {
    const t = this.touchAt(this.toLogical(e).x);
    if (!t) return;
    e.preventDefault();
    this.pointers.set(e.pointerId, t);
    try {
      this.ctx.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    const t = this.touchAt(this.toLogical(e).x);
    if (t) this.pointers.set(e.pointerId, t);
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
  };

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);
    for (let i = 0; i < this.seats.length; i++) this.drawLane(g, i);
    this.juice.end(g);
    for (const s of this.seats) this.drawHud(g, s);
    if (this.phase === "race" && this.winnerT !== null) {
      drawTimerBar(g, width, Math.max(0, FINISH_GRACE_S - (this.raceT - this.winnerT)), FINISH_GRACE_S);
    }
    this.callouts.draw(g, width, height);
  }

  private drawLane(g: CanvasRenderingContext2D, i: number): void {
    const s = this.seats[i]!;
    const h = this.ctx.height;
    const sled = s.sled;
    g.save();
    g.beginPath();
    g.rect(s.x, 0, s.w, h);
    g.clip();

    // Snow banks.
    const bank = g.createLinearGradient(0, 0, 0, h);
    bank.addColorStop(0, "#b7cfe3");
    bank.addColorStop(1, "#8fb0cc");
    g.fillStyle = bank;
    g.fillRect(s.x, 0, s.w, h);

    // Chute walls sampled from the top of the lane to the bottom.
    const lefts: number[] = [];
    const rights: number[] = [];
    const ys: number[] = [];
    for (let y = -ROW_STEP; y <= h + ROW_STEP; y += ROW_STEP) {
      const ch = chuteAt(this.course, sled.d + (this.sledY - y));
      ys.push(y);
      lefts.push(s.cx + (ch.center - ch.half) * s.laneHalf);
      rights.push(s.cx + (ch.center + ch.half) * s.laneHalf);
    }
    g.beginPath();
    for (let k = 0; k < ys.length; k++) {
      if (k === 0) g.moveTo(lefts[k]!, ys[k]!);
      else g.lineTo(lefts[k]!, ys[k]!);
    }
    for (let k = ys.length - 1; k >= 0; k--) g.lineTo(rights[k]!, ys[k]!);
    g.closePath();
    const ice = g.createLinearGradient(0, 0, 0, h);
    ice.addColorStop(0, "#2a7cc2");
    ice.addColorStop(1, "#4fa8e2");
    g.fillStyle = ice;
    g.fill();

    g.save();
    g.clip();
    // Ice texture: faint lines sliding down with the track.
    g.strokeStyle = "rgba(255,255,255,0.14)";
    g.lineWidth = 2;
    const stride = 150;
    const first = Math.floor((sled.d - (h - this.sledY)) / stride) * stride;
    for (let d = first; d < sled.d + this.sledY + stride; d += stride) {
      const y = this.sledY - (d - sled.d);
      g.beginPath();
      g.moveTo(s.x, y);
      g.lineTo(s.x + s.w, y + 6);
      g.stroke();
    }
    // Finish line.
    const fy = this.sledY - (LENGTH - sled.d);
    if (fy > -60 && fy < h + 60) {
      const cells = 8;
      const cw = s.w / cells;
      for (let row = 0; row < 2; row++) {
        for (let c = 0; c < cells; c++) {
          g.fillStyle = (c + row) % 2 === 0 ? "#ffffff" : "#1a2234";
          g.fillRect(s.x + c * cw, fy - 24 + row * 12, cw, 12);
        }
      }
    }
    // Speed lines once the sled is really moving.
    const frac = Math.max(0, Math.min(1, (sled.v - V0) / (V1 - V0)));
    if (frac > 0.3 && !sled.finished) {
      g.strokeStyle = "rgba(255,255,255,0.6)";
      g.lineWidth = 2;
      const n = Math.floor(frac * 12);
      for (let k = 0; k < n; k++) {
        const x = s.x + 8 + (((k * 97) % 89) / 89) * (s.w - 16);
        const len = 40 + frac * 140;
        const y = ((k * 173 + sled.d * 1.7) % (h + 2 * len)) - len;
        g.globalAlpha = (frac - 0.3) * 0.7;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + len);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    g.restore();

    // Items.
    const lo = sled.d - (h - this.sledY) - 40;
    const hi = sled.d + this.sledY + 40;
    for (const item of this.course.items) {
      if (item.d < lo) continue;
      if (item.d > hi) break;
      if (sled.taken.has(item.id)) continue;
      const ix = s.cx + item.x * s.laneHalf;
      const iy = this.sledY - (item.d - sled.d);
      if (item.kind === "crystal") this.drawCrystal(g, ix, iy);
      else this.drawRock(g, ix, iy);
    }

    // Walls.
    g.lineCap = "round";
    g.lineJoin = "round";
    for (const side of [lefts, rights]) {
      g.beginPath();
      for (let k = 0; k < ys.length; k++) {
        if (k === 0) g.moveTo(side[k]!, ys[k]!);
        else g.lineTo(side[k]!, ys[k]!);
      }
      g.strokeStyle = "rgba(20,50,90,0.45)";
      g.lineWidth = 10;
      g.stroke();
      g.strokeStyle = "#f4fbff";
      g.lineWidth = 5;
      g.stroke();
    }

    // Run-out past the finish fades the lane to let the banner read.
    if (sled.d > LENGTH + RUNOUT) {
      g.fillStyle = "rgba(7,11,20,0.35)";
      g.fillRect(s.x, 0, s.w, h);
    }

    this.drawSled(g, s);

    if (s.flash > 0) {
      g.fillStyle = `rgba(255,255,255,${s.flash * 0.35})`;
      g.fillRect(s.x, 0, s.w, h);
    }
    g.restore();
  }

  private drawCrystal(g: CanvasRenderingContext2D, x: number, y: number): void {
    const r = 15 + Math.sin(this.time * 6 + x) * 2;
    g.save();
    g.translate(x, y);
    g.rotate(this.time * 1.5);
    g.shadowColor = "#9ff3ff";
    g.shadowBlur = 14;
    g.beginPath();
    g.moveTo(0, -r);
    g.lineTo(r * 0.7, 0);
    g.lineTo(0, r);
    g.lineTo(-r * 0.7, 0);
    g.closePath();
    g.fillStyle = "#9ff3ff";
    g.fill();
    g.shadowBlur = 0;
    g.beginPath();
    g.moveTo(0, -r * 0.5);
    g.lineTo(r * 0.3, 0);
    g.lineTo(0, r * 0.5);
    g.lineTo(-r * 0.3, 0);
    g.closePath();
    g.fillStyle = "#ffffff";
    g.fill();
    g.restore();
  }

  private drawRock(g: CanvasRenderingContext2D, x: number, y: number): void {
    g.save();
    g.translate(x, y);
    g.beginPath();
    g.moveTo(-18, 6);
    g.lineTo(-12, -12);
    g.lineTo(2, -17);
    g.lineTo(17, -6);
    g.lineTo(16, 10);
    g.lineTo(0, 16);
    g.closePath();
    g.fillStyle = "#3f4756";
    g.fill();
    g.strokeStyle = "#1c2230";
    g.lineWidth = 3;
    g.stroke();
    g.beginPath();
    g.moveTo(-10, -6);
    g.lineTo(0, -11);
    g.lineTo(8, -4);
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.lineWidth = 3;
    g.stroke();
    g.restore();
  }

  private drawSled(g: CanvasRenderingContext2D, s: Seat): void {
    const sled = s.sled;
    const x = s.cx + sled.x * s.laneHalf;
    const y = this.sledY;
    const spinAngle = sled.spin > 0 ? (1 - sled.spin / ROCK_SPIN_S) * Math.PI * 3 : 0;
    const tilt = sled.vx * 0.12;
    g.save();
    g.translate(x, y);
    // Shadow.
    g.fillStyle = "rgba(10,20,40,0.3)";
    g.beginPath();
    g.ellipse(0, 10, 24, 10, 0, 0, Math.PI * 2);
    g.fill();
    g.rotate(tilt + spinAngle);
    // Runners.
    g.strokeStyle = "#1c2230";
    g.lineWidth = 4;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(-15, -26);
    g.lineTo(-15, 28);
    g.moveTo(15, -26);
    g.lineTo(15, 28);
    g.stroke();
    // Body.
    g.fillStyle = s.player.color;
    g.beginPath();
    g.moveTo(-13, -30);
    g.lineTo(13, -30);
    g.lineTo(16, 22);
    g.lineTo(-16, 22);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(7,11,20,0.6)";
    g.lineWidth = 2;
    g.stroke();
    // Rider: body stripe and helmet.
    g.fillStyle = "rgba(7,11,20,0.35)";
    g.fillRect(-7, -14, 14, 30);
    g.fillStyle = "#f4f7fb";
    g.beginPath();
    g.arc(0, -12, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = s.player.color;
    g.beginPath();
    g.arc(0, -12, 9, Math.PI, Math.PI * 2);
    g.fill();
    g.restore();
  }

  private drawHud(g: CanvasRenderingContext2D, s: Seat): void {
    const sled = s.sled;
    const h = this.ctx.height;
    const i = this.seats.indexOf(s);
    g.save();
    g.beginPath();
    g.rect(s.x, 0, s.w, h);
    g.clip();

    // Zone divider.
    if (i > 0) {
      g.fillStyle = "#070b14";
      g.fillRect(s.x - 2, 0, 4, h);
    }

    // Steering feedback for humans.
    if (s.player.kind === "human" && !sled.finished) {
      const input = this.seatInput(i);
      if (input !== 0) {
        g.fillStyle = `${s.player.color}33`;
        g.fillRect(input < 0 ? s.x : s.cx, 0, s.w / 2, h);
      }
      if (this.phase === "intro" || this.raceT < 4) {
        g.font = `700 ${Math.min(28, s.w * 0.1)}px ${FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillStyle = "rgba(7,11,20,0.55)";
        g.fillText("< HOLD", s.x + s.w * 0.25, h * 0.9);
        g.fillText("HOLD >", s.x + s.w * 0.75, h * 0.9);
      }
    }

    // Name and crystal tally.
    g.textBaseline = "top";
    g.textAlign = "left";
    g.font = `700 26px ${FONT}`;
    g.lineWidth = 5;
    g.strokeStyle = "rgba(7,11,20,0.8)";
    g.strokeText(s.player.name, s.x + 12, 32);
    g.fillStyle = s.player.color;
    g.fillText(s.player.name, s.x + 12, 32);
    g.textAlign = "right";
    const tally = String(sled.crystals);
    g.strokeText(tally, s.x + s.w - 12, 32);
    g.fillStyle = "#f4f7fb";
    g.fillText(tally, s.x + s.w - 12, 32);
    const tw = g.measureText(tally).width;
    g.save();
    g.translate(s.x + s.w - 24 - tw, 46);
    g.fillStyle = "#9ff3ff";
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(6, 0);
    g.lineTo(0, 9);
    g.lineTo(-6, 0);
    g.closePath();
    g.fill();
    g.restore();

    // Progress bar.
    const bx = s.x + 12;
    const bw = s.w - 24;
    const by = 64;
    const prog = Math.min(1, sled.d / LENGTH);
    g.fillStyle = "rgba(7,11,20,0.5)";
    g.fillRect(bx, by, bw, 6);
    g.fillStyle = s.player.color;
    g.fillRect(bx, by, bw * prog, 6);
    g.fillStyle = "#ffffff";
    g.fillRect(bx + bw - 3, by - 2, 3, 10);

    // Finishing place banner.
    if (sled.place !== null) {
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `700 ${Math.min(110, s.w * 0.4)}px ${FONT}`;
      g.lineWidth = 10;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      g.strokeText(ordinal(sled.place), s.cx, h * 0.42);
      g.fillStyle = sled.place === 1 ? "#FFB020" : s.player.color;
      g.fillText(ordinal(sled.place), s.cx, h * 0.42);
    }

    // Floating texts.
    for (const f of s.floats) {
      g.globalAlpha = Math.min(1, f.life / 0.3);
      g.font = `700 30px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 6;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      g.strokeText(f.text, f.x, f.y);
      g.fillStyle = f.color;
      g.fillText(f.text, f.x, f.y);
    }
    g.globalAlpha = 1;
    g.restore();
  }

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({ playerId: s.player.id, score: pointsForPlace(s.sled.place) }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const s of this.seats) {
      out.push({ playerId: s.player.id, label: "Crystals", value: String(s.sled.crystals) });
      out.push({ playerId: s.player.id, label: "Wall scrapes", value: String(s.sled.scrapes) });
    }
    return out;
  }

  destroy(): void {
    const c = this.ctx.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
    this.pointers.clear();
  }
}

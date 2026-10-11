import { fillArena } from "../../core/draw";
import { Callouts, Juice } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  advanceLight, botOnLight, collectHazard, FINISH_GRACE_S, newBot, newLight, newRunner, placeByDistance,
  placeFinishers, placePoints, planHazards, tapRunner, tickBot, updateRunner,
  type BotBrain, type Hazard, type Light, type LightPhase, type Runner,
} from "./logic";

export const mashDash: GameDefinition = {
  id: "mash-dash",
  name: "Mash Dash",
  tagline: "Green: mash! Red: FREEZE!",
  description:
    "A wind-up foot race, one lane each. Mash your lane to run; faster mashing builds a speed bonus. " +
    "Watch the traffic light: tap on RED and you trip, slide back and eat the dirt. After halfway the " +
    "yellow warning vanishes and reds come fast. Bananas waste a tap, springs launch you. First across wins.",
  durationMs: 0,
  controls: "Tap your lane on GREEN. Freeze on RED.",
  create: (ctx) => new MashDash(ctx),
};

const FONT = "Bebas Neue, Impact, sans-serif";
const INTRO_S = 1.6;
const FINAL_S = 2.4;
/** Hard cap so a race can never hang. */
const MAX_RACE_S = 100;
const PLACE_NAMES = ["1ST", "2ND", "3RD", "4TH"];

type Phase = "intro" | "race" | "final";

interface Seat {
  player: Player;
  runner: Runner;
  bot: BotBrain | null;
  y: number;
  h: number;
  hop: number;
  keyAngle: number;
  slip: number;
  boost: number;
  lastStep: number;
}

class MashDash implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly light: Light;
  private phase: Phase = "intro";
  private timer = INTRO_S;
  private clock = 0;
  private raceT = 0;
  private nextPlace = 1;
  private grace: number | null = null;
  private finished = false;
  private lightFlash = 0;
  private readonly topH: number;
  private readonly startX: number;
  private readonly finishX: number;
  private readonly pointers = new Set<number>();

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    this.light = newLight(ctx.rng);
    this.topH = Math.round(ctx.height * 0.17);
    this.startX = 150;
    this.finishX = ctx.width - 90;
    const laneH = (ctx.height - this.topH) / ctx.players.length;
    this.seats = ctx.players.map((player, i) => ({
      player,
      runner: newRunner(planHazards(ctx.rng)),
      bot: player.kind === "bot" ? newBot(ctx.rng) : null,
      y: this.topH + i * laneH,
      h: laneH,
      hop: 0, keyAngle: 0, slip: 0, boost: 0, lastStep: -9,
    }));
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.clock += realDt;
    this.lightFlash = Math.max(0, this.lightFlash - realDt * 3);
    for (const s of this.seats) {
      s.hop = Math.max(0, s.hop - realDt * 6);
      s.slip = Math.max(0, s.slip - realDt * 2.5);
      s.boost = Math.max(0, s.boost - realDt * 2);
      const moving = this.clock - s.lastStep < 0.25 && s.runner.stun <= 0;
      s.keyAngle += realDt * (moving ? 14 : 1.5);
    }
    if (this.finished) return;

    if (this.phase === "intro") {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = "race";
        this.callouts.show("GO!", "#B8FF3D", { size: 120, life: 0.8, y: 0.5 });
        this.ctx.sfx.go();
      }
      return;
    }
    if (this.phase === "final") {
      this.timer -= dt;
      if (this.timer <= 0) this.finished = true;
      return;
    }

    this.raceT += dt;
    const prev: LightPhase = this.light.phase;
    if (advanceLight(this.light, dt, this.ctx.rng)) this.onLight(prev);
    if (!this.light.late && this.seats.some((s) => s.runner.progress >= 0.5)) {
      this.light.late = true;
      this.callouts.show("NO MORE WARNINGS!", "#FF3D7A", { size: 60, life: 1.4, y: 0.5 });
      this.ctx.sfx.streak(2);
    }

    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      updateRunner(s.runner, dt);
      if (s.bot && s.runner.place === null && tickBot(s.bot, this.light, dt, this.ctx.rng)) this.press(i);
    }

    if (this.grace !== null) {
      this.grace -= dt;
      if (this.grace <= 0) this.endRace();
    } else if (this.raceT >= MAX_RACE_S) {
      this.endRace();
    }
  }

  private onLight(prev: LightPhase): void {
    this.lightFlash = 1;
    for (const s of this.seats) if (s.bot) botOnLight(s.bot, this.light, prev, this.ctx.rng);
    if (this.light.phase === "red") {
      this.ctx.sfx.countdown();
      this.juice.shake(0.12);
    } else if (this.light.phase === "yellow") {
      this.ctx.sfx.tick();
    } else {
      this.ctx.sfx.go();
    }
  }

  private press(i: number): void {
    if (this.phase !== "race") return;
    const s = this.seats[i]!;
    const r = s.runner;
    const res = tapRunner(r, this.light, this.clock * 1000);
    const x = this.runnerX(r);
    const groundY = s.y + s.h * 0.8;
    if (res === "ignored") return;
    if (res === "trip") {
      this.juice.shake(0.3);
      this.juice.hitStop(0.05);
      this.juice.burst(x, groundY, ["#b8925a", "#FF3D7A", s.player.color], {
        count: 18, speed: 260, angle: -Math.PI / 2, spread: 1.6, gravity: 700, size: 5,
      });
      this.callouts.show("TRIP!", "#FF3D7A", { size: 44, life: 0.6, y: (groundY - s.h * 0.45) / this.ctx.height });
      this.ctx.sfx.miss();
      return;
    }
    if (res === "slip") {
      s.slip = 1;
      this.juice.burst(x, groundY, ["#FFE34D", "#ffffff"], { count: 10, speed: 200, gravity: 500, size: 4 });
      this.ctx.sfx.whoosh();
      return;
    }
    s.hop = 1;
    s.lastStep = this.clock;
    this.juice.burst(x - 14, groundY, "rgba(244,247,251,0.5)", {
      count: 3, speed: 90, angle: Math.PI, spread: 1, gravity: 200, size: 3, life: 0.3,
    });
    if (r.chain > 0 && r.chain % 6 === 0) this.ctx.sfx.streak(Math.min(4, r.chain / 6));
    else this.ctx.sfx.tick();

    let h: Hazard | null;
    while ((h = collectHazard(r)) !== null) this.onHazard(s, h);

    if (r.progress >= 1) this.cross(s);
  }

  private onHazard(s: Seat, h: Hazard): void {
    const x = this.startX + h.at * (this.finishX - this.startX);
    const groundY = s.y + s.h * 0.8;
    if (h.kind === "spring") {
      s.boost = 1;
      s.hop = 1.6;
      this.juice.shake(0.2);
      this.juice.burst(x, groundY, [s.player.color, "#ffffff", "#B8FF3D"], {
        count: 22, speed: 380, angle: 0, spread: 1.2, gravity: 300, size: 5,
      });
      this.callouts.show("BOING!", "#B8FF3D", { size: 44, life: 0.6, y: (groundY - s.h * 0.45) / this.ctx.height });
      this.ctx.sfx.whoosh();
    } else {
      this.ctx.sfx.tick();
    }
  }

  private cross(s: Seat): void {
    this.nextPlace = placeFinishers([s.runner], this.nextPlace);
    const place = s.runner.place ?? 1;
    const x = this.finishX;
    this.juice.burst(x, s.y + s.h / 2, [s.player.color, "#ffffff", "#FFB020"], { count: 30, speed: 420, gravity: 300, size: 5 });
    if (place === 1) {
      this.grace = FINISH_GRACE_S;
      this.juice.shake(0.5);
      this.juice.hitStop(0.1);
      this.callouts.show(`${s.player.name} WINS!`, s.player.color, { size: 84, life: 2.2, y: 0.5 });
      this.ctx.sfx.win();
    } else {
      this.callouts.show(`${s.player.name} ${PLACE_NAMES[place - 1] ?? ""}`, s.player.color, { size: 56, life: 1.2, y: 0.5 });
      this.ctx.sfx.collect();
    }
    if (this.seats.every((seat) => seat.runner.place !== null)) this.endRace();
  }

  private endRace(): void {
    if (this.phase !== "race") return;
    this.nextPlace = placeByDistance(this.seats.map((s) => s.runner), this.nextPlace);
    this.phase = "final";
    this.timer = FINAL_S;
    const winner = this.seats.find((s) => s.runner.place === 1);
    this.callouts.show("RACE OVER", "#F4F7FB", { size: 72, life: FINAL_S, y: 0.3 });
    if (winner) this.callouts.show(`${winner.player.name} TAKES IT`, winner.player.color, { size: 48, life: FINAL_S, y: 0.42 });
  }

  private runnerX(r: Runner): number {
    return this.startX + r.progress * (this.finishX - this.startX);
  }

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const rect = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / (rect.width || 1)) * this.ctx.width,
      y: ((e.clientY - rect.top) / (rect.height || 1)) * this.ctx.height,
    };
  }

  private readonly onDown = (e: PointerEvent): void => {
    this.pointers.add(e.pointerId);
    const p = this.toLogical(e);
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (s.player.kind !== "human") continue;
      if (p.y >= s.y && p.y < s.y + s.h) {
        e.preventDefault();
        this.press(i);
        return;
      }
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
  };

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);
    for (const s of this.seats) this.drawLane(g, s);
    this.juice.end(g);
    this.drawTopBar(g);
    if (this.lightFlash > 0 && this.phase === "race") {
      const col = this.light.phase === "red" ? "255,61,122" : this.light.phase === "yellow" ? "255,176,32" : "184,255,61";
      g.fillStyle = `rgba(${col},${this.lightFlash * 0.22})`;
      g.fillRect(0, 0, width, height);
    }
    if (this.phase === "intro") {
      g.save();
      g.font = `700 90px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 10;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      g.strokeText("READY...", width / 2, height * 0.5);
      g.fillStyle = "#F4F7FB";
      g.fillText("READY...", width / 2, height * 0.5);
      g.restore();
    }
    this.callouts.draw(g, width, height);
  }

  private drawTopBar(g: CanvasRenderingContext2D): void {
    const { width } = this.ctx;
    const h = this.topH;
    g.save();
    g.fillStyle = "rgba(7,11,20,0.75)";
    g.fillRect(0, 0, width, h);
    g.fillStyle = "rgba(244,247,251,0.12)";
    g.fillRect(0, h - 3, width, 3);

    // Traffic light housing.
    const r = h * 0.28;
    const cx = width / 2;
    const cy = h / 2;
    const boxW = r * 7.6;
    g.fillStyle = "#1a2236";
    g.beginPath();
    g.roundRect(cx - boxW / 2, cy - r * 1.4, boxW, r * 2.8, r * 0.6);
    g.fill();
    g.strokeStyle = "rgba(244,247,251,0.2)";
    g.lineWidth = 3;
    g.stroke();
    const bulbs: [LightPhase, string][] = [["red", "#FF3D7A"], ["yellow", "#FFB020"], ["green", "#B8FF3D"]];
    const racing = this.phase === "race";
    bulbs.forEach(([phase, color], k) => {
      const on = racing && this.light.phase === phase;
      const x = cx + (k - 1) * r * 2.4;
      g.beginPath();
      g.arc(x, cy, r, 0, Math.PI * 2);
      g.fillStyle = on ? color : "#0a1020";
      g.shadowColor = color;
      g.shadowBlur = on ? 30 : 0;
      g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = "rgba(244,247,251,0.15)";
      g.lineWidth = 2;
      g.stroke();
    });

    g.textBaseline = "middle";
    g.font = `700 ${Math.round(h * 0.42)}px ${FONT}`;
    let text = "";
    let color = "#F4F7FB";
    if (racing) {
      if (this.light.phase === "red") { text = "FREEZE!"; color = "#FF3D7A"; }
      else if (this.light.phase === "yellow") { text = "EASY..."; color = "#FFB020"; }
      else { text = "MASH!"; color = "#B8FF3D"; }
    }
    g.textAlign = "right";
    g.fillStyle = color;
    g.fillText(text, cx - boxW / 2 - 24, cy);
    g.textAlign = "left";
    if (racing && this.grace !== null) {
      g.fillStyle = "#F4F7FB";
      g.fillText(`${Math.ceil(this.grace)}s LEFT`, cx + boxW / 2 + 24, cy);
    } else if (racing && this.light.late) {
      g.fillStyle = "#FF3D7A";
      g.font = `700 ${Math.round(h * 0.3)}px ${FONT}`;
      g.fillText("NO WARNINGS", cx + boxW / 2 + 24, cy);
    } else if (racing) {
      g.fillStyle = color;
      g.fillText(text, cx + boxW / 2 + 24, cy);
    }
    g.restore();
  }

  private drawLane(g: CanvasRenderingContext2D, s: Seat): void {
    const { width } = this.ctx;
    const { y, h, player } = s;
    const r = s.runner;
    const i = this.seats.indexOf(s);
    g.save();
    g.fillStyle = i % 2 === 0 ? "rgba(244,247,251,0.04)" : "rgba(244,247,251,0.015)";
    g.fillRect(0, y, width, h);
    g.globalAlpha = r.place !== null ? 0.2 : 0.08;
    g.fillStyle = player.color;
    g.fillRect(0, y, width, h);
    g.globalAlpha = 1;
    g.strokeStyle = "rgba(244,247,251,0.12)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, y + h);
    g.lineTo(width, y + h);
    g.stroke();

    // Ground line and start / finish.
    const groundY = y + h * 0.8;
    g.fillStyle = "rgba(244,247,251,0.1)";
    g.fillRect(this.startX - 40, groundY, this.finishX - this.startX + 60, 3);
    g.fillStyle = "rgba(244,247,251,0.25)";
    g.fillRect(this.startX - 2, y + h * 0.25, 4, h * 0.55);
    const sq = Math.max(6, Math.min(12, h / 10));
    const cols = 2;
    for (let c = 0; c < cols; c++) {
      for (let k = 0; k * sq < h * 0.55; k++) {
        g.fillStyle = (k + c) % 2 === 0 ? "#F4F7FB" : "#070b14";
        g.fillRect(this.finishX + c * sq, y + h * 0.25 + k * sq, sq, Math.min(sq, h * 0.8 - (y + h * 0.25 + k * sq - y)));
      }
    }

    // Name and tap hint.
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillStyle = player.color;
    g.font = `700 ${Math.round(Math.min(34, h * 0.26))}px ${FONT}`;
    g.fillText(player.name, 14, y + h * 0.3);
    if (r.place !== null) {
      g.fillStyle = "#F4F7FB";
      g.fillText(PLACE_NAMES[r.place - 1] ?? "", 14, y + h * 0.62);
    } else if (player.kind === "human" && this.phase === "race") {
      g.fillStyle = "rgba(244,247,251,0.35)";
      g.font = `700 ${Math.round(Math.min(22, h * 0.18))}px ${FONT}`;
      g.fillText(this.light.phase === "red" ? "FREEZE" : "TAP TAP TAP", 14, y + h * 0.62);
    }

    for (const hz of r.hazards) if (!hz.used) this.drawHazard(g, hz, groundY, h);
    this.drawRunner(g, s, groundY);

    // Speed bonus meter.
    if (r.place === null && r.chain > 0 && r.stun <= 0) {
      const x = this.runnerX(r);
      const w = 60;
      const fill = Math.min(1, r.chain / 12);
      g.fillStyle = "rgba(244,247,251,0.15)";
      g.fillRect(x - w / 2, y + 8, w, 6);
      g.fillStyle = fill >= 1 ? "#FFB020" : player.color;
      g.fillRect(x - w / 2, y + 8, w * fill, 6);
    }
    g.restore();
  }

  private drawHazard(g: CanvasRenderingContext2D, hz: Hazard, groundY: number, laneH: number): void {
    const x = this.startX + hz.at * (this.finishX - this.startX);
    const sc = Math.min(1, laneH / 150);
    g.save();
    g.translate(x, groundY);
    g.scale(sc, sc);
    if (hz.kind === "banana") {
      g.strokeStyle = "#FFE34D";
      g.lineWidth = 9;
      g.lineCap = "round";
      g.beginPath();
      g.arc(0, -4, 20, Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
      g.strokeStyle = "#8a6b12";
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(-18, 2);
      g.lineTo(-24, -4);
      g.stroke();
    } else {
      g.strokeStyle = "#c9ced6";
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(-14, 0);
      for (let k = 0; k < 5; k++) g.lineTo(k % 2 === 0 ? 14 : -14, -6 - k * 7);
      g.stroke();
      g.fillStyle = "#B8FF3D";
      g.fillRect(-18, -40, 36, 6);
    }
    g.restore();
  }

  private drawRunner(g: CanvasRenderingContext2D, s: Seat, groundY: number): void {
    const r = s.runner;
    const x = this.runnerX(r);
    const sc = Math.min(1, s.h / 150);
    const hop = Math.sin(Math.min(1, s.hop) * Math.PI) * 22 * sc * (s.boost > 0 ? 1.8 : 1);
    g.save();
    g.translate(x, groundY - hop);
    g.scale(sc, sc);
    const tripped = r.stun > 0;
    if (tripped) {
      g.translate(-10, 0);
      g.rotate(Math.PI / 2 - (r.stun / 0.8) * 0.15);
      g.translate(0, 26);
    } else if (s.slip > 0) {
      g.rotate(-Math.sin(s.slip * Math.PI) * 0.5);
    } else if (s.hop > 0) {
      g.rotate(Math.sin(s.hop * Math.PI) * 0.12);
    }
    const col = s.player.color;
    // Wind-up key on the back.
    g.save();
    g.translate(-30, -40);
    g.rotate(s.keyAngle);
    g.strokeStyle = "#c9ced6";
    g.lineWidth = 5;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(-18, 0);
    g.lineTo(18, 0);
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 6, 0, Math.PI * 2);
    g.fillStyle = "#c9ced6";
    g.fill();
    g.restore();
    // Legs: scissor while hopping.
    const legSwing = s.hop > 0 ? Math.sin(s.hop * Math.PI) * 16 : 0;
    g.strokeStyle = col;
    g.lineWidth = 8;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(-8, -20);
    g.lineTo(-10 - legSwing, 0);
    g.moveTo(8, -20);
    g.lineTo(10 + legSwing, 0);
    g.stroke();
    // Body: round with a face.
    g.fillStyle = col;
    g.shadowColor = col;
    g.shadowBlur = 12;
    g.beginPath();
    g.roundRect(-24, -70, 48, 54, 14);
    g.fill();
    g.shadowBlur = 0;
    g.fillStyle = "rgba(255,255,255,0.22)";
    g.beginPath();
    g.ellipse(-8, -56, 12, 7, -0.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#070b14";
    if (tripped) {
      g.lineWidth = 3;
      g.strokeStyle = "#070b14";
      for (const ex of [-9, 9]) {
        g.beginPath();
        g.moveTo(ex - 4, -50); g.lineTo(ex + 4, -42);
        g.moveTo(ex + 4, -50); g.lineTo(ex - 4, -42);
        g.stroke();
      }
    } else {
      g.beginPath();
      g.arc(6, -46, 4, 0, Math.PI * 2);
      g.arc(16, -46, 4, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    if (tripped) {
      g.save();
      g.fillStyle = "#FFB020";
      g.font = `700 ${Math.round(22 * sc)}px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      const t = this.clock * 6;
      for (let k = 0; k < 3; k++) {
        const a = t + (k * Math.PI * 2) / 3;
        g.fillText("*", x + Math.cos(a) * 30 * sc, groundY - 50 * sc + Math.sin(a) * 10 * sc);
      }
      g.restore();
    }
  }

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({
      playerId: s.player.id,
      score: s.runner.place === null ? 0 : placePoints(s.runner.place),
    }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const s of this.seats) {
      out.push({ playerId: s.player.id, label: "Taps", value: String(s.runner.taps) });
      out.push({ playerId: s.player.id, label: "Trips", value: String(s.runner.trips) });
    }
    return out;
  }

  destroy(): void {
    const c = this.ctx.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
    this.pointers.clear();
  }
}

import { fillArena } from "../../core/draw";
import { Callouts, Juice, loadBest, saveBest } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  advanceLight, bankPot, botOnLight, collectHazard, dareMult, FINISH_GRACE_S, newBot, newLight, newRunner,
  pickHeckleTarget, placeByDistance, placeFinishers, placePoints, planHazards, scoreTime, tapRunner, throwPeel,
  tickBot, tickHeckler, timeScore, updateRunner, updateTurbo,
  type BotBrain, type Hazard, type Light, type LightPhase, type Runner,
} from "./logic";

export const mashDash: GameDefinition = {
  id: "mash-dash",
  name: "Dare Dash",
  tagline: "Green: mash! Yellow: dare! Red: FREEZE!",
  description:
    "A wind-up foot race, one lane each. Mash your lane on GREEN to run. YELLOW is the dare: every tap charges " +
    "a pot that rockets you forward when the light goes green again, but only if you hold still through the " +
    "RED. Twitch on red and you trip, slide back and the pot bursts. Finished runners heckle from the bench " +
    "with banana peels; last place gets turbo. First across wins.",
  durationMs: 0,
  controls: "Tap your lane on GREEN. Dare on YELLOW. Freeze on RED.",
  create: (ctx) => new MashDash(ctx),
};

const FONT = "Bebas Neue, Impact, sans-serif";
const INTRO_S = 1.6;
const FINAL_S = 2.4;
/** Hard cap so a race can never hang. */
const MAX_RACE_S = 75;
const PEEL_FLIGHT_S = 0.45;
const BEST_KEY = "v2-time";
const PLACE_NAMES = ["1ST", "2ND", "3RD", "4TH"];
const RED = "#FF3D7A";
const YELLOW = "#FFB020";
const GREEN = "#B8FF3D";
const INK = "#F4F7FB";

type Phase = "intro" | "race" | "final";

interface BenchButton {
  target: number;
  x: number;
  y: number;
  r: number;
}

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
  /** Dash slide-in after a payout: 1 = still at the old spot. */
  dashT: number;
  dashFromX: number;
  potPop: number;
  lastStep: number;
  turboFlash: number;
  best: number;
  benchButtons: BenchButton[];
  /** Clock time of the last lane callout, so a second one stacks lower instead of overlapping. */
  calloutAt: number;
  calloutLow: boolean;
}

interface Peel {
  hazard: Hazard;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
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
  private redAtMs = 0;
  private nextPlace = 1;
  private grace: number | null = null;
  private finished = false;
  private lightFlash = 0;
  private peels: Peel[] = [];
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
      hop: 0, keyAngle: 0, slip: 0, boost: 0, dashT: 0, dashFromX: 0, potPop: 0, lastStep: -9, turboFlash: 0,
      best: player.kind === "human" ? loadBest(mashDash.id, BEST_KEY) : 0,
      benchButtons: [], calloutAt: -9, calloutLow: false,
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
      s.dashT = Math.max(0, s.dashT - realDt * 3);
      s.potPop = Math.max(0, s.potPop - realDt * 5);
      s.turboFlash = Math.max(0, s.turboFlash - realDt);
      const moving = this.clock - s.lastStep < 0.25 && s.runner.stun <= 0;
      s.keyAngle += realDt * (moving ? 14 : s.runner.turbo ? 4 : 1.5);
    }
    for (const p of this.peels) p.t += realDt / PEEL_FLIGHT_S;
    this.peels = this.peels.filter((p) => p.t < 1);
    if (this.finished) return;

    if (this.phase === "intro") {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = "race";
        this.callouts.show("GO!", GREEN, { size: 120, life: 0.8, y: 0.5 });
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
      this.callouts.show("OVERDRIVE!", RED, { size: 84, life: 1.4, y: 0.42 });
      this.callouts.show("SHORT LIGHTS · DARES PAY x4", YELLOW, { size: 40, life: 1.6, y: 0.54 });
      this.juice.shake(0.25);
      this.ctx.sfx.streak(4);
    }

    const runners = this.seats.map((s) => s.runner);
    updateTurbo(runners);
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      const wasTurbo = s.turboFlash > 0;
      updateRunner(s.runner, dt);
      if (s.runner.turbo) {
        if (!wasTurbo) {
          this.juice.burst(this.runnerX(s.runner), s.y + s.h * 0.5, [YELLOW, "#ffffff"], { count: 14, speed: 220, gravity: 100, size: 4 });
          this.ctx.sfx.streak(1);
        }
        s.turboFlash = 0.5;
      }
      if (!s.bot) continue;
      if (s.runner.place === null) {
        if (tickBot(s.bot, this.light, dt, this.ctx.rng)) this.press(i);
      } else if (tickHeckler(s.bot, dt, this.ctx.rng)) {
        const target = pickHeckleTarget(runners);
        if (target >= 0) this.heckle(i, target);
      }
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
      this.redAtMs = this.clock * 1000;
      this.ctx.sfx.countdown();
      this.juice.shake(0.12);
    } else if (this.light.phase === "yellow") {
      this.ctx.sfx.tick();
      this.ctx.sfx.select();
    } else {
      this.ctx.sfx.go();
      if (prev === "red") for (const s of this.seats) this.payout(s);
    }
  }

  /** A callout inside one lane. Two in quick succession take turns between the upper and lower half. */
  private laneCallout(s: Seat, text: string, color: string, size: number, life: number): void {
    s.calloutLow = this.clock - s.calloutAt < 0.9 ? !s.calloutLow : false;
    s.calloutAt = this.clock;
    const y = s.y + s.h * (s.calloutLow ? 0.62 : 0.28);
    this.callouts.show(text, color, { size, life, y: y / this.ctx.height });
  }

  private payout(s: Seat): void {
    const r = s.runner;
    if (r.place !== null) return;
    const fromX = this.runnerX(r);
    const pay = bankPot(r, this.redAtMs);
    if (!pay) return;
    s.dashT = 1;
    s.dashFromX = fromX;
    s.boost = 1;
    s.hop = 1.2;
    s.lastStep = this.clock;
    const groundY = s.y + s.h * 0.8;
    const toX = this.runnerX(r);
    this.juice.burst(toX, groundY - 30, [s.player.color, "#ffffff", YELLOW], {
      count: 10 + pay.taps * 3, speed: 420, angle: Math.PI, spread: 0.9, gravity: 200, size: 5, life: 0.5,
    });
    const pct = `+${Math.round(pay.amount * 100)}%`;
    if (pay.clutch) {
      this.laneCallout(s, `CLUTCH! ${pct}`, YELLOW, 48, 1);
      this.juice.shake(0.2);
      this.ctx.sfx.win();
    } else {
      this.laneCallout(s, `BANKED ${pct}`, s.player.color, 42, 0.9);
      this.ctx.sfx.collect();
    }
    this.ctx.sfx.whoosh();
    let h: Hazard | null;
    while ((h = collectHazard(r)) !== null) this.onHazard(s, h);
    if (r.progress >= 1) this.cross(s);
  }

  private press(i: number): void {
    if (this.phase !== "race") return;
    const s = this.seats[i]!;
    const r = s.runner;
    const res = tapRunner(r, this.light, this.clock * 1000);
    const x = this.runnerX(r);
    const groundY = s.y + s.h * 0.8;
    if (res === "ignored") return;
    if (res === "trip" || res === "bust") {
      this.juice.shake(res === "bust" ? 0.4 : 0.3);
      this.juice.hitStop(res === "bust" ? 0.07 : 0.05);
      this.juice.burst(x, groundY, ["#b8925a", RED, s.player.color], {
        count: 18, speed: 260, angle: -Math.PI / 2, spread: 1.6, gravity: 700, size: 5,
      });
      if (res === "bust") {
        this.juice.burst(x, groundY - 60, [YELLOW, RED, "#ffffff"], { count: 26, speed: 320, gravity: 400, size: 5 });
        this.laneCallout(s, "BUSTED!", RED, 56, 0.9);
        this.ctx.sfx.hit();
      } else {
        this.laneCallout(s, "TRIP!", RED, 44, 0.6);
      }
      this.ctx.sfx.miss();
      return;
    }
    if (res === "slip") {
      s.slip = 1;
      this.juice.burst(x, groundY, ["#FFE34D", "#ffffff"], { count: 10, speed: 200, gravity: 500, size: 4 });
      this.laneCallout(s, "SLIP!", "#FFE34D", 34, 0.5);
      this.ctx.sfx.whoosh();
      return;
    }
    if (res === "dare") {
      s.potPop = 1;
      s.keyAngle += 0.6;
      this.juice.burst(x, groundY - 70, [YELLOW, "#ffffff"], {
        count: 3, speed: 140, angle: -Math.PI / 2, spread: 1.2, gravity: -60, size: 3, life: 0.4,
      });
      this.ctx.sfx.streak(Math.min(6, r.potTaps));
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
      this.juice.burst(x, groundY, [s.player.color, "#ffffff", GREEN], {
        count: 22, speed: 380, angle: 0, spread: 1.2, gravity: 300, size: 5,
      });
      this.laneCallout(s, "BOING!", GREEN, 44, 0.6);
      this.ctx.sfx.whoosh();
    } else {
      this.ctx.sfx.tick();
    }
  }

  /** A benched seat lobs a peel at a running rival. */
  private heckle(from: number, target: number): void {
    const f = this.seats[from]!;
    const t = this.seats[target]!;
    const peel = throwPeel(f.runner, t.runner);
    if (!peel) return;
    this.peels.push({
      hazard: peel,
      x0: this.finishX - 40,
      y0: f.y + f.h * 0.5,
      x1: this.startX + peel.at * (this.finishX - this.startX),
      y1: t.y + t.h * 0.8,
      t: 0,
    });
    this.laneCallout(f, "PEEL!", "#FFE34D", 30, 0.5);
    this.ctx.sfx.whoosh();
  }

  private cross(s: Seat): void {
    this.nextPlace = placeFinishers([s.runner], this.nextPlace, this.raceT);
    const place = s.runner.place ?? 1;
    const x = this.finishX;
    this.juice.burst(x, s.y + s.h / 2, [s.player.color, "#ffffff", YELLOW], { count: 30, speed: 420, gravity: 300, size: 5 });
    if (place === 1) {
      this.grace = FINISH_GRACE_S;
      this.juice.shake(0.5);
      this.juice.hitStop(0.1);
      this.callouts.show(`${s.player.name} WINS!`, s.player.color, { size: 84, life: 2.2, y: 0.5 });
      this.callouts.show("HECKLE FROM THE BENCH!", INK, { size: 34, life: 2.2, y: 0.6 });
      this.ctx.sfx.win();
    } else {
      this.callouts.show(`${s.player.name} ${PLACE_NAMES[place - 1] ?? ""}`, s.player.color, { size: 56, life: 1.2, y: 0.5 });
      this.ctx.sfx.collect();
    }
    if (s.player.kind === "human" && s.runner.finishS !== null) {
      const score = timeScore(s.runner.finishS);
      if (saveBest(mashDash.id, score, BEST_KEY)) {
        s.best = score;
        this.callouts.show(`NEW RECORD ${s.runner.finishS.toFixed(1)}s`, YELLOW, { size: 48, life: 1.8, y: 0.7 });
        this.ctx.sfx.streak(5);
      }
    }
    if (s.bot) s.bot.heckleWait = this.ctx.rng.float(1, 2.5);
    if (this.seats.every((seat) => seat.runner.place !== null)) this.endRace();
  }

  private endRace(): void {
    if (this.phase !== "race") return;
    this.nextPlace = placeByDistance(this.seats.map((s) => s.runner), this.nextPlace);
    this.phase = "final";
    this.timer = FINAL_S;
    const winner = this.seats.find((s) => s.runner.place === 1);
    this.callouts.show("RACE OVER", INK, { size: 72, life: FINAL_S, y: 0.3 });
    if (winner) this.callouts.show(`${winner.player.name} TAKES IT`, winner.player.color, { size: 48, life: FINAL_S, y: 0.42 });
  }

  private runnerX(r: Runner): number {
    return this.startX + r.progress * (this.finishX - this.startX);
  }

  /** Where the runner is drawn: slides in from the old spot after a payout. */
  private drawX(s: Seat): number {
    const x = this.runnerX(s.runner);
    if (s.dashT <= 0) return x;
    const k = s.dashT * s.dashT;
    return x - (x - s.dashFromX) * k;
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
      if (p.y < s.y || p.y >= s.y + s.h) continue;
      e.preventDefault();
      if (s.runner.place === null) {
        this.press(i);
        return;
      }
      for (const b of s.benchButtons) {
        if (Math.hypot(p.x - b.x, p.y - b.y) <= b.r) {
          this.heckle(i, b.target);
          return;
        }
      }
      return;
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
    this.drawPeels(g);
    this.juice.end(g);
    this.drawTopBar(g);
    if (this.lightFlash > 0 && this.phase === "race") {
      const col = this.light.phase === "red" ? "255,61,122" : this.light.phase === "yellow" ? "255,176,32" : "184,255,61";
      g.fillStyle = `rgba(${col},${this.lightFlash * 0.22})`;
      g.fillRect(0, 0, width, height);
    }
    if (this.phase === "race" && this.light.phase === "red") {
      // Red vignette: the whole screen holds its breath.
      const a = 0.12 + 0.08 * Math.sin(this.clock * 10);
      g.fillStyle = `rgba(255,61,122,${a.toFixed(3)})`;
      g.fillRect(0, this.topH, width, 6);
      g.fillRect(0, height - 6, width, 6);
    }
    if (this.phase === "intro") {
      g.save();
      g.font = `700 90px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 10;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      g.strokeText("READY...", width / 2, height * 0.5);
      g.fillStyle = INK;
      g.fillText("READY...", width / 2, height * 0.5);
      g.font = `700 34px ${FONT}`;
      g.fillStyle = YELLOW;
      g.lineWidth = 6;
      g.strokeText("YELLOW TAPS CHARGE A DASH · FREEZE ON RED TO CASH IT", width / 2, height * 0.62);
      g.fillText("YELLOW TAPS CHARGE A DASH · FREEZE ON RED TO CASH IT", width / 2, height * 0.62);
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
    const bulbs: [LightPhase, string][] = [["red", RED], ["yellow", YELLOW], ["green", GREEN]];
    const racing = this.phase === "race";
    bulbs.forEach(([phase, color], k) => {
      const on = racing && this.light.phase === phase;
      const x = cx + (k - 1) * r * 2.4;
      if (on) {
        g.fillStyle = color;
        g.globalAlpha = 0.25 + 0.1 * Math.sin(this.clock * 12);
        g.beginPath();
        g.arc(x, cy, r * 1.45, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      }
      g.beginPath();
      g.arc(x, cy, r, 0, Math.PI * 2);
      g.fillStyle = on ? color : "#0a1020";
      g.fill();
      g.strokeStyle = "rgba(244,247,251,0.15)";
      g.lineWidth = 2;
      g.stroke();
    });

    g.textBaseline = "middle";
    g.font = `700 ${Math.round(h * 0.42)}px ${FONT}`;
    let text = "";
    let color = INK;
    if (racing) {
      if (this.light.phase === "red") { text = "FREEZE!"; color = RED; }
      else if (this.light.phase === "yellow") { text = `DARE x${dareMult(this.light)}!`; color = YELLOW; }
      else { text = "MASH!"; color = GREEN; }
    }
    g.textAlign = "right";
    g.fillStyle = color;
    g.fillText(text, cx - boxW / 2 - 24, cy);
    g.textAlign = "left";
    if (racing && this.grace !== null) {
      g.fillStyle = INK;
      g.fillText(`${Math.ceil(this.grace)}s LEFT`, cx + boxW / 2 + 24, cy);
    } else if (racing && this.light.late) {
      g.fillStyle = RED;
      g.font = `700 ${Math.round(h * 0.3)}px ${FONT}`;
      g.fillText("OVERDRIVE", cx + boxW / 2 + 24, cy);
    } else if (racing) {
      g.fillStyle = color;
      g.fillText(text, cx + boxW / 2 + 24, cy);
    }
    // Race clock, far right.
    if (racing || this.phase === "final") {
      g.textAlign = "right";
      g.font = `700 ${Math.round(h * 0.26)}px ${FONT}`;
      g.fillStyle = "rgba(244,247,251,0.45)";
      g.fillText(`${this.raceT.toFixed(1)}s`, width - 16, cy);
    }
    g.restore();
  }

  private drawLane(g: CanvasRenderingContext2D, s: Seat): void {
    const { width } = this.ctx;
    const { y, h, player } = s;
    const r = s.runner;
    const i = this.seats.indexOf(s);
    const done = r.place !== null;
    g.save();
    g.fillStyle = i % 2 === 0 ? "rgba(244,247,251,0.04)" : "rgba(244,247,251,0.015)";
    g.fillRect(0, y, width, h);
    g.globalAlpha = done ? 0.2 : 0.08;
    g.fillStyle = player.color;
    g.fillRect(0, y, width, h);
    g.globalAlpha = 1;
    if (r.turbo) {
      g.fillStyle = `rgba(255,176,32,${(0.05 + 0.04 * Math.sin(this.clock * 9)).toFixed(3)})`;
      g.fillRect(0, y, width, h);
    }
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
    for (let c = 0; c < 2; c++) {
      for (let k = 0; k * sq < h * 0.55; k++) {
        g.fillStyle = (k + c) % 2 === 0 ? INK : "#070b14";
        g.fillRect(this.finishX + c * sq, y + h * 0.25 + k * sq, sq, Math.min(sq, h * 0.55 - k * sq));
      }
    }

    // Name and tap hint.
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillStyle = player.color;
    g.font = `700 ${Math.round(Math.min(34, h * 0.26))}px ${FONT}`;
    g.fillText(player.name, 14, y + h * 0.3);
    const small = Math.round(Math.min(22, h * 0.18));
    g.font = `700 ${small}px ${FONT}`;
    if (done) {
      g.fillStyle = INK;
      g.font = `700 ${Math.round(Math.min(34, h * 0.26))}px ${FONT}`;
      g.fillText(PLACE_NAMES[r.place! - 1] ?? "", 14, y + h * 0.62);
    } else if (r.turbo) {
      g.fillStyle = YELLOW;
      g.fillText("TURBO", 14, y + h * 0.62);
    } else if (player.kind === "human" && this.phase === "race") {
      g.fillStyle = "rgba(244,247,251,0.35)";
      const hint = this.light.phase === "red" ? (r.pot > 0 ? "HOLD..." : "FREEZE")
        : this.light.phase === "yellow" ? "DARE?" : "TAP TAP TAP";
      g.fillText(hint, 14, y + h * 0.62);
    }
    if (player.kind === "human" && s.best > 0 && !done) {
      g.fillStyle = "rgba(244,247,251,0.3)";
      g.font = `700 ${Math.max(14, small - 4)}px ${FONT}`;
      g.fillText(`BEST ${scoreTime(s.best).toFixed(1)}s`, 14, y + h * 0.84);
    }

    if (done) this.drawBench(g, s);

    const flying = new Set(this.peels.map((p) => p.hazard));
    for (const hz of r.hazards) if (!hz.used && !flying.has(hz)) this.drawHazard(g, hz, groundY, h);
    this.drawRunner(g, s, groundY);

    // Speed bonus meter, under the runner's feet.
    if (!done && r.chain > 0 && r.stun <= 0) {
      const x = this.drawX(s);
      const w = 60;
      const fill = Math.min(1, r.chain / 12);
      g.fillStyle = "rgba(244,247,251,0.15)";
      g.fillRect(x - w / 2, groundY + 9, w, 6);
      g.fillStyle = fill >= 1 ? YELLOW : player.color;
      g.fillRect(x - w / 2, groundY + 9, w * fill, 6);
    }
    // The dare pot, hanging over the runner's head.
    if (!done && r.pot > 0) this.drawPot(g, s, groundY);
    g.restore();
  }

  private drawPot(g: CanvasRenderingContext2D, s: Seat, groundY: number): void {
    const r = s.runner;
    const sc = Math.min(1, s.h / 150);
    const x = this.drawX(s) + 36 * sc;
    const yy = groundY - 92 * sc;
    const pop = 1 + s.potPop * 0.35;
    const red = this.light.phase === "red";
    const col = red ? RED : YELLOW;
    const label = `+${Math.round(r.pot * 100)}%`;
    g.save();
    g.translate(x, yy);
    g.scale(pop, pop);
    g.font = `700 ${Math.round(30 * sc)}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 6;
    g.strokeStyle = "rgba(7,11,20,0.8)";
    g.strokeText(label, 0, 0);
    g.fillStyle = col;
    g.fillText(label, 0, 0);
    g.font = `700 ${Math.round(14 * sc)}px ${FONT}`;
    g.lineWidth = 4;
    const sub = red ? "HOLD STILL" : `${r.potTaps} DARE${r.potTaps === 1 ? "" : "S"}`;
    g.strokeText(sub, 0, 18 * sc);
    g.fillStyle = red ? INK : col;
    g.fillText(sub, 0, 18 * sc);
    g.restore();
  }

  /** Finished seats get a bench with one peel button per rival still running. */
  private drawBench(g: CanvasRenderingContext2D, s: Seat): void {
    s.benchButtons = [];
    if (this.phase !== "race") return;
    const live = this.seats.map((t, k) => ({ t, k })).filter((x) => x.t.runner.place === null);
    if (live.length === 0) return;
    const r = s.runner;
    const d = Math.max(this.ctx.minTap, Math.min(s.h * 0.62, 84));
    const gap = 18;
    const totalW = live.length * d + (live.length - 1) * gap;
    const startX = this.ctx.width / 2 - totalW / 2 + d / 2;
    const cy = s.y + s.h * 0.5;
    const ready = r.heckleCd <= 0;
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `700 ${Math.round(Math.min(22, s.h * 0.17))}px ${FONT}`;
    g.fillStyle = "rgba(244,247,251,0.45)";
    g.fillText(s.player.kind === "human" ? (ready ? "LOB A PEEL AT..." : "RELOADING...") : "ON THE BENCH", this.ctx.width / 2, s.y + s.h * 0.16);
    live.forEach(({ t, k }, n) => {
      const x = startX + n * (d + gap);
      s.benchButtons.push({ target: k, x, y: cy, r: d / 2 + 6 });
      g.beginPath();
      g.arc(x, cy, d / 2, 0, Math.PI * 2);
      g.fillStyle = ready ? t.player.color : "rgba(244,247,251,0.15)";
      g.globalAlpha = ready ? 0.9 : 0.6;
      g.fill();
      g.globalAlpha = 1;
      if (!ready) {
        g.strokeStyle = t.player.color;
        g.lineWidth = 4;
        g.beginPath();
        const frac = 1 - r.heckleCd / 2.5;
        g.arc(x, cy, d / 2 - 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
        g.stroke();
      }
      g.fillStyle = "#070b14";
      g.font = `700 ${Math.round(d * 0.34)}px ${FONT}`;
      g.fillText(t.player.name.slice(0, 5), x, cy + 1);
    });
    g.restore();
  }

  private drawPeels(g: CanvasRenderingContext2D): void {
    for (const p of this.peels) {
      const t = Math.min(1, p.t);
      const x = p.x0 + (p.x1 - p.x0) * t;
      const y = p.y0 + (p.y1 - p.y0) * t - Math.sin(t * Math.PI) * 120;
      g.save();
      g.translate(x, y);
      g.rotate(t * Math.PI * 3);
      this.drawBanana(g);
      g.restore();
    }
  }

  private drawBanana(g: CanvasRenderingContext2D): void {
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
  }

  private drawHazard(g: CanvasRenderingContext2D, hz: Hazard, groundY: number, laneH: number): void {
    const x = this.startX + hz.at * (this.finishX - this.startX);
    const sc = Math.min(1, laneH / 150);
    g.save();
    g.translate(x, groundY);
    g.scale(sc, sc);
    if (hz.kind === "banana") {
      this.drawBanana(g);
    } else {
      g.strokeStyle = "#c9ced6";
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(-14, 0);
      for (let k = 0; k < 5; k++) g.lineTo(k % 2 === 0 ? 14 : -14, -6 - k * 7);
      g.stroke();
      g.fillStyle = GREEN;
      g.fillRect(-18, -40, 36, 6);
    }
    g.restore();
  }

  private drawRunner(g: CanvasRenderingContext2D, s: Seat, groundY: number): void {
    const r = s.runner;
    const x = this.drawX(s);
    const sc = Math.min(1, s.h / 150);
    const hop = Math.sin(Math.min(1, s.hop) * Math.PI) * 22 * sc * (s.boost > 0 ? 1.8 : 1);
    const charging = r.pot > 0 && r.stun <= 0 && r.place === null;
    const wobble = charging ? Math.sin(this.clock * 40) * 2 * sc * Math.min(1, r.potTaps / 4) : 0;
    g.save();
    g.translate(x + wobble, groundY - hop);
    g.scale(sc, sc);
    if (s.dashT > 0) {
      // Motion streaks behind a dashing runner.
      g.strokeStyle = s.player.color;
      g.globalAlpha = s.dashT * 0.7;
      g.lineWidth = 4;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.moveTo(-30, -60 + k * 18);
        g.lineTo(-30 - 50 * s.dashT - k * 10, -60 + k * 18);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
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
    // Soft halo instead of a per-frame shadow blur.
    g.fillStyle = r.turbo ? YELLOW : col;
    g.globalAlpha = charging ? 0.3 + 0.15 * Math.sin(this.clock * 20) : 0.16;
    g.beginPath();
    g.ellipse(0, -42, 38 + (charging ? r.potTaps * 2 : 0), 42, 0, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
    // Wind-up key on the back.
    g.save();
    g.translate(-30, -40);
    g.rotate(s.keyAngle);
    g.strokeStyle = r.turbo ? YELLOW : charging ? "#ffe9a8" : "#c9ced6";
    g.lineWidth = 5;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(-18, 0);
    g.lineTo(18, 0);
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 6, 0, Math.PI * 2);
    g.fillStyle = r.turbo ? YELLOW : "#c9ced6";
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
    // Body: round with a face. Squash when charging, stretch when dashing.
    const sx = s.dashT > 0 ? 1 + s.dashT * 0.25 : charging ? 1.08 : 1;
    const sy = s.dashT > 0 ? 1 - s.dashT * 0.15 : charging ? 0.94 : 1;
    g.save();
    g.translate(0, -16);
    g.scale(sx, sy);
    g.fillStyle = col;
    g.beginPath();
    g.roundRect(-24, -54, 48, 54, 14);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.22)";
    g.beginPath();
    g.ellipse(-8, -40, 12, 7, -0.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#070b14";
    if (tripped) {
      g.lineWidth = 3;
      g.strokeStyle = "#070b14";
      for (const ex of [-9, 9]) {
        g.beginPath();
        g.moveTo(ex - 4, -34); g.lineTo(ex + 4, -26);
        g.moveTo(ex + 4, -34); g.lineTo(ex - 4, -26);
        g.stroke();
      }
    } else if (charging && this.light.phase === "red") {
      // Sweating it out: wide eyes.
      g.beginPath();
      g.arc(6, -30, 5.5, 0, Math.PI * 2);
      g.arc(16, -30, 5.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.arc(7, -31, 2, 0, Math.PI * 2);
      g.arc(17, -31, 2, 0, Math.PI * 2);
      g.fill();
    } else {
      g.beginPath();
      g.arc(6, -30, 4, 0, Math.PI * 2);
      g.arc(16, -30, 4, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    g.restore();
    if (tripped) {
      g.save();
      g.fillStyle = YELLOW;
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
      const r = s.runner;
      out.push({ playerId: s.player.id, label: "Banked", value: `${Math.round(r.banked * 100)}%` });
      out.push({ playerId: s.player.id, label: "Trips", value: String(r.trips) });
      if (r.finishS !== null && r.progress >= 1) out.push({ playerId: s.player.id, label: "Time", value: `${r.finishS.toFixed(1)}s` });
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

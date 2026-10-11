import { drawTimerBar, fillArena } from "../../core/draw";
import { Callouts, Juice } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  accuracy, beginTrace, buildPath, feedTrace, generateControls, liftTrace, newBot, newTrace, pathEnd, pathStart,
  roundScore, stepBot, FINISH_GRACE_S, OUTER_BAND, ROUND_CONFIG, ROUND_TIME_S, ROUNDS,
  type Bot, type Pt, type Trace, type TracePath,
} from "./logic";

export const scribbleRace: GameDefinition = {
  id: "scribble-race",
  name: "Scribble Race",
  tagline: "Trace the squiggle. One stroke. Don't stray.",
  description:
    "The same random squiggle appears in everyone's lane. Finger on START, trace it to END in one " +
    "stroke. Your score is how much of your line stayed inside the band. Lift early or wander " +
    "too far and the stroke is scrapped: back to START. Three rounds, each squiggle wigglier and " +
    "the band thinner. Highest total wins.",
  durationMs: 0,
  controls: "Finger on START, trace the line to END without lifting.",
  create: (ctx) => new ScribbleRace(ctx),
};

const INTRO_S = 1.4;
const RESULT_S = 2.2;
const FINAL_S = 2.2;
const FONT = "Bebas Neue, Impact, sans-serif";
const PAD_TOP = 110;
const PAD_BOTTOM = 56;

type Phase = "intro" | "round" | "result" | "final";

interface Seat {
  player: Player;
  x: number;
  w: number;
  trace: Trace;
  bot: Bot | null;
  pointerId: number | null;
  roundScores: number[];
  finished: boolean;
  scrapFlash: number;
  hintPulse: number;
  finger: Pt | null;
  /** Best finished-trace accuracy, 0-100. */
  best: number;
  scraps: number;
}

class ScribbleRace implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private phase: Phase = "intro";
  private timer = INTRO_S;
  private roundIndex = 0;
  private path: TracePath;
  private roundT = 0;
  private grace: number | null = null;
  private time = 0;
  private finished = false;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    const w = ctx.width / ctx.players.length;
    this.seats = ctx.players.map((player, i) => ({
      player, x: i * w, w, trace: newTrace(), bot: null, pointerId: null, roundScores: [],
      finished: false, scrapFlash: 0, hintPulse: 0, finger: null, best: 0, scraps: 0,
    }));
    this.path = this.startRound();
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
  }

  private startRound(): TracePath {
    const cfg = ROUND_CONFIG[Math.min(this.roundIndex, ROUND_CONFIG.length - 1)]!;
    const zoneW = this.ctx.width / this.seats.length;
    const tol = Math.max(14, Math.min(zoneW, 480) * cfg.tol);
    const controls = generateControls(this.ctx.rng, cfg.points);
    const path = buildPath(controls, {
      w: zoneW, h: this.ctx.height, padX: Math.max(tol * 1.5, 30), padTop: PAD_TOP, padBottom: PAD_BOTTOM,
      tol, startR: Math.max(tol * 2, this.ctx.minTap * 0.6),
    });
    for (const s of this.seats) {
      s.trace = newTrace();
      s.bot = s.player.kind === "bot" ? newBot(this.ctx.rng, path) : null;
      s.pointerId = null;
      s.finished = false;
      s.finger = null;
    }
    this.roundT = 0;
    this.grace = null;
    this.callouts.show(`ROUND ${this.roundIndex + 1}`, "#F4F7FB", { size: 80, life: INTRO_S - 0.2, y: 0.3 });
    this.ctx.sfx.countdown();
    return path;
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += realDt;
    for (const s of this.seats) {
      s.scrapFlash = Math.max(0, s.scrapFlash - realDt * 1.8);
      s.hintPulse = Math.max(0, s.hintPulse - realDt * 3);
    }
    if (this.finished) return;

    if (this.phase === "intro") {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = "round";
        this.callouts.show("TRACE!", "#FFB020", { size: 96, life: 0.8, y: 0.3 });
        this.ctx.sfx.go();
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
      this.path = this.startRound();
      this.phase = "intro";
      this.timer = INTRO_S;
      return;
    }

    this.roundT += dt;
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (!s.bot || s.finished) continue;
      const p = stepBot(s.bot, this.path, this.ctx.rng, dt);
      if (p) this.feedSeat(i, p);
    }
    if (this.grace !== null) this.grace -= dt;
    if (this.roundT >= ROUND_TIME_S || (this.grace !== null && this.grace <= 0)) this.endRound("TIME!");
  }

  /** Feed a zone-local finger position to a seat: starts a stroke on START, otherwise extends it. */
  private feedSeat(i: number, p: Pt): void {
    if (this.phase !== "round") return;
    const s = this.seats[i]!;
    if (s.trace.state === "idle") {
      if (beginTrace(s.trace, this.path, p)) {
        s.finger = p;
        this.ctx.sfx.tick();
      } else {
        s.hintPulse = 1;
      }
      return;
    }
    s.finger = p;
    const res = feedTrace(s.trace, this.path, p);
    if (res === "scrapped") this.scrapped(i, p);
    else if (res === "finished") this.finishedSeat(i);
  }

  private scrapped(i: number, p: Pt | null): void {
    const s = this.seats[i]!;
    s.scrapFlash = 1;
    s.scraps += 1;
    s.finger = null;
    const at = p ?? pathStart(this.path);
    this.juice.burst(s.x + at.x, at.y, ["#FF3D7A", "#F4F7FB"], { count: 16, speed: 260, gravity: 400, size: 5 });
    this.juice.shake(0.3);
    // Buzzer.
    this.ctx.sfx.miss();
    this.ctx.sfx.hit();
  }

  private finishedSeat(i: number): void {
    const s = this.seats[i]!;
    s.finished = true;
    s.finger = null;
    const acc = Math.round(accuracy(s.trace) * 100);
    s.best = Math.max(s.best, acc);
    const end = pathEnd(this.path);
    this.juice.burst(s.x + end.x, end.y, [s.player.color, "#F4F7FB"], { count: 24, speed: 320, gravity: 300, size: 5 });
    this.juice.shake(0.25);
    this.ctx.sfx.streak(acc >= 90 ? 5 : acc >= 75 ? 3 : 1);
    if (acc >= 95) this.callouts.show("FLAWLESS!", s.player.color, { size: 60, y: 0.5, life: 1.2 });
    if (this.grace === null) {
      this.grace = FINISH_GRACE_S;
      this.callouts.show(`${s.player.name} DONE!`, s.player.color, { size: 56, y: 0.5, life: 1.1 });
      this.ctx.sfx.collect();
    }
    if (this.seats.every((seat) => seat.finished)) this.endRound("ALL DONE!");
  }

  private endRound(text: string): void {
    if (this.phase !== "round") return;
    for (const s of this.seats) {
      s.roundScores.push(roundScore(s.trace, this.path));
      s.pointerId = null;
      s.finger = null;
    }
    if (this.roundIndex + 1 >= ROUNDS) {
      this.phase = "final";
      this.timer = RESULT_S + FINAL_S;
      const totals = this.seats.map((s) => this.total(s));
      const top = Math.max(...totals);
      const leaders = this.seats.filter((s) => this.total(s) === top);
      const label = top === 0 ? "NOBODY WINS" : leaders.map((s) => s.player.name).join(" & ") + " WINS!";
      this.callouts.show(label, leaders.length === 1 && top > 0 ? leaders[0]!.player.color : "#F4F7FB", {
        size: 72, life: RESULT_S + FINAL_S, y: 0.2,
      });
      this.ctx.sfx.win();
    } else {
      this.phase = "result";
      this.timer = RESULT_S;
      this.callouts.show(text, "#FFB020", { size: 64, y: 0.2, life: RESULT_S });
      this.ctx.sfx.go();
    }
  }

  private total(s: Seat): number {
    return s.roundScores.reduce((a, b) => a + b, 0);
  }

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private readonly onDown = (e: PointerEvent): void => {
    const p = this.toLogical(e);
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (s.player.kind !== "human" || p.x < s.x || p.x >= s.x + s.w) continue;
      e.preventDefault();
      if (s.pointerId !== null || s.finished || this.phase !== "round") return;
      const local = { x: p.x - s.x, y: p.y };
      this.feedSeat(i, local);
      if (s.trace.state === "tracing") s.pointerId = e.pointerId;
      return;
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (s.pointerId !== e.pointerId) continue;
      e.preventDefault();
      const p = this.toLogical(e);
      this.feedSeat(i, { x: p.x - s.x, y: p.y });
      if (s.trace.state !== "tracing") s.pointerId = null;
      return;
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (s.pointerId !== e.pointerId) continue;
      s.pointerId = null;
      if (this.phase === "round" && liftTrace(s.trace) === "scrapped") this.scrapped(i, s.finger);
      return;
    }
  };

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);
    for (let i = 0; i < this.seats.length; i++) this.drawZone(g, i);
    this.juice.end(g);
    if (this.phase === "round") {
      const left = ROUND_TIME_S - this.roundT;
      const remaining = this.grace !== null ? Math.min(left, this.grace) : left;
      const total = this.grace !== null ? FINISH_GRACE_S : ROUND_TIME_S;
      drawTimerBar(g, width, Math.max(0, remaining), total);
    }
    this.callouts.draw(g, width, height);
  }

  private tracePathShape(g: CanvasRenderingContext2D): void {
    g.beginPath();
    const pts = this.path.pts;
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k]!;
      if (k === 0) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    }
  }

  private drawZone(g: CanvasRenderingContext2D, i: number): void {
    const s = this.seats[i]!;
    const h = this.ctx.height;
    const path = this.path;
    const tol = path.tol;
    const cx = s.w / 2;
    const color = s.player.color;

    g.save();
    g.translate(s.x, 0);
    g.globalAlpha = s.finished ? 0.16 : 0.07;
    g.fillStyle = color;
    g.fillRect(0, 0, s.w, h);
    g.globalAlpha = 1;
    g.strokeStyle = "rgba(244,247,251,0.12)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(s.w, 0);
    g.lineTo(s.w, h);
    g.stroke();

    // Header: name and running total.
    g.textAlign = "center";
    g.textBaseline = "top";
    g.fillStyle = color;
    g.font = `700 32px ${FONT}`;
    g.fillText(s.player.name, cx, 34);
    g.fillStyle = "rgba(244,247,251,0.6)";
    g.font = `700 22px ${FONT}`;
    g.fillText(s.roundScores.length > 0 ? `TOTAL ${this.total(s)}` : `${s.player.kind === "bot" ? "BOT" : "TRACE IT"}`, cx, 70);

    // Bands: faint outer limit, the tolerance band, and a dashed centre line.
    g.lineCap = "round";
    g.lineJoin = "round";
    this.tracePathShape(g);
    g.strokeStyle = "rgba(244,247,251,0.035)";
    g.lineWidth = tol * OUTER_BAND * 2;
    g.stroke();
    this.tracePathShape(g);
    g.strokeStyle = "rgba(244,247,251,0.11)";
    g.lineWidth = tol * 2;
    g.stroke();
    this.tracePathShape(g);
    g.strokeStyle = "rgba(244,247,251,0.5)";
    g.lineWidth = 2;
    g.setLineDash([10, 9]);
    g.stroke();
    g.setLineDash([]);

    // The player's stroke.
    const pts = s.trace.points;
    if (pts.length > 1) {
      g.beginPath();
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k]!;
        if (k === 0) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
      }
      g.shadowColor = color;
      g.shadowBlur = 14;
      g.strokeStyle = color;
      g.lineWidth = Math.max(5, tol * 0.45);
      g.globalAlpha = 0.92;
      g.stroke();
      g.shadowBlur = 0;
      g.globalAlpha = 1;
    }

    // START and END dots.
    const start = pathStart(path);
    const end = pathEnd(path);
    const r0 = Math.max(tol * 0.8, 16);
    const idle = s.trace.state === "idle" && !s.finished && this.phase === "round";
    const pulse = idle ? 1 + 0.12 * Math.sin(this.time * 6) : 1;
    if (s.hintPulse > 0) {
      g.strokeStyle = `rgba(255,176,32,${s.hintPulse})`;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(start.x, start.y, path.startR + (1 - s.hintPulse) * 20, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = "#F4F7FB";
    g.beginPath();
    g.arc(start.x, start.y, r0 * pulse, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#FFB020";
    g.beginPath();
    g.arc(end.x, end.y, r0, 0, Math.PI * 2);
    g.fill();
    g.font = `700 20px ${FONT}`;
    g.textBaseline = "middle";
    g.fillStyle = "#F4F7FB";
    g.textAlign = start.x < cx ? "left" : "right";
    g.fillText("START", start.x + (start.x < cx ? r0 + 10 : -r0 - 10), start.y);
    g.fillStyle = "#FFB020";
    g.textAlign = end.x < cx ? "left" : "right";
    g.fillText("END", end.x + (end.x < cx ? r0 + 10 : -r0 - 10), end.y);

    // Finger head.
    if (s.finger && s.trace.state === "tracing") {
      g.fillStyle = "#F4F7FB";
      g.strokeStyle = color;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(s.finger.x, s.finger.y, 9, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }

    // Status text.
    g.textAlign = "center";
    g.textBaseline = "middle";
    const showResult = this.phase === "result" || this.phase === "final";
    if (s.finished || showResult) {
      const score = s.finished ? Math.round(accuracy(s.trace) * 100) : s.roundScores[s.roundScores.length - 1] ?? 0;
      g.font = `700 110px ${FONT}`;
      g.lineWidth = 10;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      g.strokeText(`${score}%`, cx, h * 0.5);
      g.fillStyle = s.finished ? color : "rgba(244,247,251,0.75)";
      g.fillText(`${score}%`, cx, h * 0.5);
      g.font = `700 26px ${FONT}`;
      g.fillStyle = "rgba(244,247,251,0.7)";
      g.fillText(s.finished ? "DONE" : score === 0 ? "NO TRACE" : "PARTIAL", cx, h * 0.5 + 68);
    } else if (s.trace.state === "tracing") {
      g.font = `700 30px ${FONT}`;
      g.fillStyle = color;
      g.fillText(`${Math.round(accuracy(s.trace) * 100)}%`, cx, h - 24);
    } else if (idle && s.player.kind === "human") {
      g.font = `700 22px ${FONT}`;
      g.fillStyle = "rgba(244,247,251,0.4)";
      g.fillText("FINGER ON START", cx, h - 24);
    }

    if (s.scrapFlash > 0) {
      g.fillStyle = `rgba(255,61,122,${s.scrapFlash * 0.3})`;
      g.fillRect(0, 0, s.w, h);
      g.font = `700 54px ${FONT}`;
      g.lineWidth = 8;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      g.strokeText("SCRAPPED!", cx, h * 0.5);
      g.fillStyle = "#FF3D7A";
      g.fillText("SCRAPPED!", cx, h * 0.5);
    }
    g.restore();
  }

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({ playerId: s.player.id, score: this.total(s) }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const s of this.seats) {
      out.push({ playerId: s.player.id, label: "Best trace %", value: s.best > 0 ? `${s.best}%` : "-" });
      out.push({ playerId: s.player.id, label: "Scrapped strokes", value: String(s.scraps) });
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

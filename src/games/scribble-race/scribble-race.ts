import { drawTimerBar, fillArena } from "../../core/draw";
import { Callouts, Juice, loadBest, saveBest } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  accuracy, beginTrace, blotAlpha, blotLanding, buildPath, feedTrace, generateControls, inBlot, liftTrace, newBlot,
  newBot, newTrace, pathEnd, pathStart, pickSmudgeTarget, roundScore, stepBlots, stepBot, totalRoundScore,
  wideBrushSeats, BLOTS_PER_ROUND, FINISH_GRACE_S, OUTER_BAND, ROUND_CONFIG, ROUND_TIME_S, ROUNDS, WIDE_BRUSH,
  type Blot, type Bot, type Pt, type Trace, type TracePath,
} from "./logic";

export const scribbleRace: GameDefinition = {
  id: "scribble-race",
  name: "Smudge Race",
  tagline: "Trace the squiggle. Finish first. Smudge the rest.",
  description:
    "The same random squiggle appears in everyone's lane. Finger on START, trace it to END in one " +
    "stroke: your score is how much of your line stayed inside the band, plus a bonus for finishing " +
    "first. Done early? Tap a rival's name to throw an ink blot that hides their path. Lift early or " +
    "wander too far and the stroke is scrapped. Last place gets a wider brush. Four rounds, each " +
    "squiggle wigglier, and the final INKSTORM counts 1.5x.",
  durationMs: 0,
  controls: "Finger on START, trace to END without lifting. When done, tap a rival's name to smudge them.",
  create: (ctx) => new ScribbleRace(ctx),
};

const INTRO_S = 1.4;
const RESULT_S = 2.2;
const FINAL_S = 2.2;
const FONT = "Bebas Neue, Impact, sans-serif";
const PAD_TOP = 110;
const PAD_BOTTOM = 56;
const BEST_KEY = "scribble-race";
const BEST_VERSION = "v2";
const INK = "#070b14";
const FLIGHT_S = 0.45;

type Phase = "intro" | "round" | "result" | "final";

interface Seat {
  player: Player;
  x: number;
  w: number;
  path: TracePath;
  trace: Trace;
  bot: Bot | null;
  pointerId: number | null;
  roundScores: number[];
  /** Last round's breakdown for the result card. */
  lastBase: number;
  lastPlace: number | null;
  finished: boolean;
  finishPlace: number | null;
  scrapFlash: number;
  hintPulse: number;
  closeFlash: number;
  seenCloseCalls: number;
  streakTier: number;
  finger: Pt | null;
  /** Best finished-trace accuracy, 0-100. */
  best: number;
  scraps: number;
  blots: Blot[];
  blotsLeft: number;
  smudgeTimer: number;
  smudgesThrown: number;
  wide: boolean;
  wideFlash: number;
  /** "SMUDGED BY ..." notice in this lane. */
  smudgedFlash: number;
  smudgedBy: string;
  laneCache: HTMLCanvasElement | null;
}

/** A blot in the air between a smudger's lane and its target. */
interface Flight {
  from: Pt;
  to: Pt;
  t: number;
  target: number;
  r: number;
  color: string;
  by: string;
}

interface SmudgeButton {
  target: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

class ScribbleRace implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private phase: Phase = "intro";
  private timer = INTRO_S;
  private roundIndex = 0;
  private roundT = 0;
  private grace: number | null = null;
  private time = 0;
  private finished = false;
  private finishCount = 0;
  private flights: Flight[] = [];
  private pb: number;
  private blotSeed = 1;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    this.pb = loadBest(BEST_KEY, BEST_VERSION);
    const w = ctx.width / ctx.players.length;
    const dummy = buildPath([{ x: 0, y: 0 }, { x: 1, y: 1 }], {
      w, h: ctx.height, padX: 30, padTop: PAD_TOP, padBottom: PAD_BOTTOM, tol: 20, startR: 40,
    });
    this.seats = ctx.players.map((player, i) => ({
      player, x: i * w, w, path: dummy, trace: newTrace(), bot: null, pointerId: null, roundScores: [],
      lastBase: 0, lastPlace: null, finished: false, finishPlace: null, scrapFlash: 0, hintPulse: 0, closeFlash: 0,
      seenCloseCalls: 0, streakTier: 0, finger: null, best: 0, scraps: 0, blots: [], blotsLeft: 0, smudgeTimer: 0,
      smudgesThrown: 0, wide: false, wideFlash: 0, smudgedFlash: 0, smudgedBy: "", laneCache: null,
    }));
    this.startRound();
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
  }

  private cfg() {
    return ROUND_CONFIG[Math.min(this.roundIndex, ROUND_CONFIG.length - 1)]!;
  }

  private startRound(): void {
    const cfg = this.cfg();
    const zoneW = this.ctx.width / this.seats.length;
    const tol = Math.max(14, Math.min(zoneW, 480) * cfg.tol);
    const controls = generateControls(this.ctx.rng, cfg.points);
    const wide = this.roundIndex > 0 ? wideBrushSeats(this.seats.map((s) => this.total(s))) : this.seats.map(() => false);
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      s.wide = wide[i] ?? false;
      const myTol = tol * (s.wide ? WIDE_BRUSH : 1);
      s.path = buildPath(controls, {
        w: zoneW, h: this.ctx.height, padX: Math.max(tol * 1.5, 30), padTop: PAD_TOP, padBottom: PAD_BOTTOM,
        tol: myTol, startR: Math.max(myTol * 2, this.ctx.minTap * 0.6),
      });
      s.trace = newTrace();
      s.bot = s.player.kind === "bot" ? newBot(this.ctx.rng, s.path) : null;
      s.pointerId = null;
      s.finished = false;
      s.finishPlace = null;
      s.finger = null;
      s.blots = [];
      s.blotsLeft = 0;
      s.smudgeTimer = 0;
      s.streakTier = 0;
      s.seenCloseCalls = 0;
      s.wideFlash = s.wide ? 1 : 0;
      s.laneCache = null;
    }
    this.flights = [];
    this.finishCount = 0;
    this.roundT = 0;
    this.grace = null;
    const title = cfg.title ? `${cfg.title}! x${cfg.mult}` : `ROUND ${this.roundIndex + 1}`;
    this.callouts.show(title, cfg.title ? "#FF3D7A" : "#F4F7FB", { size: cfg.title ? 88 : 80, life: INTRO_S - 0.2, y: 0.3 });
    if (cfg.title) this.juice.shake(0.4);
    this.ctx.sfx.countdown();
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += realDt;
    for (const s of this.seats) {
      s.scrapFlash = Math.max(0, s.scrapFlash - realDt * 1.8);
      s.hintPulse = Math.max(0, s.hintPulse - realDt * 3);
      s.closeFlash = Math.max(0, s.closeFlash - realDt * 1.2);
      s.wideFlash = Math.max(0, s.wideFlash - realDt * 0.28);
      s.smudgedFlash = Math.max(0, s.smudgedFlash - realDt * 0.8);
      s.blots = stepBlots(s.blots, realDt);
    }
    this.stepFlights(realDt);
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
      this.startRound();
      this.phase = "intro";
      this.timer = INTRO_S;
      return;
    }

    this.roundT += dt;
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (!s.bot) continue;
      if (s.finished) {
        this.stepBotSmudger(i, dt);
        continue;
      }
      const blind = s.finger !== null && inBlot(s.blots, s.finger);
      const p = stepBot(s.bot, s.path, this.ctx.rng, dt, blind);
      if (p) this.feedSeat(i, p);
    }
    if (this.grace !== null) this.grace -= dt;
    if (this.roundT >= ROUND_TIME_S || (this.grace !== null && this.grace <= 0)) this.endRound("TIME!");
  }

  /** A finished bot waits a beat, then throws its ink at whoever is winning. */
  private stepBotSmudger(i: number, dt: number): void {
    const s = this.seats[i]!;
    if (s.blotsLeft <= 0) return;
    s.smudgeTimer -= dt;
    if (s.smudgeTimer > 0) return;
    const target = pickSmudgeTarget(this.seats.map((seat) => ({ finished: seat.finished, score: this.liveScore(seat) })), i);
    if (target === -1) return;
    this.throwBlot(i, target);
    s.smudgeTimer = this.ctx.rng.float(0.7, 1.6);
  }

  private liveScore(s: Seat): number {
    return this.total(s) + roundScore(s.trace, s.path);
  }

  private throwBlot(from: number, target: number): void {
    const a = this.seats[from]!;
    const b = this.seats[target]!;
    if (a.blotsLeft <= 0 || b.finished || this.phase !== "round") return;
    a.blotsLeft -= 1;
    a.smudgesThrown += 1;
    const land = blotLanding(b.path, b.trace, this.ctx.rng);
    const r = b.path.tol * this.cfg().blotR;
    this.flights.push({
      from: { x: a.x + a.w / 2, y: this.ctx.height * 0.38 },
      to: { x: b.x + land.x, y: land.y },
      t: 0, target, r, color: a.player.color, by: a.player.name,
    });
    this.ctx.sfx.whoosh();
  }

  private stepFlights(dt: number): void {
    for (const f of this.flights) {
      f.t += dt / FLIGHT_S;
      if (f.t < 1) continue;
      const s = this.seats[f.target]!;
      this.blotSeed += 1;
      s.blots.push(newBlot(f.to.x - s.x, f.to.y, f.r, f.color, this.blotSeed));
      s.smudgedFlash = 1;
      s.smudgedBy = f.by;
      this.juice.burst(f.to.x, f.to.y, [INK, "#1b2440", f.color], { count: 22, speed: 300, gravity: 500, size: 6 });
      this.juice.shake(0.35);
      this.juice.hitStop(0.05);
      this.ctx.sfx.hit();
    }
    this.flights = this.flights.filter((f) => f.t < 1);
  }

  /** Feed a zone-local finger position to a seat: starts a stroke on START, otherwise extends it. */
  private feedSeat(i: number, p: Pt): void {
    if (this.phase !== "round") return;
    const s = this.seats[i]!;
    if (s.trace.state === "idle") {
      if (beginTrace(s.trace, s.path, p)) {
        s.finger = p;
        s.streakTier = 0;
        this.ctx.sfx.tick();
      } else {
        s.hintPulse = 1;
      }
      return;
    }
    s.finger = p;
    const res = feedTrace(s.trace, s.path, p);
    if (res === "scrapped") {
      this.scrapped(i, p);
      return;
    }
    if (s.trace.closeCalls > s.seenCloseCalls) {
      s.seenCloseCalls = s.trace.closeCalls;
      s.closeFlash = 1;
      this.ctx.sfx.collect();
    }
    const tier = s.trace.streak >= 90 ? 3 : s.trace.streak >= 45 ? 2 : s.trace.streak >= 20 ? 1 : 0;
    if (tier > s.streakTier) {
      s.streakTier = tier;
      this.ctx.sfx.streak(tier * 2);
      this.juice.burst(s.x + p.x, p.y, [s.player.color, "#F4F7FB"], { count: 6 + tier * 4, speed: 120, gravity: 200, size: 3, life: 0.4 });
    } else if (tier < s.streakTier) {
      s.streakTier = tier;
    }
    if (res === "finished") this.finishedSeat(i);
  }

  private scrapped(i: number, p: Pt | null): void {
    const s = this.seats[i]!;
    s.scrapFlash = 1;
    s.scraps += 1;
    s.finger = null;
    s.streakTier = 0;
    const at = p ?? pathStart(s.path);
    this.juice.burst(s.x + at.x, at.y, ["#FF3D7A", "#F4F7FB"], { count: 16, speed: 260, gravity: 400, size: 5 });
    this.juice.shake(0.3);
    // A bot hesitates, then tries again from START.
    if (s.bot) s.bot = newBot(this.ctx.rng, s.path, s.bot.skill);
    // Buzzer.
    this.ctx.sfx.miss();
    this.ctx.sfx.hit();
  }

  private finishedSeat(i: number): void {
    const s = this.seats[i]!;
    s.finished = true;
    s.finger = null;
    s.finishPlace = this.finishCount;
    this.finishCount += 1;
    s.blotsLeft = BLOTS_PER_ROUND;
    s.smudgeTimer = this.ctx.rng.float(0.5, 1.3);
    const acc = Math.round(accuracy(s.trace) * 100);
    s.best = Math.max(s.best, acc);
    const end = pathEnd(s.path);
    this.juice.burst(s.x + end.x, end.y, [s.player.color, "#F4F7FB"], { count: 24, speed: 320, gravity: 300, size: 5 });
    this.juice.shake(0.25);
    this.ctx.sfx.streak(acc >= 90 ? 5 : acc >= 75 ? 3 : 1);
    if (acc >= 95) this.callouts.show("FLAWLESS!", s.player.color, { size: 60, y: 0.5, life: 1.2 });
    if (s.player.kind === "human" && acc > 0 && saveBest(BEST_KEY, acc, BEST_VERSION)) {
      this.pb = acc;
      this.callouts.show(`NEW RECORD ${acc}%`, "#B8FF3D", { size: 56, y: 0.6, life: 1.6 });
      this.ctx.sfx.win();
    }
    if (this.grace === null) {
      this.grace = FINISH_GRACE_S;
      this.callouts.show(`${s.player.name} FIRST!`, s.player.color, { size: 56, y: 0.5, life: 1.1 });
      this.ctx.sfx.collect();
    }
    if (this.seats.every((seat) => seat.finished)) this.endRound("ALL DONE!");
  }

  private endRound(text: string): void {
    if (this.phase !== "round") return;
    const mult = this.cfg().mult;
    for (const s of this.seats) {
      s.lastBase = roundScore(s.trace, s.path);
      s.lastPlace = s.finished ? s.finishPlace : null;
      s.roundScores.push(totalRoundScore(s.lastBase, s.lastPlace, mult));
      s.pointerId = null;
      s.finger = null;
    }
    this.flights = [];
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

  /** Smudge buttons for a finished seat (zone-local rects), one per rival still tracing. */
  private smudgeButtons(i: number): SmudgeButton[] {
    const s = this.seats[i]!;
    const out: SmudgeButton[] = [];
    if (!s.finished || this.phase !== "round") return out;
    const bh = Math.max(58, this.ctx.minTap);
    const bw = Math.min(s.w - 32, 250);
    let y = this.ctx.height * 0.38 + 112;
    for (let t = 0; t < this.seats.length; t++) {
      if (t === i || this.seats[t]!.finished) continue;
      out.push({ target: t, x: s.w / 2 - bw / 2, y, w: bw, h: bh });
      y += bh + 10;
    }
    return out;
  }

  private readonly onDown = (e: PointerEvent): void => {
    const p = this.toLogical(e);
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (s.player.kind !== "human" || p.x < s.x || p.x >= s.x + s.w) continue;
      e.preventDefault();
      if (this.phase !== "round") return;
      const local = { x: p.x - s.x, y: p.y };
      if (s.finished) {
        if (s.blotsLeft <= 0) return;
        for (const b of this.smudgeButtons(i)) {
          if (local.x >= b.x && local.x <= b.x + b.w && local.y >= b.y && local.y <= b.y + b.h) {
            this.throwBlot(i, b.target);
            return;
          }
        }
        return;
      }
      if (s.pointerId !== null) return;
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
      if (this.phase === "round" && liftTrace(s.trace, s.path) === "scrapped") this.scrapped(i, s.finger);
      return;
    }
  };

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);
    for (let i = 0; i < this.seats.length; i++) this.drawZone(g, i);
    this.drawFlights(g);
    this.juice.end(g);
    if (this.phase === "round") {
      const left = ROUND_TIME_S - this.roundT;
      const remaining = this.grace !== null ? Math.min(left, this.grace) : left;
      const total = this.grace !== null ? FINISH_GRACE_S : ROUND_TIME_S;
      drawTimerBar(g, width, Math.max(0, remaining), total);
    }
    this.callouts.draw(g, width, height);
  }

  private drawFlights(g: CanvasRenderingContext2D): void {
    for (const f of this.flights) {
      const t = Math.min(1, f.t);
      const x = f.from.x + (f.to.x - f.from.x) * t;
      const y = f.from.y + (f.to.y - f.from.y) * t - Math.sin(t * Math.PI) * 140;
      const r = 10 + f.r * 0.35 * t;
      g.fillStyle = INK;
      g.strokeStyle = f.color;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }

  private pathShape(g: CanvasRenderingContext2D, path: TracePath): void {
    g.beginPath();
    const pts = path.pts;
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k]!;
      if (k === 0) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    }
  }

  /** The bands and centre line never change within a round, so they are drawn once per seat. */
  private laneBands(g: CanvasRenderingContext2D, s: Seat): void {
    const draw = (t: CanvasRenderingContext2D): void => {
      const tol = s.path.tol;
      t.lineCap = "round";
      t.lineJoin = "round";
      this.pathShape(t, s.path);
      t.strokeStyle = "rgba(244,247,251,0.035)";
      t.lineWidth = tol * OUTER_BAND * 2;
      t.stroke();
      this.pathShape(t, s.path);
      t.strokeStyle = s.wide ? "rgba(184,255,61,0.16)" : "rgba(244,247,251,0.11)";
      t.lineWidth = tol * 2;
      t.stroke();
      this.pathShape(t, s.path);
      t.strokeStyle = "rgba(244,247,251,0.5)";
      t.lineWidth = 2;
      t.setLineDash([10, 9]);
      t.stroke();
      t.setLineDash([]);
    };
    if (typeof document === "undefined") {
      draw(g);
      return;
    }
    if (!s.laneCache) {
      const c = document.createElement("canvas");
      c.width = Math.ceil(s.w);
      c.height = Math.ceil(this.ctx.height);
      const t = c.getContext("2d");
      if (t) draw(t);
      s.laneCache = c;
    }
    g.drawImage(s.laneCache, 0, 0);
  }

  private drawBlot(g: CanvasRenderingContext2D, b: Blot): void {
    const a = blotAlpha(b);
    const age = b.maxLife - b.life;
    const grow = Math.min(1, age / 0.12);
    const r = b.r * (0.7 + 0.3 * grow) * (0.85 + 0.15 * a);
    g.globalAlpha = 0.97 * a;
    g.fillStyle = INK;
    g.beginPath();
    const lobes = 14;
    for (let k = 0; k <= lobes; k++) {
      const ang = (k / lobes) * Math.PI * 2;
      const wob = 0.82 + 0.18 * Math.sin(k * 2.3 + b.seed * 1.7) + 0.1 * Math.cos(k * 4.1 + b.seed);
      const rr = r * wob;
      const x = b.x + Math.cos(ang) * rr;
      const y = b.y + Math.sin(ang) * rr;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = b.color;
    g.globalAlpha = 0.55 * a;
    g.stroke();
    // A few droplets.
    g.globalAlpha = 0.9 * a;
    g.fillStyle = INK;
    for (let k = 0; k < 4; k++) {
      const ang = b.seed * 0.9 + k * 1.9;
      const d = r * (1.15 + 0.25 * ((k * 7 + b.seed) % 3));
      g.beginPath();
      g.arc(b.x + Math.cos(ang) * d, b.y + Math.sin(ang) * d, r * (0.08 + 0.05 * (k % 2)), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  private drawZone(g: CanvasRenderingContext2D, i: number): void {
    const s = this.seats[i]!;
    const h = this.ctx.height;
    const path = s.path;
    const tol = path.tol;
    const cx = s.w / 2;
    const color = s.player.color;
    const final = this.cfg().title !== undefined;

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
    let sub = s.roundScores.length > 0 ? `TOTAL ${this.total(s)}` : s.player.kind === "bot" ? "BOT" : "TRACE IT";
    if (s.player.kind === "human" && this.pb > 0) sub += `  ·  PB ${this.pb}%`;
    g.fillText(sub, cx, 70);

    this.laneBands(g, s);

    if (s.wide && s.wideFlash > 0 && !s.finished) {
      g.font = `700 30px ${FONT}`;
      g.textBaseline = "middle";
      g.fillStyle = `rgba(184,255,61,${Math.min(1, s.wideFlash * 2)})`;
      g.fillText("WIDE BRUSH", cx, h * 0.5);
    }

    for (const b of s.blots) this.drawBlot(g, b);

    // The player's stroke: a soft wide glow under a bright core; hotter with the streak.
    const pts = s.trace.points;
    if (pts.length > 1) {
      g.beginPath();
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k]!;
        if (k === 0) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
      }
      g.lineCap = "round";
      g.lineJoin = "round";
      const core = Math.max(5, tol * 0.45);
      g.strokeStyle = color;
      g.globalAlpha = 0.22 + s.streakTier * 0.08;
      g.lineWidth = core * (2.2 + s.streakTier * 0.5);
      g.stroke();
      g.globalAlpha = 0.95;
      g.lineWidth = core;
      g.stroke();
      if (s.streakTier >= 2) {
        g.strokeStyle = "#F4F7FB";
        g.globalAlpha = 0.5;
        g.lineWidth = core * 0.35;
        g.stroke();
      }
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
      g.arc(s.finger.x, s.finger.y, 9 + s.streakTier * 2, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }

    // Status text.
    g.textAlign = "center";
    g.textBaseline = "middle";
    const showResult = this.phase === "result" || this.phase === "final";
    if (showResult) {
      const score = s.roundScores[s.roundScores.length - 1] ?? 0;
      this.bigNumber(g, `+${score}`, cx, h * 0.45, s.finished ? color : "rgba(244,247,251,0.75)");
      g.font = `700 26px ${FONT}`;
      g.fillStyle = "rgba(244,247,251,0.75)";
      const place = s.lastPlace;
      const placeText = place === null ? (s.lastBase === 0 ? "NO TRACE" : "PARTIAL") : `${s.lastBase}%  ${ordinal(place + 1)}`;
      g.fillText(final ? `${placeText}  x${this.cfg().mult}` : placeText, cx, h * 0.45 + 64);
    } else if (s.finished) {
      const acc = Math.round(accuracy(s.trace) * 100);
      this.bigNumber(g, `${acc}%`, cx, h * 0.38, color);
      g.font = `700 24px ${FONT}`;
      g.fillStyle = "rgba(244,247,251,0.75)";
      g.fillText(`${ordinal((s.finishPlace ?? 0) + 1)} DONE`, cx, h * 0.38 + 58);
      this.drawSmudgeButtons(g, i);
    } else if (s.trace.state === "tracing") {
      g.font = `700 30px ${FONT}`;
      g.fillStyle = color;
      g.fillText(`${Math.round(accuracy(s.trace) * 100)}%`, cx, h - 24);
      // Heat meter.
      const mw = Math.min(s.w - 60, 160);
      const heat = Math.min(1, s.trace.streak / 90);
      g.fillStyle = "rgba(7,11,20,0.6)";
      g.fillRect(cx - mw / 2, h - 48, mw, 6);
      g.fillStyle = s.streakTier >= 3 ? "#F4F7FB" : s.streakTier >= 2 ? "#FFB020" : color;
      g.fillRect(cx - mw / 2, h - 48, mw * heat, 6);
      if (s.streakTier >= 3) {
        g.font = `700 20px ${FONT}`;
        g.fillStyle = "#F4F7FB";
        g.fillText("ON FIRE", cx, h - 62);
      }
    } else if (idle && s.player.kind === "human") {
      g.font = `700 22px ${FONT}`;
      g.fillStyle = "rgba(244,247,251,0.4)";
      g.fillText(s.trace.scraps > 0 ? "BACK TO START!" : "FINGER ON START", cx, h - 24);
    }

    if (s.smudgedFlash > 0 && !s.finished) {
      g.font = `700 30px ${FONT}`;
      g.globalAlpha = Math.min(1, s.smudgedFlash * 1.5);
      g.lineWidth = 6;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      const text = `SMUDGED BY ${s.smudgedBy}`;
      g.strokeText(text, cx, h * 0.2 - (1 - s.smudgedFlash) * 20);
      g.fillStyle = "#FF3D7A";
      g.fillText(text, cx, h * 0.2 - (1 - s.smudgedFlash) * 20);
      g.globalAlpha = 1;
    }

    if (s.closeFlash > 0 && s.trace.state === "tracing") {
      g.font = `700 36px ${FONT}`;
      g.globalAlpha = Math.min(1, s.closeFlash * 1.5);
      g.lineWidth = 6;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      g.strokeText("SO CLOSE!", cx, h * 0.3 - (1 - s.closeFlash) * 30);
      g.fillStyle = "#FFB020";
      g.fillText("SO CLOSE!", cx, h * 0.3 - (1 - s.closeFlash) * 30);
      g.globalAlpha = 1;
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

  private bigNumber(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
    g.font = `700 100px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 10;
    g.strokeStyle = "rgba(7,11,20,0.85)";
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
  }

  private drawSmudgeButtons(g: CanvasRenderingContext2D, i: number): void {
    const s = this.seats[i]!;
    const buttons = this.smudgeButtons(i);
    const cx = s.w / 2;
    const top = this.ctx.height * 0.38 + 112;
    if (buttons.length === 0) {
      g.font = `700 22px ${FONT}`;
      g.fillStyle = "rgba(244,247,251,0.5)";
      g.fillText("WAITING...", cx, top + 20);
      return;
    }
    const canThrow = s.blotsLeft > 0 && s.player.kind === "human";
    g.font = `700 20px ${FONT}`;
    g.fillStyle = canThrow ? "#F4F7FB" : "rgba(244,247,251,0.5)";
    g.fillText(s.player.kind === "bot" ? (s.blotsLeft > 0 ? "SMUDGING..." : "OUT OF INK") : canThrow ? "SMUDGE A RIVAL!" : "OUT OF INK", cx, top - 20);
    for (const b of buttons) {
      const t = this.seats[b.target]!;
      g.globalAlpha = canThrow ? 1 : 0.35;
      g.fillStyle = "rgba(7,11,20,0.7)";
      g.fillRect(b.x, b.y, b.w, b.h);
      g.strokeStyle = t.player.color;
      g.lineWidth = 3;
      g.strokeRect(b.x, b.y, b.w, b.h);
      g.fillStyle = INK;
      g.beginPath();
      g.arc(b.x + 24, b.y + b.h / 2, 11, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = s.player.color;
      g.lineWidth = 2;
      g.stroke();
      g.font = `700 26px ${FONT}`;
      g.fillStyle = t.player.color;
      g.fillText(t.player.name, b.x + b.w / 2 + 12, b.y + b.h / 2);
      g.globalAlpha = 1;
    }
    // Ink left.
    const y = (buttons[buttons.length - 1]?.y ?? top) + (buttons[buttons.length - 1]?.h ?? 0) + 22;
    for (let k = 0; k < BLOTS_PER_ROUND; k++) {
      g.fillStyle = k < s.blotsLeft ? INK : "rgba(7,11,20,0.25)";
      g.strokeStyle = k < s.blotsLeft ? s.player.color : "rgba(244,247,251,0.25)";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(cx + (k - (BLOTS_PER_ROUND - 1) / 2) * 30, y, 9, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
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
      out.push({ playerId: s.player.id, label: "Smudges thrown", value: String(s.smudgesThrown) });
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

function ordinal(n: number): string {
  return n === 1 ? "1ST" : n === 2 ? "2ND" : n === 3 ? "3RD" : `${n}TH`;
}

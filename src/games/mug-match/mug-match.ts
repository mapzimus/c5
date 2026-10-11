import { drawTimerBar, fillArena } from "../../core/draw";
import { Callouts, Juice } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  baseParams, clampHandle, eyeRadius, handlesFromParams, matchPercent, newSpring, paramsFromHandles, planBot,
  randomTarget, resetSpring, stepBot, stepSpring,
  LEFT_BROW, LEFT_EYE, LEFT_MOUTH, MOUTH_Y, NOSE, NOSE_ROOT_Y, RIGHT_BROW, RIGHT_EYE, RIGHT_MOUTH, ROUNDS, ROUND_MS,
  type BotState, type Handles, type Params, type Pt, type Spring,
} from "./logic";

export const mugMatch: GameDefinition = {
  id: "mug-match",
  name: "Mug Match",
  tagline: "Pull that face. No, THAT face.",
  description:
    "A ridiculous target mug is shown at the top. Everyone gets the same blank face with seven draggable " +
    "handles: eyes, eyebrow ends, mouth corners and nose tip. Stretch yours to match the target before the " +
    "12 second timer runs out. Closest match scores the most. Three rounds, each uglier than the last. " +
    "Highest total wins.",
  durationMs: 0,
  controls: "Drag the handles on your face",
  create: (ctx) => new MugMatch(ctx),
};

const INTRO_S = 1.3;
const RESULT_S = 2.2;
const FINAL_S = 2.2;
const ROUND_S = ROUND_MS / 1000;
const FONT = "Bebas Neue, Impact, sans-serif";
const SKIN = "#F2C9A0";
const SKIN_DARK = "#C98A5E";
const INK = "#3b2416";
const LIP = "#8c2237";
const HEAD_POINTS = 56;

type Phase = "intro" | "round" | "result" | "final";

interface Seat {
  player: Player;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  r: number;
  handles: Handles;
  skin: Spring;
  bot: BotState | null;
  botError: number;
  grabbed: boolean[];
  rounds: number[];
  total: number;
  lastPct: number;
}

interface Grab {
  seat: number;
  handle: number;
  dx: number;
  dy: number;
}

class MugMatch implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly grabs = new Map<number, Grab>();
  private phase: Phase = "intro";
  private timer = INTRO_S;
  private roundIndex = 0;
  private target: Params = baseParams();
  private targetHandles: Handles = handlesFromParams(this.target);
  private targetSkin: Spring = newSpring(this.targetHandles);
  private finished = false;
  private time = 0;
  private lastTick = -1;
  private readonly panelH: number;
  private readonly targetR: number;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    const n = ctx.players.length;
    this.panelH = ctx.height * 0.36;
    this.targetR = this.panelH * 0.33;
    const zoneW = ctx.width / n;
    const zoneY = this.panelH;
    const zoneH = ctx.height - zoneY;
    this.seats = ctx.players.map((player, i) => {
      const x = i * zoneW;
      const r = Math.min(zoneW * 0.3, zoneH * 0.3);
      const base = handlesFromParams(baseParams());
      return {
        player, x, y: zoneY, w: zoneW, h: zoneH,
        cx: x + zoneW / 2, cy: zoneY + zoneH * 0.54, r,
        handles: base, skin: newSpring(base), bot: null,
        botError: ctx.rng.float(0.05, 0.25),
        grabbed: base.map(() => false), rounds: [], total: 0, lastPct: 0,
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

  private startRound(): void {
    this.target = randomTarget(this.roundIndex, this.ctx.rng);
    this.targetHandles = handlesFromParams(this.target);
    // The target mug wobbles in from neutral so it reads as "a face being pulled".
    resetSpring(this.targetSkin, handlesFromParams(baseParams()));
    this.grabs.clear();
    for (const s of this.seats) {
      s.handles = handlesFromParams(baseParams());
      resetSpring(s.skin, s.handles);
      s.grabbed = s.handles.map(() => false);
      s.bot = s.player.kind === "bot" ? planBot(this.target, s.botError, this.ctx.rng) : null;
    }
    this.lastTick = -1;
    this.ctx.sfx.countdown();
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += dt;
    stepSpring(this.targetSkin, this.targetHandles, dt, 160, 10);
    for (const s of this.seats) stepSpring(s.skin, s.handles, dt);
    if (this.finished) return;

    if (this.phase === "intro") {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = "round";
        this.timer = ROUND_S;
        this.callouts.show("GO!", "#FFB020", { size: 80, life: 0.7, y: 0.5 });
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

    this.timer -= dt;
    const whole = Math.ceil(this.timer);
    if (this.timer <= 3 && whole !== this.lastTick && whole > 0) {
      this.lastTick = whole;
      this.ctx.sfx.tick();
    }
    for (const s of this.seats) {
      if (s.bot) stepBot(s.bot, s.handles, dt, this.ctx.rng);
    }
    if (this.timer <= 0) this.endRound();
  }

  private endRound(): void {
    this.grabs.clear();
    let best: Seat | null = null;
    for (const s of this.seats) {
      s.grabbed = s.grabbed.map(() => false);
      const pct = matchPercent(paramsFromHandles(s.handles), this.target);
      s.rounds.push(pct);
      s.total += pct;
      s.lastPct = pct;
      if (!best || pct > best.lastPct) best = s;
      this.juice.burst(s.cx, s.cy, [s.player.color, "#ffffff", SKIN], {
        count: 8 + Math.round(pct / 5), speed: 160 + pct * 2.4, gravity: 500, size: 5, life: 0.8,
      });
    }
    this.juice.shake(0.3);
    this.juice.hitStop(0.06);
    if (best) {
      const tied = this.seats.filter((s) => s.lastPct === best!.lastPct);
      const text = tied.length === 1 ? `${best.player.name} ${best.lastPct}%` : `TIE AT ${best.lastPct}%`;
      this.callouts.show(text, tied.length === 1 ? best.player.color : "#F4F7FB", { size: 64, life: RESULT_S, y: 0.5 });
      if (best.lastPct >= 90) this.ctx.sfx.streak(4);
      else this.ctx.sfx.collect();
    }
    if (this.roundIndex + 1 >= ROUNDS) {
      this.phase = "final";
      this.timer = RESULT_S + FINAL_S;
      const top = Math.max(...this.seats.map((s) => s.total));
      const leaders = this.seats.filter((s) => s.total === top);
      const text = leaders.map((s) => s.player.name).join(" & ") + " WINS!";
      this.callouts.show(text, leaders.length === 1 ? leaders[0]!.player.color : "#F4F7FB", {
        size: 76, life: RESULT_S + FINAL_S, y: 0.22,
      });
      this.ctx.sfx.win();
    } else {
      this.phase = "result";
      this.timer = RESULT_S;
    }
  }

  // ── Input ──
  private toLogical(e: PointerEvent): Pt {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private knobRadius(s: Seat): number {
    return Math.max(11, Math.min(this.ctx.minTap * 0.24, s.r * 0.17));
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (this.phase !== "round") return;
    const p = this.toLogical(e);
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (s.player.kind !== "human") continue;
      if (p.x < s.x || p.x >= s.x + s.w || p.y < s.y) continue;
      e.preventDefault();
      const grabR = Math.max(this.ctx.minTap * 0.55, this.knobRadius(s) * 2.2);
      let best = -1;
      let bestD = grabR;
      for (let k = 0; k < s.handles.length; k++) {
        if (s.grabbed[k]) continue;
        const h = s.handles[k]!;
        const d = Math.hypot(p.x - (s.cx + h.x * s.r), p.y - (s.cy + h.y * s.r));
        if (d < bestD) { bestD = d; best = k; }
      }
      if (best < 0) return;
      const h = s.handles[best]!;
      this.grabs.set(e.pointerId, { seat: i, handle: best, dx: s.cx + h.x * s.r - p.x, dy: s.cy + h.y * s.r - p.y });
      s.grabbed[best] = true;
      this.ctx.sfx.tick();
      try { this.ctx.canvas.setPointerCapture(e.pointerId); } catch { /* optional */ }
      return;
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    const g = this.grabs.get(e.pointerId);
    if (!g) return;
    e.preventDefault();
    const s = this.seats[g.seat]!;
    const p = this.toLogical(e);
    s.handles[g.handle] = clampHandle({ x: (p.x + g.dx - s.cx) / s.r, y: (p.y + g.dy - s.cy) / s.r });
  };

  private readonly onUp = (e: PointerEvent): void => {
    const g = this.grabs.get(e.pointerId);
    if (!g) return;
    this.grabs.delete(e.pointerId);
    this.seats[g.seat]!.grabbed[g.handle] = false;
  };

  // ── Render ──
  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);
    for (let i = 0; i < this.seats.length; i++) this.drawSeat(g, i);
    this.drawTargetPanel(g);
    this.juice.drawParticles(g);
    this.juice.end(g);
    if (this.phase === "round") drawTimerBar(g, width, Math.max(0, this.timer), ROUND_S);
    if (this.phase === "intro") {
      g.save();
      g.font = `700 72px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 10;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      const text = `ROUND ${this.roundIndex + 1}`;
      g.strokeText(text, width / 2, height * 0.5);
      g.fillStyle = "#F4F7FB";
      g.fillText(text, width / 2, height * 0.5);
      g.restore();
    }
    this.callouts.draw(g, width, height);
  }

  private drawTargetPanel(g: CanvasRenderingContext2D): void {
    const { width } = this.ctx;
    const pw = Math.min(width * 0.42, this.panelH * 2.1);
    const px = width / 2 - pw / 2;
    const py = 34;
    const ph = this.panelH - 44;
    g.save();
    g.fillStyle = "rgba(7,11,20,0.55)";
    g.strokeStyle = "#FFB020";
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(px, py, pw, ph, 18);
    g.fill();
    g.stroke();
    g.font = `700 26px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "top";
    g.fillStyle = "#FFB020";
    g.fillText("MATCH THIS MUG", width / 2, py + 8);
    g.textAlign = "left";
    g.fillStyle = "rgba(244,247,251,0.6)";
    g.fillText(`ROUND ${Math.min(ROUNDS, this.roundIndex + 1)} / ${ROUNDS}`, px + 14, py + 8);
    g.restore();
    const wob = 1 + Math.sin(this.time * 6) * 0.02;
    this.drawFace(g, width / 2, py + ph * 0.56, this.targetR * wob, this.targetSkin.pos, "#FFB020", null, null);
  }

  private drawSeat(g: CanvasRenderingContext2D, i: number): void {
    const s = this.seats[i]!;
    const { height } = this.ctx;
    g.save();
    g.globalAlpha = 0.1;
    g.fillStyle = s.player.color;
    g.fillRect(s.x, s.y, s.w, s.h);
    g.globalAlpha = 1;
    g.strokeStyle = "rgba(244,247,251,0.12)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(s.x + s.w, s.y);
    g.lineTo(s.x + s.w, height);
    g.moveTo(s.x, s.y);
    g.lineTo(s.x + s.w, s.y);
    g.stroke();

    g.textAlign = "center";
    g.textBaseline = "top";
    g.fillStyle = s.player.color;
    g.font = `700 30px ${FONT}`;
    g.fillText(s.player.name, s.cx, s.y + 8);
    g.fillStyle = "rgba(244,247,251,0.75)";
    g.font = `700 22px ${FONT}`;
    g.fillText(`${s.total} pts`, s.cx, s.y + 40);
    // Round pips with each round's %.
    for (let k = 0; k < ROUNDS; k++) {
      const x = s.cx + (k - (ROUNDS - 1) / 2) * 34;
      g.beginPath();
      g.arc(x, s.y + 78, 7, 0, Math.PI * 2);
      g.fillStyle = k < s.rounds.length ? s.player.color : "rgba(244,247,251,0.15)";
      g.fill();
    }
    g.restore();

    const showHandles = this.phase === "round" || this.phase === "intro";
    this.drawFace(g, s.cx, s.cy, s.r, s.skin.pos, s.player.color, showHandles ? s : null, showHandles ? s.handles : null);

    if (this.phase === "result" || this.phase === "final") {
      const pct = s.lastPct;
      const color = pct >= 80 ? "#B8FF3D" : pct >= 50 ? "#FFB020" : "#FF3D7A";
      g.save();
      g.font = `700 ${Math.min(88, s.w * 0.28)}px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 8;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      const y = s.y + s.h * 0.9;
      g.strokeText(`${pct}%`, s.cx, y);
      g.fillStyle = color;
      g.fillText(`${pct}%`, s.cx, y);
      g.restore();
    } else if (s.player.kind === "human" && this.phase === "round") {
      g.save();
      g.font = `700 22px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "rgba(244,247,251,0.35)";
      g.fillText("DRAG THE DOTS", s.cx, s.y + s.h * 0.95);
      g.restore();
    }
  }

  /** Draws a mug from skin (lagging) positions; knobs at the real handle positions when given. */
  private drawFace(
    g: CanvasRenderingContext2D, cx: number, cy: number, R: number, skin: Pt[], outline: string,
    seat: Seat | null, handles: Handles | null,
  ): void {
    g.save();
    g.translate(cx, cy);
    g.scale(R, R);
    g.lineJoin = "round";
    g.lineCap = "round";

    // Ears.
    g.fillStyle = SKIN_DARK;
    g.beginPath();
    g.arc(-1.0, 0.02, 0.2, 0, Math.PI * 2);
    g.arc(1.0, 0.02, 0.2, 0, Math.PI * 2);
    g.fill();

    // Head: a blob that bulges toward any handle pushed past the rim.
    g.beginPath();
    for (let i = 0; i <= HEAD_POINTS; i++) {
      const ang = (i / HEAD_POINTS) * Math.PI * 2;
      let r = 1 + Math.sin(ang * 2 + this.time * 3) * 0.015;
      for (const h of skin) {
        const d = Math.hypot(h.x, h.y);
        if (d < 0.72) continue;
        const along = Math.cos(ang - Math.atan2(h.y, h.x));
        if (along <= 0) continue;
        r += (d - 0.72) * 1.15 * Math.pow(along, 10);
      }
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r * 1.08;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fillStyle = SKIN;
    g.fill();
    g.lineWidth = 0.06;
    g.strokeStyle = outline;
    g.stroke();

    const le = skin[LEFT_EYE]!, re = skin[RIGHT_EYE]!, lb = skin[LEFT_BROW]!, rb = skin[RIGHT_BROW]!;
    const lm = skin[LEFT_MOUTH]!, rm = skin[RIGHT_MOUTH]!, nose = skin[NOSE]!;
    const er = eyeRadius(skin);

    // Cheeks.
    g.fillStyle = "rgba(255,110,120,0.35)";
    g.beginPath();
    g.ellipse(lm.x - 0.12, (lm.y + le.y) / 2, 0.14, 0.09, 0, 0, Math.PI * 2);
    g.ellipse(rm.x + 0.12, (rm.y + re.y) / 2, 0.14, 0.09, 0, 0, Math.PI * 2);
    g.fill();

    // Mouth: a crescent between the corners, bulging away from the curve.
    const curve = (lm.y + rm.y) / 2 - MOUTH_Y;
    const midX = (lm.x + rm.x) / 2;
    const lowY = MOUTH_Y - curve * 1.5 + 0.12;
    const highY = MOUTH_Y - curve * 1.5 - 0.1;
    g.beginPath();
    g.moveTo(lm.x, lm.y);
    g.quadraticCurveTo(midX, lowY, rm.x, rm.y);
    g.quadraticCurveTo(midX, highY, lm.x, lm.y);
    g.closePath();
    g.fillStyle = LIP;
    g.fill();
    g.lineWidth = 0.045;
    g.strokeStyle = INK;
    g.stroke();
    // Teeth strip along the upper lip.
    g.save();
    g.clip();
    g.fillStyle = "#fff6e8";
    const teethY = Math.min(highY, (lm.y + rm.y) / 2);
    g.fillRect(Math.min(lm.x, rm.x), teethY - 0.3, Math.abs(rm.x - lm.x), 0.3 + Math.abs(curve) * 0.35 + 0.05);
    g.restore();

    // Nose: root to tip, with a nostril blob.
    g.lineWidth = 0.07;
    g.strokeStyle = INK;
    g.beginPath();
    g.moveTo(0, NOSE_ROOT_Y);
    g.lineTo(nose.x, nose.y);
    g.lineTo(nose.x - 0.14, nose.y + 0.02);
    g.stroke();
    g.fillStyle = SKIN_DARK;
    g.beginPath();
    g.arc(nose.x, nose.y, 0.085, 0, Math.PI * 2);
    g.fill();

    // Eyes: whites, pupils looking toward the nose tip.
    for (const [e, sign] of [[le, -1], [re, 1]] as const) {
      g.fillStyle = "#ffffff";
      g.strokeStyle = INK;
      g.lineWidth = 0.04;
      g.beginPath();
      g.ellipse(e.x, e.y, er, er * 1.1, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      const px = e.x + sign * -0.2 * er + (nose.x - e.x) * 0.1;
      const py = e.y + (nose.y - e.y) * 0.12;
      g.fillStyle = INK;
      g.beginPath();
      g.arc(px, py, er * 0.45, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.arc(px - er * 0.15, py - er * 0.15, er * 0.14, 0, Math.PI * 2);
      g.fill();
    }

    // Brows: from an inner anchor near the nose out to the brow end handle.
    g.lineWidth = 0.09;
    g.strokeStyle = INK;
    g.beginPath();
    g.moveTo(-0.14, le.y - 0.2);
    g.lineTo(lb.x, lb.y);
    g.moveTo(0.14, re.y - 0.2);
    g.lineTo(rb.x, rb.y);
    g.stroke();

    g.restore();

    if (seat && handles) {
      const kr = this.knobRadius(seat);
      for (let k = 0; k < handles.length; k++) {
        const h = handles[k]!;
        const held = seat.grabbed[k] ?? false;
        const rr = held ? kr * 1.3 : kr;
        g.save();
        g.globalAlpha = seat.player.kind === "human" ? 0.95 : 0.6;
        g.beginPath();
        g.arc(cx + h.x * R, cy + h.y * R, rr, 0, Math.PI * 2);
        g.fillStyle = seat.player.color;
        g.fill();
        g.lineWidth = 3;
        g.strokeStyle = held ? "#ffffff" : "rgba(7,11,20,0.7)";
        g.stroke();
        g.restore();
      }
    }
  }

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({ playerId: s.player.id, score: s.total }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const s of this.seats) {
      const best = s.rounds.length ? Math.max(...s.rounds) : 0;
      out.push({ playerId: s.player.id, label: "Best match %", value: `${best}%` });
      out.push({ playerId: s.player.id, label: "Rounds", value: s.rounds.map((r) => `${r}%`).join(" / ") || "-" });
    }
    return out;
  }

  destroy(): void {
    const c = this.ctx.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
    this.grabs.clear();
  }
}

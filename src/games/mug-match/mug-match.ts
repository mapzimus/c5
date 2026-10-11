import { drawTimerBar, fillArena } from "../../core/draw";
import { Callouts, Juice, loadBest, saveBest } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  baseParams, botPickTarget, botSnapCheck, clampHandle, eyeRadius, flashMult, handlesFromParams, knockHandle,
  matchPercent, newSpring, paramsFromHandles, planBot, randomTarget, resetSpring, roundName, roundSeconds,
  scoreTier, snapScore, stepBot, stepSpring, underdogs,
  LEFT_BROW, LEFT_EYE, LEFT_MOUTH, MOUTH_Y, NOSE, NOSE_ROOT_Y, RIGHT_BROW, RIGHT_EYE, RIGHT_MOUTH, ROUNDS,
  SPLAT_BONUS, TOMATOES_PER_ROUND,
  type BotState, type Handles, type Params, type Pt, type Spring,
} from "./logic";

export const mugMatch: GameDefinition = {
  id: "mug-match",
  name: "Mug Shots",
  tagline: "Pull the face. Snap it early. Splat the rest.",
  description:
    "A ridiculous target mug is shown at the top. Everyone gets the same blank face with seven draggable " +
    "handles: eyes, eyebrow ends, mouth corners and nose tip. Stretch yours to match, then hit SNAP: the " +
    "flash bonus starts at x2 and drains to x1, so a rough mug snapped early can beat a perfect one at the " +
    "buzzer. Once you've snapped, your hands are free: throw a tomato at anyone still sculpting. Last place " +
    "gets a guide overlay. Four rounds, each uglier and shorter than the last; the final pays double.",
  durationMs: 0,
  controls: "Drag the dots, tap SNAP, then tap a face to splat it",
  create: (ctx) => new MugMatch(ctx),
};

const ID = "mug-match";
const BEST_KEY = "v2-shot";
const INTRO_S = 1.3;
const RESULT_S = 1.9;
const FINAL_S = 2.4;
const ALL_SNAPPED_GRACE_S = 0.55;
const TOMATO_FLIGHT_S = 0.38;
const IMMUNE_S = 2.2;
const FONT = "Bebas Neue, Impact, sans-serif";
const SKIN = "#F2C9A0";
const SKIN_DARK = "#C98A5E";
const INK = "#3b2416";
const LIP = "#8c2237";
const TOMATO = "#E8352B";
const TOMATO_DARK = "#A81F1A";
const LEAF = "#4CAF50";
const HEAD_POINTS = 56;
const BOT_TAUNTS_THROW = ["TAKE THAT!", "HEADS UP!", "OOPS, SLIPPED", "CATCH!"];
const BOT_TAUNTS_SNAP = ["GOOD ENOUGH", "SEND IT", "NAILED IT", "EH, FINE"];

type Phase = "intro" | "round" | "result" | "final";

interface Splat {
  handle: number;
  life: number;
  spin: number;
}

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
  snapped: boolean;
  snapMatch: number;
  snapMult: number;
  snapPts: number;
  photoTilt: number;
  flash: number;
  tomatoes: number;
  splats: Splat[];
  hits: number;
  bestShot: number;
  underdog: boolean;
  wobble: number;
  /** Seconds of tomato immunity after a hit, so a table cannot pile onto the last sculptor. */
  immune: number;
}

interface Grab {
  seat: number;
  handle: number;
  dx: number;
  dy: number;
}

interface Tomato {
  from: Pt;
  to: Pt;
  t: number;
  thrower: number;
  victim: number;
  /** Bots sometimes fumble: the tomato lands beside the mug. */
  miss: boolean;
}

interface Label {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  size: number;
}

class MugMatch implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly grabs = new Map<number, Grab>();
  private readonly tomatoes: Tomato[] = [];
  private labels: Label[] = [];
  private phase: Phase = "intro";
  private timer = INTRO_S;
  private roundIndex = 0;
  private roundS = roundSeconds(0);
  private target: Params = baseParams();
  private targetHandles: Handles = handlesFromParams(this.target);
  private targetSkin: Spring = newSpring(this.targetHandles);
  private finished = false;
  private time = 0;
  private lastTick = -1;
  private allSnappedGrace = -1;
  private readonly panelH: number;
  private readonly targetR: number;
  private readonly btnH: number;
  private readonly btnY: number;
  private readonly best = loadBest(ID, BEST_KEY);
  private newRecord = false;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    const n = ctx.players.length;
    this.panelH = ctx.height * 0.31;
    this.targetR = (this.panelH - 34) * 0.4;
    this.btnH = Math.max(56, ctx.minTap);
    this.btnY = ctx.height - this.btnH - 12;
    const zoneW = ctx.width / n;
    const zoneY = this.panelH;
    const zoneH = ctx.height - zoneY;
    const bandTop = zoneY + 82;
    const bandH = this.btnY - 10 - bandTop;
    this.seats = ctx.players.map((player, i) => {
      const x = i * zoneW;
      const r = Math.min(zoneW * 0.3, bandH * 0.38);
      const base = handlesFromParams(baseParams());
      return {
        player, x, y: zoneY, w: zoneW, h: zoneH,
        cx: x + zoneW / 2, cy: bandTop + bandH / 2, r,
        handles: base, skin: newSpring(base), bot: null,
        botError: ctx.rng.float(0.05, 0.25),
        grabbed: base.map(() => false), rounds: [], total: 0,
        snapped: false, snapMatch: 0, snapMult: 1, snapPts: 0, photoTilt: 0, flash: 0,
        tomatoes: 0, splats: [], hits: 0, bestShot: 0, underdog: false, wobble: 0, immune: 0,
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
    this.roundS = roundSeconds(this.roundIndex);
    this.target = randomTarget(this.roundIndex, this.ctx.rng);
    this.targetHandles = handlesFromParams(this.target);
    // The target mug wobbles in from neutral so it reads as "a face being pulled".
    resetSpring(this.targetSkin, handlesFromParams(baseParams()));
    this.grabs.clear();
    this.tomatoes.length = 0;
    this.allSnappedGrace = -1;
    const dogs = new Set(this.roundIndex > 0 ? underdogs(this.seats.map((s) => s.total)) : []);
    this.seats.forEach((s, i) => {
      s.handles = handlesFromParams(baseParams());
      resetSpring(s.skin, s.handles);
      s.grabbed = s.handles.map(() => false);
      s.snapped = false;
      s.snapMatch = 0;
      s.snapMult = 1;
      s.snapPts = 0;
      s.flash = 0;
      s.tomatoes = TOMATOES_PER_ROUND;
      s.splats = [];
      s.immune = 0;
      s.underdog = dogs.has(i);
      // Underdogs see the guide; a bot underdog "reads" it as a sharper idea of the target.
      const err = s.underdog ? s.botError * 0.45 : s.botError;
      s.bot = s.player.kind === "bot" ? planBot(this.target, err, this.ctx.rng) : null;
    });
    this.lastTick = -1;
    this.ctx.sfx.countdown();
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += dt;
    stepSpring(this.targetSkin, this.targetHandles, dt, 160, 10);
    for (const s of this.seats) {
      stepSpring(s.skin, s.handles, dt);
      s.flash = Math.max(0, s.flash - dt * 3);
      s.wobble = Math.max(0, s.wobble - dt * 2.5);
      s.immune = Math.max(0, s.immune - dt);
      for (const sp of s.splats) sp.life -= dt;
      s.splats = s.splats.filter((sp) => sp.life > 0);
    }
    for (const l of this.labels) { l.life -= dt; l.y -= dt * 26; }
    this.labels = this.labels.filter((l) => l.life > 0);
    this.stepTomatoes(dt);
    if (this.finished) return;

    if (this.phase === "intro") {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = "round";
        this.timer = this.roundS;
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
    const frac = Math.max(0, this.timer / this.roundS);
    this.seats.forEach((s, i) => {
      const bot = s.bot;
      if (!bot) return;
      if (!s.snapped) {
        stepBot(bot, s.handles, dt, this.ctx.rng);
        const match = matchPercent(paramsFromHandles(s.handles), this.target);
        if (botSnapCheck(bot, match, frac, dt, this.ctx.rng)) {
          this.snap(i);
          const taunt = match >= 80 ? "NAILED IT" : this.ctx.rng.pick(BOT_TAUNTS_SNAP);
          this.label(s, taunt, s.player.color, 18, -0.2);
        }
        return;
      }
      if (s.tomatoes <= 0) return;
      if (bot.throwIn < 0) {
        // Hands free: wind up a throw as soon as somebody is still sculpting (a short, human-looking delay).
        if (this.pickBotTarget(i) >= 0 && this.ctx.rng.next() < dt * 3) bot.throwIn = this.ctx.rng.float(0.15, 0.6);
        return;
      }
      bot.throwIn -= dt;
      if (bot.throwIn > 0) return;
      bot.throwIn = -1;
      const victim = this.pickBotTarget(i);
      if (victim >= 0) this.throwTomato(i, victim, this.ctx.rng.next() < 0.15);
    });

    if (this.allSnappedGrace >= 0) {
      this.allSnappedGrace -= dt;
      if (this.allSnappedGrace <= 0 && this.tomatoes.length === 0) this.endRound();
      return;
    }
    if (this.timer <= 0) this.endRound();
  }

  private pickBotTarget(thrower: number): number {
    const info = this.seats.map((s, index) => ({
      index, snapped: s.snapped || s.immune > 0 || index === thrower,
      threat: matchPercent(paramsFromHandles(s.handles), this.target) + s.total * 0.05,
    }));
    return botPickTarget(info);
  }

  private label(s: Seat, text: string, color: string, size = 22, yOff = -1.25): void {
    this.labels.push({ x: s.cx, y: s.cy + s.r * yOff, text, color, life: 1.1, maxLife: 1.1, size });
  }

  private snap(i: number): void {
    const s = this.seats[i]!;
    if (s.snapped || this.phase !== "round") return;
    for (const [pid, g] of this.grabs) if (g.seat === i) this.grabs.delete(pid);
    s.grabbed = s.grabbed.map(() => false);
    s.snapped = true;
    s.snapMatch = matchPercent(paramsFromHandles(s.handles), this.target);
    s.snapMult = flashMult(this.timer, this.roundS);
    s.snapPts = snapScore(s.snapMatch, this.timer, this.roundS, this.roundIndex);
    s.total += s.snapPts;
    s.bestShot = Math.max(s.bestShot, s.snapPts);
    s.photoTilt = this.ctx.rng.float(-0.06, 0.06);
    s.flash = 1;
    s.wobble = 1;
    this.juice.hitStop(0.05);
    this.juice.shake(0.12);
    this.juice.burst(s.cx, s.cy - s.r * 0.2, ["#ffffff", s.player.color, SKIN], {
      count: 14, speed: 240, gravity: 420, size: 5, life: 0.7,
    });
    this.ctx.sfx.whoosh();
    const tier = scoreTier(s.snapMatch);
    if (tier === "PERFECT") {
      this.callouts.show(`${s.player.name}: PERFECT MUG!`, s.player.color, { size: 60, life: 1.2, y: 0.58 });
      this.juice.shake(0.3);
      this.ctx.sfx.streak(5);
    } else if (tier === "SO CLOSE") {
      this.label(s, "SO CLOSE!", "#FFB020", 26, -0.95);
      this.ctx.sfx.streak(2);
    } else {
      this.ctx.sfx.collect();
    }
    if (this.seats.every((x) => x.snapped) && this.allSnappedGrace < 0) this.allSnappedGrace = ALL_SNAPPED_GRACE_S;
  }

  private throwTomato(thrower: number, victim: number, miss = false): void {
    const a = this.seats[thrower]!, b = this.seats[victim]!;
    if (a.tomatoes <= 0 || thrower === victim) return;
    a.tomatoes -= 1;
    if (a.bot) this.label(a, this.ctx.rng.pick(BOT_TAUNTS_THROW), a.player.color, 18, -0.2);
    const to = miss
      ? { x: b.cx + this.ctx.rng.sign() * b.r * 1.45, y: b.cy + this.ctx.rng.float(-0.4, 0.6) * b.r }
      : { x: b.cx + this.ctx.rng.float(-0.4, 0.4) * b.r, y: b.cy + this.ctx.rng.float(-0.5, 0.4) * b.r };
    this.tomatoes.push({ from: { x: a.cx, y: a.cy }, to, t: 0, thrower, victim, miss });
    this.ctx.sfx.whoosh();
  }

  private stepTomatoes(dt: number): void {
    for (let k = this.tomatoes.length - 1; k >= 0; k--) {
      const t = this.tomatoes[k]!;
      t.t += dt / TOMATO_FLIGHT_S;
      if (t.t < 1) continue;
      this.tomatoes.splice(k, 1);
      this.landTomato(t);
    }
  }

  private landTomato(t: Tomato): void {
    const a = this.seats[t.thrower]!, b = this.seats[t.victim]!;
    this.juice.burst(t.to.x, t.to.y, [TOMATO, TOMATO_DARK, "#ff8a7a"], {
      count: 16, speed: 220, gravity: 600, size: 5, life: 0.6,
    });
    this.ctx.sfx.hit();
    if (t.miss) {
      this.label(a, "MISSED!", "rgba(244,247,251,0.8)", 20, -0.2);
      this.juice.shake(0.08);
      return;
    }
    if (b.immune > 0 && !b.snapped) {
      // Still wiping off the last one: it slides off harmlessly.
      this.label(b, "BOUNCED", "rgba(244,247,251,0.8)", 20, -0.6);
      this.juice.shake(0.08);
      return;
    }
    // Yank a handle the victim is not holding on to.
    const free: number[] = [];
    b.handles.forEach((_, i) => { if (!b.grabbed[i]) free.push(i); });
    const idx = free.length ? this.ctx.rng.pick(free) : this.ctx.rng.int(0, b.handles.length - 1);
    b.splats.push({ handle: idx, life: 2.6, spin: this.ctx.rng.float(0, Math.PI * 2) });
    b.wobble = 1;
    this.juice.shake(0.22);
    this.juice.hitStop(0.04);
    if (this.phase === "round" && !b.snapped) {
      b.handles[idx] = knockHandle(b.handles[idx]!, this.ctx.rng);
      b.immune = IMMUNE_S;
      a.total += SPLAT_BONUS;
      a.hits += 1;
      this.label(b, "SPLAT!", TOMATO, 30, -0.6);
      this.label(a, `+${SPLAT_BONUS}`, "#B8FF3D", 24, -0.95);
    } else {
      this.label(b, "TOO LATE", "rgba(244,247,251,0.7)", 20, -0.6);
    }
  }

  private endRound(): void {
    this.grabs.clear();
    this.allSnappedGrace = -1;
    for (const s of this.seats) {
      if (!s.snapped) {
        this.timer = 0;
        this.snap(this.seats.indexOf(s));
        this.label(s, "BUZZER!", "#FF3D7A", 26, -0.95);
      }
      s.rounds.push(s.snapMatch);
    }
    let best: Seat | null = null;
    for (const s of this.seats) if (!best || s.snapPts > best.snapPts) best = s;
    this.juice.shake(0.2);
    if (best) {
      const tied = this.seats.filter((s) => s.snapPts === best!.snapPts);
      const text = tied.length === 1 ? `${best.player.name} +${best.snapPts}` : `TIE AT +${best.snapPts}`;
      this.callouts.show(text, tied.length === 1 ? best.player.color : "#F4F7FB", { size: 64, life: RESULT_S, y: 0.5 });
      this.ctx.sfx.collect();
    }
    if (this.roundIndex + 1 >= ROUNDS) {
      this.phase = "final";
      this.timer = RESULT_S + FINAL_S;
      const top = Math.max(...this.seats.map((s) => s.total));
      const leaders = this.seats.filter((s) => s.total === top);
      const text = leaders.map((s) => s.player.name).join(" & ") + " WINS!";
      this.callouts.show(text, leaders.length === 1 ? leaders[0]!.player.color : "#F4F7FB", {
        size: 76, life: RESULT_S + FINAL_S, y: 0.2,
      });
      for (const s of this.seats) {
        if (s.player.kind !== "human") continue;
        if (saveBest(ID, s.bestShot, BEST_KEY)) this.newRecord = true;
      }
      if (this.newRecord) {
        const shot = Math.max(...this.seats.filter((s) => s.player.kind === "human").map((s) => s.bestShot));
        this.callouts.show(`NEW RECORD SHOT ${shot}`, "#B8FF3D", { size: 44, life: RESULT_S + FINAL_S, y: 0.33 });
      }
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

  private buttonRect(s: Seat): { x: number; y: number; w: number; h: number } {
    const w = Math.min(s.w - 20, Math.max(s.w * 0.7, this.ctx.minTap * 2.4));
    return { x: s.cx - w / 2, y: this.btnY, w, h: this.btnH };
  }

  /** Tomato target chips for a snapped seat: one per opponent, laid out in the button slot. */
  private chips(s: Seat): { seat: number; x: number; y: number; r: number }[] {
    const others = this.seats.filter((o) => o !== s);
    const d = Math.max(this.ctx.minTap, 48);
    const gap = Math.min(16, (s.w - 20 - others.length * d) / Math.max(1, others.length + 1));
    const total = others.length * d + (others.length - 1) * gap;
    const y = this.btnY + this.btnH / 2;
    return others.map((o, k) => ({
      seat: this.seats.indexOf(o), x: s.cx - total / 2 + d / 2 + k * (d + gap), y, r: d / 2,
    }));
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (this.phase !== "round") return;
    const p = this.toLogical(e);
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (s.player.kind !== "human") continue;
      if (p.x < s.x || p.x >= s.x + s.w || p.y < s.y) continue;
      e.preventDefault();
      if (s.snapped) {
        if (s.tomatoes <= 0) return;
        for (const c of this.chips(s)) {
          if (Math.hypot(p.x - c.x, p.y - c.y) <= c.r * 1.15) {
            this.throwTomato(i, c.seat);
            return;
          }
        }
        return;
      }
      const b = this.buttonRect(s);
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y - 6 && p.y <= b.y + b.h + 6) {
        this.snap(i);
        this.label(s, scoreTier(s.snapMatch), "#F4F7FB", 20, -0.2);
        return;
      }
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
    if (s.snapped) return;
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
    this.drawTomatoes(g);
    this.juice.drawParticles(g);
    this.drawLabels(g);
    this.juice.end(g);
    if (this.phase === "round") drawTimerBar(g, width, Math.max(0, this.timer), this.roundS);
    if (this.phase === "intro") {
      const final = this.roundIndex >= ROUNDS - 1;
      g.save();
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 10;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      g.font = `700 72px ${FONT}`;
      const text = final ? "FINAL ROUND" : `ROUND ${this.roundIndex + 1}`;
      g.strokeText(text, width / 2, height * 0.5);
      g.fillStyle = final ? "#FF3D7A" : "#F4F7FB";
      g.fillText(text, width / 2, height * 0.5);
      g.font = `700 40px ${FONT}`;
      const sub = final ? `DOUBLE POINTS · ${this.roundS} SECONDS` : `${roundName(this.roundIndex)} · ${this.roundS} SECONDS`;
      g.lineWidth = 8;
      g.strokeText(sub, width / 2, height * 0.5 + 58);
      g.fillStyle = "#FFB020";
      g.fillText(sub, width / 2, height * 0.5 + 58);
      g.restore();
    }
    this.callouts.draw(g, width, height);
  }

  private drawLabels(g: CanvasRenderingContext2D): void {
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const l of this.labels) {
      const t = 1 - l.life / l.maxLife;
      const pop = t < 0.15 ? 0.7 + (t / 0.15) * 0.4 : 1.1 - (t - 0.15) * 0.1;
      g.globalAlpha = Math.min(1, l.life / (l.maxLife * 0.35));
      g.font = `700 ${l.size * pop}px ${FONT}`;
      g.lineWidth = 5;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      g.strokeText(l.text, l.x, l.y);
      g.fillStyle = l.color;
      g.fillText(l.text, l.x, l.y);
    }
    g.restore();
  }

  private drawTomato(g: CanvasRenderingContext2D, x: number, y: number, r: number, alpha = 1): void {
    g.save();
    g.globalAlpha = alpha;
    g.translate(x, y);
    g.fillStyle = TOMATO;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.28)";
    g.beginPath();
    g.arc(-r * 0.3, -r * 0.3, r * 0.3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = LEAF;
    for (let k = 0; k < 4; k++) {
      const a = -Math.PI / 2 + (k - 1.5) * 0.6;
      g.beginPath();
      g.ellipse(Math.cos(a) * r * 0.35, -r * 0.75 + Math.sin(a) * r * 0.2, r * 0.32, r * 0.14, a, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  private drawTomatoes(g: CanvasRenderingContext2D): void {
    for (const t of this.tomatoes) {
      const u = Math.min(1, t.t);
      const x = t.from.x + (t.to.x - t.from.x) * u;
      const arc = Math.sin(u * Math.PI);
      const y = t.from.y + (t.to.y - t.from.y) * u - arc * 140;
      const r = 14 + arc * 10;
      g.save();
      g.globalAlpha = 0.25;
      g.fillStyle = "#000";
      g.beginPath();
      g.ellipse(x, t.from.y + (t.to.y - t.from.y) * u + 10, r, r * 0.4, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
      this.drawTomato(g, x, y, r);
    }
  }

  private drawTargetPanel(g: CanvasRenderingContext2D): void {
    const { width } = this.ctx;
    const final = this.roundIndex >= ROUNDS - 1;
    const pw = Math.min(width * 0.64, 820);
    const px = width / 2 - pw / 2;
    const py = 30;
    const ph = this.panelH - 34;
    const accent = final ? "#FF3D7A" : "#FFB020";
    g.save();
    g.fillStyle = "rgba(7,11,20,0.55)";
    g.strokeStyle = accent;
    g.lineWidth = final ? 3 + Math.sin(this.time * 8) * 1.5 : 3;
    g.beginPath();
    g.roundRect(px, py, pw, ph, 18);
    g.fill();
    g.stroke();
    g.textBaseline = "top";
    // Left block: what to do, which round, and the record to beat. The centre stays clear for the mug.
    g.textAlign = "left";
    g.font = `700 24px ${FONT}`;
    g.fillStyle = accent;
    g.fillText("MATCH THIS MUG", px + 18, py + 10);
    g.font = `700 30px ${FONT}`;
    g.fillStyle = "#F4F7FB";
    g.fillText(`ROUND ${Math.min(ROUNDS, this.roundIndex + 1)}/${ROUNDS}`, px + 18, py + 38);
    g.font = `700 24px ${FONT}`;
    g.fillStyle = final ? accent : "rgba(244,247,251,0.75)";
    g.fillText(final ? "FINAL · DOUBLE POINTS" : roundName(this.roundIndex), px + 18, py + 74);
    if (this.best > 0 && this.seats.some((s) => s.player.kind === "human")) {
      g.font = `700 18px ${FONT}`;
      g.fillStyle = "rgba(244,247,251,0.5)";
      g.fillText(`BEST SHOT ${this.best}`, px + 18, py + 104);
    }
    // Right block: the live flash bonus and its drain bar.
    const mult = this.phase === "round" ? flashMult(this.timer, this.roundS) : this.phase === "intro" ? 2 : 1;
    const frac = mult - 1;
    g.textAlign = "right";
    g.font = `700 22px ${FONT}`;
    g.fillStyle = "rgba(244,247,251,0.6)";
    g.fillText("FLASH BONUS", px + pw - 18, py + 12);
    g.font = `700 ${44 + frac * 10}px ${FONT}`;
    g.fillStyle = frac > 0.5 ? "#B8FF3D" : frac > 0.2 ? "#FFB020" : "#FF3D7A";
    g.fillText(`x${mult.toFixed(2)}`, px + pw - 18, py + 32);
    const barW = 150, barX = px + pw - 18 - barW, barY = py + 92;
    g.fillStyle = "rgba(244,247,251,0.15)";
    g.beginPath();
    g.roundRect(barX, barY, barW, 10, 5);
    g.fill();
    g.fillStyle = frac > 0.5 ? "#B8FF3D" : frac > 0.2 ? "#FFB020" : "#FF3D7A";
    g.beginPath();
    g.roundRect(barX, barY, Math.max(4, barW * frac), 10, 5);
    g.fill();
    g.font = `700 16px ${FONT}`;
    g.fillStyle = "rgba(244,247,251,0.5)";
    g.fillText("SNAP EARLY FOR MORE", px + pw - 18, py + 108);
    g.restore();
    const wob = 1 + Math.sin(this.time * 6) * 0.02;
    // Absurd targets bulge a long way; keep the mug inside its panel.
    g.save();
    g.beginPath();
    g.roundRect(px + 2, py + 2, pw - 4, ph - 4, 16);
    g.clip();
    this.drawFace(g, width / 2, py + ph * 0.58, this.targetR * wob, this.targetSkin.pos, accent, null, null);
    g.restore();
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

    g.restore();

    const sculpting = (this.phase === "round" || this.phase === "intro") && !s.snapped;
    if (sculpting && s.underdog) this.drawGuide(g, s);
    const squash = 1 + Math.sin(s.wobble * Math.PI * 3) * s.wobble * 0.06;
    this.drawFace(g, s.cx, s.cy, s.r, s.skin.pos, s.player.color, sculpting ? s : null, sculpting ? s.handles : null, squash);
    this.drawSplats(g, s);

    if (s.snapped) this.drawPhotoFrame(g, s);

    // Header on top of the face so the score stays readable when a mug bulges upward.
    g.save();
    g.textAlign = "center";
    g.textBaseline = "top";
    g.lineWidth = 5;
    g.strokeStyle = "rgba(7,11,20,0.75)";
    g.font = `700 30px ${FONT}`;
    g.strokeText(s.player.name, s.cx, s.y + 6);
    g.fillStyle = s.player.color;
    g.fillText(s.player.name, s.cx, s.y + 6);
    g.font = `700 22px ${FONT}`;
    g.strokeText(`${s.total} pts`, s.cx, s.y + 38);
    g.fillStyle = "rgba(244,247,251,0.85)";
    g.fillText(`${s.total} pts`, s.cx, s.y + 38);
    // Round pips.
    for (let k = 0; k < ROUNDS; k++) {
      const x = s.cx + (k - (ROUNDS - 1) / 2) * 26;
      g.beginPath();
      g.arc(x, s.y + 72, 6, 0, Math.PI * 2);
      g.fillStyle = k < s.rounds.length ? s.player.color : "rgba(244,247,251,0.15)";
      g.fill();
    }
    if (s.underdog) {
      g.font = `700 16px ${FONT}`;
      g.textAlign = "right";
      g.fillStyle = "rgba(244,247,251,0.75)";
      g.fillText("UNDERDOG GUIDE", s.x + s.w - 10, s.y + 8);
    }
    g.restore();

    if (this.phase === "round") {
      if (!s.snapped) this.drawSnapButton(g, s);
      else this.drawTomatoChips(g, s);
    } else if (this.phase === "result" || this.phase === "final") {
      g.save();
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 8;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      const y = this.btnY + this.btnH / 2;
      const color = s.snapMatch >= 80 ? "#B8FF3D" : s.snapMatch >= 50 ? "#FFB020" : "#FF3D7A";
      g.font = `700 ${Math.min(64, s.w * 0.22)}px ${FONT}`;
      g.strokeText(`+${s.snapPts}`, s.cx, y);
      g.fillStyle = color;
      g.fillText(`+${s.snapPts}`, s.cx, y);
      g.restore();
    }

    if (s.flash > 0) {
      g.save();
      g.globalAlpha = s.flash * 0.85;
      g.fillStyle = "#ffffff";
      g.fillRect(s.x, s.y, s.w, s.h);
      g.restore();
    }
  }

  /** Faint target handle markers on the underdog's mug: where the eyes, brows, mouth corners and nose should go. */
  private drawGuide(g: CanvasRenderingContext2D, s: Seat): void {
    const t = this.targetHandles;
    const P = (k: number): Pt => ({ x: s.cx + t[k]!.x * s.r, y: s.cy + t[k]!.y * s.r });
    g.save();
    g.globalAlpha = 0.55 + Math.sin(this.time * 5) * 0.15;
    g.strokeStyle = "#ffffff";
    g.lineWidth = 2;
    g.setLineDash([6, 6]);
    g.beginPath();
    const lb = P(LEFT_BROW), rb = P(RIGHT_BROW), lm = P(LEFT_MOUTH), rm = P(RIGHT_MOUTH);
    g.moveTo(lb.x, lb.y); g.lineTo(rb.x, rb.y);
    g.moveTo(lm.x, lm.y); g.lineTo(rm.x, rm.y);
    g.stroke();
    g.setLineDash([]);
    const kr = this.knobRadius(s) * 1.25;
    for (let k = 0; k < t.length; k++) {
      const p = P(k);
      g.beginPath();
      g.arc(p.x, p.y, kr, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  private drawSplats(g: CanvasRenderingContext2D, s: Seat): void {
    if (s.immune > 0 && !s.snapped) {
      g.save();
      g.globalAlpha = 0.35 + Math.sin(this.time * 10) * 0.15;
      g.strokeStyle = TOMATO;
      g.lineWidth = 3;
      g.setLineDash([8, 8]);
      g.beginPath();
      g.arc(s.cx, s.cy, s.r * 1.22, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
    for (const sp of s.splats) {
      const h = s.skin.pos[sp.handle]!;
      const x = s.cx + h.x * s.r, y = s.cy + h.y * s.r;
      const a = Math.min(1, sp.life / 1.2);
      const R = s.r * 0.26 * (1 + (1 - Math.min(1, (2.6 - sp.life) / 0.15)) * 0.4);
      g.save();
      g.globalAlpha = a * 0.9;
      g.translate(x, y);
      g.rotate(sp.spin);
      g.fillStyle = TOMATO;
      g.beginPath();
      for (let k = 0; k <= 12; k++) {
        const ang = (k / 12) * Math.PI * 2;
        const rr = R * (0.75 + ((k * 7) % 5) * 0.1);
        g.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
      }
      g.closePath();
      g.fill();
      g.fillStyle = TOMATO_DARK;
      g.beginPath();
      g.arc(0, 0, R * 0.4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#f7e2a0";
      for (let k = 0; k < 4; k++) {
        const ang = sp.spin + k * 1.6;
        g.beginPath();
        g.ellipse(Math.cos(ang) * R * 0.55, Math.sin(ang) * R * 0.55, R * 0.1, R * 0.06, ang, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
  }

  /** The snapped mug sits in a tilted white print with its score on the tag; the print stays inside the face band. */
  private drawPhotoFrame(g: CanvasRenderingContext2D, s: Seat): void {
    const bandTop = s.y + 82;
    const fw = Math.min(s.r * 2.7, s.w - 28);
    const fh = Math.min(s.r * 2.6, (s.cy - bandTop) * 2 - 12);
    const tag = Math.max(30, s.r * 0.3);
    g.save();
    g.translate(s.cx, s.cy);
    g.rotate(s.photoTilt);
    g.strokeStyle = "#ffffff";
    g.lineWidth = 7;
    g.strokeRect(-fw / 2, -fh / 2, fw, fh);
    g.fillStyle = "#ffffff";
    g.fillRect(-fw / 2, fh / 2 - tag, fw, tag);
    g.fillStyle = "#1b1f2a";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `700 ${Math.max(20, s.r * 0.22)}px ${FONT}`;
    g.fillText(`${s.snapMatch}% × ${s.snapMult.toFixed(2)} = ${s.snapPts}`, 0, fh / 2 - tag / 2 + 1);
    g.restore();
  }

  private drawSnapButton(g: CanvasRenderingContext2D, s: Seat): void {
    const b = this.buttonRect(s);
    const mult = flashMult(this.timer, this.roundS);
    const frac = mult - 1;
    const human = s.player.kind === "human";
    const pulse = human ? 1 + Math.sin(this.time * 7) * 0.02 : 1;
    g.save();
    g.translate(b.x + b.w / 2, b.y + b.h / 2);
    g.scale(pulse, pulse);
    g.globalAlpha = human ? 1 : 0.45;
    g.fillStyle = frac > 0.5 ? "#B8FF3D" : frac > 0.2 ? "#FFB020" : "#FF3D7A";
    g.beginPath();
    g.roundRect(-b.w / 2, -b.h / 2, b.w, b.h, 14);
    g.fill();
    g.strokeStyle = "rgba(7,11,20,0.7)";
    g.lineWidth = 3;
    g.stroke();
    // Camera glyph.
    g.fillStyle = "#101828";
    const cxg = -b.w / 2 + 30;
    g.beginPath();
    g.roundRect(cxg - 16, -11, 32, 22, 4);
    g.fill();
    g.fillStyle = frac > 0.5 ? "#B8FF3D" : frac > 0.2 ? "#FFB020" : "#FF3D7A";
    g.beginPath();
    g.arc(cxg, 0, 6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#101828";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `700 ${Math.min(34, b.h * 0.6)}px ${FONT}`;
    g.fillText(`SNAP ×${mult.toFixed(1)}`, 14, 1);
    g.restore();
    if (human) {
      g.save();
      g.font = `700 18px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "bottom";
      g.fillStyle = "rgba(244,247,251,0.45)";
      g.fillText("DRAG THE DOTS · SNAP WHEN IT LOOKS RIGHT", s.cx, b.y - 6);
      g.restore();
    }
  }

  private drawTomatoChips(g: CanvasRenderingContext2D, s: Seat): void {
    const human = s.player.kind === "human";
    g.save();
    g.textAlign = "center";
    g.textBaseline = "bottom";
    g.font = `700 18px ${FONT}`;
    g.fillStyle = "rgba(244,247,251,0.6)";
    const chips = this.chips(s);
    const open = (c: { seat: number }): boolean => { const o = this.seats[c.seat]!; return !o.snapped && o.immune <= 0; };
    const anyOpen = chips.some(open);
    if (s.tomatoes <= 0) {
      g.fillText("TOMATO THROWN", s.cx, this.btnY + this.btnH / 2 + 8);
      g.restore();
      return;
    }
    if (!anyOpen) {
      g.fillText("EVERYONE'S SNAPPED", s.cx, this.btnY + this.btnH / 2 + 8);
      g.restore();
      return;
    }
    g.fillText(human ? "TAP A FACE TO SPLAT IT" : "HOLDING A TOMATO", s.cx, this.btnY - 4);
    const first = chips[0];
    if (first) this.drawTomato(g, first.x - first.r - 24, first.y, 12, human ? 1 : 0.5);
    for (const c of chips) {
      const o = this.seats[c.seat]!;
      g.globalAlpha = (human ? 1 : 0.5) * (open(c) ? 1 : 0.35);
      g.fillStyle = o.player.color;
      g.beginPath();
      g.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(7,11,20,0.7)";
      g.lineWidth = 3;
      g.stroke();
      g.fillStyle = "#070b14";
      g.textBaseline = "middle";
      g.font = `700 ${Math.max(16, c.r * 0.9)}px ${FONT}`;
      g.fillText(o.player.name[0] ?? "?", c.x, c.y + 1);
    }
    g.restore();
  }

  /** Draws a mug from skin (lagging) positions; knobs at the real handle positions when given. */
  private drawFace(
    g: CanvasRenderingContext2D, cx: number, cy: number, R: number, skin: Pt[], outline: string,
    seat: Seat | null, handles: Handles | null, squash = 1,
  ): void {
    g.save();
    g.translate(cx, cy);
    g.scale(R * (2 - squash), R * squash);
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
      out.push({ playerId: s.player.id, label: "Best shot", value: `${s.bestShot}` });
      out.push({ playerId: s.player.id, label: "Splats", value: `${s.hits}` });
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

import { fillArena, drawTimerBar } from "../../core/draw";
import { Rng } from "../../core/rng";
import { Callouts, Juice } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  CARD_S,
  FINAL_S,
  INTRO_S,
  MICROGAMES_PER_MATCH,
  RESULT_S,
  isSpeedUp,
  limitFor,
  makeMicrogame,
  planBot,
  planOrder,
  scoreOutcomes,
  tierOf,
  type MicroKind,
  type Microgame,
  type Sparks,
  type Zone,
} from "./logic";

export const microMayhem: GameDefinition = {
  id: "micro-mayhem",
  name: "Micro Mayhem",
  tagline: "15 tiny games. 4 seconds each. Go!",
  description:
    "A rapid-fire gauntlet of 4-second microgames. Everyone plays the same one at the same time in their own " +
    "lane: POP the rising balloon, SWAT the fly, CATCH the egg, DODGE the arrow, MATCH the odd colour, HOLD " +
    "until the green band, SHAKE the tree, STOP the needle on target. 1 point per success, +1 for the fastest. " +
    "Every 5 games it gets FASTER. Most points after 15 wins.",
  durationMs: 0,
  controls: "Tap, drag, swipe, hold or mash in your lane. Read the one-word card!",
  create: (ctx) => new MicroMayhem(ctx),
};

const FONT = "Bebas Neue, Impact, sans-serif";
/** Once everyone is done, cut to the result after this long. */
const EARLY_CUT_S = 0.35;

type Phase = "intro" | "card" | "play" | "result" | "final";

interface Seat {
  player: Player;
  zone: Zone;
  score: number;
  successes: number;
  fastestMs: number | null;
  mg: Microgame;
  /** Result of the microgame just played, for the result beat. */
  lastSuccess: boolean | null;
  lastBonus: boolean;
  /** Set when the microgame outcome was already reacted to (sfx). */
  reacted: boolean;
}

class MicroMayhem implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly order: MicroKind[];
  private readonly sparks: Sparks;
  private phase: Phase = "intro";
  private timer = INTRO_S;
  private index = 0;
  private playT = 0;
  private limit = 4;
  private finished = false;
  private flash = 0;
  private readonly pointerSeat = new Map<number, number>();

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    this.sparks = {
      burst: (x, y, colors, big) => {
        this.juice.burst(x, y, colors, { count: big ? 26 : 12, speed: big ? 320 : 200, gravity: 400, life: 0.5, size: 5 });
        if (big) this.juice.shake(0.12);
      },
    };
    this.order = planOrder(ctx.rng);
    const w = ctx.width / ctx.players.length;
    this.seats = ctx.players.map((player, i) => ({
      player,
      zone: { x: i * w, y: 0, w, h: ctx.height },
      score: 0,
      successes: 0,
      fastestMs: null,
      mg: makeMicrogame(this.order[0]!),
      lastSuccess: null,
      lastBonus: false,
      reacted: false,
    }));
    this.prepare();
    this.callouts.show("GET READY", "#F4F7FB", { size: 80, life: INTRO_S, y: 0.4 });
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
  }

  /** Build this round's microgame in every lane (same seed so every lane sees the same layout). */
  private prepare(): void {
    const kind = this.order[this.index]!;
    const seed = this.ctx.rng.int(1, 2_147_483_646);
    const tier = tierOf(this.index);
    this.limit = limitFor(this.index);
    for (const s of this.seats) {
      s.mg = makeMicrogame(kind);
      s.mg.reset(s.zone, new Rng(seed), { limit: this.limit, minTap: this.ctx.minTap }, this.sparks);
      if (s.player.kind === "bot") s.mg.setBot(planBot(this.ctx.rng, tier));
      s.lastSuccess = null;
      s.lastBonus = false;
      s.reacted = false;
    }
    this.pointerSeat.clear();
  }

  private startCard(): void {
    this.phase = "card";
    this.timer = CARD_S;
    this.prepare();
    const mg = this.seats[0]!.mg;
    this.callouts.show(mg.label, "#FFB020", { size: 170, life: CARD_S, y: 0.42 });
    if (isSpeedUp(this.index)) {
      this.callouts.show("FASTER!", "#FF3D7A", { size: 70, life: CARD_S, y: 0.68 });
      this.juice.shake(0.3);
      this.ctx.sfx.streak(3);
    } else {
      this.ctx.sfx.countdown();
    }
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.flash = Math.max(0, this.flash - realDt * 4);
    if (this.finished) return;

    if (this.phase === "intro") {
      this.timer -= dt;
      if (this.timer <= 0) this.startCard();
      return;
    }
    if (this.phase === "card") {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = "play";
        this.playT = 0;
        this.flash = 0.6;
        this.ctx.sfx.go();
      }
      return;
    }
    if (this.phase === "play") {
      this.playT += dt;
      let allDone = true;
      let doneFor = Infinity;
      for (const s of this.seats) {
        s.mg.update(dt);
        if (s.mg.done && !s.reacted) {
          s.reacted = true;
          if (s.mg.success) this.ctx.sfx.collect();
          else this.ctx.sfx.miss();
        }
        if (!s.mg.done) allDone = false;
        else doneFor = Math.min(doneFor, s.mg.t - (s.mg.successAt ?? s.mg.t));
      }
      const timeUp = this.playT >= this.limit;
      if (timeUp || (allDone && doneFor >= EARLY_CUT_S)) this.endMicrogame();
      return;
    }
    if (this.phase === "result" || this.phase === "final") {
      this.timer -= dt;
      if (this.timer > 0) return;
      if (this.phase === "final") {
        this.finished = true;
        return;
      }
      this.index += 1;
      if (this.index >= MICROGAMES_PER_MATCH) this.endMatch();
      else this.startCard();
    }
  }

  private endMicrogame(): void {
    this.phase = "result";
    this.timer = RESULT_S;
    const outcomes = this.seats.map((s) => ({ success: s.mg.success, at: s.mg.successAt }));
    const { points, fastest } = scoreOutcomes(outcomes);
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      const p = points[i]!;
      s.score += p;
      s.lastSuccess = s.mg.success;
      s.lastBonus = fastest === i;
      if (s.mg.success) {
        s.successes += 1;
        const ms = Math.round((s.mg.successAt ?? 0) * 1000);
        if (s.fastestMs === null || ms < s.fastestMs) s.fastestMs = ms;
      }
      // Lock any lane still in play so late input does nothing.
      s.mg.lock();
    }
    if (fastest !== null) {
      const s = this.seats[fastest]!;
      this.callouts.show(`${s.player.name} FASTEST +1`, s.player.color, { size: 52, life: RESULT_S, y: 0.14 });
      this.juice.shake(0.15);
      this.ctx.sfx.hit();
    } else {
      this.callouts.show("NOBODY!", "#FF3D7A", { size: 64, life: RESULT_S, y: 0.14 });
    }
  }

  private endMatch(): void {
    this.phase = "final";
    this.timer = FINAL_S;
    const top = Math.max(...this.seats.map((s) => s.score));
    const leaders = this.seats.filter((s) => s.score === top);
    const text = top === 0 ? "NO WINNER" : leaders.map((s) => s.player.name).join(" & ") + " WINS!";
    const color = leaders.length === 1 && top > 0 ? leaders[0]!.player.color : "#F4F7FB";
    this.callouts.show(text, color, { size: 80, life: FINAL_S, y: 0.3 });
    this.juice.shake(0.4);
    this.ctx.sfx.win();
  }

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (this.phase !== "play") return;
    const p = this.toLogical(e);
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (s.player.kind !== "human") continue;
      if (p.x >= s.zone.x && p.x < s.zone.x + s.zone.w) {
        e.preventDefault();
        this.pointerSeat.set(e.pointerId, i);
        s.mg.handle({ type: "down", x: p.x, y: p.y, id: e.pointerId });
        return;
      }
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    const i = this.pointerSeat.get(e.pointerId);
    if (i === undefined || this.phase !== "play") return;
    const p = this.toLogical(e);
    this.seats[i]!.mg.handle({ type: "move", x: p.x, y: p.y, id: e.pointerId });
  };

  private readonly onUp = (e: PointerEvent): void => {
    const i = this.pointerSeat.get(e.pointerId);
    if (i === undefined) return;
    this.pointerSeat.delete(e.pointerId);
    if (this.phase !== "play") return;
    const p = this.toLogical(e);
    this.seats[i]!.mg.handle({ type: "up", x: p.x, y: p.y, id: e.pointerId });
  };

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);
    for (const s of this.seats) this.drawSeat(g, s);
    this.juice.end(g);
    if (this.phase === "play") drawTimerBar(g, width, Math.max(0, this.limit - this.playT), this.limit);
    if (this.flash > 0) {
      g.fillStyle = `rgba(255,235,180,${this.flash * 0.25})`;
      g.fillRect(0, 0, width, height);
    }
    this.drawProgress(g);
    this.callouts.draw(g, width, height);
  }

  private drawSeat(g: CanvasRenderingContext2D, s: Seat): void {
    const { x, w, h } = s.zone;
    const cx = x + w / 2;
    g.save();
    g.globalAlpha = 0.09;
    g.fillStyle = s.player.color;
    g.fillRect(x, 0, w, h);
    g.globalAlpha = 1;
    g.strokeStyle = "rgba(244,247,251,0.12)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x + w, 0);
    g.lineTo(x + w, h);
    g.stroke();

    g.textAlign = "center";
    g.textBaseline = "top";
    g.fillStyle = s.player.color;
    g.font = `700 ${Math.min(30, w * 0.1)}px ${FONT}`;
    g.fillText(s.player.name, cx, 34);
    g.fillStyle = "#F4F7FB";
    g.font = `700 34px ${FONT}`;
    g.fillText(String(s.score), cx, 58);
    g.restore();

    if (this.phase !== "intro") s.mg.render(g, s.zone);

    const showMark = this.phase === "result" || this.phase === "final" || (this.phase === "play" && s.mg.done);
    if (showMark && this.phase !== "final") {
      const ok = this.phase === "result" ? s.lastSuccess === true : s.mg.success;
      g.save();
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `700 ${Math.min(90, w * 0.3)}px ${FONT}`;
      g.lineWidth = 8;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      const text = ok ? (s.lastBonus ? "+2" : "GOT IT") : "MISS";
      g.strokeText(text, cx, h * 0.5);
      g.fillStyle = ok ? "#B8FF3D" : "#FF3D7A";
      g.fillText(text, cx, h * 0.5);
      g.restore();
    }
    if (this.phase === "play" && s.player.kind === "human" && !s.mg.done) {
      g.save();
      g.fillStyle = "rgba(244,247,251,0.25)";
      g.font = `700 20px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "bottom";
      g.fillText("YOUR LANE", cx, h - 40);
      g.restore();
    }
  }

  private drawProgress(g: CanvasRenderingContext2D): void {
    g.save();
    g.fillStyle = "rgba(244,247,251,0.6)";
    g.font = `700 22px ${FONT}`;
    g.textAlign = "left";
    g.textBaseline = "top";
    const n = Math.min(MICROGAMES_PER_MATCH, this.index + 1);
    g.fillText(`${n} / ${MICROGAMES_PER_MATCH}`, 12, 32);
    g.restore();
  }

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({ playerId: s.player.id, score: s.score }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const s of this.seats) {
      out.push({ playerId: s.player.id, label: "Fastest win", value: s.fastestMs === null ? "-" : `${s.fastestMs} ms` });
      out.push({ playerId: s.player.id, label: "Cleared", value: `${s.successes} / ${MICROGAMES_PER_MATCH}` });
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

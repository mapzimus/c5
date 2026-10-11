import { fillArena, drawTimerBar } from "../../core/draw";
import { Rng } from "../../core/rng";
import { Callouts, Juice, loadBest, saveBest } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  CARD_S,
  FINAL_S,
  HEAT_MAX,
  INTRO_S,
  JINX_KINDS,
  JINX_LABEL,
  MICROGAMES_PER_MATCH,
  OVERDRIVE_FROM,
  RESULT_S,
  botWagerChance,
  heatFor,
  isOverdrive,
  isSpeedUp,
  isUnderdog,
  limitFor,
  makeMicrogame,
  pickJinxTarget,
  planBot,
  planOrder,
  scoreRound,
  tierOf,
  type JinxKind,
  type MicroKind,
  type Microgame,
  type Sparks,
  type Zone,
} from "./logic";

export const microMayhem: GameDefinition = {
  id: "micro-mayhem",
  name: "Micro Mayhem",
  tagline: "15 tiny games. Double down. Jinx the leader.",
  description:
    "A rapid-fire gauntlet of 3-second microgames, everyone at once in their own lane: POP, SWAT, CATCH, DODGE, " +
    "MATCH, HOLD, SHAKE, STOP. Wins build HEAT (x1, x2, x3). Tap your lane on the card to DOUBLE the stakes " +
    "(fail and you pay). The fastest win JINXES the leader: their next lane is flipped, spinning, tiny or fogged. " +
    "Last place doubles for free. The final 5 are OVERDRIVE: everything counts double.",
  durationMs: 0,
  controls: "Tap your lane during the card to DOUBLE. Then tap, drag, swipe, hold or mash. Read the one-word card!",
  create: (ctx) => new MicroMayhem(ctx),
};

const FONT = "Bebas Neue, Impact, sans-serif";
/** Once everyone is done, cut to the result after this long. */
const EARLY_CUT_S = 0.35;
const BEST_ID = "micro-mayhem";
const BEST_VERSION = "v2-heat";
const GOLD = "#FFB020";
const LIME = "#B8FF3D";
const PINK = "#FF3D7A";
const PURPLE = "#C77DFF";
const INK = "#F4F7FB";
const TAUNTS = ["TOO SLOW!", "EASY.", "CATCH ME!", "ZOOM!", "NEXT?"] as const;

type Phase = "intro" | "card" | "play" | "result" | "final";

interface LaneNote {
  text: string;
  color: string;
  life: number;
  maxLife: number;
  y: number;
  size: number;
}

interface Seat {
  player: Player;
  zone: Zone;
  score: number;
  successes: number;
  streak: number;
  bestStreak: number;
  fastestMs: number | null;
  mg: Microgame;
  /** DOUBLE armed for the microgame about to be played. */
  wagered: boolean;
  underdog: boolean;
  /** Jinx cast on this seat, applied when the next microgame is prepared. */
  pendingJinx: JinxKind | null;
  /** Jinx in force for the current microgame. */
  jinx: JinxKind | null;
  /** Result of the microgame just played, for the result beat. */
  lastDelta: number;
  lastSuccess: boolean | null;
  lastNearMiss: boolean;
  lastBonus: boolean;
  /** Set when the microgame outcome was already reacted to (sfx). */
  reacted: boolean;
  /** Bots decide DOUBLE a beat into the card, so the lane visibly "thinks". */
  botWagerAt: number | null;
  notes: LaneNote[];
  newRecord: boolean;
}

/** The hex flying from the jinxer's lane to the victim's during the result beat. */
interface Hex {
  fromX: number;
  toX: number;
  y: number;
  t: number;
  life: number;
  kind: JinxKind;
  target: number;
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
  private flashColor = "255,235,180";
  private hex: Hex | null = null;
  private clock = 0;
  private readonly best = loadBest(BEST_ID, BEST_VERSION);
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
      streak: 0,
      bestStreak: 0,
      fastestMs: null,
      mg: makeMicrogame(this.order[0]!),
      wagered: false,
      underdog: false,
      pendingJinx: null,
      jinx: null,
      lastDelta: 0,
      lastSuccess: null,
      lastNearMiss: false,
      lastBonus: false,
      reacted: false,
      botWagerAt: null,
      notes: [],
      newRecord: false,
    }));
    this.prepare();
    this.callouts.show("GET READY", INK, { size: 80, life: INTRO_S, y: 0.4 });
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
  }

  private get overdrive(): boolean {
    return isOverdrive(this.index);
  }

  /** Build this round's microgame in every lane (same seed so every lane sees the same layout). */
  private prepare(): void {
    const kind = this.order[this.index]!;
    const seed = this.ctx.rng.int(1, 2_147_483_646);
    const tier = tierOf(this.index);
    this.limit = limitFor(this.index);
    const scores = this.seats.map((s) => s.score);
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      s.mg = makeMicrogame(kind);
      s.mg.reset(s.zone, new Rng(seed), { limit: this.limit, minTap: this.ctx.minTap }, this.sparks);
      s.jinx = s.pendingJinx;
      s.pendingJinx = null;
      s.mg.jinx = s.jinx;
      s.underdog = isUnderdog(scores, i);
      s.wagered = false;
      s.lastSuccess = null;
      s.lastNearMiss = false;
      s.lastBonus = false;
      s.lastDelta = 0;
      s.reacted = false;
      s.botWagerAt = null;
      if (s.player.kind === "bot") {
        s.mg.setBot(planBot(this.ctx.rng, tier, s.jinx !== null));
        const deficit = Math.max(...scores) - s.score;
        const chance = botWagerChance({ deficit, heat: heatFor(s.streak), underdog: s.underdog, overdrive: this.overdrive });
        if (this.ctx.rng.next() < chance) s.botWagerAt = this.ctx.rng.float(0.15, CARD_S - 0.25);
      }
    }
    this.pointerSeat.clear();
  }

  private startCard(): void {
    this.phase = "card";
    this.timer = CARD_S;
    this.prepare();
    const mg = this.seats[0]!.mg;
    this.callouts.show(mg.label, GOLD, { size: 170, life: CARD_S, y: 0.42 });
    if (this.index === OVERDRIVE_FROM) {
      this.callouts.show("OVERDRIVE! DOUBLE POINTS", PINK, { size: 64, life: CARD_S + 0.6, y: 0.68 });
      this.juice.shake(0.45);
      this.flash = 0.9;
      this.flashColor = "255,61,122";
      this.ctx.sfx.streak(5);
    } else if (isSpeedUp(this.index)) {
      this.callouts.show("FASTER!", PINK, { size: 70, life: CARD_S, y: 0.68 });
      this.juice.shake(0.3);
      this.ctx.sfx.streak(3);
    } else {
      this.ctx.sfx.countdown();
    }
    for (const s of this.seats) {
      if (s.jinx) {
        this.note(s, `JINXED: ${JINX_LABEL[s.jinx]}`, PURPLE, 0.21, CARD_S + 0.4);
        this.juice.burst(s.zone.x + s.zone.w / 2, s.zone.h * 0.3, [PURPLE, "#ffffff"], { count: 20, speed: 260, life: 0.6, size: 5, gravity: 200 });
      }
    }
  }

  private note(s: Seat, text: string, color: string, y: number, life = 0.9, size = 0): void {
    const sz = size || Math.round(Math.min(44, s.zone.w * 0.16));
    s.notes.push({ text, color, life, maxLife: life, y, size: sz });
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    this.clock += realDt;
    const dt = this.juice.update(realDt);
    this.flash = Math.max(0, this.flash - realDt * 4);
    for (const s of this.seats) {
      for (const n of s.notes) n.life -= realDt;
      s.notes = s.notes.filter((n) => n.life > 0);
    }
    if (this.hex) {
      this.hex.t += realDt;
      if (this.hex.t >= this.hex.life) {
        const target = this.seats[this.hex.target]!;
        this.juice.burst(this.hex.toX, this.hex.y, [PURPLE, "#ffffff", PINK], { count: 30, speed: 300, life: 0.6, size: 6, gravity: 300 });
        this.juice.shake(0.2);
        this.ctx.sfx.whoosh();
        target.pendingJinx = this.hex.kind;
        this.hex = null;
      } else {
        const x = this.hex.fromX + (this.hex.toX - this.hex.fromX) * (this.hex.t / this.hex.life);
        this.juice.burst(x, this.hex.y, [PURPLE], { count: 1, speed: 40, life: 0.3, size: 4, gravity: 0 });
      }
    }
    if (this.finished) return;

    if (this.phase === "intro") {
      this.timer -= dt;
      if (this.timer <= 0) this.startCard();
      return;
    }
    if (this.phase === "card") {
      this.timer -= dt;
      for (const s of this.seats) {
        if (s.botWagerAt !== null && CARD_S - this.timer >= s.botWagerAt) {
          s.botWagerAt = null;
          this.arm(s);
        }
      }
      if (this.timer <= 0) {
        this.phase = "play";
        this.playT = 0;
        this.flash = 0.6;
        this.flashColor = "255,235,180";
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
          if (s.mg.success) {
            this.ctx.sfx.collect();
          } else {
            this.ctx.sfx.miss();
            if (s.wagered && !s.underdog) this.juice.shake(0.2);
          }
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

  /** Arm (or disarm) DOUBLE for a seat during the card. */
  private arm(s: Seat, toggle = false): void {
    if (this.phase !== "card") return;
    if (toggle && s.wagered) {
      s.wagered = false;
      this.ctx.sfx.tick();
      return;
    }
    if (s.wagered) return;
    s.wagered = true;
    this.note(s, s.underdog ? "FREE DOUBLE!" : "DOUBLE!", GOLD, 0.62, CARD_S + 0.3);
    this.juice.burst(s.zone.x + s.zone.w / 2, s.zone.h * 0.62, [GOLD, "#ffffff"], { count: 14, speed: 220, life: 0.5, size: 5, gravity: 300 });
    this.ctx.sfx.select();
  }

  private endMicrogame(): void {
    this.phase = "result";
    this.timer = RESULT_S;
    const round = this.seats.map((s) => ({
      success: s.mg.success,
      at: s.mg.successAt,
      heat: heatFor(s.streak),
      wagered: s.wagered,
      underdog: s.underdog,
    }));
    const { deltas, fastest } = scoreRound(round, this.overdrive);
    const before = this.seats.map((s) => s.score);
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      const d = deltas[i]!;
      s.score = Math.max(0, s.score + d);
      s.lastDelta = s.score - before[i]!;
      s.lastSuccess = s.mg.success;
      s.lastNearMiss = !s.mg.success && s.mg.nearMiss;
      s.lastBonus = fastest === i;
      // Lock any lane still in play so late input does nothing.
      s.mg.lock();
      if (s.mg.success) {
        s.successes += 1;
        s.streak += 1;
        s.bestStreak = Math.max(s.bestStreak, s.streak);
        const ms = Math.round((s.mg.successAt ?? 0) * 1000);
        if (s.fastestMs === null || ms < s.fastestMs) s.fastestMs = ms;
        const heat = heatFor(s.streak);
        if (heat > round[i]!.heat) {
          this.note(s, heat >= HEAT_MAX ? "ON FIRE x3" : `HEAT x${heat}`, heat >= HEAT_MAX ? PINK : GOLD, 0.68, RESULT_S + 0.5);
          if (heat >= HEAT_MAX) this.ctx.sfx.streak(4);
        }
      } else {
        if (s.streak >= 2) this.note(s, "HEAT LOST", "rgba(244,247,251,0.7)", 0.68, RESULT_S + 0.3);
        s.streak = 0;
      }
    }
    if (fastest !== null) {
      const s = this.seats[fastest]!;
      this.callouts.show(`${s.player.name} FASTEST +${this.overdrive ? 2 : 1}`, s.player.color, { size: 52, life: RESULT_S, y: 0.24 });
      this.juice.shake(0.15);
      this.juice.hitStop(0.04);
      this.ctx.sfx.hit();
      if (s.player.kind === "bot" && this.ctx.rng.next() < 0.35) {
        this.note(s, this.ctx.rng.pick(TAUNTS), s.player.color, 0.8, RESULT_S + 0.6);
      }
      const target = pickJinxTarget(this.seats.map((x) => x.score), fastest);
      if (target !== null && this.index + 1 < MICROGAMES_PER_MATCH) {
        const victim = this.seats[target]!;
        const kind = this.ctx.rng.pick(JINX_KINDS);
        this.hex = {
          fromX: s.zone.x + s.zone.w / 2,
          toX: victim.zone.x + victim.zone.w / 2,
          y: this.ctx.height * 0.3,
          t: 0,
          life: RESULT_S * 0.85,
          kind,
          target,
        };
        this.callouts.show(`${s.player.name} JINXES ${victim.player.name}!`, PURPLE, { size: 48, life: RESULT_S + 0.4, y: 0.88 });
      }
    } else {
      this.callouts.show("NOBODY!", PINK, { size: 64, life: RESULT_S, y: 0.24 });
    }
  }

  private endMatch(): void {
    this.phase = "final";
    this.timer = FINAL_S;
    const top = Math.max(...this.seats.map((s) => s.score));
    const leaders = this.seats.filter((s) => s.score === top);
    const text = top === 0 ? "NO WINNER" : leaders.map((s) => s.player.name).join(" & ") + " WINS!";
    const color = leaders.length === 1 && top > 0 ? leaders[0]!.player.color : INK;
    this.callouts.show(text, color, { size: 80, life: FINAL_S, y: 0.3 });
    this.juice.shake(0.4);
    this.ctx.sfx.win();
    for (const s of this.seats) {
      if (s.player.kind !== "human" || s.score <= 0) continue;
      if (saveBest(BEST_ID, s.score, BEST_VERSION)) {
        s.newRecord = true;
        this.note(s, "NEW RECORD!", LIME, 0.62, FINAL_S);
        this.juice.burst(s.zone.x + s.zone.w / 2, s.zone.h * 0.62, [LIME, GOLD, "#ffffff"], { count: 40, speed: 360, life: 0.9, size: 6 });
      }
    }
    for (const s of leaders) {
      if (top > 0) this.juice.burst(s.zone.x + s.zone.w / 2, s.zone.h * 0.45, [s.player.color, "#ffffff", GOLD], { count: 50, speed: 420, life: 1.1, size: 7 });
    }
  }

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private seatAt(x: number): number {
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (x >= s.zone.x && x < s.zone.x + s.zone.w) return i;
    }
    return -1;
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (this.phase !== "play" && this.phase !== "card") return;
    const p = this.toLogical(e);
    const i = this.seatAt(p.x);
    if (i < 0) return;
    const s = this.seats[i]!;
    if (s.player.kind !== "human") return;
    e.preventDefault();
    if (this.phase === "card") {
      this.arm(s, true);
      return;
    }
    this.pointerSeat.set(e.pointerId, i);
    s.mg.handle({ type: "down", x: p.x, y: p.y, id: e.pointerId });
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
    if (this.overdrive && this.phase !== "intro") {
      const pulse = 0.08 + 0.05 * Math.sin(this.clock * 6);
      g.fillStyle = `rgba(255,61,122,${pulse})`;
      g.fillRect(0, 0, width, height);
    }
    this.juice.begin(g);
    for (const s of this.seats) this.drawSeat(g, s);
    this.drawHex(g);
    this.juice.end(g);
    if (this.phase === "play") drawTimerBar(g, width, Math.max(0, this.limit - this.playT), this.limit);
    if (this.flash > 0) {
      g.fillStyle = `rgba(${this.flashColor},${this.flash * 0.25})`;
      g.fillRect(0, 0, width, height);
    }
    this.drawProgress(g);
    this.callouts.draw(g, width, height);
  }

  private drawHex(g: CanvasRenderingContext2D): void {
    const h = this.hex;
    if (!h) return;
    const k = h.t / h.life;
    const x = h.fromX + (h.toX - h.fromX) * k;
    const y = h.y - Math.sin(k * Math.PI) * 90;
    g.save();
    g.translate(x, y);
    g.rotate(this.clock * 9);
    g.fillStyle = PURPLE;
    g.strokeStyle = "#ffffff";
    g.lineWidth = 3;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 26 : 11;
      const a = (i / 10) * Math.PI * 2;
      if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  private drawSeat(g: CanvasRenderingContext2D, s: Seat): void {
    const { x, w, h } = s.zone;
    const cx = x + w / 2;
    const live = this.phase === "card" || this.phase === "play";
    g.save();
    g.globalAlpha = 0.09;
    g.fillStyle = s.player.color;
    g.fillRect(x, 0, w, h);
    g.globalAlpha = 1;
    if (s.jinx && live) {
      g.fillStyle = "rgba(199,125,255,0.12)";
      g.fillRect(x, 0, w, h);
    }
    g.strokeStyle = "rgba(244,247,251,0.12)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x + w, 0);
    g.lineTo(x + w, h);
    g.stroke();
    // Gold frame while DOUBLE is armed.
    if (s.wagered && live) {
      const pulse = 0.55 + 0.45 * Math.sin(this.clock * 10);
      g.strokeStyle = `rgba(255,176,32,${0.5 + 0.5 * pulse})`;
      g.lineWidth = 6 + pulse * 4;
      g.strokeRect(x + 5, 5, w - 10, h - 10);
    }

    // Header: name, score, heat pips.
    g.textAlign = "center";
    g.textBaseline = "top";
    g.fillStyle = s.player.color;
    g.font = `700 ${Math.min(28, w * 0.09)}px ${FONT}`;
    g.fillText(s.player.name, cx, 30);
    g.fillStyle = INK;
    g.font = `700 34px ${FONT}`;
    g.fillText(String(s.score), cx, 50);
    const heat = heatFor(s.streak);
    const litPips = s.streak >= 4 ? 3 : s.streak >= 2 ? 2 : s.streak >= 1 ? 1 : 0;
    const pipGap = 22;
    for (let i = 0; i < HEAT_MAX; i++) {
      const px = cx + (i - (HEAT_MAX - 1) / 2) * pipGap;
      const py = 96;
      const lit = i < litPips;
      g.fillStyle = lit ? (heat >= HEAT_MAX ? PINK : GOLD) : "rgba(244,247,251,0.15)";
      g.beginPath();
      g.moveTo(px, py - 9);
      g.lineTo(px + 7, py + 3);
      g.lineTo(px, py + 8);
      g.lineTo(px - 7, py + 3);
      g.closePath();
      g.fill();
    }
    if (heat > 1) {
      g.fillStyle = heat >= HEAT_MAX ? PINK : GOLD;
      g.font = `700 20px ${FONT}`;
      g.textAlign = "left";
      g.fillText(`x${heat}`, cx + pipGap * 1.6, 86);
      g.textAlign = "center";
    }
    g.restore();

    if (this.phase !== "intro") s.mg.render(g, s.zone);

    const showMark = this.phase === "result" || (this.phase === "play" && s.mg.done);
    if (showMark) {
      const ok = this.phase === "result" ? s.lastSuccess === true : s.mg.success;
      const near = this.phase === "result" ? s.lastNearMiss : s.mg.nearMiss;
      g.save();
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 8;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      let text: string;
      let color: string;
      if (this.phase === "result") {
        if (ok) {
          text = `+${s.lastDelta}`;
          color = s.lastBonus ? GOLD : LIME;
        } else if (s.lastDelta < 0) {
          text = `${s.lastDelta}`;
          color = PINK;
        } else {
          text = near ? "SO CLOSE" : "MISS";
          color = near ? GOLD : PINK;
        }
      } else {
        text = ok ? "GOT IT" : near ? "SO CLOSE" : "MISS";
        color = ok ? LIME : near ? GOLD : PINK;
      }
      g.font = `700 ${Math.min(90, w * 0.3)}px ${FONT}`;
      g.strokeText(text, cx, h * 0.5);
      g.fillStyle = color;
      g.fillText(text, cx, h * 0.5);
      g.restore();
    }

    // Card-phase prompt for humans; status line at the bottom during play.
    if (this.phase === "card" && s.player.kind === "human") {
      g.save();
      const bw = Math.min(w - 40, Math.max(this.ctx.minTap * 3, 200));
      const bh = Math.max(this.ctx.minTap, 54);
      const by = h * 0.62 - bh / 2;
      g.fillStyle = s.wagered ? GOLD : "rgba(7,11,20,0.55)";
      g.strokeStyle = GOLD;
      g.lineWidth = 3;
      g.beginPath();
      g.roundRect(cx - bw / 2, by, bw, bh, 14);
      g.fill();
      g.stroke();
      g.fillStyle = s.wagered ? "#070b14" : GOLD;
      g.font = `700 ${Math.round(Math.min(30, w * 0.1))}px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(s.wagered ? "DOUBLED x2" : s.underdog ? "TAP: FREE DOUBLE" : "TAP TO DOUBLE", cx, by + bh / 2);
      g.restore();
    }
    if (live) {
      let status = "";
      let color = "rgba(244,247,251,0.35)";
      if (s.wagered) {
        status = s.underdog ? "DOUBLED · NO RISK" : `DOUBLED · MISS = -${this.overdrive ? 4 : 2}`;
        color = GOLD;
      } else if (s.underdog) {
        status = "UNDERDOG";
        color = LIME;
      } else if (s.player.kind === "human" && this.phase === "play") {
        status = "YOUR LANE";
      }
      if (status) {
        g.save();
        g.fillStyle = color;
        g.font = `700 ${Math.round(Math.min(20, w * 0.07))}px ${FONT}`;
        g.textAlign = "center";
        g.textBaseline = "bottom";
        g.fillText(status, cx, h - 40);
        g.restore();
      }
    }
    if (this.phase === "intro" && s.player.kind === "human" && this.best > 0) {
      g.save();
      g.fillStyle = "rgba(244,247,251,0.45)";
      g.font = `700 22px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(`BEST ${this.best}`, cx, h * 0.6);
      g.restore();
    }
    this.drawNotes(g, s);
  }

  private drawNotes(g: CanvasRenderingContext2D, s: Seat): void {
    const cx = s.zone.x + s.zone.w / 2;
    for (const n of s.notes) {
      const t = 1 - n.life / n.maxLife;
      const pop = t < 0.12 ? 0.6 + (t / 0.12) * 0.55 : t < 0.22 ? 1.15 - ((t - 0.12) / 0.1) * 0.15 : 1;
      g.save();
      g.globalAlpha = Math.min(1, n.life / (n.maxLife * 0.3));
      g.translate(cx, s.zone.h * n.y - t * 18);
      g.scale(pop, pop);
      g.font = `700 ${n.size}px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 6;
      g.strokeStyle = "rgba(7,11,20,0.8)";
      g.strokeText(n.text, 0, 0);
      g.fillStyle = n.color;
      g.fillText(n.text, 0, 0);
      g.restore();
    }
  }

  private drawProgress(g: CanvasRenderingContext2D): void {
    g.save();
    g.fillStyle = this.overdrive ? PINK : "rgba(244,247,251,0.6)";
    g.font = `700 22px ${FONT}`;
    g.textAlign = "left";
    g.textBaseline = "top";
    const n = Math.min(MICROGAMES_PER_MATCH, this.index + 1);
    g.fillText(`${n} / ${MICROGAMES_PER_MATCH}`, 12, 32);
    if (this.overdrive) {
      g.textAlign = "right";
      g.fillText("OVERDRIVE x2", this.ctx.width - 12, 32);
    }
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
      out.push({ playerId: s.player.id, label: "Best heat run", value: `${s.bestStreak} in a row${s.newRecord ? " · NEW RECORD" : ""}` });
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

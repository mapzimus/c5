import { drawTimerBar, fillArena } from "../../core/draw";
import { Callouts, Juice } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  advanceRound,
  FEINT_MS,
  matchOver,
  newRound,
  planBotCall,
  planBotFeint,
  tap,
  WINS_NEEDED,
  type BotTap,
  type CallKind,
  type Half,
  type RoundState,
} from "./logic";

export const flagFlash: GameDefinition = {
  id: "flag-flash",
  name: "Flag Flash",
  tagline: "RED! BLUE! BOTH! ...NONE!",
  description:
    "A caller waves a red flag and a blue flag. On RED tap your red half, on BLUE your blue half, " +
    "on BOTH tap both (two fingers), on NONE keep still. Wrong half, too slow or twitching on a " +
    "feint knocks you out. Last one standing wins the round; the window shrinks every call. First to 3.",
  durationMs: 0,
  controls: "Tap the matching half of your zone",
  create: (ctx) => new FlagFlash(ctx),
};

const INTRO_S = 1.3;
const RESULT_S = 2.2;
const FINAL_S = 2.2;
const FONT = "Bebas Neue, Impact, sans-serif";
const RED = "#FF3B3B";
const BLUE = "#3E8BFF";
const BOTH_COLOR = "#E6A6FF";
const NONE_COLOR = "#B7BEC9";
const BAND = 0.34;

type GamePhase = "intro" | "round" | "result" | "final";

interface Seat {
  player: Player;
  x: number;
  w: number;
  wins: number;
  knockouts: number;
  best: number | null;
  botTaps: BotTap[];
  botBiteAt: number | null;
  flashLeft: number;
  flashRight: number;
  outFlash: number;
  hitLabel: string;
}

class FlagFlash implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private phase: GamePhase = "intro";
  private timer = INTRO_S;
  private roundIndex = 0;
  private round: RoundState;
  private resultText = "";
  private resultColor = "#F4F7FB";
  private finished = false;
  private armRed = 0;
  private armBlue = 0;
  private flash = 0;
  private time = 0;
  private lastCall: CallKind | null = null;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    const w = ctx.width / ctx.players.length;
    this.seats = ctx.players.map((player, i) => ({
      player, x: i * w, w, wins: 0, knockouts: 0, best: null, botTaps: [], botBiteAt: null,
      flashLeft: 0, flashRight: 0, outFlash: 0, hitLabel: "",
    }));
    this.round = newRound(this.seats.length, ctx.rng);
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
  }

  private startRound(): void {
    this.round = newRound(this.seats.length, this.ctx.rng);
    this.lastCall = null;
    for (const s of this.seats) {
      s.botTaps = [];
      s.botBiteAt = null;
      s.hitLabel = "";
    }
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += realDt;
    this.stepFx(realDt);
    if (this.finished) return;

    if (this.phase === "intro") {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = "round";
        this.ctx.sfx.countdown();
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

    const r = this.round;
    const events = advanceRound(r, dt * 1000, this.ctx.rng);
    for (const ev of events) {
      if (ev === "call") this.onCall();
      else if (ev === "feint") this.onFeint();
      else if (ev === "resolved") this.onResolved();
      else if (ev === "done") this.endRound();
    }

    // Bots.
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (s.player.kind !== "bot") continue;
      if (r.phase === "feint" && s.botBiteAt !== null && r.t >= s.botBiteAt) {
        s.botBiteAt = null;
        this.press(i, this.ctx.rng.next() < 0.5 ? "left" : "right");
      }
      if (r.phase === "call") {
        while (s.botTaps.length > 0 && r.t >= s.botTaps[0]!.atMs) {
          const t = s.botTaps.shift()!;
          this.press(i, t.half);
        }
      } else if (r.phase !== "gap") {
        s.botTaps = [];
      }
    }
    this.animateArms(dt);
  }

  private onCall(): void {
    const r = this.round;
    this.lastCall = r.call;
    this.flash = 0.6;
    this.juice.shake(0.12);
    if (r.call === "NONE") this.ctx.sfx.countdown();
    else this.ctx.sfx.go();
    for (const s of this.seats) {
      s.hitLabel = "";
      s.botTaps = s.player.kind === "bot" && r.call ? planBotCall(r.call, r.windowMs, this.ctx.rng) : [];
    }
  }

  private onFeint(): void {
    for (const s of this.seats) s.botBiteAt = s.player.kind === "bot" ? planBotFeint(this.ctx.rng) : null;
  }

  private onResolved(): void {
    const r = this.round;
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      const st = r.seats[i]!;
      if (!st.alive && st.outReason === "slow" && s.outFlash <= 0) this.knockout(i);
    }
  }

  private knockout(i: number): void {
    const s = this.seats[i]!;
    s.knockouts += 1;
    s.outFlash = 1;
    s.hitLabel = "";
    this.juice.shake(0.25);
    this.juice.burst(s.x + s.w / 2, this.ctx.height * 0.6, ["#9aa3b2", "#5b6373"], { count: 14, speed: 260, size: 5 });
    this.ctx.sfx.miss();
    this.ctx.sfx.hit();
  }

  private press(i: number, half: Half): void {
    if (this.phase !== "round") return;
    const seat = this.seats[i]!;
    const res = tap(this.round, i, half);
    const h = this.ctx.height;
    const hx = seat.x + (half === "left" ? seat.w * 0.25 : seat.w * 0.75);
    if (half === "left") seat.flashLeft = 1; else seat.flashRight = 1;
    if (res === "hit" || res === "pending") {
      this.juice.burst(hx, h * 0.62, [half === "left" ? RED : BLUE, "#ffffff"], { count: 10, speed: 220, size: 4, gravity: 300 });
      if (res === "hit") {
        const ms = this.round.seats[i]!.hitMs ?? 0;
        seat.hitLabel = `${ms} ms`;
        if (seat.best === null || ms < seat.best) seat.best = ms;
        this.ctx.sfx.collect();
      } else {
        this.ctx.sfx.tick();
      }
    } else if (res !== "ignored") {
      this.knockout(i);
    }
  }

  private endRound(): void {
    if (this.phase !== "round") return;
    const r = this.round;
    // Late knockouts (pending BOTH expiry or the void cap) still get the buzzer.
    for (let i = 0; i < this.seats.length; i++) {
      const st = r.seats[i]!;
      if (!st.alive && this.seats[i]!.outFlash <= 0 && st.outReason !== null) this.knockout(i);
    }
    if (r.winner !== null) {
      const seat = this.seats[r.winner]!;
      seat.wins += 1;
      this.resultText = `${seat.player.name} stands alone!`;
      this.resultColor = seat.player.color;
      this.juice.burst(seat.x + seat.w / 2, this.ctx.height * 0.6, [seat.player.color, "#ffffff", RED, BLUE], { count: 36, speed: 420, size: 6 });
      this.juice.shake(0.35);
      this.ctx.sfx.win();
    } else {
      this.resultText = "Everyone fumbled. No point.";
      this.resultColor = "#FF3D7A";
    }
    const wins = this.seats.map((s) => s.wins);
    if (matchOver(wins, this.roundIndex + 1)) {
      this.phase = "final";
      this.timer = RESULT_S + FINAL_S;
      const top = Math.max(...wins);
      const leaders = this.seats.filter((s) => s.wins === top);
      const text = top === 0 ? "NO WINNER" : leaders.map((s) => s.player.name).join(" & ") + " WINS!";
      this.callouts.show(text, leaders.length === 1 && top > 0 ? leaders[0]!.player.color : "#F4F7FB", {
        size: 72, life: RESULT_S + FINAL_S, y: 0.52,
      });
      this.ctx.sfx.win();
    } else {
      this.phase = "result";
      this.timer = RESULT_S;
    }
  }

  private stepFx(dt: number): void {
    this.flash = Math.max(0, this.flash - dt * 3);
    for (const s of this.seats) {
      s.flashLeft = Math.max(0, s.flashLeft - dt * 5);
      s.flashRight = Math.max(0, s.flashRight - dt * 5);
      s.outFlash = Math.max(0, s.outFlash - dt * 2);
    }
  }

  private animateArms(dt: number): void {
    const r = this.round;
    let red = 0;
    let blue = 0;
    if (r.phase === "call" || r.phase === "resolve") {
      red = r.call === "RED" || r.call === "BOTH" ? 1 : 0;
      blue = r.call === "BLUE" || r.call === "BOTH" ? 1 : 0;
    } else if (r.phase === "feint") {
      const tw = 0.28 * Math.sin(Math.min(1, r.t / FEINT_MS) * Math.PI);
      if (r.feintFlag === "RED") red = tw; else blue = tw;
    }
    const k = Math.min(1, dt * 16);
    this.armRed += (red - this.armRed) * k;
    this.armBlue += (blue - this.armBlue) * k;
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
      if (s.player.kind !== "human") continue;
      if (p.x >= s.x && p.x < s.x + s.w) {
        e.preventDefault();
        this.press(i, p.x < s.x + s.w / 2 ? "left" : "right");
        return;
      }
    }
  };

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);
    for (let i = 0; i < this.seats.length; i++) this.drawSeat(g, i);
    this.drawCaller(g);
    this.juice.end(g);
    if (this.flash > 0) {
      const c = this.lastCall === "RED" ? "255,59,59" : this.lastCall === "BLUE" ? "62,139,255" : this.lastCall === "BOTH" ? "230,166,255" : "183,190,201";
      g.fillStyle = `rgba(${c},${this.flash * 0.25})`;
      g.fillRect(0, 0, width, height);
    }
    const r = this.round;
    if (this.phase === "round" && r.phase === "call") drawTimerBar(g, width, Math.max(0, r.windowMs - r.t), r.windowMs);
    this.drawCenter(g);
    this.callouts.draw(g, width, height);
  }

  private drawSeat(g: CanvasRenderingContext2D, i: number): void {
    const s = this.seats[i]!;
    const h = this.ctx.height;
    const top = h * BAND;
    const r = this.round;
    const st = r.seats[i]!;
    const out = !st.alive && this.phase !== "intro";
    const won = r.winner === i;
    const cx = s.x + s.w / 2;
    const half = s.w / 2;

    g.save();
    // Red and blue halves.
    g.globalAlpha = out ? 0.06 : 0.16 + s.flashLeft * 0.4;
    g.fillStyle = RED;
    g.fillRect(s.x, top, half, h - top);
    g.globalAlpha = out ? 0.06 : 0.16 + s.flashRight * 0.4;
    g.fillStyle = BLUE;
    g.fillRect(s.x + half, top, half, h - top);
    g.globalAlpha = 1;
    if (won) {
      g.globalAlpha = 0.18;
      g.fillStyle = s.player.color;
      g.fillRect(s.x, 0, s.w, h);
      g.globalAlpha = 1;
    }
    // Seat separator and half divider.
    g.strokeStyle = "rgba(244,247,251,0.18)";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(s.x + s.w, 0);
    g.lineTo(s.x + s.w, h);
    g.stroke();
    g.strokeStyle = "rgba(7,11,20,0.5)";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(cx, top);
    g.lineTo(cx, h);
    g.stroke();
    // Colored header strip for the seat.
    g.fillStyle = s.player.color;
    g.globalAlpha = out ? 0.25 : 0.9;
    g.fillRect(s.x, top, s.w, 6);
    g.globalAlpha = 1;

    // Half labels.
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `700 ${Math.min(64, half * 0.5)}px ${FONT}`;
    g.globalAlpha = out ? 0.12 : 0.35;
    g.fillStyle = RED;
    g.fillText("RED", s.x + half / 2, h * 0.9);
    g.fillStyle = BLUE;
    g.fillText("BLUE", s.x + half * 1.5, h * 0.9);
    g.globalAlpha = 1;

    // Name and win pips.
    g.textBaseline = "top";
    g.fillStyle = out ? "#8d94a0" : s.player.color;
    g.font = `700 34px ${FONT}`;
    g.fillText(s.player.name, cx, top + 16);
    for (let k = 0; k < WINS_NEEDED; k++) {
      g.beginPath();
      g.arc(cx + (k - (WINS_NEEDED - 1) / 2) * 30, top + 68, 10, 0, Math.PI * 2);
      g.fillStyle = k < s.wins ? s.player.color : "rgba(244,247,251,0.15)";
      g.fill();
    }

    g.textBaseline = "middle";
    if (out) {
      const pop = 1 + s.outFlash * 0.35;
      g.fillStyle = `rgba(90,96,110,${0.45 + s.outFlash * 0.2})`;
      g.fillRect(s.x, top, s.w, h - top);
      g.save();
      g.translate(cx, h * 0.6);
      g.scale(pop, pop);
      g.fillStyle = "#F4F7FB";
      g.font = `700 ${Math.min(96, half * 0.9)}px ${FONT}`;
      g.lineWidth = 8;
      g.strokeStyle = "rgba(7,11,20,0.8)";
      g.strokeText("OUT", 0, 0);
      g.fillText("OUT", 0, 0);
      g.restore();
      const reason = st.outReason === "jumped" ? "JUMPED!" : st.outReason === "wrong" ? "WRONG!" : st.outReason === "slow" ? "TOO SLOW!" : "DON'T TAP!";
      g.fillStyle = "#FF3D7A";
      g.font = `700 ${Math.min(40, half * 0.4)}px ${FONT}`;
      g.fillText(reason, cx, h * 0.72);
    } else if (s.hitLabel) {
      g.fillStyle = "#F4F7FB";
      g.font = `700 44px ${FONT}`;
      g.lineWidth = 6;
      g.strokeStyle = "rgba(7,11,20,0.8)";
      g.strokeText(s.hitLabel, cx, h * 0.72);
      g.fillText(s.hitLabel, cx, h * 0.72);
    } else if (won) {
      g.fillStyle = "#F4F7FB";
      g.font = `700 44px ${FONT}`;
      g.fillText("SURVIVOR!", cx, h * 0.72);
    } else if (s.player.kind === "human" && this.phase === "round") {
      g.fillStyle = "rgba(244,247,251,0.35)";
      g.font = `700 22px ${FONT}`;
      g.fillText("TAP THE CALLED HALF", cx, h * 0.72);
    }
    g.restore();
  }

  private drawCaller(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    const groundY = height * BAND - 8;
    const sc = Math.min(1, height / 720) * 0.95;
    const bob = Math.sin(this.time * 2.2) * 3;
    g.save();
    g.translate(width / 2, groundY);
    g.scale(sc, sc);
    // Stage.
    g.fillStyle = "rgba(244,247,251,0.08)";
    g.fillRect(-140, -6, 280, 12);
    g.translate(0, bob);
    // Robe.
    g.fillStyle = "#F4F7FB";
    g.beginPath();
    g.moveTo(-34, -150);
    g.lineTo(34, -150);
    g.lineTo(52, -6);
    g.lineTo(-52, -6);
    g.closePath();
    g.fill();
    g.fillStyle = "#1b2740";
    g.fillRect(-52, -40, 104, 10);
    // Head.
    g.fillStyle = "#F4F7FB";
    g.beginPath();
    g.arc(0, -180, 30, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#1b2740";
    g.beginPath();
    g.arc(-11, -186, 4, 0, Math.PI * 2);
    g.arc(11, -186, 4, 0, Math.PI * 2);
    g.fill();
    const r = this.round;
    const shout = this.phase === "round" && (r.phase === "call" || r.phase === "resolve");
    g.beginPath();
    if (shout) g.arc(0, -168, 8, 0, Math.PI * 2);
    else g.rect(-7, -170, 14, 3);
    g.fill();
    // Arms with flags: red on screen-left, blue on screen-right.
    this.drawArm(g, -1, this.armRed, RED);
    this.drawArm(g, 1, this.armBlue, BLUE);
    g.restore();
  }

  /** side -1 = left arm (red), 1 = right arm (blue). raise 0 = down, 1 = straight up. */
  private drawArm(g: CanvasRenderingContext2D, side: number, raise: number, color: string): void {
    const sx = side * 34;
    const sy = -140;
    const a = 0.35 + raise * 2.5; // angle from straight down, rotating outward
    const dx = side * Math.sin(a);
    const dy = Math.cos(a);
    const hx = sx + dx * 70;
    const hy = sy + dy * 70;
    g.strokeStyle = "#F4F7FB";
    g.lineWidth = 14;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(hx, hy);
    g.stroke();
    // Pole continues past the hand.
    const px = hx + dx * 95;
    const py = hy + dy * 95;
    g.strokeStyle = "#c9ced6";
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(hx - dx * 20, hy - dy * 20);
    g.lineTo(px, py);
    g.stroke();
    // Pennant waving outward from the pole top.
    const ox = side * Math.abs(dy) + dx * 0.2;
    const oy = -Math.abs(dx) * 0.6 + dy * 0.2;
    const wave = Math.sin(this.time * 9 + side) * 6;
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px + ox * 70 + wave, py + oy * 70 - 10);
    g.lineTo(px - dx * 46, py - dy * 46);
    g.closePath();
    g.fill();
  }

  private drawCenter(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    const r = this.round;
    let text = "";
    let color = "#F4F7FB";
    let size = 64;
    if (this.phase === "intro") {
      text = `ROUND ${this.roundIndex + 1}`;
      size = 72;
    } else if (this.phase === "round") {
      if (r.phase === "call" || r.phase === "resolve") {
        text = `${r.call}!`;
        color = r.call === "RED" ? RED : r.call === "BLUE" ? BLUE : r.call === "BOTH" ? BOTH_COLOR : NONE_COLOR;
        size = 150;
      } else {
        text = "watch the flags...";
        color = "rgba(244,247,251,0.45)";
        size = 40;
      }
    } else if (this.phase === "result") {
      text = this.resultText;
      color = this.resultColor;
      size = 56;
    }
    if (!text) return;
    g.save();
    g.font = `700 ${size}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 10;
    g.strokeStyle = "rgba(7,11,20,0.85)";
    const y = height * 0.5;
    g.strokeText(text, width / 2, y);
    g.fillStyle = color;
    g.fillText(text, width / 2, y);
    g.restore();
  }

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({ playerId: s.player.id, score: s.wins }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const s of this.seats) {
      out.push({ playerId: s.player.id, label: "Fastest response", value: s.best === null ? "-" : `${s.best} ms` });
      out.push({ playerId: s.player.id, label: "Knocked out", value: String(s.knockouts) });
    }
    return out;
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener("pointerdown", this.onDown);
  }
}

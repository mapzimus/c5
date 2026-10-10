import { fillArena } from "../../core/draw";
import { Callouts, Juice } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  activeFake,
  advanceRound,
  matchOver,
  newRound,
  planBotTap,
  planRound,
  tap,
  FAKE_SHOW_MS,
  WINS_NEEDED,
  type RoundState,
} from "./logic";

export const quickDraw: GameDefinition = {
  id: "quick-draw",
  name: "Quick Draw",
  tagline: "Wait for it... DRAW!",
  description:
    "A standoff. Wait for DRAW! then tap your zone first. Tap early (fakes like DRUM! or a " +
    "tumbleweed count) and you're out for the round. First to 3 round wins takes it.",
  durationMs: 0,
  controls: "Tap your zone on DRAW!",
  create: (ctx) => new QuickDraw(ctx),
};

const INTRO_S = 1.3;
const RESULT_S = 2.2;
const FINAL_S = 2.2;
const FONT = "Bebas Neue, Impact, sans-serif";

type Phase = "intro" | "round" | "result" | "final";

interface Seat {
  player: Player;
  x: number;
  w: number;
  wins: number;
  falseStarts: number;
  best: number | null;
  botTapAt: number | null;
}

class QuickDraw implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private phase: Phase = "intro";
  private timer = INTRO_S;
  private roundIndex = 0;
  private round: RoundState;
  private resultText = "";
  private resultColor = "#F4F7FB";
  private finished = false;
  private lastFake: number | null = null;
  private drawShown = false;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    const w = ctx.width / ctx.players.length;
    this.seats = ctx.players.map((player, i) => ({
      player, x: i * w, w, wins: 0, falseStarts: 0, best: null, botTapAt: null,
    }));
    this.round = this.startRound();
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
  }

  private startRound(): RoundState {
    const plan = planRound(this.roundIndex, this.ctx.rng);
    for (const s of this.seats) s.botTapAt = s.player.kind === "bot" ? planBotTap(plan, this.ctx.rng) : null;
    this.lastFake = null;
    this.drawShown = false;
    return newRound(plan, this.seats.length);
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    if (this.finished) return;

    if (this.phase === "intro") {
      this.timer -= dt;
      if (this.timer <= 0) this.phase = "round";
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
      this.round = this.startRound();
      this.phase = "intro";
      this.timer = INTRO_S;
      return;
    }

    const r = this.round;
    advanceRound(r, dt * 1000);

    const fake = activeFake(r);
    if (fake && fake.atMs !== this.lastFake) {
      this.lastFake = fake.atMs;
      if (fake.kind === "tumbleweed") this.ctx.sfx.whoosh();
      else this.ctx.sfx.countdown();
    }
    if (!this.drawShown && r.t >= r.plan.waitMs) {
      this.drawShown = true;
      this.ctx.sfx.go();
    }

    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (s.botTapAt !== null && r.t >= s.botTapAt) {
        s.botTapAt = null;
        this.press(i);
      }
    }

    if (r.phase === "done") this.endRound();
  }

  private press(i: number): void {
    const r = this.round;
    if (this.phase !== "round") return;
    advanceRound(r, 0);
    const seat = this.seats[i]!;
    const res = tap(r, i);
    if (res === "false-start") {
      seat.falseStarts += 1;
      this.ctx.sfx.miss();
      this.juice.shake(0.15);
    } else if (res === "win") {
      this.ctx.sfx.hit();
      this.juice.shake(0.4);
      this.juice.burst(seat.x + seat.w / 2, this.ctx.height * 0.55, [seat.player.color, "#FFB020", "#ffffff"], {
        count: 30, speed: 320, life: 0.7,
      });
    }
    if (r.phase === "done") this.endRound();
  }

  private endRound(): void {
    if (this.phase !== "round") return;
    const r = this.round;
    if (r.winner !== null) {
      const seat = this.seats[r.winner]!;
      seat.wins += 1;
      const ms = r.reactionMs ?? 0;
      if (seat.best === null || ms < seat.best) seat.best = ms;
      this.resultText = `${seat.player.name} wins in ${ms} ms`;
      this.resultColor = seat.player.color;
      this.ctx.sfx.collect();
    } else {
      this.resultText = r.out.every(Boolean) ? "Everyone jumped the gun! No point." : "Nobody drew. No point.";
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
        size: 72, life: RESULT_S + FINAL_S, y: 0.2,
      });
      this.ctx.sfx.win();
    } else {
      this.phase = "result";
      this.timer = RESULT_S;
    }
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
        this.press(i);
        return;
      }
    }
  };

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);
    for (let i = 0; i < this.seats.length; i++) this.drawSeat(g, i);
    this.drawTumbleweed(g);
    this.juice.end(g);
    this.drawCenter(g);
    this.callouts.draw(g, width, height);
  }

  private drawSeat(g: CanvasRenderingContext2D, i: number): void {
    const s = this.seats[i]!;
    const h = this.ctx.height;
    const r = this.round;
    const out = r.out[i] ?? false;
    const won = r.winner === i;
    const cx = s.x + s.w / 2;

    g.save();
    g.globalAlpha = out ? 0.08 : won ? 0.22 : 0.1;
    g.fillStyle = s.player.color;
    g.fillRect(s.x, 0, s.w, h);
    g.globalAlpha = 1;
    g.strokeStyle = "rgba(244,247,251,0.12)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(s.x + s.w, 0);
    g.lineTo(s.x + s.w, h);
    g.stroke();

    // Ground line.
    g.fillStyle = "rgba(160,110,60,0.35)";
    g.fillRect(s.x, h * 0.86, s.w, h * 0.14);

    g.textAlign = "center";
    g.textBaseline = "top";
    g.fillStyle = s.player.color;
    g.font = `700 34px ${FONT}`;
    g.fillText(s.player.name, cx, 14);

    // Win pips.
    for (let k = 0; k < WINS_NEEDED; k++) {
      g.beginPath();
      g.arc(cx + (k - (WINS_NEEDED - 1) / 2) * 30, 64, 10, 0, Math.PI * 2);
      g.fillStyle = k < s.wins ? s.player.color : "rgba(244,247,251,0.15)";
      g.fill();
    }

    this.drawGunslinger(g, cx, h * 0.86, s.player.color, out, won);

    g.textBaseline = "middle";
    if (out) {
      g.fillStyle = "#FF3D7A";
      g.font = `700 44px ${FONT}`;
      g.fillText("TOO EARLY!", cx, h * 0.93);
    } else if (won) {
      g.fillStyle = "#F4F7FB";
      g.font = `700 44px ${FONT}`;
      g.fillText(`${r.reactionMs} ms`, cx, h * 0.93);
    } else if (s.player.kind === "human" && this.phase === "round") {
      g.fillStyle = "rgba(244,247,251,0.35)";
      g.font = `700 24px ${FONT}`;
      g.fillText("TAP HERE", cx, h * 0.93);
    }
    g.restore();
  }

  private drawGunslinger(
    g: CanvasRenderingContext2D, x: number, groundY: number, color: string, out: boolean, won: boolean,
  ): void {
    const s = Math.min(1, this.ctx.height / 720);
    g.save();
    g.translate(x, groundY);
    g.scale(s, s);
    if (out) g.rotate(0.35);
    g.globalAlpha = out ? 0.45 : 1;
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = 10;
    g.lineCap = "round";
    // Legs.
    g.beginPath();
    g.moveTo(0, -90); g.lineTo(-22, 0);
    g.moveTo(0, -90); g.lineTo(22, 0);
    g.stroke();
    // Body.
    g.fillRect(-22, -170, 44, 85);
    // Arm: holstered, or raised pointing up/forward when this seat won.
    g.beginPath();
    g.moveTo(18, -155);
    if (won) {
      g.lineTo(70, -185);
      g.stroke();
      g.fillStyle = "#c9ced6";
      g.fillRect(64, -200, 34, 12);
    } else {
      g.lineTo(30, -100);
      g.stroke();
      g.fillStyle = "#6b4a2b";
      g.fillRect(24, -110, 16, 28);
    }
    g.beginPath();
    g.moveTo(-18, -155); g.lineTo(-30, -100);
    g.strokeStyle = color;
    g.stroke();
    // Head.
    g.fillStyle = "#e8c39e";
    g.beginPath();
    g.arc(0, -195, 24, 0, Math.PI * 2);
    g.fill();
    // Hat.
    g.fillStyle = "#3b2a1a";
    g.fillRect(-42, -218, 84, 10);
    g.fillRect(-24, -250, 48, 34);
    g.fillStyle = color;
    g.fillRect(-24, -224, 48, 6);
    g.restore();
  }

  private drawTumbleweed(g: CanvasRenderingContext2D): void {
    const fake = activeFake(this.round);
    if (!fake || fake.kind !== "tumbleweed") return;
    const p = (this.round.t - fake.atMs) / FAKE_SHOW_MS;
    const x = -60 + p * (this.ctx.width + 120);
    const y = this.ctx.height * 0.82 - Math.abs(Math.sin(p * Math.PI * 3)) * 40;
    g.save();
    g.translate(x, y);
    g.rotate(p * 12);
    g.strokeStyle = "#b8925a";
    g.lineWidth = 4;
    for (let k = 0; k < 6; k++) {
      g.beginPath();
      g.ellipse(0, 0, 38, 18 + k * 3, (k * Math.PI) / 6, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
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
      const fake = activeFake(r);
      if (r.phase === "draw" || (r.phase === "done" && r.t >= r.plan.waitMs)) {
        text = "DRAW!";
        color = "#FFB020";
        size = 170;
      } else if (fake && fake.kind !== "tumbleweed") {
        text = fake.kind;
        color = "#FFB020";
        size = 150;
      } else {
        text = "steady...";
        color = "rgba(244,247,251,0.5)";
        size = 48;
      }
    } else {
      text = this.resultText;
      color = this.resultColor;
      size = 56;
    }
    g.save();
    g.font = `700 ${size}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 10;
    g.strokeStyle = "rgba(7,11,20,0.85)";
    const y = height * 0.36;
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
      out.push({ playerId: s.player.id, label: "Fastest draw", value: s.best === null ? "-" : `${s.best} ms` });
      out.push({ playerId: s.player.id, label: "False starts", value: String(s.falseStarts) });
    }
    return out;
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener("pointerdown", this.onDown);
  }
}

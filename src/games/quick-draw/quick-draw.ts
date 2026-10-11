import { fillArena } from "../../core/draw";
import { Callouts, Juice, loadBest, saveBest } from "../../fx/juice";
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
    "tumbleweed count) and you're out for the round. The winner's bullet knocks everyone else's " +
    "hat off. Beat your fastest-ever draw for a record. First to 3 round wins takes it.",
  durationMs: 0,
  controls: "Tap your zone on DRAW!",
  create: (ctx) => new QuickDraw(ctx),
};

const INTRO_S = 1.3;
const RESULT_S = 2.2;
const FINAL_S = 2.2;
const FONT = "Bebas Neue, Impact, sans-serif";

type Phase = "intro" | "round" | "result" | "final";

interface Bullet {
  x: number;
  y: number;
  vx: number;
  life: number;
  color: string;
}

interface Hat {
  seat: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  bounces: number;
}

const HAT_W = 84;
const BULLET_SPEED = 2600;
const BEST_KEY = "quick-draw-ms";

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
  private bullets: Bullet[] = [];
  private hats: Hat[] = [];
  private flash = 0;
  private heartbeat = 0;
  private beatT = 0;
  private recoil: number[];
  private readonly best: number;
  private newBest = false;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    const w = ctx.width / ctx.players.length;
    this.seats = ctx.players.map((player, i) => ({
      player, x: i * w, w, wins: 0, falseStarts: 0, best: null, botTapAt: null,
    }));
    this.recoil = this.seats.map(() => 0);
    this.best = loadBest(BEST_KEY);
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
    this.hats = [];
    this.bullets = [];
    this.beatT = 0;
    return newRound(plan, this.seats.length);
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.stepProps(realDt);
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

    // Heartbeat: the longer the wait, the faster it thumps.
    if (r.phase === "wait") {
      const tension = Math.min(1, r.t / r.plan.waitMs);
      const period = 1.1 - tension * 0.7;
      this.beatT += dt;
      if (this.beatT >= period) {
        this.beatT = 0;
        this.heartbeat = 1;
        this.ctx.sfx.tick();
      }
    }

    const fake = activeFake(r);
    if (fake && fake.atMs !== this.lastFake) {
      this.lastFake = fake.atMs;
      if (fake.kind === "tumbleweed") this.ctx.sfx.whoosh();
      else this.ctx.sfx.countdown();
    }
    if (!this.drawShown && r.t >= r.plan.waitMs) {
      this.drawShown = true;
      this.flash = 1;
      this.juice.shake(0.2);
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
    const cx = seat.x + seat.w / 2;
    const h = this.ctx.height;
    if (res === "false-start") {
      seat.falseStarts += 1;
      this.recoil[i] = 1;
      // Fires into the dirt: dust and a dropped hat.
      this.juice.burst(cx + 30, h * 0.86, ["#b8925a", "rgba(244,247,251,0.5)"], {
        count: 16, speed: 220, angle: -Math.PI / 2, spread: 1.4, gravity: 600, size: 5,
      });
      this.popHat(i, (this.ctx.rng.next() - 0.5) * 120, -260);
      this.ctx.sfx.miss();
      this.juice.shake(0.2);
    } else if (res === "win") {
      this.recoil[i] = 1;
      this.juice.hitStop(0.08);
      this.juice.shake(0.45);
      this.flash = 0.8;
      // Muzzle flash.
      this.juice.burst(cx + 70, h * 0.86 - 185, ["#FFB020", "#ffffff"], { count: 18, speed: 380, life: 0.3, gravity: 0, size: 6 });
      // One bullet each way so everyone else's hat gets hit.
      for (const dir of [-1, 1]) {
        this.bullets.push({ x: cx + dir * 70, y: h * 0.86 - 190, vx: dir * BULLET_SPEED, life: 1, color: seat.player.color });
      }
      this.ctx.sfx.hit();
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
      if (seat.player.kind === "human" && ms > 0) {
        // Stored inverted (higher = better) so saveBest keeps the fastest time.
        const bestMs = this.best > 0 ? 100000 - this.best : 0;
        const record = bestMs === 0 || ms < bestMs;
        if (record && saveBest(BEST_KEY, 100000 - ms)) {
          this.newBest = true;
          this.callouts.show(`NEW RECORD ${ms} ms`, "#B8FF3D", { size: 56, y: 0.55, life: 1.8 });
          this.ctx.sfx.streak(4);
        } else if (ms < 200) {
          this.callouts.show("LIGHTNING!", "#FFB020", { size: 56, y: 0.55, life: 1.4 });
        }
      }
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

  private popHat(seat: number, vx: number, vy: number): void {
    if (this.hats.some((h) => h.seat === seat)) return;
    const s = this.seats[seat]!;
    const sc = Math.min(1, this.ctx.height / 720);
    const groundY = this.ctx.height * 0.86;
    this.hats.push({
      seat, x: s.x + s.w / 2, y: groundY - 228 * sc, vx, vy,
      rot: 0, vr: (this.ctx.rng.next() - 0.5) * 14, bounces: 0,
    });
  }

  private stepProps(dt: number): void {
    this.flash = Math.max(0, this.flash - dt * 4);
    this.heartbeat = Math.max(0, this.heartbeat - dt * 5);
    for (let i = 0; i < this.recoil.length; i++) this.recoil[i] = Math.max(0, this.recoil[i]! - dt * 6);

    const groundY = this.ctx.height * 0.86;
    const hatH = 40 * Math.min(1, this.ctx.height / 720);
    for (const b of this.bullets) {
      b.x += b.vx * dt;
      b.life -= dt;
      for (let i = 0; i < this.seats.length; i++) {
        const s = this.seats[i]!;
        if (i === this.round.winner || this.hats.some((h) => h.seat === i)) continue;
        const cx = s.x + s.w / 2;
        if (Math.abs(b.x - cx) < 40) {
          this.popHat(i, Math.sign(b.vx) * 320 + (this.ctx.rng.next() - 0.5) * 100, -520);
          this.juice.burst(cx, groundY - 230, ["#3b2a1a", s.player.color], { count: 12, speed: 240, gravity: 500, size: 4 });
          this.juice.shake(0.15);
          this.ctx.sfx.tick();
        }
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0 && b.x > -100 && b.x < this.ctx.width + 100);

    this.hats = this.hats.filter((h) => h.x > -HAT_W * 2 && h.x < this.ctx.width + HAT_W * 2);
    for (const h of this.hats) {
      h.vy += 1500 * dt;
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.rot += h.vr * dt;
      if (h.y >= groundY - hatH / 2 && h.vy > 0) {
        h.y = groundY - hatH / 2;
        h.bounces++;
        h.vy = -h.vy * 0.4;
        h.vx *= 0.6;
        h.vr *= 0.5;
        if (h.bounces >= 3 || Math.abs(h.vy) < 80) {
          h.vy = 0;
          h.vx = 0;
          h.vr = 0;
          h.rot = Math.round(h.rot / Math.PI) * Math.PI + (this.ctx.rng.next() - 0.5) * 0.4;
        } else {
          this.juice.burst(h.x, groundY, "#b8925a", { count: 5, speed: 80, gravity: 300, size: 3, life: 0.35, angle: -Math.PI / 2, spread: 2 });
        }
      }
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
    this.drawBullets(g);
    this.drawHats(g);
    this.juice.end(g);
    if (this.heartbeat > 0 && this.phase === "round") {
      const grad = g.createRadialGradient(width / 2, height / 2, height * 0.35, width / 2, height / 2, height * 0.9);
      grad.addColorStop(0, "rgba(255,61,122,0)");
      grad.addColorStop(1, `rgba(255,61,122,${this.heartbeat * 0.28})`);
      g.fillStyle = grad;
      g.fillRect(0, 0, width, height);
    }
    if (this.flash > 0) {
      g.fillStyle = `rgba(255,235,180,${this.flash * 0.35})`;
      g.fillRect(0, 0, width, height);
    }
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

    this.drawGunslinger(g, cx, h * 0.86, s.player.color, out, won, this.hats.some((hat) => hat.seat === i), this.recoil[i]!);

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
    hatless: boolean, recoil: number,
  ): void {
    const s = Math.min(1, this.ctx.height / 720);
    g.save();
    g.translate(x, groundY);
    g.scale(s, s);
    if (out) g.rotate(0.35);
    if (recoil > 0) {
      g.translate(-recoil * 10, 0);
      g.rotate(-recoil * 0.08);
    }
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
    if (!hatless) {
      this.drawHat(g, color);
    } else {
      // Bare head: a tuft of hair.
      g.fillStyle = "#3b2a1a";
      g.fillRect(-16, -224, 32, 8);
    }
    g.restore();
  }

  /** Hat drawn with its brim centered at (0, -213) in gunslinger space. */
  private drawHat(g: CanvasRenderingContext2D, color: string): void {
    g.fillStyle = "#3b2a1a";
    g.fillRect(-42, -218, 84, 10);
    g.fillRect(-24, -250, 48, 34);
    g.fillStyle = color;
    g.fillRect(-24, -224, 48, 6);
  }

  private drawHats(g: CanvasRenderingContext2D): void {
    const s = Math.min(1, this.ctx.height / 720);
    for (const h of this.hats) {
      g.save();
      g.translate(h.x, h.y);
      g.rotate(h.rot);
      g.scale(s, s);
      g.translate(0, 232);
      this.drawHat(g, this.seats[h.seat]!.player.color);
      g.restore();
    }
  }

  private drawBullets(g: CanvasRenderingContext2D): void {
    for (const b of this.bullets) {
      const len = Math.sign(b.vx) * 90;
      const grad = g.createLinearGradient(b.x - len, b.y, b.x, b.y);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(1, b.color);
      g.strokeStyle = grad;
      g.lineWidth = 5;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(b.x - len, b.y);
      g.lineTo(b.x, b.y);
      g.stroke();
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.arc(b.x, b.y, 4, 0, Math.PI * 2);
      g.fill();
    }
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
      if (s.player.kind === "human" && this.newBest) out.push({ playerId: s.player.id, label: "Record", value: "NEW BEST" });
    }
    return out;
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener("pointerdown", this.onDown);
  }
}

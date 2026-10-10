import { drawTimerBar, fillArena } from "../../core/draw";
import { Callouts, Juice } from "../../fx/juice";
import type {
  GameContext,
  GameDefinition,
  GameInstance,
  GameStat,
  Player,
} from "../../core/types";
import {
  angleDelta,
  botLead,
  clampOmega,
  crossedBottom,
  isClear,
  jumpHeight,
  MIN_OMEGA,
  nextBotSegment,
  ROUND_SECONDS,
  scoreRound,
  spinnerOrder,
  TAU,
  timeToBottom,
  AIR_TIME,
} from "./logic";

export const ropeSkip: GameDefinition = {
  id: "rope-skip",
  name: "Rope Skip",
  tagline: "One spins, everyone else jumps.",
  description:
    "Each round one player turns a giant rope and everyone else jumps it. " +
    "The spinner drags in circles to speed up, slow down or stutter the rope; jumpers tap to hop. " +
    "Get swept and you're out. Survive 15s for +1; the spinner gets +1 per knockout. Everyone spins once.",
  durationMs: 0,
  controls: "Jumpers: tap your strip. Spinner: drag circles on the ring",
  create: (ctx) => new RopeSkip(ctx),
};

const INTRO_SECONDS = 2.2;
const OUTRO_SECONDS = 2;
const GROUND_Y = 540;
const ROPE_R = 190;
const AXIS_Y = GROUND_Y - ROPE_R;
const POLE_L = 150;
const POLE_R = 920;
const JUMP_PEAK = 120;
const STRIP_Y = 600;
const RING = { x: 1110, y: 330, r: 120 };
const CPU_COLOR = "#9AA4B8";

interface Seat {
  player: Player;
  score: number;
  knockouts: number;
  survived: number;
}

interface Jumper {
  seat: number;
  x: number;
  jumpT: number | null;
  out: boolean;
  tumble: number;
  lead: number;
  jumpedThisTurn: boolean;
  jumps: number;
}

type Phase = "intro" | "play" | "outro" | "done";

class RopeSkip implements GameInstance {
  private readonly seats: Seat[];
  private readonly order: number[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private round = 0;
  private phase: Phase = "intro";
  private phaseT = 0;
  private jumpers: Jumper[] = [];
  private phi = 0;
  private omega = MIN_OMEGA;
  private targetOmega = MIN_OMEGA;
  private botSeg = { omega: MIN_OMEGA, left: 0 };
  private drag: { id: number; angle: number; time: number } | null = null;
  private lastCount = 0;
  private clock = 0;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    this.seats = ctx.players.map((player) => ({ player, score: 0, knockouts: 0, survived: 0 }));
    this.order = spinnerOrder(ctx.players.length);
    this.startRound();
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
  }

  private get spinner(): number {
    return this.order[this.round] ?? -1;
  }

  private get spinnerIsBot(): boolean {
    const s = this.spinner;
    return s < 0 || this.seats[s]!.player.kind === "bot";
  }

  private rand = (): number => this.ctx.rng.next();

  private startRound(): void {
    const ids = this.seats.map((_, i) => i).filter((i) => i !== this.spinner);
    const span = POLE_R - POLE_L;
    this.jumpers = ids.map((seat, k) => ({
      seat,
      x: POLE_L + (span * (k + 1)) / (ids.length + 1),
      jumpT: null,
      out: false,
      tumble: 0,
      lead: botLead(this.rand),
      jumpedThisTurn: false,
      jumps: 0,
    }));
    this.phi = 0;
    this.omega = 3.5;
    this.targetOmega = 3.5;
    this.botSeg = { omega: 3.5, left: 1 };
    this.drag = null;
    this.phase = "intro";
    this.phaseT = 0;
    this.lastCount = 0;
    const name = this.spinner < 0 ? "CPU" : this.seats[this.spinner]!.player.name;
    const color = this.spinner < 0 ? CPU_COLOR : this.seats[this.spinner]!.player.color;
    this.callouts.show(`${name} SPINS`, color, { size: 60, life: INTRO_SECONDS });
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.phaseT += realDt;
    this.clock += realDt;

    if (this.phase === "intro") {
      const count = Math.ceil(INTRO_SECONDS - this.phaseT);
      if (count !== this.lastCount && count > 0) {
        this.lastCount = count;
        this.ctx.sfx.countdown();
      }
      if (this.phaseT >= INTRO_SECONDS) {
        this.phase = "play";
        this.phaseT = 0;
        this.ctx.sfx.go();
      }
      this.stepJumpers(dt);
      return;
    }

    if (this.phase === "play") {
      this.stepSpin(dt);
      const prev = this.phi;
      this.phi += this.omega * dt;
      this.stepJumpers(dt);
      this.botJumpers();
      if (crossedBottom(prev, this.phi)) this.sweep();
      if (this.phaseT >= ROUND_SECONDS) this.endRound();
      return;
    }

    this.stepJumpers(dt);
    if (this.phase === "outro" && this.phaseT >= OUTRO_SECONDS) {
      this.round++;
      if (this.round >= this.order.length) {
        this.phase = "done";
        this.phaseT = 0;
        this.announceWinner();
      } else {
        this.startRound();
      }
    }
  }

  private stepSpin(dt: number): void {
    if (this.spinnerIsBot) {
      this.botSeg.left -= dt;
      if (this.botSeg.left <= 0) {
        const seg = nextBotSegment(this.rand);
        this.botSeg = { omega: seg.omega, left: seg.duration };
      }
      this.targetOmega = this.botSeg.omega;
    } else if (this.drag && this.clock - this.drag.time > 0.15) {
      // Finger held still: rope drops toward its slowest speed.
      this.targetOmega = MIN_OMEGA;
    }
    const k = 1 - Math.exp(-dt * 10);
    this.omega = clampOmega(this.omega + (this.targetOmega - this.omega) * k);
  }

  private stepJumpers(dt: number): void {
    for (const j of this.jumpers) {
      if (j.out) {
        j.tumble += dt;
        continue;
      }
      if (j.jumpT !== null) {
        j.jumpT += dt;
        if (j.jumpT >= AIR_TIME) j.jumpT = null;
      }
    }
  }

  private botJumpers(): void {
    const ttb = timeToBottom(this.phi, this.omega);
    for (const j of this.jumpers) {
      if (j.out || this.seats[j.seat]!.player.kind !== "bot") continue;
      if (!j.jumpedThisTurn && j.jumpT === null && ttb <= j.lead) {
        j.jumpedThisTurn = true;
        this.jump(j);
      }
    }
  }

  private sweep(): void {
    this.ctx.sfx.tick();
    for (const j of this.jumpers) {
      j.jumpedThisTurn = false;
      j.lead = botLead(this.rand);
      if (j.out || isClear(j.jumpT)) continue;
      j.out = true;
      j.jumpT = null;
      const p = this.seats[j.seat]!.player;
      this.juice.shake(0.35);
      this.juice.burst(j.x, GROUND_Y - 20, [p.color, "#ffffff", "#FF3D7A"], { count: 26, speed: 280 });
      this.ctx.sfx.hit();
      this.callouts.show(`${p.name} OUT!`, "#FF3D7A", { size: 44, life: 0.9, y: 0.18 });
    }
  }

  private jump(j: Jumper): void {
    if (j.out || j.jumpT !== null || this.phase === "done") return;
    j.jumpT = 0;
    j.jumps++;
    this.ctx.sfx.whoosh();
  }

  private endRound(): void {
    const out = this.seats.map((_, i) => this.jumpers.find((j) => j.seat === i)?.out ?? false);
    const delta = scoreRound(this.seats.length, this.spinner, out);
    delta.forEach((d, i) => (this.seats[i]!.score += d));
    for (const j of this.jumpers) if (!j.out) this.seats[j.seat]!.survived++;
    if (this.spinner >= 0) this.seats[this.spinner]!.knockouts += delta[this.spinner]!;
    const alive = this.jumpers.filter((j) => !j.out).length;
    this.callouts.show(alive > 0 ? `${alive} SURVIVED` : "WIPEOUT!", alive > 0 ? "#B8FF3D" : "#FF3D7A", { size: 56 });
    this.ctx.sfx.collect();
    this.phase = "outro";
    this.phaseT = 0;
  }

  private announceWinner(): void {
    const best = Math.max(...this.seats.map((s) => s.score));
    const top = this.seats.filter((s) => s.score === best);
    const text = top.length === 1 ? `${top[0]!.player.name} WINS!` : "TIE!";
    this.callouts.show(text, top[0]!.player.color, { size: 64, life: 2 });
    this.ctx.sfx.win();
  }

  // ---- input ----

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private stripFor(x: number): Jumper | undefined {
    const n = this.jumpers.length;
    if (n === 0) return undefined;
    const k = Math.min(n - 1, Math.max(0, Math.floor((x / this.ctx.width) * n)));
    return this.jumpers[k];
  }

  private readonly onDown = (e: PointerEvent): void => {
    const p = this.toLogical(e);
    if (p.y >= STRIP_Y) {
      const j = this.stripFor(p.x);
      if (j && this.seats[j.seat]!.player.kind === "human") {
        e.preventDefault();
        this.jump(j);
      }
      return;
    }
    if (p.x >= POLE_R + 40 && !this.spinnerIsBot && !this.drag) {
      e.preventDefault();
      this.drag = { id: e.pointerId, angle: Math.atan2(p.y - RING.y, p.x - RING.x), time: this.clock };
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const p = this.toLogical(e);
    const a = Math.atan2(p.y - RING.y, p.x - RING.x);
    const dt = this.clock - this.drag.time;
    if (dt < 1 / 120) return;
    const rate = Math.abs(angleDelta(this.drag.angle, a)) / dt;
    this.drag = { id: e.pointerId, angle: a, time: this.clock };
    if (this.phase === "play") this.targetOmega = clampOmega(rate);
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (this.drag && e.pointerId === this.drag.id) this.drag = null;
  };

  // ---- render ----

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);

    // ground
    g.fillStyle = "rgba(244,247,251,0.06)";
    g.fillRect(0, GROUND_Y, width, 6);

    // poles
    g.fillStyle = "#4a5470";
    g.fillRect(POLE_L - 8, AXIS_Y - 10, 16, GROUND_Y - AXIS_Y + 10);
    g.fillRect(POLE_R - 8, AXIS_Y - 10, 16, GROUND_Y - AXIS_Y + 10);

    const front = Math.sin(this.phi) > 0;
    if (!front) this.drawRope(g, false);
    for (const j of this.jumpers) this.drawJumper(g, j);
    if (front) this.drawRope(g, true);

    this.drawSpinner(g);
    this.juice.end(g);

    this.drawHud(g);
    this.callouts.draw(g, width, height);
  }

  private drawRope(g: CanvasRenderingContext2D, front: boolean): void {
    const c = Math.cos(this.phi);
    const depth = Math.sin(this.phi);
    g.save();
    g.strokeStyle = front ? "#FFE7A8" : "rgba(200,180,130,0.55)";
    g.lineWidth = 5 + (front ? 3 : 0) * Math.abs(depth);
    g.lineCap = "round";
    g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      const x = POLE_L + (POLE_R - POLE_L) * u;
      const y = AXIS_Y - ROPE_R * c * Math.sin(Math.PI * u);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.restore();
  }

  private drawJumper(g: CanvasRenderingContext2D, j: Jumper): void {
    const p = this.seats[j.seat]!.player;
    const lift = jumpHeight(j.jumpT) * JUMP_PEAK;
    const r = 26;
    g.save();
    if (j.out) {
      const t = Math.min(1, j.tumble / 0.6);
      g.translate(j.x + t * 40, GROUND_Y - r + t * 8);
      g.rotate(t * Math.PI * 0.5);
      g.globalAlpha = 1 - t * 0.6;
    } else {
      g.translate(j.x, GROUND_Y - r - lift);
    }
    g.fillStyle = p.color;
    g.beginPath();
    g.ellipse(0, 0, r, r * (j.jumpT === null ? 1 : 1.08), 0, 0, TAU);
    g.fill();
    g.fillStyle = "#070b14";
    g.beginPath();
    g.arc(-8, -6, 4, 0, TAU);
    g.arc(8, -6, 4, 0, TAU);
    g.fill();
    g.restore();

    g.fillStyle = j.out ? "rgba(244,247,251,0.35)" : p.color;
    g.font = "700 20px Bebas Neue, Impact, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "top";
    g.fillText(j.out ? "OUT" : p.name, j.x, GROUND_Y + 10);
  }

  private drawSpinner(g: CanvasRenderingContext2D): void {
    const s = this.spinner;
    const color = s < 0 ? CPU_COLOR : this.seats[s]!.player.color;
    const name = s < 0 ? "CPU" : this.seats[s]!.player.name;
    // spinner blob next to the right pole, cranking
    const hx = POLE_R + 22 * Math.sin(this.phi);
    const hy = AXIS_Y - 22 * Math.cos(this.phi);
    g.strokeStyle = "#4a5470";
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(POLE_R, AXIS_Y);
    g.lineTo(hx, hy);
    g.stroke();
    g.fillStyle = color;
    g.beginPath();
    g.arc(POLE_R + 50, GROUND_Y - 30, 30, 0, TAU);
    g.fill();

    // control ring
    g.strokeStyle = "rgba(244,247,251,0.18)";
    g.lineWidth = 14;
    g.beginPath();
    g.arc(RING.x, RING.y, RING.r, 0, TAU);
    g.stroke();
    const a = this.phi - Math.PI / 2;
    g.fillStyle = color;
    g.beginPath();
    g.arc(RING.x + Math.cos(a) * RING.r, RING.y + Math.sin(a) * RING.r, 18, 0, TAU);
    g.fill();
    g.fillStyle = "#F4F7FB";
    g.font = "700 24px Bebas Neue, Impact, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(`${name} SPINS`, RING.x, RING.y - 10);
    g.font = "700 18px Bebas Neue, Impact, sans-serif";
    g.fillStyle = "rgba(244,247,251,0.6)";
    g.fillText(this.spinnerIsBot ? "BOT" : "DRAG IN CIRCLES", RING.x, RING.y + 16);
  }

  private drawHud(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    const remaining = this.phase === "play" ? ROUND_SECONDS - this.phaseT : this.phase === "intro" ? ROUND_SECONDS : 0;
    drawTimerBar(g, width, remaining, ROUND_SECONDS);

    // scores
    g.font = "700 22px Bebas Neue, Impact, sans-serif";
    g.textBaseline = "top";
    g.textAlign = "left";
    this.seats.forEach((s, i) => {
      g.fillStyle = s.player.color;
      g.fillText(`${s.player.name} ${s.score}`, 40 + i * 160, 36);
    });
    g.textAlign = "right";
    g.fillStyle = "rgba(244,247,251,0.6)";
    g.fillText(`ROUND ${Math.min(this.round + 1, this.order.length)}/${this.order.length}`, width - 40, 36);

    // jumper tap strips
    const n = this.jumpers.length;
    const w = width / Math.max(1, n);
    this.jumpers.forEach((j, k) => {
      const p = this.seats[j.seat]!.player;
      g.fillStyle = j.out ? "rgba(244,247,251,0.03)" : "rgba(244,247,251,0.07)";
      g.fillRect(k * w + 4, STRIP_Y, w - 8, height - STRIP_Y - 6);
      g.strokeStyle = p.color;
      g.lineWidth = 2;
      g.strokeRect(k * w + 4, STRIP_Y, w - 8, height - STRIP_Y - 6);
      g.fillStyle = p.color;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(p.kind === "bot" ? `${p.name} (BOT)` : `${p.name}: TAP TO JUMP`, k * w + w / 2, (STRIP_Y + height) / 2);
    });
  }

  isFinished(): boolean {
    return this.phase === "done" && this.phaseT >= 2;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({ playerId: s.player.id, score: s.score }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const s of this.seats) {
      out.push({ playerId: s.player.id, label: "Rounds survived", value: String(s.survived) });
      if (this.order[0]! >= 0) out.push({ playerId: s.player.id, label: "Knockouts as spinner", value: String(s.knockouts) });
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

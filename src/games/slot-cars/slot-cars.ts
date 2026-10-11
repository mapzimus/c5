import { fillArena } from "../../core/draw";
import { Callouts, Juice } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  botThrottle,
  buildTrack,
  danger,
  FINISH_GRACE_S,
  LAPS_TO_WIN,
  lanePos,
  newBotSkill,
  newCar,
  ordinal,
  pointsForPlace,
  rollBotNoise,
  SPIN_S,
  standings,
  stepCar,
  trackAt,
  TRACK_SHAPES,
  VMAX,
  type BotSkill,
  type Car,
  type Track,
} from "./logic";

export const slotCars: GameDefinition = {
  id: "slot-cars",
  name: "Slot Cars",
  tagline: "Hold to go. Let go or spin.",
  description:
    "A top-down slot-car race on one of three tracks. Hold your zone to floor it, release to brake. " +
    "Your car glows green to red as you near the bend's limit: go over and you spin out for a second. " +
    "Hit the turbo pad on the straight at full throttle for a boost. First to 3 laps wins.",
  durationMs: 0,
  controls: "Hold your zone to accelerate. Release before bends.",
  create: (ctx) => new SlotCars(ctx),
};

const FONT = "Bebas Neue, Impact, sans-serif";
const INTRO_S = 3.0;
const FINAL_S = 2.6;
const BOT_ROLL_S = 0.3;
const TRACK_NAMES: Record<string, string> = { oval: "SPEEDWAY", kidney: "THE BEAN", hairpin: "HAIRPIN" };

type Phase = "intro" | "race" | "final";

interface Seat {
  player: Player;
  x: number;
  w: number;
  car: Car;
  offset: number;
  skill: BotSkill;
  botT: number;
  pointers: Set<number>;
  /** Short HUD message ("SPIN OUT!", "TURBO!") and its remaining life. */
  note: string;
  noteColor: string;
  noteLife: number;
  skidT: number;
}

class SlotCars implements GameInstance {
  private readonly seats: Seat[];
  private readonly track: Track;
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private phase: Phase = "intro";
  private timer = INTRO_S;
  private introStep = -1;
  private raceTime = 0;
  private clock = 0;
  private finishedCount = 0;
  private winnerAt: number | null = null;
  private finalLapCalled = false;
  private finished = false;
  private results: number[] = [];

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    const n = ctx.players.length;
    const scale = Math.min(ctx.width / 1280, ctx.height / 720);
    const shape = ctx.rng.pick(TRACK_SHAPES);
    this.track = buildTrack(shape, ctx.width / 2, ctx.height * 0.53, scale * 0.9, n);
    const w = ctx.width / n;
    this.seats = ctx.players.map((player, i) => ({
      player,
      x: i * w,
      w,
      car: newCar(),
      offset: this.track.laneOffsets[i]!,
      skill: newBotSkill(ctx.rng),
      botT: ctx.rng.float(0, BOT_ROLL_S),
      pointers: new Set<number>(),
      note: "",
      noteColor: "#F4F7FB",
      noteLife: 0,
      skidT: 0,
    }));
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
  }

  // ---- update ----

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.clock += realDt;
    for (const s of this.seats) s.noteLife = Math.max(0, s.noteLife - realDt);
    if (this.finished) return;

    if (this.phase === "intro") {
      this.timer -= dt;
      const step = Math.min(2, Math.floor(INTRO_S - this.timer));
      if (step !== this.introStep) {
        this.introStep = step;
        const text = step === 0 ? TRACK_NAMES[this.track.shape] ?? "READY" : step === 1 ? "SET" : "GO!";
        this.callouts.show(text, step === 2 ? "#B8FF3D" : "#F4F7FB", { size: step === 2 ? 150 : 84, life: 1, y: 0.5 });
        if (step === 2) {
          this.ctx.sfx.go();
          this.juice.shake(0.2);
          this.phase = "race";
        } else this.ctx.sfx.countdown();
      }
      return;
    }
    if (this.phase === "final") {
      this.timer -= dt;
      for (const s of this.seats) stepCar(s.car, this.track, dt, this.raceTime);
      if (this.timer <= 0) this.finished = true;
      return;
    }

    this.raceTime += dt;
    for (const s of this.seats) this.stepSeat(s, dt);

    const allDone = this.seats.every((s) => s.car.finished);
    const graceOver = this.winnerAt !== null && this.raceTime - this.winnerAt >= FINISH_GRACE_S;
    if (allDone || graceOver) this.endRace();
  }

  private stepSeat(s: Seat, dt: number): void {
    const car = s.car;
    if (!car.finished && car.spin <= 0) {
      if (s.player.kind === "bot") {
        s.botT -= dt;
        if (s.botT <= 0) {
          s.botT = BOT_ROLL_S;
          rollBotNoise(s.skill, this.ctx.rng);
        }
        car.throttle = botThrottle(car, this.track, s.skill);
      } else {
        car.throttle = s.pointers.size > 0;
      }
    }

    const events = stepCar(car, this.track, dt, this.raceTime);
    const pos = lanePos(this.track, s.offset, car.s);
    for (const ev of events) {
      if (ev === "spin") {
        this.note(s, "SPIN OUT!", "#FF3D7A");
        this.ctx.sfx.miss();
        this.juice.shake(0.3);
        this.juice.hitStop(0.04);
        this.juice.burst(pos.x, pos.y, ["#9aa3b2", "#5c6675", s.player.color], { count: 22, speed: 160, gravity: 0, life: 0.9, size: 6 });
      } else if (ev === "turbo") {
        this.note(s, "TURBO!", "#FFB020");
        this.ctx.sfx.whoosh();
        this.juice.burst(pos.x, pos.y, ["#FFB020", "#fff2b0"], {
          count: 16, speed: 260, gravity: 0, life: 0.4, size: 5, angle: pos.angle + Math.PI, spread: 0.8,
        });
      } else if (ev === "lap") {
        if (!car.finished) {
          this.ctx.sfx.tick();
          if (car.lap === LAPS_TO_WIN - 1 && !this.finalLapCalled) {
            this.finalLapCalled = true;
            this.callouts.show("FINAL LAP!", "#FFB020", { size: 64, life: 1.2, y: 0.5 });
            this.ctx.sfx.streak(2);
          }
        }
      } else if (ev === "finish") {
        this.finishedCount += 1;
        car.place = this.finishedCount;
        this.juice.burst(pos.x, pos.y, [s.player.color, "#ffffff", "#FFB020"], { count: 30, speed: 300, gravity: 200, life: 0.8 });
        if (this.finishedCount === 1) {
          this.winnerAt = this.raceTime;
          this.callouts.show(`${s.player.name} WINS!`, s.player.color, { size: 84, life: 2.2, y: 0.5 });
          this.ctx.sfx.win();
          this.juice.shake(0.4);
        } else {
          this.callouts.show(`${s.player.name} ${ordinal(car.place)}`, s.player.color, { size: 56, life: 1.2, y: 0.5 });
          this.ctx.sfx.collect();
        }
      }
    }

    // Skid smoke when living on the edge.
    if (!car.finished && car.spin <= 0 && danger(car, this.track) > 0.9) {
      s.skidT -= dt;
      if (s.skidT <= 0) {
        s.skidT = 0.06;
        this.juice.burst(pos.x, pos.y, "rgba(200,210,225,0.7)", {
          count: 2, speed: 60, gravity: 0, life: 0.35, size: 4, angle: pos.angle + Math.PI, spread: 1.2,
        });
      }
    }
  }

  private note(s: Seat, text: string, color: string): void {
    s.note = text;
    s.noteColor = color;
    s.noteLife = 1.2;
  }

  private endRace(): void {
    const order = standings(this.seats.map((s) => s.car), this.track);
    let place = this.finishedCount;
    for (const i of order) {
      const car = this.seats[i]!.car;
      if (!car.finished) {
        place += 1;
        car.place = place;
        car.finished = true;
      }
    }
    this.results = order;
    this.phase = "final";
    this.timer = FINAL_S;
    this.callouts.show("RACE OVER", "#F4F7FB", { size: 72, life: FINAL_S, y: 0.16 });
    this.ctx.sfx.streak(3);
  }

  // ---- input ----

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private readonly onDown = (e: PointerEvent): void => {
    const p = this.toLogical(e);
    for (const s of this.seats) {
      if (s.player.kind !== "human") continue;
      if (p.x >= s.x && p.x < s.x + s.w) {
        e.preventDefault();
        s.pointers.add(e.pointerId);
        return;
      }
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    for (const s of this.seats) s.pointers.delete(e.pointerId);
  };

  // ---- render ----

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);
    for (const s of this.seats) this.drawZone(g, s);
    this.drawTrack(g);
    for (const s of this.seats) this.drawCar(g, s);
    this.juice.end(g);
    for (const s of this.seats) this.drawHud(g, s);
    if (this.phase === "final") this.drawResults(g);
    this.callouts.draw(g, width, height);
  }

  private drawZone(g: CanvasRenderingContext2D, s: Seat): void {
    const h = this.ctx.height;
    const held = s.car.throttle && this.phase === "race" && s.car.spin <= 0;
    g.save();
    g.globalAlpha = held ? 0.13 : 0.05;
    g.fillStyle = s.player.color;
    g.fillRect(s.x, 0, s.w, h);
    g.globalAlpha = 1;
    g.strokeStyle = "rgba(244,247,251,0.1)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(s.x + s.w, 0);
    g.lineTo(s.x + s.w, h);
    g.stroke();
    g.restore();
  }

  private tracePath(g: CanvasRenderingContext2D, offset: number, every: number): void {
    const t = this.track;
    g.beginPath();
    for (let i = 0; i < t.pts.length; i += every) {
      const p = t.pts[i]!;
      const x = p.x - Math.sin(p.angle) * offset;
      const y = p.y + Math.cos(p.angle) * offset;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
  }

  private drawTrack(g: CanvasRenderingContext2D): void {
    const t = this.track;
    const road = t.roadWidth;
    g.save();
    g.lineJoin = "round";
    g.lineCap = "round";
    // Kerbs: red/white dashes peeking out from under the road.
    this.tracePath(g, 0, 2);
    g.lineWidth = road + 12;
    g.strokeStyle = "#d8dde6";
    g.stroke();
    g.setLineDash([26, 26]);
    g.strokeStyle = "#d63b4a";
    g.stroke();
    g.setLineDash([]);
    // Road.
    g.lineWidth = road;
    g.strokeStyle = "#1a2234";
    g.stroke();
    // Lane grooves in each player's colour.
    g.lineWidth = 3;
    for (const s of this.seats) {
      this.tracePath(g, s.offset, 2);
      g.strokeStyle = s.player.color;
      g.globalAlpha = 0.28;
      g.stroke();
    }
    g.globalAlpha = 1;

    // Turbo pad: pulsing chevrons across the road.
    const pulse = 0.55 + 0.45 * Math.sin(this.clock * 6);
    g.strokeStyle = `rgba(255,176,32,${0.45 + 0.5 * pulse})`;
    g.lineWidth = 7;
    g.lineCap = "butt";
    const half = road / 2 - 6;
    for (let s = t.padStart + 12; s < t.padEnd; s += 30) {
      const p = trackAt(t, s);
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.angle);
      g.beginPath();
      g.moveTo(-12, -half);
      g.lineTo(8, 0);
      g.lineTo(-12, half);
      g.stroke();
      g.restore();
    }

    // Start / finish line: a checkered band.
    const p0 = trackAt(t, 0);
    g.save();
    g.translate(p0.x, p0.y);
    g.rotate(p0.angle);
    const cell = 9;
    const cols = 2;
    const rows = Math.ceil(road / cell);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        g.fillStyle = (c + r) % 2 === 0 ? "#f4f7fb" : "#0b0f18";
        g.fillRect(-cell + c * cell, -road / 2 + r * cell, cell, Math.min(cell, road - r * cell));
      }
    }
    g.restore();
    g.restore();
  }

  private dangerColor(d: number): string {
    const t = Math.max(0, Math.min(1, (d - 0.45) / 0.5));
    const hue = 125 * (1 - t);
    return `hsl(${hue.toFixed(0)}, 100%, 55%)`;
  }

  private drawCar(g: CanvasRenderingContext2D, s: Seat): void {
    const car = s.car;
    const t = this.track;
    const pos = lanePos(t, s.offset, car.s);
    const here = trackAt(t, car.s);
    const spinning = car.spin > 0;
    const prog = spinning ? 1 - car.spin / SPIN_S : 0;
    let x = pos.x;
    let y = pos.y;
    let angle = pos.angle;
    if (spinning) {
      // Thrown outward from the bend, spinning, then settles back into the slot.
      const out = -Math.sign(here.k || 1) * Math.sin(prog * Math.PI) * 26;
      x += -Math.sin(here.angle) * out;
      y += Math.cos(here.angle) * out;
      angle += Math.sin(prog * Math.PI * 0.5) * Math.PI * 4;
    }
    const d = car.finished ? 0 : danger(car, t);
    const glow = spinning ? "#ff3d3d" : this.dangerColor(d);

    g.save();
    g.translate(x, y);
    // Danger ring under the car.
    const ring = g.createRadialGradient(0, 0, 4, 0, 0, 26);
    ring.addColorStop(0, glow);
    ring.addColorStop(1, "rgba(0,0,0,0)");
    g.globalAlpha = car.finished ? 0.25 : 0.35 + 0.5 * d;
    g.fillStyle = ring;
    g.beginPath();
    g.arc(0, 0, 26, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;

    g.rotate(angle);
    g.shadowColor = glow;
    g.shadowBlur = 8 + 22 * d;
    // Wheels.
    g.fillStyle = "#0b0f18";
    g.fillRect(-11, -10, 7, 20);
    g.fillRect(4, -10, 7, 20);
    // Body.
    g.fillStyle = s.player.color;
    g.beginPath();
    g.moveTo(-15, -7);
    g.lineTo(10, -7);
    g.lineTo(16, -3);
    g.lineTo(16, 3);
    g.lineTo(10, 7);
    g.lineTo(-15, 7);
    g.closePath();
    g.fill();
    g.shadowBlur = 0;
    // Cockpit.
    g.fillStyle = "rgba(7,11,20,0.75)";
    g.fillRect(-3, -4, 9, 8);
    // Nose stripe.
    g.fillStyle = "rgba(255,255,255,0.45)";
    g.fillRect(9, -2, 6, 4);
    g.restore();
  }

  private drawHud(g: CanvasRenderingContext2D, s: Seat): void {
    const car = s.car;
    const cx = s.x + s.w / 2;
    const h = this.ctx.height;
    g.save();
    g.textAlign = "center";
    g.textBaseline = "top";
    g.fillStyle = s.player.color;
    g.font = `700 30px ${FONT}`;
    g.fillText(s.player.name, cx, 10);

    g.fillStyle = "#F4F7FB";
    g.font = `700 40px ${FONT}`;
    const lap = Math.min(LAPS_TO_WIN, car.lap + 1);
    g.fillText(car.finished && car.place > 0 ? ordinal(car.place).toUpperCase() : `LAP ${lap}/${LAPS_TO_WIN}`, cx, 40);

    if (s.noteLife > 0) {
      g.globalAlpha = Math.min(1, s.noteLife / 0.4);
      g.fillStyle = s.noteColor;
      g.font = `700 30px ${FONT}`;
      g.fillText(s.note, cx, 84);
      g.globalAlpha = 1;
    }

    // Bottom strip: throttle bar in danger colour plus a hint.
    const barW = Math.min(220, s.w - 40);
    const barY = h - 46;
    const d = car.finished ? 0 : danger(car, this.track);
    g.fillStyle = "rgba(244,247,251,0.12)";
    g.fillRect(cx - barW / 2, barY, barW, 10);
    g.fillStyle = car.spin > 0 ? "#FF3D7A" : this.dangerColor(d);
    g.fillRect(cx - barW / 2, barY, barW * Math.min(1, car.v / VMAX), 10);
    g.textBaseline = "bottom";
    g.font = `700 22px ${FONT}`;
    if (s.player.kind === "human" && this.phase !== "final") {
      const held = s.pointers.size > 0;
      g.fillStyle = held ? s.player.color : "rgba(244,247,251,0.4)";
      g.fillText(held ? "FLOOR IT" : "HOLD TO GO", cx, barY - 6);
    } else if (s.player.kind === "bot") {
      g.fillStyle = "rgba(244,247,251,0.3)";
      g.fillText("BOT", cx, barY - 6);
    }
    g.restore();
  }

  private drawResults(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 8;
    g.strokeStyle = "rgba(7,11,20,0.85)";
    this.results.forEach((i, row) => {
      const s = this.seats[i]!;
      const text = `${ordinal(s.car.place)}  ${s.player.name}`;
      const y = height * 0.34 + row * 58;
      g.font = `700 ${row === 0 ? 56 : 44}px ${FONT}`;
      g.strokeText(text, width / 2, y);
      g.fillStyle = s.player.color;
      g.fillText(text, width / 2, y);
    });
    g.restore();
  }

  // ---- lifecycle ----

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({ playerId: s.player.id, score: pointsForPlace(s.car.place) }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const s of this.seats) {
      out.push({ playerId: s.player.id, label: "Spin-outs", value: String(s.car.spinouts) });
      out.push({ playerId: s.player.id, label: "Best lap", value: s.car.bestLap === null ? "-" : `${s.car.bestLap.toFixed(1)}s` });
    }
    return out;
  }

  destroy(): void {
    const c = this.ctx.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
  }
}

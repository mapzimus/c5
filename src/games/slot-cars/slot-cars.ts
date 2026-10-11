import { fillArena } from "../../core/draw";
import { Callouts, Juice, loadBest, saveBest } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  botHop,
  botThrottle,
  botWantsOil,
  buildTrack,
  danger,
  dropOil,
  FINISH_GRACE_S,
  HOP_S,
  hopCar,
  laneCountFor,
  lanePos,
  lapFromScore,
  lapScore,
  newBotSkill,
  newCar,
  newRace,
  OIL_COOLDOWN_S,
  OIL_LEN,
  OIL_LIFE_S,
  ordinal,
  pointsForPlace,
  rollBotNoise,
  SPIN_S,
  standings,
  startLane,
  stepRace,
  trackAt,
  TRACK_SHAPES,
  VMAX,
  type BotSkill,
  type Car,
  type Race,
  type Track,
} from "./logic";

export const slotCars: GameDefinition = {
  id: "slot-cars",
  name: "Slot Hop",
  tagline: "Hold to go. Tap to hop slots. Shunt to win.",
  description:
    "A top-down slot-car race where the slots are not equal: the inside slot is shorter but its bends are tighter. " +
    "Hold your zone to floor it, release to brake, and tap to hop a slot: top of your zone hops out, bottom hops in. " +
    "Cars in one slot can't pass each other, so block, shunt, or hop around. Spin out over the limit, boost on the turbo " +
    "pad, and survive the final-lap OVERDRIVE. Finished drivers become marshals: tap to drop oil on the stragglers.",
  durationMs: 0,
  controls: "Hold to accelerate. Tap top: hop out. Tap bottom: hop in. Finished? Tap to drop oil.",
  create: (ctx) => new SlotCars(ctx),
};

const FONT = "Bebas Neue, Impact, sans-serif";
const INTRO_S = 3.0;
const FINAL_S = 2.6;
const BOT_ROLL_S = 0.3;
/** A press released within this long is a tap (hop), not a throttle hold. */
const TAP_S = 0.2;
const TRACK_NAMES: Record<string, string> = { oval: "SPEEDWAY", kidney: "THE BEAN", hairpin: "HAIRPIN" };
const BEST_KEY = "slot-cars";
const BEST_VERSION = "v2";

type Phase = "intro" | "race" | "final";

interface Seat {
  player: Player;
  x: number;
  w: number;
  /** Index into race.cars. */
  i: number;
  skill: BotSkill;
  botT: number;
  /** Active pointers: when they went down and where (y), to tell taps from holds. */
  pointers: Map<number, { t: number; y: number }>;
  /** Short HUD message ("SPIN OUT!", "TURBO!") and its remaining life. */
  note: string;
  noteColor: string;
  noteLife: number;
  skidT: number;
  /** Flash the hop hint that was just used: 1 = out, -1 = in. */
  hopFlash: number;
  hopFlashLife: number;
  marshalNoteShown: boolean;
}

class SlotCars implements GameInstance {
  private readonly seats: Seat[];
  private readonly track: Track;
  private readonly race: Race;
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private phase: Phase = "intro";
  private timer = INTRO_S;
  private introStep = -1;
  private clock = 0;
  private finishedCount = 0;
  private winnerAt: number | null = null;
  private finished = false;
  private results: number[] = [];
  private bestScore: number;
  private overdriveT = 0;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    const n = ctx.players.length;
    const scale = Math.min(ctx.width / 1280, ctx.height / 720);
    const shape = ctx.rng.pick(TRACK_SHAPES);
    const lanes = laneCountFor(n);
    this.track = buildTrack(shape, ctx.width / 2, ctx.height * 0.53, scale * 0.9, lanes);
    this.race = newRace(this.track, ctx.players.map((_, i) => newCar(startLane(i, n, lanes))));
    this.bestScore = loadBest(BEST_KEY, `${BEST_VERSION}-${shape}`);
    const w = ctx.width / n;
    this.seats = ctx.players.map((player, i) => ({
      player,
      x: i * w,
      w,
      i,
      skill: newBotSkill(ctx.rng),
      botT: ctx.rng.float(0, BOT_ROLL_S),
      pointers: new Map(),
      note: "",
      noteColor: "#F4F7FB",
      noteLife: 0,
      skidT: 0,
      hopFlash: 0,
      hopFlashLife: 0,
      marshalNoteShown: false,
    }));
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
  }

  private car(s: Seat): Car {
    return this.race.cars[s.i]!;
  }

  // ---- update ----

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.clock += realDt;
    for (const s of this.seats) {
      s.noteLife = Math.max(0, s.noteLife - realDt);
      s.hopFlashLife = Math.max(0, s.hopFlashLife - realDt);
    }
    if (this.race.overdrive) this.overdriveT += realDt;
    if (this.finished) return;

    if (this.phase === "intro") {
      this.timer -= dt;
      const step = Math.min(2, Math.floor(INTRO_S - this.timer));
      if (step !== this.introStep) {
        this.introStep = step;
        const text = step === 0 ? TRACK_NAMES[this.track.shape] ?? "READY" : step === 1 ? "SET" : "GO!";
        this.callouts.show(text, step === 2 ? "#B8FF3D" : "#F4F7FB", { size: step === 2 ? 150 : 84, life: 1, y: 0.5 });
        if (step === 0) {
          this.callouts.show("HOLD = GO   TAP = HOP SLOT", "#FFB020", { size: 40, life: 2.8, y: 0.64 });
          this.ctx.sfx.countdown();
        } else if (step === 2) {
          this.ctx.sfx.go();
          this.juice.shake(0.2);
          this.phase = "race";
        } else this.ctx.sfx.countdown();
      }
      return;
    }
    if (this.phase === "final") {
      this.timer -= dt;
      stepRace(this.race, dt);
      if (this.timer <= 0) this.finished = true;
      return;
    }

    for (const s of this.seats) this.control(s, dt);
    const events = stepRace(this.race, dt);
    for (const ev of events) this.onEvent(ev.type, ev.car, ev.other);
    for (const s of this.seats) this.skid(s, dt);

    const allDone = this.race.cars.every((c) => c.finished);
    const graceOver = this.winnerAt !== null && this.race.time - this.winnerAt >= FINISH_GRACE_S;
    if (allDone || graceOver) this.endRace();
  }

  /** Set this seat's throttle, hop and oil for the frame (bots decide here; humans via pointers). */
  private control(s: Seat, dt: number): void {
    const car = this.car(s);
    if (s.player.kind === "bot") {
      s.botT -= dt;
      const roll = s.botT <= 0;
      if (roll) {
        s.botT = BOT_ROLL_S;
        rollBotNoise(s.skill, this.ctx.rng);
      }
      if (car.finished) {
        if (roll && botWantsOil(this.race, s.i) && this.ctx.rng.next() < 0.85) {
          if (dropOil(this.race, s.i)) this.onEvent("oil", s.i);
        }
        return;
      }
      if (car.spin > 0) return;
      car.throttle = botThrottle(this.race, s.i, s.skill);
      if (roll) {
        const dir = botHop(this.race, s.i, s.skill);
        if (dir !== 0) this.tryHop(s, dir);
      }
      return;
    }
    if (!car.finished && car.spin <= 0) car.throttle = s.pointers.size > 0;
  }

  private tryHop(s: Seat, dir: -1 | 1): void {
    const result = hopCar(this.race, s.i, dir);
    if (result === "hop") {
      s.hopFlash = dir;
      s.hopFlashLife = 0.5;
      this.onEvent("hop", s.i);
    } else if (result === "noroom") this.onEvent("noroom", s.i);
  }

  private onEvent(type: string, i: number, other?: number): void {
    const s = this.seats[i];
    if (type === "overdrive") {
      this.callouts.show("FINAL LAP: OVERDRIVE!", "#FFB020", { size: 72, life: 1.6, y: 0.5 });
      this.ctx.sfx.streak(3);
      this.juice.shake(0.35);
      this.juice.slowMo(0.25, 0.5);
      return;
    }
    if (!s) return;
    const car = this.car(s);
    const pos = this.carPos(s);
    switch (type) {
      case "spin":
        this.note(s, "SPIN OUT!", "#FF3D7A");
        this.ctx.sfx.miss();
        this.juice.shake(0.3);
        this.juice.hitStop(0.04);
        this.juice.burst(pos.x, pos.y, ["#9aa3b2", "#5c6675", s.player.color], { count: 22, speed: 160, gravity: 0, life: 0.9, size: 6 });
        break;
      case "turbo":
        this.note(s, "TURBO!", "#FFB020");
        this.ctx.sfx.whoosh();
        this.juice.burst(pos.x, pos.y, ["#FFB020", "#fff2b0"], {
          count: 16, speed: 260, gravity: 0, life: 0.4, size: 5, angle: pos.angle + Math.PI, spread: 0.8,
        });
        break;
      case "hop":
        this.ctx.sfx.select();
        this.juice.burst(pos.x, pos.y, [s.player.color, "#F4F7FB"], { count: 8, speed: 120, gravity: 0, life: 0.3, size: 3 });
        break;
      case "noroom":
        this.note(s, "NO ROOM!", "#9aa3b2", 0.6);
        this.ctx.sfx.tick();
        break;
      case "bump": {
        const victim = other === undefined ? undefined : this.seats[other];
        this.note(s, s.player.kind === "bot" ? "MY SLOT!" : "SHUNT!", "#FFB020");
        if (victim) this.note(victim, "SHUNTED!", "#FF3D7A");
        this.ctx.sfx.hit();
        this.juice.shake(0.15);
        this.juice.hitStop(0.02);
        this.juice.burst(pos.x, pos.y, ["#F4F7FB", s.player.color], { count: 10, speed: 140, gravity: 0, life: 0.35, size: 4 });
        break;
      }
      case "nearmiss":
        this.note(s, "SO CLOSE!", "#B8FF3D");
        this.ctx.sfx.collect();
        break;
      case "cleanlap":
        if (car.cleanLaps >= 2 && !car.finished) this.note(s, `CLEAN x${car.cleanLaps}`, "#3EE0FF");
        break;
      case "lap":
        if (!car.finished) this.ctx.sfx.tick();
        this.checkRecord(s);
        break;
      case "oil":
        this.note(s, s.player.kind === "bot" ? "SLIPPY!" : "OIL DROPPED", "#B8FF3D", 0.8);
        this.ctx.sfx.tick();
        this.juice.burst(pos.x, pos.y, ["#1a1f2e", "#6b4bff", "#3EE0FF"], { count: 12, speed: 90, gravity: 0, life: 0.5, size: 5 });
        break;
      case "finish":
        this.finishedCount += 1;
        car.place = this.finishedCount;
        this.checkRecord(s);
        this.juice.burst(pos.x, pos.y, [s.player.color, "#ffffff", "#FFB020"], { count: 30, speed: 300, gravity: 200, life: 0.8 });
        if (this.finishedCount === 1) {
          this.winnerAt = this.race.time;
          this.callouts.show(`${s.player.name} WINS!`, s.player.color, { size: 84, life: 2.2, y: 0.5 });
          this.ctx.sfx.win();
          this.juice.shake(0.4);
        } else {
          this.callouts.show(`${s.player.name} ${ordinal(car.place)}`, s.player.color, { size: 56, life: 1.2, y: 0.5 });
          this.ctx.sfx.collect();
        }
        if (s.player.kind === "human" && !this.race.cars.every((c) => c.finished)) this.note(s, "MARSHAL: TAP = OIL", "#B8FF3D", 3);
        break;
      default:
        break;
    }
  }

  /** Human seats: a new fastest lap on this track is a record. */
  private checkRecord(s: Seat): void {
    if (s.player.kind !== "human") return;
    const car = this.car(s);
    if (car.bestLap === null) return;
    const score = lapScore(car.bestLap);
    if (score <= this.bestScore) return;
    const had = this.bestScore > 0;
    if (saveBest(BEST_KEY, score, `${BEST_VERSION}-${this.track.shape}`)) {
      this.bestScore = score;
      if (had) {
        this.callouts.show(`NEW RECORD ${car.bestLap.toFixed(1)}s`, "#B8FF3D", { size: 56, life: 1.6, y: 0.62 });
        this.ctx.sfx.streak(4);
      }
    }
  }

  private skid(s: Seat, dt: number): void {
    const car = this.car(s);
    if (car.finished || car.spin > 0 || danger(this.race, s.i) <= 0.9) return;
    s.skidT -= dt;
    if (s.skidT <= 0) {
      s.skidT = 0.06;
      const pos = this.carPos(s);
      this.juice.burst(pos.x, pos.y, "rgba(200,210,225,0.7)", {
        count: 2, speed: 60, gravity: 0, life: 0.35, size: 4, angle: pos.angle + Math.PI, spread: 1.2,
      });
    }
  }

  private note(s: Seat, text: string, color: string, life = 1.2): void {
    s.note = text;
    s.noteColor = color;
    s.noteLife = life;
  }

  private endRace(): void {
    const order = standings(this.race.cars, this.track);
    let place = this.finishedCount;
    for (const i of order) {
      const car = this.race.cars[i]!;
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
      if (p.x < s.x || p.x >= s.x + s.w) continue;
      e.preventDefault();
      const car = this.car(s);
      if (car.finished) {
        if (this.phase === "race" && dropOil(this.race, s.i)) this.onEvent("oil", s.i);
        return;
      }
      s.pointers.set(e.pointerId, { t: this.clock, y: p.y });
      return;
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    for (const s of this.seats) {
      const press = s.pointers.get(e.pointerId);
      if (!press) continue;
      s.pointers.delete(e.pointerId);
      if (this.phase === "race" && this.clock - press.t < TAP_S) {
        this.tryHop(s, press.y < this.ctx.height / 2 ? 1 : -1);
      }
    }
  };

  // ---- render ----

  /** Drawn position of a seat's car, including the hop tween between slots. */
  private carPos(s: Seat): { x: number; y: number; angle: number } {
    const car = this.car(s);
    const t = this.track;
    const to = t.laneOffsets[car.lane] ?? 0;
    const from = t.laneOffsets[car.laneFrom] ?? to;
    const k = car.hopT > 0 ? 1 - car.hopT / HOP_S : 1;
    const ease = k * k * (3 - 2 * k);
    return lanePos(t, from + (to - from) * ease, car.s);
  }

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);
    for (const s of this.seats) this.drawZone(g, s);
    this.drawTrack(g);
    this.drawOil(g);
    // Marshals under the racers.
    for (const s of this.seats) if (this.car(s).finished) this.drawCar(g, s);
    for (const s of this.seats) if (!this.car(s).finished) this.drawCar(g, s);
    this.juice.end(g);
    for (const s of this.seats) this.drawHud(g, s);
    if (this.phase === "final") this.drawResults(g);
    this.callouts.draw(g, width, height);
  }

  private drawZone(g: CanvasRenderingContext2D, s: Seat): void {
    const h = this.ctx.height;
    const car = this.car(s);
    const held = car.throttle && this.phase === "race" && car.spin <= 0 && !car.finished;
    g.save();
    g.globalAlpha = held ? 0.13 : 0.05;
    g.fillStyle = s.player.color;
    g.fillRect(s.x, 0, s.w, h);
    // Hop flash: light up the half of the zone that was tapped.
    if (s.hopFlashLife > 0) {
      g.globalAlpha = 0.18 * (s.hopFlashLife / 0.5);
      g.fillStyle = "#F4F7FB";
      if (s.hopFlash > 0) g.fillRect(s.x, 0, s.w, h / 2);
      else g.fillRect(s.x, h / 2, s.w, h / 2);
    }
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
    const od = this.race.overdrive;
    const odPulse = od ? 0.5 + 0.5 * Math.sin(this.overdriveT * 10) : 0;
    g.save();
    g.lineJoin = "round";
    g.lineCap = "round";
    // Kerbs: red/white dashes peeking out from under the road; orange/white and pulsing in overdrive.
    this.tracePath(g, 0, 2);
    g.lineWidth = road + 12;
    g.strokeStyle = od ? `rgba(255,${Math.round(210 + 45 * odPulse)},${Math.round(120 + 100 * odPulse)},1)` : "#d8dde6";
    g.stroke();
    g.setLineDash([26, 26]);
    g.lineDashOffset = od ? -this.overdriveT * 160 : 0;
    g.strokeStyle = od ? "#ff7a1a" : "#d63b4a";
    g.stroke();
    g.setLineDash([]);
    g.lineDashOffset = 0;
    // Road.
    g.lineWidth = road;
    g.strokeStyle = od ? "#241a2e" : "#1a2234";
    g.stroke();
    // Slot grooves: the inside slot is brighter (shorter, tighter), the outside dimmer.
    for (let l = 0; l < t.laneCount; l++) {
      this.tracePath(g, t.laneOffsets[l]!, 2);
      g.lineWidth = 3;
      g.strokeStyle = "#F4F7FB";
      g.globalAlpha = 0.07 + 0.1 * (1 - l / Math.max(1, t.laneCount - 1));
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

  private drawOil(g: CanvasRenderingContext2D): void {
    const t = this.track;
    const road = t.roadWidth;
    for (const o of this.race.oils) {
      const p = trackAt(t, o.s);
      const a = Math.min(1, o.life / 0.6) * Math.min(1, (OIL_LIFE_S - o.life) / 0.15 + 0.2);
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.angle);
      g.globalAlpha = a;
      g.fillStyle = "#07080f";
      g.beginPath();
      g.ellipse(0, 0, OIL_LEN / 2, road / 2 - 4, 0, 0, Math.PI * 2);
      g.fill();
      // Rainbow sheen.
      const sheen = g.createLinearGradient(-OIL_LEN / 2, 0, OIL_LEN / 2, 0);
      const ph = this.clock * 2;
      sheen.addColorStop(0, `hsla(${(ph * 60) % 360}, 90%, 60%, 0.35)`);
      sheen.addColorStop(0.5, `hsla(${(ph * 60 + 120) % 360}, 90%, 60%, 0.35)`);
      sheen.addColorStop(1, `hsla(${(ph * 60 + 240) % 360}, 90%, 60%, 0.35)`);
      g.fillStyle = sheen;
      g.beginPath();
      g.ellipse(0, 0, OIL_LEN / 2 - 6, road / 2 - 10, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }

  private dangerColor(d: number): string {
    const t = Math.max(0, Math.min(1, (d - 0.45) / 0.5));
    const hue = 125 * (1 - t);
    return `hsl(${hue.toFixed(0)}, 100%, 55%)`;
  }

  private drawCar(g: CanvasRenderingContext2D, s: Seat): void {
    const car = this.car(s);
    const t = this.track;
    const pos = this.carPos(s);
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
    const d = car.finished ? 0 : danger(this.race, s.i);
    const glow = spinning ? "#ff3d3d" : this.dangerColor(d);
    // Hop: the car lifts (scales up) mid-hop.
    const hop = car.hopT > 0 ? Math.sin((1 - car.hopT / HOP_S) * Math.PI) : 0;
    const scale = 1 + hop * 0.35;

    g.save();
    g.translate(x, y);
    if (car.finished) {
      // Marshal ghost: translucent, with a dashed ring that fills as the oil recharges.
      g.globalAlpha = 0.45;
      g.strokeStyle = s.player.color;
      g.lineWidth = 2;
      g.setLineDash([4, 4]);
      g.beginPath();
      g.arc(0, 0, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - car.oilCd / OIL_COOLDOWN_S));
      g.stroke();
      g.setLineDash([]);
    } else {
      // Danger ring under the car.
      const ring = g.createRadialGradient(0, 0, 4, 0, 0, 26);
      ring.addColorStop(0, glow);
      ring.addColorStop(1, "rgba(0,0,0,0)");
      g.globalAlpha = 0.35 + 0.5 * d;
      g.fillStyle = ring;
      g.beginPath();
      g.arc(0, 0, 26, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      if (car.catchUp) {
        g.strokeStyle = "#B8FF3D";
        g.lineWidth = 2;
        g.globalAlpha = 0.5 + 0.4 * Math.sin(this.clock * 8);
        g.beginPath();
        g.arc(0, 0, 21, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
    }

    g.rotate(angle);
    g.scale(scale, scale);
    if (!car.finished) {
      g.shadowColor = glow;
      g.shadowBlur = 8 + 22 * d;
    }
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

  private outlined(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, alpha = 1): void {
    g.globalAlpha = alpha;
    g.lineWidth = 5;
    g.strokeStyle = "rgba(7,11,20,0.75)";
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
    g.globalAlpha = 1;
  }

  private drawHud(g: CanvasRenderingContext2D, s: Seat): void {
    const car = this.car(s);
    const cx = s.x + s.w / 2;
    const h = this.ctx.height;
    const laps = this.race.laps;
    const human = s.player.kind === "human";
    g.save();
    g.textAlign = "center";
    g.textBaseline = "top";
    g.lineJoin = "round";
    g.font = `700 30px ${FONT}`;
    this.outlined(g, s.player.name, cx, 10, s.player.color);

    g.font = `700 40px ${FONT}`;
    const lap = Math.min(laps, car.lap + 1);
    const lapText = car.finished && car.place > 0 ? ordinal(car.place).toUpperCase() : `LAP ${lap}/${laps}`;
    this.outlined(g, lapText, cx, 40, "#F4F7FB");

    // Slot indicator: one tick per slot, innermost at the bottom, the car's slot lit.
    const ticks = this.track.laneCount;
    const tx = cx + 78;
    for (let l = 0; l < ticks; l++) {
      const ty = 74 - l * 9;
      g.fillStyle = l === car.lane ? s.player.color : "rgba(244,247,251,0.25)";
      g.fillRect(tx - 8, ty, 16, 5);
    }

    if (s.noteLife > 0) {
      g.font = `700 30px ${FONT}`;
      this.outlined(g, s.note, cx, 84, s.noteColor, Math.min(1, s.noteLife / 0.4));
    } else if (car.catchUp) {
      g.font = `700 24px ${FONT}`;
      this.outlined(g, "CATCH-UP GRIP", cx, 88, "#B8FF3D", 0.8);
    }

    // Bottom strip: throttle bar in danger colour plus a hint.
    const barW = Math.min(220, s.w - 40);
    const barY = h - 40;
    g.textBaseline = "bottom";
    if (car.finished) {
      if (this.phase === "race") {
        g.fillStyle = "rgba(244,247,251,0.12)";
        g.fillRect(cx - barW / 2, barY, barW, 10);
        g.fillStyle = car.oilCd > 0 ? "rgba(184,255,61,0.5)" : "#B8FF3D";
        g.fillRect(cx - barW / 2, barY, barW * (1 - car.oilCd / OIL_COOLDOWN_S), 10);
        g.font = `700 22px ${FONT}`;
        this.outlined(g, human ? (car.oilCd > 0 ? "OIL RECHARGING" : "TAP: DROP OIL") : "MARSHAL BOT", cx, barY - 6, human && car.oilCd <= 0 ? "#B8FF3D" : "rgba(244,247,251,0.45)");
      }
      g.restore();
      return;
    }
    const d = danger(this.race, s.i);
    g.fillStyle = "rgba(244,247,251,0.12)";
    g.fillRect(cx - barW / 2, barY, barW, 10);
    g.fillStyle = car.spin > 0 ? "#FF3D7A" : this.dangerColor(d);
    g.fillRect(cx - barW / 2, barY, barW * Math.min(1, car.v / VMAX), 10);
    g.font = `700 22px ${FONT}`;
    if (human && this.phase !== "final") {
      const held = s.pointers.size > 0;
      this.outlined(g, held ? "FLOOR IT" : "HOLD TO GO", cx, barY - 6, held ? s.player.color : "rgba(244,247,251,0.5)");
      // Hop hints at the top and bottom of the zone's halves.
      g.font = `700 20px ${FONT}`;
      const flashOut = s.hopFlashLife > 0 && s.hopFlash > 0;
      const flashIn = s.hopFlashLife > 0 && s.hopFlash < 0;
      g.textBaseline = "top";
      this.outlined(g, "TAP: HOP OUT", cx, 118, flashOut ? "#F4F7FB" : "rgba(244,247,251,0.4)");
      g.textBaseline = "bottom";
      this.outlined(g, "TAP: HOP IN", cx, barY - 32, flashIn ? "#F4F7FB" : "rgba(244,247,251,0.4)");
    } else if (!human) {
      this.outlined(g, "BOT", cx, barY - 6, "rgba(244,247,251,0.35)");
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
      const car = this.car(s);
      const text = `${ordinal(car.place)}  ${s.player.name}`;
      const y = height * 0.34 + row * 58;
      g.font = `700 ${row === 0 ? 56 : 44}px ${FONT}`;
      g.strokeText(text, width / 2, y);
      g.fillStyle = s.player.color;
      g.fillText(text, width / 2, y);
    });
    if (this.bestScore > 0) {
      g.font = `700 26px ${FONT}`;
      const y = height * 0.34 + this.results.length * 58 + 6;
      const text = `${TRACK_NAMES[this.track.shape] ?? ""} LAP RECORD ${lapFromScore(this.bestScore).toFixed(1)}s`;
      g.strokeText(text, width / 2, y);
      g.fillStyle = "rgba(244,247,251,0.7)";
      g.fillText(text, width / 2, y);
    }
    g.restore();
  }

  // ---- lifecycle ----

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({ playerId: s.player.id, score: pointsForPlace(this.car(s).place) }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const s of this.seats) {
      const car = this.car(s);
      out.push({ playerId: s.player.id, label: "Best lap", value: car.bestLap === null ? "-" : `${car.bestLap.toFixed(1)}s` });
      out.push({ playerId: s.player.id, label: "Spin-outs", value: String(car.spinouts) });
      out.push({ playerId: s.player.id, label: "Hops", value: String(car.hops) });
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

import { drawTimerBar, fillArena } from "../../core/draw";
import { Callouts, Juice, saveBest } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  botInput,
  buryCaught,
  chuteAt,
  DRAFT_HALF,
  DRAFT_MIN_GAP,
  DRAFT_RANGE,
  DRAFT_START,
  FINISH_GRACE_S,
  isOut,
  LENGTH,
  makeCourse,
  newBotBrain,
  newSled,
  ordinal,
  placeByDistance,
  pointsForPlace,
  RACE_CAP_S,
  rankBehind,
  RUNOUT,
  SLED_HALF,
  SNOWBALL_COOLDOWN_S,
  SNOWBALL_FLIGHT_S,
  SNOWBALL_HALF,
  startAvalanche,
  stepAvalanche,
  stepSled,
  stepSnowballs,
  throwSnowball,
  V0,
  V1,
  type Avalanche,
  type BotBrain,
  type Course,
  type Sled,
  type SledInput,
  type Snowball,
} from "./logic";

export const iceLuge: GameDefinition = {
  id: "ice-luge",
  name: "Avalanche Luge",
  tagline: "Tuck. Draft. Outrun the snow.",
  description:
    "Everyone sleds down the same winding ice chute at once, one lane each, and you see your " +
    "rivals as ghosts in your lane. Hold left or right to lean. Hold BOTH to TUCK: no steering, " +
    "big speed, and a heat meter that melts you down if you hold it too long. Ride right behind " +
    "a ghost to fill your DRAFT meter and fire a slingshot past it; the further back you are, " +
    "the faster it fills. The moment someone finishes, the avalanche is released: it buries " +
    "whoever it catches, and everyone already done lobs snowballs at the stragglers.",
  durationMs: 0,
  controls: "Hold left / right to steer, hold both to tuck. Done? Tap to throw snow.",
  create: (ctx) => new IceLuge(ctx),
};

const INTRO_S = 2.2;
const FINAL_S = 2.4;
const FONT = "Bebas Neue, Impact, sans-serif";
const ROW_STEP = 18;
const SPRAY_EVERY = 0.045;
const BEST_VERSION = "v2";
/** Records are "higher is better": this minus the finish time in ms. */
const BEST_BASE = 300000;

type Phase = "intro" | "race" | "final";

interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
}

interface Seat {
  player: Player;
  x: number;
  w: number;
  cx: number;
  laneHalf: number;
  sled: Sled;
  brain: BotBrain | null;
  floats: FloatText[];
  sprayT: number;
  flash: number;
  /** Snowball throw cooldown. */
  throwCd: number;
  /** Seconds since this seat was buried, for the tumble. */
  buriedT: number;
}

interface Touch {
  seat: number;
  side: -1 | 1;
}

const TAUNTS = ["SEE YA!", "TOO SLOW!", "BYE!", "WHOOSH!"];

class IceLuge implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly course: Course;
  private readonly pointers = new Map<number, Touch>();
  private readonly sledY: number;
  private readonly snowballs: Snowball[] = [];
  private phase: Phase = "intro";
  private timer = INTRO_S;
  private raceT = 0;
  private avalanche: Avalanche | null = null;
  private avalancheT = 0;
  private nextPlace = 1;
  private countdownDone = false;
  private finalCalled = false;
  private time = 0;
  private finished = false;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    this.course = makeCourse(ctx.rng);
    this.sledY = ctx.height * 0.74;
    const w = ctx.width / ctx.players.length;
    this.seats = ctx.players.map((player, i) => ({
      player,
      x: i * w,
      w,
      cx: i * w + w / 2,
      laneHalf: Math.min(w / 2 - 14, 220),
      sled: newSled(),
      brain: player.kind === "bot" ? newBotBrain(ctx.rng) : null,
      floats: [],
      sprayT: 0,
      flash: 0,
      throwCd: 0,
      buriedT: 0,
    }));
    this.callouts.show("READY?", "#F4F7FB", { size: 80, life: 1.4, y: 0.3 });
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += realDt;
    for (const s of this.seats) {
      s.flash = Math.max(0, s.flash - realDt * 3);
      s.throwCd = Math.max(0, s.throwCd - realDt);
      if (s.sled.buried) s.buriedT += realDt;
      for (const f of s.floats) {
        f.life -= realDt;
        f.y -= 40 * realDt;
      }
      s.floats = s.floats.filter((f) => f.life > 0);
    }
    if (this.finished) return;

    if (this.phase === "intro") {
      this.timer -= dt;
      if (!this.countdownDone && this.timer <= 0.8) {
        this.countdownDone = true;
        this.ctx.sfx.countdown();
      }
      if (this.timer <= 0) {
        this.phase = "race";
        this.callouts.show("GO!", "#FFB020", { size: 120, life: 0.9, y: 0.3 });
        this.ctx.sfx.go();
        this.juice.shake(0.2);
      }
      return;
    }
    if (this.phase === "final") {
      this.timer -= dt;
      if (this.timer <= 0) this.finished = true;
      return;
    }

    this.raceT += dt;
    const sleds = this.seats.map((s) => s.sled);
    const threats = this.snowballs.filter((b) => b.t < SNOWBALL_FLIGHT_S * 0.7).map((b) => b.x);
    let maxFrac = 0;
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      const sled = s.sled;
      if (sled.buried) continue;
      const rivals = sleds.filter((r) => r !== sled);
      let input: SledInput;
      if (s.brain) {
        input = botInput(sled, this.course, s.brain, this.ctx.rng, dt, rivals, threats);
        if (isOut(sled)) this.botThrow(i, s.brain, dt);
      } else {
        input = this.seatInput(i);
      }
      const ev = stepSled(sled, input, this.course, dt, rivals, rankBehind(sled, sleds));
      const sx = s.cx + sled.x * s.laneHalf;

      if (ev.scraping !== 0) {
        s.sprayT -= dt;
        if (s.sprayT <= 0) {
          s.sprayT = SPRAY_EVERY;
          const wx = sx + ev.scraping * SLED_HALF * s.laneHalf;
          this.juice.burst(wx, this.sledY + 10, ["#ffffff", "#d8efff"], {
            count: 3, speed: 240, angle: ev.scraping < 0 ? Math.PI * 0.75 : Math.PI * 0.25, spread: 0.9,
            gravity: 0, size: 4, life: 0.35,
          });
        }
      }
      if (sled.tucking && !sled.finished) {
        s.sprayT -= dt;
        if (s.sprayT <= 0) {
          s.sprayT = SPRAY_EVERY * 1.5;
          const hot = sled.heat;
          this.juice.burst(sx, this.sledY + 26, hot > 0.7 ? ["#ffb020", "#ff3d7a", "#ffffff"] : ["#d8efff", "#9ff3ff"], {
            count: 2, speed: 160, angle: Math.PI / 2, spread: 0.6, gravity: 0, size: 4, life: 0.3,
          });
        }
      }
      if (ev.scrapeStart !== 0) {
        this.ctx.sfx.tick();
        this.juice.shake(0.08);
      }
      if (ev.rock) {
        this.ctx.sfx.hit();
        this.juice.shake(0.35);
        this.juice.hitStop(0.05);
        this.juice.burst(sx, this.sledY, ["#8a93a3", "#ffffff", "#3b4453"], { count: 18, speed: 300, gravity: 500, size: 5 });
        this.float(s, "SPIN OUT!", "#FF3D7A");
        s.flash = 0.8;
      }
      if (ev.meltdown) {
        this.ctx.sfx.hit();
        this.ctx.sfx.miss();
        this.juice.shake(0.45);
        this.juice.hitStop(0.07);
        this.juice.burst(sx, this.sledY, ["#ff3d7a", "#ffb020", "#ffffff"], { count: 26, speed: 320, gravity: 300, size: 6, life: 0.8 });
        this.float(s, "MELTDOWN!", "#FF3D7A");
        s.flash = 1;
      }
      if (ev.perfectTuck) {
        this.ctx.sfx.streak(3);
        this.juice.burst(sx, this.sledY + 20, ["#ffb020", "#ffffff"], { count: 12, speed: 200, angle: Math.PI / 2, spread: 1, gravity: 0, size: 5, life: 0.5 });
        this.float(s, "PERFECT TUCK!", "#FFB020");
      } else if (ev.tuckRelease !== null && ev.tuckRelease > 0.45) {
        this.ctx.sfx.select();
      }
      if (ev.draftStart) this.ctx.sfx.tick();
      if (ev.slingshot) {
        this.ctx.sfx.whoosh();
        this.ctx.sfx.streak(5);
        this.juice.shake(0.25);
        this.juice.burst(sx, this.sledY + 24, [s.player.color, "#ffffff", "#9ff3ff"], { count: 22, speed: 380, angle: Math.PI / 2, spread: 0.8, gravity: 0, size: 6, life: 0.6 });
        this.float(s, "SLINGSHOT!", s.player.color);
        s.flash = 0.5;
      }
      if (ev.passed.length && sled.sling > 0) {
        this.ctx.sfx.streak(4);
        this.float(s, s.brain ? this.ctx.rng.pick(TAUNTS) : "OVERTAKE!", "#ffffff");
      }
      if (ev.nearMiss) {
        this.ctx.sfx.select();
        this.float(s, "CLOSE!", "#9ff3ff");
      }
      for (const _crystal of ev.crystals) {
        this.ctx.sfx.collect();
        this.juice.burst(sx, this.sledY - 10, ["#9ff3ff", "#ffffff", s.player.color], { count: 14, speed: 260, gravity: 100, size: 5, life: 0.5 });
        this.float(s, "+BOOST", "#9ff3ff");
      }
      if (ev.crossed) this.cross(s);
      if (!isOut(sled)) maxFrac = Math.max(maxFrac, (sled.v - V0) / (V1 - V0));
    }
    this.juice.shake(Math.max(0, maxFrac) ** 2 * 0.7 * dt);

    // The avalanche is released the moment someone finishes, or at the cap.
    const anyDone = this.seats.some((s) => isOut(s.sled));
    if (!this.avalanche && (anyDone || this.raceT >= RACE_CAP_S)) {
      this.avalanche = startAvalanche(sleds);
      this.avalancheT = this.raceT;
      this.callouts.show("AVALANCHE!", "#F4F7FB", { size: 84, life: 1.4, y: 0.55 });
      this.ctx.sfx.whoosh();
      this.juice.shake(0.5);
    } else if (!this.finalCalled && !anyDone && sleds.some((s) => s.d > LENGTH * 0.72)) {
      this.finalCalled = true;
      this.callouts.show("FINAL STRETCH", "#FFB020", { size: 64, life: 1.2, y: 0.55 });
      this.ctx.sfx.streak(2);
    }
    if (this.avalanche) {
      stepAvalanche(this.avalanche, dt);
      this.juice.shake(0.25 * dt);
      const { buried, nextPlace } = buryCaught(sleds, this.avalanche, this.nextPlace);
      this.nextPlace = nextPlace;
      for (const sled of buried) {
        const s = this.seats.find((x) => x.sled === sled)!;
        this.ctx.sfx.hit();
        this.juice.shake(0.4);
        this.juice.hitStop(0.06);
        this.juice.burst(s.cx + sled.x * s.laneHalf, this.sledY, ["#ffffff", "#d8efff", "#9fb8d0"], { count: 40, speed: 360, gravity: 200, size: 7, life: 1 });
        this.callouts.show(`${s.player.name} BURIED  ${ordinal(sled.place ?? 0)}`, s.player.color, { size: 56, life: 1.3, y: 0.45 });
      }
      const { landed, hits } = stepSnowballs(this.snowballs, sleds, dt);
      for (const b of landed) {
        for (const s of this.seats) {
          if (isOut(s.sled)) continue;
          this.juice.burst(s.cx + b.x * s.laneHalf, this.sledY, ["#ffffff", "#e6f2ff"], { count: 10, speed: 200, gravity: 300, size: 5, life: 0.5 });
        }
      }
      for (const h of hits) {
        const s = this.seats.find((x) => x.sled === h.sled)!;
        const thrower = this.seats[h.ball.from];
        this.ctx.sfx.hit();
        this.juice.shake(0.2);
        this.float(s, "SPLAT!", "#ffffff");
        if (thrower) this.float(thrower, "HIT!", thrower.player.color);
      }
    }

    const allOut = this.seats.every((s) => isOut(s.sled));
    const graceUp = this.avalanche !== null && this.raceT - this.avalancheT >= FINISH_GRACE_S;
    if (allOut || graceUp) this.endRace();
  }

  private float(s: Seat, text: string, color: string): void {
    // Stack new texts above older ones so they never overlap.
    const y = this.sledY - 60 - s.floats.filter((f) => f.life > 0.5).length * 30;
    s.floats.push({ x: s.cx, y, text, color, life: 0.9 });
  }

  private botThrow(i: number, brain: BotBrain, dt: number): void {
    brain.throwT -= dt;
    if (brain.throwT > 0) return;
    brain.throwT = this.ctx.rng.float(1.1, 2.2);
    // Aim at the straggler closest to the line, with some error.
    let best: Sled | null = null;
    for (const s of this.seats) {
      if (isOut(s.sled)) continue;
      if (!best || s.sled.d > best.d) best = s.sled;
    }
    if (!best) return;
    this.throwFrom(i, best.x + this.ctx.rng.float(-0.18, 0.18));
  }

  private throwFrom(i: number, x: number): void {
    const s = this.seats[i]!;
    if (s.throwCd > 0 || !this.avalanche) return;
    s.throwCd = SNOWBALL_COOLDOWN_S;
    this.snowballs.push(throwSnowball(x, i));
    this.ctx.sfx.whoosh();
    this.juice.burst(s.cx + x * s.laneHalf, this.ctx.height * 0.5, ["#ffffff"], { count: 6, speed: 120, gravity: 0, size: 4, life: 0.3 });
  }

  private cross(s: Seat): void {
    const place = this.nextPlace++;
    s.sled.place = place;
    s.sled.finishT = this.raceT;
    s.flash = 1;
    const label = `${s.player.name} ${ordinal(place)}!`;
    this.callouts.show(label, s.player.color, { size: 60, life: 1.3, y: 0.45 });
    this.juice.burst(s.cx, this.sledY, [s.player.color, "#ffffff", "#9ff3ff"], { count: 30, speed: 340, gravity: 300, size: 6, life: 0.9 });
    if (place === 1) {
      this.ctx.sfx.win();
      this.juice.shake(0.35);
    } else {
      this.ctx.sfx.streak(5 - Math.min(4, place));
    }
    if (s.player.kind === "human") {
      const score = Math.round(BEST_BASE - this.raceT * 1000);
      if (saveBest(iceLuge.id, score, BEST_VERSION)) {
        this.callouts.show("NEW RECORD!", "#FFB020", { size: 54, life: 1.6, y: 0.62 });
        this.ctx.sfx.streak(6);
      }
    }
  }

  private endRace(): void {
    if (this.phase !== "race") return;
    this.nextPlace = placeByDistance(this.seats.map((s) => s.sled), this.nextPlace);
    const winner = this.seats.find((s) => s.sled.place === 1);
    this.phase = "final";
    this.timer = FINAL_S;
    if (winner) {
      this.callouts.show(`${winner.player.name} WINS!`, winner.player.color, { size: 76, life: FINAL_S, y: 0.3 });
      this.ctx.sfx.win();
      this.juice.shake(0.3);
    }
  }

  private seatInput(i: number): SledInput {
    let l = 0;
    let r = 0;
    for (const t of this.pointers.values()) {
      if (t.seat !== i) continue;
      if (t.side < 0) l = 1;
      else r = 1;
    }
    return { steer: r - l, tuck: l === 1 && r === 1 };
  }

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private seatAt(x: number): number {
    return Math.max(0, Math.min(this.seats.length - 1, Math.floor(x / this.seats[0]!.w)));
  }

  private touchAt(x: number): Touch | null {
    const i = this.seatAt(x);
    const s = this.seats[i]!;
    if (s.player.kind !== "human") return null;
    return { seat: i, side: x < s.cx ? -1 : 1 };
  }

  private readonly onDown = (e: PointerEvent): void => {
    const x = this.toLogical(e).x;
    const i = this.seatAt(x);
    const s = this.seats[i]!;
    if (s.player.kind !== "human") return;
    e.preventDefault();
    if (isOut(s.sled)) {
      // Done racing: every tap lobs a snowball at that lateral spot in the racing lanes.
      this.throwFrom(i, (x - s.cx) / s.laneHalf);
      return;
    }
    const t = this.touchAt(x);
    if (!t) return;
    this.pointers.set(e.pointerId, t);
    try {
      this.ctx.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    const t = this.touchAt(this.toLogical(e).x);
    if (t) this.pointers.set(e.pointerId, t);
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
  };

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);
    for (let i = 0; i < this.seats.length; i++) this.drawLane(g, i);
    this.juice.end(g);
    for (const s of this.seats) this.drawHud(g, s);
    if (this.phase === "race" && this.avalanche !== null) {
      drawTimerBar(g, width, Math.max(0, FINISH_GRACE_S - (this.raceT - this.avalancheT)), FINISH_GRACE_S);
    }
    this.callouts.draw(g, width, height);
  }

  private drawLane(g: CanvasRenderingContext2D, i: number): void {
    const s = this.seats[i]!;
    const h = this.ctx.height;
    const sled = s.sled;
    g.save();
    g.beginPath();
    g.rect(s.x, 0, s.w, h);
    g.clip();

    // Snow banks.
    const bank = g.createLinearGradient(0, 0, 0, h);
    bank.addColorStop(0, "#b7cfe3");
    bank.addColorStop(1, "#8fb0cc");
    g.fillStyle = bank;
    g.fillRect(s.x, 0, s.w, h);

    // Chute walls sampled from the top of the lane to the bottom.
    const lefts: number[] = [];
    const rights: number[] = [];
    const ys: number[] = [];
    for (let y = -ROW_STEP; y <= h + ROW_STEP; y += ROW_STEP) {
      const ch = chuteAt(this.course, sled.d + (this.sledY - y));
      ys.push(y);
      lefts.push(s.cx + (ch.center - ch.half) * s.laneHalf);
      rights.push(s.cx + (ch.center + ch.half) * s.laneHalf);
    }
    g.beginPath();
    for (let k = 0; k < ys.length; k++) {
      if (k === 0) g.moveTo(lefts[k]!, ys[k]!);
      else g.lineTo(lefts[k]!, ys[k]!);
    }
    for (let k = ys.length - 1; k >= 0; k--) g.lineTo(rights[k]!, ys[k]!);
    g.closePath();
    const ice = g.createLinearGradient(0, 0, 0, h);
    ice.addColorStop(0, "#2a7cc2");
    ice.addColorStop(1, "#4fa8e2");
    g.fillStyle = ice;
    g.fill();

    g.save();
    g.clip();
    // Ice texture: faint lines sliding down with the track.
    g.strokeStyle = "rgba(255,255,255,0.14)";
    g.lineWidth = 2;
    const stride = 150;
    const first = Math.floor((sled.d - (h - this.sledY)) / stride) * stride;
    for (let d = first; d < sled.d + this.sledY + stride; d += stride) {
      const y = this.sledY - (d - sled.d);
      g.beginPath();
      g.moveTo(s.x, y);
      g.lineTo(s.x + s.w, y + 6);
      g.stroke();
    }
    // Finish line.
    const fy = this.sledY - (LENGTH - sled.d);
    if (fy > -60 && fy < h + 60) {
      const cells = 8;
      const cw = s.w / cells;
      for (let row = 0; row < 2; row++) {
        for (let c = 0; c < cells; c++) {
          g.fillStyle = (c + row) % 2 === 0 ? "#ffffff" : "#1a2234";
          g.fillRect(s.x + c * cw, fy - 24 + row * 12, cw, 12);
        }
      }
    }
    // Rival ghosts and their wakes.
    this.drawGhosts(g, s);
    // Speed lines once the sled is really moving.
    const frac = Math.max(0, Math.min(1, (sled.v - V0) / (V1 - V0)));
    if (frac > 0.3 && !isOut(sled)) {
      g.strokeStyle = sled.tucking ? "rgba(255,240,200,0.8)" : "rgba(255,255,255,0.6)";
      g.lineWidth = 2;
      const n = Math.floor(frac * 12);
      for (let k = 0; k < n; k++) {
        const x = s.x + 8 + (((k * 97) % 89) / 89) * (s.w - 16);
        const len = 40 + frac * 140;
        const y = ((k * 173 + sled.d * 1.7) % (h + 2 * len)) - len;
        g.globalAlpha = (frac - 0.3) * 0.7;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + len);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    g.restore();

    // Items.
    const lo = sled.d - (h - this.sledY) - 40;
    const hi = sled.d + this.sledY + 40;
    for (const item of this.course.items) {
      if (item.d < lo) continue;
      if (item.d > hi) break;
      if (sled.taken.has(item.id)) continue;
      const ix = s.cx + item.x * s.laneHalf;
      const iy = this.sledY - (item.d - sled.d);
      if (item.kind === "crystal") this.drawCrystal(g, ix, iy);
      else this.drawRock(g, ix, iy);
    }

    // Walls.
    g.lineCap = "round";
    g.lineJoin = "round";
    for (const side of [lefts, rights]) {
      g.beginPath();
      for (let k = 0; k < ys.length; k++) {
        if (k === 0) g.moveTo(side[k]!, ys[k]!);
        else g.lineTo(side[k]!, ys[k]!);
      }
      g.strokeStyle = "rgba(20,50,90,0.45)";
      g.lineWidth = 10;
      g.stroke();
      g.strokeStyle = "#f4fbff";
      g.lineWidth = 5;
      g.stroke();
    }

    // Snowball shadows on the racing lanes, and the thrown balls in the throwers' lanes.
    for (const b of this.snowballs) {
      const t = 1 - b.t / SNOWBALL_FLIGHT_S;
      if (!isOut(sled)) {
        const bx = s.cx + b.x * s.laneHalf;
        const r = SNOWBALL_HALF * s.laneHalf;
        g.fillStyle = `rgba(7,11,20,${0.15 + t * 0.35})`;
        g.beginPath();
        g.ellipse(bx, this.sledY + 8, r * (0.5 + t * 0.5), r * 0.5 * (0.5 + t * 0.5), 0, 0, Math.PI * 2);
        g.fill();
        const by = this.sledY - (1 - t) * (h * 0.9);
        g.fillStyle = "#ffffff";
        g.beginPath();
        g.arc(bx, by, r * 0.6 + t * r * 0.3, 0, Math.PI * 2);
        g.fill();
      } else if (b.from === i) {
        const bx = s.cx + b.x * s.laneHalf;
        const by = h * 0.5 - t * h * 0.6;
        g.fillStyle = "rgba(255,255,255,0.8)";
        g.beginPath();
        g.arc(bx, by, 10 - t * 6, 0, Math.PI * 2);
        g.fill();
      }
    }

    // Run-out past the finish fades the lane to let the banner read.
    if (sled.d > LENGTH + RUNOUT) {
      g.fillStyle = "rgba(7,11,20,0.35)";
      g.fillRect(s.x, 0, s.w, h);
    }

    this.drawSled(g, s);

    // The avalanche wall climbing the lane from below.
    if (this.avalanche && !sled.finished) {
      const ay = this.sledY - (this.avalanche.d - sled.d);
      const top = sled.buried ? Math.min(ay, h * 0.5 - s.buriedT * 60) : ay;
      if (top < h + 80) {
        g.fillStyle = "rgba(255,255,255,0.92)";
        g.beginPath();
        g.moveTo(s.x, h + 10);
        for (let x = s.x; x <= s.x + s.w + 24; x += 24) {
          const bump = Math.sin(x * 0.11 + this.time * 9) * 12 + Math.sin(x * 0.05 - this.time * 5) * 18;
          g.lineTo(x, top + bump);
        }
        g.lineTo(s.x + s.w, h + 10);
        g.closePath();
        g.fill();
        g.fillStyle = "rgba(190,215,240,0.9)";
        g.beginPath();
        g.moveTo(s.x, h + 10);
        for (let x = s.x; x <= s.x + s.w + 24; x += 24) {
          const bump = Math.sin(x * 0.13 - this.time * 8) * 10 + Math.sin(x * 0.04 + this.time * 4) * 14;
          g.lineTo(x, top + 40 + bump);
        }
        g.lineTo(s.x + s.w, h + 10);
        g.closePath();
        g.fill();
      }
    }

    // Snow splat on the screen after a snowball hit.
    if (sled.splat > 0) {
      g.globalAlpha = Math.min(1, sled.splat / 0.4) * 0.85;
      g.fillStyle = "#ffffff";
      for (let k = 0; k < 7; k++) {
        const px = s.cx + Math.sin(k * 2.1 + 1) * s.w * 0.36;
        const py = this.sledY - 60 + Math.cos(k * 1.7) * h * 0.28;
        g.beginPath();
        g.arc(px, py, 22 + ((k * 7) % 16), 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }

    if (s.flash > 0) {
      g.fillStyle = `rgba(255,255,255,${s.flash * 0.35})`;
      g.fillRect(s.x, 0, s.w, h);
    }
    g.restore();
  }

  private drawGhosts(g: CanvasRenderingContext2D, s: Seat): void {
    const sled = s.sled;
    const h = this.ctx.height;
    for (const other of this.seats) {
      if (other === s || other.sled.buried) continue;
      const r = other.sled;
      const gap = r.d - sled.d;
      const gy = this.sledY - gap;
      if (gy < -80 || gy > h + 80) continue;
      const gx = s.cx + r.x * s.laneHalf;
      // Wake: the band behind the ghost you can draft in.
      if (gap >= DRAFT_MIN_GAP && sled.d >= DRAFT_START && !isOut(sled)) {
        const inIt = sled.drafting && Math.abs(r.x - sled.x) < DRAFT_HALF && gap <= DRAFT_RANGE;
        const wakeW = DRAFT_HALF * 2 * s.laneHalf;
        const grad = g.createLinearGradient(0, gy, 0, gy + DRAFT_RANGE);
        grad.addColorStop(0, inIt ? `${s.player.color}99` : `${other.player.color}55`);
        grad.addColorStop(1, inIt ? `${s.player.color}22` : `${other.player.color}00`);
        g.fillStyle = grad;
        g.fillRect(gx - wakeW / 2, gy, wakeW, DRAFT_RANGE);
        if (inIt) {
          g.strokeStyle = "rgba(255,255,255,0.5)";
          g.lineWidth = 2;
          const phase = (this.time * 500) % 60;
          for (let y = gy + phase; y < gy + DRAFT_RANGE; y += 60) {
            g.beginPath();
            g.moveTo(gx - wakeW / 2, y);
            g.lineTo(gx, y + 14);
            g.lineTo(gx + wakeW / 2, y);
            g.stroke();
          }
        }
      }
      g.save();
      g.globalAlpha = 0.55;
      this.drawSledShape(g, gx, gy, other.player.color, r.vx * 0.12, r.tucking, false);
      g.restore();
    }
  }

  private drawCrystal(g: CanvasRenderingContext2D, x: number, y: number): void {
    const r = 15 + Math.sin(this.time * 6 + x) * 2;
    g.save();
    g.translate(x, y);
    g.rotate(this.time * 1.5);
    g.fillStyle = "rgba(159,243,255,0.35)";
    g.beginPath();
    g.moveTo(0, -r * 1.5);
    g.lineTo(r * 1.05, 0);
    g.lineTo(0, r * 1.5);
    g.lineTo(-r * 1.05, 0);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(0, -r);
    g.lineTo(r * 0.7, 0);
    g.lineTo(0, r);
    g.lineTo(-r * 0.7, 0);
    g.closePath();
    g.fillStyle = "#9ff3ff";
    g.fill();
    g.beginPath();
    g.moveTo(0, -r * 0.5);
    g.lineTo(r * 0.3, 0);
    g.lineTo(0, r * 0.5);
    g.lineTo(-r * 0.3, 0);
    g.closePath();
    g.fillStyle = "#ffffff";
    g.fill();
    g.restore();
  }

  private drawRock(g: CanvasRenderingContext2D, x: number, y: number): void {
    g.save();
    g.translate(x, y);
    g.beginPath();
    g.moveTo(-18, 6);
    g.lineTo(-12, -12);
    g.lineTo(2, -17);
    g.lineTo(17, -6);
    g.lineTo(16, 10);
    g.lineTo(0, 16);
    g.closePath();
    g.fillStyle = "#3f4756";
    g.fill();
    g.strokeStyle = "#1c2230";
    g.lineWidth = 3;
    g.stroke();
    g.beginPath();
    g.moveTo(-10, -6);
    g.lineTo(0, -11);
    g.lineTo(8, -4);
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.lineWidth = 3;
    g.stroke();
    g.restore();
  }

  private drawSled(g: CanvasRenderingContext2D, s: Seat): void {
    const sled = s.sled;
    const x = s.cx + sled.x * s.laneHalf;
    const y = this.sledY;
    let angle = sled.spin > 0 ? (1 - sled.spin / sled.spinTotal) * Math.PI * 3 : 0;
    let yy = y;
    if (sled.buried) {
      angle = s.buriedT * 9;
      yy = y + Math.min(60, s.buriedT * 120);
    }
    // Slingshot streak behind the sled.
    if (sled.sling > 0) {
      g.globalAlpha = sled.sling;
      g.fillStyle = s.player.color;
      g.beginPath();
      g.moveTo(x - 14, y);
      g.lineTo(x, y + 90 + sled.sling * 80);
      g.lineTo(x + 14, y);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
    }
    this.drawSledShape(g, x, yy, s.player.color, sled.vx * 0.12 + angle, sled.tucking, true);
    // Heat meter beside the sled while tucking or still hot.
    if (sled.heat > 0.02 && !isOut(sled)) {
      const mx = x + 34;
      const mh = 56;
      g.fillStyle = "rgba(7,11,20,0.6)";
      g.fillRect(mx - 5, y - mh / 2 - 2, 10, mh + 4);
      const fill = mh * Math.min(1, sled.heat);
      const hot = sled.heat;
      g.fillStyle = hot > 0.85 ? (Math.sin(this.time * 40) > 0 ? "#ffffff" : "#ff3d7a") : hot > 0.6 ? "#ffb020" : "#9ff3ff";
      g.fillRect(mx - 3, y + mh / 2 - fill, 6, fill);
      g.fillStyle = "#ffffff";
      g.fillRect(mx - 6, y + mh / 2 - mh * 0.72, 12, 2);
    }
  }

  private drawSledShape(g: CanvasRenderingContext2D, x: number, y: number, color: string, angle: number, tucked: boolean, shadow: boolean): void {
    g.save();
    g.translate(x, y);
    if (shadow) {
      g.fillStyle = "rgba(10,20,40,0.3)";
      g.beginPath();
      g.ellipse(0, 10, 24, 10, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.rotate(angle);
    const sx = tucked ? 0.86 : 1;
    const sy = tucked ? 1.1 : 1;
    g.scale(sx, sy);
    // Runners.
    g.strokeStyle = "#1c2230";
    g.lineWidth = 4;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(-15, -26);
    g.lineTo(-15, 28);
    g.moveTo(15, -26);
    g.lineTo(15, 28);
    g.stroke();
    // Body.
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(-13, -30);
    g.lineTo(13, -30);
    g.lineTo(16, 22);
    g.lineTo(-16, 22);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(7,11,20,0.6)";
    g.lineWidth = 2;
    g.stroke();
    // Rider: body stripe and helmet. Tucked, the rider lies flat and the helmet drops forward.
    g.fillStyle = "rgba(7,11,20,0.35)";
    if (tucked) g.fillRect(-9, -22, 18, 40);
    else g.fillRect(-7, -14, 14, 30);
    const hy = tucked ? -20 : -12;
    const hr = tucked ? 7 : 9;
    g.fillStyle = "#f4f7fb";
    g.beginPath();
    g.arc(0, hy, hr, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = color;
    g.beginPath();
    g.arc(0, hy, hr, Math.PI, Math.PI * 2);
    g.fill();
    g.restore();
  }

  private drawHud(g: CanvasRenderingContext2D, s: Seat): void {
    const sled = s.sled;
    const h = this.ctx.height;
    const i = this.seats.indexOf(s);
    const narrow = s.w < 400;
    g.save();
    g.beginPath();
    g.rect(s.x, 0, s.w, h);
    g.clip();

    // Zone divider.
    if (i > 0) {
      g.fillStyle = "#070b14";
      g.fillRect(s.x - 2, 0, 4, h);
    }

    // Steering feedback and hints for humans.
    if (s.player.kind === "human" && !isOut(sled)) {
      const input = this.seatInput(i);
      if (input.tuck) {
        g.fillStyle = `${s.player.color}22`;
        g.fillRect(s.x, 0, s.w, h);
      } else if (input.steer !== 0) {
        g.fillStyle = `${s.player.color}33`;
        g.fillRect(input.steer < 0 ? s.x : s.cx, 0, s.w / 2, h);
      }
      if (this.phase === "intro" || this.raceT < 5) {
        g.font = `700 ${Math.min(28, s.w * 0.1)}px ${FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillStyle = "rgba(7,11,20,0.55)";
        g.fillText("< HOLD", s.x + s.w * 0.25, h * 0.9);
        g.fillText("HOLD >", s.x + s.w * 0.75, h * 0.9);
        g.font = `700 ${Math.min(24, s.w * 0.085)}px ${FONT}`;
        g.fillText("BOTH = TUCK", s.cx, h * 0.96);
      }
    } else if (s.player.kind === "human" && this.phase === "race" && this.avalanche) {
      g.font = `700 ${Math.min(26, s.w * 0.09)}px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "rgba(7,11,20,0.6)";
      g.fillText(s.throwCd > 0 ? "..." : "TAP TO THROW SNOW", s.cx, h * 0.9);
    }

    // Name and crystal tally.
    g.textBaseline = "top";
    g.textAlign = "left";
    g.font = `700 26px ${FONT}`;
    g.lineWidth = 5;
    g.strokeStyle = "rgba(7,11,20,0.8)";
    g.strokeText(s.player.name, s.x + 12, 32);
    g.fillStyle = s.player.color;
    g.fillText(s.player.name, s.x + 12, 32);
    g.textAlign = "right";
    const tally = String(sled.crystals);
    g.strokeText(tally, s.x + s.w - 12, 32);
    g.fillStyle = "#f4f7fb";
    g.fillText(tally, s.x + s.w - 12, 32);
    const tw = g.measureText(tally).width;
    g.save();
    g.translate(s.x + s.w - 24 - tw, 46);
    g.fillStyle = "#9ff3ff";
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(6, 0);
    g.lineTo(0, 9);
    g.lineTo(-6, 0);
    g.closePath();
    g.fill();
    g.restore();

    // Progress bar with everyone's marker on it.
    const bx = s.x + 12;
    const bw = s.w - 24;
    const by = 64;
    g.fillStyle = "rgba(7,11,20,0.5)";
    g.fillRect(bx, by, bw, 6);
    g.fillStyle = s.player.color;
    g.fillRect(bx, by, bw * Math.min(1, sled.d / LENGTH), 6);
    g.fillStyle = "#ffffff";
    g.fillRect(bx + bw - 3, by - 2, 3, 10);
    for (const o of this.seats) {
      if (o === s) continue;
      g.fillStyle = o.player.color;
      g.fillRect(bx + bw * Math.min(1, o.sled.d / LENGTH) - 2, by - 3, 4, 12);
    }
    if (this.avalanche) {
      const ax = bx + bw * Math.max(0, Math.min(1, this.avalanche.d / LENGTH));
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.moveTo(ax - 6, by + 14);
      g.lineTo(ax + 6, by + 14);
      g.lineTo(ax, by + 6);
      g.closePath();
      g.fill();
    }

    // Draft meter.
    if (!isOut(sled)) {
      const dy = by + 14;
      const label = "DRAFT";
      g.font = `700 14px ${FONT}`;
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillStyle = sled.drafting ? "#ffffff" : "rgba(244,247,251,0.6)";
      g.fillText(label, bx, dy + 4);
      const lw = g.measureText(label).width + 6;
      g.fillStyle = "rgba(7,11,20,0.5)";
      g.fillRect(bx + lw, dy, bw - lw, 8);
      const pulse = sled.drafting ? 0.75 + 0.25 * Math.sin(this.time * 14) : 1;
      g.globalAlpha = pulse;
      g.fillStyle = sled.draft > 0.8 ? "#ffb020" : "#9ff3ff";
      g.fillRect(bx + lw, dy, (bw - lw) * sled.draft, 8);
      g.globalAlpha = 1;
    }

    // Finishing place banner.
    if (sled.place !== null) {
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `700 ${Math.min(110, s.w * 0.4)}px ${FONT}`;
      g.lineWidth = 10;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      g.strokeText(ordinal(sled.place), s.cx, h * 0.42);
      g.fillStyle = sled.place === 1 ? "#FFB020" : s.player.color;
      g.fillText(ordinal(sled.place), s.cx, h * 0.42);
      if (sled.finishT !== null) {
        g.font = `700 ${Math.min(30, s.w * 0.11)}px ${FONT}`;
        g.lineWidth = 5;
        const t = `${sled.finishT.toFixed(1)}s`;
        g.strokeText(t, s.cx, h * 0.42 + Math.min(110, s.w * 0.4) * 0.55);
        g.fillStyle = "#f4f7fb";
        g.fillText(t, s.cx, h * 0.42 + Math.min(110, s.w * 0.4) * 0.55);
      }
    }

    // Floating texts.
    for (const f of s.floats) {
      g.globalAlpha = Math.min(1, f.life / 0.3);
      g.font = `700 ${narrow ? 26 : 30}px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 6;
      g.strokeStyle = "rgba(7,11,20,0.85)";
      g.strokeText(f.text, f.x, f.y);
      g.fillStyle = f.color;
      g.fillText(f.text, f.x, f.y);
    }
    g.globalAlpha = 1;
    g.restore();
  }

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({ playerId: s.player.id, score: pointsForPlace(s.sled.place) }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const s of this.seats) {
      const t = s.sled.finishT;
      out.push({ playerId: s.player.id, label: "Time", value: t === null ? (s.sled.buried ? "Buried" : "DNF") : `${t.toFixed(1)}s` });
      out.push({ playerId: s.player.id, label: "Slingshots", value: String(s.sled.slingshots) });
    }
    return out;
  }

  destroy(): void {
    const c = this.ctx.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
    this.pointers.clear();
  }
}

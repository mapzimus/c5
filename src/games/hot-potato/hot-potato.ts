import { fillArena } from "../../core/draw";
import { Callouts, Juice } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  AIM_HOLD_S,
  AIM_SWEEP_RAD_PER_S,
  FLIGHT_S,
  SPLIT_AT_S,
  botAimTarget,
  eliminationScores,
  inZone,
  pickTarget,
  planBomb,
  planBotThrow,
  pointedSeat,
  seatLayout,
  type BombKind,
  type SeatZone,
} from "./logic";

export const hotPotato: GameDefinition = {
  id: "hot-potato",
  name: "Hot Potato",
  tagline: "Pass it. PASS IT!",
  description:
    "A lit bomb lands in someone's hands. Tap your zone to lob it at a random player, or hold to " +
    "aim and release at whoever you hate most. The fuse is hidden: it hisses louder and shakes " +
    "harder as it runs out. Some bombs are duds, some split in two. Holding one when it blows " +
    "puts you out. Last one standing wins.",
  durationMs: 0,
  controls: "Tap your zone to pass. Hold 0.5s to aim, release to throw.",
  create: (ctx) => new HotPotato(ctx),
};

const INTRO_S = 1.3;
const RESULT_S = 2.0;
const FINAL_S = 2.2;
const RESPAWN_S = 0.9;
const FONT = "Bebas Neue, Impact, sans-serif";

type Phase = "intro" | "round" | "result" | "final";

interface Bomb {
  kind: BombKind;
  fuseS: number;
  /** Seconds since lit. */
  t: number;
  /** Seat holding it, or the seat it is flying to. */
  holder: number;
  flight: { from: number; to: number; t: number } | null;
  /** Seconds in the current holder's hands. */
  heldT: number;
  botThrowAt: number | null;
  botTarget: number | null;
  splitDone: boolean;
  hissT: number;
  spin: number;
}

interface Press {
  seat: number;
  t: number;
  aiming: boolean;
  aimAngle: number;
}

interface Seat {
  player: Player;
  zone: SeatZone;
  alive: boolean;
  passes: number;
  /** Soot/wobble effects after an explosion. */
  hit: number;
  catchPop: number;
}

class HotPotato implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private phase: Phase = "intro";
  private timer = INTRO_S;
  private roundIndex = 0;
  private bombs: Bomb[] = [];
  private respawnTimer = 0;
  private forceLive = false;
  private readonly order: number[] = [];
  private readonly presses = new Map<number, Press>();
  private resultText = "";
  private resultColor = "#F4F7FB";
  private finished = false;
  private time = 0;
  private flash = 0;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    const zones = seatLayout(ctx.players.length, ctx.width, ctx.height);
    this.seats = ctx.players.map((player, i) => ({
      player, zone: zones[i] ?? zones[0]!, alive: true, passes: 0, hit: 0, catchPop: 0,
    }));
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onCancel);
  }

  // ---------------------------------------------------------------- state

  private get alive(): boolean[] {
    return this.seats.map((s) => s.alive);
  }

  private aliveCount(): number {
    return this.seats.filter((s) => s.alive).length;
  }

  private spawnBomb(): void {
    const living = this.seats.map((s, i) => (s.alive ? i : -1)).filter((i) => i >= 0);
    if (living.length === 0) return;
    const holder = this.ctx.rng.pick(living);
    const plan = planBomb(this.ctx.rng, { allowDud: !this.forceLive, allowSplit: living.length > 1 });
    this.forceLive = false;
    const bomb = this.makeBomb(plan.kind, plan.fuseS, holder);
    this.onLanded(bomb);
    this.bombs.push(bomb);
    this.ctx.sfx.go();
    const z = this.seats[holder]!.zone;
    this.juice.burst(z.cx, z.cy - 40, ["#FFB020", "#ffffff"], { count: 10, speed: 160, gravity: 0, life: 0.3, size: 4 });
  }

  private makeBomb(kind: BombKind, fuseS: number, holder: number): Bomb {
    return {
      kind, fuseS, t: 0, holder, flight: null, heldT: 0, botThrowAt: null, botTarget: null,
      splitDone: false, hissT: 0, spin: 0,
    };
  }

  private onLanded(bomb: Bomb): void {
    bomb.heldT = 0;
    const seat = this.seats[bomb.holder]!;
    seat.catchPop = 1;
    if (seat.player.kind === "bot") {
      bomb.botThrowAt = planBotThrow(this.ctx.rng);
      bomb.botTarget = botAimTarget(this.alive, bomb.holder, this.seats.map((s) => s.passes), this.ctx.rng);
    } else {
      bomb.botThrowAt = null;
      bomb.botTarget = null;
    }
  }

  /** Throw the bomb `seat` has held the longest. Returns false if they hold nothing throwable. */
  private throwFrom(seat: number, target: number): boolean {
    if (this.phase !== "round") return false;
    const held = this.bombs.filter((b) => b.flight === null && b.holder === seat);
    if (held.length === 0) return false;
    if (target < 0 || target === seat || !this.seats[target]?.alive) {
      target = pickTarget(this.alive, seat, this.ctx.rng);
      if (target < 0) return false;
    }
    held.sort((a, b) => b.heldT - a.heldT);
    const bomb = held[0]!;
    bomb.flight = { from: seat, to: target, t: 0 };
    bomb.holder = target;
    bomb.botThrowAt = null;
    const s = this.seats[seat]!;
    s.passes += 1;
    this.ctx.sfx.whoosh();
    this.juice.burst(s.zone.cx, s.zone.cy - 40, [s.player.color, "rgba(244,247,251,0.6)"], {
      count: 6, speed: 120, gravity: 200, life: 0.3, size: 3,
    });
    return true;
  }

  // ---------------------------------------------------------------- update

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += realDt;
    this.flash = Math.max(0, this.flash - realDt * 3);
    for (const s of this.seats) {
      s.hit = Math.max(0, s.hit - realDt * 1.2);
      s.catchPop = Math.max(0, s.catchPop - realDt * 5);
    }
    if (this.finished) return;

    if (this.phase === "intro") {
      this.timer -= dt;
      if (this.timer <= 0) this.startRound();
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
      this.phase = "intro";
      this.timer = INTRO_S;
      return;
    }

    this.stepPresses(dt);
    this.stepBombs(dt);

    if (this.bombs.length === 0 && this.phase === "round") {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.spawnBomb();
    }
  }

  private startRound(): void {
    if (this.aliveCount() <= 1) {
      this.endMatch();
      return;
    }
    this.phase = "round";
    this.bombs = [];
    this.presses.clear();
    this.forceLive = false;
    this.spawnBomb();
  }

  private stepPresses(dt: number): void {
    for (const p of this.presses.values()) {
      p.t += dt;
      if (!p.aiming && p.t >= AIM_HOLD_S) {
        p.aiming = true;
        p.aimAngle = this.seats[p.seat]!.zone.angle + Math.PI;
        this.ctx.sfx.select();
      }
      if (p.aiming) p.aimAngle += AIM_SWEEP_RAD_PER_S * dt;
    }
  }

  private stepBombs(dt: number): void {
    for (const bomb of [...this.bombs]) {
      if (!this.bombs.includes(bomb)) continue;
      bomb.t += dt;
      bomb.spin += dt * 9;
      if (bomb.flight) {
        bomb.flight.t += dt;
        if (bomb.flight.t >= FLIGHT_S) {
          bomb.flight = null;
          this.ctx.sfx.select();
          this.onLanded(bomb);
        }
      } else {
        bomb.heldT += dt;
      }

      // Split: a second live bomb flies off to someone else.
      if (bomb.kind === "split" && !bomb.splitDone && bomb.t >= SPLIT_AT_S) {
        bomb.splitDone = true;
        const from = bomb.holder;
        const to = pickTarget(this.alive, from, this.ctx.rng);
        if (to >= 0) {
          const twin = this.makeBomb("live", this.ctx.rng.float(6, 14), to);
          twin.flight = { from, to, t: 0 };
          this.bombs.push(twin);
          const z = this.seats[from]!.zone;
          this.callouts.show("IT SPLIT!", "#FFB020", { size: 60, life: 1.1, y: 0.5 });
          this.ctx.sfx.streak(2);
          this.juice.shake(0.25);
          this.juice.burst(z.cx, z.cy - 40, ["#FFB020", "#FF3D7A", "#ffffff"], { count: 20, speed: 260, gravity: 300, life: 0.5 });
        }
      }

      // Hiss gets faster as the fuse burns down.
      const heat = Math.min(1, bomb.t / bomb.fuseS);
      bomb.hissT += dt;
      const hissPeriod = 0.55 - heat * heat * 0.47;
      if (bomb.hissT >= hissPeriod) {
        bomb.hissT = 0;
        this.ctx.sfx.tick();
      }

      // Bots throw after a short hold.
      if (bomb.flight === null && bomb.botThrowAt !== null && bomb.heldT >= bomb.botThrowAt) {
        this.throwFrom(bomb.holder, bomb.botTarget ?? -1);
      }

      if (bomb.t >= bomb.fuseS) {
        if (bomb.kind === "dud") this.fizzle(bomb);
        else this.explode(bomb);
      }
    }
  }

  private bombPos(bomb: Bomb): { x: number; y: number } {
    const to = this.seats[bomb.holder]!.zone;
    if (!bomb.flight) {
      const shake = Math.pow(Math.min(1, bomb.t / bomb.fuseS), 2) * 7;
      return { x: to.cx + Math.sin(this.time * 61) * shake, y: to.cy - 52 + Math.cos(this.time * 47) * shake };
    }
    const from = this.seats[bomb.flight.from]!.zone;
    const p = Math.min(1, bomb.flight.t / FLIGHT_S);
    return {
      x: from.cx + (to.cx - from.cx) * p,
      y: from.cy - 52 + (to.cy - from.cy) * p - Math.sin(p * Math.PI) * 150,
    };
  }

  private fizzle(bomb: Bomb): void {
    const pos = this.bombPos(bomb);
    this.bombs = this.bombs.filter((b) => b !== bomb);
    this.juice.burst(pos.x, pos.y, ["#8a8f99", "#c9ced6", "rgba(244,247,251,0.5)"], {
      count: 22, speed: 90, gravity: -60, life: 0.9, size: 7,
    });
    this.callouts.show("PFFFT... A DUD!", "#c9ced6", { size: 62, life: 1.3, y: 0.5 });
    this.ctx.sfx.miss();
    this.juice.shake(0.1);
    if (this.bombs.length === 0) {
      this.forceLive = true;
      this.respawnTimer = RESPAWN_S;
    }
  }

  private explode(bomb: Bomb): void {
    const victim = this.seats[bomb.holder]!;
    const pos = this.bombPos(bomb);
    this.bombs = [];
    victim.alive = false;
    victim.hit = 1;
    this.order.push(bomb.holder);
    this.flash = 1;
    this.juice.hitStop(0.1);
    this.juice.shake(0.9);
    this.juice.burst(pos.x, pos.y, ["#FFB020", "#FF3D7A", "#ffffff", "#ff6a00"], { count: 46, speed: 520, gravity: 300, life: 0.8, size: 7 });
    this.juice.burst(pos.x, pos.y, ["#1a1a22", "#3a3a44", "#55555f"], { count: 30, speed: 220, gravity: -40, life: 1.3, size: 10 });
    this.ctx.sfx.hit();
    this.callouts.show(`${victim.player.name} IS OUT!`, victim.player.color, { size: 76, life: RESULT_S, y: 0.5 });
    this.resultText = `${victim.player.name} went KABOOM`;
    this.resultColor = victim.player.color;
    this.presses.clear();
    if (this.aliveCount() <= 1) this.endMatch();
    else {
      this.phase = "result";
      this.timer = RESULT_S;
    }
  }

  private endMatch(): void {
    this.phase = "final";
    this.timer = RESULT_S + FINAL_S;
    this.bombs = [];
    const survivors = this.seats.filter((s) => s.alive);
    const text = survivors.length === 1 ? `${survivors[0]!.player.name} WINS!` : "NOBODY WINS";
    this.callouts.show(text, survivors.length === 1 ? survivors[0]!.player.color : "#F4F7FB", {
      size: 80, life: RESULT_S + FINAL_S, y: 0.22,
    });
    this.ctx.sfx.win();
    for (const s of survivors) {
      this.juice.burst(s.zone.cx, s.zone.cy - 40, [s.player.color, "#FFB020", "#ffffff"], { count: 36, speed: 360, gravity: 350, life: 1 });
    }
  }

  // ---------------------------------------------------------------- input

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
      if (s.player.kind !== "human" || !s.alive) continue;
      if (!inZone(s.zone, p.x, p.y)) continue;
      e.preventDefault();
      try { this.ctx.canvas.setPointerCapture(e.pointerId); } catch { /* optional */ }
      this.presses.set(e.pointerId, { seat: i, t: 0, aiming: false, aimAngle: 0 });
      return;
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    const press = this.presses.get(e.pointerId);
    if (!press) return;
    this.presses.delete(e.pointerId);
    e.preventDefault();
    if (press.aiming) {
      const target = pointedSeat(press.aimAngle, this.seats.map((s) => s.zone.angle), this.alive, press.seat);
      this.throwFrom(press.seat, target);
    } else {
      this.throwFrom(press.seat, -1);
    }
  };

  private readonly onCancel = (e: PointerEvent): void => {
    this.presses.delete(e.pointerId);
  };

  // ---------------------------------------------------------------- render

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);
    for (const s of this.seats) this.drawZone(g, s);
    this.drawRing(g);
    for (const s of this.seats) this.drawCharacter(g, s);
    this.drawAim(g);
    for (const b of this.bombs) this.drawBomb(g, b);
    this.juice.end(g);
    if (this.flash > 0) {
      g.fillStyle = `rgba(255,220,160,${this.flash * 0.45})`;
      g.fillRect(0, 0, width, height);
    }
    for (const s of this.seats) this.drawLabels(g, s);
    this.drawCenter(g);
    this.callouts.draw(g, width, height);
  }

  private heldBy(seat: number): Bomb | undefined {
    return this.bombs.find((b) => b.flight === null && b.holder === seat);
  }

  private drawZone(g: CanvasRenderingContext2D, s: Seat): void {
    const z = s.zone;
    const held = this.heldBy(this.seats.indexOf(s));
    let alpha = s.alive ? 0.08 : 0.03;
    if (held && s.alive) {
      const heat = Math.min(1, held.t / held.fuseS);
      alpha = 0.16 + heat * 0.12 + Math.sin(this.time * (6 + heat * 18)) * 0.05;
    }
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = s.alive ? s.player.color : "#6b7280";
    g.fillRect(z.x, z.y, z.w, z.h);
    g.restore();
    g.strokeStyle = "rgba(244,247,251,0.1)";
    g.lineWidth = 2;
    g.strokeRect(z.x + 1, z.y + 1, z.w - 2, z.h - 2);
  }

  private drawRing(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    g.save();
    g.setLineDash([14, 12]);
    g.lineDashOffset = -this.time * 40;
    g.strokeStyle = "rgba(244,247,251,0.12)";
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(width / 2, height / 2, width * 0.22, height * 0.24, 0, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }

  private drawCharacter(g: CanvasRenderingContext2D, s: Seat): void {
    const z = s.zone;
    const sc = Math.min(1, this.ctx.height / 720);
    const idx = this.seats.indexOf(s);
    const held = this.heldBy(idx);
    const heat = held ? Math.min(1, held.t / held.fuseS) : 0;
    g.save();
    g.translate(z.cx, z.cy);
    g.scale(sc, sc);
    if (held) g.translate(Math.sin(this.time * 55) * heat * heat * 6, 0);
    if (s.hit > 0) g.rotate(Math.sin(this.time * 30) * s.hit * 0.25);
    const pop = 1 + s.catchPop * 0.12;
    g.scale(pop, 1 / pop);

    const body = s.alive ? s.player.color : "#4a4d55";
    // Legs.
    g.strokeStyle = body;
    g.lineWidth = 9;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(-12, 30); g.lineTo(-16, 58);
    g.moveTo(12, 30); g.lineTo(16, 58);
    g.stroke();
    // Body blob.
    g.fillStyle = body;
    g.shadowColor = s.alive ? s.player.color : "#000";
    g.shadowBlur = s.alive ? 14 : 0;
    g.beginPath();
    g.ellipse(0, 0, 38, 42, 0, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    // Soot smudges when blown up.
    if (!s.alive) {
      g.fillStyle = "rgba(10,10,14,0.55)";
      for (const [x, y, r] of [[-16, -10, 11], [14, 6, 13], [-4, 22, 9]] as const) {
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
      // Frazzled hair.
      g.strokeStyle = "#1a1a22";
      g.lineWidth = 3;
      for (let k = -2; k <= 2; k++) {
        g.beginPath();
        g.moveTo(k * 9, -40);
        g.lineTo(k * 14, -62 + Math.abs(k) * 4);
        g.stroke();
      }
    }
    // Eyes.
    const eyeW = held ? 7 + heat * 3 : 6;
    if (s.alive) {
      g.fillStyle = "#F4F7FB";
      g.beginPath();
      g.ellipse(-13, -10, eyeW, eyeW + 2, 0, 0, Math.PI * 2);
      g.ellipse(13, -10, eyeW, eyeW + 2, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#070b14";
      const look = held ? 0 : Math.sin(this.time * 2 + idx) * 2;
      g.beginPath();
      g.arc(-13 + look, -9, 3, 0, Math.PI * 2);
      g.arc(13 + look, -9, 3, 0, Math.PI * 2);
      g.fill();
      // Mouth: wide "O" of panic when holding, smile otherwise.
      g.strokeStyle = "#070b14";
      g.lineWidth = 3;
      g.beginPath();
      if (held) g.ellipse(0, 12, 6 + heat * 5, 8 + heat * 6, 0, 0, Math.PI * 2);
      else g.arc(0, 8, 10, 0.2, Math.PI - 0.2);
      g.stroke();
    } else {
      g.strokeStyle = "#F4F7FB";
      g.lineWidth = 3;
      for (const ex of [-13, 13]) {
        g.beginPath();
        g.moveTo(ex - 5, -15); g.lineTo(ex + 5, -5);
        g.moveTo(ex + 5, -15); g.lineTo(ex - 5, -5);
        g.stroke();
      }
      g.beginPath();
      g.arc(0, 16, 8, Math.PI + 0.3, -0.3);
      g.stroke();
    }
    // Hands: raised up to hold the bomb, otherwise at the sides.
    g.fillStyle = body;
    g.strokeStyle = body;
    g.lineWidth = 8;
    if (held && s.alive) {
      g.beginPath();
      g.moveTo(-30, -6); g.lineTo(-20, -44);
      g.moveTo(30, -6); g.lineTo(20, -44);
      g.stroke();
      g.beginPath();
      g.arc(-20, -46, 8, 0, Math.PI * 2);
      g.arc(20, -46, 8, 0, Math.PI * 2);
      g.fill();
    } else {
      g.beginPath();
      g.moveTo(-34, 0); g.lineTo(-46, 26);
      g.moveTo(34, 0); g.lineTo(46, 26);
      g.stroke();
    }
    g.restore();
  }

  private drawAim(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    const angles = this.seats.map((s) => s.zone.angle);
    for (const p of this.presses.values()) {
      if (!p.aiming) continue;
      const s = this.seats[p.seat]!;
      const target = pointedSeat(p.aimAngle, angles, this.alive, p.seat);
      g.save();
      // Sweeping needle at the centre of the ring.
      g.translate(width / 2, height / 2);
      g.rotate(p.aimAngle);
      g.strokeStyle = s.player.color;
      g.fillStyle = s.player.color;
      g.lineWidth = 6;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(-20, 0);
      g.lineTo(width * 0.18, 0);
      g.stroke();
      g.beginPath();
      g.moveTo(width * 0.18 + 26, 0);
      g.lineTo(width * 0.18 - 4, -16);
      g.lineTo(width * 0.18 - 4, 16);
      g.closePath();
      g.fill();
      g.restore();
      if (target >= 0) {
        const tz = this.seats[target]!.zone;
        g.save();
        g.strokeStyle = s.player.color;
        g.lineWidth = 5;
        g.setLineDash([10, 8]);
        g.lineDashOffset = -this.time * 60;
        g.beginPath();
        g.arc(tz.cx, tz.cy - 10, 68 + Math.sin(this.time * 10) * 4, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      }
    }
  }

  private drawBomb(g: CanvasRenderingContext2D, bomb: Bomb): void {
    const pos = this.bombPos(bomb);
    const heat = Math.min(1, bomb.t / bomb.fuseS);
    const sc = Math.min(1, this.ctx.height / 720);
    g.save();
    g.translate(pos.x, pos.y);
    g.scale(sc, sc);
    if (bomb.flight) g.rotate(bomb.spin);
    // Heat glow.
    const glowR = 40 + heat * 60;
    const glow = g.createRadialGradient(0, 0, 10, 0, 0, glowR);
    const gr = Math.round(255);
    const gg = Math.round(170 - heat * 130);
    glow.addColorStop(0, `rgba(${gr},${gg},40,${0.15 + heat * 0.5})`);
    glow.addColorStop(1, `rgba(${gr},${gg},40,0)`);
    g.fillStyle = glow;
    g.beginPath();
    g.arc(0, 0, glowR, 0, Math.PI * 2);
    g.fill();
    // Body.
    g.fillStyle = "#16161e";
    g.strokeStyle = `rgb(255,${Math.round(190 - heat * 150)},60)`;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, 0, 26, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.beginPath();
    g.arc(-9, -10, 9, 0, Math.PI * 2);
    g.fill();
    // Cap and fuse.
    g.fillStyle = "#5a5f6b";
    g.fillRect(-7, -34, 14, 10);
    g.strokeStyle = "#c9a26b";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, -34);
    g.quadraticCurveTo(10, -50, 4, -58);
    g.stroke();
    // Spark: brighter and bigger as it burns down.
    const sparkR = 5 + heat * 6 + Math.sin(this.time * 40) * 2;
    g.fillStyle = "#FFB020";
    g.shadowColor = "#FFB020";
    g.shadowBlur = 12 + heat * 16;
    g.beginPath();
    g.arc(4, -58, sparkR, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(4, -58, sparkR * 0.4, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  private drawLabels(g: CanvasRenderingContext2D, s: Seat): void {
    const z = s.zone;
    const idx = this.seats.indexOf(s);
    g.save();
    g.textAlign = "left";
    g.textBaseline = "top";
    g.font = `700 30px ${FONT}`;
    g.fillStyle = s.alive ? s.player.color : "rgba(244,247,251,0.35)";
    g.fillText(s.alive ? s.player.name : `${s.player.name} - OUT`, z.x + 16, z.y + 10);
    g.font = `700 20px ${FONT}`;
    g.fillStyle = "rgba(244,247,251,0.55)";
    g.fillText(`Passes ${s.passes}`, z.x + 16, z.y + 42);
    if (s.alive && s.player.kind === "human" && this.phase === "round") {
      g.textAlign = "center";
      g.textBaseline = "bottom";
      const held = this.heldBy(idx);
      g.fillStyle = held ? "#FFB020" : "rgba(244,247,251,0.3)";
      g.font = `700 ${held ? 28 : 22}px ${FONT}`;
      g.fillText(held ? "TAP: PASS   HOLD: AIM" : "tap to pass - hold to aim", z.x + z.w / 2, z.y + z.h - 12);
    }
    g.restore();
  }

  private drawCenter(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    let text = "";
    let color = "#F4F7FB";
    let size = 72;
    if (this.phase === "intro") {
      text = this.roundIndex === 0 ? "ROUND 1 - HOT POTATO!" : `ROUND ${this.roundIndex + 1}`;
    } else if (this.phase === "result") {
      text = this.resultText;
      color = this.resultColor;
      size = 48;
    } else return;
    g.save();
    g.font = `700 ${size}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 10;
    g.strokeStyle = "rgba(7,11,20,0.85)";
    const y = height * (this.phase === "result" ? 0.64 : 0.5);
    g.strokeText(text, width / 2, y);
    g.fillStyle = color;
    g.fillText(text, width / 2, y);
    g.restore();
  }

  // ---------------------------------------------------------------- results

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    const scores = eliminationScores(this.order, this.seats.length);
    return this.seats.map((s, i) => ({ playerId: s.player.id, score: scores[i] ?? 0 }));
  }

  getStats(): GameStat[] {
    return this.seats.map((s) => ({ playerId: s.player.id, label: "Passes", value: String(s.passes) }));
  }

  destroy(): void {
    const c = this.ctx.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onCancel);
    this.presses.clear();
  }
}

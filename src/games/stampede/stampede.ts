import { drawTimerBar, fillArena } from "../../core/draw";
import { Callouts, Juice, saveBest } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  botDecide,
  crackLimit,
  difficulty,
  HOP_S,
  isNearMiss,
  LANES,
  LAST_STANDING_BONUS,
  matchWinners,
  nearMissBonus,
  occupiedLanes,
  OVERDRIVE_S,
  planWave,
  REVENGE_BONUS,
  RIDER_DELAY_S,
  RIDER_GAP_S,
  riderBotAim,
  ROUND_S,
  ROUNDS,
  roundOver,
  underdogs,
  type Obstacle,
} from "./logic";

export const stampede: GameDefinition = {
  id: "stampede",
  name: "Thin Ice Stampede",
  tagline: "Hop late. Never stand still. Fall? Ride back for revenge.",
  description:
    "Five lanes of thin ice, herds of fat sliding critters barrelling in from the right. Hop lanes to " +
    "dodge: every second standing is a point, and leaving a lane a blink before impact is a CLOSE call " +
    "worth extra. Camp in one lane and the ice cracks under you. Get flattened and you ride straight " +
    "back in on your own bruiser, aiming it at whoever is still up. Three rounds, the last one in " +
    "OVERDRIVE. Most points wins.",
  durationMs: 0,
  controls:
    "Tap the top half of your zone to hop up, bottom half to hop down (swipes work too). " +
    "Once you're out, the same taps aim your revenge rider.",
  create: (ctx) => new Stampede(ctx),
};

const INTRO_S = 1.1;
const RESULT_S = 1.5;
const FINAL_S = 2.0;
const FONT = "Bebas Neue, Impact, sans-serif";
const HUD_H = 84;
const FLOE_LEFT = 40;
const SWIPE_PX = 60;
const BEST_KEY = "v2-points";
const ICE = ["#ffffff", "#bfe3ff", "#8fd0ff"] as const;

type Phase = "intro" | "round" | "result" | "final";
type Out = "none" | "bulldozed" | "sunk";

interface Seat {
  player: Player;
  index: number;
  /** Touch zone column. */
  zx: number;
  zw: number;
  /** Where the critter stands while alive. */
  standX: number;
  x: number;
  lane: number;
  y: number;
  hopFrom: number;
  hopT: number;
  alive: boolean;
  out: Out;
  outFor: number;
  rot: number;
  vx: number;
  splashed: boolean;
  sink: number;
  rider: boolean;
  riderLane: number;
  riderTimer: number;
  riderAim: number;
  /** Seconds spent standing in the current lane (thin ice). */
  camp: number;
  shield: boolean;
  score: number;
  roundScore: number;
  streak: number;
  closeCalls: number;
  botThreshold: number;
  botCooldown: number;
  bump: number;
  flash: number;
}

interface Critter {
  x: number;
  lanes: number[];
  big: boolean;
  stampede: boolean;
  /** Seat index of the rider steering this one, or null for the herd. */
  rider: number | null;
  speed: number;
  rx: number;
  ry: number;
  cy: number;
  face: number;
  wobble: number;
}

interface Crack {
  points: { x: number; y: number }[];
}

interface Hole {
  x: number;
  y: number;
  life: number;
}

interface Float {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

interface Touch {
  seat: number;
  y: number;
  dir: number;
  swiped: boolean;
}

class Stampede implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly laneH: number;
  private readonly playerR: number;
  private readonly cracks: Crack[] = [];
  private readonly touches = new Map<number, Touch>();
  private holes: Hole[] = [];
  private floats: Float[] = [];
  private phase: Phase = "intro";
  private timer = INTRO_S;
  private roundIndex = 0;
  private t = 0;
  private waveTimer = 0.9;
  private lastStampedeAt = -Infinity;
  private critters: Critter[] = [];
  private resultText = "";
  private resultColor = "#F4F7FB";
  private finished = false;
  private goShown = false;
  private bigWarned = false;
  private lastStandingAwarded = false;
  private overdrivePulse = 0;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    this.laneH = (ctx.height - HUD_H - 12) / LANES;
    this.playerR = Math.min(34, this.laneH * 0.3);
    const n = ctx.players.length;
    const zw = ctx.width / n;
    this.seats = ctx.players.map((player, i) => ({
      player,
      index: i,
      zx: i * zw,
      zw,
      standX: FLOE_LEFT + 70 + i * 72,
      x: 0,
      lane: 2,
      y: 0,
      hopFrom: 0,
      hopT: HOP_S,
      alive: true,
      out: "none",
      outFor: 0,
      rot: 0,
      vx: 0,
      splashed: false,
      sink: 0,
      rider: false,
      riderLane: 2,
      riderTimer: RIDER_GAP_S,
      riderAim: 0,
      camp: 0,
      shield: false,
      score: 0,
      roundScore: 0,
      streak: 0,
      closeCalls: 0,
      botThreshold: 0.8,
      botCooldown: 0,
      bump: 0,
      flash: 0,
    }));
    for (let i = 0; i < 14; i++) {
      const points = [{ x: ctx.rng.float(FLOE_LEFT, ctx.width), y: ctx.rng.float(HUD_H, ctx.height - 12) }];
      const segs = ctx.rng.int(2, 4);
      for (let k = 0; k < segs; k++) {
        const prev = points[points.length - 1]!;
        points.push({ x: prev.x + ctx.rng.float(-60, 60), y: prev.y + ctx.rng.float(-40, 40) });
      }
      this.cracks.push({ points });
    }
    this.startRound();
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
  }

  private laneY(lane: number): number {
    return HUD_H + (lane + 0.5) * this.laneH;
  }

  private get finalRound(): boolean {
    return this.roundIndex === ROUNDS - 1;
  }

  /** Round time on the difficulty curve: the final round starts in OVERDRIVE. */
  private get curveT(): number {
    return this.t + (this.finalRound ? OVERDRIVE_S : 0);
  }

  private startRound(): void {
    this.t = 0;
    this.waveTimer = 0.9;
    this.lastStampedeAt = -Infinity;
    this.critters = [];
    this.holes = [];
    this.goShown = false;
    this.bigWarned = false;
    this.lastStandingAwarded = false;
    const shielded = new Set(this.roundIndex > 0 ? underdogs(this.seats.map((s) => s.score)) : []);
    const lanes = [0, 1, 2, 3, 4];
    for (const s of this.seats) {
      // Spread players over the lanes so nobody starts stacked.
      const pick = lanes.splice(this.ctx.rng.int(0, lanes.length - 1), 1)[0] ?? 2;
      s.lane = pick;
      s.y = this.laneY(pick);
      s.hopFrom = s.y;
      s.hopT = HOP_S;
      s.x = s.standX;
      s.alive = true;
      s.out = "none";
      s.outFor = 0;
      s.rot = 0;
      s.vx = 0;
      s.splashed = false;
      s.sink = 0;
      s.rider = false;
      s.riderLane = pick;
      s.riderTimer = RIDER_GAP_S;
      s.riderAim = 0;
      s.camp = 0;
      s.shield = shielded.has(s.index);
      s.roundScore = 0;
      s.streak = 0;
      // Bravado: how late this bot likes to hop. Brave bots collect CLOSE calls and die for it.
      s.botThreshold = this.ctx.rng.float(0.4, 1.0);
      s.botCooldown = this.ctx.rng.float(0, 0.3);
      s.bump = 0;
      s.flash = 0;
    }
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.stepVisuals(dt);
    if (this.finished) return;

    if (this.phase === "intro") {
      this.timer -= dt;
      if (!this.goShown && this.timer <= 0.45) {
        this.goShown = true;
        this.callouts.show(this.finalRound ? "OVERDRIVE!" : "GO!", this.finalRound ? "#FF3D7A" : "#B8FF3D", {
          size: 110, life: 0.7, y: 0.5,
        });
        this.ctx.sfx.go();
        if (this.finalRound) this.juice.shake(0.35);
      }
      if (this.timer <= 0) this.phase = "round";
      return;
    }
    if (this.phase === "result" || this.phase === "final") {
      this.stepCritters(dt);
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

    this.t += dt;
    this.spawn(dt);
    this.riders(dt);
    this.stepCritters(dt);
    this.collide();
    this.thinIce(dt);
    this.bots(dt);
    for (const s of this.seats) {
      if (!s.alive) continue;
      s.score += dt;
      s.roundScore += dt;
    }
    this.checkLastStanding();

    const timedOut = this.t >= ROUND_S;
    if (roundOver(this.seats, timedOut)) this.endRound();
  }

  private spawn(dt: number): void {
    this.waveTimer -= dt;
    if (this.waveTimer > 0) return;
    const d = difficulty(this.curveT);
    const wave = planWave(this.curveT, this.ctx.rng, this.lastStampedeAt);
    this.waveTimer = d.interval * (wave.stampede ? 1.6 : 1);
    if (wave.stampede) {
      this.lastStampedeAt = this.curveT;
      this.callouts.show("STAMPEDE!", "#FF3D7A", { size: 96, life: 1.1, y: 0.5 });
      this.juice.shake(0.5);
      this.ctx.sfx.whoosh();
    } else if (wave.critters.some((c) => c.big) && !this.bigWarned) {
      this.bigWarned = true;
      this.callouts.show("BIG ONES!", "#FFB020", { size: 64, life: 0.9, y: 0.5 });
      this.ctx.sfx.whoosh();
    } else {
      this.ctx.sfx.tick();
    }
    for (const c of wave.critters) {
      this.addCritter(c.lane, c.big, wave.stampede, null, d.speed * (c.big ? 0.9 : 1) * (wave.stampede ? 1.15 : 1));
    }
  }

  private addCritter(lane: number, big: boolean, stampede: boolean, rider: number | null, speed: number): void {
    const lanes = occupiedLanes({ lane, big });
    const ry = big ? this.laneH * 0.92 : this.laneH * 0.36;
    const rx = big ? this.laneH * 0.78 : this.laneH * 0.44;
    const cy = big ? this.laneY(lane) + this.laneH / 2 : this.laneY(lane);
    this.critters.push({
      x: this.ctx.width + rx + (stampede || rider !== null ? 0 : this.ctx.rng.float(0, 90)),
      lanes,
      big,
      stampede,
      rider,
      speed,
      rx,
      ry,
      cy,
      face: rider !== null ? 2 : this.ctx.rng.int(0, 2),
      wobble: this.ctx.rng.float(0, Math.PI * 2),
    });
  }

  /** Flattened players come back as riders: they aim a critter of their own every few seconds. */
  private riders(dt: number): void {
    const d = difficulty(this.curveT);
    let targets: { lane: number; score: number }[] | null = null;
    for (const s of this.seats) {
      if (s.alive) continue;
      s.outFor += dt;
      if (!s.rider) {
        if (s.outFor < RIDER_DELAY_S || this.seats.every((o) => !o.alive)) continue;
        s.rider = true;
        s.riderLane = s.lane;
        s.riderTimer = RIDER_GAP_S * 0.7;
        this.float(s.zx + s.zw / 2, this.ctx.height - 70, `${s.player.name} RIDES BACK!`, s.player.color, 1.1);
        this.ctx.sfx.select();
        continue;
      }
      if (s.player.kind === "bot") {
        s.riderAim -= dt;
        if (s.riderAim <= 0) {
          s.riderAim = this.ctx.rng.float(0.25, 0.5);
          targets ??= this.seats.filter((o) => o.alive).map((o) => ({ lane: o.lane, score: o.score }));
          const aim = riderBotAim(targets, this.ctx.rng);
          if (aim !== null && aim !== s.riderLane) this.hop(s, aim > s.riderLane ? 1 : -1);
        }
      }
      s.riderTimer -= dt;
      if (s.riderTimer > 0) continue;
      s.riderTimer = RIDER_GAP_S;
      this.addCritter(s.riderLane, false, false, s.index, d.speed * 1.05);
      this.juice.burst(this.ctx.width - 30, this.laneY(s.riderLane), [s.player.color, "#ffffff"], {
        count: 12, speed: 220, gravity: 300, size: 4, life: 0.4, angle: Math.PI, spread: 1.2,
      });
      this.ctx.sfx.whoosh();
    }
  }

  private stepCritters(dt: number): void {
    for (const c of this.critters) c.x -= c.speed * dt;
    this.critters = this.critters.filter((c) => c.x + c.rx > -60);
  }

  private collide(): void {
    for (const s of this.seats) {
      if (!s.alive) continue;
      for (const c of this.critters) {
        if (!c.lanes.includes(s.lane)) continue;
        if (Math.abs(c.x - s.x) < c.rx + this.playerR * 0.75) {
          if (s.shield) this.popShield(s, c);
          else this.flatten(s, c);
          break;
        }
      }
    }
  }

  private popShield(s: Seat, c: Critter): void {
    s.shield = false;
    s.flash = 1;
    this.critters = this.critters.filter((o) => o !== c);
    this.juice.hitStop(0.08);
    this.juice.shake(0.35);
    this.juice.burst(c.x, c.cy, ["#B8FF3D", "#ffffff", s.player.color], { count: 26, speed: 360, gravity: 400, size: 5 });
    this.float(s.x, s.y - this.playerR - 30, "SHIELD!", "#B8FF3D", 0.9);
    this.ctx.sfx.streak(2);
  }

  private flatten(s: Seat, c: Critter): void {
    s.alive = false;
    s.out = "bulldozed";
    s.outFor = 0;
    s.streak = 0;
    s.vx = -c.speed * 1.25;
    s.hopT = HOP_S;
    this.juice.shake(0.4);
    this.juice.hitStop(0.06);
    this.juice.burst(s.x, s.y, [s.player.color, "#ffffff", "#bfe3ff"], { count: 22, speed: 320, gravity: 500, size: 5 });
    this.ctx.sfx.hit();
    const rider = c.rider === null ? null : this.seats[c.rider];
    if (rider && rider !== s) {
      rider.score += REVENGE_BONUS;
      rider.roundScore += REVENGE_BONUS;
      rider.flash = 1;
      this.callouts.show(`${rider.player.name} REVENGE!`, rider.player.color, { size: 56, life: 1, y: 0.86 });
      this.float(s.x, s.y - this.playerR - 30, `+${REVENGE_BONUS}`, rider.player.color, 1);
      this.ctx.sfx.streak(4);
    } else {
      this.callouts.show(`${s.player.name} FLATTENED!`, s.player.color, { size: 46, life: 0.9, y: 0.86 });
    }
    if (this.seats.every((o) => !o.alive)) this.juice.slowMo(0.5, 0.3);
  }

  /** Stand still and the ice under you gives way. */
  private thinIce(dt: number): void {
    const limit = crackLimit(this.curveT);
    for (const s of this.seats) {
      if (!s.alive) continue;
      if (s.hopT < HOP_S) continue;
      s.camp += dt;
      if (s.camp < limit) continue;
      s.alive = false;
      s.out = "sunk";
      s.outFor = 0;
      s.streak = 0;
      s.sink = 0;
      this.holes.push({ x: s.x, y: s.y, life: 1.6 });
      this.juice.shake(0.3);
      this.juice.hitStop(0.05);
      this.juice.burst(s.x, s.y + this.playerR * 0.5, ICE, { count: 24, speed: 300, gravity: 600, size: 5, angle: -Math.PI / 2, spread: 2.2 });
      this.callouts.show(`${s.player.name} FELL THROUGH!`, s.player.color, { size: 46, life: 0.9, y: 0.86 });
      this.ctx.sfx.hit();
      if (this.seats.every((o) => !o.alive)) this.juice.slowMo(0.5, 0.3);
    }
  }

  private checkLastStanding(): void {
    if (this.lastStandingAwarded || this.seats.length < 2) return;
    const alive = this.seats.filter((s) => s.alive);
    if (alive.length !== 1) return;
    this.lastStandingAwarded = true;
    const s = alive[0]!;
    s.score += LAST_STANDING_BONUS;
    s.roundScore += LAST_STANDING_BONUS;
    s.flash = 1;
    this.callouts.show(`${s.player.name} LAST STANDING!`, s.player.color, { size: 52, life: 1.1, y: 0.3 });
    this.float(s.x, s.y - this.playerR - 30, `+${LAST_STANDING_BONUS}`, s.player.color, 1);
    this.ctx.sfx.streak(3);
  }

  private bots(dt: number): void {
    const d = difficulty(this.curveT);
    const limit = crackLimit(this.curveT);
    let obs: Obstacle[] | null = null;
    for (const s of this.seats) {
      if (s.player.kind !== "bot" || !s.alive) continue;
      s.botCooldown -= dt;
      if (s.botCooldown > 0) continue;
      obs ??= this.critters.map((c) => ({ x: c.x, rx: c.rx, lanes: c.lanes }));
      const to = botDecide(s.lane, obs, s.x, this.playerR, d.speed, s.botThreshold, this.ctx.rng, 0.1, s.camp / limit);
      if (to !== null) {
        this.hop(s, to - s.lane);
        s.botCooldown = 0.25;
      }
    }
  }

  private hop(s: Seat, dir: number): void {
    if (this.phase !== "round" || dir === 0) return;
    if (s.rider) {
      const next = s.riderLane + dir;
      if (next < 0 || next >= LANES) {
        this.ctx.sfx.miss();
        return;
      }
      s.riderLane = next;
      this.ctx.sfx.tick();
      return;
    }
    if (!s.alive) return;
    const next = s.lane + dir;
    if (next < 0 || next >= LANES) {
      s.bump = 1;
      this.ctx.sfx.miss();
      return;
    }
    const obs: Obstacle[] = this.critters.map((c) => ({ x: c.x, rx: c.rx, lanes: c.lanes }));
    const close = isNearMiss(obs, s.lane, s.x, this.playerR, difficulty(this.curveT).speed);
    s.hopFrom = s.y;
    s.lane = next;
    s.hopT = 0;
    s.camp = 0;
    this.ctx.sfx.tick();
    this.juice.burst(s.x, s.y + this.playerR * 0.8, "#ffffff", {
      count: 5, speed: 120, gravity: 300, size: 3, life: 0.3, angle: Math.PI / 2, spread: 2,
    });
    if (close) {
      s.streak += 1;
      s.closeCalls += 1;
      const bonus = nearMissBonus(s.streak);
      s.score += bonus;
      s.roundScore += bonus;
      s.flash = 1;
      const label = s.streak > 1 ? `CLOSE ×${s.streak}! +${bonus}` : `CLOSE! +${bonus}`;
      this.float(s.x, s.y - this.playerR - 30, label, "#FFB020", 0.9);
      this.juice.burst(s.x + this.playerR, s.y, ["#FFB020", "#ffffff"], { count: 10, speed: 200, gravity: 200, size: 4, life: 0.4 });
      this.ctx.sfx.streak(Math.min(6, s.streak));
    }
  }

  private float(x: number, y: number, text: string, color: string, life: number): void {
    this.floats.push({ x, y, text, color, life, maxLife: life });
  }

  private stepVisuals(dt: number): void {
    this.overdrivePulse += dt;
    for (const f of this.floats) {
      f.life -= dt;
      f.y -= 28 * dt;
    }
    this.floats = this.floats.filter((f) => f.life > 0);
    for (const h of this.holes) h.life -= dt;
    this.holes = this.holes.filter((h) => h.life > 0);
    for (const s of this.seats) {
      s.bump = Math.max(0, s.bump - dt * 5);
      s.flash = Math.max(0, s.flash - dt * 2.5);
      if (s.alive) {
        if (s.hopT < HOP_S) {
          s.hopT = Math.min(HOP_S, s.hopT + dt);
          const p = s.hopT / HOP_S;
          const e = 1 - (1 - p) * (1 - p);
          s.y = s.hopFrom + (this.laneY(s.lane) - s.hopFrom) * e;
        } else {
          s.y = this.laneY(s.lane);
        }
      } else if (s.out === "bulldozed" && s.vx !== 0) {
        s.x += s.vx * dt;
        s.rot += 16 * dt;
        if (!s.splashed && s.x < FLOE_LEFT) {
          s.splashed = true;
          this.juice.burst(FLOE_LEFT, s.y, ["#3EE0FF", "#bfe3ff", "#ffffff"], {
            count: 18, speed: 260, gravity: 700, size: 4, angle: -Math.PI / 2, spread: 1.6,
          });
          this.ctx.sfx.whoosh();
        }
        if (s.x < -80) s.vx = 0;
      } else if (s.out === "sunk" && s.sink < 1) {
        s.sink = Math.min(1, s.sink + dt * 1.8);
        if (!s.splashed && s.sink > 0.6) {
          s.splashed = true;
          this.juice.burst(s.x, s.y + this.playerR, ["#3EE0FF", "#bfe3ff", "#ffffff"], {
            count: 14, speed: 220, gravity: 700, size: 4, angle: -Math.PI / 2, spread: 1.4,
          });
        }
      }
    }
  }

  private endRound(): void {
    if (this.phase !== "round") return;
    let top = -Infinity;
    for (const s of this.seats) top = Math.max(top, s.roundScore);
    const best = this.seats.filter((s) => s.roundScore >= top - 0.001);
    if (best.length === 1) {
      const w = best[0]!;
      this.resultText = `${w.player.name} takes the round  +${Math.round(w.roundScore)}`;
      this.resultColor = w.player.color;
    } else {
      this.resultText = `${best.map((s) => s.player.name).join(" & ")} split the round`;
      this.resultColor = "#F4F7FB";
    }
    this.ctx.sfx.collect();
    if (this.roundIndex + 1 >= ROUNDS) {
      this.phase = "final";
      this.timer = RESULT_S + FINAL_S;
      const winners = matchWinners(this.seats.map((s) => Math.floor(s.score)));
      const names = winners.map((i) => this.seats[i]!.player.name);
      const color = winners.length === 1 ? this.seats[winners[0]!]!.player.color : "#F4F7FB";
      this.callouts.show(`${names.join(" & ")} WINS!`, color, { size: 72, life: RESULT_S + FINAL_S, y: 0.22 });
      this.resultText = `${names.join(" & ")} ${winners.length > 1 ? "share it!" : "owns the ice!"}`;
      this.resultColor = color;
      this.ctx.sfx.win();
      let records = 0;
      for (const s of this.seats) {
        if (s.player.kind !== "human") continue;
        if (!saveBest(stampede.id, Math.floor(s.score), BEST_KEY)) continue;
        this.callouts.show(`${s.player.name} NEW RECORD ${Math.floor(s.score)}`, "#FFB020", {
          size: 40, life: RESULT_S + FINAL_S, y: 0.64 + records * 0.07,
        });
        records += 1;
      }
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

  private seatAt(x: number): number {
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (s.player.kind === "human" && x >= s.zx && x < s.zx + s.zw) return i;
    }
    return -1;
  }

  private readonly onDown = (e: PointerEvent): void => {
    const p = this.toLogical(e);
    const i = this.seatAt(p.x);
    if (i < 0) return;
    e.preventDefault();
    const dir = p.y < this.ctx.height / 2 ? -1 : 1;
    this.touches.set(e.pointerId, { seat: i, y: p.y, dir, swiped: false });
    this.hop(this.seats[i]!, dir);
  };

  private readonly onMove = (e: PointerEvent): void => {
    const t = this.touches.get(e.pointerId);
    if (!t || t.swiped) return;
    const p = this.toLogical(e);
    const dy = p.y - t.y;
    if (Math.abs(dy) < SWIPE_PX) return;
    t.swiped = true;
    const dir = dy < 0 ? -1 : 1;
    // A swipe against the tap's direction means they wanted the other way: undo and go.
    if (dir !== t.dir) {
      const s = this.seats[t.seat]!;
      this.hop(s, dir);
      this.hop(s, dir);
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.touches.delete(e.pointerId);
  };

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);
    this.drawFloe(g);
    this.drawZones(g);
    this.drawRiderLanes(g);
    const drawables: { y: number; draw: () => void }[] = [];
    for (const s of this.seats) drawables.push({ y: s.y, draw: () => this.drawPlayer(g, s) });
    for (const c of this.critters) drawables.push({ y: c.cy + c.ry, draw: () => this.drawCritter(g, c) });
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.draw();
    this.drawRiderMarkers(g);
    this.juice.end(g);
    this.drawFloats(g);
    this.drawHud(g);
    this.drawCenter(g);
    this.callouts.draw(g, width, height);
  }

  private drawFloe(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    // Water on the left where the fallen end up.
    g.fillStyle = "#0a2a4a";
    g.fillRect(0, HUD_H, FLOE_LEFT, height - HUD_H);
    const od = this.finalRound && this.phase === "round" ? 0.5 + 0.5 * Math.sin(this.overdrivePulse * 3) : 0;
    for (let l = 0; l < LANES; l++) {
      const y = HUD_H + l * this.laneH;
      g.fillStyle = l % 2 === 0 ? "#dcedf9" : "#c3dcef";
      g.fillRect(FLOE_LEFT, y, width - FLOE_LEFT, this.laneH);
    }
    if (od > 0) {
      g.fillStyle = `rgba(255,61,122,${0.04 + 0.05 * od})`;
      g.fillRect(FLOE_LEFT, HUD_H, width - FLOE_LEFT, height - HUD_H);
    }
    // Jagged floe edge.
    g.fillStyle = "#eef7ff";
    g.beginPath();
    g.moveTo(FLOE_LEFT, HUD_H);
    for (let y = HUD_H; y <= height; y += 24) g.lineTo(FLOE_LEFT - 6 + ((y / 24) % 2) * 12, y);
    g.lineTo(FLOE_LEFT + 10, height);
    g.lineTo(FLOE_LEFT + 10, HUD_H);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(90,130,170,0.35)";
    g.lineWidth = 2;
    for (const c of this.cracks) {
      g.beginPath();
      c.points.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
      g.stroke();
    }
    g.strokeStyle = "rgba(60,100,150,0.25)";
    g.lineWidth = 2;
    g.setLineDash([14, 10]);
    for (let l = 1; l < LANES; l++) {
      const y = HUD_H + l * this.laneH;
      g.beginPath();
      g.moveTo(FLOE_LEFT, y);
      g.lineTo(width, y);
      g.stroke();
    }
    g.setLineDash([]);
    // Holes left by players who fell through.
    for (const h of this.holes) {
      g.save();
      g.globalAlpha = Math.min(1, h.life / 0.6);
      g.fillStyle = "#0a2a4a";
      g.beginPath();
      g.ellipse(h.x, h.y + this.playerR * 0.6, this.playerR * 1.4, this.playerR * 0.8, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#eef7ff";
      g.lineWidth = 3;
      g.stroke();
      g.restore();
    }
  }

  private drawZones(g: CanvasRenderingContext2D): void {
    const { height } = this.ctx;
    for (const s of this.seats) {
      g.save();
      g.globalAlpha = 0.07;
      g.fillStyle = s.player.color;
      g.fillRect(s.zx, HUD_H, s.zw, height - HUD_H);
      g.globalAlpha = 1;
      g.strokeStyle = "rgba(7,11,20,0.25)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(s.zx + s.zw, HUD_H);
      g.lineTo(s.zx + s.zw, height);
      g.stroke();
      if (s.player.kind === "human" && this.phase === "round" && (s.alive || s.rider)) {
        g.globalAlpha = 0.35;
        g.fillStyle = s.player.color;
        g.font = `700 30px ${FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(s.rider ? "▲ AIM UP" : "▲ UP", s.zx + s.zw / 2, HUD_H + 26);
        g.fillText(s.rider ? "▼ AIM DOWN" : "▼ DOWN", s.zx + s.zw / 2, height - 26);
        g.globalAlpha = 0.18;
        g.setLineDash([6, 8]);
        g.strokeStyle = s.player.color;
        g.beginPath();
        g.moveTo(s.zx + 12, height / 2);
        g.lineTo(s.zx + s.zw - 12, height / 2);
        g.stroke();
        g.setLineDash([]);
      }
      g.restore();
    }
  }

  /** Faint tint over the lane each rider is aiming at: fair warning for whoever is still up. */
  private drawRiderLanes(g: CanvasRenderingContext2D): void {
    if (this.phase !== "round") return;
    const { width } = this.ctx;
    for (const s of this.seats) {
      if (!s.rider) continue;
      g.save();
      g.globalAlpha = 0.1 + 0.06 * Math.sin(this.overdrivePulse * 9);
      g.fillStyle = s.player.color;
      g.fillRect(FLOE_LEFT, HUD_H + s.riderLane * this.laneH, width - FLOE_LEFT, this.laneH);
      g.restore();
    }
  }

  private drawRiderMarkers(g: CanvasRenderingContext2D): void {
    if (this.phase !== "round") return;
    const { width } = this.ctx;
    const perLane = new Map<number, number>();
    for (const s of this.seats) {
      if (!s.rider) continue;
      const k = perLane.get(s.riderLane) ?? 0;
      perLane.set(s.riderLane, k + 1);
      const x = width - 30 - k * 48;
      const y = this.laneY(s.riderLane);
      const frac = 1 - s.riderTimer / RIDER_GAP_S;
      g.save();
      g.translate(x, y);
      g.fillStyle = s.player.color;
      g.beginPath();
      g.moveTo(-20, -22);
      g.lineTo(10, -22);
      g.lineTo(26, 0);
      g.lineTo(10, 22);
      g.lineTo(-20, 22);
      g.closePath();
      g.fill();
      g.strokeStyle = "rgba(7,11,20,0.35)";
      g.lineWidth = 3;
      g.beginPath();
      g.arc(-3, 0, 13, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = "#F4F7FB";
      g.lineWidth = 4;
      g.beginPath();
      g.arc(-3, 0, 13, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      g.stroke();
      g.fillStyle = "#070b14";
      g.font = `700 16px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(s.player.name[0] ?? "?", -3, 1);
      g.restore();
    }
  }

  private drawPlayer(g: CanvasRenderingContext2D, s: Seat): void {
    if (!s.alive && (s.out === "none" || (s.out === "bulldozed" && s.vx === 0) || (s.out === "sunk" && s.sink >= 1))) return;
    const r = this.playerR;
    g.save();
    if (s.out === "bulldozed") g.globalAlpha = Math.max(0, Math.min(1, (s.x + 60) / 120));
    if (s.out === "sunk") g.globalAlpha = 1 - s.sink;
    // Thin ice cracking under the feet.
    if (s.alive && this.phase === "round") {
      const frac = s.camp / crackLimit(this.curveT);
      if (frac > 0.12) this.drawIceCracks(g, s, frac);
    }
    // Shadow on the ice.
    g.fillStyle = "rgba(20,40,70,0.22)";
    g.beginPath();
    g.ellipse(s.x, s.y + r * 0.95, r * 0.9, r * 0.3, 0, 0, Math.PI * 2);
    g.fill();

    g.translate(s.x, s.y);
    if (s.out === "bulldozed") g.rotate(s.rot);
    if (s.out === "sunk") {
      g.translate(0, s.sink * r * 1.6);
      g.scale(1 - s.sink * 0.7, 1 - s.sink * 0.7);
    }
    const hp = s.hopT < HOP_S ? Math.sin((s.hopT / HOP_S) * Math.PI) : 0;
    const bump = s.bump;
    g.translate(0, -hp * 14);
    g.scale(1 + hp * 0.22 + bump * 0.2, 1 - hp * 0.22 - bump * 0.2);

    g.fillStyle = s.player.color;
    g.shadowColor = s.flash > 0 ? "#ffffff" : s.player.color;
    g.shadowBlur = 14 + s.flash * 20;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    if (s.flash > 0) {
      g.fillStyle = `rgba(255,255,255,${s.flash * 0.6})`;
      g.fill();
    }
    // Belly.
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.beginPath();
    g.ellipse(r * 0.12, r * 0.25, r * 0.52, r * 0.6, 0, 0, Math.PI * 2);
    g.fill();
    // Eyes (looking right, at the herd).
    g.fillStyle = "#070b14";
    g.beginPath();
    g.arc(r * 0.18, -r * 0.3, r * 0.13, 0, Math.PI * 2);
    g.arc(r * 0.55, -r * 0.3, r * 0.13, 0, Math.PI * 2);
    g.fill();
    // Beak.
    g.fillStyle = "#FFB020";
    g.beginPath();
    g.moveTo(r * 0.5, -r * 0.08);
    g.lineTo(r * 0.95, 0);
    g.lineTo(r * 0.5, r * 0.12);
    g.closePath();
    g.fill();
    // Feet.
    g.beginPath();
    g.ellipse(-r * 0.3, r * 0.95, r * 0.3, r * 0.14, 0, 0, Math.PI * 2);
    g.ellipse(r * 0.3, r * 0.95, r * 0.3, r * 0.14, 0, 0, Math.PI * 2);
    g.fill();
    // Underdog shield bubble.
    if (s.shield && s.alive) {
      g.strokeStyle = "#B8FF3D";
      g.lineWidth = 4;
      g.globalAlpha = 0.75 + 0.25 * Math.sin(this.overdrivePulse * 10);
      g.beginPath();
      g.arc(0, 0, r * 1.45, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 0.18;
      g.fillStyle = "#B8FF3D";
      g.fill();
    }
    g.restore();

    if (s.alive) {
      g.save();
      g.font = `700 20px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "bottom";
      g.lineWidth = 4;
      g.strokeStyle = "rgba(7,11,20,0.7)";
      g.strokeText(s.player.name, s.x, s.y - r - 6);
      g.fillStyle = s.player.color;
      g.fillText(s.player.name, s.x, s.y - r - 6);
      g.restore();
    }
  }

  private drawIceCracks(g: CanvasRenderingContext2D, s: Seat, frac: number): void {
    const r = this.playerR;
    const n = Math.min(8, 2 + Math.floor(frac * 8));
    const reach = r * (0.9 + frac * 1.6);
    const urgent = frac > 0.65;
    g.save();
    g.translate(s.x, s.y + r * 0.9);
    if (urgent) g.translate(Math.sin(this.overdrivePulse * 60) * 2 * frac, 0);
    g.strokeStyle = urgent ? `rgba(255,61,122,${0.5 + 0.4 * Math.abs(Math.sin(this.overdrivePulse * 12))})` : "rgba(40,70,110,0.6)";
    g.lineWidth = urgent ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + s.index * 0.7;
      const len = reach * (0.6 + 0.4 * Math.abs(Math.sin(k * 2.3 + s.index)));
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * len * 0.5, Math.sin(a) * len * 0.22);
      g.lineTo(Math.cos(a + 0.35) * len, Math.sin(a + 0.35) * len * 0.42);
      g.stroke();
    }
    g.restore();
    if (urgent) {
      g.save();
      g.font = `700 22px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "bottom";
      g.lineWidth = 4;
      g.strokeStyle = "rgba(7,11,20,0.7)";
      g.strokeText("MOVE!", s.x, s.y - r - 26);
      g.fillStyle = "#FF3D7A";
      g.fillText("MOVE!", s.x, s.y - r - 26);
      g.restore();
    }
  }

  private drawCritter(g: CanvasRenderingContext2D, c: Critter): void {
    const { rx, ry } = c;
    const rider = c.rider === null ? null : this.seats[c.rider];
    g.save();
    g.translate(c.x, c.cy);
    g.rotate(Math.sin(c.x / 36 + c.wobble) * 0.05);
    // Speed streaks trailing to the right.
    g.strokeStyle = rider ? rider.player.color : "rgba(255,255,255,0.7)";
    g.lineWidth = 3;
    g.lineCap = "round";
    const len = 20 + c.speed * 0.08;
    for (let k = -1; k <= 1; k++) {
      g.beginPath();
      g.moveTo(rx + 8, k * ry * 0.45);
      g.lineTo(rx + 8 + len * (k === 0 ? 1.2 : 0.8), k * ry * 0.45);
      g.stroke();
    }
    // Shadow.
    g.fillStyle = "rgba(20,40,70,0.22)";
    g.beginPath();
    g.ellipse(0, ry * 0.92, rx * 0.95, ry * 0.22, 0, 0, Math.PI * 2);
    g.fill();
    // Fat body.
    g.fillStyle = rider ? "#4a5568" : c.stampede ? "#f1c9cf" : c.big ? "#b9c9da" : "#e6edf5";
    g.strokeStyle = rider ? rider.player.color : c.stampede ? "#b4505f" : "#6f8aa8";
    g.lineWidth = rider ? 4 : 3;
    g.beginPath();
    g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    // Belly.
    g.fillStyle = rider ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.75)";
    g.beginPath();
    g.ellipse(-rx * 0.2, ry * 0.2, rx * 0.55, ry * 0.55, 0, 0, Math.PI * 2);
    g.fill();
    // Flippers.
    g.fillStyle = rider ? "#2d3748" : c.stampede ? "#d9a0a9" : "#9fb3c8";
    g.beginPath();
    g.ellipse(rx * 0.35, ry * 0.75, rx * 0.35, ry * 0.18, 0.3, 0, Math.PI * 2);
    g.fill();
    // Face, facing left (direction of travel).
    const ex = -rx * 0.45;
    const ey = -ry * 0.25;
    const er = Math.max(3, ry * 0.12);
    const angry = c.stampede || c.face === 2;
    g.fillStyle = rider ? "#ffffff" : "#070b14";
    if (c.face === 1 && !c.stampede) {
      // Happy closed eyes.
      g.strokeStyle = "#070b14";
      g.lineWidth = 3;
      g.beginPath();
      g.arc(ex, ey, er * 1.2, Math.PI, 0);
      g.arc(ex + rx * 0.35, ey, er * 1.2, Math.PI, 0);
      g.stroke();
    } else {
      g.beginPath();
      g.arc(ex, ey, er, 0, Math.PI * 2);
      g.arc(ex + rx * 0.35, ey, er, 0, Math.PI * 2);
      g.fill();
    }
    if (angry) {
      // Angry brows.
      g.strokeStyle = rider ? "#ffffff" : "#070b14";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(ex - er * 1.6, ey - er * 2.4);
      g.lineTo(ex + er * 1.2, ey - er * 1.2);
      g.moveTo(ex + rx * 0.35 - er * 1.2, ey - er * 1.2);
      g.lineTo(ex + rx * 0.35 + er * 1.6, ey - er * 2.4);
      g.stroke();
    }
    // Cheeks and mouth.
    g.fillStyle = "rgba(255,120,150,0.45)";
    g.beginPath();
    g.arc(ex - er * 1.5, ey + er * 2, er * 1.1, 0, Math.PI * 2);
    g.arc(ex + rx * 0.35 + er * 1.5, ey + er * 2, er * 1.1, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = rider ? "#ffffff" : "#070b14";
    g.lineWidth = 2.5;
    g.beginPath();
    if (c.face === 0 || angry) g.arc(ex + rx * 0.17, ey + er * 2.4, er * 1.3, angry ? Math.PI : 0.2, angry ? 0 : Math.PI - 0.2);
    else g.arc(ex + rx * 0.17, ey + er * 2.6, er * 0.7, 0, Math.PI * 2);
    g.stroke();
    // The rider on its back: a little copy of the fallen player, out for blood.
    if (rider) {
      const pr = ry * 0.5;
      g.translate(rx * 0.05, -ry * 0.95);
      g.fillStyle = rider.player.color;
      g.beginPath();
      g.arc(0, 0, pr, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.85)";
      g.beginPath();
      g.ellipse(-pr * 0.1, pr * 0.25, pr * 0.5, pr * 0.55, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#070b14";
      g.beginPath();
      g.arc(-pr * 0.2, -pr * 0.3, pr * 0.14, 0, Math.PI * 2);
      g.arc(-pr * 0.55, -pr * 0.3, pr * 0.14, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#070b14";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(-pr * 0.75, -pr * 0.7);
      g.lineTo(-pr * 0.35, -pr * 0.5);
      g.moveTo(-pr * 0.05, -pr * 0.5);
      g.lineTo(pr * 0.2, -pr * 0.7);
      g.stroke();
      g.fillStyle = "#FFB020";
      g.beginPath();
      g.moveTo(-pr * 0.5, -pr * 0.05);
      g.lineTo(-pr * 0.95, 0.05 * pr);
      g.lineTo(-pr * 0.5, pr * 0.15);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  private drawFloats(g: CanvasRenderingContext2D): void {
    for (const f of this.floats) {
      const t = 1 - f.life / f.maxLife;
      const pop = t < 0.15 ? 0.7 + (t / 0.15) * 0.45 : t < 0.3 ? 1.15 - ((t - 0.15) / 0.15) * 0.15 : 1;
      g.save();
      g.globalAlpha = Math.min(1, f.life / (f.maxLife * 0.35));
      g.translate(f.x, f.y);
      g.scale(pop, pop);
      g.font = `700 28px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 5;
      g.strokeStyle = "rgba(7,11,20,0.8)";
      g.strokeText(f.text, 0, 0);
      g.fillStyle = f.color;
      g.fillText(f.text, 0, 0);
      g.restore();
    }
  }

  private drawHud(g: CanvasRenderingContext2D): void {
    const { width } = this.ctx;
    if (this.phase === "round") drawTimerBar(g, width, Math.max(0, ROUND_S - this.t), ROUND_S);
    g.save();
    g.font = `700 17px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const label = this.finalRound ? "FINAL ROUND · OVERDRIVE" : `ROUND ${this.roundIndex + 1} OF ${ROUNDS}`;
    const lw = g.measureText(label).width + 28;
    g.fillStyle = "#0c1628";
    g.beginPath();
    g.roundRect(width / 2 - lw / 2, 12, lw, 22, 11);
    g.fill();
    g.fillStyle = this.finalRound ? "#FF3D7A" : "#F4F7FB";
    g.fillText(label, width / 2, 23);
    g.restore();
    const inRound = this.phase === "round";
    for (const s of this.seats) {
      const cx = s.zx + s.zw / 2;
      const dim = inRound && !s.alive;
      g.save();
      g.textBaseline = "top";
      g.font = `700 28px ${FONT}`;
      g.textAlign = "right";
      g.fillStyle = dim ? "rgba(244,247,251,0.45)" : s.player.color;
      g.fillText(s.player.name, cx - 8, 34);
      g.textAlign = "left";
      g.font = `700 34px ${FONT}`;
      g.fillStyle = s.flash > 0 ? "#FFB020" : "#F4F7FB";
      g.fillText(String(Math.floor(s.score)), cx + 8, 30);
      g.font = `700 17px ${FONT}`;
      g.textAlign = "center";
      let status = "";
      let color = "rgba(244,247,251,0.6)";
      if (!inRound && this.phase !== "intro") {
        status = `+${Math.round(s.roundScore)} THIS ROUND`;
      } else if (inRound && s.rider) {
        status = "RIDER · AIM & RAM";
        color = s.player.color;
      } else if (inRound && !s.alive) {
        status = "OUT";
      } else if (s.shield) {
        status = "UNDERDOG SHIELD";
        color = "#B8FF3D";
      } else if (inRound && s.streak >= 2) {
        status = `CLOSE ×${s.streak}`;
        color = "#FFB020";
      }
      if (status) {
        g.fillStyle = color;
        g.fillText(status, cx, 64);
      }
      g.restore();
    }
  }

  private drawCenter(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    let text = "";
    let sub = "";
    let color = "#F4F7FB";
    let size = 64;
    if (this.phase === "intro") {
      if (this.goShown) return;
      text = this.finalRound ? "FINAL ROUND" : `ROUND ${this.roundIndex + 1}`;
      sub = this.finalRound ? "everything faster" : this.roundIndex === 0 ? "hop late · never stand still" : "";
      if (this.finalRound) color = "#FF3D7A";
      size = 84;
    } else if (this.phase === "result" || this.phase === "final") {
      text = this.resultText;
      color = this.resultColor;
      size = 56;
    } else {
      return;
    }
    g.save();
    g.font = `700 ${size}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 10;
    g.strokeStyle = "rgba(7,11,20,0.85)";
    const y = height * (this.phase === "final" ? 0.5 : 0.42);
    g.strokeText(text, width / 2, y);
    g.fillStyle = color;
    g.fillText(text, width / 2, y);
    if (sub) {
      g.font = `700 30px ${FONT}`;
      g.lineWidth = 6;
      g.strokeText(sub, width / 2, y + size * 0.75);
      g.fillStyle = "#F4F7FB";
      g.fillText(sub, width / 2, y + size * 0.75);
    }
    g.restore();
  }

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({ playerId: s.player.id, score: Math.floor(s.score) }));
  }

  getStats(): GameStat[] {
    return this.seats.map((s) => ({
      playerId: s.player.id,
      label: "Close calls",
      value: String(s.closeCalls),
    }));
  }

  destroy(): void {
    const c = this.ctx.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
  }
}

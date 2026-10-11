import { drawPlayerOrb, fillArena } from "../../core/draw";
import { Callouts, Juice, saveBest } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  angleDelta,
  applySteer,
  applyTilt,
  BALL_R,
  BAR_HALF_W,
  botSlamAim,
  botSteer,
  BUMP_POINTS,
  collidePair,
  computeTilt,
  EDGE_DANGER_PX,
  EDGE_SAFE_PX,
  FALL_S,
  FRICTION,
  ghostTarget,
  GHOST_STOMP_COOLDOWN_S,
  GHOST_STOMP_S,
  GHOST_STOMP_WEIGHT,
  GHOST_TURN_RATE,
  GHOST_WEIGHT,
  ICE_FRICTION,
  ICE_TRACTION,
  inRect,
  integrate,
  isTap,
  makeBall,
  matchOver,
  MAX_ROUNDS,
  outside,
  OVERDRIVE_AT_S,
  OVERDRIVE_SHRINK_PX_S,
  OVERDRIVE_TILT_GAIN,
  padZones,
  planHazards,
  ROUND_CAP_S,
  roundMultiplier,
  SHRINK_EVERY_S,
  SHRINK_FACTOR,
  SPIN_RATE,
  spinnerCollide,
  startPositions,
  startSlam,
  stick,
  STICK_MAX,
  tickSlam,
  turnToward,
  UNDERDOG_R,
  underdogs,
  WIN_POINTS,
  WIND_ACCEL,
  type Ball,
  type Hazard,
  type Rect,
  type Vec,
  type Weight,
} from "./logic";

export const sumoRings: GameDefinition = {
  id: "sumo-rings",
  name: "Tilt Sumo",
  tagline: "Tip the ring. Slam them off.",
  description:
    "Heavy balls on a round platform balanced on a pivot: wherever the weight gathers, the ring TIPS and " +
    "everyone slides downhill. Drag in your pad to steer, TAP to SLAM (a charged dash that hits hard, but " +
    "miss and you fly off). Fall and you ride the rim as a ghost: drag to haunt the leader and TAP to STOMP, " +
    "tipping the ring against the survivors. Three rounds, hazards from round 2, double points in the FINAL. " +
    "Points for the last ball standing and for every bump-off.",
  durationMs: 0,
  controls: "Drag to steer, tap to slam",
  create: (ctx) => new SumoRings(ctx),
};

const INTRO_S = 1.8;
const RESULT_S = 2.0;
const FINAL_S = 2.4;
const FONT = "Bebas Neue, Impact, sans-serif";
const PHYS_STEP = 1 / 120;
const GUST_WARN_S = 0.7;
const GUST_ON_S = 1.5;
const GUST_GAP_S = 2.2;
const BOT_THINK_S = 0.15;
const BUMP_FX_GAP_S = 0.25;
/** In OVERDRIVE the pivot wobbles: a rotating lean nobody can balance against for long. */
const WOBBLE_TILT = 0.4;
const WOBBLE_RATE = 1.3;
const BOT_HESITATE_S = 0.3;
const GHOST_THINK_S = 0.45;
const BEST_KEY = "v2-tilt";
const HAZARD_LABEL: Record<Hazard, string> = { none: "", ice: "ICE", spinner: "SPINNER", gust: "GUST" };
const HAZARD_COLOR: Record<Hazard, string> = { none: "#F4F7FB", ice: "#9ad9ff", spinner: "#FF3D7A", gust: "#B8FF3D" };
const TAUNTS = ["BYE!", "TOO SLOW", "WHO'S NEXT?", "TIMBER!", "SEE YA", "MINE NOW"] as const;
const GHOST_TAUNTS = ["TIP IT!", "LEAN ON 'EM", "DOWN YOU GO", "HAUNTING"] as const;

type Phase = "intro" | "round" | "result" | "final";

interface Stick {
  pointerId: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
  /** Game time of the press, to tell a tap from a drag. */
  downAt: number;
  moved: number;
}

interface Ghost {
  angle: number;
  target: number;
  /** Seconds of stomp left. */
  stomp: number;
  cooldown: number;
  think: number;
}

interface Seat {
  player: Player;
  zone: Rect;
  /** Where the pad hint is drawn (a corner of the zone, away from the platform). */
  hint: Vec;
  ball: Ball;
  stick: Stick | null;
  /** Last steering direction, the default slam heading. */
  lastDir: Vec;
  /** Bot steering: current heading and force. */
  botDir: Vec;
  botForce: number;
  botThink: number;
  botHesitate: number;
  ghost: Ghost | null;
  points: number;
  knockouts: number;
  falls: number;
  edgeSaves: number;
  lastHitBy: number;
  lastHitAt: number;
  edgeDanger: boolean;
  underdog: boolean;
  tauntCool: number;
}

class SumoRings implements GameInstance {
  private readonly seats: Seat[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private readonly hazards: Hazard[];
  private readonly cx: number;
  private readonly cy: number;
  private readonly ringStart: number;
  private ringR: number;
  private ringTarget: number;
  private phase: Phase = "intro";
  private timer = INTRO_S;
  private roundIndex = 0;
  private roundT = 0;
  private time = 0;
  private shrinkIn = SHRINK_EVERY_S;
  private overdrive = false;
  private spinAngle = 0;
  private gustT = 0;
  private gustAngle = 0;
  private gustState: "gap" | "warn" | "on" = "gap";
  private tilt: Vec = { x: 0, y: 0 };
  private tiltTarget: Vec = { x: 0, y: 0 };
  /** Round time of the last bump FX per seat pair, so sustained contact doesn't spam hit-stop. */
  private bumpAt = new Map<number, number>();
  private noteAt = -10;
  private noteRow = 0;
  private resultText = "";
  private resultColor = "#F4F7FB";
  private backdrop: HTMLCanvasElement | null = null;
  private finished = false;
  private goShown = false;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    this.cx = ctx.width / 2;
    this.cy = ctx.height / 2;
    this.ringStart = Math.min(ctx.width, ctx.height) * 0.42;
    this.ringR = this.ringStart;
    this.ringTarget = this.ringStart;
    this.hazards = planHazards(ctx.rng);
    const n = ctx.players.length;
    const zones = padZones(n, ctx.width, ctx.height);
    this.seats = ctx.players.map((player, i) => {
      const zone = zones[i]!;
      const left = zone.x + zone.w / 2 < this.cx;
      const top = zone.y + zone.h / 2 < this.cy;
      const hint = { x: left ? zone.x + 150 : zone.x + zone.w - 150, y: top ? zone.y + 150 : zone.y + zone.h - 150 };
      return {
        player, zone, hint, ball: makeBall(0, 0), stick: null, lastDir: { x: 0, y: 0 },
        botDir: { x: 0, y: 0 }, botForce: 0, botThink: ctx.rng.float(0, BOT_THINK_S), botHesitate: 0,
        ghost: null, points: 0, knockouts: 0, falls: 0, edgeSaves: 0, lastHitBy: -1, lastHitAt: -10,
        edgeDanger: false, underdog: false, tauntCool: 0,
      };
    });
    this.startRound();
    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
  }

  private get hazard(): Hazard {
    return this.hazards[this.roundIndex] ?? "none";
  }

  private get isFinal(): boolean {
    return this.roundIndex >= MAX_ROUNDS - 1;
  }

  private startRound(): void {
    this.ringR = this.ringStart;
    this.ringTarget = this.ringStart;
    this.roundT = 0;
    this.shrinkIn = SHRINK_EVERY_S;
    this.overdrive = false;
    this.spinAngle = this.ctx.rng.float(0, Math.PI * 2);
    this.gustState = "gap";
    this.gustT = GUST_GAP_S * 0.6;
    this.tilt = { x: 0, y: 0 };
    this.tiltTarget = { x: 0, y: 0 };
    this.goShown = false;
    this.bumpAt.clear();
    const dogs = this.isFinal ? underdogs(this.seats.map((s) => s.points)) : [];
    const spots = startPositions(this.seats.length, this.cx, this.cy, this.ringStart);
    this.seats.forEach((s, i) => {
      const p = spots[i]!;
      s.underdog = dogs.includes(i);
      s.ball = makeBall(p.x, p.y, s.underdog ? UNDERDOG_R : BALL_R);
      s.stick = null;
      s.ghost = null;
      s.botForce = 0;
      s.botHesitate = 0;
      s.lastHitBy = -1;
      s.lastHitAt = -10;
      s.edgeDanger = false;
      s.lastDir = { x: this.cx - p.x, y: this.cy - p.y };
    });
    this.phase = "intro";
    this.timer = INTRO_S;
    if (this.isFinal) {
      this.callouts.show("FINAL ROUND", "#FFB020", { size: 84, y: 0.28, life: INTRO_S });
      this.callouts.show("DOUBLE POINTS", "#FFB020", { size: 44, y: 0.39, life: INTRO_S });
    } else {
      this.callouts.show(`ROUND ${this.roundIndex + 1}`, "#F4F7FB", { size: 80, y: 0.3, life: INTRO_S });
    }
    if (this.hazard === "none") {
      this.callouts.show("THE RING TIPS WHERE THE WEIGHT IS", "#e9b97c", { size: 34, y: 0.42, life: INTRO_S });
    } else {
      const y = this.isFinal ? 0.48 : 0.42;
      this.callouts.show(`HAZARD: ${HAZARD_LABEL[this.hazard]}`, HAZARD_COLOR[this.hazard], { size: 44, y, life: INTRO_S });
    }
    if (dogs.length > 0) {
      const names = dogs.map((i) => this.seats[i]!.player.name).join(" & ");
      this.callouts.show(`UNDERDOG ${names}: HEAVY BALL`, "#F4F7FB", { size: 30, y: 0.57, life: INTRO_S });
    }
    this.ctx.sfx.countdown();
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += realDt;
    if (this.finished) return;

    // Falling balls animate in every phase; once gone, the player haunts the rim.
    for (const s of this.seats) {
      if (!s.ball.alive && s.ball.fall < 1) {
        s.ball.fall = Math.min(1, s.ball.fall + dt / FALL_S);
        s.ball.vy += 300 * dt;
        integrate(s.ball, dt);
        if (s.ball.fall >= 1 && this.phase === "round" && !s.ghost) this.spawnGhost(s);
      }
      s.tauntCool = Math.max(0, s.tauntCool - realDt);
    }

    if (this.phase === "intro") {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = "round";
        if (!this.goShown) {
          this.goShown = true;
          this.callouts.show("GO!", "#FFB020", { size: 110, y: 0.35, life: 0.7 });
          this.ctx.sfx.go();
        }
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
      return;
    }

    this.stepRound(dt);
  }

  private stepRound(dt: number): void {
    this.roundT += dt;

    // Platform shrink, then OVERDRIVE: a steady squeeze and a heavier tilt.
    if (!this.overdrive && this.roundT >= OVERDRIVE_AT_S) {
      this.overdrive = true;
      this.callouts.show("OVERDRIVE!", "#FF3D7A", { size: 84, y: 0.3, life: 1.2 });
      this.juice.shake(0.5);
      this.ctx.sfx.whoosh();
    }
    if (this.overdrive) {
      this.ringTarget = Math.max(BALL_R * 1.2, this.ringTarget - OVERDRIVE_SHRINK_PX_S * dt);
    } else {
      this.shrinkIn -= dt;
      if (this.shrinkIn <= 0) {
        this.shrinkIn += SHRINK_EVERY_S;
        this.ringTarget *= SHRINK_FACTOR;
        this.callouts.show("SHRINK!", "#FF3D7A", { size: 72, y: 0.3, life: 1.0 });
        this.juice.shake(0.3);
        this.ctx.sfx.countdown();
      }
    }
    const gap = this.ringTarget - this.ringR;
    this.ringR += gap * Math.min(1, dt * 7);

    // Hazard state.
    const hz = this.hazard;
    if (hz === "spinner") this.spinAngle += SPIN_RATE * dt;
    if (hz === "gust") this.stepGust(dt);

    // Bots think, ghosts ride the rim.
    for (const s of this.seats) {
      if (s.ghost) this.ghostTick(s, dt);
      else if (s.player.kind === "bot" && s.ball.alive) this.botTick(s, dt);
    }

    // Tilt from everything pressing on the platform, smoothed so it leans rather than snaps.
    this.tiltTarget = computeTilt(this.weights(), this.cx, this.cy, this.ringR, this.seats.length);
    if (this.overdrive) {
      const w = (this.roundT - OVERDRIVE_AT_S) * WOBBLE_RATE;
      this.tiltTarget = { x: this.tiltTarget.x + Math.cos(w) * WOBBLE_TILT, y: this.tiltTarget.y + Math.sin(w) * WOBBLE_TILT };
    }
    const k = Math.min(1, dt * 5);
    this.tilt = { x: this.tilt.x + (this.tiltTarget.x - this.tilt.x) * k, y: this.tilt.y + (this.tiltTarget.y - this.tilt.y) * k };

    // Physics in fixed substeps.
    const friction = hz === "ice" ? ICE_FRICTION : FRICTION;
    const traction = hz === "ice" ? ICE_TRACTION : 1;
    let remaining = Math.min(dt, 0.05);
    while (remaining > 0) {
      const h = Math.min(PHYS_STEP, remaining);
      remaining -= h;
      this.physicsStep(h, friction, traction);
    }

    // Fall checks and near misses.
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      if (!s.ball.alive) continue;
      if (outside(s.ball, this.cx, this.cy, this.ringR)) {
        this.knockOut(i);
        continue;
      }
      const dist = Math.hypot(s.ball.x - this.cx, s.ball.y - this.cy);
      if (!s.edgeDanger && dist > this.ringR - EDGE_DANGER_PX) {
        s.edgeDanger = true;
      } else if (s.edgeDanger && dist < this.ringR - EDGE_SAFE_PX) {
        s.edgeDanger = false;
        s.edgeSaves += 1;
        this.note(`${s.player.name}: EDGE SAVE!`, s.player.color, 0.9);
        this.juice.burst(s.ball.x, s.ball.y, [s.player.color, "#ffffff"], { count: 8, speed: 160, gravity: 0, life: 0.3, size: 4 });
        this.ctx.sfx.collect();
      }
    }

    const alive = this.seats.filter((s) => s.ball.alive);
    if (alive.length <= 1 || this.roundT > ROUND_CAP_S) this.endRound(alive.length === 1 ? alive[0]! : null);
  }

  private weights(): Weight[] {
    const out: Weight[] = [];
    for (const s of this.seats) {
      if (s.ball.alive) {
        out.push({ x: s.ball.x, y: s.ball.y, w: s.underdog ? 1.2 : 1 });
      } else if (s.ghost) {
        const w = s.ghost.stomp > 0 ? GHOST_STOMP_WEIGHT : GHOST_WEIGHT;
        out.push({ x: this.cx + Math.cos(s.ghost.angle) * this.ringR, y: this.cy + Math.sin(s.ghost.angle) * this.ringR, w });
      }
    }
    return out;
  }

  private physicsStep(h: number, friction: number, traction: number): void {
    const balls = this.seats.map((s) => s.ball);
    const gain = this.overdrive ? OVERDRIVE_TILT_GAIN : 1;
    for (const s of this.seats) {
      if (!s.ball.alive) continue;
      tickSlam(s.ball, h);
      if (s.stick) {
        const st = stick(s.stick.ox, s.stick.oy, s.stick.x, s.stick.y);
        if (st.force > 0.2) s.lastDir = st.dir;
        applySteer(s.ball, st.dir, st.force, h, traction);
      } else if (s.player.kind === "bot") {
        applySteer(s.ball, s.botDir, s.botForce, h, traction);
      }
      applyTilt(s.ball, this.tilt, h, gain);
      if (this.hazard === "gust" && this.gustState === "on") {
        s.ball.vx += Math.cos(this.gustAngle) * WIND_ACCEL * h;
        s.ball.vy += Math.sin(this.gustAngle) * WIND_ACCEL * h;
      }
    }
    for (const b of balls) if (b.alive) integrate(b, h, friction);
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i]!;
        const b = balls[j]!;
        const impulse = collidePair(a, b);
        if (impulse > 0) this.onBump(i, j, impulse);
      }
    }
    if (this.hazard === "spinner") {
      const halfLen = this.ringR * 0.8;
      for (let i = 0; i < balls.length; i++) {
        const b = balls[i]!;
        if (spinnerCollide(b, this.cx, this.cy, this.spinAngle, halfLen)) {
          const s = this.seats[i]!;
          s.lastHitBy = -1;
          this.juice.burst(b.x, b.y, ["#FF3D7A", "#ffffff"], { count: 10, speed: 260, gravity: 0, life: 0.35, size: 5 });
          this.juice.shake(0.12);
          this.ctx.sfx.whoosh();
        }
      }
    }
  }

  private onBump(i: number, j: number, impulse: number): void {
    const a = this.seats[i]!;
    const b = this.seats[j]!;
    a.lastHitBy = j;
    b.lastHitBy = i;
    a.lastHitAt = this.roundT;
    b.lastHitAt = this.roundT;
    // impulse ~ mass * speed; normalise by mass so 1 = a 1px/s nudge.
    const strength = impulse / Math.min(a.ball.mass, b.ball.mass);
    if (strength < 60) return;
    const key = i * 8 + j;
    if (this.roundT - (this.bumpAt.get(key) ?? -10) < BUMP_FX_GAP_S) return;
    this.bumpAt.set(key, this.roundT);
    const mx = (a.ball.x + b.ball.x) / 2;
    const my = (a.ball.y + b.ball.y) / 2;
    const slam = a.ball.slamming > 0 || b.ball.slamming > 0;
    const big = strength > 320 || slam;
    this.juice.burst(mx, my, [a.player.color, b.player.color, "#ffffff"], {
      count: big ? 22 : 8, speed: big ? 360 : 180, gravity: 0, life: 0.4, size: big ? 7 : 4,
    });
    this.juice.shake(big ? 0.4 : 0.12);
    if (slam) this.juice.hitStop(0.07);
    else if (big) this.juice.hitStop(0.04);
    this.ctx.sfx.hit();
  }

  /** Small side notes (taunts, edge saves, ghost spawns) alternate rows so quick successions stay legible. */
  private note(text: string, color: string, life = 1.1): void {
    this.noteRow = this.time - this.noteAt < 1.2 ? (this.noteRow + 1) % 2 : 0;
    this.noteAt = this.time;
    this.callouts.show(text, color, { size: 30, y: 0.12 + this.noteRow * 0.055, life });
  }

  private fireSlam(s: Seat, dir: Vec): void {
    const b = s.ball;
    if (!startSlam(b, dir)) return;
    const back = Math.atan2(-b.vy, -b.vx);
    this.juice.burst(b.x, b.y, [s.player.color, "#ffffff"], { count: 14, speed: 300, gravity: 0, life: 0.35, size: 5, angle: back, spread: 0.9 });
    this.juice.shake(0.15);
    this.ctx.sfx.whoosh();
  }

  private spawnGhost(s: Seat): void {
    const angle = Math.atan2(s.ball.y - this.cy, s.ball.x - this.cx);
    s.ghost = { angle, target: angle, stomp: 0, cooldown: 0.6, think: 0 };
    s.botDir = { x: 0, y: 0 };
    s.botForce = 0;
    if (this.seats.length > 2) {
      const hint = s.player.kind === "human" ? "DRAG TO HAUNT, TAP TO STOMP" : "HAUNTS THE RIM";
      this.note(`${s.player.name}: ${hint}`, s.player.color, 1.4);
    }
    this.ctx.sfx.tick();
  }

  private stomp(s: Seat): void {
    const gh = s.ghost;
    if (!gh || gh.cooldown > 0) return;
    gh.stomp = GHOST_STOMP_S;
    gh.cooldown = GHOST_STOMP_COOLDOWN_S;
    const x = this.cx + Math.cos(gh.angle) * (this.ringR + 30);
    const y = this.cy + Math.sin(gh.angle) * (this.ringR + 30);
    this.juice.burst(x, y, [s.player.color, "#ffffff"], { count: 12, speed: 220, gravity: 0, life: 0.35, size: 5 });
    this.juice.shake(0.25);
    this.ctx.sfx.hit();
    if (s.player.kind === "bot" && s.tauntCool <= 0 && this.ctx.rng.next() < 0.5) {
      s.tauntCool = 4;
      this.note(`${s.player.name}: ${this.ctx.rng.pick(GHOST_TAUNTS)}`, s.player.color);
    }
  }

  private knockOut(i: number): void {
    const s = this.seats[i]!;
    s.ball.alive = false;
    s.ball.fall = 0;
    s.ball.slamming = 0;
    s.falls += 1;
    s.edgeDanger = false;
    // Keep it sliding off the edge.
    const sp = Math.hypot(s.ball.vx, s.ball.vy);
    if (sp < 120) {
      const ax = s.ball.x - this.cx;
      const ay = s.ball.y - this.cy;
      const d = Math.hypot(ax, ay) || 1;
      s.ball.vx = (ax / d) * 160;
      s.ball.vy = (ay / d) * 160;
    }
    const mult = roundMultiplier(this.roundIndex);
    const by = s.lastHitBy >= 0 && this.roundT - s.lastHitAt < 2 ? this.seats[s.lastHitBy] : undefined;
    if (by && by.ball.alive) {
      by.knockouts += 1;
      by.points += BUMP_POINTS * mult;
      this.callouts.show(`${by.player.name} BUMPS ${s.player.name}! +${BUMP_POINTS * mult}`, by.player.color, { size: 52, y: 0.22, life: 1.2 });
      if (by.player.kind === "bot" && by.tauntCool <= 0 && this.ctx.rng.next() < 0.65) {
        by.tauntCool = 3;
        this.note(`${by.player.name}: ${this.ctx.rng.pick(TAUNTS)}`, by.player.color);
      }
    } else {
      this.callouts.show(`${s.player.name} FALLS!`, s.player.color, { size: 52, y: 0.22, life: 1.2 });
    }
    this.juice.burst(s.ball.x, s.ball.y, [s.player.color, "#ffffff"], { count: 22, speed: 300, gravity: 400, size: 6 });
    this.juice.shake(0.45);
    this.juice.hitStop(0.06);
    this.ctx.sfx.miss();
  }

  private endRound(winner: Seat | null): void {
    if (this.phase !== "round") return;
    const mult = roundMultiplier(this.roundIndex);
    if (winner) {
      winner.points += WIN_POINTS * mult;
      this.resultText = `${winner.player.name} HOLDS THE RING +${WIN_POINTS * mult}`;
      this.resultColor = winner.player.color;
      this.juice.slowMo(0.45, 0.4);
      this.ctx.sfx.collect();
    } else {
      this.resultText = "EVERYONE FELL! NO POINT";
      this.resultColor = "#FF3D7A";
    }
    if (matchOver(this.roundIndex + 1)) {
      this.phase = "final";
      this.timer = RESULT_S + FINAL_S;
      const top = Math.max(...this.seats.map((s) => s.points));
      const leaders = this.seats.filter((s) => s.points === top);
      const text = top === 0 ? "NO WINNER" : leaders.map((s) => s.player.name).join(" & ") + " WINS!";
      this.callouts.show(text, leaders.length === 1 && top > 0 ? leaders[0]!.player.color : "#F4F7FB", {
        size: 84, life: RESULT_S + FINAL_S, y: 0.3,
      });
      this.callouts.show(this.resultText, this.resultColor, { size: 40, y: 0.42, life: RESULT_S + FINAL_S });
      let recordY = 0.52;
      for (const s of this.seats) {
        if (s.player.kind !== "human" || s.knockouts <= 0) continue;
        if (saveBest(sumoRings.id, s.knockouts, BEST_KEY)) {
          this.callouts.show(`${s.player.name}: NEW RECORD ${s.knockouts} BUMP-OFFS`, s.player.color, { size: 34, y: recordY, life: RESULT_S + FINAL_S });
          recordY += 0.07;
          this.ctx.sfx.streak(3);
        }
      }
      this.ctx.sfx.win();
    } else {
      this.phase = "result";
      this.timer = RESULT_S;
      this.callouts.show(this.resultText, this.resultColor, { size: 60, y: 0.36, life: RESULT_S });
    }
  }

  private stepGust(dt: number): void {
    this.gustT -= dt;
    if (this.gustT > 0) return;
    if (this.gustState === "gap") {
      this.gustState = "warn";
      this.gustT = GUST_WARN_S;
      this.gustAngle = this.ctx.rng.float(0, Math.PI * 2);
      this.ctx.sfx.tick();
    } else if (this.gustState === "warn") {
      this.gustState = "on";
      this.gustT = GUST_ON_S;
      this.callouts.show("GUST!", "#B8FF3D", { size: 64, y: 0.3, life: 0.9 });
      this.juice.shake(0.2);
      this.ctx.sfx.whoosh();
    } else {
      this.gustState = "gap";
      this.gustT = GUST_GAP_S + this.ctx.rng.float(-0.5, 0.8);
    }
  }

  private botTick(s: Seat, dt: number): void {
    if (s.botHesitate > 0) {
      s.botHesitate -= dt;
      s.botForce = 0;
      return;
    }
    s.botThink -= dt;
    if (s.botThink > 0) return;
    s.botThink = BOT_THINK_S + this.ctx.rng.float(-0.05, 0.08);
    const rng = this.ctx.rng;
    if (rng.next() < 0.07) {
      s.botHesitate = BOT_HESITATE_S;
      s.botForce = 0;
      return;
    }
    const others = this.seats.map((o) => o.ball);
    s.botDir = botSteer(s.ball, others, this.cx, this.cy, this.ringR, rng, 0.7, this.tilt);
    // Lean into the wind a little while it blows.
    if (this.hazard === "gust" && this.gustState !== "gap") {
      s.botDir = {
        x: s.botDir.x - Math.cos(this.gustAngle) * 0.8,
        y: s.botDir.y - Math.sin(this.gustAngle) * 0.8,
      };
      const d = Math.hypot(s.botDir.x, s.botDir.y) || 1;
      s.botDir = { x: s.botDir.x / d, y: s.botDir.y / d };
    }
    s.botForce = rng.float(0.6, 1);
    s.lastDir = s.botDir;
    // Slam when a target lines up; now and then recklessly, near the edge.
    if (this.roundT > 1.2 && rng.next() < 0.25) {
      const aim = botSlamAim(s.ball, others, s.botDir, this.cx, this.cy, this.ringR, rng.next() < 0.08);
      if (aim) {
        const wobble = (rng.next() - 0.5) * 0.5;
        const c = Math.cos(wobble);
        const sn = Math.sin(wobble);
        this.fireSlam(s, { x: aim.x * c - aim.y * sn, y: aim.x * sn + aim.y * c });
      }
    }
  }

  private ghostTick(s: Seat, dt: number): void {
    const gh = s.ghost!;
    gh.stomp = Math.max(0, gh.stomp - dt);
    gh.cooldown = Math.max(0, gh.cooldown - dt);
    if (s.stick) {
      const st = stick(s.stick.ox, s.stick.oy, s.stick.x, s.stick.y);
      if (st.force > 0.15) gh.target = Math.atan2(st.dir.y, st.dir.x);
    } else if (s.player.kind === "bot") {
      gh.think -= dt;
      if (gh.think <= 0) {
        gh.think = GHOST_THINK_S + this.ctx.rng.float(-0.1, 0.3);
        const t = ghostTarget(this.seats.map((o) => o.ball), this.seats.map((o) => o.points), this.cx, this.cy);
        if (t !== null) gh.target = t + this.ctx.rng.float(-0.3, 0.3);
        // Stomp when sitting under the target and it is already near the edge.
        const under = Math.abs(((gh.angle - gh.target + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.5;
        const leader = this.seats.find((o) => o.ball.alive && Math.hypot(o.ball.x - this.cx, o.ball.y - this.cy) > this.ringR * 0.5);
        if (under && leader && gh.cooldown <= 0 && this.ctx.rng.next() < 0.6) this.stomp(s);
      }
      s.botDir = { x: Math.cos(gh.target), y: Math.sin(gh.target) };
      s.botForce = 0.8;
    }
    gh.angle = turnToward(gh.angle, gh.target, GHOST_TURN_RATE, dt);
  }

  // Input -------------------------------------------------------------------

  private toLogical(e: PointerEvent): Vec {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private slamDir(s: Seat): Vec {
    const b = s.ball;
    if (Math.hypot(s.lastDir.x, s.lastDir.y) > 0.1) return s.lastDir;
    if (Math.hypot(b.vx, b.vy) > 40) return { x: b.vx, y: b.vy };
    return { x: this.cx - b.x, y: this.cy - b.y };
  }

  /** A tap: slam (live) or stomp (ghost). */
  private tapAction(s: Seat): void {
    if (this.phase !== "round") return;
    if (s.ghost) this.stomp(s);
    else if (s.ball.alive) this.fireSlam(s, this.slamDir(s));
  }

  private readonly onDown = (e: PointerEvent): void => {
    const p = this.toLogical(e);
    for (const s of this.seats) {
      if (s.player.kind !== "human" || !inRect(p, s.zone)) continue;
      e.preventDefault();
      if (s.stick) {
        // A second finger while steering: slam in the steering direction.
        this.tapAction(s);
        return;
      }
      s.stick = { pointerId: e.pointerId, ox: p.x, oy: p.y, x: p.x, y: p.y, downAt: this.time, moved: 0 };
      try { this.ctx.canvas.setPointerCapture(e.pointerId); } catch { /* optional */ }
      return;
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    const s = this.seats.find((seat) => seat.stick?.pointerId === e.pointerId);
    if (!s || !s.stick) return;
    e.preventDefault();
    const p = this.toLogical(e);
    s.stick.x = p.x;
    s.stick.y = p.y;
    s.stick.moved = Math.max(s.stick.moved, Math.hypot(p.x - s.stick.ox, p.y - s.stick.oy));
  };

  private readonly onUp = (e: PointerEvent): void => {
    const s = this.seats.find((seat) => seat.stick?.pointerId === e.pointerId);
    if (!s || !s.stick) return;
    const tap = isTap(this.time - s.stick.downAt, s.stick.moved);
    s.stick = null;
    if (tap) this.tapAction(s);
  };

  // Render ------------------------------------------------------------------

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    this.drawBackdrop(g, width, height);
    this.drawPads(g);
    this.juice.begin(g);
    this.drawPlatform(g);
    if (this.hazard === "gust" && this.gustState !== "gap") this.drawGust(g);
    this.drawGhosts(g);
    this.drawBalls(g);
    this.juice.end(g);
    this.drawSticks(g);
    this.drawHud(g);
    this.callouts.draw(g, width, height);
  }

  /** The arena gradient and seat tints never change, so paint them once and blit. */
  private drawBackdrop(g: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.backdrop) {
      try {
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        const bg = c.getContext("2d");
        if (bg) {
          fillArena(bg, width, height);
          this.backdrop = c;
        }
      } catch {
        /* no DOM: draw directly */
      }
    }
    if (this.backdrop) g.drawImage(this.backdrop, 0, 0);
    else fillArena(g, width, height);
  }

  private drawPads(g: CanvasRenderingContext2D): void {
    for (const s of this.seats) {
      const z = s.zone;
      const active = s.ball.alive || !!s.ghost;
      g.save();
      g.globalAlpha = active ? 0.07 : 0.03;
      g.fillStyle = s.player.color;
      g.fillRect(z.x, z.y, z.w, z.h);
      g.globalAlpha = active ? 0.6 : 0.25;
      // Pad hint ring.
      g.strokeStyle = s.player.color;
      g.lineWidth = 3;
      g.setLineDash([10, 8]);
      g.beginPath();
      g.arc(s.hint.x, s.hint.y, STICK_MAX, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
      g.restore();
    }
  }

  private drawPlatform(g: CanvasRenderingContext2D): void {
    const { cx, cy, ringR, tilt } = this;
    const hz = this.hazard;
    const tm = Math.hypot(tilt.x, tilt.y);
    g.save();
    // Drop shadow into the void, shifted downhill as the deck leans.
    g.fillStyle = "rgba(0,0,0,0.45)";
    g.beginPath();
    g.ellipse(cx + tilt.x * 34, cy + 26 + tilt.y * 34, ringR * 1.04, ringR * 0.98, 0, 0, Math.PI * 2);
    g.fill();
    // Pivot post.
    g.fillStyle = "#1a1322";
    g.beginPath();
    g.ellipse(cx, cy + 30, 40, 16, 0, 0, Math.PI * 2);
    g.fill();
    // Rim.
    g.fillStyle = hz === "ice" ? "#5f86a8" : "#5a3a24";
    g.beginPath();
    g.arc(cx, cy, ringR + 14, 0, Math.PI * 2);
    g.fill();
    // Deck.
    const grad = g.createRadialGradient(cx - ringR * 0.3, cy - ringR * 0.3, ringR * 0.1, cx, cy, ringR);
    if (hz === "ice") {
      grad.addColorStop(0, "#e8f7ff");
      grad.addColorStop(1, "#8fc8ee");
    } else {
      grad.addColorStop(0, "#e9b97c");
      grad.addColorStop(1, "#b9793f");
    }
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, ringR, 0, Math.PI * 2);
    g.fill();
    // Concentric rings.
    g.strokeStyle = hz === "ice" ? "rgba(40,90,140,0.25)" : "rgba(60,30,10,0.28)";
    g.lineWidth = 3;
    for (const k of [0.33, 0.66]) {
      g.beginPath();
      g.arc(cx, cy, ringR * k, 0, Math.PI * 2);
      g.stroke();
    }
    g.lineWidth = 6;
    g.beginPath();
    g.arc(cx, cy, ringR - 4, 0, Math.PI * 2);
    g.stroke();
    if (hz === "ice") {
      // Sparkles.
      g.fillStyle = "rgba(255,255,255,0.8)";
      for (let i = 0; i < 14; i++) {
        const a = i * 2.4 + this.time * 0.1;
        const d = ringR * (0.2 + ((i * 37) % 70) / 100);
        const tw = 0.5 + 0.5 * Math.sin(this.time * 3 + i);
        g.globalAlpha = tw * 0.8;
        g.fillRect(cx + Math.cos(a) * d - 2, cy + Math.sin(a) * d - 2, 4, 4);
      }
      g.globalAlpha = 1;
    }
    // Tilt shading: the downhill side darkens, the uphill side catches light.
    if (tm > 0.02) {
      const ux = tilt.x / tm;
      const uy = tilt.y / tm;
      const lean = g.createLinearGradient(cx - ux * ringR, cy - uy * ringR, cx + ux * ringR, cy + uy * ringR);
      lean.addColorStop(0, `rgba(255,255,255,${0.22 * tm})`);
      lean.addColorStop(0.5, "rgba(0,0,0,0)");
      lean.addColorStop(1, `rgba(20,0,30,${0.55 * tm})`);
      g.fillStyle = lean;
      g.beginPath();
      g.arc(cx, cy, ringR, 0, Math.PI * 2);
      g.fill();
      // Chevrons sliding downhill.
      g.strokeStyle = `rgba(255,255,255,${0.15 + 0.45 * tm})`;
      g.lineWidth = 4;
      g.lineCap = "round";
      const px = -uy;
      const py = ux;
      const flow = (this.time * 90) % 60;
      for (let k = -2; k <= 2; k++) {
        for (let m = -2; m <= 2; m++) {
          const bx = cx + ux * (m * 60 + flow - 30) + px * k * 70;
          const by = cy + uy * (m * 60 + flow - 30) + py * k * 70;
          if (Math.hypot(bx - cx, by - cy) > ringR - 30) continue;
          g.beginPath();
          g.moveTo(bx - ux * 10 - px * 12, by - uy * 10 - py * 12);
          g.lineTo(bx + ux * 6, by + uy * 6);
          g.lineTo(bx - ux * 10 + px * 12, by - uy * 10 + py * 12);
          g.stroke();
        }
      }
    }
    // Spirit level at the pivot: the bubble drifts uphill.
    g.fillStyle = "rgba(7,11,20,0.55)";
    g.beginPath();
    g.arc(cx, cy, 26, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(244,247,251,0.5)";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, 26, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = tm > 0.5 ? "#FF3D7A" : tm > 0.25 ? "#FFB020" : "#B8FF3D";
    g.beginPath();
    g.arc(cx - tilt.x * 17, cy - tilt.y * 17, 8, 0, Math.PI * 2);
    g.fill();
    // Shrink warning pulse on the edge; constant in OVERDRIVE.
    if (this.phase === "round" && (this.overdrive || this.shrinkIn < 1.5)) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * (this.overdrive ? 10 : 18));
      g.strokeStyle = `rgba(255,61,122,${0.3 + pulse * 0.6})`;
      g.lineWidth = 8;
      g.beginPath();
      g.arc(cx, cy, ringR + 6, 0, Math.PI * 2);
      g.stroke();
    }
    if (hz === "spinner") this.drawSpinner(g);
    g.restore();
  }

  private drawSpinner(g: CanvasRenderingContext2D): void {
    const halfLen = this.ringR * 0.8;
    g.save();
    g.translate(this.cx, this.cy);
    g.rotate(this.spinAngle);
    g.fillStyle = "#2a1d3a";
    g.fillRect(-halfLen, -BAR_HALF_W, halfLen * 2, BAR_HALF_W * 2);
    g.fillStyle = "#FF3D7A";
    const stripe = 28;
    for (let x = -halfLen; x < halfLen; x += stripe * 2) {
      g.fillRect(x, -BAR_HALF_W + 3, Math.min(stripe, halfLen - x), BAR_HALF_W * 2 - 6);
    }
    g.fillStyle = "#F4F7FB";
    g.beginPath();
    g.arc(0, 0, 20, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  private drawGust(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    const on = this.gustState === "on";
    const alpha = on ? 0.55 : 0.25 + 0.2 * Math.sin(this.time * 20);
    const ux = Math.cos(this.gustAngle);
    const uy = Math.sin(this.gustAngle);
    g.save();
    g.globalAlpha = alpha;
    g.strokeStyle = "#B8FF3D";
    g.fillStyle = "#B8FF3D";
    g.lineWidth = 5;
    g.lineCap = "round";
    const spacing = 150;
    const speed = on ? 420 : 120;
    const off = (this.time * speed) % spacing;
    const diag = Math.hypot(width, height);
    const px = -uy;
    const py = ux;
    for (let a = -diag / 2; a <= diag / 2; a += spacing) {
      for (let b = -diag / 2 - spacing + off; b <= diag / 2; b += spacing) {
        const x = this.cx + ux * b + px * a;
        const y = this.cy + uy * b + py * a;
        g.beginPath();
        g.moveTo(x - ux * 30, y - uy * 30);
        g.lineTo(x + ux * 30, y + uy * 30);
        g.stroke();
        g.beginPath();
        g.moveTo(x + ux * 30, y + uy * 30);
        g.lineTo(x + ux * 12 + px * 14, y + uy * 12 + py * 14);
        g.lineTo(x + ux * 12 - px * 14, y + uy * 12 - py * 14);
        g.closePath();
        g.fill();
      }
    }
    g.restore();
  }

  private drawGhosts(g: CanvasRenderingContext2D): void {
    const placed: number[] = [];
    for (const s of this.seats) {
      const gh = s.ghost;
      if (!gh) continue;
      const stomping = gh.stomp > 0;
      const a = gh.angle;
      // Ghosts crowding the same spot stack outward so each stays visible.
      const stacked = placed.filter((p) => Math.abs(angleDelta(p, a)) < 0.35).length;
      placed.push(a);
      const r = this.ringR + 34 + stacked * 56;
      const x = this.cx + Math.cos(a) * r;
      const y = this.cy + Math.sin(a) * r;
      g.save();
      // Where they press on the rim.
      g.strokeStyle = s.player.color;
      g.lineWidth = stomping ? 14 : 8;
      g.globalAlpha = stomping ? 0.95 : 0.6;
      g.beginPath();
      g.arc(this.cx, this.cy, this.ringR + 8, a - 0.3, a + 0.3);
      g.stroke();
      // The ghost itself: a faded, squashed orb hanging on the edge.
      const squash = stomping ? 1 - 0.3 * Math.sin((gh.stomp / GHOST_STOMP_S) * Math.PI) : 1;
      g.globalAlpha = 0.55;
      g.translate(x, y);
      g.rotate(a);
      g.scale(squash, 1 / squash);
      g.rotate(-a);
      g.setLineDash([6, 6]);
      g.strokeStyle = s.player.color;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(0, 0, BALL_R * 0.8 + 6, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      // A plain orb (no glow): ghosts are cheap to draw and read as "not really here".
      const gr = BALL_R * 0.8;
      g.fillStyle = gh.cooldown > 0 && !stomping ? "#6b7280" : s.player.color;
      g.beginPath();
      g.arc(0, 0, gr, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.22)";
      g.beginPath();
      g.arc(-gr * 0.22, -gr * 0.28, gr * 0.55, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#070b14";
      g.font = `700 ${Math.max(12, gr)}px Outfit, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(s.player.name[0] ?? "?", 0, 1);
      g.restore();
      // Stomp shock ring.
      if (stomping) {
        const t = 1 - gh.stomp / GHOST_STOMP_S;
        g.save();
        g.globalAlpha = 1 - t;
        g.strokeStyle = s.player.color;
        g.lineWidth = 5;
        g.beginPath();
        g.arc(x, y, 20 + t * 70, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      }
    }
  }

  private drawBalls(g: CanvasRenderingContext2D): void {
    for (const s of this.seats) {
      const b = s.ball;
      if (!b.alive && b.fall >= 1) continue;
      const scale = b.alive ? 1 : 1 - b.fall * 0.85;
      const sp = Math.hypot(b.vx, b.vy);
      g.save();
      g.globalAlpha = b.alive ? 1 : 1 - b.fall;
      // Ground shadow.
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.beginPath();
      g.ellipse(b.x + 6, b.y + 10, b.r * scale, b.r * 0.8 * scale, 0, 0, Math.PI * 2);
      g.fill();
      // Motion streak, with afterimages while slamming.
      if (b.alive && sp > 200) {
        const nx = b.vx / sp;
        const ny = b.vy / sp;
        if (b.slamming > 0) {
          for (let k = 1; k <= 3; k++) {
            g.globalAlpha = 0.28 - k * 0.07;
            g.fillStyle = s.player.color;
            g.beginPath();
            g.arc(b.x - nx * k * 26, b.y - ny * k * 26, b.r * (1 - k * 0.12), 0, Math.PI * 2);
            g.fill();
          }
          g.globalAlpha = 1;
        }
        g.strokeStyle = s.player.color;
        g.globalAlpha = Math.min(0.5, (sp - 200) / 600);
        g.lineWidth = 6;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(b.x, b.y);
        g.lineTo(b.x - nx * Math.min(110, sp * 0.15), b.y - ny * Math.min(110, sp * 0.15));
        g.stroke();
        g.globalAlpha = 1;
      }
      // Squash and stretch along the velocity.
      const stretch = b.alive ? Math.min(0.28, sp / 3000) : 0;
      g.translate(b.x, b.y);
      if (stretch > 0.01) {
        const ang = Math.atan2(b.vy, b.vx);
        g.rotate(ang);
        g.scale(1 + stretch, 1 - stretch * 0.7);
        g.rotate(-ang);
      }
      drawPlayerOrb(g, 0, 0, b.r * scale, s.player);
      // Slam charge ring: fills up, then glows when ready.
      if (b.alive) {
        const ready = b.slam >= 1;
        g.lineWidth = ready ? 4 : 3;
        g.strokeStyle = ready ? "#ffffff" : "rgba(255,255,255,0.45)";
        g.globalAlpha = ready ? 0.7 + 0.3 * Math.sin(this.time * 9) : 0.8;
        g.beginPath();
        g.arc(0, 0, b.r + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * b.slam);
        g.stroke();
        if (s.underdog) {
          g.globalAlpha = 0.9;
          g.fillStyle = "#070b14";
          g.font = `700 14px ${FONT}`;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.fillText("HEAVY", 0, b.r * 0.55);
        }
      }
      g.restore();
    }
  }

  private drawSticks(g: CanvasRenderingContext2D): void {
    for (const s of this.seats) {
      let ox: number;
      let oy: number;
      let dir: Vec;
      let force: number;
      const active = s.ball.alive || !!s.ghost;
      if (s.stick) {
        const st = stick(s.stick.ox, s.stick.oy, s.stick.x, s.stick.y);
        ox = s.stick.ox;
        oy = s.stick.oy;
        dir = st.dir;
        force = st.force;
      } else if (s.player.kind === "bot" && this.phase === "round" && active) {
        ox = s.hint.x;
        oy = s.hint.y;
        dir = s.botDir;
        force = s.botForce;
      } else {
        continue;
      }
      g.save();
      g.globalAlpha = s.ghost ? 0.55 : 0.85;
      g.strokeStyle = s.player.color;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(ox, oy, STICK_MAX, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = s.player.color;
      g.beginPath();
      g.arc(ox + dir.x * force * STICK_MAX, oy + dir.y * force * STICK_MAX, 32, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }

  private drawHud(g: CanvasRenderingContext2D): void {
    g.save();
    g.textBaseline = "middle";
    for (const s of this.seats) {
      const z = s.zone;
      const left = z.x + z.w / 2 < this.cx;
      const top = z.y + z.h / 2 < this.cy;
      const x = left ? z.x + 24 : z.x + z.w - 24;
      const y = top ? z.y + 36 : z.y + z.h - 36;
      const active = s.ball.alive || !!s.ghost;
      g.textAlign = left ? "left" : "right";
      g.font = `700 34px ${FONT}`;
      g.fillStyle = active ? s.player.color : "rgba(244,247,251,0.35)";
      g.fillText(s.player.kind === "bot" ? `${s.player.name} (BOT)` : s.player.name, x, y);
      // Points and status.
      const subY = top ? y + 34 : y - 34;
      g.font = `700 26px ${FONT}`;
      g.fillStyle = "rgba(244,247,251,0.85)";
      const status = s.ghost ? "GHOST" : s.ball.alive ? (s.ball.slam >= 1 ? "SLAM READY" : "") : "OUT";
      g.fillText(`${s.points} PTS${status ? "  ·  " + status : ""}`, x, subY);
      if (s.player.kind === "human" && this.phase === "round" && active && !s.stick) {
        g.textAlign = "center";
        g.font = `700 22px ${FONT}`;
        g.fillStyle = "rgba(244,247,251,0.5)";
        g.fillText(s.ghost ? "DRAG: HAUNT" : "DRAG: STEER", s.hint.x, s.hint.y - 12);
        g.fillText(s.ghost ? "TAP: STOMP" : "TAP: SLAM", s.hint.x, s.hint.y + 14);
      }
    }
    // Round, hazard and shrink countdown at the top centre.
    g.textAlign = "center";
    g.font = `700 28px ${FONT}`;
    if (this.phase === "round") {
      const label = this.isFinal ? "FINAL ROUND · x2" : `ROUND ${this.roundIndex + 1}/${MAX_ROUNDS}`;
      g.fillStyle = this.isFinal ? "#FFB020" : "rgba(244,247,251,0.85)";
      g.fillText(label, this.cx, 26);
      g.font = `700 22px ${FONT}`;
      const hzTag = this.hazard === "none" ? "" : `${HAZARD_LABEL[this.hazard]}  ·  `;
      if (this.overdrive) {
        g.fillStyle = "#FF3D7A";
        g.fillText(`${hzTag}OVERDRIVE`, this.cx, 54);
      } else {
        g.fillStyle = this.shrinkIn < 3 ? "#FF3D7A" : "rgba(244,247,251,0.6)";
        g.fillText(`${hzTag}SHRINK IN ${Math.ceil(this.shrinkIn)}`, this.cx, 54);
      }
    }
    g.restore();
  }

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({ playerId: s.player.id, score: s.points }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    for (const s of this.seats) {
      out.push({ playerId: s.player.id, label: "Bump-offs", value: String(s.knockouts) });
      out.push({ playerId: s.player.id, label: "Edge saves", value: String(s.edgeSaves) });
      out.push({ playerId: s.player.id, label: "Falls", value: String(s.falls) });
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

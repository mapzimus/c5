import { drawTimerBar, fillArena } from "../../core/draw";
import { Callouts, Juice, loadBest, saveBest } from "../../fx/juice";
import type {
  GameContext,
  GameDefinition,
  GameInstance,
  GameStat,
  Player,
} from "../../core/types";
import {
  AIR_TIME,
  angleDelta,
  ASSIST_POINTS,
  botBailThreshold,
  botLead,
  botShouldWhip,
  botWantsBail,
  clampOmega,
  clearPoints,
  crossedBottom,
  effectiveOmega,
  hasSafetyNet,
  isClear,
  isCloseCall,
  isOverdrive,
  isStreakMilestone,
  jumpHeight,
  knockVelocity,
  MAX_OMEGA,
  MIN_OMEGA,
  nextBotSegment,
  omegaFloor,
  OVERDRIVE_SECONDS,
  ROUND_SECONDS,
  spinnerOrder,
  SURVIVE_BONUS,
  surviveReward,
  sweepOutcome,
  TAU,
  timeToBottom,
  BOT_PERCEPTION_LAG,
  WHIP_COOLDOWN,
  WHIP_TOTAL,
  whipPhase,
} from "./logic";

export const ropeSkip: GameDefinition = {
  id: "rope-skip",
  name: "Rope Riot",
  tagline: "Jump, bank, or get swept.",
  description:
    "One player turns a giant rope, everyone else skips it. Every clear adds +1 to your POT; " +
    "tap BANK to cash it in and sit out safe, or keep skipping: survive the round for pot +5. " +
    "Get swept and the spinner steals your whole pot (+2). Swept and banked players turn into " +
    "ghosts who WHIP the rope faster and earn +2 per knockout they help. The last 5s are OVERDRIVE: " +
    "double points, faster rope. Everyone spins once.",
  durationMs: 0,
  controls: "Jumpers: tap to jump, tap BANK to cash out. Ghosts: tap to whip. Spinner: drag circles on the ring",
  create: (ctx) => new RopeSkip(ctx),
};

const INTRO_SECONDS = 2;
const OUTRO_SECONDS = 1.7;
const WIPE_GRACE = 0.8;
const GROUND_Y = 540;
const ROPE_R = 190;
const AXIS_Y = GROUND_Y - ROPE_R;
const POLE_L = 150;
const POLE_R = 920;
const JUMP_PEAK = 120;
const STRIP_Y = 600;
const GHOST_Y = 150;
/** Floating labels over a skipping jumper start here (clear of the pot bubble). */
const POP_Y = GROUND_Y - 165;
const RING = { x: 1110, y: 330, r: 120 };
const CPU_COLOR = "#9AA4B8";
const BEST_KEY = "v2-pot";
const TAUNTS = ["GOTCHA!", "TOO SLOW!", "SWEPT!", "MINE NOW!", "BYE BYE!"];
const GHOST_TAUNTS = ["WHIP IT!", "FASTER!", "HEH HEH", "JOIN US!"];

interface Seat {
  player: Player;
  score: number;
  knockouts: number;
  survived: number;
  bestPot: number;
  bestStreak: number;
  assists: number;
}

type JumperStatus = "in" | "out" | "banked";

interface Jumper {
  seat: number;
  x: number;
  jumpT: number | null;
  status: JumperStatus;
  pot: number;
  streak: number;
  lead: number;
  jumpedThisTurn: boolean;
  jumps: number;
  /** Comeback edge: first sweep this round stumbles instead of knocking out. */
  net: boolean;
  /** Bot nerve: pot size where it starts wanting to bank. */
  bailAt: number;
  /** BANK was requested mid-air: cash out on landing. */
  bankPending: boolean;
  /** Ghost whip state. */
  whipCd: number;
  whipT: number;
  /** Ragdoll state right after a knockout, before haunting. */
  rag: { x: number; y: number; vx: number; vy: number; rot: number; spin: number; bounces: number; resting: boolean; t: number } | null;
  /** Ghost position once haunting (after a knockout tumble or a bank hop). */
  ghost: { x: number; y: number; t: number } | null;
  /** Squash (<1) / stretch (>1) on the body, eases back to 1. */
  squash: number;
}

interface Pop {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  size: number;
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
  private appliedOmega = MIN_OMEGA;
  /** What bot jumpers believe the rope speed is (lags behind reality). */
  private botOmega = MIN_OMEGA;
  private botSeg = { omega: MIN_OMEGA, left: 0 };
  private drag: { id: number; angle: number; time: number } | null = null;
  private lastCount = 0;
  private clock = 0;
  private overdrive = false;
  private wipeT = 0;
  private whipFlash = 0;
  private pops: Pop[] = [];
  private bestPot: number;
  private readonly anyHuman: boolean;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    this.seats = ctx.players.map((player) => ({
      player, score: 0, knockouts: 0, survived: 0, bestPot: 0, bestStreak: 0, assists: 0,
    }));
    this.order = spinnerOrder(ctx.players.length);
    this.anyHuman = ctx.players.some((p) => p.kind === "human");
    this.bestPot = this.anyHuman ? loadBest(ropeSkip.id, BEST_KEY) : 0;
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

  private get timeLeft(): number {
    return this.phase === "play" ? Math.max(0, ROUND_SECONDS - this.phaseT) : ROUND_SECONDS;
  }

  private rand = (): number => this.ctx.rng.next();

  private startRound(): void {
    const ids = this.seats.map((_, i) => i).filter((i) => i !== this.spinner);
    const span = POLE_R - POLE_L;
    const scores = this.seats.map((s) => s.score);
    this.jumpers = ids.map((seat, k) => ({
      seat,
      x: POLE_L + (span * (k + 1)) / (ids.length + 1),
      jumpT: null,
      status: "in",
      pot: 0,
      streak: 0,
      lead: botLead(this.rand),
      jumpedThisTurn: false,
      jumps: 0,
      net: hasSafetyNet(scores, seat, this.round),
      bailAt: botBailThreshold(this.rand),
      bankPending: false,
      whipCd: 0,
      whipT: 0,
      rag: null,
      ghost: null,
      squash: 1,
    }));
    this.phi = 0;
    this.omega = 3.5;
    this.targetOmega = 3.5;
    this.appliedOmega = 3.5;
    this.botOmega = 3.5;
    this.botSeg = { omega: 3.5, left: 1 };
    this.drag = null;
    this.phase = "intro";
    this.phaseT = 0;
    this.lastCount = 0;
    this.overdrive = false;
    this.wipeT = 0;
    this.pops = [];
    const name = this.spinner < 0 ? "CPU" : this.seats[this.spinner]!.player.name;
    const color = this.spinner < 0 ? CPU_COLOR : this.seats[this.spinner]!.player.color;
    this.callouts.show(`${name} SPINS`, color, { size: 60, life: INTRO_SECONDS });
    for (const j of this.jumpers) {
      if (j.net) this.pop(j.x, POP_Y, "SAFETY NET", "#3EE0FF", 2, 22);
    }
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.phaseT += realDt;
    this.clock += realDt;
    this.whipFlash = Math.max(0, this.whipFlash - realDt);
    for (const p of this.pops) {
      p.life -= realDt;
      p.y -= 26 * realDt;
    }
    this.pops = this.pops.filter((p) => p.life > 0);

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
      if (!this.overdrive && isOverdrive(this.timeLeft)) this.startOverdrive();
      this.stepSpin(dt);
      const prev = this.phi;
      this.phi += this.appliedOmega * dt;
      this.stepJumpers(dt);
      this.botJumpers();
      this.botGhosts();
      if (crossedBottom(prev, this.phi)) this.sweep();
      if (this.phase !== "play") return;
      if (!this.jumpers.some((j) => j.status === "in")) {
        this.wipeT += dt;
        if (this.wipeT >= WIPE_GRACE) this.endRound();
      }
      if (this.phase === "play" && this.phaseT >= ROUND_SECONDS) this.endRound();
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

  private startOverdrive(): void {
    this.overdrive = true;
    this.callouts.show("OVERDRIVE! x2", "#FF6A3D", { size: 58, life: 1.1 });
    this.juice.shake(0.25);
    this.ctx.sfx.go();
  }

  private stepSpin(dt: number): void {
    if (this.spinnerIsBot) {
      this.botSeg.left -= dt;
      if (this.botSeg.left <= 0) {
        const biggest = Math.max(0, ...this.jumpers.filter((j) => j.status === "in").map((j) => j.pot));
        const seg = nextBotSegment(this.rand, Math.min(1, biggest / 10));
        this.botSeg = { omega: seg.omega, left: seg.duration };
      }
      this.targetOmega = this.botSeg.omega;
    } else if (this.drag && this.clock - this.drag.time > 0.15) {
      // Finger held still: rope drops toward its slowest speed.
      this.targetOmega = MIN_OMEGA;
    }
    const k = 1 - Math.exp(-dt * 10);
    this.omega = clampOmega(this.omega + (this.targetOmega - this.omega) * k);
    let grabs = 0;
    let snaps = 0;
    for (const j of this.jumpers) {
      j.whipCd = Math.max(0, j.whipCd - dt);
      if (j.whipT <= 0) continue;
      const before = whipPhase(j.whipT);
      j.whipT -= dt;
      const phase = whipPhase(j.whipT);
      if (before === "grab" && phase === "snap") this.snap(j);
      if (phase === "grab") grabs++;
      else if (phase === "snap") snaps++;
    }
    this.appliedOmega = effectiveOmega(this.omega, this.overdrive, grabs, snaps);
    this.botOmega += (this.appliedOmega - this.botOmega) * Math.min(1, dt / BOT_PERCEPTION_LAG);
  }

  /** The grab ends: the rope snaps round with a flash. */
  private snap(j: Jumper): void {
    this.whipFlash = 0.3;
    this.juice.shake(0.15);
    this.ctx.sfx.whoosh();
    if (j.ghost) this.pop(j.ghost.x, j.ghost.y - 40, "SNAP!", "#ffffff", 0.6, 24);
  }

  private stepJumpers(dt: number): void {
    for (const j of this.jumpers) {
      j.squash += (1 - j.squash) * Math.min(1, dt * 14);
      if (j.ghost) {
        j.ghost.t += dt;
        const ease = Math.min(1, dt * 3);
        j.ghost.x += (j.x - j.ghost.x) * ease;
        j.ghost.y += (GHOST_Y + Math.sin(j.ghost.t * 2.2 + j.seat) * 8 - j.ghost.y) * ease;
        continue;
      }
      if (j.status === "out") {
        this.stepRag(j, dt);
        const r = j.rag;
        if (r && (r.resting || r.t > 1.4)) j.ghost = { x: r.x, y: r.y, t: 0 };
        continue;
      }
      if (j.jumpT !== null) {
        j.jumpT += dt;
        if (j.jumpT >= AIR_TIME) {
          j.jumpT = null;
          j.squash = 0.62;
          this.juice.burst(j.x, GROUND_Y, "rgba(244,247,251,0.45)", {
            count: 6, speed: 110, gravity: 200, size: 4, life: 0.35, angle: -Math.PI / 2, spread: 2.4,
          });
          if (j.bankPending) this.bank(j);
        }
      }
    }
  }

  private stepRag(j: Jumper, dt: number): void {
    const r = j.rag;
    if (!r || r.resting) return;
    r.t += dt;
    r.vy += 1600 * dt;
    r.x += r.vx * dt;
    r.y += r.vy * dt;
    r.rot += r.spin * dt;
    const floor = GROUND_Y - 26;
    if (r.y >= floor && r.vy > 0) {
      r.y = floor;
      r.bounces++;
      r.vy = -r.vy * 0.45;
      r.vx *= 0.65;
      r.spin *= 0.6;
      j.squash = 0.7;
      if (r.bounces <= 2) {
        this.juice.burst(r.x, GROUND_Y, "rgba(244,247,251,0.4)", { count: 5, speed: 90, gravity: 200, size: 4, life: 0.3, angle: -Math.PI / 2, spread: 2.4 });
        this.ctx.sfx.tick();
      }
      if (Math.abs(r.vy) < 90) {
        r.vy = 0;
        r.vx = 0;
        r.spin = 0;
        r.resting = true;
      }
    }
    const edge = this.ctx.width - 30;
    if (r.x > edge) {
      r.x = edge;
      r.vx = -Math.abs(r.vx) * 0.5;
    }
  }

  private botJumpers(): void {
    const ttb = timeToBottom(this.phi, this.botOmega);
    for (const j of this.jumpers) {
      if (j.status !== "in" || this.seats[j.seat]!.player.kind !== "bot") continue;
      if (!j.jumpedThisTurn && j.jumpT === null && ttb <= j.lead) {
        j.jumpedThisTurn = true;
        this.jump(j);
      }
    }
  }

  private botGhosts(): void {
    const ttb = timeToBottom(this.phi, this.appliedOmega);
    const grounded = this.jumpers.filter((j) => j.status === "in" && j.jumpT === null).length;
    for (const j of this.jumpers) {
      if (j.status === "in" || !j.ghost || j.whipCd > 0) continue;
      if (this.seats[j.seat]!.player.kind !== "bot") continue;
      if (botShouldWhip(ttb, grounded, this.rand)) this.whip(j);
    }
  }

  private sweep(): void {
    this.ctx.sfx.tick();
    const timeLeft = this.timeLeft;
    const liveWhippers = this.jumpers.filter((j) => j.status !== "in" && j.whipT > 0);
    for (const j of this.jumpers) {
      j.jumpedThisTurn = false;
      j.lead = botLead(this.rand);
      if (j.status !== "in") continue;
      const seat = this.seats[j.seat]!;
      const p = seat.player;
      if (isClear(j.jumpT)) {
        const gain = clearPoints(timeLeft);
        j.pot += gain;
        j.streak++;
        seat.bestStreak = Math.max(seat.bestStreak, j.streak);
        if (isStreakMilestone(j.streak)) {
          this.juice.burst(j.x, GROUND_Y - 60, [p.color, "#B8FF3D", "#ffffff"], { count: 22, speed: 260, gravity: 300 });
          this.pop(j.x, POP_Y, `x${j.streak} STREAK!`, "#B8FF3D", 1, 26);
          this.ctx.sfx.streak(Math.min(6, j.streak / 5));
        } else if (isCloseCall(j.jumpT)) {
          this.juice.burst(j.x, GROUND_Y - 10, ["#FFB020", "#ffffff"], { count: 8, speed: 200, gravity: 200, size: 3, life: 0.4 });
          this.pop(j.x, POP_Y, "SO CLOSE!", "#FFB020", 0.8, 22);
        } else if (this.overdrive) {
          this.pop(j.x, POP_Y, `+${gain}`, "#FF6A3D", 0.5, 20);
        }
        if (p.kind === "bot" && botWantsBail(j.pot, j.bailAt, this.overdrive, this.rand)) j.bankPending = true;
        continue;
      }
      this.hit(j, liveWhippers);
    }
  }

  private hit(j: Jumper, liveWhippers: Jumper[]): void {
    const seat = this.seats[j.seat]!;
    const p = seat.player;
    const outcome = sweepOutcome(j.pot, j.net);
    const sp = this.spinner >= 0 ? this.seats[this.spinner]! : null;
    if (sp && outcome.spinnerGain > 0) {
      sp.score += outcome.spinnerGain;
      this.pop(POLE_R + 50, GROUND_Y - 80, `+${outcome.spinnerGain}${outcome.stolen > 0 ? " STOLEN" : ""}`, sp.player.color, 1.1, 26);
    }
    j.streak = 0;
    j.jumpT = null;
    if (!outcome.out) {
      j.net = false;
      j.pot = outcome.kept;
      j.squash = 0.5;
      this.juice.shake(0.2);
      this.juice.burst(j.x, GROUND_Y - 20, ["#3EE0FF", "#ffffff"], { count: 16, speed: 220 });
      this.ctx.sfx.miss();
      this.pop(j.x, POP_Y, "STUMBLE! NET USED", "#3EE0FF", 1.1, 22);
      return;
    }
    j.status = "out";
    j.pot = 0;
    if (sp) sp.knockouts++;
    const v = knockVelocity(this.appliedOmega, this.rand);
    j.rag = { x: j.x, y: GROUND_Y - 26, vx: v.vx, vy: v.vy, rot: 0, spin: v.spin, bounces: 0, resting: false, t: 0 };
    j.squash = 1.4;
    this.juice.hitStop(0.06);
    this.juice.shake(0.35 + 0.25 * Math.min(1, this.appliedOmega / MAX_OMEGA));
    this.juice.burst(j.x, GROUND_Y - 20, [p.color, "#ffffff", "#FF3D7A"], { count: 26, speed: 280 });
    this.ctx.sfx.hit();
    this.callouts.show(`${p.name} OUT!`, "#FF3D7A", { size: 44, life: 0.9, y: 0.18 });
    for (const g of liveWhippers) {
      const gs = this.seats[g.seat]!;
      gs.score += ASSIST_POINTS;
      gs.assists++;
      this.pop(g.ghost?.x ?? g.x, (g.ghost?.y ?? GHOST_Y) - 40, `ASSIST +${ASSIST_POINTS}`, gs.player.color, 1.1, 24);
    }
    if (sp && sp.player.kind === "bot" && this.rand() < 0.5) {
      this.pop(POLE_R + 50, GROUND_Y - 120, TAUNTS[Math.floor(this.rand() * TAUNTS.length)] ?? "HA!", sp.player.color, 1.2, 22);
    }
  }

  private jump(j: Jumper): void {
    if (j.status !== "in" || j.jumpT !== null || this.phase !== "play") return;
    j.jumpT = 0;
    j.jumps++;
    j.squash = 1.3;
    this.ctx.sfx.whoosh();
  }

  /** Cash the pot in and leave the rope: safe for the rest of the round, haunting as a ghost. */
  private bank(j: Jumper): void {
    if (j.status !== "in" || this.phase !== "play" || j.pot <= 0) return;
    if (j.jumpT !== null) {
      j.bankPending = true;
      return;
    }
    j.bankPending = false;
    const seat = this.seats[j.seat]!;
    const p = seat.player;
    this.credit(seat, j.pot);
    this.pop(j.x, POP_Y, `BANKED +${j.pot}`, p.color, 1.2, 28);
    this.juice.burst(j.x, GROUND_Y - 40, [p.color, "#FFB020", "#ffffff"], { count: 20, speed: 240, gravity: 250 });
    this.ctx.sfx.collect();
    if (p.kind === "bot" && this.rand() < 0.5) this.pop(j.x, POP_Y - 30, "I'M OUT!", p.color, 1, 20);
    j.pot = 0;
    j.status = "banked";
    j.squash = 1.5;
    j.ghost = { x: j.x, y: GROUND_Y - 26, t: 0 };
  }

  /** Add banked points and track the personal-best pot (humans only). */
  private credit(seat: Seat, pot: number): void {
    seat.score += pot;
    seat.bestPot = Math.max(seat.bestPot, pot);
    if (seat.player.kind === "human" && pot > this.bestPot && saveBest(ropeSkip.id, pot, BEST_KEY)) {
      this.bestPot = pot;
      this.callouts.show(`NEW RECORD! POT ${pot}`, "#FFB020", { size: 46, life: 1.4, y: 0.42 });
    }
  }

  private whip(j: Jumper): void {
    if (j.status === "in" || !j.ghost || j.whipCd > 0 || this.phase !== "play") return;
    j.whipT = WHIP_TOTAL;
    j.whipCd = WHIP_COOLDOWN;
    j.squash = 1.6;
    this.juice.shake(0.08);
    this.juice.burst(j.ghost.x, j.ghost.y + 20, ["#ffffff", this.seats[j.seat]!.player.color], {
      count: 12, speed: 220, gravity: 100, size: 3, life: 0.4, angle: Math.PI / 2, spread: 1.6,
    });
    this.ctx.sfx.whoosh();
    const bot = this.seats[j.seat]!.player.kind === "bot";
    const text = bot && this.rand() < 0.35 ? GHOST_TAUNTS[Math.floor(this.rand() * GHOST_TAUNTS.length)] ?? "WHIP!" : "WHIP!";
    this.pop(j.ghost.x, j.ghost.y - 40, text, "#FFE7A8", 0.7, 24);
  }

  private endRound(): void {
    let alive = 0;
    let banked = 0;
    for (const j of this.jumpers) {
      const seat = this.seats[j.seat]!;
      if (j.status === "in") {
        alive++;
        seat.survived++;
        const reward = surviveReward(j.pot);
        this.credit(seat, j.pot);
        seat.score += SURVIVE_BONUS;
        this.pop(j.x, POP_Y, `SURVIVED +${reward}`, seat.player.color, OUTRO_SECONDS, 28);
        this.juice.burst(j.x, GROUND_Y - 40, [seat.player.color, "#B8FF3D", "#ffffff"], { count: 24, speed: 260, gravity: 250 });
        j.pot = 0;
      } else if (j.status === "banked") banked++;
    }
    const text = alive > 0 ? `${alive} SURVIVED` : banked > 0 ? "ALL BANKED" : "WIPEOUT!";
    this.callouts.show(text, alive > 0 ? "#B8FF3D" : banked > 0 ? "#FFB020" : "#FF3D7A", { size: 56 });
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

  private pop(x: number, y: number, text: string, color: string, life: number, size: number): void {
    this.pops.push({ x, y, text, color, life, maxLife: life, size });
  }

  // ---- input ----

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / (r.width || 1)) * this.ctx.width,
      y: ((e.clientY - r.top) / (r.height || 1)) * this.ctx.height,
    };
  }

  private stripWidth(): number {
    return this.ctx.width / Math.max(1, this.jumpers.length);
  }

  private bankWidth(): number {
    const w = this.stripWidth();
    return Math.max(this.ctx.minTap * 1.6, Math.min(170, Math.floor(w * 0.3)));
  }

  private stripFor(x: number): { jumper: Jumper; bank: boolean } | undefined {
    const n = this.jumpers.length;
    if (n === 0) return undefined;
    const w = this.stripWidth();
    const k = Math.min(n - 1, Math.max(0, Math.floor(x / w)));
    const jumper = this.jumpers[k];
    if (!jumper) return undefined;
    const bank = x - k * w >= w - this.bankWidth();
    return { jumper, bank };
  }

  private readonly onDown = (e: PointerEvent): void => {
    const p = this.toLogical(e);
    if (p.y >= STRIP_Y) {
      const hit = this.stripFor(p.x);
      if (hit && this.seats[hit.jumper.seat]!.player.kind === "human") {
        e.preventDefault();
        const j = hit.jumper;
        if (j.status !== "in") this.whip(j);
        else if (hit.bank) this.bank(j);
        else this.jump(j);
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
    if (this.overdrive && this.phase === "play") {
      const pulse = 0.08 + 0.05 * Math.sin(this.clock * 9);
      g.fillStyle = `rgba(255,106,61,${pulse.toFixed(3)})`;
      g.fillRect(0, 0, width, STRIP_Y);
    }
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
    for (const j of this.jumpers) this.drawGhost(g, j);

    this.drawSpinner(g);
    this.juice.end(g);

    this.drawHud(g);
    this.drawPops(g);
    this.callouts.draw(g, width, height);
  }

  private drawRope(g: CanvasRenderingContext2D, front: boolean): void {
    const c = Math.cos(this.phi);
    const depth = Math.sin(this.phi);
    const grabbed = this.jumpers.some((j) => whipPhase(j.whipT) === "grab");
    const hot = this.whipFlash > 0 || this.overdrive || grabbed;
    g.save();
    if (front && hot) {
      g.shadowColor = this.whipFlash > 0 ? "#ffffff" : grabbed ? "#B8C4FF" : "#FF6A3D";
      g.shadowBlur = this.whipFlash > 0 ? 18 : 10;
    }
    g.strokeStyle = front
      ? this.whipFlash > 0 ? "#ffffff" : grabbed ? "#B8C4FF" : this.overdrive ? "#FF9A6A" : "#FFE7A8"
      : grabbed ? "rgba(184,196,255,0.6)" : "rgba(200,180,130,0.55)";
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
    if (j.ghost) return;
    const lift = jumpHeight(j.jumpT) * JUMP_PEAK;
    const r = 26;
    g.save();
    if (j.status === "out" && j.rag) {
      g.translate(j.rag.x, j.rag.y);
      g.rotate(j.rag.rot);
      g.globalAlpha = 0.75;
    } else {
      g.translate(j.x, GROUND_Y - r - lift);
    }
    if (j.net && j.status === "in") {
      g.save();
      g.setLineDash([6, 6]);
      g.lineDashOffset = -this.clock * 40;
      g.strokeStyle = "rgba(62,224,255,0.85)";
      g.lineWidth = 3;
      g.beginPath();
      g.arc(0, 0, r + 9, 0, TAU);
      g.stroke();
      g.restore();
    }
    // Squash and stretch: volume-ish preserving.
    const sy = j.squash;
    const sx = 1 / Math.sqrt(sy);
    g.translate(0, r * (1 - sy));
    g.scale(sx, sy);
    g.fillStyle = p.color;
    g.beginPath();
    g.ellipse(0, 0, r, r, 0, 0, TAU);
    g.fill();
    g.fillStyle = "#070b14";
    g.beginPath();
    g.arc(-8, -6, 4, 0, TAU);
    g.arc(8, -6, 4, 0, TAU);
    g.fill();
    g.restore();

    g.textAlign = "center";
    if (j.status === "in" && (this.phase !== "outro" || j.pot > 0)) {
      // Pot bubble above the head.
      const by = GROUND_Y - r * 2 - lift - 30;
      const hot = this.overdrive;
      g.fillStyle = j.pot > 0 ? (hot ? "#FF6A3D" : "#FFB020") : "rgba(244,247,251,0.25)";
      g.font = "700 24px Bebas Neue, Impact, sans-serif";
      g.textBaseline = "middle";
      g.fillText(j.pot > 0 ? `POT ${j.pot}` : "POT 0", j.x, by);
    }
    g.fillStyle = j.status === "in" ? p.color : "rgba(244,247,251,0.35)";
    g.font = "700 20px Bebas Neue, Impact, sans-serif";
    g.textBaseline = "top";
    g.fillText(j.status === "out" ? "OUT" : j.streak >= 3 ? `${p.name} x${j.streak}` : p.name, j.x, GROUND_Y + 10);
  }

  private drawGhost(g: CanvasRenderingContext2D, j: Jumper): void {
    const gh = j.ghost;
    if (!gh) return;
    const p = this.seats[j.seat]!.player;
    const r = 24;
    const ready = j.whipCd <= 0;
    g.save();
    g.translate(gh.x, gh.y);
    const sy = j.squash;
    const sx = 1 / Math.sqrt(sy);
    g.scale(sx, sy);
    g.globalAlpha = j.whipT > 0 ? 0.95 : 0.55;
    g.fillStyle = p.color;
    g.beginPath();
    g.arc(0, -4, r, Math.PI, 0);
    const wob = Math.sin(gh.t * 6) * 3;
    g.lineTo(r, 14);
    g.lineTo(r * 0.5, 8 + wob);
    g.lineTo(0, 16 - wob);
    g.lineTo(-r * 0.5, 8 + wob);
    g.lineTo(-r, 14);
    g.closePath();
    g.fill();
    g.fillStyle = "#070b14";
    g.beginPath();
    g.arc(-8, -8, 4, 0, TAU);
    g.arc(8, -8, 4, 0, TAU);
    g.fill();
    g.restore();
    if (j.whipT > 0) {
      // Grab: a taut tether down to the rope. Snap: a fading lightning crack.
      const grab = whipPhase(j.whipT) === "grab";
      g.save();
      g.strokeStyle = grab ? "#B8C4FF" : "#ffffff";
      g.lineWidth = grab ? 4 : 3;
      g.globalAlpha = grab ? 0.9 : j.whipT / WHIP_TOTAL;
      g.beginPath();
      g.moveTo(gh.x, gh.y + 16);
      const ty = AXIS_Y - ROPE_R * 0.85;
      const steps = 4;
      for (let i = 1; i <= steps; i++) {
        const u = i / steps;
        g.lineTo(gh.x + (i < steps && !grab ? (i % 2 ? 14 : -14) : 0), gh.y + 16 + (ty - gh.y - 16) * u);
      }
      g.stroke();
      g.restore();
    }
    g.textAlign = "center";
    g.textBaseline = "top";
    g.font = "700 16px Bebas Neue, Impact, sans-serif";
    g.fillStyle = ready ? "rgba(255,231,168,0.9)" : "rgba(244,247,251,0.4)";
    g.fillText(j.status === "banked" ? "BANKED" : "GHOST", gh.x, gh.y + 22);
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

    // control ring with a speed gauge filling around it
    g.strokeStyle = "rgba(244,247,251,0.18)";
    g.lineWidth = 14;
    g.beginPath();
    g.arc(RING.x, RING.y, RING.r, 0, TAU);
    g.stroke();
    const floor = omegaFloor(this.overdrive);
    const speed = Math.min(1, (this.appliedOmega - floor) / (MAX_OMEGA - floor));
    g.strokeStyle = speed > 0.75 ? "#FF3D7A" : speed > 0.4 ? "#FFB020" : "#B8FF3D";
    g.lineWidth = 6;
    g.beginPath();
    g.arc(RING.x, RING.y, RING.r + 14, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.02, speed));
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
    // overdrive marker on the timer bar
    const odX = 40 + (width - 80) * (OVERDRIVE_SECONDS / ROUND_SECONDS);
    g.fillStyle = "#FF6A3D";
    g.fillRect(odX - 2, 14, 4, 18);

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
    if (this.anyHuman && this.bestPot > 0) {
      g.font = "700 16px Bebas Neue, Impact, sans-serif";
      g.fillStyle = "rgba(255,176,32,0.8)";
      g.fillText(`BEST POT ${this.bestPot}`, width - 40, 62);
    }
    if (this.overdrive && this.phase === "play") {
      g.textAlign = "center";
      g.font = "700 30px Bebas Neue, Impact, sans-serif";
      g.fillStyle = `rgba(255,106,61,${(0.7 + 0.3 * Math.sin(this.clock * 10)).toFixed(2)})`;
      g.fillText("OVERDRIVE  x2", width / 2, 60);
    }

    // jumper tap strips
    const w = this.stripWidth();
    const bw = this.bankWidth();
    const sh = height - STRIP_Y - 6;
    const cy = STRIP_Y + sh / 2;
    this.jumpers.forEach((j, k) => {
      const p = this.seats[j.seat]!.player;
      const x0 = k * w + 4;
      const bot = p.kind === "bot";
      g.textAlign = "center";
      g.textBaseline = "middle";
      if (j.status === "in") {
        const jw = w - 8 - bw;
        g.fillStyle = "rgba(244,247,251,0.07)";
        g.fillRect(x0, STRIP_Y, jw - 4, sh);
        g.strokeStyle = p.color;
        g.lineWidth = 2;
        g.strokeRect(x0, STRIP_Y, jw - 4, sh);
        g.fillStyle = p.color;
        g.font = "700 22px Bebas Neue, Impact, sans-serif";
        g.fillText(bot ? `${p.name} (BOT)` : `${p.name}: TAP TO JUMP`, x0 + jw / 2, cy);
        // bank button
        const bx = x0 + jw;
        const armed = j.pot > 0 && !bot;
        g.fillStyle = armed ? "rgba(255,176,32,0.22)" : "rgba(244,247,251,0.04)";
        g.fillRect(bx, STRIP_Y, bw - 4, sh);
        g.strokeStyle = armed ? "#FFB020" : "rgba(244,247,251,0.25)";
        g.strokeRect(bx, STRIP_Y, bw - 4, sh);
        g.fillStyle = armed ? "#FFB020" : "rgba(244,247,251,0.35)";
        g.font = "700 24px Bebas Neue, Impact, sans-serif";
        g.fillText("BANK", bx + (bw - 4) / 2, cy - 14);
        g.font = "700 20px Bebas Neue, Impact, sans-serif";
        g.fillText(j.pot > 0 ? `+${j.pot}` : "--", bx + (bw - 4) / 2, cy + 14);
      } else {
        const ready = j.whipCd <= 0 && !!j.ghost;
        g.fillStyle = "rgba(244,247,251,0.04)";
        g.fillRect(x0, STRIP_Y, w - 8, sh);
        if (!ready && j.ghost) {
          g.fillStyle = "rgba(255,231,168,0.12)";
          g.fillRect(x0, STRIP_Y, (w - 8) * (1 - j.whipCd / WHIP_COOLDOWN), sh);
        }
        g.strokeStyle = ready ? "#FFE7A8" : "rgba(244,247,251,0.25)";
        g.lineWidth = 2;
        g.strokeRect(x0, STRIP_Y, w - 8, sh);
        g.fillStyle = ready ? "#FFE7A8" : "rgba(244,247,251,0.45)";
        g.font = "700 22px Bebas Neue, Impact, sans-serif";
        const label = bot ? `${p.name} (BOT) GHOST` : ready ? `${p.name}: TAP TO WHIP THE ROPE` : `${p.name}: WHIP RECHARGING`;
        g.fillText(label, x0 + (w - 8) / 2, cy);
      }
    });
  }

  private drawPops(g: CanvasRenderingContext2D): void {
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const p of this.pops) {
      const t = 1 - p.life / p.maxLife;
      const pop = t < 0.15 ? 0.7 + (t / 0.15) * 0.4 : 1.1 - Math.min(0.1, (t - 0.15) * 0.4);
      g.globalAlpha = Math.min(1, p.life / (p.maxLife * 0.35));
      g.font = `700 ${Math.round(p.size * pop)}px Bebas Neue, Impact, sans-serif`;
      g.lineWidth = 5;
      g.strokeStyle = "rgba(7,11,20,0.8)";
      g.strokeText(p.text, p.x, p.y);
      g.fillStyle = p.color;
      g.fillText(p.text, p.x, p.y);
    }
    g.restore();
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
      out.push({ playerId: s.player.id, label: "Biggest pot banked", value: String(s.bestPot) });
      if (this.order[0]! >= 0) out.push({ playerId: s.player.id, label: "Knockouts as spinner", value: String(s.knockouts) });
      if (s.assists > 0) out.push({ playerId: s.player.id, label: "Ghost assists", value: String(s.assists) });
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

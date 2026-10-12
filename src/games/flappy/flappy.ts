import { fillArena } from "../../core/draw";
import { Callouts, Juice, saveBest } from "../../fx/juice";
import type {
  GameContext,
  GameDefinition,
  GameInstance,
  GameStat,
  Player,
} from "../../core/types";
import {
  BANK_GAP_SCALE,
  BANK_WARNING_AT,
  GATE_WIDTH,
  HAZARD_RADIUS,
  HESITATION_MAX,
  HESITATION_MIN,
  JET_RADIUS,
  LIVES,
  MATCH_SECONDS,
  MULT_STEP,
  POINTS_COIN,
  POINTS_GATE,
  POINTS_SKIM,
  RELAUNCH_GRACE,
  RESPAWN_DELAY,
  SPEED_OVERDRIVE,
  SPEED_START,
  STORM_COOLDOWN,
  STORM_HIT_POINTS,
  SURVIVOR_BONUS,
  bankAim,
  botSloppiness,
  botWantsBank,
  flapClearsCeiling,
  flapThreshold,
  nextGapY,
  clearance,
  compareLanes,
  gain,
  inBankHalf,
  isBankGate,
  isSkim,
  multFor,
  multPips,
  paceAt,
  safeBand,
  speedScale,
  stormTarget,
  underdogIndex,
  type BankSide,
} from "./logic";

export const flappyRace: GameDefinition = {
  id: "flappy-race",
  name: "Sky Dash",
  tagline: "Tap to climb. Bank your run, or ride it for more.",
  description:
    "Everyone flies a jet in their own lane for 75 seconds. Tap to climb, let go to drop, thread the neon gates. " +
    "Every gate, coin and skim grows your RUN, and every three gates in a row raises its multiplier. " +
    "Nothing counts until you fly through the gold BANK half of a split gate; crash and the whole run is gone. " +
    "Three lives each. Lose them all and you become a storm cloud: tap a rival to drop a thunderhead in their lane. " +
    "The last 20 seconds are OVERDRIVE: faster, tighter, double points. Unbanked points die at the whistle.",
  durationMs: 0,
  controls: "Tap your lane to climb. Out of lives? Tap a rival to storm them.",
  create: (ctx) => new FlappyRace(ctx),
};

const BEST_VERSION = "v2-bank";
const GRAVITY = 900;
const FLAP_VEL = -320;
const TOP_PAD = 64;
const COIN_RADIUS = 10;
const PICKUP_RADIUS = 14;
const COIN_CHANCE = 0.6;
const PICKUP_CHANCE = 0.12;
const GHOST_TIME = 3;
const SHIELD_GRACE = 1;
const SPEED_STEP = 50;
const GOLD = "#FFB020";
const PINK = "#FF3D7A";
const CYAN = "#3EE0FF";
const LILAC = "#C9B8FF";
const NEON = "#B45CFF";

type ItemKind = "coin" | "shield" | "ghost";
type LaneState = "flying" | "respawning" | "out";

interface Gate {
  x: number;
  gapY: number;
  gapH: number;
  scored: boolean;
  /** Smallest clearance to a gap edge while the jet was inside this gate. */
  minClear: number;
  /** Jet phased through or was shielded on this gate (no skim bonus). */
  touched: boolean;
  /** Which half of the gap is the gold BANK half, if this is a split gate. */
  bank: BankSide | null;
  /** Jet altitude when it crossed the middle of the gate. */
  passY: number | null;
}

interface Item {
  kind: ItemKind;
  x: number;
  y: number;
  taken: boolean;
}

interface Hazard {
  x: number;
  y: number;
  /** Lane index of the storm cloud that dropped it. */
  owner: number;
  spin: number;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  size: number;
}

interface StormButton {
  x: number;
  y: number;
  w: number;
  h: number;
  target: number;
}

interface Lane {
  player: Player;
  index: number;
  x: number;
  width: number;
  bird: { y: number; vy: number };
  state: LaneState;
  lives: number;
  respawnTimer: number;
  pipes: Gate[];
  items: Item[];
  hazards: Hazard[];
  score: number;
  run: number;
  streak: number;
  spawned: number;
  gates: number;
  coins: number;
  skims: number;
  bestBank: number;
  stormHits: number;
  crashes: number;
  shield: boolean;
  ghost: number;
  grace: number;
  pipeTimer: number;
  flapCount: number;
  botTimer: number;
  botNerve: number;
  stormCooldown: number;
  stormFlash: number;
  underdog: boolean;
  lastGapY: number;
  outTime: number;
  trailTimer: number;
}

class FlappyRace implements GameInstance {
  private readonly lanes: Lane[];
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private floaters: Floater[] = [];
  private time = 0;
  /** Scroll speed in px/s after the lane-width scale. */
  private speed = SPEED_START;
  /** Unscaled pace speed, for bot nerves and the speed-line visuals. */
  private paceSpeed = SPEED_START;
  private readonly scale: number;
  private speedStep = 0;
  private overdrive = false;
  private bankWarned = false;
  /** Seconds until the next "X BANKS N!" callout may show, so two big banks never overprint. */
  private bankCalloutCooldown = 0;
  private finished = false;
  private finishTimer = 0;

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    const n = ctx.players.length;
    const laneW = ctx.width / n;
    this.scale = speedScale(laneW);

    this.lanes = ctx.players.map((player, i) => ({
      player,
      index: i,
      x: i * laneW,
      width: laneW,
      bird: { y: (ctx.height - TOP_PAD) / 2 + TOP_PAD, vy: 0 },
      state: "flying",
      lives: LIVES,
      respawnTimer: 0,
      pipes: [],
      items: [],
      hazards: [],
      score: 0,
      run: 0,
      streak: 0,
      spawned: 0,
      gates: 0,
      coins: 0,
      skims: 0,
      bestBank: 0,
      stormHits: 0,
      crashes: 0,
      shield: false,
      ghost: 0,
      grace: 0,
      pipeTimer: 1.5,
      flapCount: 0,
      botTimer: 0,
      botNerve: ctx.rng.float(0.15, 0.9),
      stormCooldown: 0,
      stormFlash: 0,
      underdog: false,
      lastGapY: (ctx.height - TOP_PAD) / 2 + TOP_PAD,
      outTime: 0,
      trailTimer: 0,
    }));

    const c = ctx.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", this.onDown);
  }

  private jetX(lane: Lane): number {
    return lane.x + lane.width * 0.3;
  }

  private multOf(lane: Lane): number {
    return multFor(lane.streak, lane.underdog);
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    this.bankCalloutCooldown = Math.max(0, this.bankCalloutCooldown - realDt);
    for (const f of this.floaters) {
      f.life -= realDt;
      f.y -= 40 * realDt;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    const dt = this.juice.update(realDt);

    if (this.finished) {
      this.finishTimer -= realDt;
      return;
    }

    this.time += dt;
    const pace = paceAt(this.time);
    this.paceSpeed = pace.speed;
    this.speed = pace.speed * this.scale;

    if (pace.overdrive && !this.overdrive) {
      this.overdrive = true;
      this.callouts.show("OVERDRIVE!", PINK, { size: 72, life: 1.4, y: 0.3 });
      this.callouts.show("DOUBLE POINTS", GOLD, { size: 36, life: 1.4, y: 0.42 });
      this.juice.shake(0.35);
      this.ctx.sfx.go();
    } else if (!pace.overdrive) {
      const step = Math.floor((this.paceSpeed - SPEED_START) / SPEED_STEP);
      if (step > this.speedStep) {
        this.speedStep = step;
        this.callouts.show("SPEED UP!", CYAN, { size: 40, life: 0.9, y: 0.18 });
        this.ctx.sfx.go();
      }
    }
    if (!this.bankWarned && this.time >= BANK_WARNING_AT) {
      this.bankWarned = true;
      this.callouts.show("10 SECONDS: BANK IT!", GOLD, { size: 48, life: 1.4, y: 0.22 });
      this.ctx.sfx.countdown();
    }

    const under = underdogIndex(this.lanes.map((l) => l.score));
    for (const lane of this.lanes) {
      const was = lane.underdog;
      lane.underdog = lane.index === under && lane.state !== "out";
      if (lane.underdog && !was) {
        this.floater(this.jetX(lane), lane.bird.y + 54, "UNDERDOG +1x", "#B8FF3D", 20);
      }
    }

    for (const lane of this.lanes) {
      lane.stormFlash = Math.max(0, lane.stormFlash - dt);
      if (lane.state === "out") {
        lane.stormCooldown = Math.max(0, lane.stormCooldown - dt);
        this.scrollLane(lane, dt);
        if (lane.player.kind === "bot") this.botStorm(lane, dt);
        continue;
      }

      if (lane.state === "respawning") {
        lane.respawnTimer -= dt;
        this.scrollLane(lane, dt);
        this.spawnTick(lane, dt, pace.interval, pace.gap);
        if (lane.respawnTimer <= 0) this.relaunch(lane);
        continue;
      }

      this.flyLane(lane, dt, pace.overdrive);
      if (lane.state !== "flying") continue;
      this.spawnTick(lane, dt, pace.interval, pace.gap);
      if (lane.player.kind === "bot") this.botTick(lane, dt);
    }

    const withLives = this.lanes.filter((l) => l.state !== "out");
    if (this.time >= MATCH_SECONDS) {
      this.finishMatch("time");
    } else if (withLives.length <= (this.lanes.length === 1 ? 0 : 1)) {
      this.finishMatch("survivor");
    }
  }

  /** Moves gates, items and hazards left; drops what has scrolled off. */
  private scrollLane(lane: Lane, dt: number): void {
    for (const gate of lane.pipes) gate.x -= this.speed * dt;
    for (const item of lane.items) item.x -= this.speed * dt;
    for (const hz of lane.hazards) {
      hz.x -= this.speed * dt;
      hz.spin += dt * 3;
    }
    lane.pipes = lane.pipes.filter((p) => p.x + GATE_WIDTH > lane.x - 20);
    lane.items = lane.items.filter((it) => !it.taken && it.x > lane.x - 20);
    lane.hazards = lane.hazards.filter((hz) => hz.x > lane.x - 40);
  }

  private spawnTick(lane: Lane, dt: number, interval: number, gap: number): void {
    lane.pipeTimer -= dt;
    if (lane.pipeTimer <= 0) {
      const wait = interval + this.ctx.rng.float(-0.2, 0.2);
      lane.pipeTimer = wait;
      this.spawnGate(lane, gap, wait);
    }
  }

  private flyLane(lane: Lane, dt: number, overdrive: boolean): void {
    const jetX = this.jetX(lane);
    lane.ghost = Math.max(0, lane.ghost - dt);
    lane.grace = Math.max(0, lane.grace - dt);

    lane.bird.vy += GRAVITY * dt;
    lane.bird.y += lane.bird.vy * dt;

    const top = TOP_PAD + JET_RADIUS;
    const bottom = this.ctx.height - JET_RADIUS;
    if (lane.bird.y < top || lane.bird.y > bottom) {
      if (lane.grace > 0 || lane.shield) {
        // Shield bounces you off the edge instead of ending the run.
        if (lane.grace <= 0) this.breakShield(lane, jetX);
        const hitFloor = lane.bird.y > bottom;
        lane.bird.y = hitFloor ? bottom : top;
        lane.bird.vy = hitFloor ? FLAP_VEL : 60;
      } else {
        this.crash(lane, null);
        return;
      }
    }

    // Streak sparkle once the multiplier is rolling.
    const mult = this.multOf(lane);
    if (mult >= 3) {
      lane.trailTimer -= dt;
      if (lane.trailTimer <= 0) {
        lane.trailTimer = mult >= 5 ? 0.04 : 0.09;
        this.juice.burst(jetX - JET_RADIUS, lane.bird.y, [GOLD, lane.player.color], {
          count: 1, speed: 60, gravity: 0, life: 0.35, size: 3, angle: Math.PI, spread: 0.6,
        });
      }
    }

    for (const gate of lane.pipes) {
      gate.x -= this.speed * dt;
      const mid = gate.x + GATE_WIDTH / 2;
      const inside = jetX + JET_RADIUS > gate.x && jetX - JET_RADIUS < gate.x + GATE_WIDTH;
      if (inside) {
        if (gate.passY === null && jetX >= mid) gate.passY = lane.bird.y;
        const clear = clearance(lane.bird.y, gate.gapY, gate.gapH);
        if (clear < 0) {
          if (lane.ghost > 0 || lane.grace > 0) {
            gate.touched = true;
          } else if (lane.shield) {
            gate.touched = true;
            this.breakShield(lane, jetX);
          } else {
            this.crash(lane, null);
            return;
          }
        } else {
          gate.minClear = Math.min(gate.minClear, clear);
        }
      }

      if (!gate.scored && gate.x + GATE_WIDTH < jetX - JET_RADIUS) {
        gate.scored = true;
        this.clearGate(lane, gate, overdrive);
      }
    }

    for (const item of lane.items) {
      item.x -= this.speed * dt;
      if (item.taken) continue;
      const r = item.kind === "coin" ? COIN_RADIUS : PICKUP_RADIUS;
      const dx = item.x - jetX;
      const dy = item.y - lane.bird.y;
      if (dx * dx + dy * dy < (r + JET_RADIUS) * (r + JET_RADIUS)) {
        item.taken = true;
        this.collect(lane, item, overdrive);
      }
    }

    for (const hz of lane.hazards) {
      hz.x -= this.speed * dt;
      hz.spin += dt * 3;
      const dx = hz.x - jetX;
      const dy = hz.y - lane.bird.y;
      const reach = HAZARD_RADIUS + JET_RADIUS - 4;
      if (dx * dx + dy * dy < reach * reach) {
        if (lane.ghost > 0 || lane.grace > 0) continue;
        hz.x = lane.x - 100;
        if (lane.shield) {
          this.breakShield(lane, jetX);
        } else {
          this.crash(lane, hz.owner);
          return;
        }
      }
    }

    lane.pipes = lane.pipes.filter((p) => p.x + GATE_WIDTH > lane.x - 20);
    lane.items = lane.items.filter((it) => !it.taken && it.x > lane.x - 20);
    lane.hazards = lane.hazards.filter((hz) => hz.x > lane.x - 40);
  }

  private clearGate(lane: Lane, gate: Gate, overdrive: boolean): void {
    const jetX = this.jetX(lane);
    lane.gates++;
    const skim = !gate.touched && isSkim(gate.minClear);
    if (skim) {
      lane.skims++;
      lane.streak += MULT_STEP;
    }
    const mult = this.multOf(lane);
    let pts = gain(POINTS_GATE, mult, overdrive);
    if (skim) pts += gain(POINTS_SKIM, mult, overdrive);
    lane.run += pts;
    lane.streak++;

    if (skim) {
      this.floater(jetX, lane.bird.y - 30, `SKIM! x${this.multOf(lane)}`, PINK, 24);
      this.juice.burst(jetX, lane.bird.y, [PINK, "#ffffff"], {
        count: 12, speed: 200, gravity: 0, life: 0.35, size: 3,
      });
      this.juice.shake(0.1);
      this.juice.hitStop(0.03);
      this.ctx.sfx.streak(Math.min(6, mult + 1));
    } else if (lane.streak % MULT_STEP === 0 && multFor(lane.streak) > multFor(lane.streak - 1)) {
      this.floater(jetX, lane.bird.y - 30, `x${this.multOf(lane)}`, GOLD, 26);
      this.ctx.sfx.streak(Math.min(6, multFor(lane.streak)));
    } else {
      this.ctx.sfx.tick();
    }

    if (gate.bank) {
      if (gate.passY !== null && inBankHalf(gate.passY, gate.gapY, gate.bank)) {
        this.bank(lane);
      } else if (lane.run > 0) {
        this.floater(jetX, lane.bird.y + 54, `RIDING ${lane.run}`, LILAC, 18);
      }
    }
  }

  private bank(lane: Lane): void {
    const jetX = this.jetX(lane);
    if (lane.run <= 0) return;
    const amount = lane.run;
    lane.score += amount;
    lane.bestBank = Math.max(lane.bestBank, amount);
    lane.run = 0;
    lane.streak = 0;
    this.floater(jetX, lane.bird.y - 34, `BANKED +${amount}`, GOLD, amount >= 30 ? 30 : 24);
    this.juice.burst(jetX, lane.bird.y, [GOLD, "#FFE38A", "#ffffff"], {
      count: Math.min(40, 10 + amount), speed: 220, gravity: 100, life: 0.5, size: 4,
    });
    this.juice.shake(Math.min(0.3, 0.08 + amount / 150));
    this.ctx.sfx.streak(Math.min(6, 1 + Math.floor(amount / 10)));
    if (amount >= 40 && this.bankCalloutCooldown <= 0) {
      this.bankCalloutCooldown = 1.1;
      this.callouts.show(`${lane.player.name} BANKS ${amount}!`, GOLD, { size: 40, life: 1, y: 0.9 });
    }
  }

  private spawnGate(lane: Lane, baseGap: number, interval: number): void {
    const rng = this.ctx.rng;
    lane.spawned++;
    const split = isBankGate(lane.spawned);
    const gap = split ? baseGap * BANK_GAP_SCALE : baseGap;
    const minY = TOP_PAD + gap / 2 + 30;
    const maxY = this.ctx.height - gap / 2 - 30;
    const gapY = nextGapY(lane.lastGapY, interval, minY, maxY, rng.next());
    lane.lastGapY = gapY;
    const gate: Gate = {
      x: lane.x + lane.width + GATE_WIDTH,
      gapY,
      gapH: gap,
      scored: false,
      minClear: Infinity,
      touched: false,
      bank: split ? (rng.next() < 0.5 ? "top" : "bottom") : null,
      passY: null,
    };
    lane.pipes.push(gate);

    const roll = rng.next();
    const cx = gate.x + GATE_WIDTH / 2;
    if (roll < PICKUP_CHANCE) {
      // Power-ups sit a bit ahead of the gate, in the middle of the gap.
      const kind: ItemKind = rng.next() < 0.5 ? "shield" : "ghost";
      lane.items.push({ kind, x: cx - 110, y: gate.gapY, taken: false });
    } else if (roll < PICKUP_CHANCE + COIN_CHANCE && !gate.bank) {
      // Coins sit off-center in the gap, so grabbing one means flying closer to an edge.
      const off = gate.gapH / 2 - JET_RADIUS - 4;
      lane.items.push({ kind: "coin", x: cx, y: gate.gapY + rng.float(-off, off), taken: false });
    }
  }

  private collect(lane: Lane, item: Item, overdrive: boolean): void {
    const jetX = this.jetX(lane);
    if (item.kind === "coin") {
      lane.coins++;
      const pts = gain(POINTS_COIN, this.multOf(lane), overdrive);
      lane.run += pts;
      this.floater(item.x, item.y - 18, `+${pts}`, GOLD, 22);
      this.juice.burst(item.x, item.y, [GOLD, "#FFE38A"], {
        count: 8, speed: 140, gravity: 0, life: 0.3, size: 3,
      });
      this.ctx.sfx.collect();
    } else if (item.kind === "shield") {
      lane.shield = true;
      this.floater(jetX, lane.bird.y - 28, "SHIELD", CYAN, 22);
      this.juice.burst(jetX, lane.bird.y, CYAN, { count: 14, speed: 200, gravity: 0, life: 0.4 });
      this.ctx.sfx.select();
    } else {
      lane.ghost = GHOST_TIME;
      this.floater(jetX, lane.bird.y - 28, "GHOST", LILAC, 22);
      this.juice.burst(jetX, lane.bird.y, LILAC, { count: 14, speed: 200, gravity: 0, life: 0.4 });
      this.ctx.sfx.select();
    }
  }

  private breakShield(lane: Lane, jetX: number): void {
    lane.shield = false;
    lane.grace = SHIELD_GRACE;
    this.juice.shake(0.25);
    this.juice.burst(jetX, lane.bird.y, [CYAN, "#ffffff"], {
      count: 22, speed: 260, gravity: 200, life: 0.5,
    });
    this.floater(jetX, lane.bird.y - 28, "SAVED!", CYAN, 22);
    this.ctx.sfx.hit();
  }

  private floater(x: number, y: number, text: string, color: string, size = 22): void {
    this.floaters.push({ x, y, text, color, life: 0.9, size });
  }

  /** The jet goes down. `by` is the lane index of a storm cloud whose shot did it, or null. */
  private crash(lane: Lane, by: number | null): void {
    const jetX = this.jetX(lane);
    lane.lives--;
    lane.crashes++;
    const lost = lane.run;
    lane.run = 0;
    lane.streak = 0;
    lane.shield = false;
    lane.ghost = 0;
    lane.grace = 0;

    this.juice.shake(0.35);
    this.juice.hitStop(0.06);
    this.juice.burst(jetX, lane.bird.y, [lane.player.color, PINK, "#ffffff"], {
      count: 30, speed: 300, gravity: 500, life: 0.6,
    });
    this.ctx.sfx.hit();
    if (lost > 0) this.floater(jetX, lane.bird.y - 34, `LOST ${lost}`, PINK, 26);

    const shooter = by === null ? null : this.lanes[by];
    if (shooter) {
      shooter.score += STORM_HIT_POINTS;
      shooter.stormHits++;
      this.floater(shooter.x + shooter.width / 2, this.ctx.height * 0.5, `HIT +${STORM_HIT_POINTS}`, shooter.player.color, 28);
      this.floater(jetX, lane.bird.y + 10, "STORMED!", shooter.player.color, 22);
    }

    if (lane.lives > 0) {
      lane.state = "respawning";
      lane.respawnTimer = RESPAWN_DELAY;
      if (!shooter) this.floater(jetX, lane.bird.y + 10, "CRASH", PINK, 20);
    } else {
      lane.state = "out";
      lane.outTime = this.time;
      lane.stormCooldown = 1;
      this.callouts.show(`${lane.player.name} OUT!`, PINK, { size: 48, life: 0.9 });
    }
  }

  /** Back into the air, lined up with the next gap so the relaunch is not an instant second crash. */
  private relaunch(lane: Lane): void {
    lane.state = "flying";
    const jetX = this.jetX(lane);
    const next = lane.pipes.find((p) => p.x + GATE_WIDTH > jetX - JET_RADIUS);
    lane.bird.y = next ? next.gapY : (this.ctx.height - TOP_PAD) / 2 + TOP_PAD;
    lane.bird.vy = 0;
    lane.grace = RELAUNCH_GRACE;
    this.floater(this.jetX(lane), lane.bird.y - 30, "RELAUNCH", CYAN, 20);
    this.ctx.sfx.select();
  }

  /** Storm shot: drops a thunderhead at the target's altitude at the far side of their lane. */
  private storm(from: Lane, target: Lane): boolean {
    if (from.state !== "out" || from.stormCooldown > 0 || target.state === "out") return false;
    from.stormCooldown = STORM_COOLDOWN;
    from.stormFlash = 0.4;
    const y = Math.min(this.ctx.height - 40, Math.max(TOP_PAD + 40, target.bird.y));
    target.hazards.push({ x: target.x + target.width + HAZARD_RADIUS, y, owner: from.index, spin: 0 });
    this.floater(target.x + target.width - 70, y - 36, `${from.player.name}!`, from.player.color, 20);
    this.ctx.sfx.miss();
    return true;
  }

  private stormButtons(lane: Lane): StormButton[] {
    const targets = this.lanes.filter((l) => l !== lane && l.state !== "out");
    const w = Math.min(lane.width - 36, 200);
    const h = Math.max(this.ctx.minTap, 60);
    const gapY = 14;
    const total = targets.length * h + (targets.length - 1) * gapY;
    const top = this.ctx.height * 0.58 - total / 2;
    return targets.map((t, i) => ({
      x: lane.x + (lane.width - w) / 2,
      y: top + i * (h + gapY),
      w,
      h,
      target: t.index,
    }));
  }

  private botStorm(lane: Lane, dt: number): void {
    lane.botTimer += dt;
    if (lane.botTimer < 0.1) return;
    lane.botTimer = 0;
    if (lane.stormCooldown > 0) return;
    const candidates = this.lanes.filter((l) => l !== lane && l.state === "flying").map((l) => l.index);
    if (candidates.length === 0) return;
    const idx = stormTarget(this.lanes.map((l) => l.score), candidates, this.ctx.rng.next());
    const target = this.lanes[idx];
    if (!target) return;
    // Hesitate, then prefer the moment a gate is about to arrive so the shot lands in the gap.
    const jetX = this.jetX(target);
    const next = target.pipes.find((p) => p.x + GATE_WIDTH > jetX);
    const gateSoon = next !== undefined && next.x - jetX < target.width * 0.6;
    const chance = gateSoon ? 0.35 : 0.08;
    if (this.ctx.rng.next() < chance) this.storm(lane, target);
  }

  private botTick(lane: Lane, dt: number): void {
    lane.botTimer += dt;
    if (lane.botTimer < 0.03) return;
    lane.botTimer = 0;

    const jetX = this.jetX(lane);
    const gateIndex = lane.pipes.findIndex((p) => p.x + GATE_WIDTH > jetX - JET_RADIUS);
    const nextGate = gateIndex >= 0 ? lane.pipes[gateIndex] : undefined;
    const after = gateIndex >= 0 ? lane.pipes[gateIndex + 1] : undefined;
    let targetY = this.ctx.height * 0.55;
    if (nextGate) {
      const { lo, hi } = safeBand(nextGate.gapY, nextGate.gapH);
      targetY = Math.min(hi, Math.max(lo, nextGate.gapY + 18));
      if (nextGate.bank) {
        const want = botWantsBank(lane.run, this.multOf(lane), lane.botNerve, MATCH_SECONDS - this.time);
        targetY = Math.min(hi, Math.max(lo, bankAim(nextGate.gapY, nextGate.gapH, nextGate.bank, want)));
      } else if (after) {
        // Lean toward the side of this gap that is closer to the gate after it.
        targetY = Math.min(hi, Math.max(lo, after.gapY + 18));
      } else {
        // Drift toward a coin or power-up when it's reachable inside that safe band.
        const item = lane.items.find((it) => !it.taken && it.x > jetX && it.x < nextGate.x + GATE_WIDTH);
        if (item) targetY = Math.min(hi, Math.max(lo, item.y + 18));
      }
      // Dodge an incoming thunderhead when it sits on the flight line.
      const hz = lane.hazards.find((h) => h.x > jetX - 10 && h.x < jetX + 260);
      if (hz && Math.abs(hz.y - targetY + 25) < HAZARD_RADIUS + JET_RADIUS + 30) {
        const up = hz.y > nextGate.gapY;
        targetY = Math.min(hi, Math.max(lo, hz.y + (up ? -80 : 80)));
      }
    }
    // Bots hesitate more as the speed climbs: a beat of not deciding, which near a gate edge is fatal.
    if (this.ctx.rng.next() < botSloppiness(this.paceSpeed)) {
      lane.botTimer = -this.ctx.rng.float(HESITATION_MIN, HESITATION_MAX);
      return;
    }
    // A flap always lifts ~57px, so only flap once we've dropped to the target; tap sooner on a steep climb,
    // but never when the lift would plant the jet into the roof or the top of the gate ahead.
    let ceiling = TOP_PAD;
    if (nextGate && nextGate.x - jetX < this.speed * 0.5 + JET_RADIUS) {
      ceiling = Math.max(ceiling, nextGate.gapY - nextGate.gapH / 2);
    }
    const drop = lane.bird.y - targetY;
    if (drop > 0 && lane.bird.vy > flapThreshold(drop) && flapClearsCeiling(lane.bird.y, ceiling)) this.flap(lane);
  }

  private flap(lane: Lane): void {
    if (lane.state !== "flying") return;
    lane.bird.vy = FLAP_VEL;
    lane.flapCount++;
    this.ctx.sfx.whoosh();
  }

  private finishMatch(reason: "time" | "survivor"): void {
    this.finished = true;
    this.finishTimer = 2.2;

    if (reason === "survivor") {
      const last = this.lanes.find((l) => l.state !== "out");
      if (last) {
        const bonus = last.run + SURVIVOR_BONUS;
        last.score += bonus;
        last.bestBank = Math.max(last.bestBank, last.run);
        last.run = 0;
        this.floater(this.jetX(last), last.bird.y - 34, `SURVIVOR +${bonus}`, GOLD, 26);
      }
      this.callouts.show(last ? "LAST JET FLYING" : "WIPEOUT!", last ? GOLD : PINK, { size: 44, life: 2, y: 0.2 });
    } else {
      this.callouts.show("TIME!", CYAN, { size: 48, life: 2, y: 0.2 });
      for (const lane of this.lanes) {
        if (lane.run > 0) {
          this.floater(this.jetX(lane), lane.bird.y - 34, `LOST ${lane.run}`, PINK, 26);
          lane.run = 0;
        }
      }
    }

    const sorted = [...this.lanes].sort(compareLanes);
    const top = sorted[0];
    const second = sorted[1];
    if (top && (!second || second.score < top.score)) {
      this.callouts.show(`${top.player.name} WINS!`, top.player.color, { size: 64, life: 2, y: 0.38 });
      this.juice.burst(top.x + top.width / 2, this.ctx.height * 0.4, [top.player.color, GOLD, "#ffffff"], {
        count: 50, speed: 320, gravity: 300, life: 0.9,
      });
      this.ctx.sfx.win();
    } else {
      this.callouts.show("DRAW!", "#F4F7FB", { size: 64, life: 2, y: 0.38 });
      this.ctx.sfx.miss();
    }

    let recordShown = false;
    for (const lane of this.lanes) {
      if (lane.player.kind !== "human" || lane.score <= 0) continue;
      if (saveBest(flappyRace.id, lane.score, BEST_VERSION) && !recordShown) {
        recordShown = true;
        this.callouts.show(`NEW RECORD ${lane.score}`, "#B8FF3D", { size: 40, life: 2.2, y: 0.56 });
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
    if (this.finished) return;
    const p = this.toLogical(e);
    for (const lane of this.lanes) {
      if (lane.player.kind !== "human") continue;
      if (p.x < lane.x || p.x >= lane.x + lane.width) continue;
      e.preventDefault();
      if (lane.state === "flying") {
        this.flap(lane);
      } else if (lane.state === "out") {
        for (const b of this.stormButtons(lane)) {
          if (p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h) {
            const target = this.lanes[b.target];
            if (target && !this.storm(lane, target)) this.ctx.sfx.tick();
            break;
          }
        }
      }
      return;
    }
  };

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);

    for (const lane of this.lanes) this.drawLane(g, lane);

    this.juice.end(g);

    this.drawClock(g, width);

    for (const f of this.floaters) {
      g.save();
      g.globalAlpha = Math.min(1, f.life / 0.3);
      g.font = `700 ${f.size}px Bebas Neue, Impact, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 5;
      g.strokeStyle = "rgba(7,11,20,0.8)";
      g.strokeText(f.text, f.x, f.y);
      g.fillStyle = f.color;
      g.fillText(f.text, f.x, f.y);
      g.restore();
    }

    this.callouts.draw(g, width, height);
  }

  private drawClock(g: CanvasRenderingContext2D, width: number): void {
    const left = Math.max(0, MATCH_SECONDS - this.time);
    const t = left / MATCH_SECONDS;
    g.fillStyle = "rgba(7,11,20,0.6)";
    g.fillRect(0, 0, width, 5);
    const flash = left < 10 && Math.floor(this.time * 4) % 2 === 0;
    g.fillStyle = this.overdrive ? (flash ? "#ffffff" : PINK) : CYAN;
    g.fillRect(0, 0, width * t, 5);
  }

  private drawLane(g: CanvasRenderingContext2D, lane: Lane): void {
    const { player, x: lx, width: lw } = lane;
    const ly = TOP_PAD;
    const h = this.ctx.height;
    const out = lane.state === "out";

    g.save();
    g.beginPath();
    g.rect(lx, 0, lw, h);
    g.clip();

    g.fillStyle = out ? "rgba(7,11,20,0.35)" : "rgba(244,247,251,0.015)";
    g.fillRect(lx, 0, lw, h);
    if (this.overdrive && !out) {
      g.fillStyle = `rgba(255,61,122,${0.04 + 0.03 * Math.sin(this.time * 6)})`;
      g.fillRect(lx, ly, lw, h - ly);
    }

    // Speed streaks: more visible as the race speeds up.
    if (!out) {
      const fast = Math.max(0, (this.paceSpeed - SPEED_START) / (SPEED_OVERDRIVE - SPEED_START));
      g.strokeStyle = `rgba(244,247,251,${0.04 + fast * 0.12})`;
      g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i < 7; i++) {
        const sy = ly + ((i * 97.3) % (h - ly));
        const sx = lx + lw - ((this.time * this.speed * (0.6 + (i % 3) * 0.2) + i * 173) % (lw + 80));
        g.moveTo(sx, sy);
        g.lineTo(sx + 30 + fast * 60, sy);
      }
      g.stroke();
    }

    g.strokeStyle = "rgba(244,247,251,0.06)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(lx + lw, 0);
    g.lineTo(lx + lw, h);
    g.stroke();

    // Neon gates: dark slabs with glowing rims on the gap. Split gates get a gold BANK half.
    const rim = out ? "#3a3a4a" : lane.ghost > 0 ? "rgba(201,184,255,0.5)" : this.overdrive ? "#FF5C9E" : NEON;
    const slab = out ? "#22222e" : this.overdrive ? "#2a1030" : "#1b1030";
    const mult = this.multOf(lane);
    for (const gate of lane.pipes) {
      const gapTop = gate.gapY - gate.gapH / 2;
      const gapBot = gate.gapY + gate.gapH / 2;

      g.fillStyle = slab;
      g.fillRect(gate.x, ly, GATE_WIDTH, gapTop - ly);
      g.fillRect(gate.x, gapBot, GATE_WIDTH, h - gapBot);

      g.fillStyle = rim;
      g.fillRect(gate.x, ly, 3, gapTop - ly);
      g.fillRect(gate.x, gapBot, 3, h - gapBot);
      g.globalAlpha = 0.25;
      g.fillRect(gate.x - 4, gapTop - 10, GATE_WIDTH + 8, 10);
      g.fillRect(gate.x - 4, gapBot, GATE_WIDTH + 8, 10);
      g.globalAlpha = 1;
      g.fillRect(gate.x - 2, gapTop - 4, GATE_WIDTH + 4, 4);
      g.fillRect(gate.x - 2, gapBot, GATE_WIDTH + 4, 4);

      if (gate.bank && !out) {
        const half = gate.gapH / 2;
        const goldY = gate.bank === "top" ? gapTop : gate.gapY;
        const rideY = gate.bank === "top" ? gate.gapY : gapTop;
        const pulse = 0.16 + 0.08 * Math.sin(this.time * 8 + gate.x * 0.02);
        g.fillStyle = `rgba(255,176,32,${pulse})`;
        g.fillRect(gate.x - 2, goldY, GATE_WIDTH + 4, half);
        g.fillStyle = GOLD;
        g.fillRect(gate.x - 2, gate.bank === "top" ? gapTop - 4 : gapBot, GATE_WIDTH + 4, 4);
        g.fillStyle = `rgba(180,92,255,0.12)`;
        g.fillRect(gate.x - 2, rideY, GATE_WIDTH + 4, half);
        g.setLineDash([6, 6]);
        g.strokeStyle = "rgba(255,176,32,0.7)";
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(gate.x - 2, gate.gapY);
        g.lineTo(gate.x + GATE_WIDTH + 2, gate.gapY);
        g.stroke();
        g.setLineDash([]);

        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = "700 20px Bebas Neue, Impact, sans-serif";
        g.fillStyle = GOLD;
        g.fillText("BANK", gate.x + GATE_WIDTH / 2, goldY + half / 2);
        g.font = "700 16px Bebas Neue, Impact, sans-serif";
        g.fillStyle = LILAC;
        g.fillText(`RIDE x${mult}`, gate.x + GATE_WIDTH / 2, rideY + half / 2);
      }
    }

    for (const item of lane.items) this.drawItem(g, item);
    for (const hz of lane.hazards) this.drawHazard(g, hz);

    const jetX = this.jetX(lane);
    if (lane.state === "flying") {
      this.drawJet(g, lane, jetX);
    } else if (lane.state === "respawning") {
      g.save();
      g.globalAlpha = 0.6 + 0.4 * Math.sin(this.time * 12);
      g.fillStyle = player.color;
      g.font = "700 26px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("RELAUNCH...", jetX, (h - ly) / 2 + ly);
      g.restore();
    } else {
      this.drawStormLane(g, lane);
    }

    this.drawHud(g, lane);
    g.restore();
  }

  private drawJet(g: CanvasRenderingContext2D, lane: Lane, jetX: number): void {
    const { player } = lane;
    const angle = Math.min(0.5, Math.max(-0.4, lane.bird.vy / 600));
    const r = JET_RADIUS;
    const mult = this.multOf(lane);
    g.save();
    g.translate(jetX, lane.bird.y);

    // Exhaust flame flickers behind the jet, longer with a bigger multiplier.
    const flame = 0.7 + 0.3 * Math.sin(this.time * 40);
    g.save();
    g.rotate(angle);
    g.beginPath();
    g.moveTo(-r * 0.7, -r * 0.25);
    g.lineTo(-r * (1.3 + flame * (0.6 + mult * 0.25)), 0);
    g.lineTo(-r * 0.7, r * 0.25);
    g.closePath();
    g.fillStyle = mult >= 4 ? "#ffffff" : GOLD;
    g.fill();

    if (lane.ghost > 0) {
      g.globalAlpha = lane.ghost < 0.8 && Math.floor(this.time * 12) % 2 === 0 ? 0.2 : 0.45;
    } else if (lane.grace > 0 && Math.floor(this.time * 14) % 2 === 0) {
      g.globalAlpha = 0.4;
    }

    // Dart-shaped jet body.
    g.beginPath();
    g.moveTo(r * 1.15, 0);
    g.lineTo(-r * 0.8, -r * 0.85);
    g.lineTo(-r * 0.45, 0);
    g.lineTo(-r * 0.8, r * 0.85);
    g.closePath();
    g.fillStyle = player.color;
    g.fill();
    g.beginPath();
    g.moveTo(r * 1.15, 0);
    g.lineTo(-r * 0.45, 0);
    g.lineTo(-r * 0.8, r * 0.85);
    g.closePath();
    g.fillStyle = "rgba(7,11,20,0.25)";
    g.fill();
    g.beginPath();
    g.arc(r * 0.25, -r * 0.12, r * 0.18, 0, Math.PI * 2);
    g.fillStyle = "rgba(255,255,255,0.8)";
    g.fill();
    g.restore();

    if (lane.shield) {
      g.beginPath();
      g.arc(0, 0, r + 7, 0, Math.PI * 2);
      g.strokeStyle = CYAN;
      g.lineWidth = 3;
      g.globalAlpha = 0.6 + 0.3 * Math.sin(this.time * 6);
      g.stroke();
      g.globalAlpha = 1;
    }

    // Unbanked run rides along under the jet so the stake is always in view.
    if (lane.run > 0) {
      g.font = "700 16px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "top";
      g.lineWidth = 4;
      g.strokeStyle = "rgba(7,11,20,0.8)";
      const label = `${lane.run} x${mult}`;
      g.strokeText(label, 0, r + 4);
      g.fillStyle = GOLD;
      g.fillText(label, 0, r + 4);
    }
    g.restore();
  }

  private drawStormLane(g: CanvasRenderingContext2D, lane: Lane): void {
    const { player, x: lx, width: lw } = lane;
    const h = this.ctx.height;
    const cx = lx + lw / 2;
    const cy = h * 0.3;
    const ready = lane.stormCooldown <= 0;
    const bob = Math.sin(this.time * 2) * 4;

    // Thundercloud in the player's colour.
    g.save();
    g.translate(cx, cy + bob);
    const puff = (x: number, y: number, r: number): void => {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    };
    g.fillStyle = "#2a2440";
    puff(-30, 6, 22);
    puff(0, -6, 30);
    puff(32, 8, 22);
    puff(0, 14, 26);
    g.globalAlpha = lane.stormFlash > 0 ? 1 : ready ? 0.9 : 0.4;
    g.strokeStyle = player.color;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(-30, 6, 22, Math.PI * 0.6, Math.PI * 1.5);
    g.arc(0, -6, 30, Math.PI * 1.1, Math.PI * 1.9);
    g.arc(32, 8, 22, Math.PI * 1.5, Math.PI * 0.45);
    g.stroke();
    // Lightning bolt below the cloud.
    g.fillStyle = ready || lane.stormFlash > 0 ? GOLD : "rgba(255,176,32,0.3)";
    g.beginPath();
    g.moveTo(4, 26);
    g.lineTo(-8, 48);
    g.lineTo(2, 48);
    g.lineTo(-6, 70);
    g.lineTo(12, 44);
    g.lineTo(2, 44);
    g.lineTo(10, 26);
    g.closePath();
    g.fill();
    g.restore();

    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "700 26px Bebas Neue, Impact, sans-serif";
    g.fillStyle = player.color;
    g.fillText("STORM CLOUD", cx, cy + 92);
    g.font = "700 16px Bebas Neue, Impact, sans-serif";
    g.fillStyle = "rgba(244,247,251,0.7)";
    g.fillText(ready ? "TAP A RIVAL TO DROP A THUNDERHEAD" : "RECHARGING...", cx, cy + 114);

    // Cooldown bar.
    const bw = Math.min(lw - 60, 160);
    g.fillStyle = "rgba(244,247,251,0.12)";
    g.fillRect(cx - bw / 2, cy + 128, bw, 6);
    g.fillStyle = ready ? GOLD : player.color;
    g.fillRect(cx - bw / 2, cy + 128, bw * (1 - lane.stormCooldown / STORM_COOLDOWN), 6);

    for (const b of this.stormButtons(lane)) {
      const target = this.lanes[b.target];
      if (!target) continue;
      g.save();
      g.globalAlpha = ready ? 1 : 0.45;
      g.fillStyle = "rgba(7,11,20,0.7)";
      g.beginPath();
      g.roundRect(b.x, b.y, b.w, b.h, 12);
      g.fill();
      g.strokeStyle = target.player.color;
      g.lineWidth = 3;
      g.stroke();
      g.fillStyle = target.player.color;
      g.font = "700 24px Bebas Neue, Impact, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(`STORM ${target.player.name.toUpperCase()}`, b.x + b.w / 2, b.y + b.h / 2 + 1);
      g.restore();
    }
  }

  private drawHud(g: CanvasRenderingContext2D, lane: Lane): void {
    const { player, x: lx, width: lw } = lane;
    const out = lane.state === "out";
    const mult = this.multOf(lane);

    g.fillStyle = "rgba(7,11,20,0.45)";
    g.fillRect(lx, 5, lw, TOP_PAD - 5);

    g.textAlign = "center";
    g.textBaseline = "top";
    g.fillStyle = out ? "rgba(244,247,251,0.5)" : player.color;
    g.font = "700 20px Bebas Neue, Impact, sans-serif";
    g.fillText(player.name, lx + lw / 2, 8);
    g.fillStyle = out ? "rgba(244,247,251,0.6)" : "#F4F7FB";
    g.font = "700 30px Bebas Neue, Impact, sans-serif";
    g.fillText(String(lane.score), lx + lw / 2, 26);

    // Lives: little jets at the left.
    for (let i = 0; i < LIVES; i++) {
      const alive = i < lane.lives;
      const x = lx + 16 + i * 20;
      const y = 20;
      g.beginPath();
      g.moveTo(x + 8, y);
      g.lineTo(x - 6, y - 6);
      g.lineTo(x - 3, y);
      g.lineTo(x - 6, y + 6);
      g.closePath();
      if (alive) {
        g.fillStyle = player.color;
        g.fill();
      } else {
        g.strokeStyle = "rgba(244,247,251,0.25)";
        g.lineWidth = 1.5;
        g.stroke();
      }
    }
    if (lane.underdog && !out) {
      g.textAlign = "left";
      g.fillStyle = "#B8FF3D";
      g.font = "700 13px Bebas Neue, Impact, sans-serif";
      g.fillText("UNDERDOG +1x", lx + 10, 34);
    }

    // Run and multiplier at the right.
    if (!out) {
      g.textAlign = "right";
      g.textBaseline = "top";
      g.font = "700 15px Bebas Neue, Impact, sans-serif";
      g.fillStyle = lane.run > 0 ? GOLD : "rgba(244,247,251,0.35)";
      g.fillText(`RUN ${lane.run}`, lx + lw - 10, 8);
      g.font = "700 24px Bebas Neue, Impact, sans-serif";
      g.fillStyle = mult >= 4 ? "#ffffff" : mult >= 2 ? GOLD : "rgba(244,247,251,0.5)";
      g.fillText(`x${mult}`, lx + lw - 10, 24);
      const pips = multPips(lane.streak);
      for (let i = 0; i < MULT_STEP; i++) {
        g.fillStyle = i < pips ? GOLD : "rgba(244,247,251,0.18)";
        g.fillRect(lx + lw - 10 - (MULT_STEP - i) * 12, 52, 9, 4);
      }
    } else {
      g.textAlign = "right";
      g.font = "700 15px Bebas Neue, Impact, sans-serif";
      g.fillStyle = "rgba(244,247,251,0.5)";
      g.fillText(`HITS ${lane.stormHits}`, lx + lw - 10, 8);
    }
  }

  private drawHazard(g: CanvasRenderingContext2D, hz: Hazard): void {
    const owner = this.lanes[hz.owner];
    const color = owner ? owner.player.color : PINK;
    g.save();
    g.translate(hz.x, hz.y);
    g.rotate(Math.sin(hz.spin) * 0.15);
    g.fillStyle = "#2a2440";
    g.beginPath();
    g.arc(-11, 2, 11, 0, Math.PI * 2);
    g.arc(0, -6, 15, 0, Math.PI * 2);
    g.arc(12, 3, 11, 0, Math.PI * 2);
    g.arc(0, 8, 13, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = color;
    g.lineWidth = 2.5;
    g.globalAlpha = 0.8 + 0.2 * Math.sin(this.time * 16);
    g.beginPath();
    g.arc(0, 0, HAZARD_RADIUS, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = GOLD;
    g.beginPath();
    g.moveTo(2, -8);
    g.lineTo(-5, 2);
    g.lineTo(1, 2);
    g.lineTo(-3, 12);
    g.lineTo(6, 0);
    g.lineTo(0, 0);
    g.lineTo(5, -8);
    g.closePath();
    g.fill();
    g.restore();
  }

  private drawItem(g: CanvasRenderingContext2D, item: Item): void {
    if (item.taken) return;
    const bob = Math.sin(this.time * 5 + item.x * 0.05) * 3;
    const y = item.y + bob;
    if (item.kind === "coin") {
      const squash = Math.abs(Math.cos(this.time * 4 + item.x * 0.03));
      g.beginPath();
      g.ellipse(item.x, y, COIN_RADIUS * (0.35 + 0.65 * squash), COIN_RADIUS, 0, 0, Math.PI * 2);
      g.fillStyle = GOLD;
      g.fill();
      g.strokeStyle = "#FFE38A";
      g.lineWidth = 2;
      g.stroke();
      return;
    }
    const color = item.kind === "shield" ? CYAN : LILAC;
    g.beginPath();
    g.arc(item.x, y, PICKUP_RADIUS, 0, Math.PI * 2);
    g.fillStyle = "rgba(7,11,20,0.7)";
    g.fill();
    g.strokeStyle = color;
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = color;
    g.font = "700 18px Bebas Neue, Impact, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(item.kind === "shield" ? "S" : "G", item.x, y + 1);
  }

  isFinished(): boolean {
    return this.finished && this.finishTimer <= 0;
  }

  getScores(): { playerId: string; score: number }[] {
    return [...this.lanes]
      .sort(compareLanes)
      .map((lane) => ({ playerId: lane.player.id, score: lane.score }));
  }

  getStats(): GameStat[] {
    const out: GameStat[] = [];
    const stormed = this.lanes.some((l) => l.stormHits > 0);
    for (const lane of this.lanes) {
      out.push({ playerId: lane.player.id, label: "Best bank", value: String(lane.bestBank) });
      out.push({ playerId: lane.player.id, label: "Gates cleared", value: String(lane.gates) });
      out.push({ playerId: lane.player.id, label: "Skims", value: String(lane.skims) });
      if (stormed) out.push({ playerId: lane.player.id, label: "Storm hits", value: String(lane.stormHits) });
      else out.push({ playerId: lane.player.id, label: "Crashes", value: String(lane.crashes) });
    }
    return out;
  }

  destroy(): void {
    this.ctx.canvas.removeEventListener("pointerdown", this.onDown);
  }
}

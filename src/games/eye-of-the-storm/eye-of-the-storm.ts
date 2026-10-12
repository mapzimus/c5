import { fillArena } from "../../core/draw";
import { Callouts, Juice, loadBest, saveBest } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import { PUCK_RADIUS, applyBlast, isResting, previewPath, stepWorld, type Puck, type World } from "./physics";
import {
  BOLTS_PER_VOLLEY,
  BOLT_COOLDOWN_S,
  BOLT_RADIUS,
  BOLT_POWER,
  BOLT_TELEGRAPH_S,
  CELL_EVERY_S,
  CELL_RADIUS,
  HEAVY_LAUNCH,
  HEAVY_MASS,
  HEAVY_PER_VOLLEY,
  HEAVY_RADIUS,
  LAST_STRIKES_S,
  MAX_PULL,
  PAD_RADIUS,
  PUCKS_EACH,
  RELOAD_S,
  RINGS,
  VOLLEY_S,
  boltTargetFromDrag,
  botAimAround,
  botBoltTarget,
  botPickShot,
  isNearMiss,
  isTap,
  launchVelocity,
  padPositions,
  placeCell,
  ringPoints,
  scatterPegs,
  scoreBoard,
  streakLabel,
  touchesCell,
  underdogs,
  type Point,
  type BonusCell,
} from "./rules";

export const eyeOfTheStorm: GameDefinition = {
  id: "eye-of-the-storm",
  name: "Stormbolt",
  tagline: "Slingshot into the eye. Out of pucks? Call the lightning.",
  description:
    "Everyone fires at once from their own corner. Three volleys, Calm, Gale and Tempest, each banking your " +
    "points: centre 10, middle 5, outer 2. Tap your pad to load a HEAVY puck (two per volley) that bowls rivals " +
    "out of the eye and shrugs off the storm. Spend all your pucks and your pad turns into a storm cloud: drag " +
    "anywhere and let go to call LIGHTNING that blasts every puck near the strike. The vortex bends shots and " +
    "flips direction (watch for the amber warning), whoever trails gets an underdog puck, and a golden target " +
    "drifts through the Tempest worth 20.",
  durationMs: 0,
  controls: "Drag back from your pad to fire, tap to toggle heavy, drag out to call lightning when empty",
  create: (ctx) => new EyeOfTheStorm(ctx),
};

interface Seat {
  player: Player;
  pad: Point;
  left: number;
  heavyLeft: number;
  heavyNext: boolean;
  reload: number;
  botWait: number;
  /** Where the active finger/mouse is while aiming. */
  aim: Point | null;
  aimStart: Point | null;
  aimDownAt: number;
  bolts: number;
  boltCooldown: number;
  botBoltWait: number;
  streak: number;
  bestStreak: number;
}

interface Bolt {
  x: number;
  y: number;
  caller: string;
  fuse: number;
}

interface Strike {
  points: Point[];
  life: number;
  color: string;
}

interface Scorch {
  x: number;
  y: number;
  life: number;
  color: string;
}

const SETTLE_GRACE_S = 0.8;
const SHIFT_WARN_S = 1.2;
const STRIKE_LIFE_S = 0.32;
const SCORCH_LIFE_S = 1.6;
const FONT = "Bebas Neue, Impact, sans-serif";
const BEST_VERSION = "v4-bolt";
const TAUNTS = ["boom.", "oops!", "bye bye", "was that yours?", "thanks for the spot", "nothing personal"] as const;

interface VolleyCondition {
  name: string;
  tagline: string;
  color: string;
  swirlMul: number;
  pegCount: number;
  cellInterval: readonly [number, number];
  swirlFlipRange: readonly [number, number];
  goldenTarget: boolean;
}

const VOLLEY_CONDITIONS: readonly VolleyCondition[] = [
  { name: "CALM", tagline: "Light breeze", color: "#60a5fa", swirlMul: 0.5, pegCount: 6, cellInterval: CELL_EVERY_S, swirlFlipRange: [5, 10], goldenTarget: false },
  { name: "GALE", tagline: "Strong winds", color: "#FFB020", swirlMul: 1.5, pegCount: 12, cellInterval: [3, 6], swirlFlipRange: [3, 6], goldenTarget: false },
  { name: "TEMPEST", tagline: "All hell breaks loose", color: "#ef4444", swirlMul: 1.8, pegCount: 15, cellInterval: [2, 4], swirlFlipRange: [1.5, 3.5], goldenTarget: true },
];

interface GoldenTarget {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const GOLDEN_RADIUS = 36;
const GOLDEN_POINTS = 20;
const GOLDEN_SPEED = 40;

class EyeOfTheStorm implements GameInstance {
  private readonly world: World;
  private readonly seats: Seat[];
  private readonly center: Point;
  /** pointerId -> seat index, so several fingers can aim at once. */
  private readonly grabs = new Map<number, number>();
  private nextId = 1;
  private swirlTimer: number;
  private flash = 0;
  private whiteFlash = 0;
  private settled = 0;
  private allOutFor = 0;
  private volley = 1;
  private volleyTime = 0;
  private intermission = 0;
  private timeUpShown = false;
  private readonly bank = new Map<string, number>();
  private time = 0;
  private scores = new Map<string, number>();
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private cell: BonusCell | null = null;
  private cellTimer: number;
  /** puck id -> who last hit it and when, to credit knockouts and zaps. */
  private readonly lastHit = new Map<number, { owner: string; at: number; bolt: boolean }>();
  private readonly lastPoints = new Map<number, number>();
  private readonly bullseyes = new Set<number>();
  private readonly judged = new Set<number>();
  private readonly best = loadBest("eye-of-the-storm", BEST_VERSION);
  private newBestShown = false;
  private readonly koCount = new Map<string, number>();
  private readonly zapCount = new Map<string, number>();
  private readonly bullseyeCount = new Map<string, number>();
  private readonly bonusPucks = new Map<string, number>();
  private golden: GoldenTarget | null = null;
  private readonly goldenScored = new Set<number>();
  private readonly goldenPoints = new Map<string, number>();
  private readonly goldenHitCount = new Map<string, number>();
  private readonly bolts: Bolt[] = [];
  private readonly strikes: Strike[] = [];
  private lastMainShout = -10;
  private lastTaunt = -10;
  private mainLane = 0;
  private lastLowShout = -10;
  private readonly scorches: Scorch[] = [];

  constructor(private readonly ctx: GameContext) {
    const { width, height, rng } = ctx;
    this.center = { x: width / 2, y: height / 2 };
    const pads = padPositions(width, height);
    this.seats = ctx.players.map((player, i) => ({
      player,
      pad: pads[i % pads.length]!,
      left: PUCKS_EACH,
      heavyLeft: HEAVY_PER_VOLLEY,
      heavyNext: false,
      reload: 0,
      botWait: rng.float(1, 2.5),
      aim: null,
      aimStart: null,
      aimDownAt: 0,
      bolts: BOLTS_PER_VOLLEY,
      boltCooldown: 0,
      botBoltWait: rng.float(0.8, 2),
      streak: 0,
      bestStreak: 0,
    }));
    const vc = VOLLEY_CONDITIONS[0]!;
    this.world = {
      width,
      height,
      pucks: [],
      pegs: scatterPegs(rng, width, height, pads, vc.pegCount),
      swirl: { ...this.center, radius: 300, spin: rng.sign() * rng.float(1.2, 2) * vc.swirlMul },
    };
    this.swirlTimer = rng.float(vc.swirlFlipRange[0], vc.swirlFlipRange[1]);
    this.juice = new Juice(() => rng.next());
    this.cellTimer = rng.float(vc.cellInterval[0], vc.cellInterval[1]);

    const canvas = ctx.canvas;
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onCancel);
    this.callouts.show("VOLLEY 1: CALM", vc.color);
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += dt;
    this.whiteFlash = Math.max(0, this.whiteFlash - realDt);
    for (const s of this.strikes) s.life -= realDt;
    this.strikes.splice(0, this.strikes.length, ...this.strikes.filter((s) => s.life > 0));
    for (const s of this.scorches) s.life -= realDt;
    this.scorches.splice(0, this.scorches.length, ...this.scorches.filter((s) => s.life > 0));
    if (this.intermission > 0) {
      this.intermission -= realDt;
      if (this.intermission <= 0) this.startVolley(this.volley + 1);
      return;
    }
    this.volleyTime += dt;
    if (this.volleyTime >= VOLLEY_S) {
      const forfeited = this.seats.some((s) => s.left > 0);
      for (const seat of this.seats) seat.left = 0;
      if (forfeited && !this.timeUpShown) {
        this.timeUpShown = true;
        this.shout("OUT OF TIME", "#F4F7FB", { size: 48 });
        this.ctx.sfx.miss();
      }
    }
    this.flash = Math.max(0, this.flash - dt);

    this.swirlTimer -= dt;
    if (this.swirlTimer <= 0) {
      const { rng } = this.ctx;
      const vc = VOLLEY_CONDITIONS[this.volley - 1]!;
      this.world.swirl.spin = -Math.sign(this.world.swirl.spin) * rng.float(1.2, 2.2) * vc.swirlMul;
      this.swirlTimer = rng.float(vc.swirlFlipRange[0], vc.swirlFlipRange[1]);
      this.flash = 0.5;
      this.ctx.sfx.countdown();
    }

    const allOut = this.seats.every((s) => s.left === 0);
    this.allOutFor = allOut ? this.allOutFor + dt : 0;
    const canBolt = this.allOutFor < LAST_STRIKES_S;

    for (const seat of this.seats) {
      seat.reload = Math.max(0, seat.reload - dt);
      seat.boltCooldown = Math.max(0, seat.boltCooldown - dt);
      if (seat.player.kind !== "bot") continue;
      if (seat.left > 0 && seat.reload === 0) {
        seat.botWait -= dt;
        // Bots that notice the wind about to shift hold their shot a beat.
        if (seat.botWait <= 0 && this.swirlTimer < SHIFT_WARN_S && this.ctx.rng.next() < 0.5) seat.botWait = this.swirlTimer + 0.2;
        if (seat.botWait <= 0) {
          const plan = botPickShot(this.ctx.rng, this.world.pucks, seat.player.id, this.center, seat.heavyLeft, this.golden);
          seat.heavyNext = plan.heavy && seat.heavyLeft > 0;
          this.fire(seat, botAimAround(this.ctx.rng, this.world, seat.pad, plan.target, this.center));
          seat.botWait = this.ctx.rng.float(0.7, 2.0);
        }
      } else if (seat.left === 0 && canBolt && seat.bolts > 0 && seat.boltCooldown === 0) {
        seat.botBoltWait -= dt;
        if (seat.botBoltWait <= 0) {
          const target = botBoltTarget(this.ctx.rng, this.world.pucks, seat.player.id, this.center);
          if (target) {
            this.callBolt(seat, target);
            seat.botBoltWait = this.ctx.rng.float(0.8, 2.2);
          } else {
            seat.botBoltWait = 0.5;
          }
        }
      }
    }

    const events = stepWorld(this.world, dt, () => this.ctx.rng.float(-1, 1));
    if (events.puckHits > 0) this.ctx.sfx.hit();
    else if (events.pegHits > 0) this.ctx.sfx.tick();
    for (const { a, b, speed } of events.contacts) {
      const heavy = a.mass > 1 || b.mass > 1;
      this.juice.shake(Math.min(0.5, (speed / 2600) * (heavy ? 1.6 : 1)));
      if (heavy && speed > 500) this.juice.hitStop(0.04);
      this.juice.burst((a.x + b.x) / 2, (a.y + b.y) / 2, [this.colorOf(a.owner), this.colorOf(b.owner)], {
        count: Math.min(28, 6 + Math.round(speed / 80)),
        speed: 120 + speed * 0.25,
        gravity: 0,
        life: 0.45,
      });
      if (a.owner !== b.owner) {
        this.lastHit.set(a.id, { owner: b.owner, at: this.time, bolt: false });
        this.lastHit.set(b.id, { owner: a.owner, at: this.time, bolt: false });
      }
    }
    this.updateBolts(dt);
    this.updateMoments();
    this.updateCell(dt);
    this.updateGolden(dt);

    this.scores = scoreBoard(
      this.world.pucks,
      this.seats.map((s) => s.player.id),
      this.center,
    );
    if (this.golden) {
      for (const puck of this.world.pucks) {
        if (isResting(puck) && !this.goldenScored.has(puck.id) &&
            Math.hypot(puck.x - this.golden.x, puck.y - this.golden.y) < GOLDEN_RADIUS + puck.r) {
          this.goldenScored.add(puck.id);
          this.goldenPoints.set(puck.owner, (this.goldenPoints.get(puck.owner) ?? 0) + GOLDEN_POINTS);
          this.goldenHitCount.set(puck.owner, (this.goldenHitCount.get(puck.owner) ?? 0) + 1);
          this.shout(`GOLDEN! +${GOLDEN_POINTS}`, "#FFD700", { size: 56 });
          this.juice.burst(this.golden.x, this.golden.y, ["#FFD700", "#FFA500", this.colorOf(puck.owner)], { count: 40, speed: 400, gravity: 0 });
          this.juice.shake(0.3);
          this.ctx.sfx.collect();
        }
      }
    }
    for (const [id, pts] of this.goldenPoints) this.scores.set(id, (this.scores.get(id) ?? 0) + pts);
    for (const seat of this.seats) this.scores.set(seat.player.id, (this.scores.get(seat.player.id) ?? 0) + (this.bank.get(seat.player.id) ?? 0));
    const humanTop = this.humanTop();
    if (!this.newBestShown && this.best > 0 && humanTop > this.best) {
      this.newBestShown = true;
      this.shout("NEW RECORD!", "#B8FF3D", { size: 56, lane: "top" });
      this.ctx.sfx.win();
    }

    const still = this.world.pucks.every(isResting) && this.bolts.length === 0;
    const overrun = this.volleyTime >= VOLLEY_S + 8;
    this.settled = allOut && this.allOutFor >= LAST_STRIKES_S && (still || overrun) ? this.settled + dt : 0;
    if (this.settled >= SETTLE_GRACE_S && this.volley < 3) {
      for (const seat of this.seats) this.bank.set(seat.player.id, this.scores.get(seat.player.id) ?? 0);
      this.intermission = 1.4;
      this.grabs.clear();
      for (const seat of this.seats) { seat.aim = null; seat.aimStart = null; }
      this.shout("POINTS BANKED!", "#B8FF3D");
      this.ctx.sfx.collect();
    }
  }

  private startVolley(n: number): void {
    this.volley = n;
    const vc = VOLLEY_CONDITIONS[this.volley - 1]!;
    const { rng, width, height } = this.ctx;
    this.volleyTime = 0;
    this.timeUpShown = false;
    this.world.pucks.length = 0;
    this.lastHit.clear();
    this.lastPoints.clear();
    this.bullseyes.clear();
    this.judged.clear();
    this.bolts.length = 0;
    this.cell = null;
    this.settled = 0;
    this.allOutFor = 0;
    this.goldenScored.clear();
    this.goldenPoints.clear();
    const pads = padPositions(width, height);
    this.world.pegs = scatterPegs(rng, width, height, pads, vc.pegCount);
    this.world.swirl.spin = rng.sign() * rng.float(1.2, 2) * vc.swirlMul;
    this.swirlTimer = rng.float(vc.swirlFlipRange[0], vc.swirlFlipRange[1]);
    this.cellTimer = rng.float(vc.cellInterval[0], vc.cellInterval[1]);
    if (vc.goldenTarget) {
      const angle = rng.float(0, Math.PI * 2);
      this.golden = {
        x: this.center.x + rng.float(-100, 100),
        y: this.center.y + rng.float(-80, 80),
        vx: Math.cos(angle) * GOLDEN_SPEED,
        vy: Math.sin(angle) * GOLDEN_SPEED,
      };
    } else {
      this.golden = null;
    }
    for (const seat of this.seats) {
      seat.left = PUCKS_EACH;
      seat.heavyLeft = HEAVY_PER_VOLLEY;
      seat.heavyNext = false;
      seat.reload = 0;
      seat.aim = null;
      seat.aimStart = null;
      seat.bolts = BOLTS_PER_VOLLEY;
      seat.boltCooldown = 0;
      seat.botWait = rng.float(0.8, 2.2);
      seat.botBoltWait = rng.float(0.8, 2);
    }
    const label = this.volley === 3 ? `FINAL VOLLEY: ${vc.name}` : `VOLLEY ${this.volley}: ${vc.name}`;
    this.shout(label, vc.color, { size: 56 });
    const trailing = underdogs(this.bank, this.seats.map((s) => s.player.id));
    if (trailing.length > 0 && trailing.length < this.seats.length) {
      for (const seat of this.seats) if (trailing.includes(seat.player.id)) seat.left += 1;
      const names = trailing.map((id) => this.nameOf(id)).join(" & ");
      this.shout(`UNDERDOG ${names}: +1 PUCK`, this.colorOf(trailing[0]!), { size: 40, life: 1.8, lane: "low" });
    }
  }

  isFinished(): boolean {
    return this.volley === 3 && this.settled >= SETTLE_GRACE_S;
  }

  private humanTop(): number {
    return Math.max(0, ...this.seats.filter((s) => s.player.kind === "human").map((s) => this.scores.get(s.player.id) ?? 0));
  }

  getScores(): { playerId: string; score: number }[] {
    saveBest("eye-of-the-storm", this.humanTop(), BEST_VERSION);
    return this.seats.map((s) => ({ playerId: s.player.id, score: this.scores.get(s.player.id) ?? 0 }));
  }

  getStats(): GameStat[] {
    const stats: GameStat[] = [];
    for (const s of this.seats) {
      const id = s.player.id;
      const kos = this.koCount.get(id) ?? 0;
      const zaps = this.zapCount.get(id) ?? 0;
      const bulls = this.bullseyeCount.get(id) ?? 0;
      const bonus = this.bonusPucks.get(id) ?? 0;
      if (bulls > 0) stats.push({ playerId: id, label: "Bullseyes", value: String(bulls) });
      if (s.bestStreak >= 3) stats.push({ playerId: id, label: "Streak", value: String(s.bestStreak) });
      if (kos > 0) stats.push({ playerId: id, label: "Knockouts", value: String(kos) });
      if (zaps > 0) stats.push({ playerId: id, label: "Zaps", value: String(zaps) });
      const gold = this.goldenHitCount.get(id) ?? 0;
      if (gold > 0) stats.push({ playerId: id, label: "Golden", value: String(gold) });
      if (bonus > 0 && kos + zaps + gold === 0) stats.push({ playerId: id, label: "Bonus pucks", value: String(bonus) });
    }
    return stats;
  }

  destroy(): void {
    const canvas = this.ctx.canvas;
    canvas.removeEventListener("pointerdown", this.onDown);
    canvas.removeEventListener("pointermove", this.onMove);
    canvas.removeEventListener("pointerup", this.onUp);
    canvas.removeEventListener("pointercancel", this.onCancel);
  }

  /**
   * Centre-screen shouts stack badly when two land in the same beat (a knockout right after a
   * bullseye), so the main lane alternates between two heights.
   */
  private shout(text: string, color: string, options: { size?: number; life?: number; lane?: "main" | "low" | "top" } = {}): void {
    const lane = options.lane ?? "main";
    let y = lane === "top" ? 0.2 : lane === "low" ? 0.66 : 0.3;
    if (lane === "main") {
      const heights = [0.3, 0.44, 0.16];
      this.mainLane = this.time - this.lastMainShout < 0.8 ? (this.mainLane + 1) % heights.length : 0;
      y = heights[this.mainLane]!;
      this.lastMainShout = this.time;
    } else if (lane === "low") {
      if (this.time - this.lastLowShout < 0.8) y = 0.74;
      this.lastLowShout = this.time;
    }
    this.callouts.show(text, color, { y, size: options.size ?? 64, life: options.life ?? 1.2 });
  }

  private taunt(seat: Seat): void {
    if (seat.player.kind !== "bot" || this.time - this.lastTaunt < 2 || this.ctx.rng.next() > 0.4) return;
    this.lastTaunt = this.time;
    const line = this.ctx.rng.pick(TAUNTS);
    this.callouts.show(`${seat.player.name}: ${line}`, seat.player.color, { y: 0.78, size: 30, life: 1.3 });
  }

  private colorOf(owner: string): string {
    return this.seats.find((s) => s.player.id === owner)?.player.color ?? "#ffffff";
  }

  private nameOf(owner: string): string {
    return this.seats.find((s) => s.player.id === owner)?.player.name ?? "";
  }

  /** Knockouts, zaps, bullseyes, streaks and near misses: the moments worth shouting about. */
  private updateMoments(): void {
    // One bolt or one heavy can clear several pucks in the same frame: shout once, with a count.
    const knocked = new Map<string, { bolt: boolean; count: number }>();
    for (const puck of this.world.pucks) {
      const points = ringPoints(puck.x, puck.y, this.center);
      const before = this.lastPoints.get(puck.id) ?? 0;
      this.lastPoints.set(puck.id, points);
      const hit = this.lastHit.get(puck.id);
      if (points < before && hit && this.time - hit.at < 1.5) {
        this.lastHit.delete(puck.id);
        const key = `${hit.owner}|${hit.bolt ? "z" : "k"}`;
        const entry = knocked.get(key) ?? { bolt: hit.bolt, count: 0 };
        entry.count += 1;
        knocked.set(key, entry);
        if (hit.bolt) this.zapCount.set(hit.owner, (this.zapCount.get(hit.owner) ?? 0) + 1);
        else this.koCount.set(hit.owner, (this.koCount.get(hit.owner) ?? 0) + 1);
        this.juice.shake(0.35);
        this.juice.burst(puck.x, puck.y, this.colorOf(hit.owner), { count: 30, speed: 380, gravity: 0 });
      }
      const resting = isResting(puck);
      const seat = this.seats.find((s) => s.player.id === puck.owner);
      if (points === RINGS[0].points && resting) {
        if (!this.bullseyes.has(puck.id)) {
          this.bullseyes.add(puck.id);
          this.bullseyeCount.set(puck.owner, (this.bullseyeCount.get(puck.owner) ?? 0) + 1);
          let label = "BULLSEYE";
          if (seat && !this.judged.has(puck.id)) {
            seat.streak += 1;
            seat.bestStreak = Math.max(seat.bestStreak, seat.streak);
            label = streakLabel(seat.streak) || label;
          }
          this.judged.add(puck.id);
          this.shout(label, this.colorOf(puck.owner), { size: 72 });
          this.juice.burst(puck.x, puck.y, [this.colorOf(puck.owner), "#FFB020", "#ffffff"], { count: 40, speed: 420, gravity: 0 });
          this.juice.shake(0.25);
          this.ctx.sfx.collect();
          if (seat && seat.streak >= 2) this.ctx.sfx.streak(seat.streak);
        }
      } else if (points !== RINGS[0].points) {
        this.bullseyes.delete(puck.id);
      }
      // First time a puck comes to rest decides the streak and the near-miss shout.
      if (resting && !this.judged.has(puck.id)) {
        this.judged.add(puck.id);
        if (seat) seat.streak = 0;
        if (isNearMiss(puck.x, puck.y, this.center)) {
          this.shout("SO CLOSE!", this.colorOf(puck.owner), { size: 44, life: 0.9, lane: "low" });
          this.ctx.sfx.miss();
        }
      }
    }
    for (const [key, { bolt, count }] of knocked) {
      const owner = key.slice(0, key.indexOf("|"));
      const word = bolt ? "ZAPPED" : "KNOCKOUT";
      this.shout(`${word}${count > 1 ? ` x${count}` : ""}! ${this.nameOf(owner)}`, this.colorOf(owner));
      const hitter = this.seats.find((s) => s.player.id === owner);
      if (hitter) this.taunt(hitter);
      this.ctx.sfx.streak(4);
    }
  }

  /** Bonus cells: shoot a puck through one for an extra puck. */
  private updateCell(dt: number): void {
    if (this.cell) {
      this.cell.life -= dt;
      const puck = this.world.pucks.find((p) => !isResting(p) && touchesCell(this.cell!, p));
      if (puck) {
        const seat = this.seats.find((s) => s.player.id === puck.owner);
        if (seat) seat.left += 1;
        this.bonusPucks.set(puck.owner, (this.bonusPucks.get(puck.owner) ?? 0) + 1);
        this.shout(`+1 PUCK ${this.nameOf(puck.owner)}`, this.colorOf(puck.owner), { size: 48, lane: "low" });
        this.juice.burst(this.cell.x, this.cell.y, ["#9ad9ff", "#ffffff", this.colorOf(puck.owner)], { count: 36, speed: 360, gravity: 0 });
        this.ctx.sfx.streak(3);
        this.cell = null;
      } else if (this.cell.life <= 0) {
        this.cell = null;
      }
      return;
    }
    // No new cells once everyone is out of pucks, so the round can end.
    if (this.seats.every((s) => s.left === 0)) return;
    this.cellTimer -= dt;
    if (this.cellTimer <= 0) {
      const { rng, width, height } = this.ctx;
      this.cell = placeCell(rng, width, height, this.seats.map((s) => s.pad), this.world.pegs);
      const vc = VOLLEY_CONDITIONS[this.volley - 1]!;
      this.cellTimer = rng.float(vc.cellInterval[0], vc.cellInterval[1]);
    }
  }

  private updateGolden(dt: number): void {
    if (!this.golden) return;
    this.golden.x += this.golden.vx * dt;
    this.golden.y += this.golden.vy * dt;
    const mx = GOLDEN_RADIUS + 80;
    const my = GOLDEN_RADIUS + 60;
    if (this.golden.x < mx) { this.golden.x = mx; this.golden.vx = Math.abs(this.golden.vx); }
    if (this.golden.x > this.ctx.width - mx) { this.golden.x = this.ctx.width - mx; this.golden.vx = -Math.abs(this.golden.vx); }
    if (this.golden.y < my) { this.golden.y = my; this.golden.vy = Math.abs(this.golden.vy); }
    if (this.golden.y > this.ctx.height - my) { this.golden.y = this.ctx.height - my; this.golden.vy = -Math.abs(this.golden.vy); }
  }

  // ---- lightning ---------------------------------------------------------

  private canCallBolt(seat: Seat): boolean {
    return this.intermission <= 0 && seat.left === 0 && seat.bolts > 0 && seat.boltCooldown === 0 && this.allOutFor < LAST_STRIKES_S;
  }

  private callBolt(seat: Seat, target: Point): void {
    if (!this.canCallBolt(seat)) return;
    seat.bolts -= 1;
    seat.boltCooldown = BOLT_COOLDOWN_S;
    this.bolts.push({ x: target.x, y: target.y, caller: seat.player.id, fuse: BOLT_TELEGRAPH_S });
    this.shout(`LIGHTNING ${seat.player.name}`, seat.player.color, { size: 40, life: 0.9, lane: "low" });
    this.ctx.sfx.countdown();
  }

  private updateBolts(dt: number): void {
    for (let i = this.bolts.length - 1; i >= 0; i -= 1) {
      const bolt = this.bolts[i]!;
      bolt.fuse -= dt;
      if (bolt.fuse > 0) continue;
      this.bolts.splice(i, 1);
      this.strike(bolt);
    }
  }

  private strike(bolt: Bolt): void {
    const { rng } = this.ctx;
    const color = this.colorOf(bolt.caller);
    const hit = applyBlast(this.world, bolt.x, bolt.y, BOLT_RADIUS, BOLT_POWER, () => rng.float(-1, 1));
    for (const puck of hit) {
      if (puck.owner !== bolt.caller) this.lastHit.set(puck.id, { owner: bolt.caller, at: this.time, bolt: true });
    }
    // Jagged bolt from the top of the sky down to the strike point.
    const points: Point[] = [];
    const startX = bolt.x + rng.float(-220, 220);
    const segments = 8;
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      const x = startX + (bolt.x - startX) * t + (i === 0 || i === segments ? 0 : rng.float(-45, 45));
      const y = -20 + (bolt.y + 20) * t;
      points.push({ x, y });
    }
    this.strikes.push({ points, life: STRIKE_LIFE_S, color });
    this.scorches.push({ x: bolt.x, y: bolt.y, life: SCORCH_LIFE_S, color });
    this.whiteFlash = 0.3;
    this.juice.shake(0.6);
    this.juice.hitStop(0.05);
    this.juice.burst(bolt.x, bolt.y, ["#ffffff", "#fff7a8", color], { count: 48, speed: 520, gravity: 0, life: 0.55, size: 5 });
    this.ctx.sfx.hit();
    this.ctx.sfx.whoosh();
  }

  // ---- shooting ----------------------------------------------------------

  private fire(seat: Seat, release: Point): void {
    if (this.intermission > 0 || this.volleyTime >= VOLLEY_S || seat.left <= 0 || seat.reload > 0) return;
    const heavy = seat.heavyNext && seat.heavyLeft > 0;
    const v = launchVelocity(seat.pad, release, heavy ? HEAVY_LAUNCH : 1);
    if (!v) return;
    const puck: Puck = {
      id: this.nextId++,
      owner: seat.player.id,
      x: seat.pad.x,
      y: seat.pad.y,
      r: heavy ? HEAVY_RADIUS : PUCK_RADIUS,
      mass: heavy ? HEAVY_MASS : 1,
      ...v,
    };
    this.world.pucks.push(puck);
    seat.left -= 1;
    seat.reload = RELOAD_S;
    if (heavy) {
      seat.heavyLeft -= 1;
      seat.heavyNext = false;
      this.juice.shake(0.12);
      this.ctx.sfx.whoosh();
    } else {
      this.ctx.sfx.go();
    }
  }

  // ---- multi-touch -------------------------------------------------------

  private toLogical(event: PointerEvent): Point {
    const rect = this.ctx.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / (rect.width || 1)) * this.ctx.width,
      y: ((event.clientY - rect.top) / (rect.height || 1)) * this.ctx.height,
    };
  }

  private readonly onDown = (event: PointerEvent): void => {
    const p = this.toLogical(event);
    let best = -1;
    let bestDist = PAD_RADIUS * 1.6;
    this.seats.forEach((seat, i) => {
      if (seat.player.kind !== "human" || seat.aim) return;
      const d = Math.hypot(p.x - seat.pad.x, p.y - seat.pad.y);
      if (d < bestDist) {
        best = i;
        bestDist = d;
      }
    });
    if (best < 0) return;
    event.preventDefault();
    this.grabs.set(event.pointerId, best);
    const seat = this.seats[best]!;
    seat.aim = p;
    seat.aimStart = p;
    seat.aimDownAt = this.time;
    try {
      this.ctx.canvas.setPointerCapture(event.pointerId);
    } catch {
      /* capture is optional */
    }
  };

  private readonly onMove = (event: PointerEvent): void => {
    const i = this.grabs.get(event.pointerId);
    if (i === undefined) return;
    event.preventDefault();
    this.seats[i]!.aim = this.toLogical(event);
  };

  private readonly onUp = (event: PointerEvent): void => {
    const i = this.grabs.get(event.pointerId);
    if (i === undefined) return;
    this.grabs.delete(event.pointerId);
    const seat = this.seats[i]!;
    const p = this.toLogical(event);
    const start = seat.aimStart ?? p;
    seat.aim = null;
    seat.aimStart = null;
    if (isTap(start, p, this.time - seat.aimDownAt)) {
      if (seat.left > 0 && seat.heavyLeft > 0) {
        seat.heavyNext = !seat.heavyNext;
        this.ctx.sfx.select();
      }
      return;
    }
    if (seat.left > 0) {
      this.fire(seat, p);
    } else if (this.canCallBolt(seat)) {
      const target = boltTargetFromDrag(seat.pad, p, this.ctx.width, this.ctx.height);
      if (target) this.callBolt(seat, target);
    }
  };

  private readonly onCancel = (event: PointerEvent): void => {
    const i = this.grabs.get(event.pointerId);
    if (i === undefined) return;
    this.grabs.delete(event.pointerId);
    this.seats[i]!.aim = null;
    this.seats[i]!.aimStart = null;
  };

  // ---- drawing -----------------------------------------------------------

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    fillArena(g, width, height);
    this.juice.begin(g);
    this.drawSwirl(g);
    this.drawRings(g);
    for (const s of this.scorches) this.drawScorch(g, s);
    for (const peg of this.world.pegs) {
      g.beginPath();
      g.arc(peg.x, peg.y, peg.r, 0, Math.PI * 2);
      g.fillStyle = "#1d2b45";
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = "#9ad9ff";
      g.stroke();
    }
    if (this.cell) this.drawCell(g, this.cell);
    if (this.golden) this.drawGolden(g);
    for (const seat of this.seats) this.drawPad(g, seat);
    for (const puck of this.world.pucks) this.drawPuck(g, puck);
    for (const bolt of this.bolts) this.drawTelegraph(g, bolt);
    for (const seat of this.seats) if (seat.aim) this.drawAim(g, seat);
    for (const s of this.strikes) this.drawStrike(g, s);
    this.juice.end(g);
    if (this.whiteFlash > 0) {
      g.fillStyle = `rgba(255,255,255,${(0.5 * this.whiteFlash) / 0.3})`;
      g.fillRect(0, 0, width, height);
    }
    this.drawHud(g);
    this.callouts.draw(g, width, height);
  }

  private drawHud(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    if (this.best > 0) {
      g.fillStyle = "rgba(244,247,251,0.5)";
      g.font = "600 14px Outfit, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "top";
      g.fillText(`RECORD ${this.best} (3-volley total)`, width / 2, 10);
    }
    const vc = VOLLEY_CONDITIONS[this.volley - 1]!;
    const left = Math.max(0, VOLLEY_S - this.volleyTime);
    const barW = 360;
    const barX = width / 2 - barW / 2;
    const barY = height - 14;
    g.fillStyle = "rgba(7,11,20,0.6)";
    g.fillRect(barX, barY, barW, 6);
    g.fillStyle = left < 5 ? "#FF3D7A" : vc.color;
    g.fillRect(barX, barY, barW * (this.intermission > 0 ? 0 : left / VOLLEY_S), 6);
    g.fillStyle = "#F4F7FB";
    g.font = "600 18px Outfit, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    const phase = this.allOutFor > 0 && this.allOutFor < LAST_STRIKES_S ? "LAST STRIKES" : `${Math.ceil(left)}s`;
    g.fillText(`VOLLEY ${this.volley}/3: ${vc.name} • ${phase}`, width / 2, height - 22);
    if (this.intermission <= 0 && this.swirlTimer < SHIFT_WARN_S && Math.sin(this.time * 24) > -0.3) {
      g.fillStyle = "#FFB020";
      g.font = `700 30px ${FONT}`;
      g.textBaseline = "middle";
      g.fillText("WIND SHIFT!", this.center.x, this.center.y - RINGS[2].radius - 42);
    }
  }

  private drawCell(g: CanvasRenderingContext2D, cell: BonusCell): void {
    const pulse = 1 + Math.sin(this.time * 8) * 0.12;
    const fade = Math.min(1, cell.life / 1.5);
    g.save();
    g.globalAlpha = fade * 0.25;
    g.beginPath();
    g.arc(cell.x, cell.y, CELL_RADIUS * pulse + 10, 0, Math.PI * 2);
    g.fillStyle = "#9ad9ff";
    g.fill();
    g.globalAlpha = fade;
    g.beginPath();
    g.arc(cell.x, cell.y, CELL_RADIUS * pulse, 0, Math.PI * 2);
    g.fillStyle = "rgba(154,217,255,0.25)";
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = "#9ad9ff";
    g.stroke();
    g.fillStyle = "#F4F7FB";
    g.font = `700 22px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("+1", cell.x, cell.y + 1);
    g.restore();
  }

  private drawGolden(g: CanvasRenderingContext2D): void {
    const t = this.golden!;
    const pulse = 1 + Math.sin(this.time * 5) * 0.08;
    const r = GOLDEN_RADIUS * pulse;
    g.save();
    g.beginPath();
    g.arc(t.x, t.y, r + 12, 0, Math.PI * 2);
    g.fillStyle = "rgba(255,215,0,0.14)";
    g.fill();
    g.beginPath();
    g.arc(t.x, t.y, r, 0, Math.PI * 2);
    g.fillStyle = "rgba(255,215,0,0.12)";
    g.fill();
    g.strokeStyle = "#FFD700";
    g.lineWidth = 4;
    g.stroke();
    g.beginPath();
    g.arc(t.x, t.y, r * 0.6, 0, Math.PI * 2);
    g.strokeStyle = "rgba(255,215,0,0.5)";
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = "#FFD700";
    g.font = `700 20px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(`+${GOLDEN_POINTS}`, t.x, t.y + 1);
    g.restore();
  }

  private drawSwirl(g: CanvasRenderingContext2D): void {
    const { swirl } = this.world;
    const dir = Math.sign(swirl.spin);
    const warning = this.intermission <= 0 && this.swirlTimer < SHIFT_WARN_S;
    g.save();
    g.translate(swirl.x, swirl.y);
    g.rotate(this.time * swirl.spin * 0.35);
    g.lineWidth = warning ? 4 : 3;
    const alpha = 0.16 + this.flash * 0.8 + (warning ? 0.25 + Math.sin(this.time * 24) * 0.2 : 0);
    g.strokeStyle = warning ? `rgba(255,176,32,${alpha})` : `rgba(154,217,255,${alpha})`;
    for (let arm = 0; arm < 6; arm += 1) {
      g.beginPath();
      for (let t = 0; t <= 1; t += 0.05) {
        const r = 60 + t * (swirl.radius - 60);
        const a = (arm / 6) * Math.PI * 2 + dir * t * 2.2;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (t === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.restore();
  }

  private drawRings(g: CanvasRenderingContext2D): void {
    const fills = ["rgba(255,61,122,0.30)", "rgba(255,176,32,0.18)", "rgba(62,224,255,0.10)"];
    for (let i = RINGS.length - 1; i >= 0; i -= 1) {
      const ring = RINGS[i]!;
      g.beginPath();
      g.arc(this.center.x, this.center.y, ring.radius, 0, Math.PI * 2);
      g.fillStyle = fills[i]!;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = "rgba(244,247,251,0.35)";
      g.stroke();
      g.fillStyle = "rgba(244,247,251,0.45)";
      g.font = "600 16px Outfit, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      const labelY = i === 0 ? this.center.y : this.center.y - (ring.radius + RINGS[i - 1]!.radius) / 2;
      g.fillText(String(ring.points), this.center.x, labelY);
    }
  }

  private drawScorch(g: CanvasRenderingContext2D, s: Scorch): void {
    const t = s.life / SCORCH_LIFE_S;
    g.save();
    g.globalAlpha = t * 0.5;
    g.beginPath();
    g.arc(s.x, s.y, BOLT_RADIUS * (0.6 + (1 - t) * 0.4), 0, Math.PI * 2);
    g.strokeStyle = s.color;
    g.lineWidth = 3;
    g.stroke();
    g.globalAlpha = t * 0.25;
    g.fillStyle = "#000000";
    g.beginPath();
    g.arc(s.x, s.y, 30, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  private drawTelegraph(g: CanvasRenderingContext2D, bolt: Bolt): void {
    const color = this.colorOf(bolt.caller);
    const t = 1 - bolt.fuse / BOLT_TELEGRAPH_S;
    const flicker = Math.sin(this.time * 40) > 0 ? 1 : 0.6;
    g.save();
    g.globalAlpha = flicker;
    g.strokeStyle = color;
    g.lineWidth = 3;
    g.setLineDash([8, 8]);
    g.beginPath();
    g.arc(bolt.x, bolt.y, BOLT_RADIUS, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    g.arc(bolt.x, bolt.y, BOLT_RADIUS * (1 - t), 0, Math.PI * 2);
    g.fillStyle = "rgba(255,247,168,0.12)";
    g.fill();
    g.strokeStyle = "#fff7a8";
    g.lineWidth = 2;
    g.stroke();
    this.drawBoltGlyph(g, bolt.x, bolt.y, 22, "#fff7a8");
    g.restore();
  }

  private drawBoltGlyph(g: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
    g.save();
    g.translate(x, y);
    g.beginPath();
    g.moveTo(size * 0.2, -size);
    g.lineTo(-size * 0.35, size * 0.1);
    g.lineTo(size * 0.05, size * 0.1);
    g.lineTo(-size * 0.2, size);
    g.lineTo(size * 0.4, -size * 0.15);
    g.lineTo(size * 0.02, -size * 0.15);
    g.closePath();
    g.fillStyle = color;
    g.fill();
    g.restore();
  }

  private drawStrike(g: CanvasRenderingContext2D, s: Strike): void {
    const t = s.life / STRIKE_LIFE_S;
    g.save();
    g.globalAlpha = Math.min(1, t * 1.5);
    g.lineCap = "round";
    g.lineJoin = "round";
    g.shadowColor = s.color;
    g.shadowBlur = 30;
    g.strokeStyle = s.color;
    g.lineWidth = 14 * t + 4;
    g.beginPath();
    s.points.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = "#ffffff";
    g.lineWidth = 5 * t + 1;
    g.stroke();
    g.restore();
  }

  private drawPad(g: CanvasRenderingContext2D, seat: Seat): void {
    const { pad, player } = seat;
    const empty = seat.left === 0;
    const boltReady = this.canCallBolt(seat);
    const ready = !empty && seat.reload === 0;
    g.save();
    g.beginPath();
    g.arc(pad.x, pad.y, PAD_RADIUS, 0, Math.PI * 2);
    g.fillStyle = empty ? "rgba(40,30,70,0.7)" : "rgba(7,11,20,0.55)";
    g.fill();
    if (empty && boltReady) {
      // Storm-cloud halo: the pad is live for lightning.
      g.globalAlpha = 0.22 + Math.sin(this.time * 6) * 0.08;
      g.lineWidth = 16;
      g.strokeStyle = "#fff7a8";
      g.stroke();
    }
    g.lineWidth = ready || boltReady ? 5 : 2;
    g.strokeStyle = seat.heavyNext ? "#ffffff" : player.color;
    g.globalAlpha = ready || boltReady ? 1 : 0.5;
    g.stroke();
    g.globalAlpha = 1;

    // Remaining pucks as pips around the pad: the real count, bonus pucks included.
    const pips = Math.min(seat.left, 12);
    const slots = Math.max(PUCKS_EACH, pips);
    for (let i = 0; i < slots; i += 1) {
      const a = -Math.PI / 2 + (i / slots) * Math.PI * 2;
      g.beginPath();
      g.arc(pad.x + Math.cos(a) * (PAD_RADIUS + 14), pad.y + Math.sin(a) * (PAD_RADIUS + 14), 6, 0, Math.PI * 2);
      g.fillStyle = i < pips ? player.color : "rgba(244,247,251,0.12)";
      g.fill();
    }
    // Bolt charges and cooldown arc once the pad is a storm cloud.
    if (empty && seat.bolts > 0 && this.intermission <= 0) {
      if (seat.boltCooldown > 0) {
        g.beginPath();
        g.arc(pad.x, pad.y, PAD_RADIUS + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - seat.boltCooldown / BOLT_COOLDOWN_S));
        g.strokeStyle = "#fff7a8";
        g.lineWidth = 3;
        g.stroke();
      }
    }

    // Text faces the table centre so each corner reads it the right way up.
    g.translate(pad.x, pad.y);
    g.rotate(Math.atan2(this.center.y - pad.y, this.center.x - pad.x) - Math.PI / 2 + Math.PI);
    g.fillStyle = "#F4F7FB";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `700 40px ${FONT}`;
    g.fillText(String(this.scores.get(player.id) ?? 0), 0, -10);
    g.font = "600 14px Outfit, sans-serif";
    g.fillStyle = player.color;
    g.fillText(player.name, 0, 18);
    if (!empty) {
      // Heavy pucks left, and whether the next shot is one.
      for (let i = 0; i < HEAVY_PER_VOLLEY; i += 1) {
        const hx = (i - (HEAVY_PER_VOLLEY - 1) / 2) * 20;
        g.beginPath();
        g.arc(hx, 44, 7, 0, Math.PI * 2);
        g.lineWidth = 2;
        g.strokeStyle = i < seat.heavyLeft ? "#ffffff" : "rgba(244,247,251,0.2)";
        g.stroke();
        if (i < seat.heavyLeft) {
          g.beginPath();
          g.arc(hx, 44, 3.5, 0, Math.PI * 2);
          g.fillStyle = "#ffffff";
          g.fill();
        }
      }
      if (seat.heavyNext) {
        g.fillStyle = "#ffffff";
        g.font = `700 16px ${FONT}`;
        g.fillText("HEAVY", 0, -44);
      } else if (seat.heavyLeft > 0 && player.kind === "human") {
        g.fillStyle = "rgba(244,247,251,0.45)";
        g.font = "600 10px Outfit, sans-serif";
        g.fillText("TAP: HEAVY", 0, -44);
      }
    } else if (this.intermission <= 0) {
      for (let i = 0; i < BOLTS_PER_VOLLEY; i += 1) {
        const bx = (i - (BOLTS_PER_VOLLEY - 1) / 2) * 24;
        this.drawBoltGlyph(g, bx, 44, 10, i < seat.bolts ? "#fff7a8" : "rgba(244,247,251,0.2)");
      }
      if (boltReady) {
        g.fillStyle = "#fff7a8";
        g.font = `700 15px ${FONT}`;
        g.fillText(player.kind === "human" ? "DRAG: LIGHTNING" : "LIGHTNING", 0, -46);
      }
    }
    g.restore();
  }

  private drawPuck(g: CanvasRenderingContext2D, puck: Puck): void {
    const seat = this.seats.find((s) => s.player.id === puck.owner);
    const color = seat?.player.color ?? "#ffffff";
    const heavy = puck.mass > 1;
    const v = Math.hypot(puck.vx, puck.vy);
    // Fast pucks stretch along their path and squash across it.
    const stretch = 1 + Math.min(0.35, v / 3000);
    g.save();
    g.translate(puck.x, puck.y);
    if (v > 60) g.rotate(Math.atan2(puck.vy, puck.vx));
    g.scale(stretch, 1 / stretch);
    // Cheap glow (a soft halo instead of shadowBlur, which is slow with 30 pucks on a tablet).
    g.globalAlpha = heavy ? 0.3 : 0.22;
    g.beginPath();
    g.arc(0, 0, puck.r + (heavy ? 9 : 7), 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.globalAlpha = 1;
    g.beginPath();
    g.arc(0, 0, puck.r, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(0, 0, puck.r * 0.5, 0, Math.PI * 2);
    g.fillStyle = "rgba(7,11,20,0.35)";
    g.fill();
    if (heavy) {
      g.beginPath();
      g.arc(0, 0, puck.r - 4, 0, Math.PI * 2);
      g.strokeStyle = "rgba(255,255,255,0.9)";
      g.lineWidth = 3;
      g.stroke();
    }
    g.restore();
  }

  private drawAim(g: CanvasRenderingContext2D, seat: Seat): void {
    const aim = seat.aim!;
    const { pad } = seat;
    if (seat.left === 0) {
      if (this.canCallBolt(seat)) this.drawBoltAim(g, seat, aim);
      return;
    }
    const dx = pad.x - aim.x;
    const dy = pad.y - aim.y;
    const pull = Math.min(Math.hypot(dx, dy), MAX_PULL);
    const len = Math.hypot(dx, dy) || 1;
    const heavy = seat.heavyNext && seat.heavyLeft > 0;
    const r = heavy ? HEAVY_RADIUS : PUCK_RADIUS;
    g.save();
    g.strokeStyle = seat.player.color;
    // Pull-back band and the loaded puck.
    g.beginPath();
    g.moveTo(pad.x, pad.y);
    g.lineTo(pad.x - (dx / len) * pull, pad.y - (dy / len) * pull);
    g.lineWidth = 6;
    g.globalAlpha = 0.5;
    g.stroke();
    g.globalAlpha = 1;
    g.beginPath();
    g.arc(pad.x - (dx / len) * pull, pad.y - (dy / len) * pull, r, 0, Math.PI * 2);
    g.fillStyle = seat.player.color;
    g.fill();
    if (heavy) {
      g.beginPath();
      g.arc(pad.x - (dx / len) * pull, pad.y - (dy / len) * pull, r - 4, 0, Math.PI * 2);
      g.strokeStyle = "#ffffff";
      g.lineWidth = 3;
      g.stroke();
    }
    // Approximate flight through the current swirl and drag: the first half of the path, then a
    // fuzzy "?" zone. Pegs cut it short; other pucks are ignored. It teaches the wind, not the shot.
    const v = launchVelocity(pad, aim, heavy ? HEAVY_LAUNCH : 1);
    if (v) {
      const ghost: Puck = { id: -1, owner: seat.player.id, x: pad.x, y: pad.y, r, mass: heavy ? HEAVY_MASS : 1, ...v };
      const preview = previewPath(this.world, ghost, 3);
      const shown = Math.max(2, Math.ceil(preview.points.length * 0.5));
      g.fillStyle = seat.player.color;
      for (let i = 1; i < shown; i += 1) {
        const p = preview.points[i]!;
        g.globalAlpha = 0.75 * (1 - i / shown) + 0.15;
        g.beginPath();
        g.arc(p.x, p.y, 4, 0, Math.PI * 2);
        g.fill();
      }
      const last = preview.points[shown - 1]!;
      const remaining = preview.points.length - shown;
      const radius = Math.min(80, 26 + remaining * 2.4);
      g.globalAlpha = 0.6;
      g.setLineDash([5, 7]);
      g.lineWidth = 2;
      g.strokeStyle = seat.player.color;
      g.beginPath();
      g.arc(last.x, last.y, radius, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.font = `700 ${Math.round(radius * 0.7)}px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "rgba(244,247,251,0.6)";
      g.fillText(preview.uncertain && remaining === 0 ? "!" : "?", last.x, last.y + 1);
    }
    g.restore();
  }

  private drawBoltAim(g: CanvasRenderingContext2D, seat: Seat, aim: Point): void {
    const target = boltTargetFromDrag(seat.pad, aim, this.ctx.width, this.ctx.height);
    const color = seat.player.color;
    g.save();
    g.strokeStyle = color;
    g.lineWidth = 3;
    g.setLineDash([6, 10]);
    g.globalAlpha = 0.6;
    g.beginPath();
    g.moveTo(seat.pad.x, seat.pad.y);
    g.lineTo(aim.x, aim.y);
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
    if (target) {
      g.beginPath();
      g.arc(target.x, target.y, BOLT_RADIUS, 0, Math.PI * 2);
      g.fillStyle = "rgba(255,247,168,0.1)";
      g.fill();
      g.setLineDash([8, 8]);
      g.stroke();
      g.setLineDash([]);
      this.drawBoltGlyph(g, target.x, target.y, 22, "#fff7a8");
    } else {
      g.fillStyle = "rgba(244,247,251,0.6)";
      g.font = "600 14px Outfit, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("drag further", aim.x, aim.y - 30);
    }
    g.restore();
  }
}

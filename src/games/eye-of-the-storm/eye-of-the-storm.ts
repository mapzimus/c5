import { fillArena } from "../../core/draw";
import { Callouts, Juice, loadBest, saveBest } from "../../fx/juice";
import { GAME_HEIGHT, type GameContext, type GameDefinition, type GameInstance, type GameStat, type Player } from "../../core/types";
import { blast, collideKinematic, isResting, speed, stepWorld, type Kinematic, type Puck, type PuckKind, type World } from "./physics";
import {
  BOMB_FUSE_S,
  BOMB_POWER,
  BOMB_RADIUS,
  BOT_TAUNTS,
  BULLSEYE_QUIPS,
  CELL_EVERY_S,
  CELL_RADIUS,
  KO_QUIPS,
  MAX_PULL,
  PAD_RADIUS,
  PERSONAS,
  PUCKS_EACH,
  PUCK_SPECS,
  RELOAD_S,
  RINGS,
  SPLIT_AFTER_S,
  STICK_SPEED,
  botShot,
  catchUpPlayers,
  debrisPath,
  eyeOffset,
  launchVelocity,
  leaderOf,
  matchRemaining,
  lightningTarget,
  padPositions,
  placeCell,
  puckPoints,
  rollMagazine,
  scatterPegs,
  scoreBoard,
  splitVelocities,
  touchesCell,
  volleyRemaining,
  VOLLEYS,
  type BonusCell,
  type BotPersona,
  type Point,
} from "./rules";

export const eyeOfTheStorm: GameDefinition = {
  id: "eye-of-the-storm",
  name: "Bullseye",
  tagline: "Everyone fires at once. Bombs, lightning, flying cows.",
  description:
    "Three volleys: Calm, Gale, Tempest. Everyone slingshots pucks from their corner at the same time. Centre 10, middle 5, outer 2. Your magazine hides special pucks: HEAVY rams anything, BOMB blows up its neighbours, STICKY glues itself down, SPLIT bursts into three shards. The storm fights back: lightning hunts the leader's best puck, cows get blown across the table, and in the Tempest the eye itself wanders. Trailing players get a free bomb. Knock pucks out, steal bullseyes, and watch the last shot in slow motion.",
  // The match is three volleys, not a fixed clock: it ends when the final
  // volley's pucks have all been fired and settled. Our own bar tracks that.
  durationMs: 0,
  controls: "Drag back from your corner pad, release to fire",
  create: (ctx) => new EyeOfTheStorm(ctx),
};

interface Bubble {
  text: string;
  life: number;
}

interface Seat {
  player: Player;
  pad: Point;
  /** Pucks still to fire this volley; mag[0] is loaded next. */
  mag: PuckKind[];
  reload: number;
  botWait: number;
  persona: BotPersona | null;
  taunt: Bubble | null;
  /** Where the active finger/mouse is while aiming. */
  aim: Point | null;
  /** Smoothed leaderboard slot for the top bar. */
  barY: number;
}

interface PuckMeta {
  born: number;
  /** Seconds this puck has been resting (bomb fuse). */
  rest: number;
  dizzy: number;
  bubble: Bubble | null;
  /** Points last shown in a popup, so changes pop "+5" / "-10". */
  shown: number;
}

interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
}

interface Debris extends Kinematic {
  kind: "cow" | "sheep";
  spin: number;
  warn: number;
  mooed: boolean;
}

interface Strike {
  targetId: number;
  warn: number;
}

interface Bolt {
  x: number;
  y: number;
  life: number;
  seed: number;
}

const SETTLE_GRACE_S = 0.8;
/** After the final puck of the match is fired, a visible settle countdown before the end. */
const FINAL_SETTLE_S = 3;
const LEADERBOARD_Y = 34;
const VOLLEY_S = 24;
const EVENTS_UNTIL_S = 21;

interface VolleyCondition {
  name: string;
  tagline: string;
  color: string;
  swirlMul: number;
  pegCount: number;
  cellInterval: readonly [number, number];
  swirlFlipRange: readonly [number, number];
  goldenTarget: boolean;
  specials: number;
  lightning: readonly [number, number] | null;
  debris: readonly [number, number];
  drift: boolean;
  rain: number;
}

const VOLLEY_CONDITIONS: readonly VolleyCondition[] = [
  { name: "CALM", tagline: "Light breeze. Probably.", color: "#60a5fa", swirlMul: 0.5, pegCount: 6, cellInterval: CELL_EVERY_S, swirlFlipRange: [5, 10], goldenTarget: false, specials: 1, lightning: null, debris: [8, 13], drift: false, rain: 0 },
  { name: "GALE", tagline: "Lightning hunts the leader", color: "#FFB020", swirlMul: 1.4, pegCount: 10, cellInterval: [3, 6], swirlFlipRange: [3, 6], goldenTarget: false, specials: 2, lightning: [6, 10], debris: [6, 10], drift: false, rain: 50 },
  { name: "TEMPEST", tagline: "The eye is moving!", color: "#ef4444", swirlMul: 1.7, pegCount: 12, cellInterval: [2, 4], swirlFlipRange: [1.5, 3.5], goldenTarget: true, specials: 3, lightning: [4.5, 7.5], debris: [4.5, 8], drift: true, rain: 110 },
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
const STORM = "@storm";
const COW = "@cow";

class EyeOfTheStorm implements GameInstance {
  private readonly world: World;
  private readonly seats: Seat[];
  private readonly home: Point;
  private readonly center: Point;
  /** pointerId -> seat index, so several fingers can aim at once. */
  private readonly grabs = new Map<number, number>();
  private nextId = 1;
  private swirlTimer: number;
  private flash = 0;
  private whiteFlash = 0;
  private settled = 0;
  private volley = 1;
  private volleyTime = 0;
  private intermission = 0;
  private readonly bank = new Map<string, number>();
  private time = 0;
  private scores = new Map<string, number>();
  private readonly juice: Juice;
  private readonly callouts = new CalloutLanes(GAME_HEIGHT);
  private cell: BonusCell | null = null;
  private cellTimer: number;
  /** puck id -> who last hit it and when, to credit knockouts. */
  private readonly lastHit = new Map<number, { owner: string; at: number }>();
  private readonly lastPoints = new Map<number, number>();
  private readonly bullseyes = new Set<number>();
  private readonly meta = new Map<number, PuckMeta>();
  private readonly popups: Popup[] = [];
  private readonly best = loadBest("eye-of-the-storm", "3v");
  private newBestShown = false;
  private readonly koCount = new Map<string, number>();
  private readonly bullseyeCount = new Map<string, number>();
  private readonly bonusPucks = new Map<string, number>();
  private readonly kaboomCount = new Map<string, number>();
  private readonly zappedCount = new Map<string, number>();
  private readonly ownGoals = new Map<string, number>();
  private readonly leadChanges = new Map<string, number>();
  /** shooter -> recent KO times for DOUBLE / TRIPLE calls. */
  private readonly koStreak = new Map<string, number[]>();
  private golden: GoldenTarget | null = null;
  private readonly goldenScored = new Set<number>();
  private readonly goldenPoints = new Map<string, number>();
  private readonly goldenHitCount = new Map<string, number>();
  private debris: Debris | null = null;
  private debrisTimer = 0;
  private strike: Strike | null = null;
  private strikeTimer = 0;
  private bolts: Bolt[] = [];
  private leader: string | null = null;
  private leadCooldown = 0;
  private lastShotId = -1;
  private lastShotSlowed = false;
  private lastCountdown = 99;
  /** Pucks dealt this volley (magazines + bonus pucks), for the progress bar. */
  private volleyPucks = 0;
  /** Seconds since the last puck of the match left a pad (final settle countdown). */
  private finalSettle = -1;
  private finalTick = 99;

  constructor(private readonly ctx: GameContext) {
    const { width, height, rng } = ctx;
    this.home = { x: width / 2, y: height / 2 };
    this.center = { ...this.home };
    const pads = padPositions(width, height);
    const personas: BotPersona[] = ["sniper", "bully", "cannon"];
    for (let i = personas.length - 1; i > 0; i -= 1) {
      const j = rng.int(0, i);
      [personas[i], personas[j]] = [personas[j]!, personas[i]!];
    }
    let botIndex = 0;
    const vc = VOLLEY_CONDITIONS[0]!;
    this.seats = ctx.players.map((player, i) => ({
      player,
      pad: pads[i % pads.length]!,
      mag: rollMagazine(rng, PUCKS_EACH, vc.specials),
      reload: 0,
      botWait: rng.float(1, 2.5),
      persona: player.kind === "bot" ? personas[botIndex++ % personas.length]! : null,
      taunt: null,
      aim: null,
      barY: i,
    }));
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
    this.debrisTimer = rng.float(vc.debris[0], vc.debris[1]);

    const canvas = ctx.canvas;
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onCancel);
    this.volleyPucks = this.seats.reduce((n, s) => n + s.mag.length, 0);
    this.callouts.show("VOLLEY 1: CALM", vc.color);
    this.callouts.show(vc.tagline, "#F4F7FB", { y: 0.42, size: 30, life: 1.6 });
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.time += dt;
    this.whiteFlash = Math.max(0, this.whiteFlash - realDt * 3);
    this.updateFloaters(realDt);
    if (this.intermission > 0) {
      this.intermission -= realDt;
      if (this.intermission <= 0) this.startVolley(this.volley + 1);
      return;
    }
    const vc = VOLLEY_CONDITIONS[this.volley - 1]!;
    this.volleyTime += dt;
    if (this.volleyTime >= VOLLEY_S) for (const seat of this.seats) seat.mag.length = 0;
    this.flash = Math.max(0, this.flash - dt);
    this.leadCooldown = Math.max(0, this.leadCooldown - dt);
    this.countdown();

    if (vc.drift) {
      const off = eyeOffset(this.volleyTime);
      this.center.x = this.home.x + off.x;
      this.center.y = this.home.y + off.y;
      this.world.swirl.x = this.center.x;
      this.world.swirl.y = this.center.y;
    }

    this.swirlTimer -= dt;
    if (this.swirlTimer <= 0) {
      const { rng } = this.ctx;
      this.world.swirl.spin = -Math.sign(this.world.swirl.spin) * rng.float(1.2, 2.2) * vc.swirlMul;
      this.swirlTimer = rng.float(vc.swirlFlipRange[0], vc.swirlFlipRange[1]);
      this.flash = 0.5;
      this.ctx.sfx.countdown();
    }

    for (const seat of this.seats) {
      seat.reload = Math.max(0, seat.reload - dt);
      if (seat.persona && seat.mag.length > 0 && seat.reload === 0) {
        seat.botWait -= dt;
        if (seat.botWait <= 0) {
          this.fire(seat, botShot(this.ctx.rng, seat.persona, seat.pad, this.center, this.world.pucks, seat.player.id, this.world.pegs));
          const wait = PERSONAS[seat.persona].wait;
          seat.botWait = this.ctx.rng.float(wait[0], wait[1]);
        }
      }
    }

    const events = stepWorld(this.world, dt, () => this.ctx.rng.float(-1, 1));
    if (events.puckHits > 0) this.ctx.sfx.hit();
    else if (events.pegHits > 0) this.ctx.sfx.tick();
    for (const { a, b, speed: impact } of events.contacts) {
      this.juice.shake(Math.min(0.45, impact / 2600));
      this.juice.burst((a.x + b.x) / 2, (a.y + b.y) / 2, [this.colorOf(a.owner), this.colorOf(b.owner)], {
        count: Math.min(24, 6 + Math.round(impact / 80)),
        speed: 120 + impact * 0.25,
        gravity: 0,
        life: 0.45,
      });
      if (impact > 900) this.juice.hitStop(0.05);
      if (impact > 300) {
        this.metaOf(a).dizzy = 1.1;
        this.metaOf(b).dizzy = 1.1;
      }
      this.lastHit.set(a.id, { owner: b.owner, at: this.time });
      this.lastHit.set(b.id, { owner: a.owner, at: this.time });
    }
    this.updateSpecials(dt);
    this.updateDebris(dt);
    this.updateLightning(dt);
    this.updateMoments();
    this.updateCell(dt);
    this.updateGolden(dt);
    this.updateLastShot();

    this.scores = scoreBoard(
      this.world.pucks,
      this.seats.map((s) => s.player.id),
      this.center,
    );
    if (this.golden) {
      for (const puck of this.world.pucks) {
        if (isResting(puck) && !this.goldenScored.has(puck.id) && puck.kind !== "bomb" &&
            Math.hypot(puck.x - this.golden.x, puck.y - this.golden.y) < GOLDEN_RADIUS + puck.r) {
          this.goldenScored.add(puck.id);
          this.goldenPoints.set(puck.owner, (this.goldenPoints.get(puck.owner) ?? 0) + GOLDEN_POINTS);
          this.goldenHitCount.set(puck.owner, (this.goldenHitCount.get(puck.owner) ?? 0) + 1);
          this.callouts.show(`GOLDEN! +${GOLDEN_POINTS}`, "#FFD700", { size: 56 });
          this.popup(this.golden.x, this.golden.y - 40, `+${GOLDEN_POINTS}`, "#FFD700");
          this.juice.burst(this.golden.x, this.golden.y, ["#FFD700", "#FFA500", this.colorOf(puck.owner)], { count: 40, speed: 400, gravity: 0 });
          this.juice.shake(0.3);
          this.ctx.sfx.collect();
        }
      }
    }
    for (const [id, pts] of this.goldenPoints) this.scores.set(id, (this.scores.get(id) ?? 0) + pts);
    for (const seat of this.seats) this.scores.set(seat.player.id, (this.scores.get(seat.player.id) ?? 0) + (this.bank.get(seat.player.id) ?? 0));
    this.updateLeader();
    const humanTop = Math.max(0, ...this.seats.filter((s) => s.player.kind === "human").map((s) => this.scores.get(s.player.id) ?? 0));
    if (!this.newBestShown && this.best > 0 && humanTop > this.best) {
      this.newBestShown = true;
      this.callouts.show("NEW BEST!", "#B8FF3D", { y: 0.2, size: 56 });
      this.ctx.sfx.win();
    }

    const allOut = this.seats.every((s) => s.mag.length === 0);
    const calm = this.world.pucks.every(isResting) && !this.debris && !this.strike;
    this.settled = allOut && (calm || this.volleyTime >= 27) ? this.settled + dt : 0;
    if (this.settled >= SETTLE_GRACE_S && this.volley < VOLLEYS) this.bankVolley();
    if (this.volley === VOLLEYS && allOut) this.updateFinalSettle(realDt);
  }

  isFinished(): boolean {
    return this.volley === VOLLEYS && this.settled >= SETTLE_GRACE_S && this.finalSettle >= FINAL_SETTLE_S;
  }

  /** Last puck of the match is out: count the table down so the end never comes out of nowhere. */
  private updateFinalSettle(dt: number): void {
    if (this.finalSettle < 0) {
      this.finalSettle = 0;
      this.callouts.show("ALL PUCKS FIRED!", "#FFB020", { y: 0.3, size: 52, life: 1.2 });
    }
    this.finalSettle += dt;
    const left = Math.ceil(FINAL_SETTLE_S - this.finalSettle);
    if (left >= 1 && left < this.finalTick) {
      this.finalTick = left;
      this.ctx.sfx.countdown();
      this.callouts.show(`FINAL WHISTLE ${left}`, left === 1 ? "#ff6b6b" : "#F4F7FB", { y: 0.5, size: 64, life: 0.9 });
    }
  }

  getScores(): { playerId: string; score: number }[] {
    const humanTop = Math.max(0, ...this.seats.filter((s) => s.player.kind === "human").map((s) => this.scores.get(s.player.id) ?? 0));
    saveBest("eye-of-the-storm", humanTop, "3v");
    return this.seats.map((s) => ({ playerId: s.player.id, score: this.scores.get(s.player.id) ?? 0 }));
  }

  getStats(): GameStat[] {
    const stats: GameStat[] = [];
    const add = (id: string, label: string, map: Map<string, number>): void => {
      const n = map.get(id) ?? 0;
      if (n > 0) stats.push({ playerId: id, label, value: String(n) });
    };
    for (const s of this.seats) {
      const id = s.player.id;
      if (s.persona) stats.push({ playerId: id, label: "Bot style", value: PERSONAS[s.persona].label });
      add(id, "Bullseyes", this.bullseyeCount);
      add(id, "Knockouts", this.koCount);
      add(id, "Kabooms", this.kaboomCount);
      add(id, "Took the lead", this.leadChanges);
      add(id, "Bonus pucks", this.bonusPucks);
      add(id, "Golden hits", this.goldenHitCount);
      add(id, "Got zapped", this.zappedCount);
      add(id, "Own goals", this.ownGoals);
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

  // ---- volley flow ---------------------------------------------------------

  private bankVolley(): void {
    for (const seat of this.seats) this.bank.set(seat.player.id, this.scores.get(seat.player.id) ?? 0);
    this.intermission = 1.5;
    this.grabs.clear();
    for (const seat of this.seats) seat.aim = null;
    this.callouts.show("POINTS BANKED!", "#B8FF3D");
    this.ctx.sfx.collect();
  }

  private startVolley(n: number): void {
    const { rng, width, height } = this.ctx;
    this.volley = n;
    const vc = VOLLEY_CONDITIONS[n - 1]!;
    this.volleyTime = 0;
    this.world.pucks.length = 0;
    this.lastHit.clear();
    this.lastPoints.clear();
    this.bullseyes.clear();
    this.meta.clear();
    this.cell = null;
    this.debris = null;
    this.strike = null;
    this.settled = 0;
    this.lastShotId = -1;
    this.lastShotSlowed = false;
    this.lastCountdown = 99;
    this.finalSettle = -1;
    this.finalTick = 99;
    this.goldenScored.clear();
    this.goldenPoints.clear();
    this.center.x = this.home.x;
    this.center.y = this.home.y;
    this.world.swirl.x = this.center.x;
    this.world.swirl.y = this.center.y;
    const pads = padPositions(width, height);
    // A wandering eye needs more room so pegs don't park on the bullseye.
    this.world.pegs = scatterPegs(rng, width, height, pads, vc.pegCount, vc.drift ? RINGS[1].radius + 50 : undefined);
    this.world.swirl.spin = rng.sign() * rng.float(1.2, 2) * vc.swirlMul;
    this.swirlTimer = rng.float(vc.swirlFlipRange[0], vc.swirlFlipRange[1]);
    this.cellTimer = rng.float(vc.cellInterval[0], vc.cellInterval[1]);
    this.debrisTimer = rng.float(vc.debris[0], vc.debris[1]);
    this.strikeTimer = vc.lightning ? rng.float(vc.lightning[0], vc.lightning[1]) : 0;
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
    const lucky = new Set(catchUpPlayers(this.bank));
    for (const seat of this.seats) {
      seat.mag = rollMagazine(rng, PUCKS_EACH, vc.specials);
      if (lucky.has(seat.player.id)) seat.mag.splice(1, 0, "bomb");
      seat.reload = 0;
      seat.aim = null;
    }
    this.volleyPucks = this.seats.reduce((count, s) => count + s.mag.length, 0);
    const label = n === VOLLEYS ? `FINAL VOLLEY: ${vc.name}` : `VOLLEY ${n}: ${vc.name}`;
    this.callouts.show(label, vc.color, { size: 48 });
    this.callouts.show(vc.tagline, "#F4F7FB", { y: 0.42, size: 30, life: 1.6 });
    if (lucky.size > 0) {
      const names = this.seats.filter((s) => lucky.has(s.player.id)).map((s) => s.player.name).join(" + ");
      this.callouts.show(`STORM LUCK: ${names} +1 BOMB`, "#ff5a36", { y: 0.62, size: 34, life: 2 });
    }
  }

  private countdown(): void {
    if (this.seats.every((s) => s.mag.length === 0)) return;
    const left = Math.ceil(VOLLEY_S - this.volleyTime);
    if (left <= 5 && left >= 1 && left < this.lastCountdown) {
      this.lastCountdown = left;
      this.ctx.sfx.countdown();
    }
  }

  private updateLeader(): void {
    const now = leaderOf(this.scores);
    if (!now || now === this.leader) return;
    const had = this.leader;
    this.leader = now;
    if (had === null || this.leadCooldown > 0) return;
    this.leadCooldown = 1.4;
    this.leadChanges.set(now, (this.leadChanges.get(now) ?? 0) + 1);
    this.callouts.show(`${this.nameOf(now)} TAKES THE LEAD!`, this.colorOf(now), { y: 0.18, size: 40, life: 1.4 });
    this.ctx.sfx.streak(2);
  }

  private colorOf(owner: string): string {
    if (owner === STORM) return "#fff7a8";
    return this.seats.find((s) => s.player.id === owner)?.player.color ?? "#ffffff";
  }

  private nameOf(owner: string): string {
    return this.seats.find((s) => s.player.id === owner)?.player.name ?? "";
  }

  private seatOf(owner: string): Seat | undefined {
    return this.seats.find((s) => s.player.id === owner);
  }

  private metaOf(p: Puck): PuckMeta {
    let m = this.meta.get(p.id);
    if (!m) {
      m = { born: this.time, rest: 0, dizzy: 0, bubble: null, shown: 0 };
      this.meta.set(p.id, m);
    }
    return m;
  }

  private popup(x: number, y: number, text: string, color: string): void {
    this.popups.push({ x, y, text, color, life: 1.1 });
  }

  private say(p: Puck, text: string): void {
    this.metaOf(p).bubble = { text, life: 1.6 };
  }

  private taunt(owner: string, text?: string): void {
    const seat = this.seatOf(owner);
    if (!seat?.persona) return;
    seat.taunt = { text: text ?? this.ctx.rng.pick(BOT_TAUNTS[seat.persona]), life: 1.8 };
  }

  private updateFloaters(dt: number): void {
    for (const p of this.popups) {
      p.life -= dt;
      p.y -= 50 * dt;
    }
    for (let i = this.popups.length - 1; i >= 0; i -= 1) if (this.popups[i]!.life <= 0) this.popups.splice(i, 1);
    for (const m of this.meta.values()) {
      m.dizzy = Math.max(0, m.dizzy - dt);
      if (m.bubble && (m.bubble.life -= dt) <= 0) m.bubble = null;
    }
    for (const s of this.seats) if (s.taunt && (s.taunt.life -= dt) <= 0) s.taunt = null;
    for (const b of this.bolts) b.life -= dt;
    this.bolts = this.bolts.filter((b) => b.life > 0);
  }

  // ---- specials, storm events -----------------------------------------------

  private updateSpecials(dt: number): void {
    const add: Puck[] = [];
    const remove = new Set<number>();
    for (const p of this.world.pucks) {
      const m = this.metaOf(p);
      m.rest = isResting(p) ? m.rest + dt : 0;
      if (p.kind === "sticky" && !p.anchored && speed(p) < STICK_SPEED && this.time - m.born > 0.3) {
        p.anchored = true;
        p.vx = 0;
        p.vy = 0;
        this.juice.burst(p.x, p.y, ["#7CFF6B", "#3fbf3f"], { count: 12, speed: 140, gravity: 0, life: 0.4 });
        this.ctx.sfx.tick();
      }
      if (p.kind === "splitter" && this.time - m.born > SPLIT_AFTER_S && speed(p) > 200) {
        remove.add(p.id);
        for (const v of splitVelocities(p.vx, p.vy)) {
          const spec = PUCK_SPECS.mini;
          const shard: Puck = { id: this.nextId++, owner: p.owner, x: p.x, y: p.y, r: spec.r, mass: spec.mass, kind: "mini", ...v };
          this.metaOf(shard).born = this.time;
          add.push(shard);
        }
        if (this.lastShotId === p.id) this.lastShotId = add[1]!.id;
        this.juice.burst(p.x, p.y, ["#c084fc", this.colorOf(p.owner)], { count: 16, speed: 220, gravity: 0, life: 0.4 });
        this.ctx.sfx.whoosh();
      }
      if (p.kind === "bomb" && m.rest >= BOMB_FUSE_S) {
        remove.add(p.id);
        this.explode(p);
      }
    }
    if (remove.size > 0) this.world.pucks = this.world.pucks.filter((p) => !remove.has(p.id));
    this.world.pucks.push(...add);
  }

  private explode(bomb: Puck): void {
    const hit = blast(this.world.pucks, bomb.x, bomb.y, BOMB_RADIUS, BOMB_POWER, bomb.id);
    for (const p of hit) {
      this.lastHit.set(p.id, { owner: bomb.owner, at: this.time });
      this.metaOf(p).dizzy = 1.4;
    }
    this.kaboomCount.set(bomb.owner, (this.kaboomCount.get(bomb.owner) ?? 0) + 1);
    this.callouts.show(hit.length >= 2 ? "MEGA KABOOM!" : "KABOOM!", "#ff5a36", { y: 0.24, size: 60, life: 1 });
    this.juice.burst(bomb.x, bomb.y, ["#ff5a36", "#FFB020", "#fff3b0", "#3a3a3a"], { count: 70, speed: 620, gravity: 0, life: 0.8, size: 7 });
    this.juice.shake(0.65);
    this.juice.hitStop(0.08);
    this.whiteFlash = Math.max(this.whiteFlash, 0.35);
    this.ctx.sfx.hit();
    this.ctx.sfx.hit();
    this.ctx.sfx.whoosh();
    if (hit.some((p) => p.owner !== bomb.owner)) this.taunt(bomb.owner);
  }

  private updateDebris(dt: number): void {
    const { rng, width, height } = this.ctx;
    const vc = VOLLEY_CONDITIONS[this.volley - 1]!;
    if (!this.debris) {
      if (this.volleyTime > EVENTS_UNTIL_S || this.seats.every((s) => s.mag.length === 0)) return;
      this.debrisTimer -= dt;
      if (this.debrisTimer > 0) return;
      this.debrisTimer = rng.float(vc.debris[0], vc.debris[1]);
      const kind = rng.next() < 0.65 ? "cow" : "sheep";
      this.debris = { ...debrisPath(rng, width, height), r: kind === "cow" ? 36 : 30, kind, spin: rng.float(-4, 4), warn: 1.1, mooed: false };
      this.callouts.show(kind === "cow" ? "INCOMING COW!" : "INCOMING SHEEP!", "#F4F7FB", { y: 0.7, size: 40, life: 1.1 });
      this.ctx.sfx.miss();
      return;
    }
    const d = this.debris;
    if (d.warn > 0) {
      d.warn -= dt;
      return;
    }
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    if (!d.mooed && d.x > 0 && d.x < width) {
      d.mooed = true;
      this.ctx.sfx.whoosh();
    }
    for (const p of this.world.pucks) {
      const impact = collideKinematic(p, d);
      if (impact > 0) {
        this.lastHit.set(p.id, { owner: COW, at: this.time });
        this.metaOf(p).dizzy = 1.4;
        this.juice.shake(0.3);
        this.juice.burst(p.x, p.y, ["#ffffff", "#222222", this.colorOf(p.owner)], { count: 18, speed: 300, gravity: 0, life: 0.5 });
        this.ctx.sfx.hit();
        this.popup(d.x, d.y - 50, d.kind === "cow" ? "MOO!" : "BAAA!", "#ffffff");
      }
    }
    if (d.x < -120 || d.x > width + 120 || d.y < -120 || d.y > height + 120) this.debris = null;
  }

  private updateLightning(dt: number): void {
    const vc = VOLLEY_CONDITIONS[this.volley - 1]!;
    if (!vc.lightning) return;
    const { rng } = this.ctx;
    if (this.strike) {
      const target = this.world.pucks.find((p) => p.id === this.strike!.targetId);
      if (!target) {
        this.strike = null;
        return;
      }
      this.strike.warn -= dt;
      if (this.strike.warn > 0) return;
      this.strike = null;
      this.bolts.push({ x: target.x, y: target.y, life: 0.3, seed: rng.int(1, 9999) });
      const a = rng.float(0, Math.PI * 2);
      target.anchored = false;
      target.vx = (Math.cos(a) * 950) / (target.mass ?? 1);
      target.vy = (Math.sin(a) * 950) / (target.mass ?? 1);
      const hit = blast(this.world.pucks, target.x, target.y, 90, 450, target.id);
      for (const p of [target, ...hit]) {
        this.lastHit.set(p.id, { owner: STORM, at: this.time });
        this.metaOf(p).dizzy = 1.6;
      }
      this.zappedCount.set(target.owner, (this.zappedCount.get(target.owner) ?? 0) + 1);
      this.say(target, "BZZZT!");
      this.callouts.show(`ZAPPED! ${this.nameOf(target.owner)}`, "#fff7a8", { y: 0.24, size: 56, life: 1.1 });
      this.juice.burst(target.x, target.y, ["#fff7a8", "#9ad9ff", "#ffffff"], { count: 50, speed: 520, gravity: 0, life: 0.6 });
      this.juice.shake(0.7);
      this.juice.hitStop(0.1);
      this.whiteFlash = 0.8;
      this.ctx.sfx.hit();
      this.ctx.sfx.miss();
      return;
    }
    if (this.volleyTime > EVENTS_UNTIL_S) return;
    this.strikeTimer -= dt;
    if (this.strikeTimer > 0) return;
    this.strikeTimer = rng.float(vc.lightning[0], vc.lightning[1]);
    const target = lightningTarget(this.world.pucks, this.scores, this.center);
    if (!target) return;
    this.strike = { targetId: target.id, warn: 1.2 };
    this.say(target, rng.pick(["uh oh", "why me?!", "…mom?", "nope nope"]));
    this.callouts.show("LIGHTNING HUNTS THE LEADER", "#fff7a8", { y: 0.7, size: 30, life: 1.2 });
    this.ctx.sfx.countdown();
  }

  /** Knockouts, bullseyes, steals, score popups: the moments worth shouting about. */
  private updateMoments(): void {
    for (const puck of this.world.pucks) {
      const m = this.metaOf(puck);
      const points = puckPoints(puck, this.center);
      const before = this.lastPoints.get(puck.id) ?? 0;
      this.lastPoints.set(puck.id, points);
      const hit = this.lastHit.get(puck.id);
      if (points < before && hit && this.time - hit.at < 1.5) {
        this.lastHit.delete(puck.id);
        this.knockout(puck, hit.owner, before, points);
      }
      if (isResting(puck) && points !== m.shown) {
        const delta = points - m.shown;
        m.shown = points;
        this.popup(puck.x, puck.y - puck.r - 10, delta > 0 ? `+${delta}` : `${delta}`, delta > 0 ? this.colorOf(puck.owner) : "#ff6b6b");
      }
      if (points === RINGS[0].points && isResting(puck) && puck.kind !== "mini") {
        if (!this.bullseyes.has(puck.id)) {
          this.bullseyes.add(puck.id);
          this.bullseyeCount.set(puck.owner, (this.bullseyeCount.get(puck.owner) ?? 0) + 1);
          const stacked = this.world.pucks.filter((p) => p.owner === puck.owner && this.bullseyes.has(p.id)).length;
          this.callouts.show(stacked >= 2 ? `${stacked}x BULLSEYE!` : "BULLSEYE", this.colorOf(puck.owner), { size: 72 });
          this.juice.burst(puck.x, puck.y, [this.colorOf(puck.owner), "#FFB020", "#ffffff"], { count: 40, speed: 420, gravity: 0 });
          this.juice.shake(0.25);
          this.ctx.sfx.collect();
          if (this.ctx.rng.next() < 0.5) this.say(puck, this.ctx.rng.pick(BULLSEYE_QUIPS));
          this.taunt(puck.owner);
        }
      } else if (points !== RINGS[0].points) {
        this.bullseyes.delete(puck.id);
      }
    }
  }

  private knockout(puck: Puck, by: string, before: number, after: number): void {
    const victim = puck.owner;
    this.metaOf(puck).dizzy = 1.6;
    if (by === STORM) return; // "ZAPPED!" already said it.
    this.say(puck, this.ctx.rng.pick(KO_QUIPS));
    if (by === COW) {
      this.callouts.show(this.debris?.kind === "sheep" ? "SHEEP'D!" : "COW'D!", "#ffffff", { size: 60 });
      this.ctx.sfx.miss();
      return;
    }
    if (by === victim) {
      if (after === 0) {
        this.ownGoals.set(victim, (this.ownGoals.get(victim) ?? 0) + 1);
        this.callouts.show(`OWN GOAL! ${this.nameOf(victim)}`, "#ff6b6b", { size: 52 });
        this.ctx.sfx.miss();
      }
      return;
    }
    this.koCount.set(by, (this.koCount.get(by) ?? 0) + 1);
    const recent = (this.koStreak.get(by) ?? []).filter((t) => this.time - t < 1.2);
    recent.push(this.time);
    this.koStreak.set(by, recent);
    let text = before === RINGS[0].points ? `STOLEN! ${this.nameOf(by)}` : `KNOCKOUT! ${this.nameOf(by)}`;
    if (recent.length === 2) text = `DOUBLE KO! ${this.nameOf(by)}`;
    else if (recent.length >= 3) text = `TRIPLE KO!!! ${this.nameOf(by)}`;
    this.callouts.show(text, this.colorOf(by), { size: recent.length >= 2 ? 66 : 60 });
    this.juice.shake(0.35);
    this.juice.burst(puck.x, puck.y, this.colorOf(by), { count: 30, speed: 380, gravity: 0 });
    this.ctx.sfx.streak(Math.min(6, 3 + recent.length));
    this.taunt(by);
    this.taunt(victim, "HEY!");
  }

  /** The very last puck of a volley gets slow motion as it reaches the rings. */
  private updateLastShot(): void {
    if (this.lastShotId < 0 || this.lastShotSlowed) return;
    const p = this.world.pucks.find((q) => q.id === this.lastShotId);
    if (!p) return;
    if (speed(p) > 150 && Math.hypot(p.x - this.center.x, p.y - this.center.y) < RINGS[2].radius + 70) {
      this.lastShotSlowed = true;
      this.juice.slowMo(this.volley === 3 ? 1.6 : 1.0, 0.25);
    }
  }

  /** Bonus cells: shoot a puck through one for an extra puck. */
  private updateCell(dt: number): void {
    if (this.cell) {
      this.cell.life -= dt;
      const puck = this.world.pucks.find((p) => !isResting(p) && touchesCell(this.cell!, p));
      if (puck) {
        const seat = this.seatOf(puck.owner);
        if (seat) {
          seat.mag.push(this.ctx.rng.next() < 0.5 ? "normal" : this.ctx.rng.pick(["heavy", "bomb", "sticky", "splitter"] as const));
          this.volleyPucks += 1;
        }
        this.bonusPucks.set(puck.owner, (this.bonusPucks.get(puck.owner) ?? 0) + 1);
        this.callouts.show(`+1 PUCK ${this.nameOf(puck.owner)}`, this.colorOf(puck.owner), { y: 0.68, size: 48 });
        this.juice.burst(this.cell.x, this.cell.y, ["#9ad9ff", "#ffffff", this.colorOf(puck.owner)], { count: 36, speed: 360, gravity: 0 });
        this.ctx.sfx.streak(3);
        this.cell = null;
      } else if (this.cell.life <= 0) {
        this.cell = null;
      }
      return;
    }
    // No new cells once everyone is out of pucks, so the round can end.
    if (this.seats.every((s) => s.mag.length === 0)) return;
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

  private fire(seat: Seat, release: Point): void {
    if (this.intermission > 0 || this.volleyTime >= VOLLEY_S || seat.mag.length === 0 || seat.reload > 0) return;
    const v = launchVelocity(seat.pad, release);
    if (!v) return;
    const kind = seat.mag.shift()!;
    const spec = PUCK_SPECS[kind];
    const puck: Puck = { id: this.nextId++, owner: seat.player.id, x: seat.pad.x, y: seat.pad.y, r: spec.r, mass: spec.mass, kind, ...v };
    this.world.pucks.push(puck);
    this.metaOf(puck).born = this.time;
    seat.reload = RELOAD_S;
    this.ctx.sfx.go();
    if (kind !== "normal") this.popup(seat.pad.x, seat.pad.y - PAD_RADIUS - 20, `${spec.label}!`, spec.color);
    const left = this.seats.reduce((n, s) => n + s.mag.length, 0);
    if (left === 0) {
      this.lastShotId = puck.id;
      this.callouts.show(this.volley === VOLLEYS ? "FINAL PUCK!" : "LAST SHOT!", "#F4F7FB", { y: 0.78, size: 44, life: 1.1 });
    } else if (left === 1 && this.volley === VOLLEYS) {
      this.callouts.show("ONE PUCK LEFT!", "#FFB020", { y: 0.78, size: 36, life: 0.9 });
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
    this.seats[best]!.aim = p;
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
    seat.aim = null;
    this.fire(seat, this.toLogical(event));
  };

  private readonly onCancel = (event: PointerEvent): void => {
    const i = this.grabs.get(event.pointerId);
    if (i === undefined) return;
    this.grabs.delete(event.pointerId);
    this.seats[i]!.aim = null;
  };

  // ---- drawing -----------------------------------------------------------

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    const vc = VOLLEY_CONDITIONS[this.volley - 1]!;
    fillArena(g, width, height);
    this.drawStormSky(g);
    this.juice.begin(g);
    this.drawSwirl(g);
    this.drawRings(g);
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
    if (this.strike) this.drawReticle(g);
    for (const seat of this.seats) if (seat.aim) this.drawAim(g, seat);
    if (this.debris) this.drawDebris(g, this.debris);
    for (const bolt of this.bolts) this.drawBolt(g, bolt);
    for (const puck of this.world.pucks) this.drawBubble(g, puck);
    for (const seat of this.seats) this.drawTaunt(g, seat);
    this.drawPopups(g);
    this.juice.end(g);
    this.drawRain(g, vc);
    if (this.whiteFlash > 0) {
      g.fillStyle = `rgba(255,255,240,${Math.min(0.55, this.whiteFlash)})`;
      g.fillRect(0, 0, width, height);
    }
    if (this.juice.slowing) {
      g.fillStyle = "rgba(7,11,20,0.25)";
      g.fillRect(0, 0, width, 40);
      g.fillRect(0, height - 40, width, 40);
    }
    this.drawLeaderboard(g);
    if (this.best > 0) {
      g.fillStyle = "rgba(244,247,251,0.5)";
      g.font = "600 14px Outfit, sans-serif";
      g.textAlign = "left";
      g.textBaseline = "bottom";
      g.fillText(`BEST ${this.best}`, 200, height - 10);
    }
    const left = Math.max(0, VOLLEY_S - this.volleyTime);
    const pucksLeft = this.seats.reduce((n, s) => n + s.mag.length, 0);
    const urgent = left <= 5 && pucksLeft > 0;
    g.fillStyle = urgent ? "#ff6b6b" : "#F4F7FB";
    g.font = urgent ? "700 30px Outfit, sans-serif" : "600 24px Outfit, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    const status = pucksLeft > 0
      ? `${pucksLeft} puck${pucksLeft === 1 ? "" : "s"} left • ${Math.ceil(left)}s`
      : this.volley === VOLLEYS ? "final pucks settling…" : "settling…";
    g.fillText(`VOLLEY ${this.volley}/${VOLLEYS}: ${vc.name} • ${status}`, width / 2, height - 18);
    this.drawMatchBar(g);
    this.callouts.draw(g, width, height);
  }

  /**
   * The match bar (where the engine's timer would sit): three segments, one per
   * volley. The current one drains as pucks are fired (or its clock runs down),
   * so the bar empties exactly when the last puck of the match leaves a pad.
   */
  private drawMatchBar(g: CanvasRenderingContext2D): void {
    const { width } = this.ctx;
    const pucksLeft = this.seats.reduce((n, s) => n + s.mag.length, 0);
    const frac = this.intermission > 0 ? 0 : volleyRemaining(pucksLeft, this.volleyPucks, this.volleyTime, VOLLEY_S);
    const x = 40;
    const w = width - 80;
    const segW = w / VOLLEYS;
    g.save();
    g.fillStyle = "rgba(7,11,20,0.55)";
    g.fillRect(x, 18, w, 10);
    const remaining = matchRemaining(this.volley, frac);
    const final = this.volley === VOLLEYS;
    g.fillStyle = final && frac < 0.35 ? "#FF3D7A" : VOLLEY_CONDITIONS[this.volley - 1]!.color;
    g.fillRect(x, 18, w * remaining, 10);
    g.fillStyle = "rgba(7,11,20,0.9)";
    for (let i = 1; i < VOLLEYS; i += 1) g.fillRect(x + segW * i - 2, 16, 4, 14);
    if (this.finalSettle >= 0) {
      // Final settle: the empty bar pulses while the last pucks come to rest.
      const t = Math.min(1, this.finalSettle / FINAL_SETTLE_S);
      g.globalAlpha = 0.5 + 0.5 * Math.sin(this.time * 12);
      g.fillStyle = "#FFB020";
      g.fillRect(x + w * t, 18, w * (1 - t), 10);
    }
    g.restore();
  }

  private drawStormSky(g: CanvasRenderingContext2D): void {
    if (this.volley === 1) return;
    const { width, height } = this.ctx;
    const grad = g.createRadialGradient(this.center.x, this.center.y, 200, this.center.x, this.center.y, width * 0.75);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, this.volley === 3 ? "rgba(120,20,30,0.35)" : "rgba(120,80,10,0.22)");
    g.fillStyle = grad;
    g.fillRect(0, 0, width, height);
  }

  private drawRain(g: CanvasRenderingContext2D, vc: VolleyCondition): void {
    if (vc.rain === 0) return;
    const { width, height } = this.ctx;
    const slant = Math.sign(this.world.swirl.spin) * 0.25;
    g.save();
    g.strokeStyle = "rgba(154,217,255,0.18)";
    g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 0; i < vc.rain; i += 1) {
      const seedX = (i * 7919) % width;
      const fall = (this.time * (700 + (i % 7) * 60) + i * 131) % (height + 40);
      const x = (seedX + fall * slant + width) % width;
      g.moveTo(x, fall - 20);
      g.lineTo(x + slant * 18, fall);
    }
    g.stroke();
    g.restore();
  }

  private drawLeaderboard(g: CanvasRenderingContext2D): void {
    const { width } = this.ctx;
    const order = [...this.seats].sort((a, b) => (this.scores.get(b.player.id) ?? 0) - (this.scores.get(a.player.id) ?? 0));
    const chipW = 128;
    const total = order.length * chipW + (order.length - 1) * 8;
    const x0 = width / 2 - total / 2;
    order.forEach((seat, rank) => {
      seat.barY += (rank - seat.barY) * 0.2;
      const x = x0 + seat.barY * (chipW + 8);
      const score = this.scores.get(seat.player.id) ?? 0;
      const isLeader = this.leader === seat.player.id;
      g.save();
      g.fillStyle = isLeader ? "rgba(255,215,0,0.18)" : "rgba(7,11,20,0.55)";
      g.strokeStyle = seat.player.color;
      g.lineWidth = isLeader ? 3 : 1.5;
      g.beginPath();
      // Sits under the match bar (y 18-28) instead of being sliced by it.
      g.roundRect(x, LEADERBOARD_Y, chipW, 30, 15);
      g.fill();
      g.stroke();
      g.fillStyle = seat.player.color;
      g.font = "600 15px Outfit, sans-serif";
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillText(`${isLeader ? "\u{1F451} " : ""}${seat.player.name}`.slice(0, 14), x + 10, LEADERBOARD_Y + 15);
      g.fillStyle = "#F4F7FB";
      g.font = "700 22px Bebas Neue, Impact, sans-serif";
      g.textAlign = "right";
      g.fillText(String(score), x + chipW - 10, LEADERBOARD_Y + 16);
      g.restore();
    });
  }

  private drawCell(g: CanvasRenderingContext2D, cell: BonusCell): void {
    const pulse = 1 + Math.sin(this.time * 8) * 0.12;
    const fade = Math.min(1, cell.life / 1.5);
    g.save();
    g.globalAlpha = fade;
    g.shadowColor = "#9ad9ff";
    g.shadowBlur = 24;
    g.beginPath();
    g.arc(cell.x, cell.y, CELL_RADIUS * pulse, 0, Math.PI * 2);
    g.fillStyle = "rgba(154,217,255,0.25)";
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = "#9ad9ff";
    g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = "#F4F7FB";
    g.font = "700 22px Bebas Neue, Impact, sans-serif";
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
    g.shadowColor = "#FFD700";
    g.shadowBlur = 28;
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
    g.shadowBlur = 0;
    g.fillStyle = "#FFD700";
    g.font = "700 20px Bebas Neue, Impact, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(`+${GOLDEN_POINTS}`, t.x, t.y + 1);
    g.restore();
  }

  private drawSwirl(g: CanvasRenderingContext2D): void {
    const { swirl } = this.world;
    const dir = Math.sign(swirl.spin);
    g.save();
    g.translate(swirl.x, swirl.y);
    g.rotate(this.time * swirl.spin * 0.35);
    g.lineWidth = 3;
    const alpha = 0.16 + this.flash * 0.8;
    g.strokeStyle = `rgba(154,217,255,${alpha})`;
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

  private drawPad(g: CanvasRenderingContext2D, seat: Seat): void {
    const { pad, player } = seat;
    const ready = seat.mag.length > 0 && seat.reload === 0;
    g.save();
    g.beginPath();
    g.arc(pad.x, pad.y, PAD_RADIUS, 0, Math.PI * 2);
    g.fillStyle = "rgba(7,11,20,0.55)";
    g.fill();
    g.lineWidth = ready ? 5 : 2;
    g.strokeStyle = player.color;
    g.globalAlpha = ready ? 1 : 0.5;
    g.stroke();
    g.globalAlpha = 1;

    // Magazine as pips around the pad; specials glow in their own colour.
    const pips = Math.max(PUCKS_EACH, seat.mag.length);
    for (let i = 0; i < pips; i += 1) {
      const a = -Math.PI / 2 + (i / pips) * Math.PI * 2;
      const kind = seat.mag[i];
      const px = pad.x + Math.cos(a) * (PAD_RADIUS + 14);
      const py = pad.y + Math.sin(a) * (PAD_RADIUS + 14);
      g.beginPath();
      g.arc(px, py, kind && kind !== "normal" ? 8 : 6, 0, Math.PI * 2);
      g.fillStyle = !kind ? "rgba(244,247,251,0.12)" : kind === "normal" ? player.color : PUCK_SPECS[kind].color;
      g.fill();
      if (i === 0 && kind) {
        g.lineWidth = 2;
        g.strokeStyle = "#ffffff";
        g.stroke();
      }
    }

    // Text faces the table centre so each corner reads it the right way up.
    const facing = Math.atan2(this.center.y - pad.y, this.center.x - pad.x);
    g.translate(pad.x, pad.y);
    g.rotate(facing - Math.PI / 2 + Math.PI);
    const loaded = seat.mag[0];
    if (loaded && !seat.aim) {
      const spec = PUCK_SPECS[loaded];
      const bob = Math.sin(this.time * 4 + pad.x) * 2;
      this.drawPuckBody(g, { id: -1, owner: player.id, x: 0, y: -44 + bob, vx: 0, vy: 0, r: spec.r * 0.8, kind: loaded }, seat.reload > 0 ? 0.4 : 1);
      if (loaded !== "normal") {
        g.fillStyle = spec.color;
        g.font = "700 24px Bebas Neue, Impact, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(spec.label, 0, -78);
      }
    }
    g.fillStyle = "#F4F7FB";
    g.textAlign = "center";
    g.textBaseline = "middle";
    // Big enough to read on a phone (the board shrinks to ~half size at 390px wide).
    g.font = "700 46px Bebas Neue, Impact, sans-serif";
    g.lineWidth = 6;
    g.strokeStyle = "rgba(7,11,20,0.85)";
    g.lineJoin = "round";
    const score = String(this.scores.get(player.id) ?? 0);
    g.strokeText(score, 0, -2);
    g.fillText(score, 0, -2);
    g.font = "700 26px Outfit, sans-serif";
    g.fillStyle = player.color;
    g.strokeText(player.name, 0, 34);
    g.fillText(player.name, 0, 34);
    if (seat.persona) {
      g.font = "600 19px Outfit, sans-serif";
      const persona = PERSONAS[seat.persona].label;
      g.strokeText(persona, 0, 58);
      g.fillText(persona, 0, 58);
    }
    if (this.leader === player.id) {
      g.font = "30px sans-serif";
      g.fillText("\u{1F451}", 0, loaded && loaded !== "normal" && !seat.aim ? -104 : -80);
    }
    g.restore();
  }

  /** The puck itself (body + kind decoration + face). Drawn at puck.x/puck.y in the current transform. */
  private drawPuckBody(g: CanvasRenderingContext2D, puck: Puck, alpha = 1): void {
    const color = this.colorOf(puck.owner);
    const { x, y, r } = puck;
    const kind = puck.kind ?? "normal";
    const m = this.meta.get(puck.id);
    g.save();
    g.globalAlpha = alpha;
    if (kind === "sticky" && puck.anchored) {
      g.beginPath();
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2;
        const rr = r * (1.35 + ((i * 37) % 5) * 0.06);
        g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      g.closePath();
      g.fillStyle = "rgba(124,255,107,0.35)";
      g.fill();
    }
    g.shadowColor = color;
    g.shadowBlur = 14;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = kind === "bomb" ? "#22252b" : color;
    g.fill();
    g.shadowBlur = 0;
    g.lineWidth = kind === "heavy" ? 6 : 3;
    g.strokeStyle = kind === "heavy" ? "#5b6472" : kind === "bomb" ? color : "rgba(7,11,20,0.35)";
    g.stroke();
    if (kind === "bomb") {
      const lit = m && m.rest > 0 ? Math.sin(this.time * 40) > 0 : Math.sin(this.time * 12) > 0;
      g.strokeStyle = "#c8a46a";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x + r * 0.5, y - r * 0.8);
      g.quadraticCurveTo(x + r * 0.9, y - r * 1.3, x + r * 0.6, y - r * 1.5);
      g.stroke();
      g.beginPath();
      g.arc(x + r * 0.6, y - r * 1.5, lit ? 5 : 3, 0, Math.PI * 2);
      g.fillStyle = lit ? "#fff3b0" : "#ff5a36";
      g.fill();
      if (m && m.rest > 0) {
        g.beginPath();
        g.arc(x, y, r + 4 + (m.rest / BOMB_FUSE_S) * 12, 0, Math.PI * 2);
        g.strokeStyle = "rgba(255,90,54,0.7)";
        g.lineWidth = 2;
        g.stroke();
      }
    } else if (kind === "splitter") {
      g.strokeStyle = "rgba(7,11,20,0.5)";
      g.lineWidth = 2;
      g.setLineDash([4, 4]);
      for (const a of [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6]) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        g.stroke();
      }
      g.setLineDash([]);
    } else if (kind === "sticky") {
      g.fillStyle = "#7CFF6B";
      for (const a of [0.6, 2.1, 3.9]) {
        g.beginPath();
        g.ellipse(x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85 + 3, 3.5, 6, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    this.drawFace(g, puck, m);
    g.restore();
  }

  private drawFace(g: CanvasRenderingContext2D, puck: Puck, m: PuckMeta | undefined): void {
    const { x, y, r } = puck;
    const v = speed(puck);
    const dizzy = (m?.dizzy ?? 0) > 0;
    const pts = puck.id < 0 ? 0 : puckPoints(puck, this.center);
    const ink = puck.kind === "bomb" ? "#F4F7FB" : "#070b14";
    const ex = r * 0.34;
    const ey = -r * 0.12;
    const er = r * 0.24;
    let lx = 0;
    let ly = 0.4;
    if (v > 20) {
      lx = puck.vx / v;
      ly = puck.vy / v;
    } else if (puck.id >= 0) {
      lx = (this.center.x - x) / (Math.hypot(this.center.x - x, this.center.y - y) || 1);
      ly = (this.center.y - y) / (Math.hypot(this.center.x - x, this.center.y - y) || 1);
    }
    g.lineCap = "round";
    for (const side of [-1, 1]) {
      const cx = x + side * ex;
      const cy = y + ey;
      if (dizzy) {
        g.strokeStyle = ink;
        g.lineWidth = Math.max(1.5, r * 0.1);
        const s = er * 0.8;
        g.beginPath();
        g.moveTo(cx - s, cy - s);
        g.lineTo(cx + s, cy + s);
        g.moveTo(cx + s, cy - s);
        g.lineTo(cx - s, cy + s);
        g.stroke();
        continue;
      }
      const scared = v > 500;
      g.beginPath();
      g.arc(cx, cy, scared ? er * 1.25 : er, 0, Math.PI * 2);
      g.fillStyle = "#ffffff";
      g.fill();
      g.beginPath();
      g.arc(cx + lx * er * 0.45, cy + ly * er * 0.45, er * (scared ? 0.4 : 0.55), 0, Math.PI * 2);
      g.fillStyle = "#070b14";
      g.fill();
    }
    if (puck.kind === "heavy") {
      g.strokeStyle = ink;
      g.lineWidth = r * 0.14;
      g.beginPath();
      g.moveTo(x - ex - er, y + ey - er * 1.4);
      g.lineTo(x + ex + er, y + ey - er * 1.4);
      g.stroke();
    }
    // Mouth.
    g.strokeStyle = ink;
    g.fillStyle = ink;
    g.lineWidth = Math.max(1.5, r * 0.1);
    const my = y + r * 0.42;
    g.beginPath();
    if (dizzy) {
      g.moveTo(x - r * 0.35, my);
      for (let i = 1; i <= 4; i += 1) g.lineTo(x - r * 0.35 + i * r * 0.175, my + (i % 2 ? -r * 0.08 : r * 0.08));
      g.stroke();
    } else if (v > 500) {
      g.ellipse(x, my, r * 0.17, r * 0.22, 0, 0, Math.PI * 2);
      g.fill();
    } else if (v > 20 || puck.id < 0) {
      g.moveTo(x - r * 0.22, my);
      g.lineTo(x + r * 0.22, my);
      g.stroke();
    } else if (pts >= 10) {
      g.arc(x, my - r * 0.15, r * 0.32, 0.15 * Math.PI, 0.85 * Math.PI);
      g.closePath();
      g.fill();
    } else if (pts > 0) {
      g.arc(x, my - r * 0.18, r * 0.25, 0.2 * Math.PI, 0.8 * Math.PI);
      g.stroke();
    } else {
      g.arc(x, my + r * 0.15, r * 0.22, 1.2 * Math.PI, 1.8 * Math.PI);
      g.stroke();
    }
  }

  private drawPuck(g: CanvasRenderingContext2D, puck: Puck): void {
    const v = speed(puck);
    if (v > 400) {
      g.save();
      g.globalAlpha = 0.25;
      g.strokeStyle = this.colorOf(puck.owner);
      g.lineWidth = puck.r * 1.4;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(puck.x, puck.y);
      g.lineTo(puck.x - (puck.vx / v) * Math.min(90, v * 0.06), puck.y - (puck.vy / v) * Math.min(90, v * 0.06));
      g.stroke();
      g.restore();
    }
    this.drawPuckBody(g, puck);
  }

  private drawSpeech(g: CanvasRenderingContext2D, x: number, y: number, text: string, life: number, color = "#F4F7FB"): void {
    g.save();
    g.globalAlpha = Math.min(1, life * 3);
    g.font = "700 16px Outfit, sans-serif";
    const w = g.measureText(text).width + 16;
    const bx = Math.max(4, Math.min(this.ctx.width - w - 4, x - w / 2));
    const by = Math.max(44, y - 30);
    g.fillStyle = "rgba(255,255,255,0.95)";
    g.beginPath();
    g.roundRect(bx, by, w, 24, 10);
    g.fill();
    g.beginPath();
    g.moveTo(x - 5, by + 24);
    g.lineTo(x + 5, by + 24);
    g.lineTo(x, by + 32);
    g.fill();
    g.fillStyle = "#070b14";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, bx + w / 2, by + 13);
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(bx, by, w, 24, 10);
    g.stroke();
    g.restore();
  }

  private drawBubble(g: CanvasRenderingContext2D, puck: Puck): void {
    const b = this.meta.get(puck.id)?.bubble;
    if (b) this.drawSpeech(g, puck.x, puck.y - puck.r - 8, b.text, b.life, this.colorOf(puck.owner));
  }

  private drawTaunt(g: CanvasRenderingContext2D, seat: Seat): void {
    if (!seat.taunt) return;
    const towardX = Math.sign(this.home.x - seat.pad.x);
    const towardY = Math.sign(this.home.y - seat.pad.y);
    this.drawSpeech(g, seat.pad.x + towardX * 120, seat.pad.y + towardY * 70, seat.taunt.text, seat.taunt.life, seat.player.color);
  }

  private drawPopups(g: CanvasRenderingContext2D): void {
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "700 30px Bebas Neue, Impact, sans-serif";
    g.lineWidth = 5;
    g.strokeStyle = "rgba(7,11,20,0.8)";
    for (const p of this.popups) {
      g.globalAlpha = Math.min(1, p.life * 2);
      g.strokeText(p.text, p.x, p.y);
      g.fillStyle = p.color;
      g.fillText(p.text, p.x, p.y);
    }
    g.restore();
  }

  private drawReticle(g: CanvasRenderingContext2D): void {
    const target = this.world.pucks.find((p) => p.id === this.strike!.targetId);
    if (!target) return;
    const t = this.strike!.warn;
    const r = target.r + 10 + t * 30;
    g.save();
    g.strokeStyle = Math.sin(this.time * 30) > 0 ? "#fff7a8" : "#ff5a36";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(target.x, target.y, r, 0, Math.PI * 2);
    g.moveTo(target.x - r - 10, target.y);
    g.lineTo(target.x - r + 10, target.y);
    g.moveTo(target.x + r - 10, target.y);
    g.lineTo(target.x + r + 10, target.y);
    g.moveTo(target.x, target.y - r - 10);
    g.lineTo(target.x, target.y - r + 10);
    g.moveTo(target.x, target.y + r - 10);
    g.lineTo(target.x, target.y + r + 10);
    g.stroke();
    g.restore();
  }

  private drawBolt(g: CanvasRenderingContext2D, bolt: Bolt): void {
    g.save();
    g.globalAlpha = Math.min(1, bolt.life / 0.15);
    g.strokeStyle = "#fffbe0";
    g.shadowColor = "#9ad9ff";
    g.shadowBlur = 30;
    g.lineWidth = 6;
    g.lineJoin = "round";
    g.beginPath();
    let s = bolt.seed;
    const rand = (): number => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    let x = bolt.x + (rand() - 0.5) * 200;
    g.moveTo(x, -20);
    const steps = 9;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      x = x + (bolt.x - x) * (1 / (steps - i + 1)) + (i < steps ? (rand() - 0.5) * 70 : 0);
      g.lineTo(i === steps ? bolt.x : x, -20 + (bolt.y + 20) * t);
    }
    g.stroke();
    g.lineWidth = 2;
    g.strokeStyle = "#ffffff";
    g.stroke();
    g.restore();
  }

  private drawDebris(g: CanvasRenderingContext2D, d: Debris): void {
    const { width } = this.ctx;
    if (d.warn > 0) {
      const ex = d.vx > 0 ? 30 : width - 30;
      g.save();
      g.globalAlpha = Math.sin(this.time * 20) > 0 ? 1 : 0.4;
      g.fillStyle = "#ff5a36";
      g.beginPath();
      const dir = Math.sign(d.vx);
      g.moveTo(ex + dir * 22, d.y);
      g.lineTo(ex - dir * 12, d.y - 18);
      g.lineTo(ex - dir * 12, d.y + 18);
      g.closePath();
      g.fill();
      g.fillStyle = "#F4F7FB";
      g.font = "700 18px Outfit, sans-serif";
      g.textAlign = "center";
      g.fillText(d.kind === "cow" ? "COW!" : "SHEEP!", ex + dir * 40, d.y - 26);
      g.restore();
      return;
    }
    const legs = Math.sin(this.time * 24) * 0.6;
    g.save();
    g.translate(d.x, d.y);
    g.rotate(this.time * d.spin);
    if (d.kind === "cow") {
      g.strokeStyle = "#222";
      g.lineWidth = 5;
      g.lineCap = "round";
      for (const [lx, sign] of [[-18, 1], [-8, -1], [10, 1], [20, -1]] as const) {
        g.beginPath();
        g.moveTo(lx, 12);
        g.lineTo(lx + Math.sin(legs * sign) * 10, 30);
        g.stroke();
      }
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.ellipse(0, 0, 36, 22, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#222";
      for (const [sx, sy, sr] of [[-14, -6, 8], [8, 6, 7], [18, -9, 5]] as const) {
        g.beginPath();
        g.arc(sx, sy, sr, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.arc(38, -10, 14, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#ffb6c1";
      g.beginPath();
      g.ellipse(48, -6, 8, 6, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#222";
      g.beginPath();
      g.arc(36, -15, 3, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#d9c38a";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(32, -22);
      g.lineTo(28, -32);
      g.moveTo(42, -22);
      g.lineTo(46, -32);
      g.stroke();
    } else {
      g.fillStyle = "#222";
      g.fillRect(-16, 14, 5, 14);
      g.fillRect(10, 14, 5, 14);
      g.fillStyle = "#f2f2f2";
      for (const [fx, fy] of [[-16, -6], [0, -12], [16, -6], [-10, 8], [10, 8], [0, 0]] as const) {
        g.beginPath();
        g.arc(fx, fy, 14, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = "#222";
      g.beginPath();
      g.ellipse(30, -4, 10, 12, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.arc(33, -7, 3, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  private drawAim(g: CanvasRenderingContext2D, seat: Seat): void {
    const aim = seat.aim!;
    const { pad } = seat;
    const dx = pad.x - aim.x;
    const dy = pad.y - aim.y;
    const pull = Math.min(Math.hypot(dx, dy), MAX_PULL);
    const len = Math.hypot(dx, dy) || 1;
    const kind = seat.mag[0];
    g.save();
    g.strokeStyle = seat.player.color;
    g.lineWidth = 4;
    g.setLineDash([2, 10]);
    g.lineCap = "round";
    // Direction preview only — the swirl and pegs decide the rest.
    g.beginPath();
    g.moveTo(pad.x, pad.y);
    g.lineTo(pad.x + (dx / len) * pull * 2.2, pad.y + (dy / len) * pull * 2.2);
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(pad.x, pad.y);
    g.lineTo(pad.x - (dx / len) * pull, pad.y - (dy / len) * pull);
    g.lineWidth = 6;
    g.globalAlpha = 0.5;
    g.stroke();
    g.globalAlpha = 1;
    const px = pad.x - (dx / len) * pull;
    const py = pad.y - (dy / len) * pull;
    if (kind) {
      // Face strains harder the further it's pulled.
      const r = PUCK_SPECS[kind].r;
      this.drawPuckBody(g, { id: -1, owner: seat.player.id, x: px, y: py, vx: (dx / len) * pull * 4, vy: (dy / len) * pull * 4, r, kind });
    } else {
      g.beginPath();
      g.arc(px, py, 18, 0, Math.PI * 2);
      g.fillStyle = "rgba(244,247,251,0.2)";
      g.fill();
    }
    g.restore();
  }
}

/**
 * Callouts that dodge each other: when a new banner would land on top of one still on
 * screen (e.g. LAST CALL vs a raid score), it slides into the next free lane instead.
 */
class CalloutLanes {
  private readonly inner = new Callouts();
  private live: { text: string; y: number; size: number; life: number }[] = [];

  constructor(private readonly height: number) {}

  show(text: string, color = "#F4F7FB", options: { life?: number; y?: number; size?: number } = {}): void {
    const life = options.life ?? 1.2;
    const size = options.size ?? 64;
    let y = options.y ?? 0.32;
    const gap = (other: { size: number }): number => ((size + other.size) / 2) * 0.95 / this.height;
    for (let tries = 0; tries < 6; tries++) {
      const hit = this.live.find((item) => Math.abs(item.y - y) < gap(item));
      if (!hit) break;
      const down = hit.y + gap(hit);
      y = down < 0.9 ? down : hit.y - gap(hit);
    }
    this.live.push({ text, y, size, life });
    this.inner.show(text, color, { life, size, y });
  }

  update(dt: number): void {
    for (const item of this.live) item.life -= dt;
    this.live = this.live.filter((item) => item.life > 0.15);
    this.inner.update(dt);
  }

  draw(g: CanvasRenderingContext2D, width: number, height: number): void {
    this.inner.draw(g, width, height);
  }
}

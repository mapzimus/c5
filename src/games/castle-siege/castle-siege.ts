import type Matter from "matter-js";
import { fillArena } from "../../core/draw";
import { Callouts, Juice, loadBest, saveBest } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import { ModePicker } from "../mode-picker";
import {
  AMMO_LABELS,
  AMMO_WEIGHTS,
  BUILD_SECONDS,
  KING_HP,
  PIECE_SPECS,
  REALTIME_RELOAD_S,
  REALTIME_SUDDEN_DEATH_S,
  REALTIME_WIND_EVERY_S,
  ROUNDS_TO_WIN,
  SUDDEN_DEATH_AFTER,
  WIND_MAX,
  comboCallout,
  dealQueue,
  gaussian,
  matchWinner,
  other,
  realtimeAmmo,
  rollAmmo,
  rollWind,
  teamOf,
  type Ammo,
  type PieceKind,
  type Team,
} from "./rules";
import {
  CANNONS,
  GROUND_Y,
  MAX_SHOT_SPEED,
  SiegeWorld,
  TOP_Y,
  ZONES,
  previewArc,
  simulateShot,
  type Piece,
  type WorldEvent,
} from "./world";

type Phase = "build" | "siege" | "roundOver" | "matchOver";
type TurnState = "intro" | "roll" | "aim" | "flight" | "settle";

const W = 1280;
const H = 720;
const TRAY_Y = 612;
const AIM_SCALE = 0.11;
const DROP_COOLDOWN = 0.3;
/** Kinds flashed during the roll animation. Golden stays hidden so its reveal is a surprise. */
const AMMO_KINDS = (Object.keys(AMMO_WEIGHTS) as Ammo[]).filter((ammo) => ammo !== "golden");
const GOLD = "#FFD54A";
const BEST_KEY = "castle-siege-combo";

interface Pt {
  x: number;
  y: number;
}

interface AimState {
  pointerId: number;
  sx: number;
  sy: number;
  x: number;
  y: number;
}

interface TeamState {
  players: Player[];
  color: string;
  name: string;
  human: boolean;
  next: number;
  rotation: number;
  kingPlaced: boolean;
  cooldown: number;
  botTimer: number;
  smashed: number;
  bestCombo: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  spin: number;
  angle: number;
}

interface Floater {
  text: string;
  x: number;
  y: number;
  life: number;
  color: string;
  size: number;
}

interface Button {
  x: number;
  y: number;
  w: number;
  h: number;
}

function inside(b: Button, x: number, y: number): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

export class CastleSiege implements GameInstance {
  private readonly world = new SiegeWorld();
  private readonly teams: [TeamState, TeamState];
  private phase: Phase = "build";
  private round = 0;
  private wins: [number, number] = [0, 0];
  private queue: PieceKind[] = [];
  private timer = 0;
  private held: ({ pointerId: number; x: number } | null)[] = [null, null];
  private aim: { pointerId: number; sx: number; sy: number; x: number; y: number } | null = null;
  private shooter: Team = 0;
  private firstShooter: Team = 0;
  private shots: [number, number] = [0, 0];
  private turn: TurnState = "intro";
  private turnTimer = 0;
  private ammo: Ammo = "ball";
  private rollShown: Ammo = "ball";
  private rollTick = 0;
  private shotSmashed = 0;
  private done = false;
  private elapsed = 0;

  // Juice.
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private shake = 0;
  private slowmo = 0;
  private flash = 0;
  private banner: { text: string; sub: string; color: string; life: number; total: number } | null = null;
  private hitFlash = new Map<Piece, number>();
  private readonly juice = new Juice();
  private readonly callouts = new Callouts();
  /** Most enemy blocks one human shot has smashed on this device. */
  private best = loadBest(BEST_KEY);

  // Last-shot ghost: each team's previous flight path, shown while they aim.
  private ghost: [Pt[] | null, Pt[] | null] = [null, null];
  private trail: Pt[] = [];
  private tracked: Matter.Body | null = null;

  /** Real-time siege: both cannons fire whenever reloaded instead of taking turns. */
  private readonly realtime: boolean;
  private readonly rt = {
    ammo: ["ball", "ball"] as [Ammo, Ammo],
    reload: [0, 0] as [number, number],
    aim: [null, null] as [AimState | null, AimState | null],
    botDelay: [0, 0] as [number, number],
    combo: [0, 0] as [number, number],
    comboTimer: [0, 0] as [number, number],
    tracked: [null, null] as [Matter.Body | null, Matter.Body | null],
    trail: [[], []] as [Pt[], Pt[]],
    siegeTime: 0,
    windTimer: 0,
    sudden: false,
  };

  constructor(private readonly ctx: GameContext, realtime = false) {
    this.realtime = realtime;
    const makeTeam = (team: Team): TeamState => {
      const players = ctx.players.filter((_, index) => teamOf(index) === team);
      const first = players[0];
      return {
        players,
        color: first?.color ?? (team === 0 ? "#3EE0FF" : "#FF3D7A"),
        name: first?.name ?? (team === 0 ? "Left" : "Right"),
        human: players.some((player) => player.kind === "human"),
        next: 0,
        rotation: 0,
        kingPlaced: false,
        cooldown: 0,
        botTimer: 0,
        smashed: 0,
        bestCombo: 0,
      };
    };
    this.teams = [makeTeam(0), makeTeam(1)];
    const canvas = ctx.canvas;
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onCancel);
    this.startRound();
  }

  // ---------- flow ----------

  private startRound(): void {
    this.round += 1;
    this.world.reset();
    this.queue = dealQueue(this.ctx.rng);
    for (const team of this.teams) {
      team.next = 0;
      team.rotation = 0;
      team.kingPlaced = false;
      team.cooldown = 0;
      team.botTimer = 0.4 + this.ctx.rng.float(0, 0.3);
    }
    this.held = [null, null];
    this.shots = [0, 0];
    this.phase = "build";
    this.timer = BUILD_SECONDS;
    this.showBanner(`ROUND ${this.round}`, "Place your king, then stack a fortress!", "#F4F7FB", 1.8);
    this.ctx.sfx.go();
  }

  private startSiege(): void {
    this.held = [null, null];
    for (const t of [0, 1] as const) if (!this.teams[t].kingPlaced) this.placeKing(t, (ZONES[t].x0 + ZONES[t].x1) / 2);
    this.phase = "siege";
    this.shooter = this.firstShooter;
    this.turn = "intro";
    this.turnTimer = 1.2;
    if (this.realtime) {
      const rt = this.rt;
      this.world.damageOn = true;
      this.world.wind = rollWind(this.ctx.rng);
      rt.siegeTime = 0;
      rt.windTimer = REALTIME_WIND_EVERY_S;
      rt.sudden = false;
      rt.aim = [null, null];
      for (const t of [0, 1] as const) {
        rt.ammo[t] = realtimeAmmo(this.ctx.rng, 0);
        rt.reload[t] = 1.2;
        rt.botDelay[t] = 0.4 + this.ctx.rng.float(0, 0.8);
        rt.combo[t] = 0;
        rt.comboTimer[t] = 0;
        rt.tracked[t] = null;
        rt.trail[t] = [];
      }
      this.showBanner("FIRE AT WILL!", "Both cannons, no turns", "#FFB020", 1.2);
    } else {
      this.showBanner("FIRE!", "Knock out their king", "#FFB020", 1.2);
    }
    this.ctx.sfx.go();
  }

  private beginRoll(): void {
    this.world.damageOn = true;
    this.turn = "roll";
    this.turnTimer = 0.75;
    this.rollTick = 0;
    this.shotSmashed = 0;
    this.ammo = rollAmmo(this.ctx.rng, this.shots[this.shooter]);
    this.world.wind = rollWind(this.ctx.rng);
  }

  private endTurn(): void {
    this.finishCombo(this.shooter, this.shotSmashed);
    this.shooter = other(this.shooter);
    this.beginRoll();
  }

  /** Combo callout + personal best for blocks smashed by one shot (or one real-time burst). */
  private finishCombo(team: Team, smashed: number): void {
    const callout = comboCallout(smashed);
    const state = this.teams[team];
    state.bestCombo = Math.max(state.bestCombo, smashed);
    let sub = `${smashed} blocks`;
    if (state.human && smashed > 0) {
      const newBest = saveBest(BEST_KEY, smashed);
      if (newBest && smashed >= 2) {
        this.callouts.show("NEW BEST!", GOLD, { y: 0.26, size: 58, life: 1.5 });
        this.juice.burst(W / 2, H * 0.26, [GOLD, "#FFFFFF", state.color], { count: 40, speed: 420, life: 0.9 });
        this.ctx.sfx.win();
      }
      this.best = Math.max(this.best, smashed);
      sub += newBest ? " · NEW PERSONAL BEST" : ` · best ${this.best}`;
    }
    if (callout) {
      this.showBanner(callout, sub, state.color, 1.1);
      this.ctx.sfx.streak(smashed);
    }
  }

  private kingDown(team: Team, x: number, y: number): void {
    if (this.phase === "roundOver" || this.phase === "matchOver") return;
    const winner = other(team);
    this.commitGhost();
    this.rt.aim = [null, null];
    this.juice.hitStop(0.12);
    // Both kings gone in the same moment: nobody scores, replay the round.
    const bothGone = !this.world.kings[winner] && this.teams[winner].kingPlaced;
    if (!bothGone) this.wins[winner] += 1;
    this.firstShooter = team;
    this.phase = "roundOver";
    this.timer = 3;
    this.slowmo = 1.3;
    this.shake = 22;
    this.flash = 0.8;
    this.burst(x, y, 60, "#FFD54A", 520, 5);
    this.burst(x, y, 30, "#FFFFFF", 380, 3);
    this.ctx.sfx.win();
    const name = this.teams[winner].name;
    this.showBanner(bothGone ? "DOUBLE KO!" : "KING DOWN!", bothGone ? "Replay the round" : `${name} takes round ${this.round}`, bothGone ? "#F4F7FB" : this.teams[winner].color, 2.8);
  }

  private placeKing(team: Team, x: number): void {
    const state = this.teams[team];
    if (state.kingPlaced) return;
    state.kingPlaced = true;
    const king = this.world.placeKing(team, x);
    this.burst(king.body.position.x, king.body.position.y, 16, "#FFD54A", 220, 3);
    this.ctx.sfx.collect();
  }

  private drop(team: Team, x: number): void {
    const state = this.teams[team];
    const kind = this.queue[state.next];
    if (!kind || state.cooldown > 0) return;
    if (this.world.spawnPiece(kind, x, team, state.rotation)) {
      state.next += 1;
      state.cooldown = DROP_COOLDOWN;
      this.ctx.sfx.tick();
    } else {
      this.floaters.push({ text: "TOO HIGH", x, y: TOP_Y, life: 0.9, color: "#ef4444", size: 26 });
      this.ctx.sfx.miss();
    }
  }

  // ---------- update ----------

  update(dt: number): void {
    if (this.done) return;
    this.elapsed += dt;
    // Shared juice: hit-stop freezes the simulation (returns 0) while shake/particles keep going.
    const sim = this.juice.update(dt);
    this.callouts.update(dt);
    const scale = this.slowmo > 0 ? 0.3 : 1;
    this.slowmo = Math.max(0, this.slowmo - dt);
    this.shake = Math.max(0, this.shake - dt * 40);
    this.flash = Math.max(0, this.flash - dt * 2);
    if (this.banner) {
      this.banner.life -= dt;
      if (this.banner.life <= 0) this.banner = null;
    }
    this.updateJuice(sim * scale);

    if (this.phase !== "matchOver") {
      this.world.step(sim * scale);
      this.handleEvents(this.world.drainEvents());
      this.sampleTrail();
    }

    if (this.phase === "build") this.updateBuild(dt);
    else if (this.phase === "siege") this.updateSiege(dt, sim * scale);
    else if (this.phase === "roundOver") {
      this.timer -= dt;
      if (this.timer <= 0) {
        const champ = matchWinner(this.wins);
        if (champ === null) this.startRound();
        else {
          this.phase = "matchOver";
          this.timer = 1.2;
          this.ctx.sfx.win();
        }
      }
    } else if (this.phase === "matchOver") {
      this.timer -= dt;
      if (this.timer < -4 && !this.teams.some((team) => team.human)) this.done = true;
    }
  }

  private updateBuild(dt: number): void {
    this.timer -= dt;
    for (const t of [0, 1] as const) {
      const state = this.teams[t];
      state.cooldown = Math.max(0, state.cooldown - dt);
      if (state.human) {
        // Nobody tapped a spot: put the king in the middle so the round keeps moving.
        if (!state.kingPlaced && this.timer < BUILD_SECONDS - 6) this.placeKing(t, (ZONES[t].x0 + ZONES[t].x1) / 2);
        continue;
      }
      state.botTimer -= dt;
      if (state.botTimer > 0) continue;
      state.botTimer = 0.55 + this.ctx.rng.float(0, 0.25);
      const zone = ZONES[t];
      if (!state.kingPlaced) {
        this.placeKing(t, this.ctx.rng.float(zone.x0 + 120, zone.x1 - 120));
        continue;
      }
      const king = this.world.kings[t];
      const kind = this.queue[state.next];
      if (!king || !kind) continue;
      state.rotation = (kind === "brick" || kind === "cube") && this.ctx.rng.next() < 0.3 ? 1 : 0;
      const side = t === 0 ? 1 : -1;
      // Bunker the king first, then wall the side facing the enemy.
      const offsets = state.next < 3 ? [0, 10, -10] : [0, 45, 70, 95, -40];
      const x = king.body.position.x + side * this.ctx.rng.pick(offsets);
      this.drop(t, x);
    }
    const allDropped = this.teams.every((team) => team.kingPlaced && team.next >= this.queue.length);
    if (this.timer <= 0 || allDropped) this.startSiege();
  }

  private updateSiege(dt: number, worldDt: number): void {
    if (this.realtime) {
      this.updateRealtime(dt);
      return;
    }
    const shooter = this.teams[this.shooter];
    if (this.turn === "intro") {
      this.turnTimer -= dt;
      if (this.turnTimer <= 0) this.beginRoll();
      return;
    }
    if (this.turn === "roll") {
      this.turnTimer -= dt;
      this.rollTick -= dt;
      if (this.rollTick <= 0) {
        this.rollTick = 0.07;
        this.rollShown = this.ctx.rng.pick(AMMO_KINDS);
        this.ctx.sfx.tick();
      }
      if (this.turnTimer <= 0) {
        this.rollShown = this.ammo;
        this.turn = "aim";
        this.turnTimer = shooter.human ? 0 : 0.7 + this.ctx.rng.float(0, 0.4);
        this.ctx.sfx.collect();
        if (this.ammo === "golden") {
          this.callouts.show("GOLDEN SHOT!", GOLD, { life: 1.4 });
          const c = CANNONS[this.shooter];
          this.juice.burst(c.x, c.y - 20, [GOLD, "#FFF3B0", "#FFFFFF"], { count: 36, speed: 320, gravity: 200 });
          this.juice.shake(0.2);
          this.ctx.sfx.streak(6);
        }
      }
      return;
    }
    if (this.turn === "aim") {
      if (!shooter.human) {
        this.turnTimer -= dt;
        if (this.turnTimer <= 0) this.botShoot();
      }
      return;
    }
    if (this.turn === "flight") {
      this.turnTimer += worldDt;
      if ((this.world.ballsSettled() && this.turnTimer > 0.4) || this.turnTimer > 7) {
        this.commitGhost();
        this.world.clearBalls();
        this.turn = "settle";
        this.turnTimer = 0;
      }
      return;
    }
    this.turnTimer += dt;
    if ((this.world.maxPieceSpeed() < 0.3 && this.turnTimer > 0.5) || this.turnTimer > 2.2) this.endTurn();
  }

  private updateRealtime(dt: number): void {
    const rt = this.rt;
    rt.siegeTime += dt;
    if (!rt.sudden && rt.siegeTime >= REALTIME_SUDDEN_DEATH_S) {
      rt.sudden = true;
      this.showBanner("SUDDEN DEATH", "Every shot is a bomb now", "#FF3D7A", 1.6);
      this.ctx.sfx.hit();
    }
    rt.windTimer -= dt;
    if (rt.windTimer <= 0) {
      rt.windTimer = REALTIME_WIND_EVERY_S;
      this.world.wind = rollWind(this.ctx.rng);
    }
    for (const t of [0, 1] as const) {
      const was = rt.reload[t];
      rt.reload[t] = Math.max(0, was - dt);
      if (was > 0 && rt.reload[t] === 0 && rt.ammo[t] === "golden") {
        this.callouts.show(`GOLDEN SHOT · ${this.teams[t].name.toUpperCase()}`, GOLD, { life: 1.2, size: 48 });
        const c = CANNONS[t];
        this.juice.burst(c.x, c.y - 20, [GOLD, "#FFF3B0", "#FFFFFF"], { count: 30, speed: 300, gravity: 200 });
        this.ctx.sfx.streak(6);
      }
      if (rt.comboTimer[t] > 0) {
        rt.comboTimer[t] -= dt;
        if (rt.comboTimer[t] <= 0) {
          this.finishCombo(t, rt.combo[t]);
          rt.combo[t] = 0;
        }
      }
      if (!this.teams[t].human && rt.reload[t] === 0) {
        rt.botDelay[t] -= dt;
        if (rt.botDelay[t] <= 0) {
          const v = this.botVelocity(t);
          this.fireRealtime(t, v.vx, v.vy);
        }
      }
      this.sampleRealtimeTrail(t);
    }
    this.world.pruneBalls();
  }

  private fireRealtime(team: Team, vx: number, vy: number): void {
    const rt = this.rt;
    if (rt.reload[team] > 0) return;
    const before = new Set(this.world.balls);
    this.world.fire(team, rt.ammo[team], vx, vy);
    const fresh = this.world.balls.filter((ball) => !before.has(ball));
    rt.tracked[team] = fresh[Math.floor(fresh.length / 2)]?.body ?? null;
    const c = CANNONS[team];
    rt.trail[team] = [{ x: c.x, y: c.y }];
    rt.aim[team] = null;
    rt.reload[team] = REALTIME_RELOAD_S;
    rt.ammo[team] = realtimeAmmo(this.ctx.rng, rt.siegeTime);
    rt.botDelay[team] = 0.3 + this.ctx.rng.float(0, 1.2);
    this.shake = Math.max(this.shake, 4);
    this.burst(c.x + Math.sign(vx) * 20, c.y - 10, 14, "#e7e5e4", 240, 4);
    this.ctx.sfx.hit();
  }

  /** Real-time version of the ghost trail: one tracked ball per team. */
  private sampleRealtimeTrail(team: Team): void {
    const rt = this.rt;
    const tracked = rt.tracked[team];
    if (!tracked) return;
    const ball = this.world.balls.find((b) => b.body === tracked);
    const trail = rt.trail[team];
    if (ball) {
      const { x, y } = ball.body.position;
      const last = trail[trail.length - 1];
      if (!last || Math.hypot(x - last.x, y - last.y) > 6) trail.push({ x, y });
      if (ball.ammo === "golden") this.juice.burst(x, y, [GOLD, "#FFF3B0"], { count: 1, speed: 40, size: 3, life: 0.45, gravity: 0 });
    }
    if (!ball || ball.touched || trail.length > 500) {
      if (trail.length > 1) this.ghost[team] = trail;
      rt.tracked[team] = null;
      rt.trail[team] = [];
    }
  }

  private handleEvents(events: WorldEvent[]): void {
    for (const event of events) {
      if (event.type === "thud") {
        if (event.speed > 8) this.burst(event.x, event.y, 4, "#a8a29e", 120, 2);
        if (event.speed > 12) this.shake = Math.max(this.shake, 4);
      } else if (event.type === "hit") {
        const color = event.king ? "#FFD54A" : this.teams[event.team].color;
        this.burst(event.x, event.y, event.king ? 22 : 8, color, event.king ? 320 : 180, event.king ? 4 : 3);
        // Screen shake scaled by how hard the hit was.
        this.juice.shake(event.king ? 0.45 : Math.min(0.4, 0.06 + event.damage * 0.08));
        if (event.king) {
          this.juice.hitStop(0.14);
          this.juice.burst(event.x, event.y, [GOLD, "#FFFFFF"], { count: 20, speed: 380, size: 5 });
          const piece = this.world.kings[event.team];
          if (piece) this.hitFlash.set(piece, 0.35);
          this.floaters.push({ text: `-${event.damage} KING`, x: event.x, y: event.y - 40, life: 1.2, color: "#FFD54A", size: 34 });
          this.ctx.sfx.hit();
        }
      } else if (event.type === "break") {
        this.shards(event.x, event.y, this.teams[event.team].color, event.kind);
        // Debris in the block's colour, plus a beat of hit-stop so the shatter lands.
        this.juice.burst(event.x, event.y, [this.teams[event.team].color, "#F4F7FB", "#a8a29e"], { count: 16, speed: 340, size: 5, life: 0.8, gravity: 900 });
        this.juice.hitStop(0.06);
        this.juice.shake(0.18);
        if (this.phase === "siege" && this.realtime) {
          const by = other(event.team);
          this.rt.combo[by] += 1;
          this.rt.comboTimer[by] = 1.2;
          this.teams[by].smashed += 1;
          const n = this.rt.combo[by];
          this.floaters.push({ text: n > 1 ? `x${n}` : "SMASH", x: event.x, y: event.y - 20, life: 0.9, color: this.teams[by].color, size: 22 + n * 4 });
          this.ctx.sfx.streak(n);
        } else if (this.phase === "siege" && event.team !== this.shooter) {
          this.shotSmashed += 1;
          this.teams[this.shooter].smashed += 1;
          this.floaters.push({ text: this.shotSmashed > 1 ? `x${this.shotSmashed}` : "SMASH", x: event.x, y: event.y - 20, life: 0.9, color: "#F4F7FB", size: 22 + this.shotSmashed * 4 });
          this.ctx.sfx.streak(this.shotSmashed);
        }
      } else if (event.type === "boom") {
        this.burst(event.x, event.y, 46, "#FF8A3D", 560, 6);
        this.burst(event.x, event.y, 24, "#FFE08A", 360, 4);
        this.burst(event.x, event.y, 18, "#57534e", 260, 7);
        this.shake = Math.max(this.shake, 16);
        this.flash = Math.max(this.flash, 0.45);
        this.ctx.sfx.hit();
        this.ctx.sfx.miss();
      } else if (event.type === "kingDown") {
        this.kingDown(event.team, event.x, event.y);
      }
    }
  }

  // ---------- shooting ----------

  private botShoot(): void {
    const v = this.botVelocity(this.shooter);
    this.fire(v.vx, v.vy);
  }

  private botVelocity(team: Team): { vx: number; vy: number } {
    const king = this.world.kings[other(team)];
    const from = CANNONS[team];
    const tx = king?.body.position.x ?? (ZONES[other(team)].x0 + ZONES[other(team)].x1) / 2;
    const ty = king?.body.position.y ?? GROUND_Y - 40;
    const dir = tx > from.x ? 1 : -1;
    const angle = this.ctx.rng.pick([0.75, 0.95, 1.15]);
    const felt = this.world.wind * 0.6;
    let best = { speed: 18, err: Infinity };
    for (let speed = 8; speed <= MAX_SHOT_SPEED; speed += 0.25) {
      const y = simulateShot(from, Math.cos(angle) * speed * dir, -Math.sin(angle) * speed, felt, tx);
      if (y === null) continue;
      const err = Math.abs(y - ty);
      if (err < best.err) best = { speed, err };
    }
    const speed = best.speed + gaussian(this.ctx.rng) * 0.55;
    return { vx: Math.cos(angle) * speed * dir, vy: -Math.sin(angle) * speed };
  }

  private fire(vx: number, vy: number): void {
    this.world.fire(this.shooter, this.ammo, vx, vy);
    const balls = this.world.balls;
    this.tracked = balls[Math.floor(balls.length / 2)]?.body ?? null;
    const from = CANNONS[this.shooter];
    this.trail = [{ x: from.x, y: from.y }];
    this.shots[this.shooter] += 1;
    this.turn = "flight";
    this.turnTimer = 0;
    this.aim = null;
    this.shake = Math.max(this.shake, 5);
    const c = CANNONS[this.shooter];
    this.burst(c.x + Math.sign(vx) * 20, c.y - 10, 14, "#e7e5e4", 240, 4);
    this.ctx.sfx.hit();
  }

  /** Record the tracked ball's path up to its first impact (or explosion). */
  private sampleTrail(): void {
    if (!this.tracked) return;
    const ball = this.world.balls.find((b) => b.body === this.tracked);
    if (!ball) {
      this.tracked = null;
      return;
    }
    const { x, y } = ball.body.position;
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(x - last.x, y - last.y) > 6) this.trail.push({ x, y });
    if (ball.touched || this.trail.length > 500) this.tracked = null;
    if (ball.ammo === "golden") this.juice.burst(x, y, [GOLD, "#FFF3B0"], { count: 1, speed: 40, size: 3, life: 0.45, gravity: 0 });
  }

  private commitGhost(): void {
    if (this.phase === "siege" && this.trail.length > 1) this.ghost[this.shooter] = this.trail;
    this.trail = [];
    this.tracked = null;
  }

  private aimVelocity(): { vx: number; vy: number; power: number } | null {
    return this.aimVelocityOf(this.aim);
  }

  private aimVelocityOf(aim: AimState | null): { vx: number; vy: number; power: number } | null {
    if (!aim) return null;
    let vx = (aim.sx - aim.x) * AIM_SCALE;
    let vy = (aim.sy - aim.y) * AIM_SCALE;
    const speed = Math.hypot(vx, vy);
    if (speed > MAX_SHOT_SPEED) {
      vx = (vx / speed) * MAX_SHOT_SPEED;
      vy = (vy / speed) * MAX_SHOT_SPEED;
    }
    return { vx, vy, power: Math.min(speed, MAX_SHOT_SPEED) / MAX_SHOT_SPEED };
  }

  // ---------- input ----------

  private toLogical(event: PointerEvent): { x: number; y: number } {
    const rect = this.ctx.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    return { x: ((event.clientX - rect.left) / rect.width) * W, y: ((event.clientY - rect.top) / rect.height) * H };
  }

  private rotateButton(team: Team): Button {
    return { x: ZONES[team].x1 - 100, y: TRAY_Y, w: 100, h: 100 };
  }

  private readonly onDown = (event: PointerEvent): void => {
    event.preventDefault();
    this.ctx.sfx.unlock();
    const { x, y } = this.toLogical(event);
    const team: Team = x < W / 2 ? 0 : 1;

    if (this.phase === "build") {
      const state = this.teams[team];
      if (!state.human) return;
      if (inside(this.rotateButton(team), x, y)) {
        state.rotation = (state.rotation + 1) % 4;
        this.ctx.sfx.tick();
        return;
      }
      if (!state.kingPlaced) {
        this.placeKing(team, x);
        return;
      }
      if (this.held[team]) return;
      this.held[team] = { pointerId: event.pointerId, x };
      this.capture(event);
      return;
    }

    if (this.phase === "siege" && this.realtime) {
      if (!this.teams[team].human || this.rt.aim[team]) return;
      this.rt.aim[team] = { pointerId: event.pointerId, sx: x, sy: y, x, y };
      this.capture(event);
      return;
    }

    if (this.phase === "siege") {
      if (this.turn !== "aim" || team !== this.shooter || !this.teams[team].human || this.aim) return;
      this.aim = { pointerId: event.pointerId, sx: x, sy: y, x, y };
      this.capture(event);
      return;
    }

    if (this.phase === "matchOver" && this.timer <= 0) this.done = true;
  };

  private readonly onMove = (event: PointerEvent): void => {
    const { x, y } = this.toLogical(event);
    for (const held of this.held) if (held && held.pointerId === event.pointerId) held.x = x;
    if (this.aim && this.aim.pointerId === event.pointerId) {
      this.aim.x = x;
      this.aim.y = y;
    }
    for (const aim of this.rt.aim) {
      if (aim && aim.pointerId === event.pointerId) {
        aim.x = x;
        aim.y = y;
      }
    }
  };

  private readonly onUp = (event: PointerEvent): void => {
    for (const t of [0, 1] as const) {
      const held = this.held[t];
      if (held && held.pointerId === event.pointerId) {
        this.held[t] = null;
        if (this.phase === "build") this.drop(t, held.x);
      }
    }
    for (const t of [0, 1] as const) {
      const aim = this.rt.aim[t];
      if (!aim || aim.pointerId !== event.pointerId) continue;
      const rv = this.aimVelocityOf(aim);
      this.rt.aim[t] = null;
      if (!rv || rv.power <= 0.12 || this.phase !== "siege") continue;
      if (this.rt.reload[t] > 0) {
        const c = CANNONS[t];
        this.floaters.push({ text: "RELOADING", x: c.x, y: c.y - 90, life: 0.8, color: "#94a3b8", size: 22 });
        this.ctx.sfx.miss();
      } else {
        this.fireRealtime(t, rv.vx, rv.vy);
      }
    }
    const v = this.aim && this.aim.pointerId === event.pointerId ? this.aimVelocity() : null;
    if (this.aim?.pointerId === event.pointerId) this.aim = null;
    if (v && this.phase === "siege" && this.turn === "aim" && v.power > 0.12) this.fire(v.vx, v.vy);
  };

  private readonly onCancel = (event: PointerEvent): void => {
    for (const t of [0, 1] as const) if (this.held[t]?.pointerId === event.pointerId) this.held[t] = null;
    if (this.aim?.pointerId === event.pointerId) this.aim = null;
    for (const t of [0, 1] as const) if (this.rt.aim[t]?.pointerId === event.pointerId) this.rt.aim[t] = null;
  };

  private capture(event: PointerEvent): void {
    try {
      this.ctx.canvas.setPointerCapture(event.pointerId);
    } catch {
      /* optional */
    }
  }

  // ---------- juice ----------

  private burst(x: number, y: number, count: number, color: string, speed: number, size: number): void {
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      const life = 0.4 + Math.random() * 0.6;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.3, life, max: life, color, size: size * (0.6 + Math.random() * 0.8), spin: (Math.random() - 0.5) * 12, angle: 0 });
    }
  }

  /** A block breaking: chunky shards in its colour plus dust. */
  private shards(x: number, y: number, color: string, kind: PieceKind): void {
    const spec = PIECE_SPECS[kind];
    const count = Math.round(6 + (spec.w * spec.h) / 400);
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const s = 120 + Math.random() * 320;
      const life = 0.7 + Math.random() * 0.7;
      this.particles.push({
        x: x + (Math.random() - 0.5) * spec.w * 0.6,
        y: y + (Math.random() - 0.5) * spec.h * 0.6,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 200,
        life,
        max: life,
        color,
        size: 6 + Math.random() * 8,
        spin: (Math.random() - 0.5) * 16,
        angle: Math.random() * 6,
      });
    }
    this.burst(x, y, 10, "#a8a29e", 160, 3);
  }

  private updateJuice(dt: number): void {
    for (const p of this.particles) {
      p.life -= dt;
      p.vy += 900 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      if (p.y > GROUND_Y && p.vy > 0) {
        p.y = GROUND_Y;
        p.vy *= -0.3;
        p.vx *= 0.6;
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length > 700) this.particles.splice(0, this.particles.length - 700);
    for (const f of this.floaters) {
      f.life -= dt;
      f.y -= 50 * dt;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    for (const [piece, t] of this.hitFlash) {
      if (t - dt <= 0) this.hitFlash.delete(piece);
      else this.hitFlash.set(piece, t - dt);
    }
  }

  private showBanner(text: string, sub: string, color: string, life: number): void {
    this.banner = { text, sub, color, life, total: life };
  }

  // ---------- render ----------

  render(g: CanvasRenderingContext2D): void {
    fillArena(g, W, H);
    g.save();
    if (this.shake > 0) g.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    this.juice.begin(g);
    this.drawStage(g);
    if (this.phase === "siege") this.drawGhost(g);
    for (const piece of this.world.pieces) {
      if (piece.kind === "king") this.drawKing(g, piece);
      else this.drawPiece(g, piece);
    }
    for (const t of [0, 1] as const) this.drawCannon(g, t);
    for (const ball of this.world.balls) this.drawBall(g, ball.body, ball.ammo, this.teams[ball.team].color);
    this.drawParticles(g);
    if (this.phase === "build") for (const t of [0, 1] as const) this.drawHeld(g, t);
    if (this.phase === "siege") this.drawAim(g);
    this.drawFloaters(g);
    this.juice.end(g);
    g.restore();

    this.drawTopBar(g);
    if (this.phase === "build") for (const t of [0, 1] as const) this.drawTray(g, t);
    if (this.phase === "siege") this.drawSiegeHud(g);
    if (this.flash > 0) {
      g.fillStyle = `rgba(255,240,200,${Math.min(0.5, this.flash * 0.6)})`;
      g.fillRect(0, 0, W, H);
    }
    if (this.phase === "matchOver") this.drawMatchOver(g);
    else if (this.banner) this.drawBanner(g);
    this.callouts.draw(g, W, H);
  }

  /** The shooter's previous flight, faint and dotted, so they can correct their aim. */
  private drawGhost(g: CanvasRenderingContext2D): void {
    if (this.realtime) {
      for (const t of [0, 1] as const) if (this.teams[t].human) this.drawGhostFor(g, t);
      return;
    }
    if (this.turn !== "aim" && this.turn !== "roll") return;
    this.drawGhostFor(g, this.shooter);
  }

  private drawGhostFor(g: CanvasRenderingContext2D, team: Team): void {
    const path = this.ghost[team];
    if (!path || path.length < 2) return;
    const color = this.teams[team].color;
    g.save();
    g.globalAlpha = 0.38;
    g.strokeStyle = color;
    g.lineWidth = 3;
    g.lineCap = "round";
    g.setLineDash([2, 10]);
    g.beginPath();
    path.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.stroke();
    g.setLineDash([]);
    // Mark where it landed.
    const end = path[path.length - 1]!;
    g.globalAlpha = 0.55;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(end.x - 8, end.y - 8);
    g.lineTo(end.x + 8, end.y + 8);
    g.moveTo(end.x + 8, end.y - 8);
    g.lineTo(end.x - 8, end.y + 8);
    g.stroke();
    g.font = "600 13px Outfit, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "bottom";
    g.fillStyle = color;
    g.fillText("LAST SHOT", end.x, end.y - 12);
    g.restore();
  }

  private drawStage(g: CanvasRenderingContext2D): void {
    for (const t of [0, 1] as const) {
      const zone = ZONES[t];
      const grad = g.createLinearGradient(0, TOP_Y, 0, GROUND_Y);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, this.teams[t].color + "22");
      g.fillStyle = grad;
      g.fillRect(zone.x0, TOP_Y - 60, zone.x1 - zone.x0, GROUND_Y - TOP_Y + 60);
    }
    g.fillStyle = "#2a1f14";
    g.fillRect(-40, GROUND_Y, W + 80, H - GROUND_Y + 40);
    g.fillStyle = "#4d7c3a";
    g.fillRect(-40, GROUND_Y, W + 80, 8);
  }

  private tracePath(g: CanvasRenderingContext2D, vertices: readonly { x: number; y: number }[]): void {
    g.beginPath();
    vertices.forEach((v, i) => (i ? g.lineTo(v.x, v.y) : g.moveTo(v.x, v.y)));
    g.closePath();
  }

  private drawPiece(g: CanvasRenderingContext2D, piece: Piece, alpha = 1): void {
    const body = piece.body;
    const parts = body.parts.length > 1 ? body.parts.slice(1) : [body];
    const damage = 1 - piece.hp / piece.maxHp;
    g.globalAlpha = alpha;
    for (const part of parts) {
      this.tracePath(g, part.vertices);
      g.fillStyle = this.teams[piece.team].color;
      g.fill();
      // Top-left highlight, bottom shade.
      g.fillStyle = `rgba(0,0,0,${0.12 + damage * 0.35})`;
      g.fill();
      g.strokeStyle = "rgba(7,11,20,0.85)";
      g.lineWidth = 2.5;
      g.stroke();
    }
    if (damage > 0) {
      g.save();
      g.translate(body.position.x, body.position.y);
      g.rotate(body.angle);
      g.strokeStyle = "rgba(7,11,20,0.8)";
      g.lineWidth = 2;
      const r = Math.min(PIECE_SPECS[piece.kind as PieceKind].w, PIECE_SPECS[piece.kind as PieceKind].h) * 0.45;
      g.beginPath();
      g.moveTo(-r, -r * 0.4);
      g.lineTo(-r * 0.2, r * 0.1);
      g.lineTo(r * 0.3, -r * 0.3);
      g.lineTo(r, r * 0.5);
      if (damage >= 0.5) {
        g.moveTo(-r * 0.2, r * 0.1);
        g.lineTo(-r * 0.1, r);
      }
      g.stroke();
      g.restore();
    }
    g.globalAlpha = 1;
  }

  private drawKing(g: CanvasRenderingContext2D, king: Piece): void {
    const body = king.body;
    const flash = this.hitFlash.get(king) ?? 0;
    g.save();
    g.translate(body.position.x, body.position.y);
    g.rotate(body.angle);
    const s = 17;
    g.shadowColor = "#FFD54A";
    g.shadowBlur = 16;
    g.fillStyle = flash > 0 ? "#ffffff" : "#FFD54A";
    g.beginPath();
    g.roundRect(-s, -s, s * 2, s * 2, 6);
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = this.teams[king.team].color;
    g.lineWidth = 3;
    g.stroke();
    // Crown.
    g.fillStyle = "#FFB020";
    g.beginPath();
    g.moveTo(-s + 2, -s);
    g.lineTo(-s + 2, -s - 14);
    g.lineTo(-s / 2, -s - 5);
    g.lineTo(0, -s - 17);
    g.lineTo(s / 2, -s - 5);
    g.lineTo(s - 2, -s - 14);
    g.lineTo(s - 2, -s);
    g.closePath();
    g.fill();
    g.strokeStyle = "#7c4a03";
    g.lineWidth = 1.5;
    g.stroke();
    // Face: worried once hurt.
    g.fillStyle = "#1f2937";
    const hurt = king.hp < king.maxHp;
    g.beginPath();
    g.arc(-6, -2, hurt ? 2 : 3, 0, Math.PI * 2);
    g.arc(6, -2, hurt ? 2 : 3, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.lineWidth = 2;
    g.strokeStyle = "#1f2937";
    if (hurt) g.arc(0, 10, 5, Math.PI * 1.15, Math.PI * 1.85);
    else g.arc(0, 4, 6, Math.PI * 0.15, Math.PI * 0.85);
    g.stroke();
    g.restore();
  }

  private drawCannon(g: CanvasRenderingContext2D, t: Team): void {
    const c = CANNONS[t];
    const active = this.phase === "siege" && (this.realtime ? this.rt.reload[t] === 0 : this.shooter === t && (this.turn === "aim" || this.turn === "roll"));
    g.save();
    g.translate(c.x, c.y);
    let angle = t === 0 ? -0.8 : Math.PI + 0.8;
    const v = this.realtime ? this.aimVelocityOf(this.rt.aim[t]) : active ? this.aimVelocity() : null;
    if (v && v.power > 0.05) angle = Math.atan2(v.vy, v.vx);
    g.save();
    g.rotate(angle);
    g.fillStyle = "#334155";
    g.fillRect(0, -9, 38, 18);
    g.restore();
    g.fillStyle = this.teams[t].color;
    if (active) {
      g.shadowColor = this.teams[t].color;
      g.shadowBlur = 20 + Math.sin(this.elapsed * 8) * 8;
    }
    g.beginPath();
    g.arc(0, 6, 20, Math.PI, 0);
    g.fill();
    g.fillRect(-22, 6, 44, GROUND_Y - c.y - 6);
    g.restore();
  }

  private drawBall(g: CanvasRenderingContext2D, ball: Matter.Body, ammo: Ammo, color: string): void {
    const r = ball.circleRadius ?? 15;
    const { x, y } = ball.position;
    g.fillStyle = ammo === "bomb" ? "#111827" : ammo === "boulder" ? "#78716c" : ammo === "golden" ? GOLD : "#e5e7eb";
    g.strokeStyle = ammo === "golden" ? "#FFF3B0" : color;
    g.lineWidth = 3;
    if (ammo === "golden") {
      g.shadowColor = GOLD;
      g.shadowBlur = 24 + Math.sin(this.elapsed * 20) * 8;
    }
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.shadowBlur = 0;
    if (ammo === "golden") {
      g.fillStyle = "rgba(255,255,255,0.8)";
      g.beginPath();
      g.arc(x - r * 0.35, y - r * 0.35, r * 0.28, 0, Math.PI * 2);
      g.fill();
    }
    if (ammo === "bomb") {
      g.fillStyle = Math.sin(this.elapsed * 30) > 0 ? "#FF8A3D" : "#FFE08A";
      g.beginPath();
      g.arc(x + r * 0.5, y - r * 0.9, 4, 0, Math.PI * 2);
      g.fill();
    }
    // Speed trail.
    g.strokeStyle = color + "66";
    g.lineWidth = r;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - ball.velocity.x * 2.5, y - ball.velocity.y * 2.5);
    g.stroke();
    g.lineCap = "butt";
  }

  private drawParticles(g: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      g.globalAlpha = Math.min(1, (p.life / p.max) * 1.5);
      g.fillStyle = p.color;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.angle);
      g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      g.restore();
    }
    g.globalAlpha = 1;
  }

  private drawFloaters(g: CanvasRenderingContext2D): void {
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const f of this.floaters) {
      g.globalAlpha = Math.min(1, f.life * 2);
      g.font = `700 ${f.size}px Bebas Neue, Impact, sans-serif`;
      g.lineWidth = 5;
      g.strokeStyle = "rgba(7,11,20,0.9)";
      g.strokeText(f.text, f.x, f.y);
      g.fillStyle = f.color;
      g.fillText(f.text, f.x, f.y);
    }
    g.globalAlpha = 1;
  }

  private drawHeld(g: CanvasRenderingContext2D, t: Team): void {
    const held = this.held[t];
    const state = this.teams[t];
    const kind = this.queue[state.next];
    if (!held || !kind) return;
    const body = this.world.dropBody(kind, held.x, t, state.rotation);
    const cx = body?.position.x ?? held.x;
    g.strokeStyle = (body ? state.color : "#ef4444") + "88";
    g.setLineDash([6, 8]);
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx, TOP_Y - 60);
    g.lineTo(cx, GROUND_Y);
    g.stroke();
    g.setLineDash([]);
    if (!body) return;
    const ghost: Piece = { body, team: t, kind, hp: 1, maxHp: 1, cooldown: 0 };
    this.drawPiece(g, ghost, 0.6);
  }

  private drawAim(g: CanvasRenderingContext2D): void {
    if (this.realtime) {
      for (const t of [0, 1] as const) this.drawAimFor(g, t, this.aimVelocityOf(this.rt.aim[t]));
      return;
    }
    this.drawAimFor(g, this.shooter, this.turn === "aim" ? this.aimVelocity() : null);
  }

  private drawAimFor(g: CanvasRenderingContext2D, team: Team, v: { vx: number; vy: number; power: number } | null): void {
    if (!v || v.power < 0.05) return;
    const c = CANNONS[team];
    const color = this.teams[team].color;
    const points = previewArc(c, v.vx, v.vy);
    points.forEach((p, i) => {
      g.globalAlpha = 1 - i / points.length;
      g.fillStyle = color;
      g.beginPath();
      g.arc(p.x, p.y, 5 - (i / points.length) * 3, 0, Math.PI * 2);
      g.fill();
    });
    g.globalAlpha = 1;
    // Power meter by the cannon.
    g.fillStyle = "rgba(7,11,20,0.7)";
    g.fillRect(c.x - 24, c.y - 70, 48, 10);
    g.fillStyle = v.power > 0.9 ? "#FF3D7A" : color;
    g.fillRect(c.x - 24, c.y - 70, 48 * v.power, 10);
  }

  private drawIcon(g: CanvasRenderingContext2D, kind: PieceKind, cx: number, cy: number, box: number, rotation: number, color: string): void {
    const spec = PIECE_SPECS[kind];
    const scale = Math.min(1, box / Math.max(spec.w, spec.h));
    g.save();
    g.translate(cx, cy);
    g.rotate((rotation * Math.PI) / 2);
    g.scale(scale, scale);
    g.fillStyle = color;
    g.strokeStyle = "rgba(7,11,20,0.85)";
    g.lineWidth = 2.5 / scale;
    if (spec.shape === "wedge") {
      const ox = spec.w / 3;
      const oy = (2 * spec.h) / 3;
      this.tracePath(g, [
        { x: -ox, y: spec.h - oy },
        { x: spec.w - ox, y: spec.h - oy },
        { x: -ox, y: -oy },
      ]);
      g.fill();
      g.stroke();
    } else {
      g.fillRect(-spec.w / 2, -spec.h / 2, spec.w, spec.h);
      g.strokeRect(-spec.w / 2, -spec.h / 2, spec.w, spec.h);
    }
    g.restore();
  }

  private drawTray(g: CanvasRenderingContext2D, t: Team): void {
    const state = this.teams[t];
    const zone = ZONES[t];
    g.textAlign = "center";
    g.textBaseline = "middle";
    const left = this.queue.length - state.next;
    if (!state.kingPlaced) {
      const pulse = 0.6 + Math.sin(this.elapsed * 6) * 0.4;
      g.globalAlpha = pulse;
      g.fillStyle = "#FFD54A";
      g.font = "700 34px Bebas Neue, Impact, sans-serif";
      g.fillText(state.human ? "TAP TO PLACE YOUR KING" : "…", (zone.x0 + zone.x1) / 2, TRAY_Y + 50);
      g.globalAlpha = 1;
      return;
    }
    const kind = this.queue[state.next];
    // Now + next two.
    g.fillStyle = "rgba(255,255,255,0.1)";
    g.beginPath();
    g.roundRect(zone.x0, TRAY_Y + 8, 110, 84, 12);
    g.fill();
    if (kind) this.drawIcon(g, kind, zone.x0 + 55, TRAY_Y + 50, 70, state.rotation, state.color);
    for (let i = 1; i <= 3; i += 1) {
      const nk = this.queue[state.next + i];
      const x = zone.x0 + 110 + i * 62;
      if (nk) {
        g.globalAlpha = 0.75 - i * 0.15;
        this.drawIcon(g, nk, x - 20, TRAY_Y + 50, 42, 0, state.color);
        g.globalAlpha = 1;
      }
    }
    g.fillStyle = "#F4F7FB";
    g.font = "700 22px Bebas Neue, Impact, sans-serif";
    g.fillText(left > 0 ? `${left} LEFT` : "DONE!", zone.x0 + 370, TRAY_Y + 50);
    if (state.human) {
      const rot = this.rotateButton(t);
      g.fillStyle = "rgba(255,255,255,0.14)";
      g.beginPath();
      g.roundRect(rot.x, rot.y, rot.w, rot.h, 12);
      g.fill();
      g.fillStyle = "#F4F7FB";
      g.font = "700 38px Outfit, sans-serif";
      g.fillText("⟳", rot.x + rot.w / 2, rot.y + rot.h / 2);
    }
  }

  private drawSiegeHud(g: CanvasRenderingContext2D): void {
    if (this.realtime) {
      this.drawRealtimeHud(g);
      return;
    }
    const shooter = this.teams[this.shooter];
    // Ammo box.
    const ammo = this.turn === "roll" ? this.rollShown : this.ammo;
    const bx = W / 2 - 130;
    const by = TRAY_Y + 14;
    const golden = ammo === "golden" && this.turn !== "roll";
    g.fillStyle = "rgba(7,11,20,0.75)";
    g.strokeStyle = golden ? GOLD : shooter.color;
    g.lineWidth = golden ? 5 : 3;
    if (golden) {
      g.shadowColor = GOLD;
      g.shadowBlur = 18 + Math.sin(this.elapsed * 8) * 8;
    }
    g.beginPath();
    g.roundRect(bx, by, 260, 74, 14);
    g.fill();
    g.stroke();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowBlur = 0;
    g.fillStyle = this.turn === "roll" ? "#94a3b8" : golden ? GOLD : "#F4F7FB";
    g.font = "700 34px Bebas Neue, Impact, sans-serif";
    g.fillText(AMMO_LABELS[ammo], W / 2, by + 28);
    g.font = "600 15px Outfit, sans-serif";
    g.fillStyle = "#cbd5e1";
    const sudden = this.shots[this.shooter] >= SUDDEN_DEATH_AFTER;
    const hint = this.turn === "aim" ? (shooter.human ? "drag back & let go" : "aiming…") : this.turn === "roll" ? "rolling…" : "";
    g.fillText(sudden ? `SUDDEN DEATH · ${hint}` : hint, W / 2, by + 56);

    this.drawWind(g, this.turn === "roll");
  }

  private drawRealtimeHud(g: CanvasRenderingContext2D): void {
    for (const t of [0, 1] as const) {
      const state = this.teams[t];
      const ammo = this.rt.ammo[t];
      const reload = this.rt.reload[t];
      const ready = reload === 0;
      const golden = ammo === "golden" && ready;
      const w = 250;
      const bx = t === 0 ? ZONES[0].x0 + 20 : ZONES[1].x1 - 20 - w;
      const by = TRAY_Y + 14;
      g.fillStyle = "rgba(7,11,20,0.75)";
      g.strokeStyle = golden ? GOLD : state.color;
      g.lineWidth = ready ? 4 : 2;
      g.beginPath();
      g.roundRect(bx, by, w, 74, 14);
      g.fill();
      g.stroke();
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = ready ? (golden ? GOLD : "#F4F7FB") : "#64748b";
      g.font = "700 30px Bebas Neue, Impact, sans-serif";
      g.fillText(AMMO_LABELS[ammo], bx + w / 2, by + 26);
      // Reload bar.
      g.fillStyle = "#1e293b";
      g.fillRect(bx + 16, by + 48, w - 32, 8);
      g.fillStyle = ready ? state.color : "#94a3b8";
      g.fillRect(bx + 16, by + 48, (w - 32) * (1 - reload / REALTIME_RELOAD_S), 8);
      g.font = "600 13px Outfit, sans-serif";
      g.fillStyle = "#cbd5e1";
      g.fillText(ready ? (state.human ? "LOADED · drag back & let go" : "LOADED") : "RELOADING", bx + w / 2, by + 66);
    }
    this.drawWind(g, false);
  }

  private drawWind(g: CanvasRenderingContext2D, rolling: boolean): void {
    const wind = this.world.wind;
    const cx = W / 2;
    const cy = 120;
    const len = (Math.abs(wind) / WIND_MAX) * 140;
    const dir = Math.sign(wind);
    g.strokeStyle = "#9ad9ff";
    g.fillStyle = "#9ad9ff";
    g.lineWidth = 6;
    if (dir && !rolling) {
      const wob = Math.sin(this.elapsed * 10) * 3;
      g.beginPath();
      g.moveTo(cx - (dir * len) / 2, cy + wob);
      g.lineTo(cx + (dir * len) / 2, cy);
      g.stroke();
      g.beginPath();
      g.moveTo(cx + (dir * len) / 2 + dir * 16, cy);
      g.lineTo(cx + (dir * len) / 2, cy - 12);
      g.lineTo(cx + (dir * len) / 2, cy + 12);
      g.closePath();
      g.fill();
    }
    g.font = "700 20px Outfit, sans-serif";
    g.fillText(rolling ? "" : dir ? `WIND ${Math.abs(wind)}` : "CALM", cx, cy + 28);
  }

  private drawTopBar(g: CanvasRenderingContext2D): void {
    g.fillStyle = "rgba(7,11,20,0.65)";
    g.fillRect(0, 0, W, 82);
    g.textBaseline = "middle";
    for (const t of [0, 1] as const) {
      const state = this.teams[t];
      const left = t === 0;
      const x = left ? 30 : W - 30;
      g.textAlign = left ? "left" : "right";
      g.fillStyle = state.color;
      g.font = "700 32px Bebas Neue, Impact, sans-serif";
      g.fillText(state.name.toUpperCase(), x, 28);
      // Round pips.
      for (let i = 0; i < ROUNDS_TO_WIN; i += 1) {
        const px = left ? x + 8 + i * 22 : x - 8 - i * 22;
        g.beginPath();
        g.arc(px, 60, 7, 0, Math.PI * 2);
        g.fillStyle = i < this.wins[t] ? state.color : "rgba(255,255,255,0.15)";
        g.fill();
      }
      // King HP.
      const king = this.world.kings[t];
      const hp = king?.hp ?? (state.kingPlaced ? 0 : KING_HP);
      for (let i = 0; i < KING_HP; i += 1) {
        const hx = left ? x + 80 + i * 28 : x - 80 - i * 28;
        drawCrown(g, hx, 60, 22, i < hp ? "#FFD54A" : "rgba(255,255,255,0.15)");
      }
      g.globalAlpha = 1;
    }
    g.textAlign = "center";
    g.fillStyle = "#F4F7FB";
    g.font = "700 38px Bebas Neue, Impact, sans-serif";
    if (this.phase === "build") {
      const s = Math.max(0, Math.ceil(this.timer));
      g.fillStyle = s <= 5 ? "#FF3D7A" : "#F4F7FB";
      g.fillText(`BUILD ${s}`, W / 2, 42);
    } else if (this.phase === "siege" && this.realtime) {
      const left = Math.max(0, Math.ceil(REALTIME_SUDDEN_DEATH_S - this.rt.siegeTime));
      g.fillStyle = this.rt.sudden ? "#FF3D7A" : "#FFB020";
      g.fillText(this.rt.sudden ? "SUDDEN DEATH · BOMBS" : `FIRE AT WILL · ${left}`, W / 2, 42);
    } else if (this.phase === "siege") {
      g.fillStyle = this.teams[this.shooter].color;
      g.fillText(`${this.teams[this.shooter].name.toUpperCase()}'S SHOT`, W / 2, 42);
    } else {
      g.fillText(`ROUND ${this.round}`, W / 2, 42);
    }
  }

  private drawBanner(g: CanvasRenderingContext2D): void {
    const b = this.banner;
    if (!b) return;
    const t = Math.min(1, b.life * 3);
    const pop = 1 + Math.max(0, b.life - (b.total - 0.15)) * 3;
    g.globalAlpha = t;
    g.fillStyle = "rgba(7,11,20,0.7)";
    g.fillRect(0, 270, W, 120);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.save();
    g.translate(W / 2, 318);
    g.scale(pop, pop);
    g.font = "700 76px Bebas Neue, Impact, sans-serif";
    g.lineWidth = 8;
    g.strokeStyle = "rgba(7,11,20,0.9)";
    g.strokeText(b.text, 0, 0);
    g.fillStyle = b.color;
    g.fillText(b.text, 0, 0);
    g.restore();
    g.font = "600 20px Outfit, sans-serif";
    g.fillStyle = "#cbd5e1";
    g.fillText(b.sub, W / 2, 368);
    g.globalAlpha = 1;
  }

  private drawMatchOver(g: CanvasRenderingContext2D): void {
    const champ = matchWinner(this.wins);
    g.fillStyle = "rgba(7,11,20,0.85)";
    g.fillRect(0, 82, W, H - 82);
    g.textAlign = "center";
    g.textBaseline = "middle";
    const state = champ === null ? null : this.teams[champ];
    const bob = Math.sin(this.elapsed * 3) * 6;
    drawCrown(g, W / 2, 200 + bob, 90, "#FFD54A");
    g.font = "700 84px Bebas Neue, Impact, sans-serif";
    g.fillStyle = state?.color ?? "#F4F7FB";
    g.fillText(state ? `${state.name.toUpperCase()} RULES!` : "STALEMATE", W / 2, 300);
    g.font = "600 22px Outfit, sans-serif";
    g.fillStyle = "#cbd5e1";
    g.fillText(`${this.wins[0]} – ${this.wins[1]} in rounds`, W / 2, 360);
    for (const t of [0, 1] as const) {
      const s = this.teams[t];
      const x = t === 0 ? W / 2 - 220 : W / 2 + 220;
      g.fillStyle = s.color;
      g.font = "700 30px Bebas Neue, Impact, sans-serif";
      g.fillText(s.name.toUpperCase(), x, 430);
      g.fillStyle = "#F4F7FB";
      g.font = "500 20px Outfit, sans-serif";
      g.fillText(`${s.smashed} blocks smashed`, x, 468);
      g.fillText(`best shot: ${s.bestCombo}`, x, 498);
    }
    if (this.timer <= 0 && this.teams.some((team) => team.human)) {
      g.fillStyle = "#94a3b8";
      g.font = "500 18px Outfit, sans-serif";
      g.globalAlpha = 0.6 + Math.sin(this.elapsed * 4) * 0.4;
      g.fillText("Tap to continue", W / 2, 640);
      g.globalAlpha = 1;
    }
  }

  // ---------- lifecycle ----------

  isFinished(): boolean {
    return this.done;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.ctx.players.map((player, index) => {
      const t = teamOf(index);
      return { playerId: player.id, score: this.wins[t] * 100 + this.teams[t].smashed };
    });
  }

  getStats(): GameStat[] {
    const stats: GameStat[] = [];
    for (let i = 0; i < this.ctx.players.length; i++) {
      const t = teamOf(i);
      const id = this.ctx.players[i]!.id;
      const s = this.teams[t];
      stats.push({ playerId: id, label: "Smashed", value: String(s.smashed) });
      if (s.bestCombo > 0) stats.push({ playerId: id, label: "Best shot", value: `${s.bestCombo} blocks` });
      stats.push({ playerId: id, label: "Shots", value: String(this.shots[t]) });
    }
    return stats;
  }

  destroy(): void {
    const canvas = this.ctx.canvas;
    canvas.removeEventListener("pointerdown", this.onDown);
    canvas.removeEventListener("pointermove", this.onMove);
    canvas.removeEventListener("pointerup", this.onUp);
    canvas.removeEventListener("pointercancel", this.onCancel);
    this.world.destroyWorld();
  }
}

function drawCrown(g: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  const s = size / 2;
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x - s, y + s * 0.6);
  g.lineTo(x - s, y - s * 0.5);
  g.lineTo(x - s * 0.45, y);
  g.lineTo(x, y - s * 0.8);
  g.lineTo(x + s * 0.45, y);
  g.lineTo(x + s, y - s * 0.5);
  g.lineTo(x + s, y + s * 0.6);
  g.closePath();
  g.fill();
}

export const castleSiege: GameDefinition = {
  id: "castle-siege",
  name: "Castle Siege",
  tagline: "Stack a fortress. Bomb their king.",
  description:
    "Hide your king, then drop pieces from the sky to wall him in. When the timer ends, fire random ammo (cannonballs, bombs, triple shots, boulders, and the rare golden ball) through the wind. Your last shot's path stays as a ghost so you can adjust. Blocks crack and shatter. Three hits and a king is done. First to two rounds wins. Real-time mode: no turns, both cannons fire whenever they're reloaded.",
  durationMs: 0,
  controls: "Pick Turns or Real-time · Tap to place king · hold & slide, release to drop · ⟳ rotates · drag back & release to fire",
  create: (ctx) =>
    new ModePicker(
      ctx,
      "CASTLE SIEGE",
      [
        { title: "TAKE TURNS", line1: "Aim, fire, watch.", line2: "One cannon at a time.", color: "#3EE0FF", create: (c) => new CastleSiege(c) },
        { title: "REAL-TIME", line1: "Both cannons fire whenever", line2: "they're reloaded. No turns.", color: "#FF3D7A", create: (c) => new CastleSiege(c, true) },
      ],
      !ctx.players.some((p) => p.kind === "human"),
    ),
};

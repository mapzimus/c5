import type Matter from "matter-js";
import { fillArena } from "../../core/draw";
import type { MinigameContext, MinigameDefinition, MinigameInstance, Player } from "../../core/types";
import {
  GAME_SIZES,
  HANDOFF_SECONDS,
  PIECE_KINDS,
  PIECE_SPECS,
  SETTLE_SECONDS,
  SHOTS_PER_TEAM,
  WIND_MAX,
  baseCount,
  buildSeconds,
  countTotal,
  drawPieces,
  emptyCounts,
  gaussian,
  isKnockout,
  nextShooter,
  outcome,
  rollWind,
  teamOf,
  type GameSize,
  type Outcome,
  type PieceCounts,
  type PieceKind,
  type Team,
} from "./rules";
import { CANNONS, GROUND_Y, MAX_SHOT_SPEED, SiegeWorld, ZONES, makePieceBody, simulateShot } from "./world";

type Phase = "size" | "build" | "settle" | "siege" | "summary";

const W = 1280;
const H = 720;
const SLOT_W = 64;
const TRAY_Y = 606;
const TRAY_H = 96;
const AIM_SCALE = 0.11;
const TOUCH_LIFT = 60;

interface TeamState {
  players: Player[];
  color: string;
  name: string;
  human: boolean;
  tray: PieceCounts;
  placed: number;
  rotation: number;
  ready: boolean;
  leftover: number;
  settleLost: number;
}

interface Held {
  team: Team;
  kind: PieceKind;
  pointerId: number;
  x: number;
  y: number;
  lift: number;
}

interface Aim {
  pointerId: number;
  sx: number;
  sy: number;
  x: number;
  y: number;
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

class CastleSiege implements MinigameInstance {
  private readonly world = new SiegeWorld();
  private readonly teams: [TeamState, TeamState];
  private phase: Phase = "size";
  private size: GameSize = 20;
  private timer = 0;
  private buildElapsed = 0;
  private handoffFlash = 0;
  private held: (Held | null)[] = [null, null];
  private aim: Aim | null = null;
  private shooter: Team = 0;
  private shotsTaken: [number, number] = [0, 0];
  private shotState: "aim" | "flight" | "settling" = "aim";
  private shotTimer = 0;
  private botTimer: [number, number] = [0, 0];
  private result: Outcome = "draw";
  private knockout = false;
  private done = false;
  private message = "";
  private messageTimer = 0;

  constructor(private readonly ctx: MinigameContext) {
    const makeTeam = (team: Team): TeamState => {
      const players = ctx.players.filter((_, index) => teamOf(index) === team);
      const first = players[0];
      return {
        players,
        color: first?.color ?? (team === 0 ? "#3EE0FF" : "#FF3D7A"),
        name: first ? `Team ${first.name}` : team === 0 ? "Left" : "Right",
        human: players.some((player) => player.kind === "human"),
        tray: emptyCounts(),
        placed: 0,
        rotation: 0,
        ready: false,
        leftover: 0,
        settleLost: 0,
      };
    };
    this.teams = [makeTeam(0), makeTeam(1)];
    if (!this.teams[1].players.length) this.teams[1].human = false;
    const canvas = ctx.canvas;
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onCancel);
    if (!this.teams[0].human && !this.teams[1].human) this.startBuild(20);
  }

  // ---------- flow ----------

  private startBuild(size: GameSize): void {
    this.size = size;
    const draw = drawPieces(this.ctx.rng, size);
    for (const team of this.teams) team.tray = { ...draw };
    this.phase = "build";
    this.timer = buildSeconds(size);
    this.buildElapsed = 0;
    this.ctx.sfx.go();
  }

  private endBuild(): void {
    this.held = [null, null];
    for (const team of this.teams) {
      team.leftover = countTotal(team.tray);
      for (const kind of PIECE_KINDS) team.tray[kind] = 0;
    }
    this.phase = "settle";
    this.timer = SETTLE_SECONDS;
    this.flash("Settle… anything on the ground is out");
  }

  private endSettle(): void {
    const lost = this.world.eliminateGrounded();
    this.teams[0].settleLost = lost[0];
    this.teams[1].settleLost = lost[1];
    if (lost[0] + lost[1] > 0) this.ctx.sfx.hit();
    if (isKnockout(this.standing())) {
      this.finishSiege(true);
      return;
    }
    this.phase = "siege";
    this.shooter = 0;
    this.beginShot();
  }

  private beginShot(): void {
    this.shotState = "aim";
    this.aim = null;
    this.world.wind = rollWind(this.ctx.rng);
    this.botTimer[this.shooter] = 1.1;
  }

  private resolveShot(): void {
    this.world.clearBall();
    if (isKnockout(this.standing())) {
      this.finishSiege(true);
      return;
    }
    const next = nextShooter(this.shotsTaken, this.shooter);
    if (next === null) {
      this.finishSiege(false);
      return;
    }
    this.shooter = next;
    this.beginShot();
  }

  private finishSiege(knockout: boolean): void {
    this.knockout = knockout;
    this.result = outcome(this.standing());
    this.phase = "summary";
    this.timer = 1;
    this.world.clearBall();
    this.ctx.sfx.win();
  }

  private standing(): [number, number] {
    return [this.world.standing(0), this.world.standing(1)];
  }

  private flash(text: string): void {
    this.message = text;
    this.messageTimer = 2;
  }

  // ---------- update ----------

  update(dt: number): void {
    if (this.done) return;
    this.messageTimer = Math.max(0, this.messageTimer - dt);
    this.handoffFlash = Math.max(0, this.handoffFlash - dt);

    if (this.phase === "build") {
      this.world.step(dt);
      this.timer -= dt;
      this.buildElapsed += dt;
      const handoffs = Math.floor(this.buildElapsed / HANDOFF_SECONDS);
      if (handoffs > Math.floor((this.buildElapsed - dt) / HANDOFF_SECONDS) && this.timer > 1) {
        if (this.teams.some((team) => team.human)) {
          this.handoffFlash = 1.6;
          this.ctx.sfx.go();
        }
      }
      for (const t of [0, 1] as const) this.updateBotBuild(t, dt);
      const allDone = this.teams.every((team) => team.ready || countTotal(team.tray) === 0);
      if (this.timer <= 0 || allDone) this.endBuild();
      return;
    }

    if (this.phase === "settle") {
      this.world.step(dt);
      this.timer -= dt;
      // At least the settle time, longer while things are still tipping over.
      const still = this.world.maxPieceSpeed() < 0.15;
      if ((this.timer <= 0 && still) || this.timer < -SETTLE_SECONDS) this.endSettle();
      return;
    }

    if (this.phase === "siege") {
      this.world.step(dt);
      const lost = this.world.eliminateGrounded();
      if (lost[0] + lost[1] > 0) this.ctx.sfx.collect();
      if (this.shotState === "aim") {
        if (!this.teams[this.shooter].human) {
          this.botTimer[this.shooter] -= dt;
          if (this.botTimer[this.shooter] <= 0) this.botShoot();
        }
      } else if (this.shotState === "flight") {
        this.shotTimer += dt;
        const ball = this.world.ball;
        const resting = ball ? ball.speed < 0.4 && this.shotTimer > 1 : true;
        if (this.world.ballOut() || resting || this.shotTimer > 8) {
          this.shotState = "settling";
          this.shotTimer = 0;
        }
      } else {
        this.shotTimer += dt;
        const still = this.world.maxPieceSpeed() < 0.25 && !this.world.shotPending();
        if ((this.shotTimer > 1 && still) || this.shotTimer > 3.5) this.resolveShot();
      }
      return;
    }

    if (this.phase === "summary") this.timer = Math.max(0, this.timer - dt);
  }

  // ---------- building ----------

  private placeKind(team: Team, kind: PieceKind, x: number, y: number): boolean {
    const state = this.teams[team];
    if (state.tray[kind] <= 0) return false;
    const base = state.placed < baseCount(this.size);
    const body = makePieceBody(kind, x, y, (state.rotation * Math.PI) / 2, team, base);
    if (base) this.world.snapToGround(body);
    if (!this.world.fits(body, team)) return false;
    this.world.addPiece({ body, team, kind, base });
    state.tray[kind] -= 1;
    state.placed += 1;
    this.ctx.sfx.tick();
    return true;
  }

  private updateBotBuild(team: Team, dt: number): void {
    const state = this.teams[team];
    if (state.human || state.ready) return;
    this.botTimer[team] -= dt;
    if (this.botTimer[team] > 0) return;
    this.botTimer[team] = 0.7;
    const kinds = PIECE_KINDS.filter((kind) => state.tray[kind] > 0);
    if (!kinds.length) {
      state.ready = true;
      return;
    }
    const zone = ZONES[team];
    const base = state.placed < baseCount(this.size);
    // Bases: widest first. Tower: prefer flat pieces, keep pillars upright.
    const kind = base
      ? kinds.reduce((a, b) => (PIECE_SPECS[b].w > PIECE_SPECS[a].w ? b : a))
      : this.ctx.rng.pick(kinds);
    state.rotation = 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (base) {
        const center = (zone.x0 + zone.x1) / 2;
        const x = center + (state.placed - (baseCount(this.size) - 1) / 2) * 100 + this.ctx.rng.float(-10, 10);
        if (this.placeKind(team, kind, x, GROUND_Y - 40)) return;
        continue;
      }
      const bases = this.world.pieces.filter((piece) => piece.team === team && piece.base);
      const anchor = this.ctx.rng.pick(bases.length ? bases : this.world.pieces.filter((p) => p.team === team));
      if (!anchor) break;
      const x = anchor.body.position.x + this.ctx.rng.float(-30, 30);
      const body = makePieceBody(kind, x, 0, 0, team, false);
      if (!this.world.dropFromTop(body)) continue;
      if (this.placeKind(team, kind, body.position.x, body.position.y)) return;
    }
    // Could not find a spot: give up on this piece so the bot does not stall.
    state.tray[kind] -= 1;
  }

  // ---------- shooting ----------

  private botShoot(): void {
    const team = this.shooter;
    const enemy: Team = team === 0 ? 1 : 0;
    const targets = this.world.pieces.filter((piece) => piece.team === enemy && !piece.base);
    const from = CANNONS[team];
    const tx = targets.length
      ? targets.reduce((sum, piece) => sum + piece.body.position.x, 0) / targets.length
      : (ZONES[enemy].x0 + ZONES[enemy].x1) / 2;
    const ty = targets.length ? Math.min(...targets.map((piece) => piece.body.position.y)) + 20 : GROUND_Y - 60;
    const dir = tx > from.x ? 1 : -1;
    const angle = 0.95;
    // Bots read the wind, but only half-trust it.
    const felt = this.world.wind * 0.5;
    let best = { speed: 18, err: Infinity };
    for (let speed = 8; speed <= MAX_SHOT_SPEED; speed += 0.25) {
      const y = simulateShot(from, Math.cos(angle) * speed * dir, -Math.sin(angle) * speed, felt, tx);
      if (y === null) continue;
      const err = Math.abs(y - ty);
      if (err < best.err) best = { speed, err };
    }
    const speed = best.speed + gaussian(this.ctx.rng) * 0.4;
    this.fire(Math.cos(angle) * speed * dir, -Math.sin(angle) * speed);
  }

  private fire(vx: number, vy: number): void {
    this.world.fire(this.shooter, vx, vy);
    this.shotsTaken[this.shooter] += 1;
    this.shotState = "flight";
    this.shotTimer = 0;
    this.aim = null;
    this.ctx.sfx.hit();
  }

  // ---------- input ----------

  private toLogical(event: PointerEvent): { x: number; y: number } {
    const rect = this.ctx.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    return { x: ((event.clientX - rect.left) / rect.width) * W, y: ((event.clientY - rect.top) / rect.height) * H };
  }

  private slot(team: Team, index: number): Button {
    return { x: ZONES[team].x0 + index * SLOT_W, y: TRAY_Y + 6, w: SLOT_W - 4, h: TRAY_H - 12 };
  }

  private rotateButton(team: Team): Button {
    return { x: ZONES[team].x0 + PIECE_KINDS.length * SLOT_W, y: TRAY_Y + 6, w: 60, h: TRAY_H - 12 };
  }

  private doneButton(team: Team): Button {
    const x = ZONES[team].x0 + PIECE_KINDS.length * SLOT_W + 64;
    return { x, y: TRAY_Y + 6, w: ZONES[team].x1 - x, h: TRAY_H - 12 };
  }

  private sizeButton(index: number): Button {
    return { x: W / 2 - 260 + index * 280, y: 330, w: 240, h: 130 };
  }

  private readonly onDown = (event: PointerEvent): void => {
    event.preventDefault();
    this.ctx.sfx.unlock();
    const { x, y } = this.toLogical(event);
    const team: Team = x < W / 2 ? 0 : 1;

    if (this.phase === "size") {
      GAME_SIZES.forEach((size, index) => {
        if (inside(this.sizeButton(index), x, y)) this.startBuild(size);
      });
      return;
    }

    if (this.phase === "build") {
      const state = this.teams[team];
      if (!state.human || state.ready || this.held[team]) return;
      if (inside(this.rotateButton(team), x, y)) {
        state.rotation = (state.rotation + 1) % 4;
        this.ctx.sfx.tick();
        return;
      }
      if (inside(this.doneButton(team), x, y)) {
        state.ready = true;
        return;
      }
      PIECE_KINDS.forEach((kind, index) => {
        if (state.tray[kind] > 0 && inside(this.slot(team, index), x, y)) {
          const lift = event.pointerType === "touch" ? TOUCH_LIFT : 0;
          this.held[team] = { team, kind, pointerId: event.pointerId, x, y: y - lift, lift };
          this.capture(event);
        }
      });
      return;
    }

    if (this.phase === "siege") {
      if (this.shotState !== "aim" || team !== this.shooter || !this.teams[team].human || this.aim) return;
      this.aim = { pointerId: event.pointerId, sx: x, sy: y, x, y };
      this.capture(event);
      return;
    }

    if (this.phase === "summary" && this.timer <= 0) this.done = true;
  };

  private readonly onMove = (event: PointerEvent): void => {
    const { x, y } = this.toLogical(event);
    for (const held of this.held) {
      if (held && held.pointerId === event.pointerId) {
        held.x = x;
        held.y = y - held.lift;
      }
    }
    if (this.aim && this.aim.pointerId === event.pointerId) {
      this.aim.x = x;
      this.aim.y = y;
    }
  };

  private readonly onUp = (event: PointerEvent): void => {
    for (const t of [0, 1] as const) {
      const held = this.held[t];
      if (held && held.pointerId === event.pointerId) {
        this.held[t] = null;
        if (this.phase === "build" && !this.placeKind(t, held.kind, held.x, held.y)) this.ctx.sfx.miss();
      }
    }
    const aim = this.aim;
    if (aim && aim.pointerId === event.pointerId) {
      this.aim = null;
      const vx = (aim.sx - aim.x) * AIM_SCALE;
      const vy = (aim.sy - aim.y) * AIM_SCALE;
      if (this.phase === "siege" && this.shotState === "aim" && Math.hypot(vx, vy) > 3) this.fire(vx, vy);
    }
  };

  private readonly onCancel = (event: PointerEvent): void => {
    for (const t of [0, 1] as const) if (this.held[t]?.pointerId === event.pointerId) this.held[t] = null;
    if (this.aim?.pointerId === event.pointerId) this.aim = null;
  };

  private capture(event: PointerEvent): void {
    try {
      this.ctx.canvas.setPointerCapture(event.pointerId);
    } catch {
      /* optional */
    }
  }

  // ---------- render ----------

  render(g: CanvasRenderingContext2D): void {
    fillArena(g, W, H);
    if (this.phase === "size") {
      this.drawSizePicker(g);
      return;
    }
    this.drawZones(g);
    for (const piece of this.world.pieces) this.drawBody(g, piece.body, this.teams[piece.team].color, piece.base);
    for (const t of [0, 1] as const) this.drawCannon(g, t);
    if (this.world.ball) this.drawBall(g, this.world.ball, this.teams[this.world.ballTeam].color);
    if (this.phase === "build") {
      for (const t of [0, 1] as const) this.drawTray(g, t);
      for (const held of this.held) if (held) this.drawHeld(g, held);
    }
    if (this.phase === "siege") this.drawSiegeHud(g);
    this.drawTopBar(g);
    if (this.phase === "summary") this.drawSummary(g);
    if (this.handoffFlash > 0) this.banner(g, "SWAP BUILDERS!", "#FFB020", Math.min(1, this.handoffFlash));
    else if (this.messageTimer > 0) this.banner(g, this.message, "#F4F7FB", Math.min(1, this.messageTimer));
  }

  private drawSizePicker(g: CanvasRenderingContext2D): void {
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#F4F7FB";
    g.font = "700 72px Bebas Neue, Impact, sans-serif";
    g.fillText("CASTLE SIEGE", W / 2, 170);
    g.font = "500 22px Outfit, sans-serif";
    g.fillStyle = "#94a3b8";
    g.fillText("Same random pieces for both sides. Build, survive the settle, then trade shots.", W / 2, 240);
    GAME_SIZES.forEach((size, index) => {
      const b = this.sizeButton(index);
      g.fillStyle = "rgba(62,224,255,0.12)";
      g.strokeStyle = "#3EE0FF";
      g.lineWidth = 3;
      g.beginPath();
      g.roundRect(b.x, b.y, b.w, b.h, 18);
      g.fill();
      g.stroke();
      g.fillStyle = "#F4F7FB";
      g.font = "700 56px Bebas Neue, Impact, sans-serif";
      g.fillText(`${size} PIECES`, b.x + b.w / 2, b.y + 52);
      g.font = "500 18px Outfit, sans-serif";
      g.fillStyle = "#94a3b8";
      g.fillText(`${baseCount(size)} base · ${buildSeconds(size) / 60} min build`, b.x + b.w / 2, b.y + 100);
    });
  }

  private drawZones(g: CanvasRenderingContext2D): void {
    for (const t of [0, 1] as const) {
      const zone = ZONES[t];
      g.fillStyle = this.teams[t].color;
      g.globalAlpha = 0.05;
      g.fillRect(zone.x0, 90, zone.x1 - zone.x0, GROUND_Y - 90);
      g.globalAlpha = 1;
    }
    g.fillStyle = "#1c2a1f";
    g.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    g.fillStyle = "#3f6b3a";
    g.fillRect(0, GROUND_Y, W, 5);
  }

  private tracePath(g: CanvasRenderingContext2D, vertices: readonly { x: number; y: number }[]): void {
    g.beginPath();
    vertices.forEach((v, i) => (i ? g.lineTo(v.x, v.y) : g.moveTo(v.x, v.y)));
    g.closePath();
  }

  private drawBody(g: CanvasRenderingContext2D, body: Matter.Body, color: string, base: boolean): void {
    const parts = body.parts.length > 1 ? body.parts.slice(1) : [body];
    for (const part of parts) {
      this.tracePath(g, part.vertices);
      g.fillStyle = base ? "#4b5563" : color;
      g.globalAlpha = base ? 1 : 0.85;
      g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = base ? color : "rgba(7,11,20,0.7)";
      g.lineWidth = base ? 3 : 2;
      g.stroke();
    }
  }

  private drawCannon(g: CanvasRenderingContext2D, t: Team): void {
    const c = CANNONS[t];
    g.fillStyle = this.teams[t].color;
    g.beginPath();
    g.arc(c.x, c.y + 4, 18, Math.PI, 0);
    g.fill();
    g.fillRect(c.x - 20, c.y + 4, 40, GROUND_Y - c.y - 4);
  }

  private drawBall(g: CanvasRenderingContext2D, ball: Matter.Body, color: string): void {
    g.fillStyle = "#e5e7eb";
    g.strokeStyle = color;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(ball.position.x, ball.position.y, ball.circleRadius ?? 15, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }

  private drawPieceIcon(g: CanvasRenderingContext2D, kind: PieceKind, cx: number, cy: number, scale: number, rotation: number, color: string): void {
    const spec = PIECE_SPECS[kind];
    g.save();
    g.translate(cx, cy);
    g.rotate((rotation * Math.PI) / 2);
    g.scale(scale, scale);
    g.fillStyle = color;
    if (spec.shape === "wedge") {
      // Centroid of the right triangle sits a third of the way in.
      const ox = spec.w / 3;
      const oy = (2 * spec.h) / 3;
      this.tracePath(g, [
        { x: -ox, y: spec.h - oy },
        { x: spec.w - ox, y: spec.h - oy },
        { x: -ox, y: -oy },
      ]);
      g.fill();
    } else {
      g.fillRect(-spec.w / 2, -spec.h / 2, spec.w, spec.h);
    }
    g.restore();
  }

  private drawTray(g: CanvasRenderingContext2D, t: Team): void {
    const state = this.teams[t];
    g.textAlign = "center";
    g.textBaseline = "middle";
    PIECE_KINDS.forEach((kind, index) => {
      const b = this.slot(t, index);
      const count = state.tray[kind];
      g.fillStyle = count > 0 ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.02)";
      g.fillRect(b.x, b.y, b.w, b.h);
      const spec = PIECE_SPECS[kind];
      const scale = Math.min(1, 46 / Math.max(spec.w, spec.h));
      g.globalAlpha = count > 0 ? 1 : 0.25;
      this.drawPieceIcon(g, kind, b.x + b.w / 2, b.y + 34, scale, state.rotation, state.color);
      g.globalAlpha = 1;
      g.fillStyle = "#F4F7FB";
      g.font = "700 18px Outfit, sans-serif";
      g.fillText(`×${count}`, b.x + b.w / 2, b.y + b.h - 12);
    });
    const rot = this.rotateButton(t);
    g.fillStyle = "rgba(255,255,255,0.12)";
    g.fillRect(rot.x, rot.y, rot.w, rot.h);
    g.fillStyle = "#F4F7FB";
    g.font = "700 30px Outfit, sans-serif";
    g.fillText("⟳", rot.x + rot.w / 2, rot.y + rot.h / 2);
    const done = this.doneButton(t);
    g.fillStyle = state.ready ? state.color : "rgba(255,255,255,0.12)";
    g.fillRect(done.x, done.y, done.w, done.h);
    g.fillStyle = state.ready ? "#070b14" : "#F4F7FB";
    g.font = "700 20px Bebas Neue, Impact, sans-serif";
    g.fillText(state.ready ? "READY" : "DONE", done.x + done.w / 2, done.y + done.h / 2);

    const bases = baseCount(this.size);
    const zone = ZONES[t];
    g.font = "600 17px Outfit, sans-serif";
    g.fillStyle = state.color;
    const hint =
      state.placed < bases
        ? `Base ${state.placed + 1}/${bases}: snaps to the ground and locks`
        : `${countTotal(state.tray)} left: every leftover is lost`;
    g.fillText(state.human ? hint : `${state.name} (bot) building…`, (zone.x0 + zone.x1) / 2, 112);
  }

  private drawHeld(g: CanvasRenderingContext2D, held: Held): void {
    const state = this.teams[held.team];
    const base = state.placed < baseCount(this.size);
    const body = makePieceBody(held.kind, held.x, held.y, (state.rotation * Math.PI) / 2, held.team, base);
    if (base) this.world.snapToGround(body);
    const ok = this.world.fits(body, held.team);
    g.globalAlpha = 0.6;
    this.drawBody(g, body, ok ? state.color : "#ef4444", base);
    g.globalAlpha = 1;
  }

  private drawSiegeHud(g: CanvasRenderingContext2D): void {
    // Wind arrow, top center.
    const wind = this.world.wind;
    const cx = W / 2;
    const cy = 128;
    const len = (Math.abs(wind) / WIND_MAX) * 150;
    const dir = Math.sign(wind);
    g.strokeStyle = "#9ad9ff";
    g.fillStyle = "#9ad9ff";
    g.lineWidth = 6;
    if (dir) {
      g.beginPath();
      g.moveTo(cx - (dir * len) / 2, cy);
      g.lineTo(cx + (dir * len) / 2, cy);
      g.stroke();
      g.beginPath();
      g.moveTo(cx + (dir * len) / 2 + dir * 14, cy);
      g.lineTo(cx + (dir * len) / 2, cy - 11);
      g.lineTo(cx + (dir * len) / 2, cy + 11);
      g.closePath();
      g.fill();
    }
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "700 22px Outfit, sans-serif";
    g.fillText(dir ? `WIND ${Math.abs(wind)} ${dir > 0 ? "→" : "←"}` : "NO WIND", cx, cy + 30);

    if (this.aim && this.shotState === "aim") {
      const c = CANNONS[this.shooter];
      let vx = (this.aim.sx - this.aim.x) * AIM_SCALE;
      let vy = (this.aim.sy - this.aim.y) * AIM_SCALE;
      const speed = Math.hypot(vx, vy);
      if (speed > MAX_SHOT_SPEED) {
        vx = (vx / speed) * MAX_SHOT_SPEED;
        vy = (vy / speed) * MAX_SHOT_SPEED;
      }
      g.strokeStyle = this.teams[this.shooter].color;
      g.lineWidth = 4;
      g.setLineDash([10, 8]);
      g.beginPath();
      g.moveTo(c.x, c.y);
      g.lineTo(c.x + vx * 8, c.y + vy * 8);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = "#F4F7FB";
      g.font = "600 16px Outfit, sans-serif";
      g.fillText(`${Math.round((Math.min(speed, MAX_SHOT_SPEED) / MAX_SHOT_SPEED) * 100)}%`, c.x + vx * 8, c.y + vy * 8 - 16);
    }
  }

  private drawTopBar(g: CanvasRenderingContext2D): void {
    g.fillStyle = "rgba(7,11,20,0.6)";
    g.fillRect(0, 0, W, 86);
    const standing = this.standing();
    g.textBaseline = "middle";
    for (const t of [0, 1] as const) {
      const state = this.teams[t];
      g.textAlign = t === 0 ? "left" : "right";
      const x = t === 0 ? 30 : W - 30;
      g.fillStyle = state.color;
      g.font = "700 30px Bebas Neue, Impact, sans-serif";
      g.fillText(state.name, x, 28);
      g.font = "600 17px Outfit, sans-serif";
      g.fillStyle = "#cbd5e1";
      const line =
        this.phase === "build"
          ? `placed ${state.placed} · tray ${countTotal(state.tray)}`
          : `standing ${standing[t]} · shots ${this.shotsTaken[t]}/${SHOTS_PER_TEAM}`;
      g.fillText(line, x, 60);
    }
    g.textAlign = "center";
    g.fillStyle = "#F4F7FB";
    g.font = "700 34px Bebas Neue, Impact, sans-serif";
    let center = "";
    if (this.phase === "build") {
      const s = Math.max(0, Math.ceil(this.timer));
      center = `BUILD ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    } else if (this.phase === "settle") center = `SETTLE ${Math.max(0, Math.ceil(this.timer))}`;
    else if (this.phase === "siege") {
      const who = this.teams[this.shooter];
      g.fillStyle = who.color;
      const verb = this.shotState === "aim" ? (who.human ? "drag back & release" : "aiming…") : "";
      center = `${who.name} · shot ${Math.min(this.shotsTaken[this.shooter] + (this.shotState === "aim" ? 1 : 0), SHOTS_PER_TEAM)}/${SHOTS_PER_TEAM}`;
      g.fillText(center, W / 2, 28);
      g.font = "600 17px Outfit, sans-serif";
      g.fillStyle = "#cbd5e1";
      g.fillText(verb, W / 2, 62);
      return;
    }
    g.fillText(center, W / 2, 40);
  }

  private drawSummary(g: CanvasRenderingContext2D): void {
    g.fillStyle = "rgba(7,11,20,0.9)";
    g.fillRect(0, 86, W, H - 86);
    g.textAlign = "center";
    g.textBaseline = "middle";
    const winner = this.result === "draw" ? null : this.teams[this.result];
    g.fillStyle = winner?.color ?? "#F4F7FB";
    g.font = "700 60px Bebas Neue, Impact, sans-serif";
    g.fillText(winner ? `${winner.name} wins${this.knockout ? " by knockout" : ""}` : "Draw", W / 2, 140);

    // Tower stats, left column.
    g.textAlign = "left";
    g.font = "600 19px Outfit, sans-serif";
    const standing = this.standing();
    for (const t of [0, 1] as const) {
      const s = this.teams[t];
      const y = 210 + t * 150;
      g.fillStyle = s.color;
      g.font = "700 26px Bebas Neue, Impact, sans-serif";
      g.fillText(s.name, 70, y);
      g.font = "500 18px Outfit, sans-serif";
      g.fillStyle = "#cbd5e1";
      g.fillText(`Leftover (unplaced): ${s.leftover}`, 70, y + 30);
      g.fillText(`Fell in the settle: ${s.settleLost}`, 70, y + 56);
      g.fillText(`Still standing: ${standing[t]}`, 70, y + 82);
    }

    this.drawScatter(g, { x: 470, y: 190, w: 740, h: 400 });

    if (this.timer <= 0) {
      g.textAlign = "center";
      g.fillStyle = "#94a3b8";
      g.font = "500 18px Outfit, sans-serif";
      g.fillText("Tap to continue", W / 2, 690);
    }
  }

  /** Wind (x) vs how far it pushed each shot sideways (y). */
  private drawScatter(g: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }): void {
    const shots = this.world.shots;
    const maxDrift = Math.max(100, ...shots.map((shot) => Math.abs(shot.drift)));
    const px = (wind: number) => box.x + ((wind + WIND_MAX) / (2 * WIND_MAX)) * box.w;
    const py = (drift: number) => box.y + box.h / 2 - (drift / maxDrift) * (box.h / 2);
    g.strokeStyle = "rgba(148,163,184,0.4)";
    g.lineWidth = 1;
    g.strokeRect(box.x, box.y, box.w, box.h);
    g.beginPath();
    g.moveTo(px(0), box.y);
    g.lineTo(px(0), box.y + box.h);
    g.moveTo(box.x, py(0));
    g.lineTo(box.x + box.w, py(0));
    g.stroke();
    g.fillStyle = "#94a3b8";
    g.font = "500 15px Outfit, sans-serif";
    g.textAlign = "center";
    g.fillText(`wind (← ${WIND_MAX}  ·  ${WIND_MAX} →)`, box.x + box.w / 2, box.y + box.h + 20);
    g.fillText(`Every shot: how much did the wind push it?`, box.x + box.w / 2, box.y - 18);
    g.save();
    g.translate(box.x - 18, box.y + box.h / 2);
    g.rotate(-Math.PI / 2);
    g.fillText(`sideways drift (±${maxDrift} px)`, 0, 0);
    g.restore();
    for (const shot of shots) {
      g.fillStyle = this.teams[shot.team].color;
      g.beginPath();
      g.arc(px(shot.wind), py(shot.drift), 7, 0, Math.PI * 2);
      g.fill();
    }
    if (!shots.length) {
      g.fillStyle = "#64748b";
      g.fillText("No shots fired", box.x + box.w / 2, box.y + box.h / 2 - 20);
    }
  }

  private banner(g: CanvasRenderingContext2D, text: string, color: string, alpha: number): void {
    g.globalAlpha = alpha;
    g.fillStyle = "rgba(7,11,20,0.75)";
    g.fillRect(0, 290, W, 80);
    g.fillStyle = color;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "700 46px Bebas Neue, Impact, sans-serif";
    g.fillText(text, W / 2, 330);
    g.globalAlpha = 1;
  }

  // ---------- lifecycle ----------

  isFinished(): boolean {
    return this.done;
  }

  getScores(): { playerId: string; score: number }[] {
    const standing = this.standing();
    return this.ctx.players.map((player, index) => ({ playerId: player.id, score: standing[teamOf(index)] }));
  }

  destroy(): void {
    const canvas = this.ctx.canvas;
    canvas.removeEventListener("pointerdown", this.onDown);
    canvas.removeEventListener("pointermove", this.onMove);
    canvas.removeEventListener("pointerup", this.onUp);
    canvas.removeEventListener("pointercancel", this.onCancel);
    this.world.destroy();
  }
}

export const castleSiege: MinigameDefinition = {
  id: "castle-siege",
  name: "Castle Siege",
  tagline: "Build from the same random pieces, then knock theirs down.",
  description:
    "Both sides get the same random pieces. Lay your base, build up, survive the settle (anything on the ground is out), then trade 8 wind-blown shots each. Clear their tower or have more standing when the shots run out.",
  durationMs: 0,
  controls: "Drag pieces from your tray · ⟳ rotates · drag back from your side and release to fire",
  create: (ctx) => new CastleSiege(ctx),
};

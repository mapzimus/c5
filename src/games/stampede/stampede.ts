import { drawTimerBar, fillArena } from "../../core/draw";
import { Callouts, Juice } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import {
  botDecide,
  difficulty,
  HOP_S,
  LANES,
  matchOver,
  occupiedLanes,
  planWave,
  ROUND_S,
  roundOver,
  roundWinners,
  WINS_NEEDED,
  type Obstacle,
} from "./logic";

export const stampede: GameDefinition = {
  id: "stampede",
  name: "Stampede",
  tagline: "Hop lanes. Don't get flattened.",
  description:
    "You're a critter on a five-lane ice floe. Herds of fat sliding critters barrel in from the right, " +
    "one lane each, and there's always a gap somewhere. Hop up or down to dodge or get bulldozed off the " +
    "edge, spinning. Waves get faster, two-lane bruisers show up after 20s and a STAMPEDE wall leaves " +
    "exactly one safe lane after 30s. Last one standing wins the round. First to 2 round wins.",
  durationMs: 0,
  controls: "Tap the top half of your zone to hop up, bottom half to hop down. Swipes work too.",
  create: (ctx) => new Stampede(ctx),
};

const INTRO_S = 1.4;
const RESULT_S = 2.2;
const FINAL_S = 2.2;
const FONT = "Bebas Neue, Impact, sans-serif";
const HUD_H = 84;
const FLOE_LEFT = 40;
const SWIPE_PX = 60;

type Phase = "intro" | "round" | "result" | "final";

interface Seat {
  player: Player;
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
  wins: number;
  alive: boolean;
  fellAt: number | null;
  longest: number;
  rot: number;
  vx: number;
  splashed: boolean;
  botThreshold: number;
  botCooldown: number;
  bump: number;
}

interface Critter {
  x: number;
  lanes: number[];
  big: boolean;
  stampede: boolean;
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

  constructor(private readonly ctx: GameContext) {
    this.juice = new Juice(() => ctx.rng.next());
    this.laneH = (ctx.height - HUD_H - 12) / LANES;
    this.playerR = Math.min(34, this.laneH * 0.3);
    const n = ctx.players.length;
    const zw = ctx.width / n;
    this.seats = ctx.players.map((player, i) => ({
      player,
      zx: i * zw,
      zw,
      standX: FLOE_LEFT + 70 + i * 72,
      x: 0,
      lane: 2,
      y: 0,
      hopFrom: 0,
      hopT: HOP_S,
      wins: 0,
      alive: true,
      fellAt: null,
      longest: 0,
      rot: 0,
      vx: 0,
      splashed: false,
      botThreshold: 0.8,
      botCooldown: 0,
      bump: 0,
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

  private startRound(): void {
    this.t = 0;
    this.waveTimer = 0.9;
    this.lastStampedeAt = -Infinity;
    this.critters = [];
    this.goShown = false;
    this.bigWarned = false;
    const lanes = [0, 1, 2, 3, 4];
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i]!;
      // Spread players over the lanes so nobody starts stacked.
      const pick = lanes.splice(this.ctx.rng.int(0, lanes.length - 1), 1)[0] ?? 2;
      s.lane = pick;
      s.y = this.laneY(pick);
      s.hopFrom = s.y;
      s.hopT = HOP_S;
      s.x = s.standX;
      s.alive = true;
      s.fellAt = null;
      s.rot = 0;
      s.vx = 0;
      s.splashed = false;
      s.botThreshold = this.ctx.rng.float(0.6, 1.1);
      s.botCooldown = this.ctx.rng.float(0, 0.3);
      s.bump = 0;
    }
  }

  update(realDt: number): void {
    this.callouts.update(realDt);
    const dt = this.juice.update(realDt);
    this.stepSeatsVisual(dt);
    if (this.finished) return;

    if (this.phase === "intro") {
      this.timer -= dt;
      if (!this.goShown && this.timer <= 0.45) {
        this.goShown = true;
        this.callouts.show("GO!", "#B8FF3D", { size: 110, life: 0.7, y: 0.5 });
        this.ctx.sfx.go();
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
    this.stepCritters(dt);
    this.collide();
    this.bots(dt);

    const timedOut = this.t >= ROUND_S;
    if (roundOver(this.seats, timedOut)) this.endRound(timedOut);
  }

  private spawn(dt: number): void {
    this.waveTimer -= dt;
    if (this.waveTimer > 0) return;
    const d = difficulty(this.t);
    const wave = planWave(this.t, this.ctx.rng, this.lastStampedeAt);
    this.waveTimer = d.interval * (wave.stampede ? 1.6 : 1);
    if (wave.stampede) {
      this.lastStampedeAt = this.t;
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
      const lanes = occupiedLanes(c);
      const ry = c.big ? this.laneH * 0.92 : this.laneH * 0.36;
      const rx = c.big ? this.laneH * 0.78 : this.laneH * 0.44;
      const cy = c.big ? this.laneY(c.lane) + this.laneH / 2 : this.laneY(c.lane);
      this.critters.push({
        x: this.ctx.width + rx + (wave.stampede ? 0 : this.ctx.rng.float(0, 90)),
        lanes,
        big: c.big,
        stampede: wave.stampede,
        speed: d.speed * (c.big ? 0.9 : 1) * (wave.stampede ? 1.15 : 1),
        rx,
        ry,
        cy,
        face: this.ctx.rng.int(0, 2),
        wobble: this.ctx.rng.float(0, Math.PI * 2),
      });
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
          this.flatten(s, c);
          break;
        }
      }
    }
  }

  private flatten(s: Seat, c: Critter): void {
    s.alive = false;
    s.fellAt = this.t;
    s.longest = Math.max(s.longest, this.t);
    s.vx = -c.speed * 1.25;
    s.hopT = HOP_S;
    this.juice.shake(0.4);
    this.juice.hitStop(0.06);
    this.juice.burst(s.x, s.y, [s.player.color, "#ffffff", "#bfe3ff"], { count: 22, speed: 320, gravity: 500, size: 5 });
    this.callouts.show(`${s.player.name} FLATTENED!`, s.player.color, { size: 46, life: 0.9, y: 0.86 });
    this.ctx.sfx.hit();
  }

  private bots(dt: number): void {
    const d = difficulty(this.t);
    let obs: Obstacle[] | null = null;
    for (const s of this.seats) {
      if (s.player.kind !== "bot" || !s.alive) continue;
      s.botCooldown -= dt;
      if (s.botCooldown > 0) continue;
      obs ??= this.critters.map((c) => ({ x: c.x, rx: c.rx, lanes: c.lanes }));
      const to = botDecide(s.lane, obs, s.x, this.playerR, d.speed, s.botThreshold, this.ctx.rng);
      if (to !== null) {
        this.hop(s, to - s.lane);
        s.botCooldown = 0.25;
      }
    }
  }

  private hop(s: Seat, dir: number): void {
    if (this.phase !== "round" || !s.alive || dir === 0) return;
    const next = s.lane + dir;
    if (next < 0 || next >= LANES) {
      s.bump = 1;
      this.ctx.sfx.miss();
      return;
    }
    s.hopFrom = s.y;
    s.lane = next;
    s.hopT = 0;
    this.ctx.sfx.tick();
    this.juice.burst(s.x, s.y + this.playerR * 0.8, "#ffffff", {
      count: 5, speed: 120, gravity: 300, size: 3, life: 0.3, angle: Math.PI / 2, spread: 2,
    });
  }

  private stepSeatsVisual(dt: number): void {
    for (const s of this.seats) {
      s.bump = Math.max(0, s.bump - dt * 5);
      if (s.alive) {
        if (s.hopT < HOP_S) {
          s.hopT = Math.min(HOP_S, s.hopT + dt);
          const p = s.hopT / HOP_S;
          const e = 1 - (1 - p) * (1 - p);
          s.y = s.hopFrom + (this.laneY(s.lane) - s.hopFrom) * e;
        } else {
          s.y = this.laneY(s.lane);
        }
      } else if (s.vx !== 0) {
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
      }
    }
  }

  private endRound(timedOut: boolean): void {
    if (this.phase !== "round") return;
    for (const s of this.seats) if (s.alive) s.longest = Math.max(s.longest, this.t);
    const winners = roundWinners(this.seats, timedOut);
    for (const i of winners) this.seats[i]!.wins += 1;
    const names = winners.map((i) => this.seats[i]!.player.name);
    if (winners.length === 1) {
      const w = this.seats[winners[0]!]!;
      this.resultText = w.alive ? `${w.player.name} survives!` : `${w.player.name} fell last!`;
      this.resultColor = w.player.color;
    } else if (winners.length > 1) {
      this.resultText = timedOut ? `${names.join(" & ")} share it!` : `${names.join(" & ")} fell together!`;
      this.resultColor = "#F4F7FB";
    } else {
      this.resultText = "Nobody?!";
      this.resultColor = "#FF3D7A";
    }
    this.ctx.sfx.collect();
    const wins = this.seats.map((s) => s.wins);
    if (matchOver(wins, this.roundIndex + 1)) {
      this.phase = "final";
      this.timer = RESULT_S + FINAL_S;
      const top = Math.max(...wins);
      const leaders = this.seats.filter((s) => s.wins === top);
      const text = top === 0 ? "NO WINNER" : leaders.map((s) => s.player.name).join(" & ") + " WINS!";
      this.callouts.show(text, leaders.length === 1 && top > 0 ? leaders[0]!.player.color : "#F4F7FB", {
        size: 72, life: RESULT_S + FINAL_S, y: 0.22,
      });
      this.ctx.sfx.win();
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
    const drawables: { y: number; draw: () => void }[] = [];
    for (const s of this.seats) drawables.push({ y: s.y, draw: () => this.drawPlayer(g, s) });
    for (const c of this.critters) drawables.push({ y: c.cy + c.ry, draw: () => this.drawCritter(g, c) });
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.draw();
    this.juice.end(g);
    this.drawHud(g);
    this.drawCenter(g);
    this.callouts.draw(g, width, height);
  }

  private drawFloe(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    // Water on the left where the fallen end up.
    g.fillStyle = "#0a2a4a";
    g.fillRect(0, HUD_H, FLOE_LEFT, height - HUD_H);
    for (let l = 0; l < LANES; l++) {
      const y = HUD_H + l * this.laneH;
      g.fillStyle = l % 2 === 0 ? "#dcedf9" : "#c3dcef";
      g.fillRect(FLOE_LEFT, y, width - FLOE_LEFT, this.laneH);
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
      if (s.player.kind === "human" && this.phase === "round" && s.alive) {
        g.globalAlpha = 0.35;
        g.fillStyle = s.player.color;
        g.font = `700 30px ${FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("▲ UP", s.zx + s.zw / 2, HUD_H + 26);
        g.fillText("▼ DOWN", s.zx + s.zw / 2, height - 26);
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

  private drawPlayer(g: CanvasRenderingContext2D, s: Seat): void {
    if (!s.alive && s.vx === 0) return;
    const r = this.playerR;
    g.save();
    if (!s.alive) g.globalAlpha = Math.max(0, Math.min(1, (s.x + 60) / 120));
    // Shadow on the ice.
    g.fillStyle = "rgba(20,40,70,0.22)";
    g.beginPath();
    g.ellipse(s.x, s.y + r * 0.95, r * 0.9, r * 0.3, 0, 0, Math.PI * 2);
    g.fill();

    g.translate(s.x, s.y);
    if (!s.alive) g.rotate(s.rot);
    const hp = s.hopT < HOP_S ? Math.sin((s.hopT / HOP_S) * Math.PI) : 0;
    const bump = s.bump;
    g.translate(0, -hp * 14);
    g.scale(1 + hp * 0.22 + bump * 0.2, 1 - hp * 0.22 - bump * 0.2);

    g.fillStyle = s.player.color;
    g.shadowColor = s.player.color;
    g.shadowBlur = 14;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
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

  private drawCritter(g: CanvasRenderingContext2D, c: Critter): void {
    const { rx, ry } = c;
    g.save();
    g.translate(c.x, c.cy);
    g.rotate(Math.sin(c.x / 36 + c.wobble) * 0.05);
    // Speed streaks trailing to the right.
    g.strokeStyle = "rgba(255,255,255,0.7)";
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
    g.fillStyle = c.stampede ? "#f1c9cf" : c.big ? "#b9c9da" : "#e6edf5";
    g.strokeStyle = c.stampede ? "#b4505f" : "#6f8aa8";
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    // Belly.
    g.fillStyle = "rgba(255,255,255,0.75)";
    g.beginPath();
    g.ellipse(-rx * 0.2, ry * 0.2, rx * 0.55, ry * 0.55, 0, 0, Math.PI * 2);
    g.fill();
    // Flippers.
    g.fillStyle = c.stampede ? "#d9a0a9" : "#9fb3c8";
    g.beginPath();
    g.ellipse(rx * 0.35, ry * 0.75, rx * 0.35, ry * 0.18, 0.3, 0, Math.PI * 2);
    g.fill();
    // Face, facing left (direction of travel).
    const ex = -rx * 0.45;
    const ey = -ry * 0.25;
    const er = Math.max(3, ry * 0.12);
    g.fillStyle = "#070b14";
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
    if (c.stampede || c.face === 2) {
      // Angry brows.
      g.strokeStyle = "#070b14";
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
    g.strokeStyle = "#070b14";
    g.lineWidth = 2.5;
    g.beginPath();
    if (c.face === 0 || c.stampede) g.arc(ex + rx * 0.17, ey + er * 2.4, er * 1.3, c.stampede ? Math.PI : 0.2, c.stampede ? 0 : Math.PI - 0.2);
    else g.arc(ex + rx * 0.17, ey + er * 2.6, er * 0.7, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }

  private drawHud(g: CanvasRenderingContext2D): void {
    const { width } = this.ctx;
    if (this.phase === "round") drawTimerBar(g, width, Math.max(0, ROUND_S - this.t), ROUND_S);
    for (const s of this.seats) {
      const cx = s.zx + s.zw / 2;
      g.save();
      g.textAlign = "center";
      g.textBaseline = "top";
      g.fillStyle = s.alive || this.phase !== "round" ? s.player.color : "rgba(244,247,251,0.35)";
      g.font = `700 30px ${FONT}`;
      g.fillText(s.player.name + (s.alive || this.phase !== "round" ? "" : "  OUT"), cx, 32);
      for (let k = 0; k < WINS_NEEDED; k++) {
        g.beginPath();
        g.arc(cx + (k - (WINS_NEEDED - 1) / 2) * 26, 72, 8, 0, Math.PI * 2);
        g.fillStyle = k < s.wins ? s.player.color : "rgba(244,247,251,0.18)";
        g.fill();
      }
      g.restore();
    }
  }

  private drawCenter(g: CanvasRenderingContext2D): void {
    const { width, height } = this.ctx;
    let text = "";
    let color = "#F4F7FB";
    let size = 64;
    if (this.phase === "intro") {
      if (this.goShown) return;
      text = `ROUND ${this.roundIndex + 1}`;
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
    g.restore();
  }

  isFinished(): boolean {
    return this.finished;
  }

  getScores(): { playerId: string; score: number }[] {
    return this.seats.map((s) => ({ playerId: s.player.id, score: s.wins }));
  }

  getStats(): GameStat[] {
    return this.seats.map((s) => ({
      playerId: s.player.id,
      label: "Longest survival",
      value: `${s.longest.toFixed(1)}s`,
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

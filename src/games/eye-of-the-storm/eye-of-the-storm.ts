import { fillArena } from "../../core/draw";
import { Callouts, Juice, loadBest, saveBest } from "../../fx/juice";
import type { GameContext, GameDefinition, GameInstance, GameStat, Player } from "../../core/types";
import { PUCK_RADIUS, isResting, stepWorld, type Puck, type World } from "./physics";
import {
  CELL_EVERY_S,
  CELL_RADIUS,
  MAX_PULL,
  PAD_RADIUS,
  PUCKS_EACH,
  RELOAD_S,
  RINGS,
  botRelease,
  launchVelocity,
  padPositions,
  placeCell,
  ringPoints,
  scatterPegs,
  touchesCell,
  scoreBoard,
  type Point,
  type BonusCell,
} from "./rules";

export const eyeOfTheStorm: GameDefinition = {
  id: "eye-of-the-storm",
  name: "Bullseye",
  tagline: "Everyone fires at once. Land in the centre.",
  description:
    "Three evolving volleys: Calm, Gale, then Tempest. Each volley banks your points and resets the field with stronger winds and more pegs. Slingshot from your corner into the bullseye. Centre 10, middle 5, outer 2. The vortex bends shots and flips direction, and anyone can knock you out. In the Tempest, a golden target drifts across the board worth 20 points. Built for a big multi-touch screen: all players shoot at the same time.",
  durationMs: 90_000,
  controls: "Drag back from your corner pad, release to fire",
  create: (ctx) => new EyeOfTheStorm(ctx),
};

interface Seat {
  player: Player;
  pad: Point;
  left: number;
  reload: number;
  botWait: number;
  /** Where the active finger/mouse is while aiming. */
  aim: Point | null;
}

const SETTLE_GRACE_S = 0.8;

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
  private settled = 0;
  private volley = 1;
  private volleyTime = 0;
  private intermission = 0;
  private readonly bank = new Map<string, number>();
  private time = 0;
  private scores = new Map<string, number>();
  private readonly juice: Juice;
  private readonly callouts = new Callouts();
  private cell: BonusCell | null = null;
  private cellTimer: number;
  /** puck id -> who last hit it and when, to credit knockouts. */
  private readonly lastHit = new Map<number, { owner: string; at: number }>();
  private readonly lastPoints = new Map<number, number>();
  private readonly bullseyes = new Set<number>();
  private readonly best = loadBest("eye-of-the-storm", "3v");
  private newBestShown = false;
  private readonly koCount = new Map<string, number>();
  private readonly bullseyeCount = new Map<string, number>();
  private readonly bonusPucks = new Map<string, number>();
  private golden: GoldenTarget | null = null;
  private readonly goldenScored = new Set<number>();
  private readonly goldenPoints = new Map<string, number>();
  private readonly goldenHitCount = new Map<string, number>();

  constructor(private readonly ctx: GameContext) {
    const { width, height, rng } = ctx;
    this.center = { x: width / 2, y: height / 2 };
    const pads = padPositions(width, height);
    this.seats = ctx.players.map((player, i) => ({
      player,
      pad: pads[i % pads.length]!,
      left: PUCKS_EACH,
      reload: 0,
      botWait: rng.float(1, 2.5),
      aim: null,
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
    if (this.intermission > 0) {
      this.intermission -= realDt;
      if (this.intermission <= 0) {
        this.volley++;
        const vc = VOLLEY_CONDITIONS[this.volley - 1]!;
        this.volleyTime = 0;
        this.world.pucks.length = 0;
        this.lastHit.clear();
        this.lastPoints.clear();
        this.bullseyes.clear();
        this.cell = null;
        this.settled = 0;
        this.goldenScored.clear();
        this.goldenPoints.clear();
        const pads = padPositions(this.ctx.width, this.ctx.height);
        this.world.pegs = scatterPegs(this.ctx.rng, this.ctx.width, this.ctx.height, pads, vc.pegCount);
        this.world.swirl.spin = this.ctx.rng.sign() * this.ctx.rng.float(1.2, 2) * vc.swirlMul;
        this.swirlTimer = this.ctx.rng.float(vc.swirlFlipRange[0], vc.swirlFlipRange[1]);
        this.cellTimer = this.ctx.rng.float(vc.cellInterval[0], vc.cellInterval[1]);
        if (vc.goldenTarget) {
          const angle = this.ctx.rng.float(0, Math.PI * 2);
          this.golden = {
            x: this.center.x + this.ctx.rng.float(-100, 100),
            y: this.center.y + this.ctx.rng.float(-80, 80),
            vx: Math.cos(angle) * GOLDEN_SPEED,
            vy: Math.sin(angle) * GOLDEN_SPEED,
          };
        } else {
          this.golden = null;
        }
        for (const seat of this.seats) { seat.left = PUCKS_EACH; seat.reload = 0; seat.aim = null; }
        const label = this.volley === 3 ? `FINAL VOLLEY: ${vc.name}` : `VOLLEY ${this.volley}: ${vc.name}`;
        this.callouts.show(label, vc.color, { size: 48 });
      }
      return;
    }
    this.volleyTime += dt;
    if (this.volleyTime >= 24) for (const seat of this.seats) seat.left = 0;
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

    for (const seat of this.seats) {
      seat.reload = Math.max(0, seat.reload - dt);
      if (seat.player.kind === "bot" && seat.left > 0 && seat.reload === 0) {
        seat.botWait -= dt;
        if (seat.botWait <= 0) {
          this.fire(seat, botRelease(this.ctx.rng, seat.pad, this.center));
          seat.botWait = this.ctx.rng.float(1.2, 3.2);
        }
      }
    }

    const events = stepWorld(this.world, dt, () => this.ctx.rng.float(-1, 1));
    if (events.puckHits > 0) this.ctx.sfx.hit();
    else if (events.pegHits > 0) this.ctx.sfx.tick();
    for (const { a, b, speed } of events.contacts) {
      this.juice.shake(Math.min(0.45, speed / 2600));
      this.juice.burst((a.x + b.x) / 2, (a.y + b.y) / 2, [this.colorOf(a.owner), this.colorOf(b.owner)], {
        count: Math.min(24, 6 + Math.round(speed / 80)),
        speed: 120 + speed * 0.25,
        gravity: 0,
        life: 0.45,
      });
      if (a.owner !== b.owner) {
        this.lastHit.set(a.id, { owner: b.owner, at: this.time });
        this.lastHit.set(b.id, { owner: a.owner, at: this.time });
      }
    }
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
          this.callouts.show(`GOLDEN! +${GOLDEN_POINTS}`, "#FFD700", { size: 56 });
          this.juice.burst(this.golden.x, this.golden.y, ["#FFD700", "#FFA500", this.colorOf(puck.owner)], { count: 40, speed: 400, gravity: 0 });
          this.juice.shake(0.3);
          this.ctx.sfx.collect();
        }
      }
    }
    for (const [id, pts] of this.goldenPoints) this.scores.set(id, (this.scores.get(id) ?? 0) + pts);
    for (const seat of this.seats) this.scores.set(seat.player.id, (this.scores.get(seat.player.id) ?? 0) + (this.bank.get(seat.player.id) ?? 0));
    const humanTop = Math.max(0, ...this.seats.filter((s) => s.player.kind === "human").map((s) => this.scores.get(s.player.id) ?? 0));
    if (!this.newBestShown && this.best > 0 && humanTop > this.best) {
      this.newBestShown = true;
      this.callouts.show("NEW BEST!", "#B8FF3D", { y: 0.2, size: 56 });
      this.ctx.sfx.win();
    }

    const allOut = this.seats.every((s) => s.left === 0);
    const still = this.world.pucks.every(isResting);
    this.settled = allOut && (still || this.volleyTime >= 27) ? this.settled + dt : 0;
    if (this.settled >= SETTLE_GRACE_S && this.volley < 3) {
      for (const seat of this.seats) this.bank.set(seat.player.id, this.scores.get(seat.player.id) ?? 0);
      this.intermission = 1.5;
      this.grabs.clear();
      for (const seat of this.seats) seat.aim = null;
      this.callouts.show("POINTS BANKED!", "#B8FF3D");
      this.ctx.sfx.collect();
    }
  }

  isFinished(): boolean {
    return this.volley === 3 && this.settled >= SETTLE_GRACE_S;
  }

  getScores(): { playerId: string; score: number }[] {
    const humanTop = Math.max(0, ...this.seats.filter((s) => s.player.kind === "human").map((s) => this.scores.get(s.player.id) ?? 0));
    saveBest("eye-of-the-storm", humanTop, "3v");
    return this.seats.map((s) => ({ playerId: s.player.id, score: this.scores.get(s.player.id) ?? 0 }));
  }

  getStats(): GameStat[] {
    const stats: GameStat[] = [];
    for (const s of this.seats) {
      const id = s.player.id;
      const kos = this.koCount.get(id) ?? 0;
      const bulls = this.bullseyeCount.get(id) ?? 0;
      const bonus = this.bonusPucks.get(id) ?? 0;
      if (bulls > 0) stats.push({ playerId: id, label: "Bullseyes", value: String(bulls) });
      if (kos > 0) stats.push({ playerId: id, label: "Knockouts", value: String(kos) });
      if (bonus > 0) stats.push({ playerId: id, label: "Bonus pucks", value: String(bonus) });
      const gold = this.goldenHitCount.get(id) ?? 0;
      if (gold > 0) stats.push({ playerId: id, label: "Golden hits", value: String(gold) });
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

  private colorOf(owner: string): string {
    return this.seats.find((s) => s.player.id === owner)?.player.color ?? "#ffffff";
  }

  private nameOf(owner: string): string {
    return this.seats.find((s) => s.player.id === owner)?.player.name ?? "";
  }

  /** Knockouts, bullseyes: the moments worth shouting about. */
  private updateMoments(): void {
    for (const puck of this.world.pucks) {
      const points = ringPoints(puck.x, puck.y, this.center);
      const before = this.lastPoints.get(puck.id) ?? 0;
      this.lastPoints.set(puck.id, points);
      const hit = this.lastHit.get(puck.id);
      if (points < before && hit && this.time - hit.at < 1.5) {
        this.lastHit.delete(puck.id);
        this.koCount.set(hit.owner, (this.koCount.get(hit.owner) ?? 0) + 1);
        this.callouts.show(`KNOCKOUT! ${this.nameOf(hit.owner)}`, this.colorOf(hit.owner));
        this.juice.shake(0.35);
        this.juice.burst(puck.x, puck.y, this.colorOf(hit.owner), { count: 30, speed: 380, gravity: 0 });
        this.ctx.sfx.streak(4);
      }
      if (points === RINGS[0].points && isResting(puck)) {
        if (!this.bullseyes.has(puck.id)) {
          this.bullseyes.add(puck.id);
          this.bullseyeCount.set(puck.owner, (this.bullseyeCount.get(puck.owner) ?? 0) + 1);
          this.callouts.show("BULLSEYE", this.colorOf(puck.owner), { size: 72 });
          this.juice.burst(puck.x, puck.y, [this.colorOf(puck.owner), "#FFB020", "#ffffff"], { count: 40, speed: 420, gravity: 0 });
          this.juice.shake(0.25);
          this.ctx.sfx.collect();
        }
      } else if (points !== RINGS[0].points) {
        this.bullseyes.delete(puck.id);
      }
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

  private fire(seat: Seat, release: Point): void {
    if (this.intermission > 0 || this.volleyTime >= 24 || seat.left <= 0 || seat.reload > 0) return;
    const v = launchVelocity(seat.pad, release);
    if (!v) return;
    const puck: Puck = { id: this.nextId++, owner: seat.player.id, x: seat.pad.x, y: seat.pad.y, r: PUCK_RADIUS, ...v };
    this.world.pucks.push(puck);
    seat.left -= 1;
    seat.reload = RELOAD_S;
    this.ctx.sfx.go();
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
    fillArena(g, width, height);
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
    for (const seat of this.seats) if (seat.aim) this.drawAim(g, seat);
    this.juice.end(g);
    if (this.best > 0) {
      g.fillStyle = "rgba(244,247,251,0.5)";
      g.font = "600 14px Outfit, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "top";
      g.fillText(`BEST ${this.best}`, width / 2, 10);
    }
    const vc = VOLLEY_CONDITIONS[this.volley - 1]!;
    g.fillStyle = "#F4F7FB";
    g.font = "600 18px Outfit, sans-serif";
    g.textAlign = "center";
    g.fillText(`VOLLEY ${this.volley}/3: ${vc.name} • ${Math.ceil(Math.max(0, 24 - this.volleyTime))}s`, width / 2, height - 18);
    this.callouts.draw(g, width, height);
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
    const ready = seat.left > 0 && seat.reload === 0;
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

    // Remaining pucks as pips around the pad.
    for (let i = 0; i < PUCKS_EACH; i += 1) {
      const a = -Math.PI / 2 + (i / PUCKS_EACH) * Math.PI * 2;
      g.beginPath();
      g.arc(pad.x + Math.cos(a) * (PAD_RADIUS + 14), pad.y + Math.sin(a) * (PAD_RADIUS + 14), 6, 0, Math.PI * 2);
      g.fillStyle = i < seat.left ? player.color : "rgba(244,247,251,0.12)";
      g.fill();
    }

    // Text faces the table centre so each corner reads it the right way up.
    g.translate(pad.x, pad.y);
    g.rotate(Math.atan2(this.center.y - pad.y, this.center.x - pad.x) - Math.PI / 2 + Math.PI);
    g.fillStyle = "#F4F7FB";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "700 40px Bebas Neue, Impact, sans-serif";
    g.fillText(String(this.scores.get(player.id) ?? 0), 0, -6);
    g.font = "600 15px Outfit, sans-serif";
    g.fillStyle = player.color;
    g.fillText(player.name, 0, 24);
    g.restore();
  }

  private drawPuck(g: CanvasRenderingContext2D, puck: Puck): void {
    const seat = this.seats.find((s) => s.player.id === puck.owner);
    const color = seat?.player.color ?? "#ffffff";
    g.save();
    g.shadowColor = color;
    g.shadowBlur = 14;
    g.beginPath();
    g.arc(puck.x, puck.y, puck.r, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.shadowBlur = 0;
    g.beginPath();
    g.arc(puck.x, puck.y, puck.r * 0.5, 0, Math.PI * 2);
    g.fillStyle = "rgba(7,11,20,0.35)";
    g.fill();
    g.restore();
  }

  private drawAim(g: CanvasRenderingContext2D, seat: Seat): void {
    const aim = seat.aim!;
    const { pad } = seat;
    const dx = pad.x - aim.x;
    const dy = pad.y - aim.y;
    const pull = Math.min(Math.hypot(dx, dy), MAX_PULL);
    const len = Math.hypot(dx, dy) || 1;
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
    g.beginPath();
    g.arc(pad.x - (dx / len) * pull, pad.y - (dy / len) * pull, PUCK_RADIUS, 0, Math.PI * 2);
    g.fillStyle = seat.left > 0 ? seat.player.color : "rgba(244,247,251,0.2)";
    g.fill();
    g.restore();
  }
}
